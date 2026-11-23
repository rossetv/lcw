import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const RUN = '/lcw/repos/r/runs/x'
const QUOTA = '/lcw/quota-command.json'
const selection = { sourceId: 'external-quota' }
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

function engine(on: any, files: Record<string, string>) {
  const clock = mock.clock(on, { now: NOW })
  const prompts: string[] = []
  const writes: string[] = []
  let beforeRead: ((path: string) => void) | undefined
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    beforeRead?.(e.path)
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; writes.push(e.path); return { value: undefined } })
  on('process.run', (_: any, e: any) => {
    if (e.argv[0] === 'rm') delete files[e.argv[e.argv.length - 1]]
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('prompt.submit', (_: any, e: any) => { prompts.push(e.text); return { text: e.text } })
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
