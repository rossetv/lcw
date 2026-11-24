import { expect, mock, test } from 'claude-code/testing'
import { cases } from '../core/mark-cases.mjs'
import { next as olderHook } from '../../lib/activity.mjs'

// After a tool call the mod says what the limit hook said, in the same cases, and counts a failed call for the
// mascot as the activity hook did, with no process.

const RUN = '/lcw/repos/r/runs/demo'
const SELECTION = { sourceId: 'external-quota', endpoint: 'http://localhost:8080/v1' }
const QUOTA: Record<string, [number, boolean]> = { ok: [80, false], blocked: [42, true], under: [42, false] }
const RECORD = '/lcw/activity/p1.json'
const CALLS: Record<string, object> = {
  tool: { tool_name: 'Edit', tool_input: { file_path: 'a.txt' }, agent_id: undefined },
  lcw: { tool_name: 'Bash', tool_input: { command: 'node /p/scripts/lcw.mjs mark 5500usd' }, agent_id: undefined },
  agent: { tool_name: 'Edit', tool_input: { file_path: 'a.txt' }, agent_id: 'a1' },
}

// Every test has its own instant and every write its own time, so nothing one test read stands for another's files.
let instant = Date.UTC(2026, 5, 10, 12, 0, 0)
const STEP = 60000
let writes = 0

/** A home in a row's state, as the limit hook's tests build it, at the instant of the next engine; the session is p1. */
function filesFor(row: any) {
  const now = instant + STEP
  const files: Record<string, unknown> = {}
  const sessions: Record<string, any> = {}
  if (row.run) {
    sessions.p1 = { runDir: RUN }
    files[RUN + '/state.json'] = { id: 'demo', name: 'demo', status: 'running', stage: 'Brainstorm', createdAt: now - 60000, driver: row.run, asks: [], tasks: [] }
  }
  for (const [id, body] of Object.entries(row.sessions ?? {})) sessions[id] = { ...sessions[id], ...(body as object) }
  for (const id of Object.keys(row.quota ?? {})) sessions[id] = { ...sessions[id], quotaSelection: SELECTION, billing: 'subscription' }
  for (const [id, body] of Object.entries(sessions)) files[`/lcw/sessions/${id}.json`] = body
  for (const [id, usd] of Object.entries(row.spend ?? {})) files[`/lcw/spend/${id}.json`] = { v: 1, base: 0, max: usd, q: { [Math.floor(now / 900000)]: usd } }
  if (row.week !== undefined) files['/lcw/usage.json'] = { at: 1, sevenDay: { percentUsed: row.week, resetsAt: '2026-06-12T12:00:00.000Z' } }
  if (row.cap) files['/lcw/cap.json'] = { usd: row.cap, at: '2026-06-01T00:00:00.000Z' }
  const [percentUsed, blocked] = QUOTA[Object.values(row.quota ?? {}).find((v) => v !== 'missing') as string] ?? []
  if (percentUsed !== undefined) {
    const result = { v: 1, status: 'ok', accountKey: 'a'.repeat(64), weekly: { percentUsed, resetsAt: '2026-06-14T12:00:00.000Z' }, blocked }
    files['/lcw/quota-command.json'] = { v: 1, enabled: true, sourceId: SELECTION.sourceId, revision: 'r1', endpoint: SELECTION.endpoint, command: 'adapter', lastAttemptAt: now, cache: { revision: 'r1', requestId: 'q1', attemptedAt: now - 60000, completedAt: now - 60000, result } }
  }
  return Object.fromEntries(Object.entries(files).map(([path, value]) => [path, JSON.stringify(value)]))
}

// A file system in memory whose times move with every change, as a real one's do.
// beneath stands for the hooks of the session's list, under the mod.
// process answers a command the mod runs, as the script would.
function engine(on: any, initial: Record<string, string>, opts: { beneath?: (e: any) => object; process?: (argv: string[]) => void } = {}) {
  const now = (instant += STEP)
  const clock = mock.clock(on, { now })
  const times: Record<string, number> = {}
  const files = new Proxy({} as Record<string, string>, { set: (all, path: string, text) => { all[path] = text; times[path] = now - 1000 + ++writes / 1000; return true } })
  Object.assign(files, initial)
  const w = { now, clock, files, written: [] as string[], runs: [] as string[][] }
  const kids = (dir: string) => Object.keys(files).filter((p) => p.startsWith(dir + '/'))
  on('session.id', () => ({ value: 'p1' }))
  on('session.info', () => ({ value: { transcriptPath: '', platform: 'linux' } }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; w.written.push(e.path); return { value: undefined } })
  on('fs.list', (_: any, e: any) => {
    const names = new Map<string, string>()
    for (const p of kids(e.path)) {
      const [name = '', ...more] = p.slice(e.path.length + 1).split('/')
      names.set(name, more.length ? 'dir' : 'file')
    }
    if (!names.size) throw new Error('ENOENT')
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: kind === 'dir' ? 0 : files[e.path + '/' + name]!.length, mtimeMs: times[e.path + '/' + name] ?? 0, isLink: false })) }
  })
  on('fs.stat', (_: any, e: any) => {
    if (e.path in files) return { value: { kind: 'file', size: files[e.path]!.length, mtimeMs: times[e.path], isLink: false } }
    throw new Error('ENOENT')
  })
  on('process.run', (_: any, e: any) => { w.runs.push([...e.argv]); opts.process?.(e.argv); return { value: { exitCode: 1, stdout: '', stderr: '' } } })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('classic.PostToolUse', (_: any, e: any) => opts.beneath?.(e) ?? {})
  on('classic.PostToolUseFailure', (_: any, e: any) => opts.beneath?.(e) ?? {})
  return w
}

const call = ($: any, kind: string) => $.classic.PostToolUse({ ...CALLS[kind], tool_response: {}, tool_use_id: 'toolu_1' })
// What Claude is told, with the plugin's lcw command line written as the cases write it.
const said = (r: any) => (r?.additionalContext ?? []).join('\n').replace(/node ('[^']*\/scripts\/lcw\.mjs'|\S*\/scripts\/lcw\.mjs)/g, '{cli}') || null
const fail = ($: any, id: string, more: object = {}) => $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: id, error: 'exit 1', session_id: 'p1', transcript_path: '', agent_id: undefined, ...more })

for (const row of cases) {
  for (const kind of ['tool', 'lcw', 'agent'].filter((k) => k in row.expect)) {
    test(`after a ${kind} call, the usage mark: ${row.name}`, async ($, on) => {
      const w = engine(on, filesFor(row))
      const want = (row.expect as any)[kind]
      expect(said(await call($, kind))).toBe(want)
      expect(w.runs).toEqual([])
    })
  }
}

const payg = cases.find((c) => c.name.startsWith('a session that turns out to be pay-per-token'))!
const atMark = cases.find((c) => c.name === 'the percent mark, no run')!

test('the pay-per-token note is said after one tool call only, and the session file is left as it was', async ($, on) => {
  const w = engine(on, filesFor(payg))
  const session = w.files['/lcw/sessions/p1.json']
  expect(said(await call($, 'tool'))).toMatch(/^LCW: this session turned out to be billed per token\./)
  expect(said(await call($, 'tool'))).toBe(null)
  expect(said(await call($, 'lcw'))).toBe(null)
  expect(w.files['/lcw/sessions/p1.json']).toBe(session)
})

test('the pay-per-token note is not said after a tool call once the hook at a prompt has said it', async ($, on) => {
  const files = filesFor(payg)
  files['/lcw/sessions/p1.json'] = JSON.stringify({ billing: 'payg', toldPayg: true })
  engine(on, files)
  expect(said(await call($, 'tool'))).toBe(null)
})

test('a successful tool call writes nothing, under the mark or at it', async ($, on) => {
  const w = engine(on, filesFor(atMark))
  expect(said(await call($, 'tool'))).toMatch(/^STOP!/)
  w.files['/lcw/usage.json'] = JSON.stringify({ at: 1, sevenDay: { percentUsed: 50, resetsAt: '2026-06-12T12:00:00.000Z' } })
  w.written.length = 0
  await w.clock.advance(100)
  expect(said(await call($, 'tool'))).toBe(null)
  expect(w.written).toEqual([])
})

test('a run finished a moment ago, still shown on the card, is no run to the stop', async ($, on) => {
  const files = filesFor({ ...atMark, run: 'p1' })
  const state = JSON.parse(files[RUN + '/state.json']!)
  files[RUN + '/state.json'] = JSON.stringify({ ...state, status: 'finished', finishedAt: instant + STEP - 1000 })
  engine(on, files)
  expect(said(await call($, 'tool'))).toBe(atMark.expect.tool)
})

test('three failed calls in a row are counted, with no process', async ($, on) => {
  const w = engine(on, { [RECORD]: JSON.stringify({ state: 'working', at: 5, fails: 0 }) })
  for (const id of ['toolu_1', 'toolu_2', 'toolu_3']) await fail($, id)
  expect(JSON.parse(w.files[RECORD]!)).toMatchObject({ state: 'working', at: 5, fails: 3, failAt: w.now })
  expect(w.runs).toEqual([])
})

test('a failed call is counted once when an older list of hooks counts it too', async ($, on) => {
  // The activity hook of an older list of hooks, beneath the mod, with the rule it runs.
  const w = engine(on, { [RECORD]: JSON.stringify({ state: 'working', at: 5, fails: 0 }) }, {
    beneath: (e) => {
      const record = olderHook(e, JSON.parse(w.files[RECORD] ?? 'null'), w.now)
      if (record) w.files[RECORD] = JSON.stringify(record)
      return {}
    },
  })
  await fail($, 'toolu_1')
  await fail($, 'toolu_2')
  expect(JSON.parse(w.files[RECORD]!).fails).toBe(2)
})

test('failed calls that end together are each counted', async ($, on) => {
  const w = engine(on, { [RECORD]: JSON.stringify({ state: 'working', at: 5, fails: 0 }) })
  await Promise.all(['toolu_1', 'toolu_2', 'toolu_3'].map((id) => fail($, id)))
  expect(JSON.parse(w.files[RECORD]!).fails).toBe(3)
})

test('a call the person interrupted, or a subagent\'s failed call, is not counted and writes nothing', async ($, on) => {
  const was = JSON.stringify({ state: 'working', at: 5, fails: 1 })
  const w = engine(on, { [RECORD]: was })
  await fail($, 'toolu_1', { is_interrupt: true })
  await fail($, 'toolu_2', { agent_id: 'a1' })
  expect(w.files[RECORD]).toBe(was)
  expect(w.written).toEqual([])
})

test('a hook beneath that fails after a tool call does not keep the stop at the mark from being said, nor break the call', async ($, on) => {
  engine(on, filesFor(atMark), { beneath: () => { throw new Error('beneath') } })
  expect(said(await call($, 'tool'))).toBe(atMark.expect.tool)
  expect(await fail($, 'toolu_1')).toEqual({})
})

// The note that the run is held at its mark, its gate, is no longer written at the tool call: the mod writes it itself
// when an outside quota's reading comes to hold the run.
const held = { name: 'an outside quota under the mark, then over it', sessions: { p1: { billing: 'subscription' } }, quota: { p1: 'under' }, run: 'p1' }
const syncs = (runs: string[][]) => runs.filter((a) => a[1]?.endsWith('/scripts/gate-reconcile.mjs') && JSON.parse(a[2] ?? '{}').action === 'sync')
const over = (files: Record<string, string>, requestId = 'q2') => {
  const quota = JSON.parse(files['/lcw/quota-command.json']!)
  quota.cache = { ...quota.cache, requestId, result: { ...quota.cache.result, weekly: { ...quota.cache.result.weekly, percentUsed: 80 } } }
  files['/lcw/quota-command.json'] = JSON.stringify(quota)
}

test('an outside quota that comes to hold the run has its gate written within a second, once', async ($, on) => {
  const w = engine(on, filesFor(held), { process: (argv) => { if (argv[1]?.endsWith('/scripts/gate-reconcile.mjs')) w.files[RUN + '/gate'] = JSON.stringify({ reason: 'mark', unit: 'quota', requestId: 'q2' }) } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await w.clock.advance(3000)
  expect(syncs(w.runs)).toEqual([])
  over(w.files)
  await w.clock.advance(1000)
  expect(syncs(w.runs).length).toBe(1)
  // A later reading that still holds finds the gate there.
  await w.clock.advance(5000)
  over(w.files, 'q3')
  await w.clock.advance(5000)
  expect(syncs(w.runs).length).toBe(1)
})

test('an outside quota that comes to hold a run the person paused writes no gate', async ($, on) => {
  const files = filesFor(held)
  files[RUN + '/state.json'] = JSON.stringify({ ...JSON.parse(files[RUN + '/state.json']!), status: 'paused', pausedReason: 'human' })
  const w = engine(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await w.clock.advance(3000)
  over(w.files)
  await w.clock.advance(10000)
  expect(syncs(w.runs)).toEqual([])
})

test('a gate that could not be written for an outside quota is not tried again for the same reading', async ($, on) => {
  const w = engine(on, filesFor(held))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await w.clock.advance(3000)
  over(w.files)
  await w.clock.advance(20000)
  expect(syncs(w.runs).length).toBe(1)
})
