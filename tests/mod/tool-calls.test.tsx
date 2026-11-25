import { expect, mock } from 'claude-code/testing'
import { test } from './kit'
import { cases } from '../core/mark-cases.mjs'
import { register } from '../../hooks/register'

// The command hook after a tool call starts the limit check only while the session's marker is up: the mod keeps it
// up whenever that check would say something, in the limit hook's cases.

const RUN = '/lcw/repos/r/runs/demo'
const SELECTION = { sourceId: 'external-quota', endpoint: 'http://localhost:8080/v1' }
const QUOTA: Record<string, [number, boolean]> = { ok: [80, false], blocked: [42, true], under: [42, false] }
const MARKER = '/lcw/after/p1'
const START = { cwd: '/repo', surface: 'terminal', isInteractive: false } as const

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
// process answers a command the mod runs, as the script would; id and transcript are the session's, which a /clear changes.
function engine(on: any, initial: Record<string, string>, opts: { process?: (argv: string[]) => void | Promise<void>; transcript?: string } = {}) {
  const now = (instant += STEP)
  const clock = mock.clock(on, { now })
  const times: Record<string, number> = {}
  const files = new Proxy({} as Record<string, string>, { set: (all, path: string, text) => { all[path] = text; times[path] = now - 1000 + ++writes / 1000; return true } })
  Object.assign(files, initial)
  const w = { now, clock, files, written: [] as string[], runs: [] as string[][], id: 'p1' }
  const kids = (dir: string) => Object.keys(files).filter((p) => p.startsWith(dir + '/'))
  on('session.id', () => ({ value: w.id }))
  on('session.info', () => ({ value: { transcriptPath: opts.transcript ?? '', platform: 'linux' } }))
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
  on('process.run', async (_: any, e: any) => { w.runs.push([...e.argv]); await opts.process?.(e.argv); return { value: { exitCode: 1, stdout: '', stderr: '' } } })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.stop', (_: any, e: any) => ({ isTurnRunning: e.isTurnRunning }))
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  return w
}

const up = (w: { files: Record<string, string> }, file = MARKER) => !!w.files[file]
const atMark = cases.find((c) => c.name === 'the percent mark, no run')!
const payg = cases.find((c) => c.name.startsWith('a session that turns out to be pay-per-token'))!
const week = (percentUsed: number) => JSON.stringify({ at: 1, sevenDay: { percentUsed, resetsAt: '2026-06-12T12:00:00.000Z' } })

for (const row of cases.filter((c) => 'tool' in c.expect)) {
  const said = (row.expect as any).tool !== null
  test(`the marker is ${said ? 'up' : 'down'} where the check after a tool call says ${said ? 'something' : 'nothing'}: ${row.name}`, async ($, on) => {
    const w = engine(on, filesFor(row))
    await $.session.start(START)
    await w.clock.advance(1000)
    expect(up(w)).toBe(said)
  })
}

test('the marker names the session, its transcript and when it was raised', async ($, on) => {
  const w = engine(on, filesFor(atMark), { transcript: '/t/t1.jsonl' })
  await $.session.start(START)
  await w.clock.advance(1000)
  const marker = JSON.parse(w.files[MARKER]!)
  expect(marker).toMatchObject({ session: 'p1', transcript: 't1' })
  expect(marker.at >= w.now && marker.at <= w.now + 1000).toBe(true)
})

test('the session row under the transcript\'s name is read first: at the mark there, the marker is raised', async ($, on) => {
  const files = filesFor({ week: 80, sessions: { p1: { markPercent: 90 } } })
  files['/lcw/sessions/t1.json'] = JSON.stringify({ markPercent: 70 })
  const w = engine(on, files, { transcript: '/t/t1.jsonl' })
  await $.session.start(START)
  await w.clock.advance(1000)
  expect(up(w)).toBe(true)
})

test('a mark raised on the row under the transcript\'s name keeps the marker down', async ($, on) => {
  const files = filesFor({ week: 80, sessions: { p1: { markPercent: 70 } } })
  files['/lcw/sessions/t1.json'] = JSON.stringify({ markPercent: 90 })
  const w = engine(on, files, { transcript: '/t/t1.jsonl' })
  await $.session.start(START)
  await w.clock.advance(2000)
  expect(up(w)).toBe(false)
})

test('the marker of a session with a backslash transcript path comes up at the mark on the row under its name', async ($, on) => {
  const files = filesFor({ week: 80, sessions: { p1: { markPercent: 90 } } })
  files['/lcw/sessions/t1.json'] = JSON.stringify({ markPercent: 70 })
  const w = engine(on, files, { transcript: 'C:\\Users\\me\\.claude\\projects\\x\\t1.jsonl' })
  await $.session.start(START)
  await w.clock.advance(1000)
  expect(up(w)).toBe(true)
  expect(JSON.parse(w.files[MARKER]!)).toMatchObject({ transcript: 't1' })
})

// The mod cannot tell whether the recorded Claude Code still runs, and the hook reads the id's row alone while it does.
test('a transcript row that records another Claude Code does not keep the marker down for the id\'s own row', async ($, on) => {
  const files = filesFor({ week: 80, sessions: { p1: { markPercent: 70 } } })
  files['/lcw/sessions/t1.json'] = JSON.stringify({ markPercent: 90, claudePid: 4242 })
  const w = engine(on, files, { transcript: '/t/t1.jsonl' })
  await $.session.start(START)
  await w.clock.advance(1000)
  expect(up(w)).toBe(true)
})

test('the marker is lowered once the session is under its mark, and written only when that changes', async ($, on) => {
  const w = engine(on, filesFor(atMark))
  const writes = () => w.written.filter((p) => p === MARKER).length
  await $.session.start(START)
  await w.clock.advance(1000)
  expect(up(w)).toBe(true)
  const raised = writes()
  await w.clock.advance(3000)
  expect(writes()).toBe(raised)
  w.files['/lcw/usage.json'] = week(50)
  await w.clock.advance(1000)
  expect(w.files[MARKER]).toBe('')
  await w.clock.advance(3000)
  expect(writes()).toBe(raised + 1)
})

test('a marker cleared while the session is at its mark is put back within a second', async ($, on) => {
  const w = engine(on, filesFor(atMark))
  await $.session.start(START)
  await w.clock.advance(1000)
  delete w.files[MARKER]
  await w.clock.advance(1000)
  expect(up(w)).toBe(true)
})

test('the marker stays up for the pay-per-token note until the session row shows it was given', async ($, on) => {
  const w = engine(on, filesFor(payg))
  await $.session.start(START)
  await w.clock.advance(1000)
  expect(up(w)).toBe(true)
  w.files['/lcw/sessions/p1.json'] = JSON.stringify({ billing: 'payg', toldPayg: true })
  await w.clock.advance(1000)
  expect(up(w)).toBe(false)
})

test('a session that ends has its marker lowered, and one cleared into a new id has its own', async ($, on) => {
  const w = engine(on, filesFor(atMark))
  await $.session.start(START)
  await w.clock.advance(1000)
  await $.session.end({ reason: 'clear', sessionId: 'p1' } as any)
  expect(w.files[MARKER]).toBe('')
  w.id = 'p2'
  await w.clock.advance(1000)
  expect(up(w)).toBe(false)
  expect(up(w, '/lcw/after/p2')).toBe(true)
})

test('a second start under a new id lowers the marker of the first', async ($, on) => {
  const w = engine(on, filesFor(atMark))
  await $.session.start(START)
  await w.clock.advance(1000)
  w.id = 'p2'
  await $.session.start(START)
  await w.clock.advance(1000)
  expect(up(w)).toBe(false)
  expect(up(w, '/lcw/after/p2')).toBe(true)
})

test('the mod hooks no classic event, which managed settings can send past it', () => {
  const names: string[] = []
  const chain: any = { catch: () => chain }
  register(((name: string) => { names.push(name); return chain }) as any, {} as any)
  expect(names).toContain('turn.complete')
  expect(names.filter((n) => n.startsWith('classic.'))).toEqual([])
})

// The run's gate, when an outside quota's reading comes to hold it, the mod also writes itself within a second, not waiting for the next tool call or prompt.
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

test('a reading that came while a gate check was still running is tried once that check is over', async ($, on) => {
  let first = true
  // The first check answers three seconds late, and none writes the gate.
  const w = engine(on, filesFor(held), { process: async (argv) => { if (argv[1]?.endsWith('/scripts/gate-reconcile.mjs') && first) { first = false; await w.clock.sleep(3000) } } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
  await w.clock.advance(3000)
  over(w.files)
  await w.clock.advance(1000)
  over(w.files, 'q3')
  await w.clock.advance(8000)
  expect(syncs(w.runs).length).toBe(2)
  await w.clock.advance(20000)
  expect(syncs(w.runs).length).toBe(2)
})
