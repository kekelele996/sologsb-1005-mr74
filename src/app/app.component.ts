import { AfterViewInit, Component, OnDestroy, OnInit } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { TextareaModule } from 'primeng/textarea'
import { SelectModule } from 'primeng/select'
import { CardModule } from 'primeng/card'
import { BadgeModule } from 'primeng/badge'
import { DialogModule } from 'primeng/dialog'
import { TooltipModule } from 'primeng/tooltip'
import { Subscription } from 'rxjs'
import type { Annotation, BringBackResult, Claim, ExaminerItem, ExaminerSnapshotFeature, ExaminerState, Feature, ReviewConclusion, ReviewRecord, Role, ValidationIssue, WorkbenchState } from './models'
import { WorkbenchService } from './workbench.service'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, TextareaModule, SelectModule, CardModule, BadgeModule, DialogModule, TooltipModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  state: WorkbenchState
  issues: ValidationIssue[] = []
  history = { past: 0, future: 0 }
  compareA = ''
  compareB = ''
  annotationDraft = ''
  versionDialog = false
  versionName = ''
  activeIssue: ValidationIssue | null = null
  /** 审查员侧状态与带回结果 */
  reviewRecords: ReviewRecord[] = []
  examiner: ExaminerState = { snapshotAt: null, snapshotFeatures: [], items: [] }
  simulateFailure = false
  lastBringBack: BringBackResult | null = null
  suspendedAssignments: Record<string, string> = {}
  conclusionOptions: Array<{ label: string; value: ReviewConclusion }> = [
    { label: '通过', value: 'approved' },
    { label: '不通过', value: 'rejected' },
    { label: '需修改', value: 'amended' }
  ]
  roleOptions: Array<{ label: string; value: Role }> = [
    { label: '代理人（管理技术特征、层级、引用与支持段落，可编辑本人批注）', value: 'author' },
    { label: '审查员（在快照上写批注与审查结论，不可改特征草稿）', value: 'examiner' },
    { label: '观察者（只读）', value: 'viewer' }
  ]
  private subscriptions = new Subscription()

  constructor(readonly service: WorkbenchService) {
    this.state = service.snapshot
    this.reviewRecords = service.snapshot.reviewRecords
    this.examiner = service.snapshot.examiner
    this.simulateFailure = service.simulateBringBackFailure
  }

  ngOnInit(): void {
    this.subscriptions.add(this.service.state$.subscribe(state => {
      this.state = structuredClone(state)
      this.reviewRecords = state.reviewRecords
      this.examiner = state.examiner
      this.syncVersions()
    }))
    this.subscriptions.add(this.service.issues$.subscribe(issues => this.issues = issues))
    this.subscriptions.add(this.service.history$.subscribe(history => this.history = history))
    window.addEventListener('keydown', this.handleKeyboard)
  }

  ngAfterViewInit(): void {
    const position = this.service.readPosition()
    setTimeout(() => window.scrollTo({ top: position.scrollY || 0, behavior: 'instant' as ScrollBehavior }), 0)
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe()
    window.removeEventListener('keydown', this.handleKeyboard)
  }

  get selectedClaim(): Claim | undefined { return this.state.claims.find(item => item.id === this.state.selectedClaimId) }
  get selectedFeature(): Feature | undefined { return this.state.features.find(item => item.id === this.state.selectedFeatureId) }
  get claimFeatures(): Feature[] { return this.state.features.filter(item => item.claimId === this.state.selectedClaimId) }
  get featureAnnotations(): Annotation[] { return this.selectedFeature ? this.state.annotations.filter(item => item.featureId === this.selectedFeature?.id) : [] }
  get currentRoleLabel(): string { return this.roleOptions.find(item => item.value === this.state.role)?.label || '' }
  get errorCount(): number { return this.issues.filter(item => item.severity === 'error').length }
  get warningCount(): number { return this.issues.filter(item => item.severity === 'warning').length }
  get canEditMainData(): boolean { return this.state.role === 'author' }
  get mappedFeatureCount(): number { return this.claimFeatures.filter(feature => feature.supportIds.length > 0).length }

  claimLabel(id: string): string { return this.state.claims.find(item => item.id === id)?.title || '未命名权利要求' }
  featureLabel(id: string): string { return this.state.features.find(item => item.id === id)?.label || id }
  paragraphLabel(id: string): string { return this.state.paragraphs.find(item => item.id === id)?.section || id }
  isMapped(feature: Feature, paragraphId: string): boolean { return feature.supportIds.includes(paragraphId) }
  isOwnAnnotation(annotation: Annotation): boolean { return annotation.authorRole === this.state.role }
  ownerLabel(role: Role): string { return ({ author: '代理人', examiner: '审查员', viewer: '观察者' })[role] }

  // ---- 审查结论与审查员侧状态 ---------------------------------------------

  reviewRecordFor(featureId: string): ReviewRecord | undefined {
    return this.reviewRecords.find(record => record.featureId === featureId)
  }

  conclusionLabel(conclusion: ReviewConclusion | null): string {
    return this.conclusionOptions.find(option => option.value === conclusion)?.label || '未结论'
  }

  conclusionSeverity(conclusion: ReviewConclusion | null): 'success' | 'danger' | 'warn' | 'info' {
    if (conclusion === 'approved') return 'success'
    if (conclusion === 'rejected') return 'danger'
    if (conclusion === 'amended') return 'warn'
    return 'info'
  }

  statusLabel(status: ExaminerItem['status']): string {
    return ({ pending: '待带回', matched: '已对上', void: '作废·待重审', suspended: '已挂起' })[status]
  }

  suspendedItems(): ExaminerItem[] { return this.examiner.items.filter(item => item.status === 'suspended') }
  pendingItems(): ExaminerItem[] { return this.examiner.items.filter(item => item.status === 'pending') }
  itemOf(snapshotFeatureId: string): ExaminerItem | undefined {
    return this.examiner.items.find(item => item.snapshotFeatureId === snapshotFeatureId)
  }
  snapshotFeatureOf(item: ExaminerItem): ExaminerSnapshotFeature | undefined {
    return this.examiner.snapshotFeatures.find(snap => snap.id === item.snapshotFeatureId)
  }

  takeSnapshot(): void { this.service.takeSnapshot() }

  addExaminerItem(snapshotFeatureId: string): void { this.service.addExaminerItem(snapshotFeatureId) }

  updateExaminerItem(item: ExaminerItem, patch: Partial<ExaminerItem>): void {
    this.service.updateExaminerItem(item.id, patch)
  }

  removeExaminerItem(item: ExaminerItem): void { this.service.removeExaminerItem(item.id) }

  reconfirmItem(item: ExaminerItem): void { this.service.reconfirmItem(item.id) }

  bringBack(): void {
    this.service.simulateBringBackFailure = this.simulateFailure
    this.lastBringBack = this.service.bringBack()
  }

  retryBringBack(): void {
    this.service.simulateBringBackFailure = this.simulateFailure
    this.lastBringBack = this.service.retryBringBack()
  }

  resolveSuspended(item: ExaminerItem, assign: boolean): void {
    const featureId = assign ? (this.suspendedAssignments[item.id] || null) : null
    this.service.resolveSuspended(item.id, featureId)
    if (!assign) delete this.suspendedAssignments[item.id]
  }

  updateClaimField(field: 'title' | 'text' | 'number' | 'independent', event: Event): void {
    const element = event.target as HTMLInputElement
    const value = field === 'number' ? Number(element.value) : field === 'independent' ? element.checked : element.value
    this.service.updateClaim({ [field]: value })
  }

  updateFeatureField(field: 'label' | 'text', event: Event): void {
    if (!this.selectedFeature) return
    this.service.updateFeature(this.selectedFeature.id, { [field]: (event.target as HTMLInputElement | HTMLTextAreaElement).value })
  }

  updateFeatureParent(event: Event): void {
    if (!this.selectedFeature) return
    this.service.updateFeature(this.selectedFeature.id, { parentId: (event.target as HTMLSelectElement).value || null })
  }

  toggleReference(featureId: string, checked: boolean): void {
    if (!this.selectedFeature) return
    const ids = checked
      ? Array.from(new Set([...this.selectedFeature.referenceIds, featureId]))
      : this.selectedFeature.referenceIds.filter(id => id !== featureId)
    this.service.updateFeature(this.selectedFeature.id, { referenceIds: ids })
  }

  addAnnotation(): void {
    if (!this.selectedFeature) return
    this.service.addAnnotation(this.selectedFeature.id, this.annotationDraft)
    this.annotationDraft = ''
  }

  updateAnnotation(annotation: Annotation, event: Event): void {
    this.service.updateAnnotation(annotation.id, (event.target as HTMLTextAreaElement).value)
  }

  createVersion(): void {
    this.service.createVersion(this.versionName)
    this.versionName = ''
    this.versionDialog = false
  }

  restoreVersion(id: string): void {
    this.service.restoreVersion(id)
  }

  getVersion(id: string) { return this.state.versions.find(item => item.id === id) }
  compareRows(): Array<{ label: string; before: string; after: string; changed: boolean }> {
    const a = this.getVersion(this.compareA)
    const b = this.getVersion(this.compareB)
    if (!a || !b) return []
    const ids = Array.from(new Set([...a.claims.map(item => item.id), ...b.claims.map(item => item.id)]))
    return ids.map(id => {
      const before = a.claims.find(item => item.id === id)?.text || ''
      const after = b.claims.find(item => item.id === id)?.text || ''
      return { label: `权利要求 ${a.claims.find(item => item.id === id)?.number || b.claims.find(item => item.id === id)?.number || '?'}`, before, after, changed: before !== after }
    })
  }

  exportFile(type: 'json' | 'csv'): void {
    const content = type === 'json' ? this.service.exportJson() : this.service.exportCsv()
    const mime = type === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8'
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `patent-claim-check-${new Date().toISOString().slice(0, 10)}.${type}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  locateIssue(issue: ValidationIssue): void {
    this.activeIssue = issue
    if (issue.featureId) this.service.selectFeature(issue.featureId)
    this.service.setTab('mapping')
  }

  closeIssue(): void { this.activeIssue = null }

  private syncVersions(): void {
    if (!this.state.versions.some(item => item.id === this.compareA)) this.compareA = this.state.versions[1]?.id || this.state.versions[0]?.id || ''
    if (!this.state.versions.some(item => item.id === this.compareB)) this.compareB = this.state.versions[0]?.id || ''
  }

  private handleKeyboard = (event: KeyboardEvent): void => {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault()
      event.shiftKey ? this.service.redo() : this.service.undo()
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault()
      this.service.redo()
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault()
      this.versionDialog = true
    }
  }
}
