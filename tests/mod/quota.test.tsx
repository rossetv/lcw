import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const RUN = '/lcw/repos/r/runs/x'
const QUOTA = '/lcw/quota-command.json'
const endpoint = 'https://proxy.example'
const selection = { sourceId: 'external-quota', endpoint }
const resetsAt = '2026-11-22T12:00:00Z'
const accountKey = 'a'.repeat(64)
const result = (percentUsed = 42) => ({ v: 1, status: 'ok', accountKey, weekly: { percentUsed, resetsAt }, blocked: false })
const record = (value: any = result(), requestId = 'q2', at = NOW) => JSON.stringify({
  v: 1, sourceId: 'external-quota', enabled: true, revision: 'r1', endpoint: 'https://proxy.example', command: 'read-quota',
  cache: { revision: 'r1', requestId, attemptedAt: at, completedAt: at, result: value },
})
const hold = (requestId = 'q1', at = NOW - 1000) => JSON.stringify({
  reason: 'mark', unit: 'quota', sourceId: 'external-quota', revision: 'r1', requestId, accountKey,
  resetsAt: '2026-11-18T11:00:00Z', status: 'stale', markPercent: 75, at,
})
const runState = (pausedReason = 'mark') => JSON.stringify({ id: 'x', name: 'x', status: 'paused', pausedReason, stage: 'Build', markPercent: 75, driver: 'driver' })

function engine(on: any, files: Record<string, string>, opts: { rejectPrompts?: number; dropPrompts?: number; callerPid?: number; process?: (e: any) => { exitCode: number; stdout?: string; stderr?: string } | void } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const prompts: string[] = []
  const writes: string[] = []
  let beforeRead: ((path: string) => void) | undefined
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : e.name === 'CLAUDE_PID' && opts.callerPid ? String(opts.callerPid) : undefined }))
  on('fs.read', (_: any, e: any) => {
    beforeRead?.(e.path)
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; writes.push(e.path); return { value: undefined } })
  on('process.run', (_: any, e: any) => {
    const ran = opts.process?.(e)
    if (ran) return { value: ran }
    if (e.argv[0] === 'rm') delete files[e.argv[e.argv.length - 1]]
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('prompt.submit', (_: any, e: any) => {
    prompts.push(e.text)
    if (prompts.length <= (opts.rejectPrompts ?? 0)) throw new Error('submission refused')
    return prompts.length <= (opts.dropPrompts ?? 0) ? { drop: 'submission refused' } : { text: e.text }
  })
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  return { clock, prompts, files, writes, beforeRead: (fn: (path: string) => void) => { beforeRead = fn } }
}
const filesFor = (externalDriver = true) => ({
  '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN, billing: 'subscription', ...(!externalDriver ? { quotaSelection: selection } : {}) }),
  '/lcw/sessions/driver.json': JSON.stringify({ billing: 'subscription', ...(externalDriver ? { quotaSelection: selection } : {}) }),
  [RUN + '/state.json']: runState(), [RUN + '/gate']: hold(), [QUOTA]: record(),
})
const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
const measure = ($: any) => $.session.measure({ context: { window: 200000 }, changed: ['rateLimits'], rateLimits: [{ kind: 'seven_day', percentUsed: 99, resetsAt }], cost: { usd: 10 } } as any)

test('a selected endpoint cannot borrow another endpoint profile or request its refresh', async ($, on) => {
  const files: Record<string, string> = filesFor()
  files[QUOTA] = record(result(95), 'q1', NOW - 1000)
  let otherRefreshes = 0
  const w = engine(on, files, { process: e => {
    if (e.argv[1]?.endsWith('/scripts/quota-refresh.mjs') && JSON.parse(files[QUOTA] ?? 'null').endpoint !== endpoint) otherRefreshes++
  } })
  await start($)
  await w.clock.advance(2000)
  expect(w.prompts.length).toBe(0)
  const other = JSON.parse(record({ ...result(2), accountKey: 'b'.repeat(64) }, 'q3', NOW + 2000))
  other.endpoint = 'https://other.example'
  other.revision = other.cache.revision = 'r2'
  files[QUOTA] = JSON.stringify(other)
  await w.clock.advance(3000)
  expect(w.prompts.length).toBe(0)
  expect(otherRefreshes).toBe(0)
  expect(JSON.parse(files['/lcw/sessions/driver.json'] ?? 'null').quotaSelection.endpoint).toBe(endpoint)
  const band = await $.ui.mount({
    plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
  } as any)
  expect(await band.find({ type: 'Text', text: /quota unavailable/ })).toBeDefined()
  await band.unmount()
})

test('a legacy source-only selection holds without adopting the global endpoint', async ($, on) => {
  const files: Record<string, string> = filesFor()
  files['/lcw/sessions/driver.json'] = JSON.stringify({ billing: 'subscription', quotaSelection: { sourceId: 'external-quota' } })
  let refreshes = 0
  const w = engine(on, files, { process: e => { if (e.argv[1]?.endsWith('/scripts/quota-refresh.mjs')) refreshes++ } })
  await start($)
  await w.clock.advance(3000)
  expect(w.prompts.length).toBe(0)
  expect(refreshes).toBe(0)
  expect(JSON.parse(files['/lcw/sessions/driver.json'] ?? 'null').quotaSelection.endpoint).toBe(undefined)
})

test('a new revision on the bound endpoint can recover a held run', async ($, on) => {
  const files: Record<string, string> = filesFor()
  files[QUOTA] = record(result(95), 'q1', NOW - 1000)
  const w = engine(on, files)
  await start($)
  await w.clock.advance(2000)
  expect(w.prompts.length).toBe(0)
  const next = JSON.parse(record(result(2), 'q3', NOW + 2000))
  next.revision = next.cache.revision = 'r2'
  files[QUOTA] = JSON.stringify(next)
  await w.clock.advance(3000)
  expect(w.prompts.length).toBe(1)
})

for (const owner of ['driver', 'current']) {
  test(`a ${owner} dollar mark never raises the external percentage allowance`, async ($, on) => {
    const files: Record<string, string> = filesFor()
    files['/lcw/sessions/s1.json'] = JSON.stringify({ runDir: RUN, billing: 'subscription', quotaSelection: selection, ...(owner === 'current' ? { markUsd: 3500 } : { markPercent: 95 }) })
    files['/lcw/sessions/driver.json'] = JSON.stringify({ runDir: RUN, billing: 'subscription', quotaSelection: selection, ...(owner === 'driver' ? { markUsd: 3500 } : { markPercent: 95 }) })
    files[QUOTA] = record(result(85))
    const w = engine(on, files)
    await start($)
    await w.clock.advance(3000)
    expect(w.prompts.length).toBe(0)
    expect(files[RUN + '/quota-woke']).toBe(undefined)
  })
}

for (const external of [false, true]) {
  test(`canonical ${external ? 'external' : 'pay-per-token'} billing governs a cost-only measurement through a stale alias`, async ($, on) => {
    const files: Record<string, string> = {
      '/lcw/sessions/s1.json': JSON.stringify({ sessionCanonicalId: 'anchor', billing: external ? 'payg' : 'subscription', claudePid: 100, history: 'kept' }),
      '/lcw/sessions/anchor.json': JSON.stringify({ sessionCanonicalId: 'anchor', billing: external ? 'subscription' : 'payg', quotaSelection: external ? selection : null, quotaDefaultBilling: 'payg', claudePid: 100 }),
      [QUOTA]: record({ v: 1, status: 'refused', code: 'provider-refused' }),
    }
    engine(on, files)
    await start($)
    await $.session.measure({ context: { window: 200000 }, changed: ['cost'], cost: { usd: 10 } } as any)
    const spend = files['/lcw/spend/s1.json']
    if (external) expect(spend).toBe(undefined)
    else {
      if (spend === undefined) throw new Error('cost measurement was not recorded')
      expect(JSON.parse(spend).max).toBe(10)
    }
    const session = JSON.parse(files['/lcw/sessions/s1.json'] ?? 'null')
    expect(session.billing).toBe(external ? 'subscription' : 'payg')
    expect(session.claudePid).toBe(100)
    expect(session.history).toBe('kept')
    expect(session.sessionCanonicalId).toBe('anchor')
  })
}

for (const external of [false, true]) {
  test(`canonical ${external ? 'external' : 'default'} selection overrides an older alias in the card and recovery`, async ($, on) => {
    const files: Record<string, string> = filesFor()
    files['/lcw/sessions/driver.json'] = JSON.stringify({ runDir: RUN, sessionCanonicalId: 'anchor', billing: external ? 'payg' : 'subscription', quotaSelection: external ? null : selection })
    files['/lcw/sessions/anchor.json'] = JSON.stringify({ sessionCanonicalId: 'anchor', billing: external ? 'subscription' : 'payg', quotaSelection: external ? selection : null, ...(external ? { quotaDefaultBilling: 'payg', markPercent: 75 } : { markUsd: 3000 }) })
    files[QUOTA] = record({ v: 1, status: 'refused', code: 'provider-refused' })
    const w = engine(on, files)
    await start($)
    const band = await $.ui.mount({
      plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
      props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
    } as any)
    expect(await band.find({ type: 'Text', text: external ? /quota refused/ : /\$3,000/ })).toBeDefined()
    await band.unmount()
    await w.clock.advance(3000)
    expect(w.prompts.length).toBe(external ? 0 : 1)
  })
}

test('idle refresh retries a failed launch and does not suppress a replacement revision', async ($, on) => {
  const files: Record<string, string> = { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription', quotaSelection: selection }), [QUOTA]: record() }
  let calls = 0
  const w = engine(on, files, { process: e => {
    if (!e.argv[1]?.endsWith('/scripts/quota-refresh.mjs')) return
    calls++
    return { exitCode: calls === 1 ? 1 : 0, stdout: '', stderr: '' }
  } })
  await start($)
  await w.clock.advance(8000)
  expect(calls).toBe(2)
  const replacement = JSON.parse(record())
  replacement.revision = replacement.cache.revision = 'r2'
  files[QUOTA] = JSON.stringify(replacement)
  await w.clock.advance(1000)
  expect(calls).toBe(3)
  await w.clock.advance(5000)
  expect(calls).toBe(3)
})

test('native measurement delegates gate changes so a newer external hold cannot be overwritten', async ($, on) => {
  const files: Record<string, string> = filesFor(false)
  files['/lcw/sessions/s1.json'] = JSON.stringify({ runDir: RUN, billing: 'subscription' })
  files[RUN + '/state.json'] = JSON.stringify({ id: 'x', status: 'running', stage: 'Build', driver: 'driver', markPercent: 75 })
  delete files[RUN + '/gate']
  files[RUN + '/mod-alive'] = String(NOW)
  let reconciled = 0
  const w = engine(on, files, { process: e => {
    if (!e.argv[1]?.endsWith('/scripts/gate-reconcile.mjs')) return
    reconciled++
    files['/lcw/sessions/driver.json'] = JSON.stringify({ billing: 'subscription', quotaSelection: selection })
    files[QUOTA] = record({ v: 1, status: 'refused', code: 'provider-refused' }, 'q3')
    files[RUN + '/gate'] = hold('q3', NOW)
    return { exitCode: 0, stdout: '{"ok":false,"code":"superseded"}', stderr: '' }
  } })
  await start($)
  await measure($)
  expect(reconciled).toBe(1)
  expect(files[RUN + '/gate']).toBe(hold('q3', NOW))
  expect(w.writes.includes(RUN + '/gate')).toBe(false)
  await w.clock.advance(2000)
  expect(w.prompts.length).toBe(0)
})

for (const kind of ['driver', 'launcher', 'unavailable-owner']) {
  test(`canonical marks respect the ${kind} identity and safe owner fallback`, async ($, on) => {
    const files: Record<string, string> = filesFor()
    const alias = kind === 'launcher' ? 's1' : 'driver'
    const ownMark = kind === 'unavailable-owner' ? 10 : 95
    files['/lcw/sessions/' + alias + '.json'] = JSON.stringify({ runDir: RUN, billing: 'subscription', quotaSelection: selection, sessionCanonicalId: 'anchor', claudePid: 100, markPercent: ownMark })
    files['/lcw/sessions/anchor.json'] = JSON.stringify({ sessionCanonicalId: 'anchor', claudePid: kind === 'unavailable-owner' ? 200 : 100, markPercent: 30 })
    let ownerChecks = 0
    const w = engine(on, files, { callerPid: kind === 'driver' ? 300 : 100, process: e => { if (e.argv[0] === 'ps') ownerChecks++ } })
    await start($)
    await w.clock.advance(3000)
    expect(w.prompts.length).toBe(0)
    files['/lcw/sessions/anchor.json'] = JSON.stringify({ sessionCanonicalId: 'anchor', claudePid: kind === 'unavailable-owner' ? 200 : 100, markPercent: 90 })
    await w.clock.advance(3000)
    expect(w.prompts.length).toBe(kind === 'unavailable-owner' ? 0 : 1)
    expect(ownerChecks <= 2).toBe(true)
  })
}

test('a rejected recovery rechecks the new source hold before retrying', async ($, on) => {
  const files: Record<string, string> = filesFor()
  const w = engine(on, files, { dropPrompts: 1 })
  await start($)
  await w.clock.advance(2000)
  files[QUOTA] = record({ v: 1, status: 'refused', code: 'provider-refused' }, 'q3', NOW + 2000)
  await w.clock.advance(6000)
  expect(w.prompts.length).toBe(1)
  expect(files[RUN + '/quota-woke']).toBe(undefined)
  files[QUOTA] = record(result(), 'q4', NOW + 8000)
  await w.clock.advance(2000)
  expect(w.prompts.length).toBe(2)
})

for (const failure of ['reject', 'drop']) {
  test(`a ${failure === 'reject' ? 'rejected' : 'dropped'} recovery delivery is retried without recording an acknowledgement`, async ($, on) => {
    const files: Record<string, string> = filesFor()
    const w = engine(on, files, failure === 'reject' ? { rejectPrompts: 1 } : { dropPrompts: 1 })
    await start($)
    await w.clock.advance(2000)
    expect(w.prompts.length).toBe(1)
    expect(files[RUN + '/quota-woke']).toBe(undefined)
    await w.clock.advance(6000)
    expect(w.prompts.length).toBe(2)
    expect(typeof files[RUN + '/quota-woke']).toBe('string')
    await w.clock.advance(5000)
    expect(w.prompts.length).toBe(2)
  })
}

test('disabling a selected source recovers through default controls without a status line', async ($, on) => {
  const files: Record<string, string> = filesFor()
  files['/lcw/sessions/driver.json'] = JSON.stringify({ billing: 'subscription', quotaSelection: selection, quotaDefaultBilling: 'subscription' })
  files[QUOTA] = JSON.stringify({ v: 1, sourceId: 'external-quota', revision: 'off', enabled: false })
  files['/lcw/usage.json'] = JSON.stringify({ sevenDay: { percentUsed: 20, resetsAt } })
  const w = engine(on, files)
  await start($)
  await w.clock.advance(3000)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/default|disabled/)
  expect(files[RUN + '/gate']).toBe(hold())
  expect(w.writes.includes(RUN + '/gate')).toBe(false)
})

test('an idle selected driver requests shared refresh and recovers without another hook or status line', async ($, on) => {
  const files: Record<string, string> = filesFor()
  files[QUOTA] = record({ v: 1, status: 'unavailable', code: 'network' }, 'q1', NOW - 300000)
  const calls: any[] = []
  const w = engine(on, files, { process: e => {
    if (e.argv[1]?.endsWith('/scripts/quota-refresh.mjs')) {
      calls.push(e)
      files[QUOTA] = record(result(), 'q2')
    }
  } })
  await start($)
  await w.clock.advance(8000)
  expect(calls.length).toBe(1)
  expect(calls[0].init.timeoutMs > 0 && calls[0].init.timeoutMs <= 40000).toBe(true)
  expect(calls[0].init.env.LCW_HOME).toBe('/lcw')
  expect(w.prompts.length).toBe(1)
  await w.clock.advance(300000)
  expect(calls.length).toBe(2)
})

test('fresh external allowance recovers an obsolete dollar gate without deleting it', async ($, on) => {
  const files: Record<string, string> = filesFor()
  const gate = JSON.stringify({ unit: 'usd', reason: 'mark', usedUsd: 3100, markUsd: 3000, retryAt: NOW + 100000, at: NOW + 1000 })
  files[RUN + '/gate'] = gate
  const w = engine(on, files)
  await start($)
  await w.clock.advance(3000)
  expect(w.prompts.length).toBe(1)
  expect(files[RUN + '/gate']).toBe(gate)
})

test('an explicitly disabled source restores the saved dollar display before the next Node hook', async ($, on) => {
  const files: Record<string, string> = {
    '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN, billing: 'subscription', quotaSelection: selection, quotaDefaultBilling: 'payg' }),
    [RUN + '/state.json']: JSON.stringify({ id: 'x', status: 'paused', pausedReason: 'mark', stage: 'Build', driver: 's1' }),
    [QUOTA]: JSON.stringify({ v: 1, sourceId: 'external-quota', revision: 'off', enabled: false }),
  }
  engine(on, files)
  await start($)
  const band = await $.ui.mount({
    plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
  } as any)
  expect(await band.find({ type: 'Text', text: /paused at your \$3,000 mark/ })).toBeDefined()
  await band.unmount()
  await $.session.measure({ context: { window: 200000 }, changed: ['cost'], rateLimits: [], cost: { usd: 10 } } as any)
  const sessionText = files['/lcw/sessions/s1.json']
  const spendText = files['/lcw/spend/s1.json']
  if (sessionText === undefined || spendText === undefined) throw new Error('billing or spend record missing')
  expect(JSON.parse(sessionText).billing).toBe('payg')
  expect(JSON.parse(spendText).max).toBe(10)
  expect(files['/lcw/usage.json']).toBe(undefined)
})

test('an external session never feeds proxy native-looking usage into the native cache', async ($, on) => {
  const native = JSON.stringify({ at: NOW - 1000, sevenDay: { percentUsed: 20, resetsAt } })
  const w = engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription', quotaSelection: selection }), '/lcw/usage.json': native, [QUOTA]: record() })
  await start($)
  await measure($)
  expect(w.files['/lcw/usage.json']).toBe(native)
  expect(w.files['/lcw/spend/s1.json']).toBe(undefined)
})

test('the driver source recovers once per hold without deleting its gate, including after rebinding', async ($, on) => {
  const files = filesFor()
  const w = engine(on, files)
  await start($)
  await w.clock.advance(2000)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/quota.*resume/)
  expect(files[RUN + '/gate']).toBe(hold())
  const ack = files[RUN + '/quota-woke']
  expect(typeof ack).toBe('string')
  files[QUOTA] = record(result(), 'q3', NOW + 2000)
  await w.clock.advance(3000)
  expect(w.prompts.length).toBe(1)
  // Losing and finding the run must not replay an acknowledged recovery.
  files[RUN + '/state.json'] = JSON.stringify({ id: 'x', status: 'stopped' })
  await w.clock.advance(1000)
  files[RUN + '/state.json'] = runState()
  await w.clock.advance(2000)
  expect(w.prompts.length).toBe(1)
  files[RUN + '/gate'] = hold('q4', NOW + 5000)
  files[QUOTA] = record({ v: 1, status: 'refused', code: 'provider-refused' }, 'q4', NOW + 5000)
  await w.clock.advance(1000)
  expect(w.prompts.length).toBe(1)
  files[QUOTA] = record(result(), 'q5', NOW + 7000)
  await w.clock.advance(2000)
  expect(w.prompts.length).toBe(2)
  expect(w.writes.includes(RUN + '/gate')).toBe(false)
})

test('a durable recovery acknowledgement survives startup but a distinct hold still recovers', async ($, on) => {
  const files: Record<string, string> = filesFor()
  const prior = { ...JSON.parse(hold()), holdId: 'hold-one' }
  files[RUN + '/gate'] = JSON.stringify(prior)
  files[RUN + '/quota-woke'] = JSON.stringify({
    gate: JSON.stringify(['hold-one', prior.sourceId, prior.revision, prior.requestId, prior.accountKey, prior.resetsAt, prior.at]),
    evidence: JSON.stringify(['external-quota', 'r1', accountKey, resetsAt, 'q2', NOW]),
  })
  const w = engine(on, files)
  await start($)
  await w.clock.advance(2000)
  expect(w.prompts.length).toBe(0)
  files[RUN + '/gate'] = JSON.stringify({ ...prior, holdId: 'hold-two' })
  await w.clock.advance(2000)
  expect(w.prompts.length).toBe(1)
})

test('a missing selected source stays subscription-backed and a held launching source cannot wake a different driver', async ($, on) => {
  const files: Record<string, string> = filesFor(false)
  delete files[QUOTA]
  files['/lcw/sessions/s1.json'] = JSON.stringify({ runDir: RUN, billing: 'payg', quotaSelection: selection, markPercent: 10 })
  files['/lcw/spend/s1.json'] = JSON.stringify({ max: 500, samples: [] })
  const w = engine(on, files)
  await start($)
  await measure($)
  expect(JSON.parse(files['/lcw/sessions/s1.json']).billing).toBe('subscription')
  expect(files['/lcw/spend/s1.json']).toBe(undefined)
  expect(files['/lcw/usage.json']).toBe(undefined)
  files['/lcw/sessions/driver.json'] = JSON.stringify({ billing: 'subscription', quotaSelection: selection })
  files[QUOTA] = record()
  await w.clock.advance(3000)
  expect(w.prompts.length).toBe(0)
})

for (const status of ['unavailable', 'refused', 'stale', 'human']) {
  test(`an external ${status} hold does not wake at its old reset`, async ($, on) => {
    const files = filesFor()
    if (status === 'human') files[RUN + '/state.json'] = runState('human')
    else if (status === 'stale') files[QUOTA] = record(result(), 'q2', NOW - 600000)
    else files[QUOTA] = record({ v: 1, status, code: status === 'refused' ? 'provider-refused' : 'network' })
    const w = engine(on, files)
    await start($)
    await w.clock.advance(5000)
    expect(w.prompts.length).toBe(0)
    expect(files[RUN + '/gate']).toBe(hold())
  })
}

test('a newer hold appearing during recovery is left intact and gets no stale wake', async ($, on) => {
  const files = filesFor()
  const w = engine(on, files)
  let raced = false
  w.beforeRead(path => {
    if (path === RUN + '/quota-woke' && !raced) {
      raced = true
      files[RUN + '/gate'] = hold('q3', NOW)
      files[QUOTA] = record({ v: 1, status: 'refused', code: 'provider-refused' }, 'q3')
    }
  })
  await start($)
  await w.clock.advance(3000)
  expect(raced).toBe(true)
  expect(w.prompts.length).toBe(0)
  expect(files[RUN + '/gate']).toBe(hold('q3', NOW))
})

test('a selected launching session cannot recover a native driver from its own quota reading', async ($, on) => {
  const files = filesFor(false)
  const w = engine(on, files)
  await start($)
  await w.clock.advance(3000)
  expect(w.prompts.length).toBe(0)
  expect(files[RUN + '/gate']).toBe(hold())
})
