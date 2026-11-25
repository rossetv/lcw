import { expect } from 'claude-code/testing'
import { test } from './kit'

declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown

const NOW = Date.parse('2026-11-18T12:00:00Z')
const MIN = 60 * 1000
const RUN = '/lcw/repos/r/runs/x'
const BIND = { '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN }) }
const state = (status: string) => JSON.stringify({ id: '20261118-x', name: 'x', status, pausedReason: status === 'paused' ? 'human' : null, stage: 'Build', stageSince: NOW, createdAt: NOW })
const worker = (over: object = {}) => ({
  id: 'a1', description: 'Add date filters', type: 'lcw:worker', status: 'running', kind: 'local_agent', taskStatus: 'running',
  model: 'sonnet', startTime: NOW, tokenCount: 10, ...over,
})

// The world beneath the mod: a run in memory, the agents it lists, the prompts it submits, and a clock that jumps.
// Each timer fires once per jump, so fifteen minutes cost one step, where replaying every period would cost thousands.
function engine(on: any, status: string, agents: { list: unknown[] }, drops = 0, kept: Record<string, any> = {}) {
  const files: Record<string, string> = { ...BIND, [RUN + '/state.json']: state(status), [RUN + '/mod-alive']: String(NOW) }
  const prompts: string[] = []
  let now = NOW
  let held: (() => void)[] = []
  const hold = () => new Promise((resolve) => held.push(() => resolve({ value: undefined })))
  on('clock.now', () => ({ value: now }))
  on('clock.every', hold)
  on('clock.after', hold)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('prompt.submit', (_: any, e: any) => {
    if (drops > 0) { drops--; return { drop: 'a Stop stands' } }
    prompts.push(e.text)
    return { text: e.text }
  })
  on('agent.list', () => ({ value: agents.list }))
  on('config.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  // $.state as a reload of the mod's code finds it: what the test put there, and what the mod writes.
  on('state.get', (_: any, e: any) => ({ value: { value: kept[e.key], version: e.key in kept ? 1 : 0 } }))
  on('state.set', (_: any, e: any) => { kept[e.key] = e.value; return { value: { isSet: true, version: 2 } } })
  // Jump ahead, let every timer fire, then once more for the prompt the mod sends a moment later.
  const pass = async (minutes: number) => {
    now += minutes * MIN
    for (let i = 0; i < 2; i++) {
      const due = held
      held = []
      due.forEach((fire) => fire())
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  return { pass, prompts, files, kept }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

test('a worker whose tokens stop moving for fifteen minutes is reported to the main loop, and again until it moves', async ($, on) => {
  const agents = { list: [worker()] as unknown[] }
  const w = engine(on, 'running', agents)
  await start($)
  await w.pass(14)
  expect(w.prompts.length).toBe(0)
  await w.pass(2)
  expect(w.prompts.length).toBe(1)
  for (const fact of [/Add date filters/, /id a1/, /16 minutes/, /When an agent stalls/]) expect(w.prompts[0]).toMatch(fact)
  await w.pass(6)
  expect(w.prompts.length).toBe(2)
  expect(w.prompts[1]).toMatch(/second time/)
  agents.list = [worker({ tokenCount: 99 })]
  await w.pass(10)
  expect(w.prompts.length).toBe(2)
})

test('a stalled agent of a paused run is not reported', async ($, on) => {
  const paused = engine(on, 'paused', { list: [worker()] })
  await start($)
  await paused.pass(40)
  expect(paused.prompts.length).toBe(0)
})

test('an agent that reported and is still listed fifteen minutes later is reported in words of its own', async ($, on) => {
  const w = engine(on, 'running', { list: [worker({ status: 'waiting', taskStatus: 'completed' })] })
  await start($)
  await w.pass(14)
  expect(w.prompts.length).toBe(0)
  await w.pass(2)
  expect(w.prompts.length).toBe(1)
  for (const fact of [/Add date filters/, /id a1/, /gave its report 16 minutes ago/, /Do not message it/, /TaskStop with its id/]) expect(w.prompts[0]).toMatch(fact)
  expect(/When an agent stalls/.test(w.prompts[0] ?? '')).toBe(false)
})

test('an agent that waits on an agent it launched is not held, and one whose turn ran again is held from its new end', async ($, on) => {
  const parent = worker({ id: 'o1', status: 'waiting', taskStatus: 'completed' })
  const agents = { list: [] as unknown[] }
  const w = engine(on, 'running', agents)
  for (let i = 0; i < 3; i++) {
    agents.list = [parent, worker({ id: 'k1', parentId: 'o1', tokenCount: i })]
    await (i ? w.pass(10) : start($))
  }
  await w.pass(10)
  expect(w.prompts.length).toBe(0)
  agents.list = [parent]
  await w.pass(10)
  agents.list = [worker({ id: 'o1', tokenCount: 50 })]
  await w.pass(1)
  agents.list = [parent]
  await w.pass(1)
  await w.pass(14)
  expect(w.prompts.length).toBe(0)
  await w.pass(2)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/gave its report 16 minutes ago/)
})

test('a running agent whose own child is at work is not reported as stalled, though its tokens stay flat', async ($, on) => {
  const agents = { list: [] as unknown[] }
  const w = engine(on, 'running', agents)
  for (let i = 0; i < 4; i++) {
    agents.list = [worker({ id: 'o1', tokenCount: 5 }), worker({ id: 'k1', parentId: 'o1', tokenCount: 100 + i })]
    await (i ? w.pass(6) : start($))
  }
  expect(w.prompts.length).toBe(0)
})

test('an agent still at work after an hour is checked on once, and not again after a pause', async ($, on) => {
  const agents = { list: [worker()] as unknown[] }
  const w = engine(on, 'running', agents)
  await start($)
  for (let i = 1; i <= 5; i++) {
    agents.list = [worker({ tokenCount: 10 + i })]
    await w.pass(10)
  }
  expect(w.prompts.length).toBe(0)
  agents.list = [worker({ tokenCount: 20 })]
  await w.pass(11)
  expect(w.prompts.length).toBe(1)
  for (const fact of [/Add date filters/, /id a1/, /61 minutes/, /a check, not a fault/, /told this once/]) expect(w.prompts[0]).toMatch(fact)
  agents.list = [worker({ tokenCount: 21 })]
  await w.pass(1)
  expect(w.prompts.length).toBe(1)
  // Two passes each way: the first reads the new state, the second acts on it and sends what the first queued.
  w.files[RUN + '/state.json'] = state('paused')
  await w.pass(1)
  await w.pass(1)
  w.files[RUN + '/state.json'] = state('running')
  agents.list = [worker({ tokenCount: 22 })]
  await w.pass(1)
  await w.pass(1)
  expect(w.prompts.length).toBe(1)
})

test('an hour notice the engine drops is sent later, once', async ($, on) => {
  const agents = { list: [worker()] as unknown[] }
  const w = engine(on, 'running', agents, 1)
  await start($)
  for (let i = 1; i <= 7; i++) {
    agents.list = [worker({ tokenCount: 10 + i })]
    await w.pass(10)
  }
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/a check, not a fault/)
  for (let i = 8; i <= 12; i++) {
    agents.list = [worker({ tokenCount: 10 + i })]
    await w.pass(10)
  }
  expect(w.prompts.length).toBe(1)
})

test('a stall notice the engine drops does not count towards the three', async ($, on) => {
  const w = engine(on, 'running', { list: [worker()] }, 1)
  await start($)
  await w.pass(16)
  expect(w.prompts.length).toBe(0)
  for (let i = 0; i < 6; i++) await w.pass(6)
  expect(w.prompts.length).toBe(3)
  expect(w.prompts[2]).toMatch(/third and last/)
})

test('the notices sent are kept where a reload of the mod finds them', async ($, on) => {
  const w = engine(on, 'running', { list: [worker()] })
  await start($)
  await w.pass(16)
  expect(w.prompts.length).toBe(1)
  expect(w.kept.nudged?.value?.a1?.times).toBe(1)
})

test('an agent told of its hour before a reload of the mod is not told again', async ($, on) => {
  const agents = { list: [worker()] as unknown[] }
  const w = engine(on, 'running', agents, 0, { told: { shape: 'kept-1', value: { a1: 1 } } })
  await start($)
  for (let i = 1; i <= 8; i++) {
    agents.list = [worker({ tokenCount: 10 + i })]
    await w.pass(10)
  }
  expect(w.prompts.length).toBe(0)
})

test('an agent told of its stall three times before a reload of the mod is not told again', async ($, on) => {
  const w = engine(on, 'running', { list: [worker()] }, 0, { nudged: { shape: 'kept-1', value: { a1: { at: NOW - 10 * MIN, times: 3, tokens: 10 } } } })
  await start($)
  await w.pass(16)
  for (let i = 0; i < 3; i++) await w.pass(6)
  expect(w.prompts.length).toBe(0)
})

test('values kept before a reload of the mod are not written over when the band draws before the session starts', async ($, on) => {
  const told = { shape: 'kept-1', value: { a1: 1 } }
  const nudged = { shape: 'kept-1', value: { a1: { at: NOW - 10 * MIN, times: 3, tokens: 10 } } }
  const w = engine(on, 'running', { list: [worker()] }, 0, { told, nudged })
  const band = await $.ui.mount({
    plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 40, bodyColumns: 100, scroll: { offset: 0, bodyRows: 39 }, view: {} },
  })
  await w.pass(1)
  await start($)
  expect(w.kept.told).toEqual(told)
  expect(w.kept.nudged?.value?.a1?.times).toBe(3)
  await w.pass(16)
  for (let i = 0; i < 3; i++) await w.pass(6)
  expect(w.prompts.length).toBe(0)
  await band.unmount()
})
