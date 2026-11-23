import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, run, lcw, START_HOOK, GATE_HOOK, LIMIT_HOOK, readJson } from './helpers.mjs'
import { quotaFile, sessionFile, usageFile, spendFile } from '../../lib/key.mjs'
import { applyGate } from '../../scripts/lib/gate.mjs'
import { readMoney, recordSpend, spendRecords } from '../../scripts/lib/money.mjs'

const now = Date.parse('2026-02-02T12:00:00Z')
const reset = '2026-02-05T12:00:00.000Z'
const selection = { sourceId: 'external-quota' }
const put = (file, value) => { fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)) }
const getSession = (h, id) => readJson(sessionFile(h, id))
function withHome(home, fn) {
  const previous = process.env.LCW_HOME
  process.env.LCW_HOME = home
  try { return fn() } finally { if (previous === undefined) delete process.env.LCW_HOME; else process.env.LCW_HOME = previous }
}

function gatedFixture() {
  const f = fixture()
  put(sessionFile(f.home, 'proxy'), { billing: 'subscription', quotaSelection: selection })
  const paths = { gate: `${f.home}/gate` }
  const state = { driver: 'proxy', markPercent: 40, status: 'running' }
  return { ...f, paths, runState: state, apply: () => withHome(f.home, () => applyGate(paths, state, null, now)) }
}

test('empty and dead gate locks recover while a live contender fails closed without touching its gate', () => {
  for (const owner of [null, '99999999-11111111-1111-4111-8111-111111111111', `${process.pid}-22222222-2222-4222-8222-222222222222`]) {
    const f = gatedFixture()
    const lock = `${f.paths.gate}.lock`
    fs.mkdirSync(lock)
    if (owner) fs.writeFileSync(`${lock}/${owner}`, '')
    if (owner?.startsWith(`${process.pid}-`)) {
      f.runState.markPercent = 80
      assert.equal(f.apply(), true)
      assert.equal(fs.existsSync(f.paths.gate), false)
      assert.ok(fs.existsSync(`${lock}/${owner}`))
    } else {
      assert.equal(f.apply(), true)
      assert.equal(readJson(f.paths.gate).unit, 'quota')
      assert.equal(fs.existsSync(lock), false)
    }
  }
})

test('dead private gate locks are reclaimed at crash boundaries without touching live or unrelated directories', () => {
  const f = gatedFixture()
  const base = `${f.paths.gate}.lock.`
  const deadEmpty = `${base}99999999-11111111-1111-4111-8111-111111111111`
  const deadMarked = `${base}99999999-22222222-2222-4222-8222-222222222222`
  const live = `${base}${process.pid}-33333333-3333-4333-8333-333333333333`
  const foreign = `${base}99999999-44444444-4444-4444-8444-444444444444`
  const linked = `${base}99999999-55555555-5555-4555-8555-555555555555`
  for (const dir of [deadEmpty, deadMarked, live, foreign]) fs.mkdirSync(dir)
  fs.writeFileSync(`${deadMarked}/${deadMarked.slice(base.length)}`, '')
  fs.writeFileSync(`${foreign}/unrelated`, 'keep')
  fs.symlinkSync(foreign, linked)
  assert.equal(f.apply(), true)
  assert.equal(fs.existsSync(deadEmpty), false)
  assert.equal(fs.existsSync(deadMarked), false)
  for (const dir of [live, foreign, linked]) assert.ok(fs.existsSync(dir))
  assert.equal(fs.readFileSync(`${foreign}/unrelated`, 'utf8'), 'keep')
})

test('a new hold after allowable evidence gets a new occurrence without resetting a human pause', () => {
  const f = gatedFixture()
  assert.equal(f.apply(), true)
  const first = readJson(f.paths.gate)
  assert.equal(f.apply(), true)
  assert.equal(readJson(f.paths.gate).holdId, first.holdId)
  f.runState.markPercent = 80
  assert.equal(f.apply(), false)
  assert.equal(readJson(f.paths.gate).recoveredBy.requestId, 'read-one')
  f.runState.markPercent = 40
  assert.equal(f.apply(), true)
  assert.notEqual(readJson(f.paths.gate).holdId, first.holdId)
  f.runState.status = 'paused'
  f.runState.pausedReason = 'human'
  const before = fs.readFileSync(f.paths.gate, 'utf8')
  f.runState.markPercent = 80
  assert.equal(f.apply(), false)
  assert.equal(fs.readFileSync(f.paths.gate, 'utf8'), before)
  assert.equal(f.runState.status, 'paused')
})

test('an older allowable snapshot cannot overwrite a hold observed before gate acquisition', () => {
  const f = gatedFixture()
  f.runState.markPercent = 80
  f.apply()
  const rename = fs.renameSync
  try {
    fs.renameSync = (from, to) => {
      if (to === `${f.paths.gate}.lock`) {
        f.state.cache.requestId = 'newer-refusal'
        f.state.cache.result = { v: 1, status: 'refused', code: 'provider-refused' }
        f.save()
      }
      return rename(from, to)
    }
    assert.equal(f.apply(), true)
  } finally { fs.renameSync = rename }
  const gate = readJson(f.paths.gate)
  assert.equal(gate.status, 'refused')
  assert.equal(gate.requestId, 'newer-refusal')
  assert.equal(gate.recoveredBy, undefined)
})

test('external classification excludes old and new estimated money even before hooks rewrite billing', () => {
  const f = fixture()
  put(sessionFile(f.home, 'proxy'), { billing: 'payg', quotaSelection: selection })
  const record = { v: 1, base: 0, max: 30, q: { [Math.floor(now / 900000)]: 30 } }
  put(spendFile(f.home, 'proxy'), record)
  withHome(f.home, () => {
    assert.equal(readMoney({ sessionId: 'proxy', now }), null)
    assert.deepEqual(spendRecords(now), [])
    assert.equal(recordSpend('proxy', 99, now), null)
  })
  assert.deepEqual(readJson(spendFile(f.home, 'proxy')), record)
})

function fixture() {
  const home = tmp('quota-home'), cwd = makeRepo()
  const options = { home, cwd, session: 'proxy', env: { LCW_NOW: String(now), ANTHROPIC_BASE_URL: 'https://proxy.test', LCW_AUTH_STATUS_JSON: '{"authMethod":"api_key"}' } }
  const state = { v: 1, sourceId: selection.sourceId, enabled: true, revision: 'one', endpoint: 'https://proxy.test', command: 'false', lastAttemptAt: now, cache: { revision: 'one', requestId: 'read-one', attemptedAt: now, completedAt: now, result: { v: 1, status: 'ok', accountKey: 'a'.repeat(64), weekly: { percentUsed: 42, resetsAt: reset }, blocked: false } } }
  put(quotaFile(home), state)
  put(usageFile(home), { sevenDay: { percentUsed: 5, resetsAt: reset }, at: now })
  const hook = (script, id = 'proxy', extra = {}) => run(script, [], { ...options, env: { ...options.env, ...(id === 'native' ? { ANTHROPIC_BASE_URL: '' } : {}) }, input: JSON.stringify({ session_id: id, cwd, ...extra }) })
  return { home, cwd, options, state, hook, save: () => put(quotaFile(home), state) }
}

test('startup binds external selection to both resume identities without downgrading during an outage', () => {
  const f = fixture()
  delete f.state.cache
  f.save()
  f.hook(START_HOOK, 'alias', { transcript_path: '/tmp/canonical.jsonl' })
  for (const id of ['canonical', 'alias']) {
    assert.deepEqual(getSession(f.home, id).quotaSelection, selection)
    assert.equal(getSession(f.home, id).billing, 'subscription')
  }
  fs.writeFileSync(quotaFile(f.home), '{')
  f.hook(START_HOOK, 'alias', { transcript_path: '/tmp/canonical.jsonl' })
  assert.equal(getSession(f.home, 'alias').billing, 'subscription')
  assert.equal(f.hook(GATE_HOOK, 'alias').code, 2)
})

test('explicit off and a nonmatching resumed endpoint restore default billing on every identity', () => {
  for (const off of [true, false]) {
    const f = fixture()
    put(sessionFile(f.home, 'canonical'), { billing: 'payg' })
    f.hook(START_HOOK, 'alias', { transcript_path: '/tmp/canonical.jsonl' })
    if (off) { f.state.enabled = false; f.save() }
    else f.options.env.ANTHROPIC_BASE_URL = 'https://elsewhere.test'
    f.hook(START_HOOK, 'alias', { transcript_path: '/tmp/canonical.jsonl' })
    for (const id of ['canonical', 'alias']) {
      assert.equal(getSession(f.home, id).billing, 'payg')
      assert.equal(getSession(f.home, id).quotaSelection, null)
    }
  }
})

test('launches check both the launching session and driver even without a prior gate file', () => {
  for (const externalDriver of [true, false]) {
    const f = fixture()
    put(sessionFile(f.home, 'proxy'), { billing: 'subscription', quotaSelection: selection, markPercent: 40 })
    put(sessionFile(f.home, 'native'), { billing: 'subscription', markPercent: 80 })
    const driver = externalDriver ? 'proxy' : 'native'
    const launcher = externalDriver ? 'native' : 'proxy'
    const r = lcw(['start', 'dual', '--title', 'Two sources'], { ...f.options, session: driver, env: { ...f.options.env, ANTHROPIC_BASE_URL: externalDriver ? 'https://proxy.test' : '' } })
    assert.equal(r.code, 0, r.out)
    const dir = /^folder: (.+)$/m.exec(r.out)[1]
    put(sessionFile(f.home, launcher), { ...getSession(f.home, launcher), runDir: dir })
    assert.equal(f.hook(GATE_HOOK, launcher).code, 2)
    f.state.cache.result.weekly.percentUsed = 10
    f.save()
    assert.equal(f.hook(GATE_HOOK, launcher).code, 0)
    put(usageFile(f.home), { sevenDay: { percentUsed: 90, resetsAt: reset }, at: now })
    assert.equal(f.hook(GATE_HOOK, launcher).code, 2)
  }
})

test('refusal and reset expiry hold hooks independently of the native cache and percentage mark', () => {
  const f = fixture()
  put(sessionFile(f.home, 'proxy'), { billing: 'subscription', quotaSelection: selection, markPercent: 80 })
  for (const result of [
    { v: 1, status: 'refused', code: 'provider-refused' },
    { ...f.state.cache.result, blocked: true },
    { ...f.state.cache.result, weekly: { percentUsed: 1, resetsAt: '2026-02-02T11:00:00.000Z' } },
  ]) {
    f.state.cache.result = result
    f.save()
    assert.equal(f.hook(GATE_HOOK).code, 2)
    const limit = f.hook(LIMIT_HOOK, 'proxy', { hook_event_name: 'UserPromptSubmit' })
    assert.match(limit.out, /STOP/)
    assert.doesNotMatch(limit.out, /\$|5%/)
  }
})

test('taking a native run preserves the new driver selection and applies its external hold', () => {
  const f = fixture()
  const nativeOptions = { ...f.options, session: 'native', env: { ...f.options.env, ANTHROPIC_BASE_URL: '' } }
  put(sessionFile(f.home, 'native'), { billing: 'subscription', markPercent: 90 })
  const started = lcw(['start', 'handoff', '--title', 'Source handoff'], nativeOptions)
  const dir = /^folder: (.+)$/m.exec(started.out)[1]
  const state = readJson(`${dir}/state.json`)
  const old = new Date(now - 20 * 60000)
  for (const file of ['state.json', 'ledger.md']) fs.utimesSync(`${dir}/${file}`, old, old)
  f.state.cache.result = { v: 1, status: 'refused', code: 'provider-refused' }
  f.save()
  const taken = lcw(['take', state.id], f.options)
  assert.equal(taken.code, 0, taken.out)
  assert.equal(readJson(`${dir}/state.json`).driver, 'proxy')
  assert.equal(readJson(`${dir}/state.json`).weekAtStart, null)
  assert.deepEqual(getSession(f.home, 'proxy').quotaSelection, selection)
  assert.equal(getSession(f.home, 'native').quotaSelection, undefined)
  assert.equal(readJson(`${dir}/gate`).status, 'refused')
  assert.match(lcw(['usage'], f.options).out, /refused/)
})

test('usage, marks and resume use the driver quota and retain a hold until an allowable observation', () => {
  const f = fixture()
  put(sessionFile(f.home, 'proxy'), { billing: 'subscription', quotaSelection: selection, markPercent: 40 })
  const started = lcw(['start', 'quota', '--title', 'Quota run'], f.options)
  const dir = /^folder: (.+)$/m.exec(started.out)[1]
  assert.equal(readJson(`${dir}/state.json`).weekAtStart, 42)
  const cli = (...args) => lcw(args, f.options)
  assert.match(cli('usage').out, /42%/)
  assert.equal(readJson(`${dir}/gate`).unit, 'quota')
  assert.match(cli('mark', '80').out, /ok/)
  f.state.cache.result = { v: 1, status: 'unavailable', code: 'network' }
  f.save()
  cli('pause', 'mark')
  assert.equal(cli('resume').code, 1)
  assert.equal(readJson(`${dir}/state.json`).status, 'paused')
  const usage = cli('usage').out
  assert.match(usage, /unavailable/)
  assert.doesNotMatch(usage, /\$|week: 5%|\nok/)
  assert.equal(cli('mark', '100').code, 0)
  assert.equal(cli('resume').code, 1)
  f.state.cache.requestId = 'fresh-two'
  f.state.cache.result = { v: 1, status: 'ok', accountKey: 'b'.repeat(64), weekly: { percentUsed: 3, resetsAt: reset }, blocked: false }
  f.save()
  assert.equal(cli('resume').code, 0)
  assert.equal(readJson(`${dir}/state.json`).markPercent, 100)
})
