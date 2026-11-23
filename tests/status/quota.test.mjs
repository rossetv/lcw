import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmp, makeRepo, run, readJson } from '../core/helpers.mjs'
import { quotaFile, sessionFile, usageFile, spendFile } from '../../lib/key.mjs'

const script = fileURLToPath(new URL('../../scripts/statusline.mjs', import.meta.url))
const now = Date.parse('2026-02-02T12:00:00Z')
const reset = '2026-02-05T12:00:00.000Z'
const put = (file, value) => { fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)) }
function fixture() {
  const home = tmp('quota-status'), cwd = makeRepo()
  const state = { v: 1, sourceId: 'external-quota', enabled: true, revision: 'one', endpoint: 'https://proxy.test', command: 'false', lastAttemptAt: now, cache: { revision: 'one', requestId: 'read-one', attemptedAt: now, completedAt: now, result: { v: 1, status: 'ok', accountKey: 'a'.repeat(64), weekly: { percentUsed: 42, resetsAt: reset }, blocked: false } } }
  put(quotaFile(home), state)
  const tick = (id, extra = {}, endpoint = '') => run(script, [], { home, cwd, env: { LCW_NOW: String(now), ANTHROPIC_BASE_URL: endpoint, COLUMNS: '120' }, input: JSON.stringify({ session_id: id, cwd, cost: { total_cost_usd: 23 }, ...extra }) }).out.replace(/\x1b\[[0-9;]*m/g, '')
  return { home, state, tick }
}
const native = (used_percentage) => ({ rate_limits: { seven_day: { used_percentage, resets_at: Date.parse(reset) / 1000 } } })

test('simultaneous external ticks cannot change native usage or contribute estimated money', () => {
  const f = fixture()
  f.tick('native', native(7))
  const proxy = f.tick('proxy', { ...native(99), transcript_path: '/tmp/proxy-canonical.jsonl' }, 'https://proxy.test/')
  assert.equal(readJson(usageFile(f.home)).sevenDay.percentUsed, 7)
  assert.match(proxy, /42%/)
  assert.doesNotMatch(proxy, /99%|\$/)
  for (const id of ['proxy', 'proxy-canonical']) {
    assert.equal(readJson(sessionFile(f.home, id)).billing, 'subscription')
    assert.equal(fs.existsSync(spendFile(f.home, id)), false)
  }
  const other = f.tick('native')
  assert.match(other, /7%/)
  assert.doesNotMatch(other, /42%/)
})

test('failed and missing external state stays subscription-backed and displays unavailable instead of dollars', () => {
  const f = fixture()
  f.tick('proxy', {}, 'https://proxy.test')
  f.state.cache.result = { v: 1, status: 'unavailable', code: 'network' }
  put(quotaFile(f.home), f.state)
  assert.match(f.tick('proxy'), /unavailable/)
  fs.unlinkSync(quotaFile(f.home))
  const text = f.tick('proxy')
  assert.match(text, /unavailable/)
  assert.doesNotMatch(text, /\$|42%/)
  assert.equal(readJson(sessionFile(f.home, 'proxy')).billing, 'subscription')
  assert.equal(fs.existsSync(spendFile(f.home, 'proxy')), false)
})
