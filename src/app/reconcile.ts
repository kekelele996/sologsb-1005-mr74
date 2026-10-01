import type { Feature, IncomingReview, OutboxEntry, ReviewCopyFeature, ReviewItem, SuspendReason } from './models'

/**
 * 特征指纹：按“特征正文 + 指向的支持段落”生成。
 * 两侧对账只认这两样；代理人改了正文或动了支持段落，指纹即变化。
 */
export function featureFingerprint(text: string, supportIds: readonly string[]): string {
  const canonical = `${text.trim()}|${[...supportIds].sort().join(',')}`
  return fnv1a(canonical)
}

export function featureFingerprintOf(feature: Pick<Feature, 'text' | 'supportIds'>): string {
  return featureFingerprint(feature.text, feature.supportIds)
}

export function copyFingerprintOf(feature: Pick<ReviewCopyFeature, 'text' | 'supportIds'>): string {
  return featureFingerprint(feature.text, feature.supportIds)
}

/** 幂等键：意见本身 + 审查确认时间；同一版本无论带回多少次都只挂一次 */
export function reviewKey(item: Pick<ReviewItem, 'id' | 'reviewedAt'>): string {
  return `${item.id}@${item.reviewedAt}`
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export interface ReconcileInput {
  items: ReviewItem[]
  outbox: OutboxEntry[]
  /** 代理人一侧当前的技术特征 */
  features: Feature[]
  /** 代理人一侧已经对上账的幂等键 */
  appliedKeys: string[]
  batchId: string
  at: string
}

export interface ReconcileResult {
  incoming: IncomingReview[]
  appliedKeys: string[]
  report: { activeCount: number; staleCount: number; suspendedCount: number; skippedCount: number }
  /** 对账成功后可置为 delivered 的发件记录 id */
  deliveredEntryIds: string[]
}

/**
 * 把审查员带回的一批意见按“特征正文 + 指向段落”对账。
 *
 * - 幂等：键已在 appliedKeys 中的，直接跳过（重试不重复挂）。
 * - active：同 id 同指纹，结论继续有效。
 * - stale：特征 id 还在，但结论确认后正文/支持段落被代理人改过 → 结论作废，等审查员重新确认。
 * - suspended：指向的特征已撤下，或按指纹只能对到多个候选，先挂起等人定。
 */
export function reconcileBringBack(input: ReconcileInput): ReconcileResult {
  const { items, features, batchId, at } = input
  const fingerprints = new Map<string, string>()
  features.forEach(feature => fingerprints.set(feature.id, featureFingerprintOf(feature)))

  const byFingerprint = new Map<string, Feature[]>()
  features.forEach(feature => {
    const fp = fingerprints.get(feature.id)!
    const list = byFingerprint.get(fp) || []
    list.push(feature)
    byFingerprint.set(fp, list)
  })

  const incoming: IncomingReview[] = []
  const appliedKeys = [...input.appliedKeys]
  const report = { activeCount: 0, staleCount: 0, suspendedCount: 0, skippedCount: 0 }

  for (const item of items) {
    const key = reviewKey(item)
    if (appliedKeys.includes(key)) {
      report.skippedCount += 1
      continue
    }

    const snapshotFp = featureFingerprint(item.featureText, item.supportIds)
    const sameId = features.find(feature => feature.id === item.featureId)

    let state: IncomingReview['state']
    let featureId: string | null
    let suspendReason: SuspendReason | undefined
    let drift = false

    if (sameId && fingerprints.get(sameId.id) === snapshotFp) {
      state = 'active'
      featureId = sameId.id
    } else if (sameId) {
      // 特征还在，但结论之后正文或支持段落被改动：结论作废，其余照旧
      state = 'stale'
      featureId = sameId.id
      drift = item.kind === 'annotation'
    } else {
      // 指向特征已撤下：尝试按快照指纹找回唯一同内容特征，否则挂起等人定
      const candidates = byFingerprint.get(snapshotFp) || []
      if (candidates.length === 1) {
        state = 'active'
        featureId = candidates[0].id
      } else {
        state = 'suspended'
        featureId = null
        suspendReason = candidates.length > 1 ? 'relink-ambiguous' : 'feature-removed'
      }
    }

    incoming.push({
      id: `incoming-${key}`,
      key,
      itemId: item.id,
      featureId,
      featureLabel: item.featureLabel,
      featureText: item.featureText,
      supportIds: [...item.supportIds],
      kind: item.kind,
      text: item.text,
      decision: item.decision,
      authorName: item.authorName,
      reviewedAt: item.reviewedAt,
      broughtAt: at,
      batchId,
      state,
      suspendReason,
      drift
    })
    appliedKeys.push(key)
    if (state === 'active') report.activeCount += 1
    else if (state === 'stale') report.staleCount += 1
    else report.suspendedCount += 1
  }

  // 只要该意见版本出现在本次带回中（含因幂等跳过的），其对应待发记录就算送达。
  // outbox 记录的 id 即 reviewKey，可精确到具体确认版本。
  const broughtKeys = new Set(items.map(item => reviewKey(item)))
  const deliveredEntryIds = input.outbox
    .filter(entry => entry.status === 'pending' && broughtKeys.has(entry.id))
    .map(entry => entry.id)

  return { incoming, appliedKeys, report, deliveredEntryIds }
}
