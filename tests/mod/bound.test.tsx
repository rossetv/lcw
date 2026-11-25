import { expect } from 'claude-code/testing'
import { test } from './kit'

const BAND = {
  plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const
const ROW = {
  plugin: 'lcw', surface: 'terminal', component: 'AgentRow', requestId: 'a1',
  props: {
    id: 'a1', description: 'Add date filters', type: 'general-purpose', status: 'running', kind: 'local_agent',
    taskStatus: 'running', label: 'Add date filters', startTime: 0, cwd: '/', tokenCount: 10, tokenSamples: [10] as number[],
    hasRow: true, rowIds: ['a1'] as string[], isHidden: false,
  },
} as const

function engine(on: any, files: Record<string, string>, agents: unknown[] = [], now = 1000) {
  const writes: Record<string, string> = {}
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { writes[e.path] = e.text; return { value: undefined } })
  on('agent.list', () => ({ value: agents }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer ?? '' }))
  on('config.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: now }))
  on('clock.every', () => ({ value: {} }))
  on('clock.after', () => ({ value: {} }))
  let hidden: unknown = 'not asked'
  on('ui.render', ($: any, e: any) => {
    if (e.component === 'AgentRow') hidden = e.props.isHidden
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  let viewed: unknown = 'not asked'
  on('ui.view', (_: any, e: any) => { viewed = e.agentId ?? 'main'; return { value: {} } })
  return { hidden: () => hidden, viewed: () => viewed, writes }
}

test('a bound session draws the card in its frame', async ($, on) => {
  engine(on, {
    '/lcw/sessions/s1.json': JSON.stringify({ runDir: '/lcw/repos/r/runs/x' }),
    '/lcw/repos/r/runs/x/state.json': JSON.stringify({ id: '20261118-x', name: 'x', status: 'running', stage: 'Build', stageSince: 1000 }),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /LCW/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /in Build/ })).toBeDefined()
  await band.unmount()
})

test('the mod writes the run\'s totals, counting on from the file, and adds what each finished turn used', async ($, on) => {
  const seen = engine(on, {
    '/lcw/sessions/s1.json': JSON.stringify({ runDir: '/lcw/repos/r/runs/x' }),
    '/lcw/repos/r/runs/x/state.json': JSON.stringify({ id: '20261118-x', name: 'x', status: 'running', stage: 'Build', stageSince: 1000, createdAt: 1000 }),
    '/lcw/repos/r/runs/x/totals.json': JSON.stringify({ agents: 1, tokens: 500, seen: { old: 1 }, used: { main: 500, agents: 0 } }),
  }, [{ ...ROW.props, startTime: 2000, tokenCount: 40 }], 1e12)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const file = () => JSON.parse(seen.writes['/lcw/repos/r/runs/x/totals.json'] ?? '{}')
  expect(file().agents).toBe(2)
  expect(file().tokens).toBe(500)
  const usage = { input_tokens: 1, output_tokens: 9, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, model: 'm' }
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, reason: 'answer', turnId: 't1', agentId: 'a1', usage })
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, reason: 'answer', turnId: 't2', usage })
  expect(file().used).toEqual({ main: 600, agents: 100 })
  expect(file().tokens).toBe(700)
})

test('no row carries a hotkey number: a click opens it, and the caret opens the workers', async ($, on) => {
  engine(on, {
    '/lcw/sessions/s1.json': JSON.stringify({ runDir: '/lcw/repos/r/runs/x' }),
    '/lcw/repos/r/runs/x/state.json': JSON.stringify({ id: '20261118-x', name: 'x', status: 'running', stage: 'Build', stageSince: 1000 }),
  }, [{ ...ROW.props, id: 'o1', description: 'Own the work' }, { ...ROW.props, parentId: 'o1' }])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  const caret: any = await band.find({ type: 'Button', key: 'toggle:o1' })
  expect(caret.props.hotkey).toBeUndefined()
  const orch: any = await band.find({ type: 'Button', key: 'view:o1' })
  expect(orch.props.hotkey).toBeUndefined()
  await band.press({ key: 'toggle:o1' })
  await band.unmount()
  const again = await $.ui.mount(BAND)
  const worker: any = await again.find({ type: 'Button', key: 'view:a1' })
  expect(worker.props.hotkey).toBeUndefined()
  await again.unmount()
})

test('agent rows are buttons that open the agent, and Claude Code\'s own rows are hidden', async ($, on) => {
  const seen = engine(on, {
    '/lcw/sessions/s1.json': JSON.stringify({ runDir: '/lcw/repos/r/runs/x' }),
    '/lcw/repos/r/runs/x/state.json': JSON.stringify({ id: '20261118-x', name: 'x', status: 'running', stage: 'Build', stageSince: 1000 }),
  }, [ROW.props])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  expect(await band.drawn()).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'view:a1' })).toBeDefined()
  await band.press({ key: 'view:a1' })
  expect(seen.viewed()).toBe('a1')
  await band.unmount()
  const row = await $.ui.mount(ROW)
  expect(seen.hidden()).toBe(true)
  await row.unmount()
  const inAgent = await $.ui.mount({ ...BAND, props: { ...BAND.props, view: { agentId: 'a1' } } })
  await inAgent.press({ key: 'main' })
  expect(seen.viewed()).toBe('main')
  await inAgent.unmount()
})
