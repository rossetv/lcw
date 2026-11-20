import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const

function engine(on: any, files: Record<string, string>, settings: Record<string, unknown> = {}) {
  const writes: Record<string, string> = {}
  const runs: string[][] = []
  const prompts: string[] = []
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('settings.read', () => ({ value: settings }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in writes) return { value: writes[e.path] }
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files || e.path in writes }))
  on('fs.write', (_: any, e: any) => { writes[e.path] = e.text; return { value: undefined } })
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: 1000 }))
  on('clock.every', () => ({ value: {} }))
  on('clock.after', () => ({ value: {} }))
  on('process.run', (_: any, e: any) => { runs.push([...e.argv]); return { value: { exitCode: 0, stdout: '', stderr: '' } } })
  on('prompt.submit', (_: any, e: any) => { prompts.push(e.text); return { text: e.text } })
  on('ui.toast', () => ({ value: undefined }))
  return { writes, runs, prompts }
}

const payg = { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'payg' }) }

test('with no advisor set, the advisor banner is drawn with no run, and Not now takes it away for the session', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /Turn on Fable as your advisor\?/ })).toBeDefined()
  await band.press({ key: 'banner:advisor:later' })
  await band.unmount()
  const again = await $.ui.mount(BAND)
  expect(await again.find({ type: 'Text', text: /advisor/ })).toBeUndefined()
  await again.unmount()
})

test('Fix it runs setup to turn the advisor on', async ($, on) => {
  const seen = engine(on, {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:advisor:fix' })
  expect(seen.runs.some((argv) => argv.at(-2)?.endsWith('scripts/setup.mjs') && argv.at(-1) === 'advisor')).toBe(true)
  await band.unmount()
})

test("Don't ask again is kept on the machine", async ($, on) => {
  const seen = engine(on, {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:advisor:never' })
  expect(JSON.parse(seen.writes['/lcw/notices.json'] ?? 'null')).toEqual({ advisor: 'never' })
  await band.unmount()
})

test('a set advisor and a subscription draw nothing', async ($, on) => {
  engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription' }) }, { advisorModel: 'fable' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /LCW/ })).toBeUndefined()
  await band.unmount()
})

test('on API billing with no cap, Keep $4,000 saves the cap; Set my cap hands over to Claude', async ($, on) => {
  const seen = engine(on, payg, { advisorModel: 'fable' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /What's your weekly cap\?/ })).toBeDefined()
  await band.press({ key: 'banner:cap:keep' })
  expect(seen.runs.some((argv) => argv.includes('cap') && argv.includes('4000'))).toBe(true)
  await band.unmount()
})

test('Set my cap hands over to Claude with a prompt in the person\'s words', async ($, on) => {
  const seen = engine(on, payg, { advisorModel: 'fable' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:cap:set' })
  expect(seen.prompts).toEqual(['Set my weekly cap for LCW.'])
  await band.unmount()
})

test('a session started with --advisor is not asked to turn it on', async ($, on) => {
  engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription', advisorFlag: true }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /advisor/ })).toBeUndefined()
  await band.unmount()
})

const bound = {
  '/lcw/sessions/s1.json': JSON.stringify({ runDir: '/lcw/repos/r/runs/x', billing: 'subscription' }),
  '/lcw/repos/r/runs/x/state.json': JSON.stringify({ id: '20261118-x', name: 'x', status: 'running', stage: 'Build', stageSince: 1000 }),
}

test('during a run the banner sits above the card, and where both do not fit the card stays', async ($, on) => {
  engine(on, bound)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /Turn on Fable as your advisor\?/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /in Build/ })).toBeDefined()
  await band.unmount()
  const tight = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 12, bodyColumns: 50 } })
  expect(await tight.find({ type: 'Text', text: /advisor/ })).toBeUndefined()
  expect(await tight.find({ type: 'Text', text: /in Build/ })).toBeDefined()
  await tight.unmount()
})

test('with a cap set and no spend command, the spend check is offered and Set it up sends its prompt', async ($, on) => {
  const seen = engine(on, { ...payg, '/lcw/cap.json': JSON.stringify({ usd: 5000 }) }, { advisorModel: 'fable' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /Check your real spend/ })).toBeDefined()
  await band.press({ key: 'banner:spend:set' })
  expect(seen.prompts).toEqual(['Set up my LCW spend check.'])
  await band.unmount()
})
