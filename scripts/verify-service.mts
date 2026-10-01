// WorkbenchService 全链路行为验证（在 node 中实例化，localStorage/window 用桩）
import { WorkbenchService } from '../src/app/workbench.service.ts'

let pass = 0, fail = 0
function assert(cond: boolean, message: string): void {
  if (cond) { pass += 1; console.log('  ✓', message) }
  else { fail += 1; console.error('  ✗', message) }
}

const svc = new WorkbenchService()
const snap = () => svc.snapshot

console.log('0) 种子：代理人 3 条带回记录（1 active / 1 stale / 1 suspended），审查员 2 条待发（上次带回失败）')
let s = snap()
assert(s.author.incoming.length === 3, '代理人一侧初始保留 3 条历史记录')
assert(s.examiner.outbox.filter(o => o.status === 'pending').length === 2, '审查员发件箱有 2 条待重试')
assert(s.examiner.outbox.find(o => o.status === 'pending')!.attempts >= 1, '待发项保留失败尝试次数与错误信息')

console.log('1) 审查员重试带回（模拟开关仍为失败）')
svc.setRole('examiner')
let res = svc.bringBack()
assert(!res.ok, '带回失败返回 ok=false')
s = snap()
assert(s.author.incoming.length === 3 && s.author.reports.length === 1, '失败后代理人草稿与旧结论完全不动，不新增对账报告')
assert(s.examiner.outbox.filter(o => o.status === 'pending').length === 2, '2 条仍留在发件箱等待重试')

console.log('2) 关闭模拟失败，再次从审查员一侧重试')
svc.setSimulateFailure(false)
res = svc.bringBack()
assert(res.ok, '重试成功')
s = snap()
const pendingAfter = s.examiner.outbox.filter(o => o.status === 'pending').length
assert(pendingAfter === 0, '发件箱清空，全部 delivered')
assert(s.author.incoming.length === 5, '代理人一侧新增 2 条副本（原有 3 条保留）')
const aNote = s.author.incoming.find(r => r.itemId === 'review-a-note')!
const cConclusion = s.author.incoming.find(r => r.itemId === 'review-c-clarity')!
assert(svc.effectiveState(aNote) === 'active' && svc.effectiveState(cConclusion) === 'active', '批注与认可结论均对账成功 active')
assert(s.author.reports[0].activeCount === 2, '新批次报告记录 2 条照旧有效')

console.log('3) 幂等：没有新意见时再点带回直接提示为空；即使重复调用对账也不重复挂')
res = svc.bringBack()
assert(!res.ok && res.detail.includes('发件箱为空'), '发件箱为空不允许重复带回')
assert(snap().author.incoming.length === 5, '记录数保持 5，不重复挂')

console.log('4) 代理人在结论确认之后改特征正文 → 结论作废且粘住；批注不作废')
svc.setRole('author')
svc.updateFeature('feature-c', { text: '与环境传感模块通过有线或无线方式通信' })
s = snap()
assert(svc.effectiveState(s.author.incoming.find(r => r.itemId === 'review-c-clarity')!) === 'stale', 'C 的认可结论因正文改动作废')
// 代理人撤销改动（恢复原文）
svc.undo()
assert(svc.effectiveState(snap().author.incoming.find(r => r.itemId === 'review-c-clarity')!) === 'active', '撤销代理人改动后结论恢复有效（同一操作整体回滚）')
// 改完不撤销：粘住
svc.updateFeature('feature-c', { text: '与环境传感模块通过有线或无线方式通信' })
svc.updateFeature('feature-c', { text: '与环境传感模块通信' }) // 改回原文
assert(svc.effectiveState(snap().author.incoming.find(r => r.itemId === 'review-c-clarity')!) === 'stale', '即使正文改回原样，作废状态粘住，必须审查员重新确认')
const aAfter = snap().author.incoming.find(r => r.itemId === 'review-a-note')!
assert(svc.effectiveState(aAfter) === 'active', 'A 上的批注不因改动而作废（仅结论作废）')

console.log('5) 代理人撤下带有效意见的特征 → 该意见挂起等人定，旧数据保留')
svc.deleteFeature('feature-a')
s = snap()
const aSuspended = s.author.incoming.find(r => r.itemId === 'review-a-note')!
assert(svc.effectiveState(aSuspended) === 'suspended' && aSuspended.suspendReason === 'feature-removed' && aSuspended.featureId === null, '指向已撤下特征 → 挂起(feature-removed)')

console.log('6) 人工挂接到现存特征后恢复 active')
svc.resolveSuspendedAttach(aSuspended.id, 'feature-c')
assert(svc.effectiveState(snap().author.incoming.find(r => r.id === aSuspended.id)!) === 'active', '代理人人工挂接后变 active')

console.log('7) 审查员拉取最新副本 → 看到结论已过时 → 重新确认 → 带回新版本，旧版本标 superseded')
svc.setRole('examiner')
svc.pullReviewCopy()
const items = snap().examiner.items
const cItem = items.find(i => i.id === 'review-c-clarity')!
assert(svc.copyStatus(cItem) === null, '正文已被代理人改回原样：副本与旧快照内容一致')
assert(svc.needsReconfirm(cItem), '但代理人一侧该结论已粘住作废，审查员一侧仍提示“待重新确认”')
res = svc.reconfirmConclusion('review-c-clarity')
assert(res.ok, '按最新副本重新确认成功并入发件箱')
assert(!svc.needsReconfirm(snap().examiner.items.find(i => i.id === 'review-c-clarity')!), '新版本待带回期间不再重复提示')
svc.bringBack()
s = snap()
const cVersions = s.author.incoming.filter(r => r.itemId === 'review-c-clarity')
const newest = cVersions.slice().sort((x, y) => y.reviewedAt.localeCompare(x.reviewedAt))[0]
const oldest = cVersions.slice().sort((x, y) => x.reviewedAt.localeCompare(y.reviewedAt))[0]
assert(svc.effectiveState(newest) === 'active', '新确认版本 active')
assert(svc.effectiveState(oldest) === 'superseded', '旧版本被标记 superseded（记录保留，不再提示）')
assert(s.author.appliedKeys.length === 6, '幂等键：B/D/G 3 + A/C 2 + C 新版本 1 = 6')

console.log('8) 校验问题：B 结论仍作废待确认、G 挂起等人定，同一意见不重复提示')
const issues = svc.validate()
const staleIssues = issues.filter(i => i.type === 'stale-conclusion')
const suspIssues = issues.filter(i => i.type === 'review-suspended')
assert(staleIssues.length === 1 && staleIssues[0].title.includes('B · 环境传感模块'), '仅 B 1 条作废结论（C 已有新版本，旧版 superseded 不再报）')
assert(suspIssues.length === 1 && suspIssues[0].title.includes('G · 通信周期'), '仅 G 1 条挂起（A 已人工挂接）')

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
