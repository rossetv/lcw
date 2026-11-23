import { expect, mock, test } from 'claude-code/testing'

// mod-alive tells the status line the mod draws the card, so it does not draw it a second time.

const NOW = Date.parse('2026-11-23T12:00:00Z')
const A = '/lcw/repos/r/runs/a'
const B = '/lcw/repos/r/runs/b'
const BAND = {
  plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 30, bodyColumns: 100, scroll: { offset: 0, bodyRows: 29 }, view: {} },
} as const
const SURVEY = { ...BAND, props: { ...BAND.props, hasSurvey: true } }
const state = (id: string) => JSON.stringify({ id, name: id, status: 'running', stage: 'Build', stageSince: NOW - 60000, createdAt: NOW - 60000 })
const bind = (runDir: string) => JSON.stringify({ runDir })

function engine(on: any) {
  const clock = mock.clock(on, { now: NOW })
  let t = NOW
  const files: Record<string, string> = {
    '/lcw/sessions/s1.json': bind(A), [A + '/state.json']: state('a'), [B + '/state.json']: state('b'), [A + '/mod-alive']: String(NOW - 1000),
  }
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  const advance = async (ms: number) => { await clock.advance(ms); t += ms }
  const age = (runDir: string) => (runDir + '/mod-alive' in files ? t - Number(files[runDir + '/mod-alive']) : Infinity)
  return { files, advance, age }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

test('while the box is hidden, as a question dialog hides it, mod-alive stays fresh', async ($, on) => {
  const w = engine(on)
  await start($)
  const band = await $.ui.mount(BAND)
  await w.advance(10000)
  await band.unmount()
  for (let i = 0; i < 30; i++) {
    await w.advance(1000)
    expect(w.age(A)).toBeLessThanOrEqual(5000)
  }
})

test('a box drawn again after it gave way writes mod-alive at once', async ($, on) => {
  const w = engine(on)
  await start($)
  const survey = await $.ui.mount(SURVEY)
  await w.advance(30500)
  await survey.unmount()
  expect(w.age(A)).toBeGreaterThan(15000)
  const band = await $.ui.mount(BAND)
  expect(w.age(A)).toBeLessThan(1000)
  await band.unmount()
})

test('a session bound to a second run gives that run a mod-alive on the next draw', async ($, on) => {
  const w = engine(on)
  await start($)
  const first = await $.ui.mount(BAND)
  await first.unmount()
  await w.advance(5500)
  w.files['/lcw/sessions/s1.json'] = bind(B)
  await w.advance(1000)
  const band = await $.ui.mount(BAND)
  expect(w.age(B)).toBeLessThan(1000)
  await band.unmount()
})

test('while the approval box takes all the room from the card, mod-alive stays fresh', async ($, on) => {
  const w = engine(on)
  const approval = { go: ['Go'], meaning: 'build it', at: NOW - 1000 }
  w.files[A + '/state.json'] = JSON.stringify({ ...JSON.parse(state('a')), status: 'with-you', stage: 'Brainstorm', approval })
  await start($)
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 13 } })
  expect(await band.find({ type: 'Text', text: /Is this what you want built\?/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /in Brainstorm/ })).toBeUndefined()
  await w.advance(20000)
  expect(w.age(A)).toBeLessThan(15000)
  await band.unmount()
})

test('a run bound while the box is hidden gets no mod-alive until its card is drawn', async ($, on) => {
  const w = engine(on)
  await start($)
  const first = await $.ui.mount(BAND)
  await first.unmount()
  w.files['/lcw/sessions/s1.json'] = bind(B)
  await w.advance(20000)
  expect(w.age(B)).toBe(Infinity)
  const band = await $.ui.mount(BAND)
  expect(w.age(B)).toBeLessThan(1000)
  await band.unmount()
})
