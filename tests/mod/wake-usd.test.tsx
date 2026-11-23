import { expect, mock, test } from 'claude-code/testing'
import { gateFor, retryGate } from '../../hooks/lcw-mod.mjs'
import { moneyFrom } from '../../lib/spend.mjs'

// The mod on pay-per-token billing: the dollar gate's morning try, the spend it records, and a subscriber left as today.

const NOW = Date.parse('2026-11-18T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const RUN = '/lcw/repos/r/runs/x'
const SPEND = '/lcw/spend'
const session = (billing?: string) => ({ '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN, ...(billing ? { billing } : {}) }) })
const state = (status: string) =>
  JSON.stringify({ id: '20261118-x', name: 'x', status, pausedReason: status === 'paused' ? 'mark' : null, stage: 'Build', stageSince: NOW })
// What one session spent, all of it a day ago.
const spent = (usd: number) => JSON.stringify({ v: 1, base: 0, max: usd, q: { [Math.floor((NOW - DAY) / 900000)]: usd } })
const usdGate = (retryAt: number) =>
  JSON.stringify({ reason: 'mark', unit: 'usd', markUsd: 3000, usedUsd: 3020, retryAt, retried: false, at: NOW - DAY })
const next0800 = (after: number) => {
  const d = new Date(after)
  d.setHours(8, 0, 0, 0)
  if (d.getTime() <= after) d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return d.getTime()
}

function engine(on: any, files: Record<string, string>, transcriptPath = '', mtimes: Record<string, number> = {}) {
  const clock = mock.clock(on, { now: NOW })
  const prompts: string[] = []
  const listed: string[] = []
  // While held, a listing of the spend folder waits: a slow refresh, for the card drawn meanwhile.
  let held: ((v: unknown) => void)[] | null = null
  on('session.info', () => ({ value: { transcriptPath } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.list', async (_: any, e: any) => {
    listed.push(e.path)
    if (held) await new Promise((resolve) => held!.push(resolve))
    const names = Object.keys(files).filter((p) => p.startsWith(e.path + '/')).map((p) => p.slice(e.path.length + 1))
    return { value: names.map((name) => ({ name, kind: 'file', size: 1, mtimeMs: mtimes[e.path + '/' + name] ?? 0, isLink: false })) }
  })
  on('process.run', (_: any, e: any) => {
    if (e.argv[1]?.endsWith('/scripts/gate-reconcile.mjs')) {
      const p = JSON.parse(e.argv[2])
      const file = RUN + '/gate'
      const g = JSON.parse(files[file] ?? 'null')
      if (JSON.stringify(g) !== JSON.stringify(p.expectedGate)) return { value: { exitCode: 0, stdout: '{"ok":false}', stderr: '' } }
      if (p.action === 'ack') delete files[file]
      if (p.action === 'retry') files[file] = JSON.stringify(retryGate(g, { atMark: true } as any, g.retryAt))
      if (p.action === 'sync') {
        const session = JSON.parse(files['/lcw/sessions/s1.json'] ?? 'null')
        const state = JSON.parse(files[RUN + '/state.json'] ?? 'null')
        const records = Object.entries(files).filter(([path]) => path.startsWith(SPEND + '/')).map(([, text]) => JSON.parse(text))
        const money = session?.billing === 'payg' ? moneyFrom({ records, session, state, cap: null, now: NOW }) : null
        const next = gateFor(state, JSON.parse(files['/lcw/usage.json'] ?? 'null')?.sevenDay, NOW, money)
        if (next) files[file] = JSON.stringify(next)
      }
      return { value: { exitCode: 0, stdout: '{"ok":true}', stderr: '' } }
    }
    if (e.argv[0] === 'rm') delete files[e.argv[e.argv.length - 1]]
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('prompt.submit', (_: any, e: any) => { prompts.push(e.text); return { text: e.text } })
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  return {
    clock, prompts, files, listed,
    hold: () => { held = [] },
    release: () => { const waiting = held ?? []; held = null; waiting.forEach((go) => go(undefined)) },
  }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const json = (text?: string) => JSON.parse(text ?? 'null')

test('at 08:00 a run paused at its dollar mark is woken once the 7-day spend is back under the mark', async ($, on) => {
  const w = engine(on, {
    ...session('payg'), [RUN + '/state.json']: state('paused'), [RUN + '/gate']: usdGate(NOW + 5000),
    [SPEND + '/s1.json']: spent(1200), [SPEND + '/s2.json']: spent(800),
  })
  await start($)
  await w.clock.advance(2000)
  expect(w.prompts.length).toBe(0)
  await w.clock.advance(5000)
  expect(RUN + '/gate' in w.files).toBe(false)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/back under your \$3,000 mark.*resume.*status/)
  await w.clock.advance(10000)
  expect(w.prompts.length).toBe(1)
})

test('at 08:00 a run still at its dollar mark stays paused and tries again the following 08:00', async ($, on) => {
  const w = engine(on, {
    ...session('payg'), [RUN + '/state.json']: state('paused'), [RUN + '/gate']: usdGate(NOW + 5000),
    [SPEND + '/s1.json']: spent(2000), [SPEND + '/s2.json']: spent(1100),
  })
  await start($)
  await w.clock.advance(7000)
  const gate = json(w.files[RUN + '/gate'])
  expect(gate.retried).toBe(true)
  expect(gate.retryAt).toBe(next0800(NOW + 5000))
  expect(w.prompts.length).toBe(0)
  await w.clock.advance(10000)
  expect(w.prompts.length).toBe(0)
})

test('the card of a run paused at a dollar mark says the mark and the morning try', async ($, on) => {
  engine(on, { ...session('payg'), [RUN + '/state.json']: state('paused'), [RUN + '/gate']: usdGate(next0800(NOW)), [SPEND + '/s1.json']: spent(3020) })
  await start($)
  const band = await $.ui.mount({
    plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
  } as any)
  expect(await band.find({ type: 'Text', text: /paused at your \$3,000 mark/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /resumes at 08:00/ })).toBeDefined()
  await band.unmount()
})

test('a card drawn while a refresh is still reading the spend stays in dollars', async ($, on) => {
  const w = engine(on, { ...session('payg'), [RUN + '/state.json']: state('paused'), [RUN + '/gate']: usdGate(next0800(NOW)), [SPEND + '/s1.json']: spent(3020) })
  await start($)
  w.hold()
  await w.clock.advance(1000)
  const band = await $.ui.mount({
    plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
  } as any)
  expect(await band.find({ type: 'Text', text: /paused at your \$3,000 mark/ })).toBeDefined()
  await band.unmount()
  w.release()
})

test('a resumed session keeps its spend under its transcript\'s name, as the status line does, so no dollar is kept twice', async ($, on) => {
  const w = engine(on, { ...session('payg'), [RUN + '/state.json']: state('running'), [SPEND + '/first.json']: spent(40) }, '/p/first.jsonl')
  await start($)
  await $.session.measure({ context: { window: 200000 }, changed: ['cost'], rateLimits: [], cost: { usd: 45 } } as any)
  expect(json(w.files[SPEND + '/first.json']).max).toBe(45)
  expect(SPEND + '/s1.json' in w.files).toBe(false)
})

test('a reply without a weekly figure makes an unclear session pay-per-token, records its spend once, and gates the run at the mark', async ($, on) => {
  const w = engine(on, { ...session(), [RUN + '/state.json']: state('running'), [SPEND + '/s2.json']: spent(3000) })
  await start($)
  const measure = (usd: number) => $.session.measure({ context: { window: 200000 }, changed: ['cost'], rateLimits: [], cost: { usd } } as any)
  await measure(0)
  expect(json(w.files['/lcw/sessions/s1.json']).billing).toBeUndefined()
  await measure(30)
  expect(json(w.files['/lcw/sessions/s1.json'])).toEqual({ runDir: RUN, billing: 'payg' })
  expect(json(w.files[SPEND + '/s1.json']).max).toBe(30)
  await measure(25)
  expect(json(w.files[SPEND + '/s1.json']).max).toBe(30)
  const gate = json(w.files[RUN + '/gate'])
  expect(gate).toMatchObject({ unit: 'usd', markUsd: 3000, retried: false })
  expect(gate.retryAt).toBe(next0800(NOW))
})

test('a subscriber is woken as today, its spend is dropped, and the spend folder is never read', async ($, on) => {
  const w = engine(on, {
    ...session('payg'), [RUN + '/state.json']: state('paused'), [SPEND + '/s1.json']: spent(40),
  })
  await start($)
  await $.session.measure({
    context: { window: 200000 }, changed: ['rateLimits'], cost: { usd: 41 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 80, resetsAt: new Date(NOW + 3000).toISOString() }],
  } as any)
  expect(json(w.files['/lcw/sessions/s1.json']).billing).toBe('subscription')
  expect(SPEND + '/s1.json' in w.files).toBe(false)
  expect(json(w.files[RUN + '/gate'])).toMatchObject({ markPercent: 75, usedPercent: 80 })
  const listedBefore = w.listed.length
  await w.clock.advance(5000)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/weekly usage limit has reset/)
  expect(w.prompts[0]).not.toMatch(/\$/)
  expect(w.listed.length).toBe(listedBefore)
})

test('a spend file nobody has written for 8 days is not read', async ($, on) => {
  const w = engine(on, {
    ...session('payg'), [RUN + '/state.json']: state('paused'), [RUN + '/gate']: usdGate(NOW + 5000),
    [SPEND + '/s1.json']: spent(1200), [SPEND + '/s2.json']: spent(800), [SPEND + '/s3.json']: spent(5000),
  }, '', { [SPEND + '/s3.json']: NOW - 9 * DAY })
  await start($)
  await w.clock.advance(7000)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/back under your \$3,000 mark/)
})

test('a resumed session settles pay-per-token billing on its canonical row too, so the dollar gate is set', async ($, on) => {
  const files: Record<string, string> = {
    '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN, sessionCanonicalId: 'anchor', markUsd: 0.5 }),
    '/lcw/sessions/anchor.json': JSON.stringify({ sessionCanonicalId: 'anchor', billing: 'unclear', markUsd: 0.5 }),
    [RUN + '/state.json']: state('running'),
  }
  engine(on, files, '', { '/lcw/spend/s1.json': NOW })
  await start($)
  await $.session.measure({ context: { window: 200000 }, changed: ['cost'], cost: { usd: 0.5 } } as any)
  await $.session.measure({ context: { window: 200000 }, changed: ['cost'], cost: { usd: 1.0 } } as any)
  expect(json(files['/lcw/sessions/anchor.json']).billing).toBe('payg')
  expect(json(files[RUN + '/gate']).unit).toBe('usd')
})

test('a canonical row owned by another running Claude Code is not rewritten by this session\'s billing', async ($, on) => {
  const files: Record<string, string> = {
    '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN, sessionCanonicalId: 'anchor', claudePid: 999, markUsd: 0.5 }),
    '/lcw/sessions/anchor.json': JSON.stringify({ sessionCanonicalId: 'anchor', billing: 'subscription', claudePid: 4242 }),
    [RUN + '/state.json']: state('running'),
  }
  engine(on, files, '', { '/lcw/spend/s1.json': NOW })
  await start($)
  await $.session.measure({ context: { window: 200000 }, changed: ['cost'], cost: { usd: 0.5 } } as any)
  await $.session.measure({ context: { window: 200000 }, changed: ['cost'], cost: { usd: 1.0 } } as any)
  expect(json(files['/lcw/sessions/anchor.json']).billing).toBe('subscription')
})
