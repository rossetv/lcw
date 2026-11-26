import { expect } from 'claude-code/testing'
import { test } from './kit'

declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown

const NOW = Date.parse('2026-11-18T12:00:00Z')
const MIN = 60 * 1000
const RUN = '/lcw/repos/r/runs/x'
const BIND = { '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN }) }
const wave = (n: number, stage: string, over: object = {}) => ({ n, fixes: 2, status: 'running', stage, stageSince: NOW, step: null, round: 0, waiting: false, tasks: [{ id: 'T1', title: 'a task', status: 'running' }], requirements: [], ...over })
// A sweep with wave 1 in Review and wave 2 in Build.
const sweep = (over: object = {}, waves = [wave(1, 'Review'), wave(2, 'Build')]) => JSON.stringify({
  id: '20261118-x', name: 'x', shape: 'sweep', status: 'running', pausedReason: null, stage: 'Build', stageSince: NOW, createdAt: NOW, sweep: { round: 1, waves }, ...over,
})
// An agent says which wave it works for in its description.
const worker = (id: string, description: string, over: object = {}) => ({
  id, description, type: 'lcw:worker', status: 'running', kind: 'local_agent', taskStatus: 'running', model: 'sonnet', startTime: NOW, tokenCount: 10, ...over,
})

// The world beneath the mod, as tests/mod/stall.test.tsx builds it: a run in memory, its agents, the prompts the mod
// submits, and a clock that jumps. An agent's tokens move at every jump, so none is ever reported as stalled.
function engine(on: any, state: string, agents: { list: any[] }, drops = 0, kept: Record<string, any> = {}) {
  const files: Record<string, string> = { ...BIND, [RUN + '/state.json']: state, [RUN + '/mod-alive']: String(NOW) }
  const prompts: string[] = []
  let now = NOW
  let held: (() => void)[] = []
  const hold = () => new Promise((resolve) => held.push(() => resolve({ value: undefined })))
  on('clock.now', () => ({ value: now }))
  on('clock.every', hold)
  on('clock.after', hold)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.info', () => ({ value: { transcriptPath: '/t/main.jsonl' } }))
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
  on('state.get', (_: any, e: any) => ({ value: { value: kept[e.key], version: e.key in kept ? 1 : 0 } }))
  on('state.set', (_: any, e: any) => { kept[e.key] = e.value; return { value: { isSet: true, version: 2 } } })
  const pass = async (minutes: number) => {
    now += minutes * MIN
    agents.list = agents.list.map((a) => ({ ...a, tokenCount: a.tokenCount + 1 }))
    for (let i = 0; i < 2; i++) {
      const due = held
      held = []
      due.forEach((fire) => fire())
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  return { pass, prompts, files, kept, set: (text: string) => { files[RUN + '/state.json'] = text } }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const sitting = (w: { prompts: string[] }) => w.prompts.filter((p) => /work is sitting/.test(p))

test('a wave of a sweep with no agent at work for ten minutes is put to the main loop, with how to record why, and the wave with an agent is not named', async ($, on) => {
  const w = engine(on, sweep(), { list: [worker('a2', 'Build the importer for wave 2')] })
  await start($)
  await w.pass(9)
  expect(sitting(w).length).toBe(0)
  await w.pass(2)
  expect(sitting(w).length).toBe(1)
  for (const fact of [/No agent is at work for wave 1 \(in Review, 1\d minutes\)\./, /start now whatever can run/, /lcw set waits="<why>" --wave <n>/]) expect(sitting(w)[0]).toMatch(fact)
  expect(/wave 2/.test(sitting(w)[0]!)).toBe(false)
  // nothing has changed since: it is not asked again
  await w.pass(45)
  expect(sitting(w).length).toBe(1)
})

test('a sitting wave is asked about again once a task has ended, with what was recorded for it, and not before thirty minutes are up', async ($, on) => {
  const w = engine(on, sweep(), { list: [worker('a2', 'Build the importer for wave 2')] })
  await start($)
  await w.pass(11)
  expect(sitting(w).length).toBe(1)
  w.set(sweep({}, [wave(1, 'Review', { waits: 'ships after the importer' }), wave(2, 'Build', { tasks: [{ id: 'T1', title: 'a task', status: 'done' }] })]))
  await w.pass(15)
  expect(sitting(w).length).toBe(1)
  await w.pass(20)
  expect(sitting(w).length).toBe(2)
  expect(sitting(w)[1]).toMatch(/wave 1 \(in Review, \d+ minutes, as when you were last asked; you recorded "ships after the importer", so see whether that still holds\)/)
})

test('a paused sweep is asked nothing', async ($, on) => {
  const paused = engine(on, sweep({ status: 'paused', pausedReason: 'human' }), { list: [] })
  await start($)
  await paused.pass(40)
  expect(sitting(paused).length).toBe(0)
})

test('a sweep held at its usage mark is asked nothing, though its state still says running', async ($, on) => {
  const w = engine(on, sweep(), { list: [] })
  w.files[RUN + '/gate'] = JSON.stringify({ reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt: new Date(NOW + 3 * 24 * 60 * MIN).toISOString(), at: NOW })
  await start($)
  await w.pass(11)
  await w.pass(30)
  expect(sitting(w).length).toBe(0)
})

test('a wave that holds in Ship or waits on the person is left alone', async ($, on) => {
  const w = engine(on, sweep({}, [wave(1, 'Ship'), wave(2, 'Build', { waiting: true })]), { list: [] })
  await start($)
  await w.pass(40)
  expect(sitting(w).length).toBe(0)
})

test('a notice about sitting waves that was not sent is sent at a later look', async ($, on) => {
  const w = engine(on, sweep(), { list: [worker('a2', 'Build the importer for wave 2')] }, 1)
  await start($)
  await w.pass(11)
  expect(sitting(w).length).toBe(0)
  await w.pass(1)
  await w.pass(1)
  expect(sitting(w).length).toBe(1)
})

test('the waves asked about are kept where a reload of the mod finds them', async ($, on) => {
  const w = engine(on, sweep(), { list: [worker('a2', 'Build the importer for wave 2')] })
  await start($)
  await w.pass(11)
  expect(sitting(w).length).toBe(1)
  expect(Object.keys(w.kept.sat?.value?.waves ?? {})).toEqual(['1'])
  expect(w.kept.sat?.value?.waves?.[1]?.told).toBe(w.kept.sat?.value?.last)
})

test('a wave asked about before a reload of the mod is not asked about again, and its clock goes on from where it stood', async ($, on) => {
  const asked = { shape: 'kept-1', value: { run: '20261118-x', waves: { 1: { since: NOW - 11 * MIN, queued: false, told: NOW - MIN, mark: 'as it was' } }, last: NOW - MIN } }
  const w = engine(on, sweep(), { list: [worker('a2', 'Build the importer for wave 2')] }, 0, { sat: asked })
  await start($)
  await w.pass(20)
  expect(sitting(w).length).toBe(0)
  // thirty minutes after it was asked, with the sweep not as it was then
  await w.pass(10)
  expect(sitting(w).length).toBe(1)
  expect(sitting(w)[0]).toMatch(/wave 1 \(in Review, 4\d minutes, as when you were last asked\)/)
})

test('no wave is judged while an agent\'s wave is still being read, and an agent whose wave cannot be read is said in the notice', async ($, on) => {
  const w = engine(on, sweep(), { list: [worker('a2', 'Build the importer for wave 2'), worker('p1', 'Check the charter')] })
  await start($)
  await w.pass(11)
  expect(sitting(w).length).toBe(0)
  await w.pass(1)
  await w.pass(1)
  await w.pass(11)
  expect(sitting(w).length).toBe(1)
  expect(sitting(w)[0]).toMatch(/One agent is at work whose wave LCW could not read/)
})

const BAND = {
  plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 30, bodyColumns: 110, scroll: { offset: 0, bodyRows: 29 }, view: {} },
} as const

test('the card says no agent is at work under a wave that has sat ten minutes, and says what was recorded instead when a reason is set', async ($, on) => {
  const w = engine(on, sweep(), { list: [worker('a2', 'Build the importer for wave 2')] })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  await start($)
  await w.pass(9)
  let band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /no agent at work/ })).toBeUndefined()
  await band.unmount()
  await w.pass(2)
  band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /no agent at work/ })).toBeDefined()
  await band.unmount()
  w.set(sweep({}, [wave(1, 'Review', { waits: 'ships after the importer' }), wave(2, 'Build')]))
  await w.pass(1)
  band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /no agent at work/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /ships after the importer/ })).toBeDefined()
  await band.unmount()
})
