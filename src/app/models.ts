export type Role = 'author' | 'examiner' | 'viewer'

/** 审查结论类型（审查员持有） */
export type ReviewDecision = 'accepted' | 'novelty' | 'inventiveness' | 'clarity' | 'support'

export type ReviewKind = 'annotation' | 'conclusion'

/** 对账后审查意见在代理人一侧的状态 */
export type ReviewState = 'active' | 'stale' | 'suspended' | 'superseded'

/** 挂起原因：指向特征已撤下 / 存在多个疑似特征无法自动对回 */
export type SuspendReason = 'feature-removed' | 'relink-ambiguous'

export interface Claim {
  id: string
  number: number
  title: string
  text: string
  independent: boolean
}

export interface Paragraph {
  id: string
  section: string
  text: string
}

/** 技术特征：仅代理人持有与编辑（含层级、引用、支持段落） */
export interface Feature {
  id: string
  claimId: string
  label: string
  text: string
  parentId: string | null
  referenceIds: string[]
  supportIds: string[]
}

export interface OrphanMapping {
  id: string
  featureLabel: string
  paragraphId: string
  reason: string
}

export interface ClaimVersion {
  id: string
  name: string
  createdAt: string
  claims: Claim[]
  features: Feature[]
}

/**
 * 审查意见单元（批注或每条特征的审查结论），审查员一侧持有。
 * featureText / supportIds 是审查确认时的快照，
 * 带回代理人一侧时按“特征正文 + 指向段落”对账。
 */
export interface ReviewItem {
  id: string
  featureId: string
  featureLabel: string
  featureText: string
  supportIds: string[]
  kind: ReviewKind
  text: string
  decision?: ReviewDecision
  authorName: string
  createdAt: string
  updatedAt: string
  /** 审查确认时间；内容每次改动都会推进，由此生成幂等键 */
  reviewedAt: string
}

/** 审查员从代理人一侧拉取的只读特征副本 */
export interface ReviewCopyFeature {
  id: string
  claimId: string
  claimNumber: number
  label: string
  text: string
  parentId: string | null
  referenceIds: string[]
  supportIds: string[]
  copiedAt: string
}

export type OutboxStatus = 'pending' | 'delivered'

/** 审查员一侧的发件记录：一条审查意见的某个版本至多一条 */
export interface OutboxEntry {
  /** 幂等键，等于 reviewKey(item) */
  id: string
  itemId: string
  batchId: string
  queuedAt: string
  status: OutboxStatus
  attempts: number
  lastError: string | null
  deliveredAt: string | null
}

export interface ReviewSyncLog {
  id: string
  batchId: string
  at: string
  ok: boolean
  detail: string
}

/** 带回后挂在代理人一侧的审查意见副本，代理人不能改其内容 */
export interface IncomingReview {
  id: string
  /** 幂等键：意见 id @ 审查确认时间，已对上的键不会重复挂 */
  key: string
  itemId: string
  /** 对账后实际归属的特征；挂起等待人工处理时为 null */
  featureId: string | null
  featureLabel: string
  featureText: string
  supportIds: string[]
  kind: ReviewKind
  text: string
  decision?: ReviewDecision
  authorName: string
  reviewedAt: string
  broughtAt: string
  batchId: string
  state: ReviewState
  suspendReason?: SuspendReason
  /** 人工挂接时选定的特征 */
  resolvedFeatureId?: string
  /** 批注快照与当前特征正文/段落不一致（结论不一致则直接 stale 作废） */
  drift?: boolean
}

export interface ReconcileReport {
  id: string
  batchId: string
  at: string
  activeCount: number
  staleCount: number
  suspendedCount: number
  skippedCount: number
  detail: string
}

/** 代理人工作台：技术特征、层级、引用、支持段落全部归这一侧 */
export interface AuthorWorkspace {
  claims: Claim[]
  paragraphs: Paragraph[]
  features: Feature[]
  orphanMappings: OrphanMapping[]
  versions: ClaimVersion[]
  /** 审查员带回、对账后落在本侧的批注与结论 */
  incoming: IncomingReview[]
  /** 已经对上账的幂等键，重试时跳过，不重复挂 */
  appliedKeys: string[]
  reports: ReconcileReport[]
}

/** 审查员工作台：只持有副本、批注、结论与带回通道 */
export interface ExaminerWorkspace {
  copyFeatures: ReviewCopyFeature[]
  copyAt: string | null
  items: ReviewItem[]
  outbox: OutboxEntry[]
  syncLog: ReviewSyncLog[]
  /** 演示用：下一次带回按失败处理，随后从审查员一侧重试 */
  nextBringBackFails: boolean
}

export interface Position {
  tab: string
  claimId: string
  featureId: string | null
  scrollY: number
}

export interface AppState {
  author: AuthorWorkspace
  examiner: ExaminerWorkspace
  role: Role
  currentUserRole: Role
  selectedClaimId: string
  selectedFeatureId: string | null
  activeTab: string
}

export interface ValidationIssue {
  id: string
  severity: 'error' | 'warning'
  type: 'cycle' | 'missing-support' | 'orphan-mapping' | 'empty-feature' | 'stale-conclusion' | 'review-suspended'
  featureId?: string
  title: string
  detail: string
}
