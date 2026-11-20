import { expect, test } from 'claude-code/testing'

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
function engine(on: any, status: string, agents: { list: unknown[] }) {
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
  on('prompt.submit', (_: any, e: any) => { prompts.push(e.text); return { text: e.text } })
  on('agent.list', () => ({ value: agents.list }))
  on('config.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
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
  return { pass, prompts }
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
