import { expect, mock, test } from 'claude-code/testing'
import { gateFor } from '../../hooks/lcw-mod.mjs'

declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown

const NOW = Date.parse('2026-11-18T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const RUN = '/lcw/repos/r/runs/x'
const BIND = { '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN }) }
const state = (status: string, pausedReason: string | null = status === 'paused' ? 'mark' : null) =>
  JSON.stringify({ id: '20261118-x', name: 'x', status, pausedReason, stage: 'Build', stageSince: NOW, finishedAt: NOW })
const gate = (resetsAt: number) => JSON.stringify({ reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt: new Date(resetsAt).toISOString(), at: NOW })

// The world beneath the mod: files in memory, a clock that moves only when the test moves it, and the prompts it submits.
function engine(on: any, files: Record<string, string>, opts: { rmWorks?: boolean; clock?: false; drops?: number } = {}) {
  const clock = opts.clock === false ? null! : mock.clock(on, { now: NOW })
  const prompts: string[] = []
  let drops = opts.drops ?? 0
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('process.run', (_: any, e: any) => {
    if (e.argv[1]?.endsWith('/scripts/gate-reconcile.mjs')) {
      const p = JSON.parse(e.argv[2])
      const file = RUN + '/gate'
      const current = JSON.parse(files[file] ?? 'null')
      if (JSON.stringify(current) !== JSON.stringify(p.expectedGate)) return { value: { exitCode: 0, stdout: '{"ok":false}', stderr: '' } }
      if (p.action === 'ack' && opts.rmWorks !== false) delete files[file]
      if (p.action === 'sync') {
        const g = gateFor(JSON.parse(files[RUN + '/state.json'] ?? 'null'), JSON.parse(files['/lcw/usage.json'] ?? 'null')?.sevenDay, NOW)
        if (g) files[file] = JSON.stringify(g)
      }
      return { value: { exitCode: 0, stdout: '{"ok":true}', stderr: '' } }
    }
    if (opts.rmWorks !== false && e.argv[0] === 'rm') delete files[e.argv[e.argv.length - 1]]
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('prompt.submit', (_: any, e: any) => {
    if (drops > 0) { drops--; return { drop: 'a Stop stands' } }
    prompts.push(e.text)
    return { text: e.text }
  })
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  return { clock, prompts, files }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

test('a gate already expired when the mod starts is removed and wakes the session once', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('paused'), [RUN + '/gate']: gate(NOW - 3 * DAY) })
  await start($)
  await w.clock.advance(1000)
  expect(RUN + '/gate' in w.files).toBe(false)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/limit has reset.*resume.*status.*ledger/)
  await w.clock.advance(10000)
  expect(w.prompts.length).toBe(1)
})

test('a wake the engine drops keeps the gate, and is made again later and sent once', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('paused'), [RUN + '/gate']: gate(NOW - DAY) }, { drops: 1 })
  await start($)
  await w.clock.advance(5000)
  expect(RUN + '/gate' in w.files).toBe(true)
  expect(w.prompts.length).toBe(0)
  await w.clock.advance(40000)
  expect(RUN + '/gate' in w.files).toBe(false)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/limit has reset/)
  await w.clock.advance(60000)
  expect(w.prompts.length).toBe(1)
})

test('a gate that cannot be removed still wakes the session only once', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('paused'), [RUN + '/gate']: gate(NOW - DAY) }, { rmWorks: false })
  await start($)
  await w.clock.advance(10000)
  expect(w.prompts.length).toBe(1)
})

// Inactive runs retain harmless evidence; only a delivered recovery retires a gate.
for (const [status, reason] of [['paused', 'human'], ['paused', null], ['with-you', null], ['finished', null]] as const) {
  test(`an expired gate on a run that is ${status}${reason ? ' (' + reason + ')' : ''} is retained without changing the run or submitting a prompt`, async ($, on) => {
    const w = engine(on, {
      ...BIND, [RUN + '/state.json']: state(status, reason), [RUN + '/gate']: gate(NOW - DAY), [RUN + '/mod-alive']: String(NOW - 60000),
    })
    await start($)
    await w.clock.advance(10000)
    expect(w.files[RUN + '/gate']).toBe(gate(NOW - DAY))
    expect(w.files[RUN + '/state.json']).toBe(state(status, reason))
    expect(w.prompts.length).toBe(0)
  })
}

// The mod does not read a stopped run at all, so its gate stays for lcw resume; the launch hook ignores an expired one.
test('an expired gate on a stopped run submits nothing', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('stopped'), [RUN + '/gate']: gate(NOW - DAY) })
  await start($)
  await w.clock.advance(10000)
  expect(w.prompts.length).toBe(0)
})

test('a run the human paused while its gate held is not woken when the reset passes', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('paused', 'mark'), [RUN + '/gate']: gate(NOW + 5000) })
  await start($)
  await w.clock.advance(2000)
  w.files[RUN + '/state.json'] = state('paused', 'human')
  await w.clock.advance(10000)
  expect(w.files[RUN + '/gate']).toBe(gate(NOW + 5000))
  expect(w.files[RUN + '/state.json']).toBe(state('paused', 'human'))
  expect(w.prompts.length).toBe(0)
})

test('a running run with an expired gate gets the wake, not the reopen prompt as well', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('running'), [RUN + '/gate']: gate(NOW - DAY) })
  await start($)
  await w.clock.advance(5000)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/limit has reset/)
})

// A machine that slept for days: the clock jumps and each timer fires once, as the mock clock (which replays every period) cannot show.
function sleepingClock(on: any) {
  let t = NOW
  let held: (() => void)[] = []
  const hold = () => new Promise((resolve) => held.push(() => resolve({ value: undefined })))
  on('clock.now', () => ({ value: t }))
  on('clock.every', hold)
  on('clock.after', hold)
  return {
    jump: (ms: number) => { t += ms },
    tick: async () => {
      const due = held
      held = []
      due.forEach((fire) => fire())
      await new Promise((r) => setTimeout(r, 20))
    },
  }
}

test('a session idle for days is woken once, when the reset time passes', async ($, on) => {
  const clock = sleepingClock(on)
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('paused'), [RUN + '/gate']: gate(NOW + 3 * DAY) }, { clock: false })
  await start($)
  for (let i = 0; i < 3; i++) await clock.tick()
  expect(w.prompts.length).toBe(0)
  clock.jump(3 * DAY + 2000)
  for (let i = 0; i < 3; i++) await clock.tick()
  expect(RUN + '/gate' in w.files).toBe(false)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/limit has reset/)
  for (let i = 0; i < 3; i++) await clock.tick()
  expect(w.prompts.length).toBe(1)
})

test('a reopened session with a running run carries on by itself, once', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('running'), [RUN + '/mod-alive']: String(NOW - 60000) })
  await start($)
  await w.clock.advance(5000)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/reopened.*lcw:lcw.*node ".*\/scripts\/lcw\.mjs" status/)
  await w.clock.advance(20000)
  expect(w.prompts.length).toBe(1)
})

test('a reopen prompt the engine drops is sent later, once', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('running'), [RUN + '/mod-alive']: String(NOW - 60000) }, { drops: 1 })
  await start($)
  await w.clock.advance(5000)
  expect(w.prompts.length).toBe(0)
  await w.clock.advance(40000)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/reopened/)
  await w.clock.advance(60000)
  expect(w.prompts.length).toBe(1)
})

test('a prompt the person sends takes over from a reopen prompt the engine dropped: it is not sent later', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('running'), [RUN + '/mod-alive']: String(NOW - 60000) }, { drops: 1 })
  await start($)
  await w.clock.advance(5000)
  await $.prompt.submit({ text: 'stop there' } as any)
  await w.clock.advance(60000)
  expect(w.prompts).toEqual(['stop there'])
})

test('a binding written a few seconds after start still counts as a reopen', async ($, on) => {
  const w = engine(on, { [RUN + '/state.json']: state('running') })
  await start($)
  await w.clock.advance(4000)
  w.files['/lcw/sessions/s1.json'] = BIND['/lcw/sessions/s1.json']
  await w.clock.advance(3000)
  expect(w.prompts.length).toBe(1)
})

test('a binding first seen after ten seconds does not prompt', async ($, on) => {
  const w = engine(on, { [RUN + '/state.json']: state('running') })
  await start($)
  await w.clock.advance(12000)
  w.files['/lcw/sessions/s1.json'] = BIND['/lcw/sessions/s1.json']
  await w.clock.advance(3000)
  expect(w.prompts.length).toBe(0)
})

test('a plugin reload, with mod-alive fresh, does not prompt', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('running'), [RUN + '/mod-alive']: String(NOW - 4000) })
  await start($)
  await w.clock.advance(5000)
  expect(w.prompts.length).toBe(0)
})

for (const status of ['with-you', 'paused', 'finished', 'stopped']) {
  test(`a reopened session whose run is ${status} waits for the human`, async ($, on) => {
    const w = engine(on, { ...BIND, [RUN + '/state.json']: state(status) })
    await start($)
    await w.clock.advance(5000)
    expect(w.prompts.length).toBe(0)
  })
}

test('a reopened session whose run the human paused waits for the human', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('paused', 'human'), [RUN + '/mod-alive']: String(NOW - 60000) })
  await start($)
  await w.clock.advance(20000)
  expect(w.prompts.length).toBe(0)
})

test('a reopened session whose run is held by its gate waits for the reset', async ($, on) => {
  const w = engine(on, { ...BIND, [RUN + '/state.json']: state('running'), [RUN + '/gate']: gate(NOW + DAY) })
  await start($)
  await w.clock.advance(5000)
  expect(w.prompts.length).toBe(0)
})

const limits = (percentUsed: number, resetsAt: string) => ({
  context: { window: 200000 }, changed: ['rateLimits'], rateLimits: [{ kind: 'seven_day', percentUsed, resetsAt }],
})

test('a lower figure from an idle session neither lowers usage.json nor keeps the gate off', async ($, on) => {
  const resetsAt = '2026-11-22T14:00:00.000Z'
  const w = engine(on, {
    ...BIND, [RUN + '/state.json']: state('running'),
    '/lcw/usage.json': JSON.stringify({ at: NOW - 1000, sevenDay: { percentUsed: 80, resetsAt }, source: 'statusline' }),
  })
  await start($)
  await $.session.measure(limits(60, resetsAt) as any)
  expect(JSON.parse(w.files['/lcw/usage.json'] ?? '{}').sevenDay.percentUsed).toBe(80)
  expect(JSON.parse(w.files[RUN + '/gate'] ?? '{}').usedPercent).toBe(80)
})

test('a figure for a new week replaces the old one', async ($, on) => {
  const w = engine(on, {
    ...BIND, [RUN + '/state.json']: state('running'),
    '/lcw/usage.json': JSON.stringify({ at: NOW - 1000, sevenDay: { percentUsed: 90, resetsAt: '2026-11-18T11:00:00.000Z' } }),
  })
  await start($)
  await $.session.measure(limits(5, '2026-11-25T11:00:00.000Z') as any)
  expect(JSON.parse(w.files['/lcw/usage.json'] ?? '{}').sevenDay.percentUsed).toBe(5)
  expect(RUN + '/gate' in w.files).toBe(false)
})

test('a gate with no reset time is written again with one when a reading that has it arrives, and then wakes the run', async ($, on) => {
  const resetsAt = '2026-11-18T12:00:05.000Z'
  const w = engine(on, {
    ...BIND, [RUN + '/state.json']: state('paused'),
    [RUN + '/gate']: JSON.stringify({ reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt: null, at: NOW - DAY }),
  })
  await start($)
  await $.session.measure(limits(82, resetsAt) as any)
  expect(JSON.parse(w.files[RUN + '/gate'] ?? '{}').resetsAt).toBe(resetsAt)
  await w.clock.advance(10000)
  expect(RUN + '/gate' in w.files).toBe(false)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/limit has reset/)
})
