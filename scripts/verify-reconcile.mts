// 对账逻辑验证脚本（node --version 20 支持 .mts）
import { featureFingerprint, reconcileBringBack, reviewKey } from '../src/app/reconcile.ts'
import type { Feature, OutboxEntry, ReviewItem } from '../src/app/models.ts'

let pass = 0, fail = 0
function assert(cond: boolean, message: string): void {
  if (cond) { pass += 1; console.log('  ✓', message) }
  else { fail += 1; console.error('  ✗', message) }
}

const features: Feature[] = [
  { id: 'f1', claimId: 'c1', label: 'F1', text: '柜体', parentId: null, referenceIds: [], supportIds: ['p1'] },
  { id: 'f2', claimId: 'c1', label: 'F2', text: '传感器采集温湿度（新）', parentId: null, referenceIds: [], supportIds: ['p1', 'p2'] },
  // f3 被代理人撤下了；f3' 内容与 f3 旧快照完全一致（可自动找回）
  { id: 'f3p', claimId: 'c1', label: 'F3b', text: '周期传输数据', parentId: null, referenceIds: [], supportIds: ['p3'] },
  // f4a/f4b 内容一致，与被删 f4 快照相同 → 多候选挂起
  { id: 'f4a', claimId: 'c1', label: 'F4a', text: '分级调节除湿', parentId: null, referenceIds: [], supportIds: ['p4'] },
  { id: 'f4b', claimId: 'c1', label: 'F4b', text: '分级调节除湿', parentId: null, referenceIds: [], supportIds: ['p4'] }
]

const now = '2026-10-01T00:00:00.000Z'
function item(partial: Partial<ReviewItem> & { id: string; featureId: string; featureText: string }): ReviewItem {
  return {
    featureLabel: partial.featureId, supportIds: [], kind: 'conclusion', decision: 'accepted',
    text: 'x', authorName: 'examiner', createdAt: now, updatedAt: now, reviewedAt: now, ...partial
  }
}

const i1 = item({ id: 'r1', featureId: 'f1', featureText: '柜体', supportIds: ['p1'] }) // 照旧 active
const i2a = item({ id: 'r2', featureId: 'f2', featureText: '传感器采集温湿度（旧）', supportIds: ['p1', 'p2'] }) // 正文变了 → stale
const i2b = item({ id: 'r3', featureId: 'f2', featureText: '传感器采集温湿度（新）', supportIds: ['p1'] }) // 段落变了 → stale
const i3 = item({ id: 'r4', featureId: 'f3', featureText: '周期传输数据', supportIds: ['p3'] }) // 撤下但指纹唯一 → active 找回
const i4 = item({ id: 'r5', featureId: 'f4', featureText: '分级调节除湿', supportIds: ['p4'] }) // 多候选 → suspended
const i5 = item({ id: 'r6', featureId: 'f9', featureText: '完全不存在的正文', supportIds: [] }) // 找不到 → suspended removed

function outboxOf(items: ReviewItem[]): OutboxEntry[] {
  return items.map(i => ({ id: reviewKey(i), itemId: i.id, batchId: '', queuedAt: now, status: 'pending', attempts: 1, lastError: 'timeout', deliveredAt: null }))
}

console.log('1) 首次带回对账')
const r1 = reconcileBringBack({ items: [i1, i2a, i2b, i3, i4, i5], outbox: outboxOf([i1, i2a, i2b, i3, i4, i5]), features, appliedKeys: [], batchId: 'b1', at: now })
const stateOf = (id: string) => r1.incoming.find(x => x.itemId === id)?.state
assert(stateOf('r1') === 'active', '正文与段落一致 → active')
assert(stateOf('r2') === 'stale', '结论后正文改动 → stale 作废')
assert(stateOf('r3') === 'stale', '结论后支持段落改动 → stale 作废')
const r3 = r1.incoming.find(x => x.itemId === 'r4')!
assert(r3.state === 'active' && r3.featureId === 'f3p', '特征撤下但指纹唯一 → 自动对回 f3p，active')
const r4 = r1.incoming.find(x => x.itemId === 'r5')!
assert(r4.state === 'suspended' && r4.suspendReason === 'relink-ambiguous', '指纹多候选 → suspended(relink-ambiguous)')
const r5 = r1.incoming.find(x => x.itemId === 'r6')!
assert(r5.state === 'suspended' && r5.suspendReason === 'feature-removed' && r5.featureId === null, '对不上 → suspended(feature-removed) 且 featureId 为空')
assert(r1.report.activeCount === 2 && r1.report.staleCount === 2 && r1.report.suspendedCount === 2, '批次计数正确')
assert(r1.deliveredEntryIds.length === 6, '6 条待发记录全部标记送达（含失败后重试成功的）')

console.log('2) 幂等：同一批再带回一次（模拟重试），已对上的不重复挂')
const r2 = reconcileBringBack({ items: [i1, i2a, i2b, i3, i4, i5], outbox: outboxOf([i1, i2a, i2b, i3, i4, i5]), features, appliedKeys: r1.appliedKeys, batchId: 'b2', at: now })
assert(r2.incoming.length === 0, '已对上的键全部跳过，不产生重复副本')
assert(r2.report.skippedCount === 6, '跳过计数为 6')

console.log('3) 新版本意见（审查员重新确认）产生新键，旧键不阻挡')
const i2c = { ...i2a, reviewedAt: '2026-10-02T00:00:00.000Z', featureText: '传感器采集温湿度（新）', supportIds: ['p1', 'p2'] }
const r3res = reconcileBringBack({ items: [i2c], outbox: outboxOf([i2c]), features, appliedKeys: r1.appliedKeys, batchId: 'b3', at: now })
const rc = r3res.incoming.find(x => x.itemId === 'r2')!
assert(rc.state === 'active' && rc.key === reviewKey(i2c), '重新确认后的新版本按最新快照 active，且键不同于旧版本')
assert(r3res.report.skippedCount === 0, '新版本不被旧键幂等拦截')

console.log('4) 指纹稳定性：段落顺序不同但集合相同 → 同一指纹')
assert(featureFingerprint('a', ['p1', 'p2']) === featureFingerprint('a', ['p2', 'p1']), '段落顺序不影响对账')
assert(featureFingerprint(' a ', ['p1']) === featureFingerprint('a', ['p1']), '正文首尾空白不影响对账')
assert(featureFingerprint('a', ['p1']) !== featureFingerprint('b', ['p1']), '正文不同指纹不同')

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
