import { expect, mock } from 'claude-code/testing'
import { test } from './kit'

declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown

const NOW = Date.parse('2026-11-18T12:00:00Z')
const RUN = '/lcw/repos/r/runs/x'
const STEP = 'launch milestone 2: T4 and T5'
const files = (more: Record<string, string> = {}) => ({
  '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN }),
  [RUN + '/state.json']: JSON.stringify({ id: '20261118-x', name: 'x', status: 'running', stage: 'Build', stageSince: NOW - 60000, createdAt: NOW - 60000 }),
  [RUN + '/mod-alive']: String(NOW - 1000), // a plugin reload, not a reopened session: no prompt of its own
  ...more,
})

// The world beneath the mod: files in memory, a clock the test moves, compactions that can be refused, and the prompts sent.
function engine(on: any, files: Record<string, string>, opts: { refuse?: number; veto?: number; drops?: number; slowWrites?: boolean; kept?: Record<string, any>; slowRead?: Promise<void> } = {}) {
  const kept = opts.kept ?? {}
  const clock = mock.clock(on, { now: NOW })
  const prompts: string[] = []
  const compacts: unknown[] = []
  let refusals = opts.refuse ?? 0
  let vetoes = opts.veto ?? 0
  let drops = opts.drops ?? 0
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', async (_: any, e: any) => {
    if (opts.slowRead && e.path === '/lcw/sessions/s1.json') await opts.slowRead
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', async (_: any, e: any) => {
    if (opts.slowWrites) await new Promise((r) => setTimeout(r, 10))
    files[e.path] = e.text
    return { value: undefined }
  })
  on('turn.complete', (_: any, e: any) => ({ text: e.answer ?? '' }))
  on('session.compact', (_: any, e: any) => {
    compacts.push(e)
    if (refusals-- > 0) throw new Error('a turn is running')
    if (vetoes-- > 0) return { skip: 'a PreCompact hook blocked it' }
    return { messages: [{ role: 'user', text: 'the summary', toolUses: [] }] }
  })
  on('prompt.submit', (_: any, e: any) => {
    if (drops > 0) { drops--; return { drop: 'a Stop stands' } }
    prompts.push(e.text)
    return { text: e.text }
  })
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  // $.state as a reload of the mod's code finds it: what the test put there, and what the mod writes.
  on('state.get', (_: any, e: any) => ({ value: { value: kept[e.key], version: e.key in kept ? 1 : 0 } }))
  on('state.set', (_: any, e: any) => { kept[e.key] = e.value; return { value: { isSet: true, version: 2 } } })
  return { clock, compacts, files, resumes: () => prompts.filter((p) => /LCW checkpoint/.test(p)) }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const turnEnds = ($: any, more: Record<string, unknown> = {}) =>
  $.turn.complete({ answer: '', durationMs: 5, isAborted: false, reason: 'answer', turnId: 't', ...more })

test('a checkpoint compacts the session when the turn ends, then empties its file and sends the next step', async ($, on) => {
  const w = engine(on, files({ [RUN + '/checkpoint']: STEP }))
  await start($)
  await turnEnds($)
  await w.clock.advance(1000)
  expect(w.compacts.length).toBe(1)
  expect(w.files[RUN + '/checkpoint']).toBe('')
  expect(w.resumes().length).toBe(1)
  expect(w.resumes()[0]).toContain(STEP)
})

test('a compaction refused because a turn has started keeps the checkpoint, and the next turn to end tries again', async ($, on) => {
  const w = engine(on, files({ [RUN + '/checkpoint']: STEP }), { refuse: 1 })
  await start($)
  await turnEnds($)
  await w.clock.advance(1000)
  expect(w.compacts.length).toBe(1)
  expect(w.files[RUN + '/checkpoint']).toBe(STEP)
  expect(w.resumes().length).toBe(0)
  await turnEnds($)
  await w.clock.advance(1000)
  expect(w.compacts.length).toBe(2)
  expect(w.files[RUN + '/checkpoint']).toBe('')
  expect(w.resumes().length).toBe(1)
})

test('a compaction a hook vetoes keeps the checkpoint and sends nothing, is not tried again by itself, and the next turn to end tries again', async ($, on) => {
  const w = engine(on, files({ [RUN + '/checkpoint']: STEP }), { veto: 1 })
  await start($)
  await turnEnds($)
  await w.clock.advance(60000)
  expect(w.compacts.length).toBe(1)
  expect(w.files[RUN + '/checkpoint']).toBe(STEP)
  expect(w.resumes().length).toBe(0)
  await turnEnds($)
  await w.clock.advance(1000)
  expect(w.compacts.length).toBe(2)
  expect(w.files[RUN + '/checkpoint']).toBe('')
  expect(w.resumes().length).toBe(1)
})

test('a resume the engine drops after the compaction is sent later, with no second compaction', async ($, on) => {
  const w = engine(on, files({ [RUN + '/checkpoint']: STEP }), { drops: 1 })
  await start($)
  await turnEnds($)
  await w.clock.advance(1000)
  expect(w.compacts.length).toBe(1)
  expect(w.resumes().length).toBe(0)
  await turnEnds($)
  await w.clock.advance(40000)
  expect(w.compacts.length).toBe(1)
  expect(w.resumes().length).toBe(1)
  expect(w.resumes()[0]).toContain(STEP)
  await w.clock.advance(60000)
  expect(w.resumes().length).toBe(1)
})

test('a resume not yet sent when the mod reloads is sent by the reloaded mod, once', async ($, on) => {
  const w = engine(on, files({ [RUN + '/checkpoint']: STEP }), { drops: 1 })
  await start($)
  await turnEnds($)
  await w.clock.advance(1000)
  expect(w.resumes().length).toBe(0)
  await start($)
  await w.clock.advance(120000)
  expect(w.compacts.length).toBe(1)
  expect(w.resumes().length).toBe(1)
  expect(w.resumes()[0]).toContain(STEP)
})

test('a resume kept before a reload is sent once, though the first look at the run takes longer than the wait before it', async ($, on) => {
  let read!: () => void
  const slowRead = new Promise<void>((r) => { read = r })
  const owed = { session: 's1', runDir: RUN, text: 'LCW checkpoint: carry on with ' + STEP }
  const w = engine(on, files(), { kept: { owed: { shape: 'kept-1', value: owed } }, slowRead })
  const started = start($)
  await new Promise((r) => setTimeout(r, 10))
  await w.clock.advance(2000)
  read()
  await started
  await w.clock.advance(60000)
  expect(w.resumes()).toEqual([owed.text])
})

test('two agents that finish at the same moment both count in the run\'s totals', async ($, on) => {
  const w = engine(on, files({ [RUN + '/totals.json']: JSON.stringify({ agents: 0, tokens: 0, seen: {}, used: { main: 0, agents: 0 } }) }), { slowWrites: true })
  await start($)
  await w.clock.advance(1000)
  const usage = { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }
  await Promise.all([turnEnds($, { agentId: 'a1', turnId: 't1', usage }), turnEnds($, { agentId: 'a2', turnId: 't2', usage })])
  expect(JSON.parse(w.files[RUN + '/totals.json']).used.agents).toBe(200)
})
