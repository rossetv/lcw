import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEndpoint, parseQuotaResult, selectQuota, evaluateQuota } from '../../lib/quota.mjs'

const at = Date.parse('2026-01-01T12:00:00.000Z')
const accountKey = 'a'.repeat(64)
const ok = { v: 1, status: 'ok', accountKey, weekly: { percentUsed: 42, resetsAt: '2026-01-02T12:00:00.000Z' }, blocked: false }
const selection = { sourceId: 'external-quota', endpoint: 'http://localhost:8080/v1' }
const state = (result = ok) => ({ v: 1, enabled: true, sourceId: selection.sourceId, revision: 'r1', endpoint: 'http://localhost:8080/v1', command: 'adapter', cache: { revision: 'r1', requestId: 'q1', attemptedAt: at, completedAt: at, result } })

test('endpoint matching canonicalizes URLs but rejects ambiguous selectors', () => {
  assert.equal(normalizeEndpoint('HTTPS://EXAMPLE.COM:443/v1/'), 'https://example.com/v1')
  for (const endpoint of ['https://u:p@example.com', 'https://@example.com', 'https:example.com', 'http:///example.com', 'https://example.com?', 'https://example.com#', 'file:///tmp/a', ' https://example.com', 'https:\\example.com', 'https://example.com/\n']) assert.equal(normalizeEndpoint(endpoint), null)
  assert.deepEqual(selectQuota('http://LOCALHOST:8080/v1/', state()), selection)
  assert.equal(selectQuota('https://example.com', state()), null)
  assert.equal(selectQuota(undefined, state()), null)
})

test('a null configured endpoint neither selects sessions nor authorizes an existing selection', () => {
  const invalid = { ...state(), endpoint: null }
  assert.equal(selectQuota(undefined, invalid), null)
  assert.equal(selectQuota(null, invalid), null)
  assert.equal(evaluateQuota(selection, invalid, at, 80).hold, true)
  assert.equal(evaluateQuota(selection, invalid, at, 80).code, 'config-unavailable')
})

test('missing or noncanonical endpoint bindings hold without borrowing global cache evidence', () => {
  for (const binding of [{ sourceId: selection.sourceId }, { ...selection, endpoint: `${selection.endpoint}/` }, { ...selection, endpoint: null }]) {
    const view = evaluateQuota(binding, state(), at, 80)
    assert.equal(view.hold, true)
    assert.equal(view.code, 'config-unavailable')
    for (const field of ['accountKey', 'requestId', 'percentUsed', 'historical']) assert.equal(view[field], undefined)
  }
})

test('wire validation accepts only complete bounded successes and allowlisted failures', () => {
  assert.deepEqual(parseQuotaResult(JSON.stringify({ ...ok, secret: 'discard' }), at), ok)
  assert.equal(parseQuotaResult(JSON.stringify({ ...ok, weekly: { percentUsed: 1, resetsAt: '2026-01-02T13:00:00+01:00' } }), at).weekly.resetsAt, ok.weekly.resetsAt)
  for (const weekly of [{ ...ok.weekly, percentUsed: -1 }, { ...ok.weekly, percentUsed: 101 }, { ...ok.weekly, percentUsed: null }, { ...ok.weekly, resetsAt: '2026-01-01T12:00:00.000Z' }, { ...ok.weekly, resetsAt: '2026-02-30T12:00:00Z' }]) assert.equal(parseQuotaResult(JSON.stringify({ ...ok, weekly }), at).status, 'unavailable')
  for (const bad of [{ ...ok, blocked: 0 }, { ...ok, accountKey: 'raw-account-id' }, { ...ok, weekly: null }, { v: 2, status: 'ok' }, { v: 1, status: 'refused', code: 'a secret' }]) assert.equal(parseQuotaResult(JSON.stringify(bad), at).code, 'invalid-response')
  assert.deepEqual(parseQuotaResult('{not json secret', at), { v: 1, status: 'unavailable', code: 'invalid-response' })
  for (const status of ['refused', 'unavailable']) assert.deepEqual(parseQuotaResult(JSON.stringify({ v: 1, status, code: 'auth', accountKey }), at), { v: 1, status, code: 'auth', accountKey })
})

test('selected sessions hold on missing state, failure, stale data and reset, but explicit off restores default', () => {
  assert.equal(evaluateQuota(null, state(), at, 80), null)
  assert.equal(evaluateQuota(selection, null, at, 80).hold, true)
  assert.equal(evaluateQuota(selection, { v: 1, enabled: false, sourceId: selection.sourceId, revision: 'off' }, at, 80), null)
  assert.equal(evaluateQuota(selection, state(), at, 80).hold, false)
  assert.equal(evaluateQuota(selection, state(), at, 42).hold, true)
  assert.equal(evaluateQuota(selection, state({ ...ok, blocked: true }), at, 80).hold, true)
  assert.equal(evaluateQuota(selection, state({ v: 1, status: 'refused', code: 'provider-refused' }), at, 80).status, 'refused')
  assert.equal(evaluateQuota(selection, state(), at + 600000, 80).hold, true)
  const reset = state({ ...ok, weekly: { ...ok.weekly, resetsAt: '2026-01-01T12:01:00.000Z' } })
  assert.equal(evaluateQuota(selection, reset, at + 60000, 80).hold, true)
  const failed = state({ v: 1, status: 'unavailable', code: 'network' })
  failed.cache.lastGood = { result: ok, observedAt: at }
  const view = evaluateQuota(selection, failed, at + 1000, 80)
  assert.equal(view.hold, true)
  assert.equal(view.percentUsed, undefined)
  assert.equal(view.historical.percentUsed, 42)
  assert.equal(evaluateQuota(selection, failed, at + 600000, 80).historical, undefined)
  failed.cache.result.accountKey = 'b'.repeat(64)
  assert.equal(evaluateQuota(selection, failed, at + 1000, 80).historical, undefined)
})

test('obsolete revisions and abandoned refresh claims cannot authorize work', () => {
  const s = state()
  s.cache.revision = 'obsolete'
  assert.equal(evaluateQuota(selection, s, at, 80).hold, true)
  s.cache.revision = s.revision
  s.claim = { revision: 'r1', requestId: 'q2', startedAt: at }
  assert.equal(evaluateQuota(selection, s, at + 1000, 80).hold, false)
  assert.equal(evaluateQuota(selection, s, at + 35000, 80).hold, true)
})
