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
import type {
  Claim, Feature, IncomingReview, OutboxEntry, ReviewCopyFeature, ReviewDecision, ReviewItem,
  ReviewKind, Role, SuspendReason, ValidationIssue
} from './models'
import { WorkbenchService } from './workbench.service'
import { reviewKey } from './reconcile'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, TextareaModule, SelectModule, CardModule, BadgeModule, DialogModule, TooltipModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  state = this.service.snapshot
  issues: ValidationIssue[] = []
  history = { past: 0, future: 0 }
  compareA = ''
  compareB = ''
  versionDialog = false
  versionName = ''
  activeIssue: ValidationIssue | null = null
  syncMessage: { ok: boolean; text: string } | null = null

  // 审查员编辑批注/结论的草稿
  reviewDraft: { id: string | null; kind: ReviewKind; decision: ReviewDecision; text: string } = {
    id: null, kind: 'conclusion', decision: 'accepted', text: ''
  }
  reviewDialog = false
  reviewDialogFeature: ReviewCopyFeature | null = null
  decisionOptions: Array<{ label: string; value: ReviewDecision }> = [
    { label: '认可该特征', value: 'accepted' },
    { label: '新颖性问题', value: 'novelty' },
    { label: '创造性问题', value: 'inventiveness' },
    { label: '清楚性问题（A26.4）', value: 'clarity' },
    { label: '说明书支持问题', value: 'support' }
  ]

  // 挂起处理：挂接到哪个现存特征
  suspendAttachFeatureId: Record<string, string> = {}

  roleOptions: Array<{ label: string; value: Role }> = [
    { label: '代理人（编辑技术特征 / 层级 / 引用 / 支持段落）', value: 'author' },
    { label: '审查员（编辑批注与每条特征的审查结论）', value: 'examiner' },
    { label: '观察者（只读）', value: 'viewer' }
  ]
  private subscriptions = new Subscription()

  constructor(readonly service: WorkbenchService) {}

  ngOnInit(): void {
    this.subscriptions.add(this.service.state$.subscribe(state => { this.state = structuredClone(state) }))
    this.subscriptions.add(this.service.issues$.subscribe(issues => { this.issues = issues }))
    this.subscriptions.add(this.service.history$.subscribe(history => { this.history = history }))
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

  // —— 代理人主数据 ——
  get selectedClaim(): Claim | undefined { return this.state.author.claims.find(item => item.id === this.state.selectedClaimId) }
  get selectedFeature(): Feature | undefined { return this.state.author.features.find(item => item.id === this.state.selectedFeatureId) }
  get claimFeatures(): Feature[] { return this.state.author.features.filter(item => item.claimId === this.state.selectedClaimId) }
  get currentRoleLabel(): string { return this.roleOptions.find(item => item.value === this.state.role)?.label || '' }
  get errorCount(): number { return this.issues.filter(item => item.severity === 'error').length }
  get warningCount(): number { return this.issues.filter(item => item.severity === 'warning').length }
  get canEditMainData(): boolean { return this.state.role === 'author' }
  get isExaminer(): boolean { return this.state.role === 'examiner' }
  get mappedFeatureCount(): number { return this.claimFeatures.filter(feature => feature.supportIds.length > 0).length }

  claimLabel(id: string): string { return this.state.author.claims.find(item => item.id === id)?.title || '未命名权利要求' }
  claimNumberOf(claimId: string): number { return this.state.author.claims.find(item => item.id === claimId)?.number || 0 }
  featureLabel(id: string): string { return this.state.author.features.find(item => item.id === id)?.label || id }
  featureHasStaleConclusion(featureId: string): boolean {
    return this.staleIncoming.some(review => review.featureId === featureId)
  }
  paragraphLabel(id: string): string { return this.state.author.paragraphs.find(item => item.id === id)?.section || id }
  isMapped(feature: Feature, paragraphId: string): boolean { return feature.supportIds.includes(paragraphId) }

  // —— 审查意见（代理人一侧看到的是带回后的副本）——
  get featureIncoming(): IncomingReview[] {
    if (!this.selectedFeature) return []
    return this.state.author.incoming
      .filter(item => item.featureId === this.selectedFeature?.id)
      .filter(item => this.service.effectiveState(item) !== 'superseded')
      .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))
  }

  get suspendedIncoming(): IncomingReview[] {
    return this.state.author.incoming
      .filter(item => this.service.effectiveState(item) === 'suspended')
      .sort((a, b) => b.broughtAt.localeCompare(a.broughtAt))
  }

  get staleIncoming(): IncomingReview[] {
    return this.state.author.incoming
      .filter(item => this.service.effectiveState(item) === 'stale')
      .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))
  }

  incomingStateLabel(review: IncomingReview): string {
    return ({
      active: '有效', stale: review.kind === 'conclusion' ? '已作废·待重新确认' : '所指内容已改动',
      suspended: '挂起·等人定', superseded: '已被新版本取代'
    })[this.service.effectiveState(review)]
  }

  suspendReasonLabel(reason?: SuspendReason): string {
    return reason === 'relink-ambiguous' ? '存在多个候选特征，对不上唯一对象' : '指向的特征已撤下或找不到'
  }

  decisionLabel(decision?: ReviewDecision): string { return this.service.decisionLabel(decision) }
  drift(review: IncomingReview): boolean { return this.service.isDrift(review) }
  reviewKeyOf(item: Pick<ReviewItem, 'id' | 'reviewedAt'>): string { return reviewKey(item) }

  // —— 审查员一侧 ——
  get copyFeatures(): ReviewCopyFeature[] {
    const claimIds = new Set(this.state.author.claims.map(claim => claim.id))
    return this.state.examiner.copyFeatures
      .filter(feature => claimIds.has(feature.claimId))
      .sort((a, b) => a.claimNumber - b.claimNumber || a.label.localeCompare(b.label))
  }

  get pendingOutbox(): OutboxEntry[] {
    return [...this.state.examiner.outbox]
      .filter(entry => entry.status === 'pending')
      .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
  }

  get deliveredOutbox(): OutboxEntry[] {
    return [...this.state.examiner.outbox]
      .filter(entry => entry.status === 'delivered')
      .sort((a, b) => (b.deliveredAt || '').localeCompare(a.deliveredAt || ''))
  }

  copyClaimNumber(feature: ReviewCopyFeature): number { return feature.claimNumber }
  itemsForCopy(featureId: string): ReviewItem[] {
    return this.state.examiner.items
      .filter(item => item.featureId === featureId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  outboxItem(entry: OutboxEntry): ReviewItem | undefined {
    return this.state.examiner.items.find(item => item.id === entry.itemId)
  }

  outboxItemKind(entry: OutboxEntry): ReviewKind {
    return this.outboxItem(entry)?.kind || 'annotation'
  }

  copyItemsForClaim(claimId: string): ReviewItem[] {
    const ids = new Set(this.state.examiner.copyFeatures.filter(feature => feature.claimId === claimId).map(feature => feature.id))
    return this.state.examiner.items.filter(item => ids.has(item.featureId))
  }

  staleConclusionsForExaminer(): ReviewItem[] {
    // 审查员视角需要重新确认的结论：副本已变，或代理人一侧已作废粘住（即使正文被改回）
    return this.state.examiner.items
      .filter(item => item.kind === 'conclusion' && this.service.needsReconfirm(item))
  }

  openReviewDialog(feature: ReviewCopyFeature, existing?: ReviewItem): void {
    this.reviewDialogFeature = feature
    this.reviewDraft = existing
      ? { id: existing.id, kind: existing.kind, decision: existing.decision || 'accepted', text: existing.text }
      : { id: null, kind: 'conclusion', decision: 'accepted', text: '' }
    this.reviewDialog = true
  }

  closeReviewDialog(): void {
    this.reviewDialog = false
    this.reviewDialogFeature = null
  }

  saveReviewDraft(): void {
    if (!this.reviewDialogFeature) return
    const result = this.service.saveReviewItem({
      id: this.reviewDraft.id || undefined,
      featureId: this.reviewDialogFeature.id,
      kind: this.reviewDraft.kind,
      decision: this.reviewDraft.decision,
      text: this.reviewDraft.text
    })
    if (result.ok) {
      this.closeReviewDialog()
      this.flash(result.ok, result.detail)
    } else {
      this.flash(false, result.detail)
    }
  }

  deleteReviewItem(id: string): void {
    this.service.deleteReviewItem(id)
    this.flash(true, '未送达的审查意见已从发件箱撤回；已送达记录保留在代理人一侧。')
  }

  reconfirm(item: ReviewItem): void {
    const result = this.service.reconfirmConclusion(item.id)
    this.flash(result.ok, result.detail)
  }

  pullCopy(): void {
    const result = this.service.pullReviewCopy()
    this.flash(result.ok, result.detail)
  }

  bringBack(): void {
    const result = this.service.bringBack()
    this.flash(result.ok, result.detail)
  }

  toggleFailureSimulation(): void {
    this.service.setSimulateFailure(!this.state.examiner.nextBringBackFails)
  }

  attachSuspended(review: IncomingReview): void {
    const featureId = this.suspendAttachFeatureId[review.id]
    if (!featureId) {
      this.flash(false, '请先选择要挂接的现存特征。')
      return
    }
    this.service.resolveSuspendedAttach(review.id, featureId)
    delete this.suspendAttachFeatureId[review.id]
    this.flash(true, '挂起意见已人工挂接，旧记录保留。')
  }

  discardSuspended(review: IncomingReview): void {
    this.service.resolveSuspendedDiscard(review.id)
    this.flash(true, '挂起副本已摘除；幂等键保留，旧版本重试不会重复挂。')
  }

  // —— 版本 / 导出 / 定位 ——
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

  createVersion(): void {
    this.service.createVersion(this.versionName)
    this.versionName = ''
    this.versionDialog = false
  }

  restoreVersion(id: string): void { this.service.restoreVersion(id) }
  getVersion(id: string) { return this.state.author.versions.find(item => item.id === id) }

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

  syncVersions(): void {
    const versions = this.state.author.versions
    if (!versions.some(item => item.id === this.compareA)) this.compareA = versions[1]?.id || versions[0]?.id || ''
    if (!versions.some(item => item.id === this.compareB)) this.compareB = versions[0]?.id || ''
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
    if (issue.type === 'stale-conclusion' || issue.type === 'review-suspended') this.service.setTab('sync')
    else this.service.setTab('mapping')
  }

  closeIssue(): void { this.activeIssue = null }
  goSync(): void { this.service.setTab('sync') }

  private flash(ok: boolean, text: string): void {
    this.syncMessage = { ok, text }
    setTimeout(() => { if (this.syncMessage?.text === text) this.syncMessage = null }, 5200)
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
