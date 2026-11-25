import { expect, mock } from 'claude-code/testing'
import { test } from './kit'
import { hex } from '../../lib/theme.mjs'

// The card is redrawn when what it shows changes or its motion is due: five steps a second while work is in flight,
// one while the run waits on the person, none when it is paused.

const NOW = Date.parse('2026-11-23T12:00:00Z')
const RUN = '/lcw/repos/r/runs/a'
const BAND = {
  plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 30, bodyColumns: 100, scroll: { offset: 0, bodyRows: 29 }, view: {} },
} as const
// Ten minutes into its stage: the times on the card do not change within the stretches below.
const state = (over: object) => JSON.stringify({ id: 'a', name: 'a', status: 'running', stage: 'Build', stageSince: NOW - 600000, createdAt: NOW - 600000, ...over })
const PAUSED = { status: 'paused', pausedReason: 'human' }
const WITH_YOU = { status: 'with-you', stage: 'Brainstorm' }

function engine(on: any, over: object, agents: unknown[] = []) {
  const clock = mock.clock(on, { now: NOW })
  let t = NOW
  const files: Record<string, string> = {
    '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN }), [RUN + '/state.json']: state(over), [RUN + '/mod-alive']: String(NOW - 1000),
  }
  const w = { files, redraws: 0, theme: 'dark', advance: async (ms: number) => { await clock.advance(ms); t += ms }, age: () => t - Number(files[RUN + '/mod-alive']) }
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('agent.list', () => ({ value: agents }))
  on('config.list', () => ({ value: [{ key: 'theme', value: w.theme }] }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('ui.invalidate', (_: any, e: any, next: any) => { w.redraws++; return next(e) })
  return w
}

// The card drawn and settled, then the redraws over the next ten seconds with nothing changing.
async function redrawsOverTen($: any, w: ReturnType<typeof engine>, working = false) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  if (working) await $.turn.start({ text: 'go', turnId: 't1' })
  await w.advance(2050)
  w.redraws = 0
  await w.advance(10000)
  await band.unmount()
  return w.redraws
}

test('a paused card with nothing changing is not redrawn', async ($, on) => {
  const w = engine(on, PAUSED)
  expect(await redrawsOverTen($, w)).toBe(0)
})

test('a card that waits on the person is redrawn once a second', async ($, on) => {
  const w = engine(on, WITH_YOU)
  expect(await redrawsOverTen($, w)).toBe(10)
})

test('a card with a turn at work is redrawn five times a second', async ($, on) => {
  const w = engine(on, {})
  expect(await redrawsOverTen($, w, true)).toBe(50)
})

// An agent at the card's start, listed long enough that its times on the card do not change within the stretch.
const agent = (status: string, over: object = {}) => ({
  id: 'a1', description: 'Add date filters', type: 'lcw:worker', status, kind: 'local_agent', taskStatus: 'running',
  model: 'sonnet', startTime: NOW - 600000, tokenCount: 10, ...over,
})

test('a card whose only agent waits is redrawn once a second', async ($, on) => {
  const w = engine(on, {}, [agent('waiting')])
  expect(await redrawsOverTen($, w)).toBe(10)
})

test('a card whose only agent has finished and is still listed is redrawn once a second', async ($, on) => {
  const w = engine(on, {}, [agent('running', { taskStatus: 'completed' })])
  expect(await redrawsOverTen($, w)).toBe(10)
})

test('a card with an agent running is redrawn five times a second', async ($, on) => {
  const w = engine(on, {}, [agent('running')])
  expect(await redrawsOverTen($, w)).toBe(50)
})

test('a card with an agent pending is redrawn five times a second', async ($, on) => {
  const w = engine(on, {}, [agent('pending')])
  expect(await redrawsOverTen($, w)).toBe(50)
})

test('a change on a paused card is drawn within a second', async ($, on) => {
  const w = engine(on, PAUSED)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await w.advance(3050)
  expect(await band.find({ type: 'Text', text: /^Review$/ })).toBeUndefined()
  w.files[RUN + '/state.json'] = state({ ...PAUSED, stage: 'Review' })
  await w.advance(1000)
  expect(await band.find({ type: 'Text', text: /^Review$/ })).toBeDefined()
  await band.unmount()
})

test('a paused card that holds still keeps its heartbeat every five seconds', async ($, on) => {
  const w = engine(on, PAUSED)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await w.advance(2050)
  w.redraws = 0
  for (let i = 0; i < 20; i++) {
    await w.advance(1000)
    expect(w.age()).toBeLessThanOrEqual(5000)
  }
  expect(w.redraws).toBe(0)
  await band.unmount()
})

test('a theme changed while the card is paused redraws it once, in the new colours', async ($, on) => {
  const w = engine(on, PAUSED)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await w.advance(2050)
  const colours = async () => new Set((await band.findAll({ type: 'Text' })).map((t: any) => t.props.color).filter(Boolean))
  expect([...await colours()]).toContain(hex('dark', 'text'))
  w.redraws = 0
  w.theme = 'light'
  await w.advance(10000)
  expect(w.redraws).toBe(1)
  const now = await colours()
  expect([...now]).toContain(hex('light', 'text'))
  expect([...now]).not.toContain(hex('dark', 'text'))
  await band.unmount()
})
