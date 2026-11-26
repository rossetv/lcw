import { expect, mock } from 'claude-code/testing'
import { test } from './kit'

// Claude Code's own agent rows take rows from the band while they are drawn, so whether the mod hides them must not
// turn on what the rows it was given let it draw: else hiding them gives it the rows to show them again, and back.

const NOW = Date.parse('2026-11-25T12:00:00Z')
const RUN = '/lcw/repos/r/runs/tidy'
const QUESTION = {
  id: 'Q1', text: 'A wave must take in the waves before it before its review starts. Make it a reminder, or keep the refusal?',
  why: 'The refusal keeps each review to its own wave.', status: 'open', recommend: 'b', at: NOW - 1000,
  options: [{ key: 'a', label: 'Make it a reminder', meaning: 'a small fix in a later wave' }, { key: 'b', label: 'Keep the refusal', meaning: 'closed as decided' }],
}
// A summary of two rows and the waves above a hunt: at the height where the full question box first fits, the card it
// leaves holds no agent row.
const SWEEP = JSON.stringify({
  id: 'tidy', name: 'tidy', shape: 'sweep', status: 'running', stage: 'Hunt', stageSince: NOW - 600000, createdAt: NOW - 3600000, questions: [QUESTION],
  health: 'Hunting again over what the fixes changed. Live next: the card and mod fixes, once their final test run passes, and then the last round of hunting over the merged waves before the pull request.',
  sweep: {
    prs: 'stacked', charter: 10, open: 0, approvedAt: NOW - 3600000, round: 2, fixed: 0, parked: 0, dropped: 0,
    hunt: { areas: 4, hunted: 0, running: 4, findings: 4, fix: 0, park: 0, drop: 0 },
    waves: [
      { n: 1, status: 'shipped', merged: true, stage: 'Ship', fixes: 12, tasks: [], requirements: [] },
      { n: 2, status: 'running', stage: 'Ship', stageSince: NOW - 600000, fixes: 9, tasks: [], requirements: [], branch: 'lcw/tidy-wave-2' },
    ],
  },
})
const agent = (id: string, description: string) => ({
  id, description, type: 'lcw:probe', status: 'running', kind: 'local_agent', taskStatus: 'running', model: 'sonnet', startTime: NOW - 60000,
  tokenCount: 10, label: description, cwd: '/', tokenSamples: [10], hasRow: true, rowIds: [id], isHidden: false,
})
const AGENTS = ['Hunt the waves and merge', 'Hunt the run commands', 'Hunt the mod and card', 'Hunt the instruction text', 'Run the final checks']
  .map((d, i) => agent('p' + i, d))
const band = (maxRows: number) => ({
  plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows, bodyColumns: 120, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} },
} as const)

test("once Claude Code's agent rows are hidden under a question box and the card, a taller band keeps them hidden", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = { '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN }), [RUN + '/state.json']: SWEEP, [RUN + '/mod-alive']: String(NOW - 1000) }
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('session.info', () => ({ value: { transcriptPath: '/t/s1.jsonl', platform: 'linux' } }))
  on('fs.read', (_: any, e: any) => { if (e.path in files) return { value: files[e.path] }; throw new Error('ENOENT') })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('agent.list', () => ({ value: AGENTS }))
  on('config.list', () => ({ value: [] }))
  let hidden: unknown = 'not asked'
  on('ui.render', ($: any, e: any) => {
    if (e.component === 'AgentRow') hidden = e.props.isHidden
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const first = await $.ui.mount(band(40))
  await clock.advance(2100)
  await first.unmount()
  const byHeight: [number, unknown][] = []
  for (let maxRows = 10; maxRows <= 40; maxRows++) {
    const b = await $.ui.mount(band(maxRows))
    await b.unmount()
    const row = await $.ui.mount({ plugin: 'lcw', surface: 'terminal', component: 'AgentRow', requestId: 'p0', props: AGENTS[0] } as any)
    await row.unmount()
    byHeight.push([maxRows, hidden])
  }
  const from = byHeight.findIndex(([, h]) => h === true)
  expect(from).toBeGreaterThan(-1)
  expect(byHeight.slice(from).filter(([, h]) => h !== true)).toEqual([])
})
