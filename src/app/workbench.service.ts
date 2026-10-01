import { Injectable, OnDestroy } from '@angular/core'
import { BehaviorSubject, map, type Observable } from 'rxjs'
import type {
  Annotation, BringBackResult, Claim, ClaimVersion, ExaminerItem, ExaminerItemStatus, ExaminerState,
  ExaminerSnapshotFeature, Feature, Paragraph, Position, ReviewRecord, Role,
  ValidationIssue, WorkbenchState
} from './models'

const STORAGE_KEY = 'patent-claim-mapping-workbench-v1'
const POSITION_KEY = 'patent-claim-mapping-position-v1'
/** 种子数据的统一时间锚点：特征最后改动早于结论作出时间，保证初始结论有效 */
const SEED_FEATURE_TIME = '2026-09-20T00:00:00.000Z'

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
  { id: 'feature-a', claimId: 'claim-1', label: 'A · 柜体', text: '柜体', parentId: null, referenceIds: [], supportIds: ['para-0012'], ownerRole: 'author', updatedAt: SEED_FEATURE_TIME },
  { id: 'feature-b', claimId: 'claim-1', label: 'B · 环境传感模块', text: '设置于柜体内，用于采集温湿度数据', parentId: 'feature-a', referenceIds: [], supportIds: ['para-0012', 'para-0018'], ownerRole: 'author', updatedAt: SEED_FEATURE_TIME },
  { id: 'feature-c', claimId: 'claim-1', label: 'C · 控制模块通信', text: '与环境传感模块通信', parentId: 'feature-a', referenceIds: ['feature-b'], supportIds: ['para-0012', 'para-0031'], ownerRole: 'author', updatedAt: SEED_FEATURE_TIME },
  { id: 'feature-d', claimId: 'claim-1', label: 'D · 调节微环境', text: '根据温湿度数据调节柜体微环境', parentId: null, referenceIds: ['feature-b', 'feature-c'], supportIds: ['para-0024', 'para-0040'], ownerRole: 'author', updatedAt: SEED_FEATURE_TIME },
  { id: 'feature-e', claimId: 'claim-2', label: 'E · 对角线布置', text: '多个温湿度传感器沿柜体对角线布置', parentId: null, referenceIds: [], supportIds: ['para-0018'], ownerRole: 'author', updatedAt: SEED_FEATURE_TIME },
  { id: 'feature-f', claimId: 'claim-3', label: 'F · 分级调节', text: '基于历史数据与当前数据的偏差分级调节除湿单元', parentId: null, referenceIds: [], supportIds: ['para-0024'], ownerRole: 'author', updatedAt: SEED_FEATURE_TIME }
]
const initialAnnotations: Annotation[] = [
  { id: 'annotation-1', featureId: 'feature-b', authorRole: 'examiner', authorName: '审查员 · 李岚', text: '“温湿度数据”是否包括露点等派生数据？建议在从属权利要求中限定。', updatedAt: '2026-09-22T03:10:00.000Z', originItemId: 'exam-item-1' },
  { id: 'annotation-2', featureId: 'feature-d', authorRole: 'author', authorName: '代理人 · 陈昊', text: '[0024] 已支持分级调节，发布前补充除湿单元与通信模块的连接关系。', updatedAt: '2026-09-24T04:05:00.000Z' }
]

/** 审查员侧快照：审查员在自己的副本上写结论，与代理人的特征草稿各自独立 */
function buildSnapshot(): ExaminerSnapshotFeature[] {
  return initialFeatures.map(feature => {
    const claim = initialClaims.find(item => item.id === feature.claimId)
    return {
      id: feature.id,
      claimId: feature.claimId,
      claimNumber: claim?.number || 0,
      label: feature.label,
      text: feature.text,
      parentId: feature.parentId,
      referenceIds: [...feature.referenceIds],
      supportIds: [...feature.supportIds],
      supportSections: feature.supportIds.map(id => initialParagraphs.find(paragraph => paragraph.id === id)?.section || id)
    }
  })
}

const initialExaminerItems: ExaminerItem[] = [
  {
    id: 'exam-item-1', snapshotFeatureId: 'feature-b', featureLabelSnapshot: 'B · 环境传感模块',
    featureTextSnapshot: '设置于柜体内，用于采集温湿度数据',
    paragraphSectionSnapshot: '说明书 [0018]', paragraphTextSnippet: '多个温湿度传感器沿柜体对角线布置',
    text: '“温湿度数据”是否包括露点等派生数据？建议在从属权利要求中限定。',
    conclusion: 'amended', concludedAt: '2026-09-22T03:10:00.000Z',
    status: 'matched', matchedFeatureId: 'feature-b', matchedAt: '2026-09-22T03:30:00.000Z'
  },
  {
    id: 'exam-item-2', snapshotFeatureId: 'feature-d', featureLabelSnapshot: 'D · 调节微环境',
    featureTextSnapshot: '根据温湿度数据调节柜体微环境',
    paragraphSectionSnapshot: '说明书 [0024]', paragraphTextSnippet: '控制模块可比较当前湿度与预设区间',
    text: '调节策略缺少温度与气体交换的联动，建议补充。',
    conclusion: 'rejected', concludedAt: '2026-09-22T03:12:00.000Z',
    status: 'matched', matchedFeatureId: 'feature-d', matchedAt: '2026-09-22T03:30:00.000Z'
  },
  {
    id: 'exam-item-3', snapshotFeatureId: 'feature-e', featureLabelSnapshot: 'E · 对角线布置',
    featureTextSnapshot: '多个温湿度传感器沿柜体对角线布置',
    paragraphSectionSnapshot: '说明书 [0018]', paragraphTextSnippet: '多个温湿度传感器沿柜体对角线布置',
    text: '对角线布置未限定传感器数量与间距，测量偏差的克服缺少结构支撑。',
    conclusion: 'amended', concludedAt: '2026-09-25T01:00:00.000Z',
    status: 'pending', matchedFeatureId: null, matchedAt: null
  },
  {
    id: 'exam-item-4', snapshotFeatureId: 'feature-x', featureLabelSnapshot: 'X · 照明模块',
    featureTextSnapshot: '柜体内设置照明模块，用于陈列照明',
    paragraphSectionSnapshot: '说明书 [0050]', paragraphTextSnippet: '柜体内设置照明模块',
    text: '照明模块未在权利要求中体现，建议补入独立权利要求。',
    conclusion: 'amended', concludedAt: '2026-09-22T03:15:00.000Z',
    status: 'suspended', matchedFeatureId: null, matchedAt: null
  },
  {
    id: 'exam-item-5', snapshotFeatureId: 'feature-f', featureLabelSnapshot: 'F · 分级调节',
    featureTextSnapshot: '基于历史数据与当前数据的偏差分级调节除湿单元',
    paragraphSectionSnapshot: '说明书 [0024]', paragraphTextSnippet: '控制模块可比较当前湿度与预设区间',
    text: '分级调节的阈值与档位划分需在说明书中给出明确依据。',
    conclusion: 'approved', concludedAt: '2026-09-25T01:05:00.000Z',
    status: 'pending', matchedFeatureId: null, matchedAt: null
  }
]

const initialReviewRecords: ReviewRecord[] = [
  {
    featureId: 'feature-b', featureLabelSnapshot: 'B · 环境传感模块', status: 'confirmed', conclusion: 'amended',
    annotationText: '“温湿度数据”是否包括露点等派生数据？建议在从属权利要求中限定。',
    originItemId: 'exam-item-1', concludedAt: '2026-09-22T03:10:00.000Z', appliedAt: '2026-09-22T03:30:00.000Z'
  },
  {
    featureId: 'feature-d', featureLabelSnapshot: 'D · 调节微环境', status: 'confirmed', conclusion: 'rejected',
    annotationText: '调节策略缺少温度与气体交换的联动，建议补充。',
    originItemId: 'exam-item-2', concludedAt: '2026-09-22T03:12:00.000Z', appliedAt: '2026-09-22T03:30:00.000Z'
  }
]

function demoState(): WorkbenchState {
  return {
    claims: initialClaims, paragraphs: initialParagraphs, features: initialFeatures,
    annotations: initialAnnotations, reviewRecords: initialReviewRecords,
    examiner: { snapshotAt: '2026-09-21T00:00:00.000Z', snapshotFeatures: buildSnapshot(), items: initialExaminerItems },
    orphanMappings: [], versions: [],
    role: 'author', currentUserRole: 'author', selectedClaimId: 'claim-1', selectedFeatureId: 'feature-b', activeTab: 'mapping'
  }
}
function clone<T>(value: T): T { return structuredClone(value) }

@Injectable({ providedIn: 'root' })
export class WorkbenchService implements OnDestroy {
  private readonly initialState = this.loadState()
  private readonly stateSubject = new BehaviorSubject<WorkbenchState>(this.initialState)
  private readonly historySubject = new BehaviorSubject<{ past: number; future: number }>({ past: 0, future: 0 })
  private past: WorkbenchState[] = []
  private future: WorkbenchState[] = []

  /** 演示用：模拟带回中途失败，验证重试时已对上的不重复挂起、草稿与旧结论保留 */
  simulateBringBackFailure = false

  readonly state$ = this.stateSubject.asObservable()
  readonly history$ = this.historySubject.asObservable()
  readonly claims$ = this.state$.pipe(map(state => state.claims))
  readonly paragraphs$ = this.state$.pipe(map(state => state.paragraphs))
  readonly features$ = this.state$.pipe(map(state => state.features))
  readonly annotations$ = this.state$.pipe(map(state => state.annotations))
  readonly reviewRecords$: Observable<ReviewRecord[]> = this.state$.pipe(map(state => state.reviewRecords))
  readonly examiner$: Observable<ExaminerState> = this.state$.pipe(map(state => state.examiner))
  readonly role$ = this.state$.pipe(map(state => state.role))
  readonly selectedClaim$ = this.state$.pipe(map(state => state.claims.find(claim => claim.id === state.selectedClaimId) || state.claims[0]))
  readonly selectedFeature$ = this.state$.pipe(map(state => state.features.find(feature => feature.id === state.selectedFeatureId) || null))
  readonly issues$ = this.state$.pipe(map(state => this.validate(state)))

  constructor() {
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => this.savePosition())
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', () => this.savePosition())
  }

  get snapshot(): WorkbenchState { return clone(this.stateSubject.value) }
  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }

  selectClaim(id: string): void {
    this.patchState(state => { state.selectedClaimId = id; state.selectedFeatureId = state.features.find(feature => feature.claimId === id)?.id || null })
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

  updateClaim(patch: Partial<Claim>): void {
    if (this.stateSubject.value.role !== 'author') return
    this.commit(state => {
      const claim = state.claims.find(item => item.id === state.selectedClaimId)
      if (claim) Object.assign(claim, patch)
    })
  }

  addClaim(): void {
    if (this.stateSubject.value.role !== 'author') return
    this.commit(state => {
      const number = Math.max(0, ...state.claims.map(claim => claim.number)) + 1
      const claim: Claim = { id: `claim-${Date.now()}`, number, title: `权利要求 ${number}`, independent: false, text: '请录入权利要求正文。' }
      state.claims.push(claim)
      state.selectedClaimId = claim.id
      state.selectedFeatureId = null
    })
  }

  addParagraph(): void {
    if (this.stateSubject.value.role !== 'author') return
    this.commit(state => {
      const next = state.paragraphs.length + 1
      state.paragraphs.push({ id: `para-${Date.now()}`, section: `说明书 [${String(next * 5).padStart(4, '0')}]`, text: '' })
    })
  }

  updateParagraph(id: string, patch: Partial<Paragraph>): void {
    if (this.stateSubject.value.role !== 'author') return
    this.commit(state => {
      const paragraph = state.paragraphs.find(item => item.id === id)
      if (paragraph) Object.assign(paragraph, patch)
    })
  }

  deleteParagraph(id: string): void {
    if (this.stateSubject.value.role !== 'author') return
    this.commit(state => {
      state.paragraphs = state.paragraphs.filter(item => item.id !== id)
      state.features.forEach(feature => { feature.supportIds = feature.supportIds.filter(paragraphId => paragraphId !== id) })
      state.orphanMappings = state.orphanMappings.filter(item => item.paragraphId !== id)
    })
  }

  addFeature(): void {
    if (this.stateSubject.value.role !== 'author') return
    this.commit(state => {
      const feature: Feature = {
        id: `feature-${Date.now()}`, claimId: state.selectedClaimId,
        label: `新特征 ${state.features.filter(item => item.claimId === state.selectedClaimId).length + 1}`,
        text: '', parentId: null, referenceIds: [], supportIds: [], ownerRole: state.role,
        updatedAt: new Date().toISOString()
      }
      state.features.push(feature)
      state.selectedFeatureId = feature.id
    })
  }

  updateFeature(id: string, patch: Partial<Feature>): void {
    if (this.stateSubject.value.role !== 'author') return
    this.commit(state => {
      const feature = state.features.find(item => item.id === id)
      if (!feature) return
      Object.assign(feature, patch)
      // 内容改动后，此前作出的审查结论作废，等审查员重新确认
      const contentChanged = ['text', 'label', 'parentId', 'referenceIds'].some(key => key in patch)
      if (contentChanged) {
        feature.updatedAt = new Date().toISOString()
        this.voidReviewRecord(state, id)
      }
    })
  }

  deleteFeature(id: string): void {
    if (this.stateSubject.value.role !== 'author') return
    this.commit(state => {
      const feature = state.features.find(item => item.id === id)
      if (!feature) return
      feature.supportIds.forEach(paragraphId => state.orphanMappings.push({
        id: `orphan-${Date.now()}-${paragraphId}`, featureLabel: feature.label, paragraphId,
        reason: `技术特征“${feature.label}”已删除，但支持段落映射仍被保留。`
      }))
      state.features = state.features.filter(item => item.id !== id)
      state.features.forEach(item => {
        item.referenceIds = item.referenceIds.filter(refId => refId !== id)
        if (item.parentId === id) item.parentId = null
      })
      state.annotations = state.annotations.filter(item => item.featureId !== id)
      state.reviewRecords = state.reviewRecords.filter(item => item.featureId !== id)
      state.selectedFeatureId = state.features.find(item => item.claimId === state.selectedClaimId)?.id || null
    })
  }

  toggleParagraphMapping(featureId: string, paragraphId: string): void {
    if (this.stateSubject.value.role !== 'author') return
    this.commit(state => {
      const feature = state.features.find(item => item.id === featureId)
      if (!feature) return
      const index = feature.supportIds.indexOf(paragraphId)
      if (index >= 0) feature.supportIds.splice(index, 1)
      else feature.supportIds.push(paragraphId)
      state.orphanMappings = state.orphanMappings.filter(item => item.paragraphId !== paragraphId)
      feature.updatedAt = new Date().toISOString()
      this.voidReviewRecord(state, featureId)
    })
  }

  clearOrphan(id: string): void {
    this.commit(state => { state.orphanMappings = state.orphanMappings.filter(item => item.id !== id) })
  }

  addAnnotation(featureId: string, text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    const role = this.stateSubject.value.role
    const names: Record<Role, string> = { author: '代理人 · 陈昊', examiner: '审查员 · 李岚', viewer: '观察者' }
    this.commit(state => state.annotations.push({
      id: `annotation-${Date.now()}`, featureId, authorRole: role, authorName: names[role], text: trimmed, updatedAt: new Date().toISOString()
    }))
  }

  updateAnnotation(id: string, text: string): void {
    this.commit(state => {
      const annotation = state.annotations.find(item => item.id === id)
      if (annotation && annotation.authorRole === state.role) annotation.text = text
    })
  }

  deleteAnnotation(id: string): void {
    this.commit(state => {
      const annotation = state.annotations.find(item => item.id === id)
      if (annotation && annotation.authorRole === state.role) state.annotations = state.annotations.filter(item => item.id !== id)
    })
  }

  createVersion(name?: string): void {
    this.commit(state => {
      state.versions.unshift({
        id: `version-${Date.now()}`, name: name?.trim() || `快照 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        createdAt: new Date().toISOString(), claims: clone(state.claims), features: clone(state.features)
      })
    })
  }

  restoreVersion(id: string): void {
    this.commit(state => {
      const version = state.versions.find(item => item.id === id)
      if (!version) return
      state.claims = clone(version.claims)
      state.features = clone(version.features).map(feature => ({ ...feature, updatedAt: new Date().toISOString() }))
      // 恢复旧版后特征内容已变动，未作废的结论全部作废，等审查员重新确认
      state.reviewRecords.forEach(record => { if (record.status === 'confirmed') record.status = 'void' })
      if (!state.claims.some(claim => claim.id === state.selectedClaimId)) state.selectedClaimId = state.claims[0]?.id || ''
      state.selectedFeatureId = state.features.find(feature => feature.claimId === state.selectedClaimId)?.id || null
    })
  }

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
    if (typeof localStorage === 'undefined') return { tab: this.initialState.activeTab, claimId: this.initialState.selectedClaimId, featureId: this.initialState.selectedFeatureId, scrollY: 0 }
    try { return { ...JSON.parse(localStorage.getItem(POSITION_KEY) || '{}'), ...this.stateSubject.value } } catch { return { tab: 'mapping', claimId: this.initialState.selectedClaimId, featureId: this.initialState.selectedFeatureId, scrollY: 0 } }
  }

  exportJson(): string { return JSON.stringify({ ...this.snapshot, validationIssues: this.validate(this.stateSubject.value) }, null, 2) }

  exportCsv(): string {
    const state = this.stateSubject.value
    const rows = state.features.map(feature => [
      state.claims.find(claim => claim.id === feature.claimId)?.number || '', feature.label, feature.text,
      state.features.find(item => item.id === feature.parentId)?.label || '',
      feature.referenceIds.map(id => state.features.find(item => item.id === id)?.label || id).join('；'),
      feature.supportIds.map(id => state.paragraphs.find(item => item.id === id)?.section || id).join('；')
    ])
    const csv = [['权利要求', '技术特征', '特征内容', '父级特征', '引用特征', '支持段落'], ...rows]
      .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')
    return `﻿${csv}`
  }

  validate(state = this.stateSubject.value): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    for (const feature of state.features) {
      if (!feature.text.trim()) issues.push({ id: `empty-${feature.id}`, severity: 'warning', type: 'empty-feature', featureId: feature.id, title: `${feature.label} 内容为空`, detail: '请补全技术特征文字，避免映射对象不明确。' })
      if (!feature.supportIds.length) issues.push({ id: `support-${feature.id}`, severity: 'error', type: 'missing-support', featureId: feature.id, title: `${feature.label} 缺少说明书依据`, detail: '至少为一个说明书段落建立支持映射。' })
      if (this.hasReferenceCycle(feature, state.features)) issues.push({ id: `cycle-${feature.id}`, severity: 'error', type: 'cycle', featureId: feature.id, title: `${feature.label} 存在循环引用`, detail: '特征层级或引用关系形成闭环，请移除其中一条关系。' })
    }
    state.orphanMappings.forEach(item => issues.push({ id: item.id, severity: 'warning', type: 'orphan-mapping', title: '存在待清理映射', detail: item.reason }))
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

  // ---- 审查员侧：快照、条目与带回对账 ----------------------------------------

  /** 审查员领取代理人当前特征的快照副本，在副本上写结论，不碰代理人草稿 */
  takeSnapshot(): void {
    this.patchState(state => {
      state.examiner.snapshotAt = new Date().toISOString()
      state.examiner.snapshotFeatures = state.features.map(feature => {
        const claim = state.claims.find(item => item.id === feature.claimId)
        return {
          id: feature.id, claimId: feature.claimId, claimNumber: claim?.number || 0,
          label: feature.label, text: feature.text, parentId: feature.parentId,
          referenceIds: [...feature.referenceIds], supportIds: [...feature.supportIds],
          supportSections: feature.supportIds.map(id => state.paragraphs.find(paragraph => paragraph.id === id)?.section || id)
        }
      })
    })
  }

  addExaminerItem(snapshotFeatureId: string): void {
    if (this.stateSubject.value.role !== 'examiner') return
    this.commit(state => {
      const snap = state.examiner.snapshotFeatures.find(item => item.id === snapshotFeatureId)
      if (!snap) return
      state.examiner.items.push({
        id: `exam-item-${Date.now()}`, snapshotFeatureId: snap.id,
        featureLabelSnapshot: snap.label, featureTextSnapshot: snap.text,
        paragraphSectionSnapshot: snap.supportSections[0] || null, paragraphTextSnippet: null,
        text: '', conclusion: null, concludedAt: new Date().toISOString(),
        status: 'pending', matchedFeatureId: null, matchedAt: null
      })
    })
  }

  updateExaminerItem(id: string, patch: Partial<ExaminerItem>): void {
    if (this.stateSubject.value.role !== 'examiner') return
    this.commit(state => {
      const item = state.examiner.items.find(entry => entry.id === id)
      if (item) Object.assign(item, patch)
    })
  }

  removeExaminerItem(id: string): void {
    if (this.stateSubject.value.role !== 'examiner') return
    this.commit(state => { state.examiner.items = state.examiner.items.filter(item => item.id !== id) })
  }

  /** 作废条目经审查员重新确认后回到待处理，等待下次带回重新对账 */
  reconfirmItem(id: string): void {
    if (this.stateSubject.value.role !== 'examiner') return
    this.commit(state => {
      const item = state.examiner.items.find(entry => entry.id === id)
      if (item && item.status === 'void') {
        item.status = 'pending'
        item.concludedAt = new Date().toISOString()
      }
    })
  }

  /**
   * 带回审查结果：逐条对账。
   * 已对上的条目保持原状不重复挂起；结论作废的更新记录；挂起的等人定。
   * 带回只写审查结论与审查员批注，不触碰代理人的特征、层级、引用与支持段落。
   */
  bringBack(): BringBackResult {
    const result: BringBackResult = { applied: 0, voided: 0, suspended: 0, pending: 0, failed: false }
    const current = this.stateSubject.value
    // 第一阶段：逐条对账（只处理 pending；matched/void/suspended 保持原状，不重复挂起）
    const decisions = current.examiner.items
      .filter(item => item.status === 'pending')
      .map(item => ({ item, decision: this.reconcile(item, current.features, current.paragraphs) }))

    // 第二阶段：应用。可模拟中途失败：已应用的结论保留，其余待重试
    const next = clone(current)
    for (const { item, decision } of decisions) {
      if (this.simulateBringBackFailure && result.applied >= 1) { result.failed = true; break }
      const target = next.examiner.items.find(entry => entry.id === item.id)
      if (!target) continue
      target.status = decision.status
      target.matchedFeatureId = decision.matchedFeatureId
      target.matchedAt = new Date().toISOString()
      if (decision.status === 'matched') {
        result.applied++
        this.applyConclusion(next, target, 'confirmed')
      } else if (decision.status === 'void') {
        result.voided++
        this.applyConclusion(next, target, 'void')
      } else {
        result.suspended++
      }
    }
    result.pending = next.examiner.items.filter(item => item.status === 'pending').length
    this.stateSubject.next(next)
    this.saveState()
    return result
  }

  /** 带回失败后从审查员一侧重试：只处理剩余 pending，已对上的不重复挂起，草稿与旧结论保留 */
  retryBringBack(): BringBackResult {
    return this.bringBack()
  }

  /** 人工处理挂起条目：指定到某条特征（确认结论），或忽略（撤下条目） */
  resolveSuspended(itemId: string, featureId: string | null): void {
    this.commit(state => {
      const item = state.examiner.items.find(entry => entry.id === itemId)
      if (!item || item.status !== 'suspended') return
      if (featureId) {
        const feature = state.features.find(entry => entry.id === featureId)
        if (!feature) return
        item.status = 'matched'
        item.matchedFeatureId = featureId
        item.matchedAt = new Date().toISOString()
        this.applyConclusion(state, item, 'confirmed')
      } else {
        state.examiner.items = state.examiner.items.filter(entry => entry.id !== itemId)
      }
    })
  }

  /** 对账：按特征正文与指向段落匹配，不依赖特征 id；结论作出后特征又改动的判作废 */
  private reconcile(item: ExaminerItem, features: Feature[], paragraphs: Paragraph[]): { status: ExaminerItemStatus; matchedFeatureId: string | null } {
    const norm = (text: string) => text.replace(/\s+/g, '')
    const text = norm(item.featureTextSnapshot)
    const paraSection = item.paragraphSectionSnapshot
    const findParagraph = (section: string) => paragraphs.find(paragraph => paragraph.section === section)
    const pointsTo = (feature: Feature): boolean => {
      if (!paraSection) return true
      const paragraph = findParagraph(paraSection)
      return paragraph ? feature.supportIds.includes(paragraph.id) : false
    }

    // 1) 正文一致且指向段落仍在支持映射中 → 同一特征；结论后又改动的作废
    const exact = features.find(feature => norm(feature.text) === text && pointsTo(feature))
    if (exact) return { status: exact.updatedAt > item.concludedAt ? 'void' : 'matched', matchedFeatureId: exact.id }

    // 2) 特征 id 仍在但正文已被改写 → 同一特征，结论作废待重新确认
    const byId = features.find(feature => feature.id === item.snapshotFeatureId)
    if (byId) return { status: 'void', matchedFeatureId: byId.id }

    // 3) 正文高度相似且指向段落一致（特征被拆分/改写）→ 结论作废待重新确认
    const fuzzy = features.find(feature => this.textSimilarity(item.featureTextSnapshot, feature.text) >= 0.6 && pointsTo(feature))
    if (fuzzy) return { status: 'void', matchedFeatureId: fuzzy.id }

    // 4) 指向已撤下特征或对不上 → 挂起等人定
    return { status: 'suspended', matchedFeatureId: null }
  }

  /** 基于字符二元组的 Dice 相似度，用于识别被改写但同根的特征 */
  private textSimilarity(a: string, b: string): number {
    const na = a.replace(/\s+/g, ''), nb = b.replace(/\s+/g, '')
    if (!na.length || !nb.length) return 0
    if (na === nb) return 1
    const bigrams = (value: string) => {
      const set = new Set<string>()
      for (let i = 0; i < value.length - 1; i++) set.add(value.slice(i, i + 2))
      return set
    }
    const sa = bigrams(na), sb = bigrams(nb)
    let intersection = 0
    sa.forEach(bigram => { if (sb.has(bigram)) intersection++ })
    return (2 * intersection) / (sa.size + sb.size)
  }

  /** 把审查结论写入代理人侧记录，并把审查员批注挂到批注墙（按 originItemId 去重） */
  private applyConclusion(state: WorkbenchState, item: ExaminerItem, status: 'confirmed' | 'void'): void {
    if (!item.matchedFeatureId) return
    const record: ReviewRecord = {
      featureId: item.matchedFeatureId,
      featureLabelSnapshot: item.featureLabelSnapshot,
      status,
      conclusion: item.conclusion || 'amended',
      annotationText: item.text,
      originItemId: item.id,
      concludedAt: item.concludedAt,
      appliedAt: new Date().toISOString()
    }
    const recordIndex = state.reviewRecords.findIndex(entry => entry.originItemId === item.id)
    if (recordIndex >= 0) state.reviewRecords[recordIndex] = record
    else state.reviewRecords.push(record)

    if (item.text.trim()) {
      const annotation: Annotation = {
        id: `annotation-${item.id}`, featureId: item.matchedFeatureId,
        authorRole: 'examiner', authorName: '审查员 · 李岚',
        text: item.text, updatedAt: new Date().toISOString(), originItemId: item.id
      }
      const annotationIndex = state.annotations.findIndex(entry => entry.originItemId === item.id)
      if (annotationIndex >= 0) state.annotations[annotationIndex] = annotation
      else state.annotations.push(annotation)
    }
  }

  /** 代理人改动特征后，未作废的结论同步作废，并把审查员侧对应条目置为作废，等审查员重新确认 */
  private voidReviewRecord(state: WorkbenchState, featureId: string): void {
    const record = state.reviewRecords.find(entry => entry.featureId === featureId && entry.status === 'confirmed')
    if (!record) return
    record.status = 'void'
    const item = state.examiner.items.find(entry => entry.id === record.originItemId)
    if (item && item.status === 'matched') item.status = 'void'
  }

  private commit(recipe: (state: WorkbenchState) => void): void {
    const current = clone(this.stateSubject.value)
    const next = clone(current)
    recipe(next)
    this.past.push(current)
    if (this.past.length > 60) this.past.shift()
    this.future = []
    this.stateSubject.next(next)
    this.updateHistory()
    this.saveState()
  }

  private patchState(recipe: (state: WorkbenchState) => void): void {
    const next = clone(this.stateSubject.value)
    recipe(next)
    this.stateSubject.next(next)
    this.saveState()
  }

  private updateHistory(): void { this.historySubject.next({ past: this.past.length, future: this.future.length }) }
  private saveState(): void { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stateSubject.value)) }
  private loadState(): WorkbenchState {
    if (typeof localStorage === 'undefined') return demoState()
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return demoState()
      const parsed = JSON.parse(stored)
      const fallback = demoState()
      return {
        ...fallback, ...parsed,
        // 旧版本地数据没有审查员侧状态时补默认值
        reviewRecords: parsed.reviewRecords || fallback.reviewRecords,
        examiner: parsed.examiner || fallback.examiner,
        // 旧版特征没有 updatedAt 时补时间锚点，避免对账比较出错
        features: (parsed.features || fallback.features).map((feature: Feature) => ({ ...feature, updatedAt: feature.updatedAt || SEED_FEATURE_TIME }))
      }
    } catch { return demoState() }
  }
}
