import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-23T12:00:00Z')
const RUN = '/lcw/repos/r/runs/x'

function engine(on: any, opts: { state?: object; drops?: number; kept?: Record<string, any> } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const state = {
    id: '20261123-x', name: 'x', driver: 's1', status: 'running', stage: 'Ship',
    createdAt: NOW - 60000, stageSince: NOW - 60000,
    tasks: [{ id: 't1', status: 'done' }], requirements: [{ id: 'r1', status: 'todo' }],
    ...opts.state,
  }
  const files: Record<string, string> = {
    '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN }),
    [RUN + '/state.json']: JSON.stringify(state),
    [RUN + '/mod-alive']: String(NOW),
  }
  const box = { draft: '', agents: [] as any[], drops: opts.drops ?? 0, onRead: null as (() => void) | null, onClaim: null as (() => Promise<void>) | null }
  const kept = opts.kept ?? {}
  const prompts: string[] = []
  const commands: string[][] = []
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('process.run', (_: any, e: any) => { commands.push(e.argv); return { value: { exitCode: 1, stdout: '', stderr: '' } } })
  on('prompt.submit', (_: any, e: any) => {
    prompts.push(String(e.text))
    return box.drops-- > 0 ? { drop: 'not now' } : { text: e.text }
  })
  on('prompt.read', () => { box.onRead?.(); return { value: { text: box.draft, cursor: 0 } } })
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer ?? '' }))
  on('session.stop', (_: any, e: any) => ({ isTurnRunning: e.isTurnRunning }))
  on('agent.list', () => ({ value: box.agents }))
  on('config.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('state.get', (_: any, e: any) => ({ value: { value: kept[e.key], version: e.key in kept ? 1 : 0 } }))
  on('state.set', async (_: any, e: any) => {
    if (e.key === 'completion') await box.onClaim?.()
    kept[e.key] = e.value
    return { value: { isSet: true, version: 2 } }
  })
  const set = (more: object) => { Object.assign(state, more); files[RUN + '/state.json'] = JSON.stringify(state) }
  return { clock, files, box, kept, prompts, commands, set }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const end = ($: any, more: object = {}) => $.turn.complete({ answer: '', durationMs: 5, isAborted: false, reason: 'answer', turnId: 't', ...more } as any)

test('an idle driver in Ship is asked to assess outstanding work, never automatically finished', async ($, on) => {
  const w = engine(on)
  await start($)
  await end($)
  await w.clock.advance(29000)
  expect(w.prompts).toHaveLength(0)
  await w.clock.advance(3000)
  expect(w.prompts).toHaveLength(1)
  const prompt = w.prompts[0]
  if (prompt === undefined) throw new Error('completion assessment was not delivered')
  expect(prompt).toMatch(/assess.*remaining agreed work/i)
  expect(prompt).toMatch(/requirements.*post-merge/i)
  expect(prompt).toMatch(/only if.*complete.*finish/i)
  expect(prompt).toMatch(/otherwise.*record/i)
  const saved = w.files[RUN + '/state.json']
  if (saved === undefined) throw new Error('run state is missing')
  expect(JSON.parse(saved).status).toBe('running')
  expect(w.commands.some((a) => a?.includes('finish'))).toBe(false)
  await end($)
  await w.clock.advance(32000)
  expect(w.prompts).toHaveLength(1)
  expect(w.kept.completion?.value?.[RUN]?.sent).toBe(true)
})

test('completion assessment retries dropped delivery at most three times, thirty seconds apart', async ($, on) => {
  const w = engine(on, { drops: 10 })
  await start($)
  await end($)
  await w.clock.advance(32000)
  expect(w.prompts).toHaveLength(1)
  await w.clock.advance(26000)
  expect(w.prompts).toHaveLength(1)
  await w.clock.advance(4000)
  expect(w.prompts).toHaveLength(2)
  await w.clock.advance(32000)
  expect(w.prompts).toHaveLength(3)
  await w.clock.advance(32000)
  expect(w.prompts).toHaveLength(3)
})

test('a completion assessment accepted before reload is not sent again', async ($, on) => {
  const w = engine(on, { kept: { completion: { shape: 'kept-1', value: { [RUN]: { at: NOW, tries: 1, sent: true } } } } })
  await start($)
  await end($)
  await w.clock.advance(32000)
  expect(w.prompts).toHaveLength(0)
})

for (const [label, state] of [
  ['paused by the human', { status: 'paused', pausedReason: 'human' }],
  ['paused at the mark', { status: 'paused', pausedReason: 'mark' }],
  ['with the human', { status: 'with-you' }],
  ['finished', { status: 'finished', finishedAt: NOW }],
  ['stopped', { status: 'stopped' }],
  ['still in Review', { stage: 'Review' }],
  ['a sweep', { shape: 'sweep' }],
  ['driven elsewhere', { driver: 's2' }],
  ['missing a driver', { driver: null }],
  ['waiting on an ask', { asks: [{ n: 1, text: 'permission?' }] }],
  ['running a task', { tasks: [{ id: 't1', status: 'running' }] }],
  ['waiting on a task', { tasks: [{ id: 't1', status: 'todo' }] }],
] as const) {
  test(`no completion assessment while the run is ${label}`, async ($, on) => {
    const w = engine(on, { state })
    await start($)
    await end($)
    await w.clock.advance(32000)
    expect(w.prompts).toHaveLength(0)
    w.set({ status: 'running', pausedReason: null, stage: 'Ship', shape: 'build', driver: 's1', asks: [], tasks: [{ id: 't1', status: 'done' }] })
    await w.clock.advance(4000)
    expect(w.prompts).toHaveLength(1)
  })
}

test('a draft, an active agent and a new running turn each delay completion assessment', async ($, on) => {
  const w = engine(on)
  await start($)
  await end($)
  w.box.draft = 'wait'
  await w.clock.advance(32000)
  expect(w.prompts).toHaveLength(0)
  w.box.draft = ''
  w.box.agents = [{ id: 'a1', status: 'waiting', startTime: NOW }]
  await w.clock.advance(4000)
  expect(w.prompts).toHaveLength(0)
  w.box.agents = []
  await $.turn.start({ text: '', turnId: 't2' } as any)
  await w.clock.advance(4000)
  expect(w.prompts).toHaveLength(0)
  await end($)
  await w.clock.advance(32000)
  expect(w.prompts).toHaveLength(1)
})

test('a gate and an undelivered checkpoint prevent a completion assessment', async ($, on) => {
  const w = engine(on)
  await start($)
  await end($)
  w.files[RUN + '/gate'] = JSON.stringify({ reason: 'mark' })
  await w.clock.advance(32000)
  expect(w.prompts).toHaveLength(0)
  delete w.files[RUN + '/gate']
  w.files[RUN + '/checkpoint'] = 'continue verification'
  await w.clock.advance(4000)
  expect(w.prompts).toHaveLength(0)
  delete w.files[RUN + '/checkpoint']
  await w.clock.advance(4000)
  expect(w.prompts).toHaveLength(1)
})

for (const source of ['native mark', 'unavailable external quota']) {
  test(`${source} without a gate still prevents completion assessment`, async ($, on) => {
    const w = engine(on)
    if (source === 'native mark') w.files['/lcw/usage.json'] = JSON.stringify({ sevenDay: { percentUsed: 100, resetsAt: '2026-11-30T12:00:00Z' } })
    else w.files['/lcw/sessions/s1.json'] = JSON.stringify({ runDir: RUN, quotaSelection: { sourceId: 'external-quota', endpoint: 'https://quota.example' } })
    await start($)
    await end($)
    await w.clock.advance(32000)
    expect(w.prompts).toHaveLength(0)
    delete w.files['/lcw/usage.json']
    w.files['/lcw/sessions/s1.json'] = JSON.stringify({ runDir: RUN })
    await w.clock.advance(4000)
    expect(w.prompts).toHaveLength(1)
  })
}

test('a pause recorded while the draft is checked prevents completion assessment', async ($, on) => {
  const w = engine(on)
  await start($)
  await end($)
  w.box.onRead = () => { w.box.onRead = null; w.set({ status: 'paused', pausedReason: 'human' }) }
  await w.clock.advance(32000)
  expect(w.prompts).toHaveLength(0)
  w.set({ status: 'running', pausedReason: null })
  await w.clock.advance(4000)
  expect(w.prompts).toHaveLength(1)
})

test('stopping the session suppresses completion assessment until a new successful turn', async ($, on) => {
  const w = engine(on)
  await start($)
  await end($)
  await $.session.stop({ isTurnRunning: false })
  await w.clock.advance(32000)
  expect(w.prompts).toHaveLength(0)
  await end($)
  await w.clock.advance(32000)
  expect(w.prompts).toHaveLength(1)
})

for (const change of ['pause', 'driver', 'binding', 'draft', 'gate', 'usage', 'agents', 'checkpoint']) {
  test(`completion assessment rechecks ${change} after a delayed durable claim and restores an unused try`, async ($, on) => {
    const w = engine(on)
    let claimed!: () => void
    let release!: () => void
    const claimStarted = new Promise<void>((resolve) => { claimed = resolve })
    const claimReleased = new Promise<void>((resolve) => { release = resolve })
    w.box.onClaim = async () => { w.box.onClaim = null; claimed(); await claimReleased }
    await start($)
    await end($)
    const advancing = w.clock.advance(32000)
    try {
      const hasClaim = await Promise.race([claimStarted.then(() => true), advancing.then(() => false)])
      expect(hasClaim).toBe(true)
      if (change === 'pause') w.set({ status: 'paused', pausedReason: 'human' })
      if (change === 'driver') w.set({ driver: 's2' })
      if (change === 'binding') w.files['/lcw/sessions/s1.json'] = JSON.stringify({ runDir: '/other-run' })
      if (change === 'draft') w.box.draft = 'wait'
      if (change === 'gate') w.files[RUN + '/gate'] = JSON.stringify({ reason: 'mark' })
      if (change === 'usage') w.files['/lcw/usage.json'] = JSON.stringify({ sevenDay: { percentUsed: 100, resetsAt: '2026-11-30T12:00:00Z' } })
      if (change === 'agents') w.box.agents = [{ id: 'a1', status: 'waiting', startTime: NOW }]
      if (change === 'checkpoint') w.files[RUN + '/checkpoint'] = 'verify setup'
    } finally {
      release()
      await advancing
    }
    expect(w.prompts).toHaveLength(0)
    expect(w.kept.completion?.value?.[RUN]).toBeUndefined()
    w.set({ status: 'running', pausedReason: null, driver: 's1' })
    w.files['/lcw/sessions/s1.json'] = JSON.stringify({ runDir: RUN })
    w.box.draft = ''
    w.box.agents = []
    delete w.files[RUN + '/gate']
    delete w.files['/lcw/usage.json']
    delete w.files[RUN + '/checkpoint']
    await w.clock.advance(4000)
    expect(w.prompts).toHaveLength(1)
    expect(w.kept.completion?.value?.[RUN]?.tries).toBe(1)
  })
}

for (const ending of [{}, { reason: 'error' }, { isAborted: true }, { agentId: 'a1' }]) {
  test(`completion assessment needs an observed successful main turn: ${JSON.stringify(ending)}`, async ($, on) => {
    const w = engine(on)
    await start($)
    if (Object.keys(ending).length) await end($, ending)
    await w.clock.advance(32000)
    expect(w.prompts).toHaveLength(0)
    await end($)
    await w.clock.advance(32000)
    expect(w.prompts).toHaveLength(1)
  })
}
