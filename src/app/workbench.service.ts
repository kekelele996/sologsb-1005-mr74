import { Injectable, OnDestroy } from '@angular/core'
import { BehaviorSubject, map } from 'rxjs'
import type {
  AppState, AuthorWorkspace, Claim, ClaimVersion, ExaminerWorkspace, Feature,
  IncomingReview, Paragraph, Position, ReviewCopyFeature, ReviewDecision, ReviewItem,
  ReviewKind, Role, ValidationIssue
} from './models'
import { copyFingerprintOf, featureFingerprint, featureFingerprintOf, reconcileBringBack, reviewKey } from './reconcile'

const STORAGE_KEY = 'patent-claim-mapping-workbench-v2'
const POSITION_KEY = 'patent-claim-mapping-position-v2'
const EXAMINER_NAME = '审查员 · 李岚'

const initialClaims: Claim[] = [
  { id: 'claim-1', number: 1, title: '一种自适应展柜环境控制装置', independent: true, text: '一种自适应展柜环境控制装置，包括：柜体；环境传感模块，设置于所述柜体内并用于采集温湿度数据；以及控制模块，与所述环境传感模块通信，并根据所述温湿度数据调节所述柜体的微环境。' },
  { id: 'claim-2', number: 2, title: '传感模块的布置方式', independent: false, text: '根据权利要求1所述的装置，其特征在于，所述环境传感模块包括沿所述柜体对角线布置的多个温湿度传感器。' },
  { id: 'claim-3', number: 3, title: '控制模块的调节策略', independent: false, text: '根据权利要求1所述的装置，其特征在于，所述控制模块基于历史数据与当前数据之间的偏差分级调节除湿单元。' }
]
const initialParagraphs: Paragraph[] = [
  { id: 'para-0012', section: '说明书 [0012]', text: '柜体1形成用于陈列文物的封闭空间。环境传感模块2安装于柜体内部，可采集温度、相对湿度等环境数据，并将数据发送至控制模块3。' },
  { id: 'para-0018', section: '说明书 [0018]', text: '在一种实施方式中，多个温湿度传感器沿柜体对角线布置，由此可降低局部气流造成的测量偏差。传感器数量可根据柜体容积设定。' },
  { id: 'para-0024', section: '说明书 [0024]', text: '控制模块可比较当前湿度与预设区间，并结合历史变化趋势生成调节等级。当偏差持续超过阈值时，控制模块启动除湿单元并提高调节频率。' },
  { id: 'para-0031', section: '说明书 [0031]', text: '控制模块与传感模块之间可以采用有线或无线通信。通信链路可周期传输数据，传输周期例如为十秒至五分钟。' },
  { id: 'para-0040', section: '说明书 [0040]', text: '微环境调节包括湿度调节、温度调节及气体交换。控制策略可记录执行结果，用于后续趋势判断。' }
]
const initialFeatures: Feature[] = [
  { id: 'feature-a', claimId: 'claim-1', label: 'A · 柜体', text: '柜体', parentId: null, referenceIds: [], supportIds: ['para-0012'] },
  { id: 'feature-b', claimId: 'claim-1', label: 'B · 环境传感模块', text: '设置于柜体内，用于采集温湿度数据', parentId: 'feature-a', referenceIds: [], supportIds: ['para-0012', 'para-0018'] },
  // 代理人在审查结论之后改写过 B 的正文：旧结论对账时应作废（stale）
  { id: 'feature-c', claimId: 'claim-1', label: 'C · 控制模块通信', text: '与环境传感模块通信', parentId: 'feature-a', referenceIds: ['feature-b'], supportIds: ['para-0012', 'para-0031'] },
  { id: 'feature-d', claimId: 'claim-1', label: 'D · 调节微环境', text: '根据温湿度数据调节柜体微环境', parentId: null, referenceIds: ['feature-b', 'feature-c'], supportIds: ['para-0024', 'para-0040'] },
  { id: 'feature-e', claimId: 'claim-2', label: 'E · 对角线布置', text: '多个温湿度传感器沿柜体对角线布置', parentId: null, referenceIds: [], supportIds: ['para-0018'] },
  { id: 'feature-f', claimId: 'claim-3', label: 'F · 分级调节', text: '基于历史数据与当前数据的偏差分级调节除湿单元', parentId: null, referenceIds: [], supportIds: ['para-0024'] }
]

function seedState(): AppState {
  // —— 审查员一侧的既有意见（演示用时间线）——
  const t1 = '2026-09-20T02:00:00.000Z'
  const t2 = '2026-09-24T03:10:00.000Z'
  const t3 = '2026-09-24T03:40:00.000Z'
  const t4 = '2026-09-28T01:00:00.000Z'
  const t5 = '2026-09-28T01:20:00.000Z'
  const broughtAt = '2026-09-24T06:00:00.000Z'
  const oldBatch = 'batch-20260924'

  const review1: ReviewItem = {
    id: 'review-b-clarity', featureId: 'feature-b', featureLabel: 'B · 环境传感模块',
    // 审查确认时的 B 正文与代理人当前草稿不同
    featureText: '设置于柜体内，用于采集环境温湿度数据', supportIds: ['para-0012', 'para-0018'],
    kind: 'conclusion', decision: 'clarity',
    text: '“温湿度数据”含义不清楚，是否涵盖露点等派生数据，请在从属权利要求中进一步限定。',
    authorName: EXAMINER_NAME, createdAt: t1, updatedAt: t1, reviewedAt: t1
  }
  const review2: ReviewItem = {
    id: 'review-d-note', featureId: 'feature-d', featureLabel: 'D · 调节微环境',
    featureText: '根据温湿度数据调节柜体微环境', supportIds: ['para-0024', 'para-0040'],
    kind: 'annotation', text: '[0040] 与 [0024] 结合可支持调节方式，建议在意见陈述中说明二者对应关系。',
    authorName: EXAMINER_NAME, createdAt: t2, updatedAt: t2, reviewedAt: t2
  }
  const review3: ReviewItem = {
    id: 'review-g-support', featureId: 'feature-g', featureLabel: 'G · 通信周期',
    featureText: '通信链路以十秒至五分钟的周期传输数据', supportIds: ['para-0031'],
    kind: 'conclusion', decision: 'support',
    text: '该特征限定的传输周期在 [0031] 中仅为举例，作为必要技术特征时依据不充分。',
    authorName: EXAMINER_NAME, createdAt: t3, updatedAt: t3, reviewedAt: t3
  }
  const review4: ReviewItem = {
    id: 'review-a-note', featureId: 'feature-a', featureLabel: 'A · 柜体',
    featureText: '柜体', supportIds: ['para-0012'],
    kind: 'annotation', text: '请确认“柜体”是否包含柜门密封结构，以便核对封闭空间的表述。',
    authorName: EXAMINER_NAME, createdAt: t4, updatedAt: t4, reviewedAt: t4
  }
  const review5: ReviewItem = {
    id: 'review-c-clarity', featureId: 'feature-c', featureLabel: 'C · 控制模块通信',
    featureText: '与环境传感模块通信', supportIds: ['para-0012', 'para-0031'],
    kind: 'conclusion', decision: 'accepted',
    text: '通信关系在 [0012]、[0031] 中有明确记载，该特征暂予认可。',
    authorName: EXAMINER_NAME, createdAt: t5, updatedAt: t5, reviewedAt: t5
  }

  const key1 = reviewKey(review1)
  const key2 = reviewKey(review2)
  const key3 = reviewKey(review3)
  const key4 = reviewKey(review4)
  const key5 = reviewKey(review5)

  // —— 代理人一侧：上次带回后留存的批注/结论副本 ——
  const incomingSeed: IncomingReview[] = [
    {
      id: `incoming-${key1}`, key: key1, itemId: review1.id, featureId: 'feature-b',
      featureLabel: review1.featureLabel, featureText: review1.featureText, supportIds: review1.supportIds,
      kind: 'conclusion', text: review1.text, decision: review1.decision, authorName: EXAMINER_NAME,
      reviewedAt: review1.reviewedAt, broughtAt, batchId: oldBatch, state: 'stale'
    },
    {
      id: `incoming-${key2}`, key: key2, itemId: review2.id, featureId: 'feature-d',
      featureLabel: review2.featureLabel, featureText: review2.featureText, supportIds: review2.supportIds,
      kind: 'annotation', text: review2.text, authorName: EXAMINER_NAME,
      reviewedAt: review2.reviewedAt, broughtAt, batchId: oldBatch, state: 'active'
    },
    {
      id: `incoming-${key3}`, key: key3, itemId: review3.id, featureId: null,
      featureLabel: review3.featureLabel, featureText: review3.featureText, supportIds: review3.supportIds,
      kind: 'conclusion', text: review3.text, decision: review3.decision, authorName: EXAMINER_NAME,
      reviewedAt: review3.reviewedAt, broughtAt, batchId: oldBatch, state: 'suspended', suspendReason: 'feature-removed'
    }
  ]

  const author: AuthorWorkspace = {
    claims: initialClaims,
    paragraphs: initialParagraphs,
    features: initialFeatures,
    orphanMappings: [],
    versions: [],
    incoming: incomingSeed,
    appliedKeys: [key1, key2, key3],
    reports: [{
      id: 'report-20260924', batchId: oldBatch, at: broughtAt,
      activeCount: 1, staleCount: 1, suspendedCount: 1, skippedCount: 0,
      detail: '对账完成：1 条照旧有效，1 条结论因特征事后改动作废，1 条指向已撤下特征挂起等人定。'
    }]
  }

  // 审查员手里的特征副本停留在 09-21，B 的正文仍是旧版本
  const copyAt = '2026-09-21T08:00:00.000Z'
  const claimNumberOf = (claimId: string): number => initialClaims.find(claim => claim.id === claimId)?.number || 0
  const copyFeatures: ReviewCopyFeature[] = initialFeatures.map(feature => ({
    ...structuredClone(feature),
    claimNumber: claimNumberOf(feature.claimId),
    text: feature.id === 'feature-b' ? '设置于柜体内，用于采集环境温湿度数据' : feature.text,
    copiedAt: copyAt
  }))

  const examiner: ExaminerWorkspace = {
    copyFeatures,
    copyAt,
    items: [review1, review2, review3, review4, review5],
    outbox: [
      { id: key1, itemId: review1.id, batchId: oldBatch, queuedAt: t1, status: 'delivered', attempts: 1, lastError: null, deliveredAt: broughtAt },
      { id: key2, itemId: review2.id, batchId: oldBatch, queuedAt: t2, status: 'delivered', attempts: 1, lastError: null, deliveredAt: broughtAt },
      { id: key3, itemId: review3.id, batchId: oldBatch, queuedAt: t3, status: 'delivered', attempts: 1, lastError: null, deliveredAt: broughtAt },
      // 新一批：09-28 带回失败，等待从审查员一侧重试
      { id: key4, itemId: review4.id, batchId: '', queuedAt: t4, status: 'pending', attempts: 1, lastError: '带回失败：代理人工作台连接超时（模拟）。', deliveredAt: null },
      { id: key5, itemId: review5.id, batchId: '', queuedAt: t5, status: 'pending', attempts: 0, lastError: null, deliveredAt: null }
    ],
    syncLog: [
      { id: 'log-20260928', batchId: 'batch-20260928', at: '2026-09-28T01:30:00.000Z', ok: false, detail: '带回失败：代理人工作台连接超时（模拟），2 条意见未送达，可从本侧重试，已对上的不重复挂。' },
      { id: 'log-20260924', batchId: oldBatch, at: broughtAt, ok: true, detail: '带回成功：1 条有效，1 条结论作废，1 条挂起。' }
    ],
    nextBringBackFails: true
  }

  return {
    author, examiner,
    role: 'author', currentUserRole: 'author',
    selectedClaimId: 'claim-1', selectedFeatureId: 'feature-b', activeTab: 'mapping'
  }
}

function clone<T>(value: T): T { return structuredClone(value) }

@Injectable({ providedIn: 'root' })
export class WorkbenchService implements OnDestroy {
  private readonly initialState = this.loadState()
  private readonly stateSubject = new BehaviorSubject<AppState>(this.initialState)
  private readonly historySubject = new BehaviorSubject<{ past: number; future: number }>({ past: 0, future: 0 })
  private past: AppState[] = []
  private future: AppState[] = []

  readonly state$ = this.stateSubject.asObservable()
  readonly history$ = this.historySubject.asObservable()
  readonly state = this.stateSubject  // 模板里便于订阅
  readonly issues$ = this.state$.pipe(map(state => this.validate(state)))

  constructor() {
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => this.savePosition())
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', () => this.savePosition())
  }

  get snapshot(): AppState { return clone(this.stateSubject.value) }
  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }

  // —— 通用导航（不进撤销栈）——
  selectClaim(id: string): void {
    this.patchState(state => {
      state.selectedClaimId = id
      state.selectedFeatureId = state.author.features.find(feature => feature.claimId === id)?.id || null
    })
    this.savePosition()
  }

  selectFeature(id: string | null): void {
    this.patchState(state => { state.selectedFeatureId = id })
    this.savePosition()
  }

  setRole(role: Role): void {
    this.patchState(state => { state.role = role; state.currentUserRole = role })
  }

  setTab(tab: string): void {
    this.patchState(state => { state.activeTab = tab })
    this.savePosition()
  }

  setSimulateFailure(value: boolean): void {
    if (this.stateSubject.value.role !== 'examiner') return
    this.patchState(state => { state.examiner.nextBringBackFails = value })
  }

  // —— 代理人一侧：权利要求 / 段落 / 技术特征 / 层级 / 引用 / 支持段落 ——
  updateClaim(patch: Partial<Claim>): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      const claim = state.author.claims.find(item => item.id === state.selectedClaimId)
      if (claim) Object.assign(claim, patch)
    })
  }

  addClaim(): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      const number = Math.max(0, ...state.author.claims.map(claim => claim.number)) + 1
      const claim: Claim = { id: `claim-${Date.now()}`, number, title: `权利要求 ${number}`, independent: false, text: '请录入权利要求正文。' }
      state.author.claims.push(claim)
      state.selectedClaimId = claim.id
      state.selectedFeatureId = null
    })
  }

  addParagraph(): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      const next = state.author.paragraphs.length + 1
      state.author.paragraphs.push({ id: `para-${Date.now()}`, section: `说明书 [${String(next * 5).padStart(4, '0')}]`, text: '' })
    })
  }

  updateParagraph(id: string, patch: Partial<Paragraph>): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      const paragraph = state.author.paragraphs.find(item => item.id === id)
      if (paragraph) Object.assign(paragraph, patch)
    })
  }

  deleteParagraph(id: string): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      state.author.paragraphs = state.author.paragraphs.filter(item => item.id !== id)
      state.author.features.forEach(feature => { feature.supportIds = feature.supportIds.filter(paragraphId => paragraphId !== id) })
      state.author.orphanMappings = state.author.orphanMappings.filter(item => item.paragraphId !== id)
    })
  }

  addFeature(): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      const feature: Feature = {
        id: `feature-${Date.now()}`, claimId: state.selectedClaimId,
        label: `新特征 ${state.author.features.filter(item => item.claimId === state.selectedClaimId).length + 1}`,
        text: '', parentId: null, referenceIds: [], supportIds: []
      }
      state.author.features.push(feature)
      state.selectedFeatureId = feature.id
    })
  }

  updateFeature(id: string, patch: Partial<Feature>): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      const feature = state.author.features.find(item => item.id === id)
      if (feature) Object.assign(feature, patch)
    })
  }

  deleteFeature(id: string): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      const feature = state.author.features.find(item => item.id === id)
      if (!feature) return
      feature.supportIds.forEach(paragraphId => state.author.orphanMappings.push({
        id: `orphan-${Date.now()}-${paragraphId}`, featureLabel: feature.label, paragraphId,
        reason: `技术特征“${feature.label}”已删除，但支持段落映射仍被保留。`
      }))
      state.author.features = state.author.features.filter(item => item.id !== id)
      state.author.features.forEach(item => {
        item.referenceIds = item.referenceIds.filter(refId => refId !== id)
        if (item.parentId === id) item.parentId = null
      })
      // 旧批注/旧结论都留着；指向已撤下特征的改挂“挂起等人定”，不删数据
      state.author.incoming.forEach(review => {
        if ((review.state === 'active' || review.state === 'stale') && review.featureId === id) {
          review.state = 'suspended'
          review.suspendReason = 'feature-removed'
          review.featureId = null
        }
      })
      state.selectedFeatureId = state.author.features.find(item => item.claimId === state.selectedClaimId)?.id || null
    })
  }

  toggleParagraphMapping(featureId: string, paragraphId: string): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      const feature = state.author.features.find(item => item.id === featureId)
      if (!feature) return
      const index = feature.supportIds.indexOf(paragraphId)
      if (index >= 0) feature.supportIds.splice(index, 1)
      else feature.supportIds.push(paragraphId)
      state.author.orphanMappings = state.author.orphanMappings.filter(item => item.paragraphId !== paragraphId)
    })
  }

  clearOrphan(id: string): void {
    if (!this.isAuthor()) return
    this.commit(state => { state.author.orphanMappings = state.author.orphanMappings.filter(item => item.id !== id) })
  }

  createVersion(name?: string): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      state.author.versions.unshift({
        id: `version-${Date.now()}`, name: name?.trim() || `快照 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        createdAt: new Date().toISOString(), claims: clone(state.author.claims), features: clone(state.author.features)
      })
    })
  }

  restoreVersion(id: string): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      const version = state.author.versions.find(item => item.id === id)
      if (!version) return
      state.author.claims = clone(version.claims)
      state.author.features = clone(version.features)
      if (!state.author.claims.some(claim => claim.id === state.selectedClaimId)) state.selectedClaimId = state.author.claims[0]?.id || ''
      state.selectedFeatureId = state.author.features.find(feature => feature.claimId === state.selectedClaimId)?.id || null
      // 恢复后指向缺失特征的有效意见同样转挂起（旧记录保留）
      const liveIds = new Set(state.author.features.map(feature => feature.id))
      state.author.incoming.forEach(review => {
        if ((review.state === 'active' || review.state === 'stale') && review.featureId && !liveIds.has(review.featureId)) {
          review.state = 'suspended'
          review.suspendReason = 'feature-removed'
          review.featureId = null
        }
      })
    })
  }

  // —— 代理人一侧：人工处理挂起 ——
  resolveSuspendedAttach(incomingId: string, featureId: string): void {
    if (!this.isAuthor() || !featureId) return
    this.commit(state => {
      const review = state.author.incoming.find(item => item.id === incomingId)
      const target = state.author.features.find(feature => feature.id === featureId)
      if (!review || !target || review.state !== 'suspended') return
      review.state = 'active'
      review.featureId = target.id
      review.resolvedFeatureId = target.id
      review.suspendReason = undefined
    })
  }

  resolveSuspendedDiscard(incomingId: string): void {
    if (!this.isAuthor()) return
    this.commit(state => {
      // 只摘掉挂起副本；幂等键保留，旧版本重试不会重复挂
      state.author.incoming = state.author.incoming.filter(item => item.id !== incomingId)
    })
  }

  // —— 审查员一侧：拉取代理人最新草稿（只读副本）——
  pullReviewCopy(): { ok: boolean; detail: string } {
    if (!this.isExaminer()) return { ok: false, detail: '仅审查员可拉取代理人草稿。' }
    const at = new Date().toISOString()
    let changed = 0
    this.commit(state => {
      const beforeIds = new Set(state.examiner.copyFeatures.map(feature => feature.id))
      const before = new Map(state.examiner.copyFeatures.map(feature => [feature.id, feature]))
      const claimNumberOf = (claimId: string): number => state.author.claims.find(claim => claim.id === claimId)?.number || 0
      const next: ReviewCopyFeature[] = state.author.features.map(feature => {
        const previous = before.get(feature.id)
        if (previous && copyFingerprintOf(previous) !== featureFingerprintOf(feature)) changed += 1
        return { ...clone(feature), claimNumber: claimNumberOf(feature.claimId), copiedAt: at }
      })
      changed += state.examiner.copyFeatures.filter(feature => !beforeIds.has(feature.id)).length
      state.examiner.copyFeatures = next
      state.examiner.copyAt = at
    })
    return { ok: true, detail: `已拉取代理人最新草稿：${changed} 个特征正文或支持段落有变化。` }
  }

  // —— 审查员一侧：批注与每条特征的审查结论 ——
  saveReviewItem(input: { id?: string; featureId: string; kind: ReviewKind; text: string; decision?: ReviewDecision }): { ok: boolean; detail: string } {
    if (!this.isExaminer()) return { ok: false, detail: '仅审查员可编写批注与审查结论。' }
    const trimmed = input.text.trim()
    if (!trimmed) return { ok: false, detail: '内容不能为空。' }
    const state = this.snapshot
    const copy = state.examiner.copyFeatures.find(feature => feature.id === input.featureId)
    if (!copy) return { ok: false, detail: '副本中找不到该特征，请先重新拉取代理人草稿。' }

    const now = new Date().toISOString()
    const existing = input.id ? state.examiner.items.find(item => item.id === input.id) : undefined
    const item: ReviewItem = existing
      ? { ...existing, text: trimmed, decision: input.kind === 'conclusion' ? input.decision : undefined, featureLabel: copy.label, featureText: copy.text, supportIds: [...copy.supportIds], updatedAt: now, reviewedAt: now }
      : {
          id: `review-${Date.now()}`, featureId: copy.id, featureLabel: copy.label, featureText: copy.text,
          supportIds: [...copy.supportIds], kind: input.kind, text: trimmed,
          decision: input.kind === 'conclusion' ? input.decision : undefined,
          authorName: EXAMINER_NAME, createdAt: now, updatedAt: now, reviewedAt: now
        }

    let detail: string
    this.commit(next => {
      const index = next.examiner.items.findIndex(entry => entry.id === item.id)
      if (index >= 0) next.examiner.items[index] = item
      else next.examiner.items.push(item)
      this.queueOrReplace(next.examiner, item)
      detail = existing ? '审查意见已更新，新版本已进入发件箱，等待带回代理人一侧。' : '审查意见已进入发件箱，等待带回代理人一侧。'
    })
    return { ok: true, detail: detail! }
  }

  deleteReviewItem(id: string): void {
    if (!this.isExaminer()) return
    this.commit(state => {
      state.examiner.items = state.examiner.items.filter(item => item.id !== id)
      // 仅撤回尚未送达的版本；送达记录保留在同步日志里
      state.examiner.outbox = state.examiner.outbox.filter(entry => !(entry.itemId === id && entry.status === 'pending'))
    })
  }

  /** 结论作废后，审查员依据最新副本重新确认（正文未改也可确认） */
  reconfirmConclusion(itemId: string): { ok: boolean; detail: string } {
    if (!this.isExaminer()) return { ok: false, detail: '仅审查员可重新确认结论。' }
    const state = this.snapshot
    const item = state.examiner.items.find(entry => entry.id === itemId && entry.kind === 'conclusion')
    if (!item) return { ok: false, detail: '找不到该审查结论。' }
    const copy = state.examiner.copyFeatures.find(feature => feature.id === item.featureId)
    if (!copy) return { ok: false, detail: '该特征已不在代理人草稿中，无法按原特征重新确认；请挂接到现有特征后再确认。' }
    const now = new Date().toISOString()
    const reconfirmed: ReviewItem = { ...item, featureLabel: copy.label, featureText: copy.text, supportIds: [...copy.supportIds], updatedAt: now, reviewedAt: now }
    this.commit(next => {
      const index = next.examiner.items.findIndex(entry => entry.id === itemId)
      next.examiner.items[index] = reconfirmed
      this.queueOrReplace(next.examiner, reconfirmed)
    })
    return { ok: true, detail: '结论已按最新特征正文与支持段落重新确认，等待带回。' }
  }

  /** 审查员一侧执行带回；失败时不动代理人数据，仅记录失败，允许重试 */
  bringBack(): { ok: boolean; detail: string } {
    if (!this.isExaminer()) return { ok: false, detail: '仅审查员可执行带回。' }
    const pending = this.snapshot.examiner.outbox.filter(entry => entry.status === 'pending')
    if (!pending.length) return { ok: false, detail: '发件箱为空，没有待带回的审查意见。' }

    const now = new Date().toISOString()
    if (this.snapshot.examiner.nextBringBackFails) {
      this.commit(state => {
        state.examiner.outbox.forEach(entry => {
          if (entry.status === 'pending') { entry.attempts += 1; entry.lastError = '带回失败：代理人工作台连接超时（模拟）。' }
        })
        state.examiner.syncLog.unshift({
          id: `log-${Date.now()}`, batchId: `batch-attempt-${Date.now()}`, at: now, ok: false,
          detail: `带回失败：${pending.length} 条意见未送达。代理人草稿与旧结论均未改动，可从审查员一侧重试，已对上的不重复挂。`
        })
      })
      return { ok: false, detail: '带回失败：代理人工作台连接超时（模拟）。代理人一侧数据未改动，可重试。' }
    }

    const current = this.snapshot
    const items = pending
      .map(entry => current.examiner.items.find(item => item.id === entry.itemId))
      .filter((item): item is ReviewItem => !!item)
    const batchId = `batch-${Date.now()}`
    const result = reconcileBringBack({
      items,
      outbox: current.examiner.outbox,
      features: current.author.features,
      appliedKeys: current.author.appliedKeys,
      batchId,
      at: now
    })

    this.commit(state => {
      const delivered = new Set(result.deliveredEntryIds)
      state.examiner.outbox.forEach(entry => {
        if (entry.status === 'pending') {
          entry.attempts += 1
          if (delivered.has(entry.id)) {
            entry.status = 'delivered'
            entry.batchId = batchId
            entry.deliveredAt = now
            entry.lastError = null
          }
        }
      })
      // 合并到代理人一侧：同一条意见的新版本生效时，旧的有效/作废副本标记为被取代（历史保留）
      result.incoming.forEach(incoming => {
        if (incoming.state === 'active') {
          state.author.incoming.forEach(previous => {
            if (previous.itemId === incoming.itemId && previous.state !== 'superseded') previous.state = 'superseded'
          })
        }
        state.author.incoming.push(incoming)
      })
      state.author.appliedKeys = result.appliedKeys
      const { activeCount, staleCount, suspendedCount, skippedCount } = result.report
      state.author.reports.unshift({
        id: `report-${Date.now()}`, batchId, at: now, activeCount, staleCount, suspendedCount, skippedCount,
        detail: `对账完成：${activeCount} 条照旧有效，${staleCount} 条因特征事后改动作废待重新确认，${suspendedCount} 条挂起等人定，${skippedCount} 条已对上跳过。`
      })
      state.examiner.syncLog.unshift({
        id: `log-${Date.now()}`, batchId, at: now, ok: true,
        detail: `带回成功：${activeCount} 条有效，${staleCount} 条作废待确认，${suspendedCount} 条挂起，${skippedCount} 条幂等跳过。`
      })
    })
    const { activeCount, staleCount, suspendedCount, skippedCount } = result.report
    return {
      ok: true,
      detail: `带回成功：${activeCount} 条有效，${staleCount} 条作废待重新确认，${suspendedCount} 条挂起等人定，${skippedCount} 条已对上跳过。`
    }
  }

  // —— 撤销/重做：两侧状态一起进历史，任一侧都可撤销 ——
  undo(): void {
    const previous = this.past.pop()
    if (!previous) return
    this.future.push(clone(this.stateSubject.value))
    this.stateSubject.next(previous)
    this.updateHistory()
    this.saveState()
  }

  redo(): void {
    const next = this.future.pop()
    if (!next) return
    this.past.push(clone(this.stateSubject.value))
    this.stateSubject.next(next)
    this.updateHistory()
    this.saveState()
  }

  savePosition(): void {
    if (typeof localStorage === 'undefined') return
    const state = this.stateSubject.value
    const position: Position = { tab: state.activeTab, claimId: state.selectedClaimId, featureId: state.selectedFeatureId, scrollY: window.scrollY }
    localStorage.setItem(POSITION_KEY, JSON.stringify(position))
    this.saveState()
  }

  readPosition(): Position {
    const fallback: Position = { tab: this.initialState.activeTab, claimId: this.initialState.selectedClaimId, featureId: this.initialState.selectedFeatureId, scrollY: 0 }
    if (typeof localStorage === 'undefined') return fallback
    try { return { ...fallback, ...JSON.parse(localStorage.getItem(POSITION_KEY) || '{}') } } catch { return fallback }
  }

  exportJson(): string {
    return JSON.stringify({ ...this.snapshot, validationIssues: this.validate(this.stateSubject.value) }, null, 2)
  }

  exportCsv(): string {
    const state = this.stateSubject.value
    const rows = state.author.features.map(feature => {
      const latestConclusion = this.latestIncoming(state, review => review.featureId === feature.id && review.kind === 'conclusion')
      return [
        state.author.claims.find(claim => claim.id === feature.claimId)?.number || '', feature.label, feature.text,
        state.author.features.find(item => item.id === feature.parentId)?.label || '',
        feature.referenceIds.map(id => state.author.features.find(item => item.id === id)?.label || id).join('；'),
        feature.supportIds.map(id => state.author.paragraphs.find(item => item.id === id)?.section || id).join('；'),
        latestConclusion ? this.decisionLabel(latestConclusion.decision) : '',
        latestConclusion?.text || ''
      ]
    })
    const csv = [['权利要求', '技术特征', '特征内容', '父级特征', '引用特征', '支持段落', '审查结论', '结论说明'], ...rows]
      .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')
    return `﻿${csv}`
  }

  // —— 对账派生：作废状态一经识别即粘住，须审查员重新确认后带回新版本才解除 ——
  effectiveState(review: IncomingReview, features: Feature[] = this.stateSubject.value.author.features): IncomingReview['state'] {
    if (review.state === 'superseded') return 'superseded'
    if (review.state === 'suspended' || !review.featureId) return 'suspended'
    if (!features.some(item => item.id === review.featureId)) return 'suspended'
    return review.state === 'stale' ? 'stale' : 'active'
  }

  /** 批注快照与当前正文/段落不一致但未达结论作废程度时，提示“所指内容已有改动” */
  isDrift(review: IncomingReview, features: Feature[] = this.stateSubject.value.author.features): boolean {
    if (review.kind !== 'annotation' || !review.featureId) return false
    const feature = features.find(item => item.id === review.featureId)
    if (!feature) return false
    return featureFingerprint(feature.text, feature.supportIds) !== featureFingerprint(review.featureText, review.supportIds)
  }

  /** 审查员副本相对意见快照的变化：changed / removed / null */
  copyStatus(item: ReviewItem): 'changed' | 'removed' | null {
    const copy = this.stateSubject.value.examiner.copyFeatures.find(feature => feature.id === item.featureId)
    if (!copy) return 'removed'
    return copyFingerprintOf(copy) !== featureFingerprint(item.featureText, item.supportIds) ? 'changed' : null
  }

  /**
   * 审查结论是否需要重新确认：
   * 1) 最新副本的正文/段落与确认快照不一致；或
   * 2) 代理人一侧该意见的最新带回版本已被作废（即使代理人后来把正文改回原样，作废也粘住）。
   * 若审查员已另编新版本且尚在发件箱待带回，则不再提示。
   */
  needsReconfirm(item: ReviewItem): boolean {
    if (item.kind !== 'conclusion') return false
    const state = this.stateSubject.value
    if (state.examiner.outbox.some(entry => entry.itemId === item.id && entry.status === 'pending')) return false
    const status = this.copyStatus(item)
    if (status === 'changed') return true
    if (status === 'removed') return false
    const latest = this.latestIncoming(state, review => review.itemId === item.id)
    return !!latest && this.effectiveState(latest, state.author.features) === 'stale'
  }

  latestIncoming(state: AppState, predicate: (review: IncomingReview) => boolean): IncomingReview | undefined {
    const matches = state.author.incoming.filter(predicate)
    if (!matches.length) return undefined
    return [...matches].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))[0]
  }

  decisionLabel(decision?: ReviewDecision): string {
    const labels: Record<ReviewDecision, string> = {
      accepted: '认可', novelty: '新颖性', inventiveness: '创造性', clarity: '清楚性', support: '说明书支持'
    }
    return decision ? labels[decision] : ''
  }

  validate(state = this.stateSubject.value): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    for (const feature of state.author.features) {
      if (!feature.text.trim()) issues.push({ id: `empty-${feature.id}`, severity: 'warning', type: 'empty-feature', featureId: feature.id, title: `${feature.label} 内容为空`, detail: '请补全技术特征文字，避免映射对象不明确。' })
      if (!feature.supportIds.length) issues.push({ id: `support-${feature.id}`, severity: 'error', type: 'missing-support', featureId: feature.id, title: `${feature.label} 缺少说明书依据`, detail: '至少为一个说明书段落建立支持映射。' })
      if (this.hasReferenceCycle(feature, state.author.features)) issues.push({ id: `cycle-${feature.id}`, severity: 'error', type: 'cycle', featureId: feature.id, title: `${feature.label} 存在循环引用`, detail: '特征层级或引用关系形成闭环，请移除其中一条关系。' })
    }
    state.author.orphanMappings.forEach(item => issues.push({ id: item.id, severity: 'warning', type: 'orphan-mapping', title: '存在待清理映射', detail: `${item.reason}（${item.paragraphId}）` }))

    // 同一条意见只提示一次最新状态
    const byItem = new Map<string, IncomingReview>()
    state.author.incoming.forEach(review => {
      const effective = this.effectiveState(review, state.author.features)
      if (effective === 'superseded') return
      const current = byItem.get(review.itemId)
      if (!current || review.reviewedAt > current.reviewedAt) byItem.set(review.itemId, review)
    })
    byItem.forEach(review => {
      const effective = this.effectiveState(review, state.author.features)
      if (effective === 'stale' && review.kind === 'conclusion') {
        issues.push({
          id: `stale-${review.itemId}`, severity: 'warning', type: 'stale-conclusion', featureId: review.featureId || undefined,
          title: `${review.featureLabel} 的审查结论已作废`,
          detail: '该特征在审查结论确认之后又被修改（正文或支持段落），结论暂停适用，等待审查员重新确认。'
        })
      } else if (effective === 'suspended') {
        issues.push({
          id: `suspended-${review.itemId}`, severity: 'warning', type: 'review-suspended',
          title: `${review.featureLabel} 的${review.kind === 'conclusion' ? '审查结论' : '批注'}待人工对账`,
          detail: review.suspendReason === 'relink-ambiguous' ? '存在多个内容一致的候选特征，已挂起，请人工指定归属。' : '指向的特征已撤下或无法对上，已挂起，请人工挂接或丢弃。'
        })
      }
    })
    return issues
  }

  private hasReferenceCycle(start: Feature, features: Feature[]): boolean {
    const visited = new Set<string>()
    const visit = (id: string): boolean => {
      if (id === start.id && visited.size > 0) return true
      if (visited.has(id)) return false
      visited.add(id)
      const feature = features.find(item => item.id === id)
      if (!feature) return false
      if (feature.parentId && visit(feature.parentId)) return true
      return feature.referenceIds.some(visit)
    }
    return visit(start.id)
  }

  /** 同一意见版本在发件箱中至多一条待发记录；重新编辑产生新键，旧键送达后保留 */
  private queueOrReplace(examiner: ExaminerWorkspace, item: ReviewItem): void {
    const key = reviewKey(item)
    examiner.outbox = examiner.outbox.filter(entry => !(entry.status === 'pending' && entry.itemId === item.id))
    if (!examiner.outbox.some(entry => entry.id === key)) {
      examiner.outbox.push({
        id: key, itemId: item.id, batchId: '', queuedAt: new Date().toISOString(),
        status: 'pending', attempts: 0, lastError: null, deliveredAt: null
      })
    }
  }

  private isAuthor(): boolean { return this.stateSubject.value.role === 'author' }
  private isExaminer(): boolean { return this.stateSubject.value.role === 'examiner' }

  private commit(recipe: (state: AppState) => void): void {
    const current = clone(this.stateSubject.value)
    const next = clone(current)
    recipe(next)
    // 代理人在结论确认之后又改动特征正文/支持段落：审查结论当场作废并粘住，
    // 代理人随后撤回改动也不复活，只能等审查员重新确认后带回新版本。
    next.author.incoming.forEach(review => {
      if (review.state !== 'active' || !review.featureId || review.kind !== 'conclusion') return
      const feature = next.author.features.find(item => item.id === review.featureId)
      if (feature && featureFingerprint(feature.text, feature.supportIds) !== featureFingerprint(review.featureText, review.supportIds)) {
        review.state = 'stale'
      }
    })
    this.past.push(current)
    if (this.past.length > 60) this.past.shift()
    this.future = []
    this.stateSubject.next(next)
    this.updateHistory()
    this.saveState()
  }

  private patchState(recipe: (state: AppState) => void): void {
    const next = clone(this.stateSubject.value)
    recipe(next)
    this.stateSubject.next(next)
    this.saveState()
  }

  private updateHistory(): void { this.historySubject.next({ past: this.past.length, future: this.future.length }) }
  private saveState(): void { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stateSubject.value)) }
  private loadState(): AppState {
    if (typeof localStorage === 'undefined') return seedState()
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return seedState()
      // 合并默认值，兼容后续新增字段
      return { ...seedState(), ...JSON.parse(stored) }
    } catch { return seedState() }
  }
}
