import type { RenderSurface } from 'claude-code'
import { expect, mock } from 'claude-code/testing'
import { test } from './kit'

// The boxes as the mod wires them: the facts it gathers, what a press runs or submits, and when it stays quiet.

const NOW = Date.parse('2026-11-20T12:00:00Z')
const HOUR = 3600000
const RUN = '/lcw/repos/repo-1/runs/r1'
const OLD = '/lcw/repos/repo-1/runs/r2'
const BAND = {
  plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 40, bodyColumns: 100, scroll: { offset: 0, bodyRows: 39 }, view: {} },
} as const

type Answer = { exitCode: number; stdout: string; stderr?: string }

// Files in memory with their times, a clock the test moves, and every command, prompt, fill and toast the mod makes.
function engine(on: any, files: Record<string, string>, opts: {
  answer?: (argv: string[]) => Answer | undefined | Promise<Answer | undefined>; draft?: string | (() => string); fills?: boolean
  submitFails?: number; drops?: number; settings?: Record<string, unknown>; project?: Record<string, unknown>; platform?: string
} = {}) {
  const clock = mock.clock(on, { now: NOW })
  const times: Record<string, number> = {}
  // Every change to a file moves its time on, as a file system's does, two changes in one moment included.
  let changes = 0
  const touch = (path: string) => { times[path] = clock.now() + ++changes / 1000 }
  files = new Proxy(files, { set: (all, path: string, text) => { all[path] = text; touch(path); return true } })
  const runs: string[][] = []
  const limits: Record<string, unknown> = {}
  const prompts: { text: string; asUser?: boolean }[] = []
  const toasts: string[] = []
  // How long each toast stays, in the order said; the engine's own default is 4 s.
  const lasts: number[] = []
  const filled: string[] = []
  const reads: string[] = []
  let fails = opts.submitFails ?? 0
  let drops = opts.drops ?? 0
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.info', () => ({ value: { transcriptPath: '', platform: opts.platform ?? 'linux' } }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  // settings: the user settings file; project: a project's, over it in the merge.
  const user = { advisorModel: 'fable', ...opts.settings }
  on('settings.read', (_: any, e: any) => ({ value: !e.source ? { ...user, ...opts.project } : e.source === 'user' ? user : e.source === 'project' ? { ...opts.project } : {} }))
  on('fs.read', (_: any, e: any) => {
    reads.push(e.path)
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.list', (_: any, e: any) => {
    const kids = new Map<string, string>()
    for (const p of Object.keys(files)) {
      if (!p.startsWith(e.path + '/')) continue
      const [name = '', ...more] = p.slice(e.path.length + 1).split('/')
      kids.set(name, more.length ? 'dir' : 'file')
    }
    if (!kids.size) throw new Error('ENOENT')
    return { value: [...kids].map(([name, kind]) => ({ name, kind, size: kind === 'dir' ? 0 : files[e.path + '/' + name]!.length, isLink: false, mtimeMs: kind === 'dir' ? 0 : times[e.path + '/' + name] ?? NOW - 2 * HOUR })) }
  })
  on('process.run', async (_: any, e: any) => {
    runs.push([...e.argv])
    limits[e.argv.join(' ')] = e.init?.timeoutMs
    const said = await opts.answer?.(e.argv)
    if (said) return { value: { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...said } }
    const out = e.argv.includes('where') ? JSON.stringify({ main: '/repo', key: 'repo-1', run: null }) : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', (_: any, e: any) => {
    if (fails > 0) { fails--; throw new Error('busy') }
    if (drops > 0) { drops--; return { drop: 'a Stop stands' } }
    prompts.push({ text: String(e.text), asUser: e.origin?.asUser }); return { text: e.text }
  })
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer ?? '' }))
  on('prompt.read', () => ({ value: { text: (typeof opts.draft === 'function' ? opts.draft() : opts.draft) ?? '', cursor: 0 } }))
  on('prompt.fill', (_: any, e: any) => { if (opts.fills === false) return { isFilled: false }; filled.push(e.text); return { isFilled: true } })
  on('ui.toast', (_: any, e: any) => { toasts.push(e.text); lasts.push(e.timeoutMs ?? 4000); return { value: undefined } })
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  return { clock, files, times, runs, limits, prompts, toasts, lasts, filled, reads }
}

const start = ($: any, isInteractive = true, surface: string | null = 'terminal') => $.session.start({ cwd: '/repo', surface, isInteractive })
const lcwCalls = (runs: string[][], word: string) => runs.filter((a) => a[1]?.endsWith('/scripts/lcw.mjs') && a[2] === word).map((a) => a.slice(2).join(' '))
const state = (over: object) => JSON.stringify({ id: 'r1', name: 'export-csv', status: 'running', stage: 'Build', stageSince: NOW - HOUR, asks: [], tasks: [], ...over })
const bound = (over: object) => ({
  '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN, billing: 'subscription' }),
  [RUN + '/state.json']: state(over),
  '/lcw/usage.json': JSON.stringify({ at: NOW, sevenDay: { percentUsed: 76, resetsAt: '2026-11-22T14:00:00Z' } }),
})
const paused = { status: 'paused', pausedReason: 'mark', pausedAt: '2026-11-20T03:00:00Z', markPercent: 75 }

test('in a session nobody watches (a -p run) no box shows, no setting is changed and no weekly check is asked', async ($, on) => {
  const w = engine(on, bound(paused))
  on('session.surfaces', () => ({ value: [] }))
  await start($, false, null)
  await w.clock.advance(130000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /paused at your 75% mark\./ })).toBeUndefined()
  expect(w.runs.some((a) => a.some((x) => /setup\.mjs|weekly\.mjs/.test(x)))).toBe(false)
  expect(w.reads).not.toContain('/lcw/notices.json')
  await band.unmount()
})

test('a session the desktop app draws through the SDK counts as watched: its boxes show', async ($, on) => {
  engine(on, bound(paused))
  await start($, false, 'desktop')
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /export-csv paused at your 75% mark\./ })).toBeDefined()
  await band.unmount()
})

test('a session the desktop app attaches to is watched until it leaves', async ($, on) => {
  const w = engine(on, bound(paused))
  let surfaces: RenderSurface[] = []
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.attach', (_: any, e: any) => ({ clientId: e.clientId }))
  on('session.detach', (_: any, e: any) => ({ clientId: e.clientId }))
  await start($, false, null)
  surfaces = ['desktop']
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as any)
  await w.clock.advance(2000)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /export-csv paused at your 75% mark\./ })).toBeDefined()
  await band.unmount()
  surfaces = []
  await $.session.detach({ surface: 'desktop', clientId: 'desktop:default', reason: 'detach' } as any)
  await w.clock.advance(100)
  const reads = w.reads.filter((p) => p === '/lcw/notices.json').length
  await w.clock.advance(10000)
  expect(w.reads.filter((p) => p === '/lcw/notices.json').length).toBe(reads)
})

test('a watched session runs setup auto on its first draw and says what it turned on', async ($, on) => {
  const line = 'LCW turned on its status rows. Say "uninstall LCW" to undo it.'
  const w = engine(on, {}, { answer: (a) => (a.at(-1) === 'auto' ? { exitCode: 0, stdout: line + '\n' } : undefined) })
  await start($)
  const band = await $.ui.mount(BAND)
  expect(w.runs.filter((a) => a.at(-1) === 'auto').length).toBe(1)
  expect(w.toasts).toContain(line)
  await band.unmount()
})

test('Run up to 90% on a run paused at the mark raises the mark, resumes the run and asks Claude to carry on; the card drops its hint', async ($, on) => {
  const w = engine(on, bound(paused))
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /export-csv paused at your 75% mark\./ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /run up to 85%/ })).toBeUndefined()
  await band.press({ key: 'banner:mark:r90' })
  expect(lcwCalls(w.runs, 'mark')).toEqual(['mark 90 --session s1'])
  expect(lcwCalls(w.runs, 'resume')).toEqual(['resume --session s1'])
  expect(w.prompts.map((p) => p.text).join()).toMatch(/status --session s1/)
  await band.unmount()
})

test('a press on a box that has changed since it was drawn does nothing and says so long enough to read', async ($, on) => {
  const w = engine(on, bound(paused))
  await start($)
  const band = await $.ui.mount(BAND)
  w.files[RUN + '/state.json'] = JSON.stringify({ ...JSON.parse(w.files[RUN + '/state.json']!), pausedAt: '2026-11-20T04:00:00Z' })
  await band.press({ key: 'banner:mark:r90' })
  expect(lcwCalls(w.runs, 'mark')).toEqual([])
  expect(w.toasts).toEqual(['That box changed before the click, so nothing was done.'])
  expect(w.lasts).toEqual([10000])
  await band.unmount()
})

test('a raise whose prompt the engine drops keeps the box and tells the person to carry on', async ($, on) => {
  const w = engine(on, bound(paused), { drops: 1 })
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:mark:r90' })
  expect(w.prompts.length).toBe(0)
  expect(w.toasts).toEqual(['LCW raised the mark and resumed the run. Say "carry on" to continue it.'])
  expect(w.lasts).toEqual([10000])
  expect(await band.find({ type: 'Text', text: /export-csv paused at your 75% mark\./ })).toBeDefined()
  await band.unmount()
})

test('a box shows above a short card where both fit; where they do not, the card stays whole and keeps its hint', async ($, on) => {
  engine(on, bound(paused))
  await start($)
  const fits = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 16 } })
  expect(await fits.find({ type: 'Text', text: /export-csv paused at your 75% mark\./ })).toBeDefined()
  expect(await fits.find({ type: 'Text', text: /^LCW Build · $/ })).toBeDefined()
  await fits.unmount()
  const tight = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 13 } })
  expect(await tight.find({ type: 'Text', text: /export-csv paused at your 75% mark\./ })).toBeUndefined()
  expect(await tight.find({ type: 'Text', text: /run up to 85%/ })).toBeDefined()
  await tight.unmount()
})

test('on a wide terminal the box over the card is as wide as the card', async ($, on) => {
  engine(on, bound(paused))
  await start($)
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 140 } })
  const bottoms = (await band.findAll({ type: 'Text', text: /^╰─+╯$/ })).map((t: any) => [...String(t.text)].length)
  expect(bottoms.length).toBeGreaterThan(1)
  expect(new Set(bottoms)).toEqual(new Set([140]))
  await band.unmount()
})

test('a raise is not resumed when lcw says the session is still at the mark, and the person is told', async ($, on) => {
  const w = engine(on, bound(paused), { answer: (a) => (a[2] === 'mark' ? { exitCode: 0, stdout: 'mark 90%\nweek: 91% used\nat the mark' } : undefined) })
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:mark:r90' })
  expect(lcwCalls(w.runs, 'resume')).toEqual([])
  expect(w.prompts.length).toBe(0)
  expect(w.toasts.join()).toMatch(/at the mark/)
  await band.unmount()
})

test('a box that changed since it was drawn is not acted on', async ($, on) => {
  const w = engine(on, bound(paused))
  await start($)
  const band = await $.ui.mount(BAND)
  w.files[RUN + '/state.json'] = state({ ...paused, pausedAt: '2026-11-20T11:59:00Z' })
  await band.press({ key: 'banner:mark:r90' })
  expect(lcwCalls(w.runs, 'mark')).toEqual([])
  await band.unmount()
})

test('on pay-per-token billing Wait hides this climb to the mark; spend below it for a minute that climbs back brings the box again', async ($, on) => {
  const DAY = 24 * HOUR
  const spent = (usd: number) => JSON.stringify({ v: 1, base: 0, max: usd, q: { [Math.floor((NOW - DAY) / 900000)]: usd } })
  const w = engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'payg' }), '/lcw/cap.json': JSON.stringify({ usd: 4000 }), '/lcw/spend/s1.json': spent(3500) })
  await start($)
  const band = await $.ui.mount(BAND)
  const atMark = { type: 'Text', text: /This session is at your \$3,000 mark/ } as const
  expect(await band.find(atMark)).toBeDefined()
  await band.press({ key: 'banner:mark:wait' })
  await w.clock.advance(2000)
  expect(await band.find(atMark)).toBeUndefined()
  // One low reading, as from a spend file caught mid-write, is the same climb.
  w.files['/lcw/spend/s1.json'] = spent(1000)
  await w.clock.advance(2000)
  w.files['/lcw/spend/s1.json'] = spent(3500)
  await w.clock.advance(2000)
  expect(await band.find(atMark)).toBeUndefined()
  // With no run the files are looked at every five seconds: the minute below is counted from the first look that sees it.
  w.files['/lcw/spend/s1.json'] = spent(1000)
  await w.clock.advance(66000)
  w.files['/lcw/spend/s1.json'] = spent(3500)
  await w.clock.advance(5000)
  expect(await band.find(atMark)).toBeDefined()
  await band.unmount()
})

// Each question with the time it was asked, as lcw ask records it.
const asking = (asks: object[]) => bound({ asks: asks.map((a, i) => ({ at: NOW - HOUR + i, ...a })) })

test('Later hides the question for the session; a new question brings the box back, though lcw numbers it 1 again', async ($, on) => {
  const w = engine(on, asking([{ n: 1, text: 'Which format?', waiting: 2 }]))
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /export-csv needs your answer\./ })).toBeDefined()
  await band.press({ key: 'banner:answer:later' })
  await w.clock.advance(2000)
  expect(await band.find({ type: 'Text', text: /needs your answer/ })).toBeUndefined()
  w.files[RUN + '/state.json'] = state({ asks: [] })
  await w.clock.advance(2000)
  w.files[RUN + '/state.json'] = state({ asks: [{ n: 1, text: 'And the name?', at: NOW + 3000 }] })
  await w.clock.advance(2000)
  expect(await band.find({ type: 'Text', text: /needs your answer/ })).toBeDefined()
  await band.unmount()
})

test('an ask that holds nothing has the answer box and a mark on the card, with no needs-you; Later leaves the mark', async ($, on) => {
  const w = engine(on, asking([{ n: 1, text: 'Two mocks of the export screen are open in your browser.', nowait: true }]))
  await start($)
  // where both do not fit the box stays: the card says only that something waits, not what
  const short = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 10 } })
  expect(await short.find({ type: 'Text', text: /export-csv has something for you\./ })).toBeDefined()
  await short.unmount()
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /export-csv has something for you\./ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /1 thing for you/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /needs you/ })).toBeUndefined()
  await band.press({ key: 'banner:answer:later' })
  await w.clock.advance(2000)
  expect(await band.find({ type: 'Text', text: /has something for you/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /1 thing for you/ })).toBeDefined()
  await band.unmount()
})

test('a box that replaces another is drawn first with no buttons, so the focus left on the old one lets go', async ($, on) => {
  const w = engine(on, bound({ ...paused, asks: [{ n: 1, text: 'Which format?', waiting: 2 }] }))
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:answer:later' })
  await w.clock.advance(100)
  expect(await band.find({ type: 'Text', text: /export-csv paused at your 75% mark\./ })).toBeDefined()
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  await w.clock.advance(400)
  expect(await band.find({ type: 'Button', key: 'banner:mark:r100' })).toBeDefined()
  await band.unmount()
})

test('Answer now puts the oldest question\'s number in the prompt, keeping what is typed', async ($, on) => {
  const w = engine(on, asking([{ n: 3, text: 'b' }, { n: 2, text: 'a' }]), { draft: 'csv' })
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:answer:now' })
  expect(w.filled).toEqual(['2: csv'])
  await band.unmount()
})

test('Answer now leaves a draft that already names a question as typed', async ($, on) => {
  const w = engine(on, asking([{ n: 1, text: 'a' }, { n: 2, text: 'b' }]), { draft: '2: use csv' })
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:answer:now' })
  expect(w.filled).toEqual(['2: use csv'])
  await band.unmount()
})

test('where Answer now cannot fill the prompt, the box says to type the answer there', async ($, on) => {
  const w = engine(on, asking([{ n: 1, text: 'Which format?' }, { n: 2, text: 'And the name?' }]), { fills: false })
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:answer:now' })
  await w.clock.advance(200)
  expect(await band.find({ type: 'Text', text: /could not fill your prompt/ })).toBeDefined()
  await band.unmount()
})

test('under the answer box the card does not repeat the question; once put off, the card has it again', async ($, on) => {
  const w = engine(on, asking([{ n: 1, text: 'Which export format should the report use?', waiting: 2 }]))
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /needs you/ })).toBeDefined()
  // one row says it, the box's: a row is a Text, and so is each of its spans
  expect((await band.findAll({ type: 'Text', text: /^│.*Which export format/ })).length).toBe(1)
  await band.press({ key: 'banner:answer:later' })
  await w.clock.advance(2000)
  expect(await band.find({ type: 'Text', text: /Which export format/ })).toBeDefined()
  await band.unmount()
})

const REMOTE = { n: 1, text: 'Which remote?', recommend: 'b', options: [{ key: 'a', label: 'origin', meaning: 'once the token can write' }, { key: 'b', label: 'fork', meaning: 'push to your fork' }] }

test("an ask's option pressed records the answer and tells the run, with no prompt to type", async ($, on) => {
  const w = engine(on, asking([REMOTE]))
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:answer:b' })
  await w.clock.advance(100)
  expect(lcwCalls(w.runs, 'answer')).toEqual(['answer 1 fork: push to your fork --session s1'])
  expect(w.prompts.map((p) => p.text).join(' ')).toMatch(/answered ask 1 .*fork: push to your fork/)
  expect(w.filled).toEqual([])
  await band.unmount()
})

test("Later on a sweep's question shown before an ask brings up the ask's buttons", async ($, on) => {
  const question = { id: 'Q1', text: 'Keep the 409?', why: 'w', status: 'open', recommend: 'a', options: [{ key: 'a', label: 'Keep', meaning: 'm' }, { key: 'b', label: 'Change', meaning: 'n' }] }
  const w = engine(on, bound({ shape: 'sweep', questions: [question], asks: [{ ...REMOTE, at: NOW - HOUR }] }))
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:question:later' })
  await w.clock.advance(1000)
  expect(await band.find({ type: 'Button', key: 'banner:answer:b' })).toBeDefined()
  await band.unmount()
})

test("an answer pressed whose prompt the engine refuses still reaches the run, sent again later", async ($, on) => {
  const w = engine(on, asking([REMOTE]), { submitFails: 1 })
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:answer:b' })
  await w.clock.advance(40000)
  expect(lcwCalls(w.runs, 'answer')).toEqual(['answer 1 fork: push to your fork --session s1'])
  expect(w.prompts.filter((p) => /answered ask 1/.test(p.text)).length).toBe(1)
  await band.unmount()
})

test('an answer pressed while a reopen prompt still waits to be sent reaches the run with it', async ($, on) => {
  const w = engine(on, { ...asking([REMOTE]), [RUN + '/mod-alive']: String(NOW - 60000) }, { drops: 1 })
  await start($)
  await w.clock.advance(5000)
  expect(w.prompts.length).toBe(0)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:answer:b' })
  await w.clock.advance(40000)
  const all = w.prompts.map((p) => p.text).join('\n')
  expect(all).toMatch(/reopened/)
  expect(all).toMatch(/answered ask 1/)
  await band.unmount()
})

test("an ask's Other puts its number in the prompt, as Answer now does", async ($, on) => {
  const w = engine(on, asking([REMOTE]))
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:answer:other' })
  expect(w.filled).toEqual(['1: '])
  expect(lcwCalls(w.runs, 'answer')).toEqual([])
  await band.unmount()
})

const leftHalfway = (over: object = {}) => ({
  '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription' }),
  [OLD + '/state.json']: JSON.stringify({ id: 'r2', name: 'old-run', title: 'adding a CSV export', status: 'running', stage: 'Build', tasks: [], asks: [], ...over }),
  [OLD + '/ledger.md']: '- t checkpoint: merge T3 and start T4\n',
})

test('a run left halfway shows to a session driving none; Resume takes it over and hands Claude its next step', async ($, on) => {
  const w = engine(on, leftHalfway())
  await start($)
  await w.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /stopped halfway: old-run\./ })).toBeDefined()
  await band.press({ key: 'banner:unfinished:resume' })
  expect(lcwCalls(w.runs, 'take')).toEqual(['take r2 --session s1'])
  expect(w.prompts.map((p) => p.text).join()).toMatch(/merge T3 and start T4/)
  await band.unmount()
})

test('lcw where is given a time limit, so one that hangs cannot hold the slow checks', async ($, on) => {
  const w = engine(on, leftHalfway())
  await start($)
  await w.clock.advance(2000)
  const ms = Object.entries(w.limits).find(([argv]) => / where --json$/.test(argv))?.[1]
  expect(typeof ms === 'number' && ms > 0).toBe(true)
})

test('a failed lcw where is asked again half a minute later, so the run left halfway still shows', async ($, on) => {
  let wheres = 0
  const w = engine(on, leftHalfway(), { answer: (a) => (a.includes('where') && ++wheres <= 2 ? { exitCode: 1, stdout: '' } : undefined) })
  await start($)
  await w.clock.advance(32000)
  expect(wheres).toBe(2)
  await w.clock.advance(32000)
  expect(wheres).toBe(3)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /stopped halfway: old-run\./ })).toBeDefined()
  await band.unmount()
})

test('Resume pressed seconds after the session started hands Claude the run once, with no reopen prompt on top', async ($, on) => {
  const w = engine(on, leftHalfway(), {
    answer: (a) => { if (a[2] === 'take') w.files['/lcw/sessions/s1.json'] = JSON.stringify({ billing: 'subscription', runDir: OLD }); return undefined },
  })
  await start($)
  await w.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:unfinished:resume' })
  await w.clock.advance(5000)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]?.text).toMatch(/pressed Resume/)
  await band.unmount()
})

test('Abandon runs lcw abandon and says in sentences what it did: the worktree removed or kept and why, and the branch kept', async ($, on) => {
  const said = (stdout: string) => (a: string[]) => (a[2] === 'abandon' ? { exitCode: 0, stdout } : undefined)
  const kept = engine(on, leftHalfway(), { answer: said('abandoned r2: stopped for good\nworktree kept: /repo/.claude/worktrees/old-run, because it has uncommitted or untracked files\nbranch kept: lcw/old-run') })
  await start($)
  await kept.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:unfinished:abandon' })
  expect(lcwCalls(kept.runs, 'abandon')).toEqual(['abandon r2 --session s1'])
  expect(kept.toasts).toEqual(['old-run is stopped for good. Its worktree is kept, because it has uncommitted or untracked files. Its branch lcw/old-run is kept.'])
  await band.unmount()
})

test('Abandon says the worktree was removed when lcw removed it', async ($, on) => {
  const w = engine(on, leftHalfway(), { answer: (a) => (a[2] === 'abandon' ? { exitCode: 0, stdout: 'abandoned r2: stopped for good\nworktree removed: /repo/.claude/worktrees/old-run' } : undefined) })
  await start($)
  await w.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:unfinished:abandon' })
  expect(w.toasts).toEqual(['old-run is stopped for good. Its worktree is removed.'])
  await band.unmount()
})

// ps -o args= for pid 4242: a Claude Code, or a program that got its pid after it closed.
const psSays = (args: string) => (a: string[]) => (a[0] === 'ps' && a.includes('4242') ? { exitCode: 0, stdout: args + '\n' } : undefined)

test('a run shown in the last 15 minutes, or whose Claude Code is still open, is not offered', async ($, on) => {
  const w = engine(on, {
    ...leftHalfway({ driver: 's0' }), '/lcw/sessions/s0.json': JSON.stringify({ claudePid: 4242 }),
    '/lcw/repos/repo-1/runs/r3/state.json': JSON.stringify({ id: 'r3', name: 'fresh-run', status: 'running', stage: 'Spec' }),
  }, { answer: psSays('claude --continue') })
  w.times['/lcw/repos/repo-1/runs/r3/state.json'] = NOW - 60000
  await start($)
  await w.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  expect(w.runs.some((a) => a[0] === 'ps' && a.includes('4242'))).toBe(true)
  expect(await band.find({ type: 'Text', text: /stopped halfway/ })).toBeUndefined()
  await band.unmount()
})

test("a run whose driver's pid another program now has is offered", async ($, on) => {
  const w = engine(on, { ...leftHalfway({ driver: 's0' }), '/lcw/sessions/s0.json': JSON.stringify({ claudePid: 4242 }) }, { answer: psSays('/usr/bin/python3 server.py') })
  await start($)
  await w.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /stopped halfway: old-run\./ })).toBeDefined()
  await band.unmount()
})

test('a run whose driver is this same Claude Code (a /clear since) is offered', async ($, on) => {
  const w = engine(on, {
    ...leftHalfway({ driver: 's0' }), '/lcw/sessions/s0.json': JSON.stringify({ claudePid: 4242 }),
    '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription', claudePid: 4242 }),
  })
  await start($)
  await w.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /stopped halfway: old-run\./ })).toBeDefined()
  await band.unmount()
})

test('Not now on the newest run left halfway lets an older one show', async ($, on) => {
  const NEW = '/lcw/repos/repo-1/runs/r5'
  const w = engine(on, { ...leftHalfway(), [NEW + '/state.json']: JSON.stringify({ id: 'r5', name: 'new-run', status: 'running', stage: 'Spec' }) })
  w.times[NEW + '/state.json'] = NOW - HOUR
  await start($)
  await w.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /stopped halfway: new-run\./ })).toBeDefined()
  await band.press({ key: 'banner:unfinished:later' })
  await w.clock.advance(4000)
  expect(await band.find({ type: 'Text', text: /stopped halfway: old-run\./ })).toBeDefined()
  await band.unmount()
})

test('Clean Up says it has started and returns at once; the removal runs after the press, its result is said, and the box goes', async ($, on) => {
  const apply = (a: string[]) => a.at(-1) === 'apply' && a[1]?.endsWith('/scripts/cleanup.mjs')
  const w = engine(on, { '/lcw/repos/repo-1/cleanup.json': JSON.stringify({ at: NOW - HOUR, title: 'Two branches look done with.', bullets: ['a was merged'] }) }, {
    answer: (a) => {
      if (!apply(a)) return undefined
      delete w.files['/lcw/repos/repo-1/cleanup.json']
      return { exitCode: 0, stdout: 'removed branch a\n' }
    },
  })
  await start($)
  await w.clock.advance(4000)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:cleanup:clean' })
  expect(w.runs.filter(apply).length).toBe(0)
  expect(w.toasts.join('|')).toMatch(/Cleaning up/)
  await band.press({ key: 'banner:cleanup:clean' })
  expect(w.toasts.join('|')).toMatch(/still on the last button/)
  expect(w.lasts.at(-1)).toBe(10000)
  await w.clock.advance(1000)
  expect(w.runs.filter(apply).length).toBe(1)
  expect(w.toasts.join('|')).toMatch(/Branch a is removed\./)
  await w.clock.advance(4000)
  expect(await band.find({ type: 'Text', text: /Two branches look done with/ })).toBeUndefined()
  await band.unmount()
})

for (const [platform, where] of [['macos', 'this Mac'], ['linux', 'this computer']]) {
  test(`the cleanup box on ${platform} says ${where}`, async ($, on) => {
    const w = engine(on, { '/lcw/repos/repo-1/cleanup.json': JSON.stringify({ at: NOW - HOUR, title: 'Two branches look done with.', bullets: ['a was merged'] }) }, { platform })
    await start($)
    await w.clock.advance(4000)
    const band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: new RegExp('Clean Up removes them from ' + where + ' only') })).toBeDefined()
    await band.unmount()
  })
}

const WEEKLY = 'LCW weekly check: is anything in this repository worth cleaning up?'
const weeklyAnswer = (a: string[]) => (a.at(-1) === 'due' ? { exitCode: 0, stdout: WEEKLY + '\n' } : undefined)

test('two minutes into an idle session the due weekly check is submitted, once', async ($, on) => {
  const w = engine(on, {}, { answer: weeklyAnswer })
  await start($)
  await w.clock.advance(100000)
  expect(w.prompts.length).toBe(0)
  await w.clock.advance(30000)
  expect(w.prompts.map((p) => p.text)).toEqual([WEEKLY])
  await w.clock.advance(5 * 60000)
  expect(w.runs.filter((a) => a.at(-1) === 'due').length).toBe(1)
})

const UPDATE = "LCW weekly check: load the lcw:weekly skill and run its update check. Scripts: '/p/scripts'."
const updateAnswer = (a: string[]) => (a.at(-1) === 'update' ? { exitCode: 0, stdout: UPDATE + '\n' } : a.at(-1) === 'due' ? { exitCode: 0, stdout: WEEKLY + '\n' } : undefined)
const updateLooks = (runs: string[][]) => runs.filter((a) => a.at(-1) === 'update').length

test('a session looks for an update once, at its start, even with something typed; the prompt waits for two idle minutes', async ($, on) => {
  let typed = 'half a thought'
  const w = engine(on, {}, { answer: updateAnswer, draft: () => typed })
  await start($)
  await w.clock.advance(2000)
  expect(updateLooks(w.runs)).toBe(1)
  await w.clock.advance(130000)
  expect(w.prompts.length).toBe(0)
  typed = ''
  await w.clock.advance(2000)
  expect(w.prompts.map((p) => p.text)).toEqual([UPDATE])
  await w.clock.advance(5 * 60000)
  expect(updateLooks(w.runs)).toBe(1)
  expect(w.prompts.map((p) => p.text)).toEqual([UPDATE, WEEKLY])
})

test('no weekly check is asked while the person has something typed', async ($, on) => {
  const typed = engine(on, {}, { answer: weeklyAnswer, draft: 'half a thought' })
  await start($)
  await typed.clock.advance(3 * 60000)
  expect(typed.runs.some((a) => a.at(-1) === 'due')).toBe(false)
  expect(typed.prompts.length).toBe(0)
})

test('a check found while the person started typing waits until the prompt is empty again', async ($, on) => {
  let typed = ''
  let reads = 0
  const w = engine(on, {}, { answer: weeklyAnswer, draft: () => (++reads > 1 ? typed : '') })
  typed = 'half a thought'
  await start($)
  await w.clock.advance(125000)
  expect(w.runs.filter((a) => a.at(-1) === 'due').length).toBe(1)
  expect(w.prompts.length).toBe(0)
  typed = ''
  await w.clock.advance(2000)
  expect(w.prompts.map((p) => p.text)).toEqual([WEEKLY])
})

test('a session driving a run is never asked for a weekly check, nor looks for an update', async ($, on) => {
  const w = engine(on, bound({}), { answer: updateAnswer })
  await start($)
  await w.clock.advance(3 * 60000)
  expect(updateLooks(w.runs)).toBe(0)
  expect(w.runs.some((a) => a.at(-1) === 'due')).toBe(false)
})

test('a check that cannot be submitted is kept and sent at the next idle tick', async ($, on) => {
  const w = engine(on, {}, { answer: weeklyAnswer, submitFails: 1 })
  await start($)
  await w.clock.advance(121000)
  expect(w.runs.filter((a) => a.at(-1) === 'due').length).toBe(1)
  expect(w.prompts.length).toBe(0)
  await w.clock.advance(2000)
  expect(w.prompts.map((p) => p.text)).toEqual([WEEKLY])
  expect(w.runs.filter((a) => a.at(-1) === 'due').length).toBe(1)
})

test('a check the engine drops is kept and sent at the next idle tick', async ($, on) => {
  const w = engine(on, {}, { answer: weeklyAnswer, drops: 1 })
  await start($)
  await w.clock.advance(121000)
  expect(w.prompts.length).toBe(0)
  await w.clock.advance(2000)
  expect(w.prompts.map((p) => p.text)).toEqual([WEEKLY])
  expect(w.runs.filter((a) => a.at(-1) === 'due').length).toBe(1)
})

test('the weekly check waits two quiet minutes after the last reply', async ($, on) => {
  const w = engine(on, {}, { answer: weeklyAnswer })
  await start($)
  await w.clock.advance(100000)
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await w.clock.advance(10000)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, reason: 'answer', turnId: 't1' } as any)
  await w.clock.advance(30000)
  expect(w.runs.some((a) => a.at(-1) === 'due')).toBe(false)
  await w.clock.advance(100000)
  expect(w.runs.filter((a) => a.at(-1) === 'due').length).toBe(1)
})

test('no weekly check is asked while the session is at the usage mark', async ($, on) => {
  const w = engine(on, { '/lcw/usage.json': JSON.stringify({ at: NOW, sevenDay: { percentUsed: 80, resetsAt: '2026-11-22T14:00:00Z' } }) }, { answer: weeklyAnswer })
  await start($)
  await w.clock.advance(3 * 60000)
  expect(w.runs.some((a) => a.at(-1) === 'due')).toBe(false)
})

const awakeCheck = (a: string[]) => (a.includes('--check') ? { exitCode: 0, stdout: JSON.stringify({ canHold: true, heldByOther: false, kept: false }) } : undefined)
test('the awake check is given a time limit, so one that hangs cannot hold the slow checks', async ($, on) => {
  const w = engine(on, bound({ runningSince: 'T' }), { answer: awakeCheck })
  await start($)
  await w.clock.advance(65000)
  const ms = Object.entries(w.limits).find(([argv]) => / awake --check /.test(argv))?.[1]
  expect(typeof ms === 'number' && ms > 0).toBe(true)
})

const checks = (runs: string[][]) => runs.filter((a) => a.includes('--check')).length

test('whether the computer can be kept awake is not asked once the box is turned off', async ($, on) => {
  const w = engine(on, { ...bound({ runningSince: 'T' }), '/lcw/notices.json': JSON.stringify({ awake: 'never' }) }, { answer: awakeCheck })
  await start($)
  await w.clock.advance(65000)
  expect(checks(w.runs)).toBe(0)
})

test('whether the computer can be kept awake is not asked again once Not now hid the box', async ($, on) => {
  const w = engine(on, bound({ runningSince: 'T' }), { answer: awakeCheck })
  await start($)
  await w.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /Keep this computer awake while export-csv runs\?/ })).toBeDefined()
  const before = checks(w.runs)
  await band.press({ key: 'banner:awake:later' })
  await w.clock.advance(65000)
  expect(checks(w.runs)).toBe(before)
  await band.unmount()
})

// A ledger that changes is a run some session is at work on, which is no longer left halfway: the scan does not read it.
test('the ledger of a run left halfway is read once, not at every look over the runs', async ($, on) => {
  const w = engine(on, leftHalfway())
  await start($)
  await w.clock.advance(100000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /stopped halfway: old-run\./ })).toBeDefined()
  expect(w.reads.filter((p) => p === OLD + '/ledger.md').length).toBe(1)
  await band.unmount()
})

test('a finished run of the repository is read once a session, not at every look over the runs', async ($, on) => {
  const done = '/lcw/repos/repo-1/runs/r4/state.json'
  const w = engine(on, { ...leftHalfway(), [done]: JSON.stringify({ id: 'r4', name: 'shipped', status: 'finished', stage: 'Ship' }) })
  await start($)
  await w.clock.advance(31000)
  // The open run moves on, as an open run's state does. The finished one is written too: a run found finished is not
  // looked at again, whatever its file does.
  w.files[OLD + '/state.json'] = JSON.stringify({ ...JSON.parse(w.files[OLD + '/state.json']!), stage: 'Review' })
  w.files[done] = JSON.stringify({ ...JSON.parse(w.files[done]!), finishedAt: NOW })
  await w.clock.advance(34000)
  expect(w.reads.filter((p) => p === done).length).toBe(1)
  expect(w.reads.filter((p) => p === OLD + '/state.json').length).toBeGreaterThan(1)
})

test("a status line the person had before LCW shows the status-line box, and nothing does once LCW is uninstalled", async ($, on) => {
  // A long command with quotes, a substitution and a newline: the box is keyed by it.
  const settings = { statusLine: { type: 'command', command: "bash -c \"$(printf '%s' starship) prompt --status=$? --cmd-duration=12 --right\" && echo \"done\"\nnext line" } }
  const w = engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription' }) }, { settings })
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /status rows were replaced/ })).toBeDefined()
  w.files['/lcw/notices.json'] = JSON.stringify({ auto: 'off' })
  await w.clock.advance(5200)
  expect(await band.find({ type: 'Text', text: /status rows were replaced/ })).toBeUndefined()
  await band.unmount()
})

test("LCW's player command is LCW's own: no box", async ($, on) => {
  const command = `lcw_bin='/lcw/bin'; [ -r "$lcw_bin/statusline.sh" ] && . "$lcw_bin/statusline.sh"; node "$lcw_bin/statusline.mjs" || printf '%s\\n' 'LCW · status line could not load · see ~/.lcw/statusline.log'`
  engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription' }) }, { settings: { statusLine: { type: 'command', command } } })
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /status rows were replaced/ })).toBeUndefined()
  await band.unmount()
})

const fewAgents = (on: any, limits = { concurrent: 20, depth: 3 }) => on('agent.limits', () => ({ value: { ...limits, isBackgroundEnabled: true } }))

test('a session that runs too few agents is asked to raise the limits; Raise them runs setup, says what it did, and the box goes', async ($, on) => {
  const limits = (a: string[]) => a.at(-1) === 'limits' && a[1]?.endsWith('/scripts/setup.mjs')
  const w = engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription' }) }, {
    answer: (a) => (limits(a) ? { exitCode: 0, stdout: 'Claude Code now runs up to 80 agents at once.\n' } : undefined),
  })
  fewAgents(on)
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /Claude Code runs only 20 agents at once here\./ })).toBeDefined()
  await band.press({ key: 'banner:limits:raise' })
  expect(w.runs.filter(limits).length).toBe(1)
  expect(w.toasts.join('|')).toMatch(/now runs up to 80 agents at once/)
  await w.clock.advance(5200)
  expect(await band.find({ type: 'Text', text: /agents at once here/ })).toBeUndefined()
  await band.unmount()
})

test('limits already raised in the settings, or enough as they are, ask nothing', async ($, on) => {
  const settings = { env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '80', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '5' } }
  engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription' }) }, { settings })
  fewAgents(on)
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /agents at once here|nest only/ })).toBeUndefined()
  await band.unmount()
})

test('a session with room for its agents shows no box', async ($, on) => {
  engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription' }) })
  fewAgents(on, { concurrent: 80, depth: 5 })
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /agents at once here|nest only/ })).toBeUndefined()
  await band.unmount()
})

test("another status line still shows the box after the notice setup writes when it moves LCW's command, and Keep mine keeps it away", async ($, on) => {
  const settings = { statusLine: { type: 'command', command: 'starship statusline' } }
  const w = engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription' }), '/lcw/notices.json': JSON.stringify({ statusline: 'moved' }) }, { settings })
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /status rows were replaced/ })).toBeDefined()
  await band.press({ key: 'banner:statusline:keep' })
  expect(JSON.parse(w.files['/lcw/notices.json']!)).toEqual({ statusline: 'moved', statuslineKept: 'never' })
  await w.clock.advance(5200)
  expect(await band.find({ type: 'Text', text: /status rows were replaced/ })).toBeUndefined()
  await band.unmount()
})

test("a status line from a project's settings, which Put LCW's back cannot change, shows no box", async ($, on) => {
  const project = { statusLine: { type: 'command', command: 'starship statusline' } }
  engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription' }) }, { project })
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /status rows were replaced/ })).toBeUndefined()
  await band.unmount()
})

test('a press whose command fails says what it printed and keeps the box', async ($, on) => {
  const settings = { statusLine: { type: 'command', command: 'starship statusline' } }
  const w = engine(on, { '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription' }) }, {
    settings, answer: (a) => (a.at(-1) === 'statusline' ? { exitCode: 1, stdout: '', stderr: 'settings.json is not valid JSON' } : undefined),
  })
  await start($)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'banner:statusline:back' })
  await w.clock.advance(2200)
  expect(w.toasts.join()).toMatch(/could not put its status rows back: settings\.json is not valid JSON/)
  expect(await band.find({ type: 'Text', text: /status rows were replaced/ })).toBeDefined()
  await band.unmount()
})

test('a second press while the first is still running is refused', async ($, on) => {
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  const w = engine(on, leftHalfway(), {
    answer: async (a) => (a[2] === 'abandon' ? (await held, { exitCode: 0, stdout: 'abandoned r2: stopped for good' }) : undefined),
  })
  await start($)
  await w.clock.advance(2000)
  const band = await $.ui.mount(BAND)
  const first = band.press({ key: 'banner:unfinished:abandon' })
  await w.clock.advance(10)
  await band.press({ key: 'banner:unfinished:abandon' }).catch(() => {})
  expect(w.toasts.join()).toMatch(/still on the last button/)
  release()
  await first
  expect(lcwCalls(w.runs, 'abandon').length).toBe(1)
  await band.unmount()
})
