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

function engine(on: any, files: Record<string, string>) {
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: 1000 }))
  on('clock.every', () => ({ value: {} }))
  on('clock.after', () => ({ value: {} }))
  let hidden: unknown = 'not asked'
  on('ui.render', ($: any, e: any) => {
    if (e.component === 'AgentRow') hidden = e.props.isHidden
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { hidden: () => hidden }
}

test('an unbound session draws nothing and hides no agent row', async ($, on) => {
  const hidden = engine(on, {})
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /LCW/ })).toBeUndefined()
  await band.unmount()
  const row = await $.ui.mount(ROW)
  expect(hidden.hidden()).not.toBe(true)
  await row.unmount()
})
