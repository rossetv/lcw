import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmp, makeRepo, run, lcw, START_HOOK, GATE_HOOK, LIMIT_HOOK, readJson } from './helpers.mjs'
import { quotaFile, sessionFile, usageFile, spendFile } from '../../lib/key.mjs'
import { applyGate, setSessionMark, sessionMark, sessionIds } from '../../scripts/lib/gate.mjs'
import { noteQuotaSession } from '../../scripts/lib/quota-session.mjs'
import { readMoney, recordSpend, spendRecords } from '../../scripts/lib/money.mjs'

const now = Date.parse('2026-02-02T12:00:00Z')
const reset = '2026-02-05T12:00:00.000Z'
const selection = { sourceId: 'external-quota', endpoint: 'https://proxy.test' }
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

test('explicit canonical unselection overrides stale alias subscription in money reads and writes', () => {
  const f = fixture()
  const canonical = { sessionCanonicalId: 'canonical', quotaSelection: null, billing: 'payg', markPercent: 80 }
  put(sessionFile(f.home, 'canonical'), canonical)
  put(sessionFile(f.home, 'alias'), { sessionCanonicalId: 'canonical', quotaSelection: selection, billing: 'subscription', quotaDefaultBilling: 'payg' })
  put(sessionFile(f.home, 'independent'), { quotaSelection: selection, billing: 'subscription' })
  const record = (usd) => ({ v: 1, base: 0, max: usd, q: { [Math.floor(now / 900000)]: usd } })
  put(spendFile(f.home, 'alias'), record(30))
  put(spendFile(f.home, 'independent'), record(900))
  withHome(f.home, () => {
    assert.equal(readMoney({ sessionId: 'alias', now })?.spentUsd, 30)
    assert.equal(readMoney({ sessionId: 'canonical', now })?.spentUsd, 30)
    assert.equal(recordSpend('alias', 45, now)?.max, 45)
    assert.equal(readMoney({ sessionId: ['canonical', 'alias'], now })?.spentUsd, 45)
    fs.writeFileSync(quotaFile(f.home), '{')
    assert.equal(readMoney({ sessionId: 'independent', now }), null)
    const { quotaSelection, ...unknownSelection } = canonical
    put(sessionFile(f.home, 'canonical'), unknownSelection)
    assert.equal(readMoney({ sessionId: 'alias', now }), null)
    assert.equal(recordSpend('alias', 80, now), null)
    put(sessionFile(f.home, 'canonical'), canonical)
    put(sessionFile(f.home, 'native-payg'), { billing: 'payg' })
    put(spendFile(f.home, 'native-payg'), record(5))
    assert.equal(readMoney({ sessionId: 'alias', now })?.spentUsd, 50)
    assert.equal(readMoney({ sessionId: 'native-payg', now })?.spentUsd, 50)
  })
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

test('the stop hook checks native and dollar driver holds independently of an external launching session', () => {
  for (const billing of ['subscription', 'payg']) {
    const f = fixture()
    f.state.cache.result.weekly.percentUsed = 10
    f.save()
    put(sessionFile(f.home, 'driver'), { billing, markPercent: 75 })
    put(sessionFile(f.home, 'proxy'), { billing: 'subscription', quotaSelection: selection, markPercent: 75 })
    const spend = (usd) => put(spendFile(f.home, 'driver'), { v: 1, base: 0, max: usd, q: { [Math.floor(now / 900000)]: usd } })
    if (billing === 'payg') spend(3500)
    else put(usageFile(f.home), { sevenDay: { percentUsed: 90, resetsAt: reset }, at: now })
    const started = lcw(['start', 'driver-stop', '--title', 'Driver controls'], { ...f.options, session: 'driver', env: { ...f.options.env, ANTHROPIC_BASE_URL: '' } })
    const dir = /^folder: (.+)$/m.exec(started.out)[1]
    put(sessionFile(f.home, 'proxy'), { ...getSession(f.home, 'proxy'), runDir: dir })
    for (const hook_event_name of ['UserPromptSubmit', 'PostToolUse']) {
      const stopped = f.hook(LIMIT_HOOK, 'proxy', { hook_event_name })
      assert.match(stopped.out, /STOP/)
      assert.match(stopped.out, billing === 'payg' ? /\$3,500/ : /90%/)
      assert.doesNotMatch(stopped.out, /10%/)
    }
    if (billing === 'payg') spend(2000)
    else put(usageFile(f.home), { sevenDay: { percentUsed: 5, resetsAt: reset }, at: now })
    for (const hook_event_name of ['UserPromptSubmit', 'PostToolUse']) assert.equal(f.hook(LIMIT_HOOK, 'proxy', { hook_event_name }).out, '')
    f.state.cache.result.weekly.percentUsed = 95
    f.save()
    assert.match(f.hook(LIMIT_HOOK, 'proxy', { hook_event_name: 'UserPromptSubmit' }).out, /STOP.*95%/)
  }
})

test('replacing the configured endpoint cannot transfer permission to an already selected session', () => {
  const f = fixture()
  f.state.cache.result.weekly.percentUsed = 95
  f.save()
  f.hook(START_HOOK)
  assert.equal(f.hook(GATE_HOOK).code, 2)
  f.state.endpoint = 'https://other.test'
  f.state.revision = 'two'
  f.state.cache.revision = 'two'
  f.state.cache.requestId = 'new-endpoint'
  f.state.cache.result.weekly.percentUsed = 10
  f.save()
  assert.equal(f.hook(GATE_HOOK).code, 2)
  assert.deepEqual(getSession(f.home, 'proxy').quotaSelection, selection)
  assert.match(lcw(['usage'], f.options).out, /held/)
  f.hook(START_HOOK)
  assert.equal(f.hook(GATE_HOOK).code, 2)
  assert.deepEqual(getSession(f.home, 'proxy').quotaSelection, selection)
  f.state.endpoint = selection.endpoint
  f.state.revision = 'three'
  f.state.cache.revision = 'three'
  f.state.cache.requestId = 'same-endpoint-replacement'
  f.save()
  assert.equal(f.hook(GATE_HOOK).code, 0)
})

test('an unbound saved selection holds until its own startup observes a matching endpoint', () => {
  const f = fixture()
  const legacy = { sourceId: selection.sourceId }
  put(sessionFile(f.home, 'proxy'), { quotaSelection: legacy, billing: 'subscription', quotaDefaultBilling: 'payg' })
  assert.equal(f.hook(GATE_HOOK).code, 2)
  assert.deepEqual(getSession(f.home, 'proxy').quotaSelection, legacy)
  f.options.env.ANTHROPIC_BASE_URL = ''
  f.hook(START_HOOK)
  assert.equal(f.hook(GATE_HOOK).code, 2)
  assert.equal(getSession(f.home, 'proxy').billing, 'subscription')
  f.options.env.ANTHROPIC_BASE_URL = 'https://PROXY.test:443/'
  f.hook(START_HOOK)
  assert.deepEqual(getSession(f.home, 'proxy').quotaSelection, selection)
  assert.equal(f.hook(GATE_HOOK).code, 0)
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

test('a resumed session uses the current explicit mark for both raises and lowerings', () => {
  const f = fixture()
  f.state.cache.result.weekly.percentUsed = 85
  f.save()
  put(sessionFile(f.home, 'old'), { billing: 'subscription', quotaSelection: selection, markPercent: 75 })
  const options = { ...f.options, session: 'current' }
  assert.match(lcw(['mark', '100'], options).out, /ok/)
  const input = { transcript_path: '/tmp/old.jsonl' }
  assert.equal(f.hook(GATE_HOOK, 'current', input).code, 0)
  assert.equal(lcw(['mark', '70'], options).code, 0)
  assert.equal(f.hook(GATE_HOOK, 'current', input).code, 2)
  assert.match(f.hook(LIMIT_HOOK, 'current', { ...input, hook_event_name: 'UserPromptSubmit' }).out, /STOP/)
})

test('sequential resume identities share the current mark even when the run names a previous alias', () => {
  const f = fixture()
  f.state.cache.result.weekly.percentUsed = 85
  f.save()
  const first = { ...f.options, session: 'original' }
  put(sessionFile(f.home, 'original'), { billing: 'subscription', quotaSelection: selection, markPercent: 75 })
  const started = lcw(['start', 'aliases', '--title', 'Alias marks'], first)
  const dir = /^folder: (.+)$/m.exec(started.out)[1]
  f.hook(START_HOOK, 'middle', { transcript_path: '/tmp/original.jsonl' })
  f.hook(START_HOOK, 'latest', { transcript_path: '/tmp/original.jsonl' })
  const latest = { ...f.options, session: 'latest' }
  assert.equal(lcw(['mark', '100'], latest).code, 0)
  const state = readJson(`${dir}/state.json`)
  put(`${dir}/state.json`, { ...state, driver: 'middle', markPercent: 75 })
  assert.equal(f.hook(GATE_HOOK, 'latest', { transcript_path: '/tmp/original.jsonl' }).code, 0)
  assert.match(lcw(['usage'], latest).out, /mark: 100%/)
  assert.match(lcw(['status'], latest).out, /mark: 100%/)
  const reconciled = run(fileURLToPath(new URL('../../scripts/gate-reconcile.mjs', import.meta.url)), [JSON.stringify({ sessionId: 'latest', action: 'sync', expectedGate: readJson(`${dir}/gate`) })], latest)
  assert.equal(JSON.parse(reconciled.out).hold, false)
  assert.equal(lcw(['mark', '70'], latest).code, 0)
  assert.equal(f.hook(GATE_HOOK, 'middle', { transcript_path: '/tmp/original.jsonl' }).code, 2)
})

test('native alias marks clear the other unit and cyclic or live foreign identities stay separate', () => {
  const f = fixture()
  const original = { billing: 'payg', markPercent: 75 }
  put(sessionFile(f.home, 'native'), original)
  withHome(f.home, () => {
    noteQuotaSession(['native', 'alias'], { endpoint: 'https://elsewhere.test' })
    setSessionMark('alias', { usd: 5500 })
    assert.equal(getSession(f.home, 'native').markPercent, undefined)
    assert.equal(getSession(f.home, 'native').markUsd, 5500)
    setSessionMark('native', 90)
    assert.equal(sessionMark('alias'), 90)
    assert.equal(readMoney({ sessionId: 'alias', now }).markUsd, 3600)
    put(sessionFile(f.home, 'a'), { sessionCanonicalId: 'b', markPercent: 60 })
    put(sessionFile(f.home, 'b'), { sessionCanonicalId: 'a', markPercent: 95 })
    setSessionMark('a', 65)
    assert.equal(getSession(f.home, 'b').markPercent, 95)
    put(sessionFile(f.home, 'foreign'), { sessionCanonicalId: 'foreign', claudePid: process.pid, markPercent: 50 })
    put(sessionFile(f.home, 'separate'), { sessionCanonicalId: 'foreign', markPercent: 80 })
    setSessionMark('separate', 90)
    assert.equal(getSession(f.home, 'foreign').markPercent, 50)
    assert.deepEqual(sessionIds({ session_id: 'separate', transcript_path: '/tmp/foreign.jsonl' }), ['separate'])
    put(sessionFile(f.home, 'driver-alias'), { sessionCanonicalId: 'foreign', claudePid: process.pid, markPercent: 95 })
    const callerPid = process.env.CLAUDE_PID
    process.env.CLAUDE_PID = '99999999'
    try { assert.equal(sessionMark('driver-alias'), 50) }
    finally { if (callerPid === undefined) delete process.env.CLAUDE_PID; else process.env.CLAUDE_PID = callerPid }
  })
  assert.equal(getSession(f.home, 'foreign').markPercent, 50)
})

test('positive startup billing replaces unknown history while genuinely unknown billing stays unknown', () => {
  for (const [auth, expected] of [['{"authMethod":"api_key"}', 'payg'], ['fail', 'unclear']]) {
    const f = fixture()
    put(sessionFile(f.home, 'proxy'), { billing: 'unclear' })
    f.options.env.LCW_AUTH_STATUS_JSON = auth
    f.hook(START_HOOK)
    assert.equal(getSession(f.home, 'proxy').quotaDefaultBilling, expected)
    f.state.enabled = false
    f.save()
    f.options.env.LCW_AUTH_STATUS_JSON = 'fail'
    f.hook(START_HOOK)
    assert.equal(getSession(f.home, 'proxy').billing, expected)
  }
})

test('conditional reconciliation retires only acknowledged obsolete gates and retains newer holds', () => {
  const f = fixture()
  put(sessionFile(f.home, 'proxy'), { billing: 'subscription', quotaSelection: selection, markPercent: 80 })
  const started = lcw(['start', 'old-gate', '--title', 'Source transition'], f.options)
  const dir = /^folder: (.+)$/m.exec(started.out)[1]
  const gate = { reason: 'mark', unit: 'usd', markUsd: 100, usedUsd: 120, retryAt: now + 3600000, at: now - 1000 }
  put(`${dir}/gate`, gate)
  const script = fileURLToPath(new URL('../../scripts/gate-reconcile.mjs', import.meta.url))
  const invoke = (action, expectedGate, expectedQuota) => {
    const result = run(script, [JSON.stringify({ sessionId: 'proxy', action, expectedGate, expectedQuota })], f.options)
    assert.equal(result.code, 0, result.err)
    return JSON.parse(result.out)
  }
  assert.equal(invoke('sync', gate).hold, false)
  assert.deepEqual(readJson(`${dir}/gate`), gate)
  const evidence = { sourceId: selection.sourceId, revision: 'one', requestId: 'read-one', accountKey: 'a'.repeat(64), resetsAt: reset, observedAt: now }
  assert.equal(invoke('ack', Object.fromEntries(Object.entries(gate).reverse()), evidence).ok, true)
  assert.equal(fs.existsSync(`${dir}/gate`), false)
  put(`${dir}/gate`, gate)
  f.state.cache.result = { v: 1, status: 'refused', code: 'provider-refused' }
  f.state.cache.requestId = 'new-refusal'
  f.save()
  assert.equal(invoke('ack', gate, evidence).hold, true)
  assert.ok(fs.existsSync(`${dir}/gate`))
  invoke('sync', gate)
  const newer = readJson(`${dir}/gate`)
  assert.equal(newer.requestId, 'new-refusal')
  assert.equal(invoke('ack', gate, evidence).code, 'superseded')
  assert.deepEqual(readJson(`${dir}/gate`), newer)
  f.state.enabled = false
  f.save()
  assert.equal(invoke('sync', newer).hold, false)
  assert.deepEqual(readJson(`${dir}/gate`), newer)
  assert.equal(invoke('ack', newer, evidence).code, 'superseded')
  assert.equal(invoke('ack', newer).ok, true)
  assert.equal(fs.existsSync(`${dir}/gate`), false)
})

test('legacy retries are serialized and never change run status or trust unsafe helper input', () => {
  const f = fixture()
  const options = { ...f.options, session: 'native', env: { ...f.options.env, ANTHROPIC_BASE_URL: '' } }
  put(sessionFile(f.home, 'native'), { billing: 'payg', markPercent: 75 })
  const started = lcw(['start', 'retry', '--title', 'Retry gate'], options)
  const dir = /^folder: (.+)$/m.exec(started.out)[1]
  const state = readJson(`${dir}/state.json`)
  const script = fileURLToPath(new URL('../../scripts/gate-reconcile.mjs', import.meta.url))
  const invoke = (request) => JSON.parse(run(script, [JSON.stringify(request)], options).out)
  const gate = { reason: 'mark', unit: 'usd', markUsd: 3000, usedUsd: 3500, retryAt: now - 1000, at: now - 5000 }
  const record = (spent) => put(spendFile(f.home, 'native'), { v: 1, base: 0, max: spent, q: { [Math.floor(now / 900000)]: spent } })
  record(3500)
  put(`${dir}/gate`, gate)
  const lock = `${dir}/gate.lock`
  fs.mkdirSync(lock)
  const marker = `${process.pid}-66666666-6666-4666-8666-666666666666`
  fs.writeFileSync(`${lock}/${marker}`, '')
  assert.equal(invoke({ sessionId: 'native', action: 'retry', expectedGate: gate }).code, 'gate-unavailable')
  assert.deepEqual(readJson(`${dir}/gate`), gate)
  fs.unlinkSync(`${lock}/${marker}`)
  fs.rmdirSync(lock)
  assert.equal(invoke({ sessionId: 'native', action: 'retry', expectedGate: gate }).hold, true)
  const retried = readJson(`${dir}/gate`)
  assert.equal(retried.retried, true)
  assert.ok(retried.retryAt > now)
  assert.equal(invoke({ sessionId: 'native', action: 'ack', expectedGate: retried }).hold, true)
  record(2500)
  for (const status of ['paused', 'finished']) {
    put(`${dir}/state.json`, { ...state, status, pausedReason: 'human' })
    const synced = invoke({ sessionId: 'native', action: 'sync', expectedGate: retried })
    if (status === 'paused') assert.equal(synced.hold, false)
    else assert.equal(synced.code, 'run-unavailable')
    assert.deepEqual(readJson(`${dir}/gate`), retried)
  }
  put(`${dir}/state.json`, state)
  assert.equal(invoke({ sessionId: 'native', action: 'retry', expectedGate: retried }).hold, false)
  assert.equal(fs.existsSync(`${dir}/gate`), false)
  assert.deepEqual(readJson(`${dir}/state.json`), state)
  for (const sessionId of ['../native', '.', 'x'.repeat(257)]) {
    assert.equal(invoke({ sessionId, action: 'sync', expectedGate: null }).code, 'invalid-request')
  }
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
