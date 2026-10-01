export type Role = 'author' | 'examiner' | 'viewer'

/** 每条特征的审查结论：通过 / 不通过 / 需修改 */
export type ReviewConclusion = 'approved' | 'rejected' | 'amended'

/** 审查员侧条目的对账状态 */
export type ExaminerItemStatus = 'pending' | 'matched' | 'void' | 'suspended'

/** 带回后写入代理人侧的结论状态：已确认 / 已作废（待审查员重新确认） */
export type ReviewStatus = 'confirmed' | 'void'

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

export interface Feature {
  id: string
  claimId: string
  label: string
  text: string
  parentId: string | null
  referenceIds: string[]
  supportIds: string[]
  ownerRole: Role
  /** 内容（正文、名称、层级、引用、支持段落）最后改动时间，用于判断结论是否在作出后被改动 */
  updatedAt: string
}

export interface Annotation {
  id: string
  featureId: string
  authorRole: Role
  authorName: string
  text: string
  updatedAt: string
  /** 由审查员带回的批注标记来源条目，避免重试或重复带回时重复挂接 */
  originItemId?: string
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

export interface Position {
  tab: string
  claimId: string
  featureId: string | null
  scrollY: number
}

/** 审查员领取快照时的特征副本：审查员在自己的副本上写结论，不动代理人的特征草稿 */
export interface ExaminerSnapshotFeature {
  id: string
  claimId: string
  claimNumber: number
  label: string
  text: string
  parentId: string | null
  referenceIds: string[]
  supportIds: string[]
  /** 指向段落的编号快照，对账时按正文 + 指向段落匹配，不依赖特征 id */
  supportSections: string[]
}

/** 审查员侧持有的一条批注/结论 */
export interface ExaminerItem {
  id: string
  snapshotFeatureId: string
  featureLabelSnapshot: string
  featureTextSnapshot: string
  /** 结论作出时指向的段落编号快照 */
  paragraphSectionSnapshot: string | null
  paragraphTextSnippet: string | null
  text: string
  conclusion: ReviewConclusion | null
  /** 结论作出时间：特征在此之后改动的，结论作废 */
  concludedAt: string
  status: ExaminerItemStatus
  matchedFeatureId: string | null
  matchedAt: string | null
}

/** 带回代理人侧的审查结论记录：与特征草稿分开持有，代理人整理特征不会带走或冲掉它 */
export interface ReviewRecord {
  featureId: string
  featureLabelSnapshot: string
  status: ReviewStatus
  conclusion: ReviewConclusion
  annotationText: string
  originItemId: string
  concludedAt: string
  appliedAt: string
}

/** 审查员各自持有的状态：快照副本 + 条目 */
export interface ExaminerState {
  snapshotAt: string | null
  snapshotFeatures: ExaminerSnapshotFeature[]
  items: ExaminerItem[]
}

export interface BringBackResult {
  applied: number
  voided: number
  suspended: number
  pending: number
  /** 带回中途失败：已应用的结论保留，未处理的条目保持待处理，可重试且不重复挂起 */
  failed: boolean
}

export interface WorkbenchState {
  claims: Claim[]
  paragraphs: Paragraph[]
  features: Feature[]
  annotations: Annotation[]
  /** 审查员带回的结论记录，与特征草稿分开持有 */
  reviewRecords: ReviewRecord[]
  /** 审查员侧状态：快照与条目，和代理人的特征草稿各自独立 */
  examiner: ExaminerState
  orphanMappings: OrphanMapping[]
  versions: ClaimVersion[]
  role: Role
  selectedClaimId: string
  selectedFeatureId: string | null
  activeTab: string
  currentUserRole: Role
}

export interface ValidationIssue {
  id: string
  severity: 'error' | 'warning'
  type: 'cycle' | 'missing-support' | 'orphan-mapping' | 'empty-feature'
  featureId?: string
  title: string
  detail: string
}
