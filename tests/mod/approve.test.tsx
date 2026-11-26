import { expect, mock } from 'claude-code/testing'
import { test } from './kit'

// The approval box at the end of the Brainstorm, as the mod wires it: drawn above the run's card, a reply only fills
// the prompt (nothing is sent), never over a draft, and a prompt the person sends ends the box.

const NOW = Date.parse('2026-11-20T12:00:00Z')
const RUN = '/lcw/repos/repo-1/runs/r1'
const BAND = {
  plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 40, bodyColumns: 100, scroll: { offset: 0, bodyRows: 39 }, view: {} },
} as const

const approving = (approval: object = { go: ['Go (a)', 'Go (b)'], meaning: 'build it, with (a) wrapped or (b) short rows', at: NOW - 1000 }, over: object = {}) => ({
  '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN, billing: 'subscription' }),
  [RUN + '/state.json']: JSON.stringify({ id: 'r1', name: 'phone-rows', status: 'with-you', stage: 'Brainstorm', stageSince: NOW - 60000, tasks: [], asks: [], approval, ...over }),
})

function engine(on: any, files: Record<string, string>, opts: { draft?: string; fills?: boolean; kept?: Record<string, any>; notify?: object[] } = {}) {
  const kept = opts.kept ?? {}
  const clock = mock.clock(on, { now: NOW })
  const prompts: string[] = []
  const filled: string[] = []
  const toasts: string[] = []
  const notified: string[] = []
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.info', () => ({ value: { transcriptPath: '', platform: 'linux' } }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('settings.read', () => ({ value: { advisorModel: 'fable' } }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.list', () => { throw new Error('ENOENT') })
  on('process.run', (_: any, e: any) => {
    const out = e.argv.includes('where') ? JSON.stringify({ main: '/repo', key: 'repo-1', run: RUN }) : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', (_: any, e: any) => { prompts.push(String(e.text)); return { text: e.text } })
  on('prompt.read', () => ({ value: { text: opts.draft ?? '', cursor: 0 } }))
  on('prompt.fill', (_: any, e: any) => { if (opts.fills === false) return { isFilled: false }; filled.push(e.text); return { isFilled: true } })
  on('ui.toast', (_: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('ui.notify', (_: any, e: any) => { notified.push(e.text); return { value: opts.notify?.shift() ?? { isSent: true, channel: 'terminal_bell' } } })
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  // $.state as a reload of the mod's code finds it: what the test put there, and what the mod writes.
  on('state.get', (_: any, e: any) => ({ value: { value: kept[e.key], version: e.key in kept ? 1 : 0 } }))
  on('state.set', (_: any, e: any) => { kept[e.key] = e.value; return { value: { isSet: true, version: 2 } } })
  return { clock, prompts, filled, toasts, notified, kept }
}

const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

test('the approval box sits above the Brainstorm card, and Go (b) fills the prompt without sending it', async ($, on) => {
  const w = engine(on, approving())
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /Is this what you want built\?/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^LCW Build · $/ })).toBeDefined()
  await band.press({ key: 'banner:approve:go2' })
  expect(w.filled).toEqual(['Go (b)'])
  expect(w.prompts).toEqual([])
  await w.clock.advance(2000)
  expect(await band.find({ type: 'Text', text: /Is this what you want built\?/ })).toBeUndefined()
  await band.unmount()
})

test('a reply is never put over what the person has typed: the box stays and says so', async ($, on) => {
  const w = engine(on, approving(), { draft: 'hmm' })
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:approve:but' })
  expect(w.filled).toEqual([])
  expect(w.prompts).toEqual([])
  expect(w.toasts.join()).toMatch(/Your prompt has text in it/)
  expect(await band.find({ type: 'Text', text: /Is this what you want built\?/ })).toBeDefined()
  await band.unmount()
})

test('where the prompt cannot be filled, the person is told to type the reply', async ($, on) => {
  const w = engine(on, approving(), { fills: false })
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:approve:go1' })
  expect(w.prompts).toEqual([])
  expect(w.toasts.join()).toMatch(/Type "Go \(a\)" there/)
  await band.unmount()
})

test('where the full box does not fit above the card, the tight one is drawn', async ($, on) => {
  engine(on, approving())
  await start($)
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 18 } })
  expect(await band.find({ type: 'Text', text: /Is this what you want built\?/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /The playback is in the chat above/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /^LCW Build · $/ })).toBeDefined()
  await band.unmount()
})

test('where even the tight box does not fit above the card, the box stays and the card gives way', async ($, on) => {
  engine(on, approving())
  await start($)
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 13 } })
  expect(await band.find({ type: 'Text', text: /Is this what you want built\?/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^LCW Build · $/ })).toBeUndefined()
  await band.unmount()
})

test("a sweep's question stays in a short window, with the card giving way", async ($, on) => {
  const question = { id: 'Q1', text: 'Drop the old export route?', why: 'nothing calls it', status: 'open', options: [{ key: 'a', label: 'Drop it', meaning: 'removed next wave' }] }
  engine(on, approving(null as any, { shape: 'sweep', stage: 'Build', status: 'running', name: 'backlog-sweep', questions: [question] }))
  await start($)
  const tall = await $.ui.mount(BAND)
  expect(await tall.find({ type: 'Text', text: /Drop the old export route\?/ })).toBeDefined()
  expect(await tall.find({ type: 'Text', text: /^LCW Sweep · $/ })).toBeDefined()
  await tall.unmount()
  const short = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 6 } })
  expect(await short.find({ type: 'Text', text: /Drop the old export route\?/ })).toBeDefined()
  expect(await short.find({ type: 'Text', text: /^LCW Sweep · $/ })).toBeUndefined()
  await short.unmount()
})

test('a slash command from the person leaves the box showing', async ($, on) => {
  const w = engine(on, approving())
  await start($)
  await $.prompt.submit({ text: '/model', command: { name: 'model', args: '' } } as any)
  await w.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /Is this what you want built\?/ })).toBeDefined()
  await band.unmount()
})

test('a reply sent before a reload of the mod keeps the box away after it', async ($, on) => {
  engine(on, approving(), { kept: { repliedAt: { shape: 'kept-1', value: NOW - 500 } } })
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /Is this what you want built\?/ })).toBeUndefined()
  await band.unmount()
})

test('a prompt the person sends ends the box', async ($, on) => {
  const w = engine(on, approving())
  await start($)
  await $.prompt.submit({ text: 'Go (a)' })
  await w.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /Is this what you want built\?/ })).toBeUndefined()
  await band.unmount()
})
test("a sweep's charter box asks for the charter, and its Go only fills the prompt", async ($, on) => {
  const w = engine(on, approving({ go: [], at: NOW - 1000 }, { shape: 'sweep', stage: 'Charter', name: 'backlog-sweep' }))
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /Is this the charter you want\?/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /LCW Sweep · Charter ready/ })).toBeDefined()
  await band.press({ key: 'banner:approve:go1' })
  expect(w.filled).toEqual(['Go'])
  expect(w.prompts).toEqual([])
  expect(w.toasts).toEqual([])
  await band.unmount()
})

test('the approval box rings once when it appears, and not again as it is drawn again', async ($, on) => {
  const w = engine(on, approving())
  await start($)
  const band = await $.ui.mount(BAND)
  await w.clock.advance(30000)
  await band.unmount()
  const again = await $.ui.mount(BAND)
  await w.clock.advance(10000)
  expect(w.notified).toEqual(['Is this what you want built?'])
  await again.unmount()
})

test('a bell that could not go out yet rings on a later draw, and the box counts as rung once it went out', async ($, on) => {
  const w = engine(on, approving(), { notify: [{ isSent: false, reason: 'no-surface' }] })
  await start($)
  const band = await $.ui.mount(BAND)
  await w.clock.advance(30000)
  expect(w.notified).toEqual(['Is this what you want built?', 'Is this what you want built?'])
  expect(w.kept.rung?.value).toEqual(['approve:r1:' + (NOW - 1000)])
  await band.unmount()
})

test('a bell no channel sounded is not counted as rung, and is not rung again on every draw', async ($, on) => {
  const w = engine(on, approving(), { notify: [{ isSent: false, reason: 'no-channel' }] })
  await start($)
  const band = await $.ui.mount(BAND)
  await w.clock.advance(30000)
  expect(w.notified).toEqual(['Is this what you want built?'])
  expect(w.kept.rung?.value ?? []).toEqual([])
  await band.unmount()
})

test('a box that rang before a reload of the mod does not ring after it', async ($, on) => {
  const w = engine(on, approving(), { kept: { rung: { shape: 'kept-1', value: ['approve:r1:' + (NOW - 1000)] } } })
  await start($)
  const band = await $.ui.mount(BAND)
  await w.clock.advance(10000)
  expect(await band.find({ type: 'Text', text: /Is this what you want built\?/ })).toBeDefined()
  expect(w.notified).toEqual([])
  await band.unmount()
})

test('a mark box that waits for room above the card does not ring; it rings once it is drawn', async ($, on) => {
  const w = engine(on, {
    ...approving(undefined, { status: 'paused', pausedReason: 'mark', pausedAt: '2026-11-20T03:00:00Z', markPercent: 75, stage: 'Build' }),
    '/lcw/usage.json': JSON.stringify({ at: NOW, sevenDay: { percentUsed: 76, resetsAt: '2026-11-22T14:00:00Z' } }),
  })
  await start($)
  const tight = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 13 } })
  await w.clock.advance(10000)
  expect(await tight.find({ type: 'Text', text: /paused at your 75% mark\./ })).toBeUndefined()
  expect(w.notified).toEqual([])
  await tight.unmount()
  const roomy = await $.ui.mount(BAND)
  await w.clock.advance(10000)
  expect(await roomy.find({ type: 'Text', text: /paused at your 75% mark\./ })).toBeDefined()
  expect(w.notified.length).toBe(1)
  await roomy.unmount()
})
