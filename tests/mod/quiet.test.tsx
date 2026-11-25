import { expect } from 'claude-code/testing'
import { test } from './kit'

declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown

const NOW = Date.parse('2026-11-18T12:00:00Z')
const MIN = 60 * 1000
const RUN = '/lcw/repos/r/runs/x'
const COUNT = RUN + '/quiet-agents.json'
const worker = (over: object = {}) => ({
  id: 'a1', description: 'Add date filters', type: 'lcw:worker', status: 'running', kind: 'local_agent', taskStatus: 'running',
  model: 'sonnet', startTime: NOW, tokenCount: 10, ...over,
})

// The world beneath the mod: a run in memory, the agents it lists, and a clock that jumps (each timer fires once per jump).
function engine(on: any, agents: { list: unknown[] }) {
  const files: Record<string, string> = {
    '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN }),
    [RUN + '/state.json']: JSON.stringify({ id: '20261118-x', name: 'x', status: 'running', stage: 'Build', stageSince: NOW, createdAt: NOW }),
    [RUN + '/mod-alive']: String(NOW),
  }
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
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('agent.list', () => ({ value: agents.list }))
  on('config.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  const pass = async (minutes: number) => {
    now += minutes * MIN
    const due = held
    held = []
    due.forEach((fire) => fire())
    await new Promise((r) => setTimeout(r, 20))
  }
  const count = () => { const c = JSON.parse(files[COUNT] ?? '{}'); return [c.quiet, c.stalled] }
  return { pass, count }
}

test('the count of quiet and stalled agents is left in the run folder for the mascot, and follows the agents', async ($, on) => {
  const agents = { list: [worker()] as unknown[] }
  const w = engine(on, agents)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(w.count()).toEqual([0, 0])
  await w.pass(6)
  expect(w.count()).toEqual([1, 0])
  await w.pass(10)
  expect(w.count()).toEqual([0, 1])
  agents.list = [worker({ tokenCount: 99 })]
  await w.pass(1)
  expect(w.count()).toEqual([0, 0])
})
