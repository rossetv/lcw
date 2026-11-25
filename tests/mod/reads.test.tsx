import { expect, mock } from 'claude-code/testing'
import { test } from './kit'

// What the mod reads, and how often it looks: a file is read again only when it changed, and a session with no run
// has only the files its usage mark is judged by looked at each second.

const NOW = Date.parse('2026-11-24T12:00:00Z')
const HOUR = 3600000
const RUN = '/lcw/repos/r/runs/a'
const BAND = {
  plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 40, bodyColumns: 100, scroll: { offset: 0, bodyRows: 39 }, view: {} },
} as const
const state = (over: object = {}) => JSON.stringify({ id: 'a', name: 'export-csv', status: 'running', stage: 'Build', stageSince: NOW - HOUR, createdAt: NOW - HOUR, asks: [], tasks: [], ...over })
const usage = (percentUsed: number) => JSON.stringify({ at: NOW, sevenDay: { percentUsed, resetsAt: '2026-11-27T12:00:00Z' } })
const bound = () => ({
  '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN, billing: 'subscription' }),
  [RUN + '/state.json']: state(),
  [RUN + '/mod-alive']: String(NOW - 1000),
  '/lcw/usage.json': usage(40),
})
const unbound = () => ({ '/lcw/sessions/s1.json': JSON.stringify({ billing: 'subscription' }), '/lcw/usage.json': usage(40) })

// A file system in memory whose times move with every change, as a real one's do, and a count of every call made on it.
function engine(on: any, initial: Record<string, string>) {
  const clock = mock.clock(on, { now: NOW })
  const times: Record<string, number> = {}
  let changes = 0
  const files = new Proxy(initial, { set: (all, path: string, text) => { all[path] = text; times[path] = clock.now() + ++changes / 1000; return true } })
  // infos: the session's info asked for, as each money view asks it for the name the session's spend is kept under.
  const w = { clock, files, reads: [] as string[], looks: 0, runs: [] as string[][], prompts: [] as string[], infos: 0 }
  const kids = (dir: string) => Object.keys(files).filter((p) => p.startsWith(dir + '/'))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.info', () => { w.infos++; return { value: { transcriptPath: '', platform: 'linux' } } })
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('settings.read', () => ({ value: {} }))
  on('fs.read', (_: any, e: any) => {
    w.reads.push(e.path)
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => { w.reads.push(e.path); return { value: e.path in files } })
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.list', (_: any, e: any) => {
    w.looks++
    const names = new Map<string, string>()
    for (const p of kids(e.path)) {
      const [name = '', ...more] = p.slice(e.path.length + 1).split('/')
      names.set(name, more.length ? 'dir' : 'file')
    }
    if (!names.size) throw new Error('ENOENT')
    return {
      value: [...names].map(([name, kind]) => {
        const path = e.path + '/' + name
        return kind === 'dir' ? { name, kind, size: 0, mtimeMs: 0, isLink: false } : { name, kind, size: files[path]!.length, mtimeMs: times[path] ?? NOW - HOUR, isLink: false }
      }),
    }
  })
  on('fs.stat', (_: any, e: any) => {
    w.looks++
    if (e.path in files) return { value: { kind: 'file', size: files[e.path]!.length, mtimeMs: times[e.path] ?? NOW - HOUR, isLink: false } }
    if (kids(e.path).length) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    throw new Error('ENOENT')
  })
  on('process.run', (_: any, e: any) => { w.runs.push([...e.argv]); return { value: { exitCode: 1, stdout: '', stderr: '' } } })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.submit', (_: any, e: any) => { w.prompts.push(String(e.text)); return { text: e.text } })
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  const counted = () => { const c = { reads: w.reads.length, looks: w.looks }; w.reads = []; w.looks = 0; return c }
  return { ...w, w, counted }
}

const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

// The session started, its card or box drawn, and the first looks over: what the next twenty seconds cost.
async function quietStretch($: any, e: ReturnType<typeof engine>) {
  await start($)
  const band = await $.ui.mount(BAND)
  await e.clock.advance(3000)
  e.counted()
  await e.clock.advance(20000)
  const cost = e.counted()
  await band.unmount()
  return cost
}

test('with a run and nothing changing, no file is read again and the files are looked at a few times a second', async ($, on) => {
  const cost = await quietStretch($, engine(on, bound()))
  expect(cost.reads).toBe(0)
  expect(cost.looks).toBeLessThanOrEqual(4 * 20)
})

test('with a run billed per token, the spend is added up once a second, for the card, and not again for the boxes', async ($, on) => {
  const quarter = Math.floor(NOW / 900000)
  const spent = JSON.stringify({ v: 1, base: 0, max: 10, q: { [quarter]: 10 } })
  const e = engine(on, { ...bound(), '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN, billing: 'payg' }), '/lcw/spend/s1.json': spent, '/lcw/spend/s2.json': spent })
  await start($)
  const band = await $.ui.mount(BAND)
  await e.clock.advance(3000)
  e.w.infos = 0
  await e.clock.advance(20000)
  expect(e.w.infos).toBeLessThanOrEqual(20)
  await band.unmount()
})

test('with no run and nothing changing, no file is read again and only the session\'s row and the week\'s figure are looked at, once a second', async ($, on) => {
  const cost = await quietStretch($, engine(on, unbound()))
  expect(cost.reads).toBe(0)
  // Two looks a second: the marker for the hook after a tool call must come up within a second of the mark.
  expect(cost.looks).toBeLessThanOrEqual(2 * 20 + 4)
})

// A thousand files and more take a while on a busy machine, so this test is given longer than the default.
test('the mod keeps a thousand files at most: past that, the one read least lately is read again', async ($, on) => {
  const quarter = Math.floor(NOW / 900000)
  const spent = JSON.stringify({ v: 1, base: 0, max: 10, q: { [quarter]: 10 } })
  const files: Record<string, string> = { ...unbound(), '/lcw/sessions/s1.json': JSON.stringify({ billing: 'payg' }) }
  for (let i = 0; i < 1001; i++) files[`/lcw/spend/s${i}.json`] = spent
  const e = engine(on, files)
  // The start reads every file once; the next look, five seconds on with no run, reads them again.
  await start($)
  e.counted()
  await e.clock.advance(5000)
  expect(e.counted().reads).toBeGreaterThan(0)
})

test('with a run, a changed file is read once and shown within a second', async ($, on) => {
  const e = engine(on, bound())
  await start($)
  const band = await $.ui.mount(BAND)
  await e.clock.advance(3000)
  e.files[RUN + '/state.json'] = state({ stage: 'Review' })
  e.counted()
  await e.clock.advance(1000)
  expect(await band.find({ type: 'Text', text: /^Review$/ })).toBeDefined()
  await e.clock.advance(10000)
  expect(e.w.reads).toEqual([RUN + '/state.json'])
  await band.unmount()
})

test('a file that was missing is seen when it appears, and read once', async ($, on) => {
  const e = engine(on, bound())
  await start($)
  const band = await $.ui.mount(BAND)
  await e.clock.advance(3000)
  expect(await band.find({ type: 'Text', text: /paused/ })).toBeUndefined()
  e.counted()
  e.files[RUN + '/gate'] = JSON.stringify({ reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt: '2026-11-27T12:00:00Z', at: NOW })
  await e.clock.advance(1000)
  expect(await band.find({ type: 'Text', text: /paused/ })).toBeDefined()
  await e.clock.advance(10000)
  expect(e.w.reads.filter((p) => p === RUN + '/gate')).toEqual([RUN + '/gate'])
  await band.unmount()
})

test('a session bound at its start shows its card at once', async ($, on) => {
  engine(on, bound())
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^LCW Build · $/ })).toBeDefined()
  await band.unmount()
})

test('with no run, a run bound later is seen within five seconds', async ($, on) => {
  const e = engine(on, { ...unbound(), [RUN + '/state.json']: state() })
  await start($)
  const band = await $.ui.mount(BAND)
  await e.clock.advance(700)
  e.files['/lcw/sessions/s1.json'] = JSON.stringify({ runDir: RUN, billing: 'subscription' })
  await e.clock.advance(3000)
  expect(await band.find({ type: 'Text', text: /^LCW Build · $/ })).toBeUndefined()
  await e.clock.advance(1500)
  expect(await band.find({ type: 'Text', text: /^LCW Build · $/ })).toBeDefined()
  await band.unmount()
})

// A prompt the person sends has the boxes chosen again, from the facts the usage mark is judged by.
test('the facts the mark is judged by are read fresh when a file changed a moment ago, and nothing is read when none did', async ($, on) => {
  const e = engine(on, unbound())
  await start($)
  const band = await $.ui.mount(BAND)
  const atMark = { type: 'Text', text: /This session is at your 75% mark/ } as const
  await e.clock.advance(1000)
  e.files['/lcw/usage.json'] = usage(80)
  await e.clock.advance(300)
  e.counted()
  await $.prompt.submit({ text: 'carry on', wait: false, origin: { kind: 'composer' } })
  await e.clock.advance(100)
  expect(e.w.reads).toEqual(['/lcw/usage.json'])
  expect(await band.find(atMark)).toBeDefined()
  await e.clock.advance(300)
  e.counted()
  await $.prompt.submit({ text: 'and again', wait: false, origin: { kind: 'composer' } })
  await e.clock.advance(100)
  expect(e.w.reads).toEqual([])
  await band.unmount()
})

test('a canonical row whose owner has gone is checked with ps at most once every five seconds', async ($, on) => {
  const e = engine(on, {
    ...bound(),
    '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN, billing: 'subscription', sessionCanonicalId: 'c1', claudePid: 100 }),
    '/lcw/sessions/c1.json': JSON.stringify({ sessionCanonicalId: 'c1', claudePid: 200, markPercent: 90 }),
  })
  await start($)
  const band = await $.ui.mount(BAND)
  await e.clock.advance(60000)
  expect(e.w.runs.filter((a) => a[0] === 'ps').length).toBeLessThanOrEqual(13)
  await band.unmount()
})

for (const [kind, over] of [['finished', { status: 'finished', finishedAt: NOW }], ['waiting on the person', { status: 'with-you', stage: 'Brainstorm' }]] as const) {
  test(`a ${kind} run's card keeps its heartbeat every five seconds`, async ($, on) => {
    const e = engine(on, { ...bound(), [RUN + '/state.json']: state(over) })
    await start($)
    const band = await $.ui.mount(BAND)
    for (let i = 0; i < 30; i++) {
      await e.clock.advance(1000)
      expect(e.clock.now() - Number(e.files[RUN + '/mod-alive'])).toBeLessThanOrEqual(5000)
    }
    await band.unmount()
  })
}
