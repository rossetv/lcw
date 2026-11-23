import test from 'node:test'
import assert from 'node:assert/strict'
import { renderStatusRows } from '../../lib/status.mjs'
import { buildView, renderCard } from '../../lib/card.mjs'
import { bannerFor } from '../../lib/banner.mjs'
import { usageFact } from '../../hooks/boxes.mjs'
import { measureStep, wakeDue } from '../../hooks/lcw-mod.mjs'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const resetsAt = '2026-11-22T12:00:00Z'
const quota = { sourceId: 'external-quota', revision: 'r1', requestId: 'q2', accountKey: 'a'.repeat(64), observedAt: NOW, status: 'ok', hold: false, percentUsed: 42, resetsAt }
const state = { id: 'x', stage: 'Build', status: 'running', markPercent: 75, weekAtStart: 5, weekResetsAt: resetsAt }
const usage = { sevenDay: { percentUsed: 99, resetsAt } }
const text = rows => rows.map(row => row.map(s => s.t).join('')).join('\n')

test('external status uses its percentage and explicit failure state instead of native usage or dollars', () => {
  for (const width of [40, 100]) {
    const ok = text(renderStatusRows({ quota, weekUsedPercent: 99, markPercent: 75, money: { spentUsd: 500, markUsd: 1000, capUsd: 2000 } }, { width, now: NOW }))
    assert.match(ok, /42%/)
    assert.doesNotMatch(ok, /99%|\$/)
    for (const status of ['unavailable', 'refused', 'stale']) {
      const failed = text(renderStatusRows({ quota: { ...quota, status, hold: true }, weekUsedPercent: 99, markPercent: 75 }, { width, now: NOW }))
      assert.match(failed, new RegExp(status))
      assert.doesNotMatch(failed, /42%|99%|spare/)
    }
  }
})

test('external holds show their cause without promising a reset wake or a mark raise', () => {
  const gate = { unit: 'quota', reason: 'mark', markPercent: 75, resetsAt, at: NOW }
  for (const status of ['unavailable', 'refused', 'stale']) {
    const q = { ...quota, status, hold: true }
    const view = buildView({ state, usage, gate, quota: q, now: NOW })
    const out = text(renderCard(view, { width: 100 }))
    assert.equal(view.mode, 'paused')
    assert.equal(view.share, null)
    assert.equal(view.money, null)
    assert.match(out, new RegExp(status))
    assert.doesNotMatch(out, /resumes in|run up to|\$/)
    const fact = usageFact({ state, session: { billing: 'subscription' }, usage, quota: q, now: NOW })
    const banner = bannerFor({ now: NOW, run: { ...state, title: 'x', status: 'paused', pausedReason: 'mark' }, usage: fact })
    assert.match(banner.title, new RegExp(status))
    assert.equal(banner.options.some(([, label]) => /Run up to/.test(label)), false)
  }
})

test('a recovered external driver ignores its retained hold gate but never invents a run share across accounts', () => {
  const gate = { unit: 'quota', reason: 'mark', at: NOW - 1000 }
  const view = buildView({ state, usage, gate, quota, now: NOW })
  assert.equal(view.mode, 'running')
  assert.equal(view.share, null)
  assert.equal(buildView({ state: { ...state, status: 'finished', totals: { sharePercent: 88 } }, quota, now: NOW }).share, null)
  assert.equal(usageFact({ state, usage, quota, now: NOW }).usedPercent, 42)
  const native = buildView({ state, usage, now: NOW })
  assert.equal(native.share, 94)
})

test('an external default mark stays at the evaluated 100 percent in facts and card', () => {
  const withoutMark = { ...state, markPercent: undefined }
  assert.equal(usageFact({ state: withoutMark, quota, now: NOW }).markPercent, 100)
  assert.equal(buildView({ state: withoutMark, quota, now: NOW }).mark, 100)
})

test('disabling external quota restores only its saved billing while a broken source remains subscription-backed', () => {
  for (const billing of ['payg', 'subscription', 'unclear', undefined]) {
    const session = { billing: 'subscription', quotaSelection: { sourceId: 'external-quota' }, quotaDefaultBilling: billing }
    const restored = measureStep(session, null, { weekly: null, cost: undefined, quota: null }, NOW)
    assert.equal(restored.billing, billing ?? 'unclear')
    const held = measureStep(session, null, { weekly: null, cost: 10, quota: { ...quota, status: 'unavailable', hold: true } }, NOW)
    assert.equal(held.billing, 'subscription')
    assert.equal(held.record, null)
  }
})

test('external recovery requires fresh allowable evidence rather than an expired reset', () => {
  const gate = { unit: 'quota', sourceId: quota.sourceId, revision: 'r1', requestId: 'q1', accountKey: quota.accountKey, resetsAt: '2026-11-18T11:00:00Z', at: NOW - 1000 }
  assert.equal(wakeDue(gate, NOW, null, 'subscription'), false)
  for (const q of [{ ...quota, hold: true }, { ...quota, blocked: true }, { ...quota, status: 'stale' }, { ...quota, sourceId: 'another-source' }, { ...quota, requestId: undefined }, { ...quota, requestId: 'q1' }, { ...quota, observedAt: NOW - 2000 }]) {
    assert.equal(wakeDue(gate, NOW, null, 'subscription', q), false)
  }
  assert.equal(wakeDue(gate, NOW, null, 'subscription', quota), true)
})
