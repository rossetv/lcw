import { expect, mock } from 'claude-code/testing'
import { test } from './kit'

// A sweep's card lists each agent under the lane of the wave it works for. The mod learns the wave where the agent is
// launched, from its brief, since the list of agents gives only a description.

const NOW = Date.parse('2026-11-25T12:00:00Z')
const RUN = '/lcw/repos/r/runs/tidy'
const BAND = {
  plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 30, bodyColumns: 110, scroll: { offset: 0, bodyRows: 29 }, view: {} },
} as const
const wave = (n: number, stage: string) => ({ n, status: 'running', stage, stageSince: NOW - 600000, round: stage === 'Review' ? 1 : 0, fixes: 2, tasks: [], requirements: [], branch: `lcw/tidy-wave-${n}` })
const SWEEP = JSON.stringify({
  id: 'tidy', name: 'tidy', shape: 'sweep', status: 'running', stage: 'Build', stageSince: NOW - 600000, createdAt: NOW - 3600000,
  sweep: { prs: 'stacked', charter: 10, open: 0, approvedAt: NOW - 3600000, round: 1, hunt: { areas: 0, hunted: 0, running: 0, findings: 0, fix: 4, park: 0, drop: 0 }, fixed: 0, parked: 0, dropped: 0, waves: [wave(1, 'Review'), wave(2, 'Build')] },
})
const agent = (id: string, description: string, over: object = {}) => ({
  id, description, type: 'lcw:worker', status: 'running', kind: 'local_agent', taskStatus: 'running', model: 'sonnet', startTime: NOW - 60000, tokenCount: 10, ...over,
})

function engine(on: any, agents: unknown[], logs: Record<string, string> = {}) {
  const clock = mock.clock(on, { now: NOW })
  const reads: string[] = []
  const files: Record<string, string> = {
    ...logs, '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN }), [RUN + '/state.json']: SWEEP, [RUN + '/mod-alive']: String(NOW - 1000) }
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('session.info', () => ({ value: { transcriptPath: '/t/s1.jsonl', platform: 'linux' } }))
  on('fs.read', (_: any, e: any) => {
    reads.push(e.path)
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('agent.list', () => ({ value: agents }))
  on('config.list', () => ({ value: [] }))
  on('classic.PostToolUse', () => ({}))
  return { advance: (ms: number) => clock.advance(ms), reads }
}

// An agent's transcript as it starts: the message that launched it, then its work.
const log = (id: string, brief: string) => ({ [`/t/s1/subagents/agent-${id}.jsonl`]: JSON.stringify({ parentUuid: null, agentId: id, type: 'user', message: { role: 'user', content: brief } }) + '\n{"type":"assistant"}\n' })

// The launch of an agent as the mod is told of it: what the Agent tool was given, and the id it answered.
const launch = ($: any, id: string, description: string, prompt: string, from?: string) => $.classic.PostToolUse({
  tool_name: 'Agent', tool_input: { description, prompt, subagent_type: 'lcw:worker' }, tool_response: { status: 'async_launched', agentId: id },
  tool_use_id: 'toolu_' + id, session_id: 's1', ...(from ? { agent_id: from } : {}),
} as any)
const viewed = async (band: any) => (await band.findAll({ type: 'Button' })).map((b: any) => b.key).filter((k: string | undefined) => k?.startsWith('view:'))

test('an agent\'s wave is kept from its launch, and the card lists each agent under its own wave, the rest beneath', async ($, on) => {
  const w = engine(on, [agent('a1', 'Build the importer'), agent('a2', 'Review the export fix'), agent('h1', 'Hunt the settings pages')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:a1', 'view:a2', 'view:h1'])
  await launch($, 'a1', 'Build the importer', 'Work only in /repo/.claude/worktrees/tidy-wave-2, and mark it: lcw task T1 done')
  await launch($, 'a2', 'Review the export fix', 'Check the fix, then record it: lcw req F1 pass --wave 1')
  await launch($, 'h1', 'Hunt the settings pages', 'Read the code in /repo/.claude/worktrees/tidy-latest and report each problem')
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:a2', 'view:a1', 'view:h1'])
  await band.unmount()
})

test('an agent that one of a wave\'s agents starts is listed under that wave too', async ($, on) => {
  const w = engine(on, [agent('h1', 'Hunt the settings pages'), agent('p1', 'Find where the export is built'), agent('a1', 'Build the importer')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await launch($, 'a1', 'Build the importer', 'Work only in /repo/.claude/worktrees/tidy-wave-2')
  await launch($, 'p1', 'Find where the export is built', 'Which file builds the export? Read and report.', 'a1')
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:p1', 'view:a1', 'view:h1'])
  await band.unmount()
})

test('an agent whose launch was not seen is placed by its description, where that names a wave', async ($, on) => {
  const w = engine(on, [agent('a1', 'Build the importer'), agent('d1', 'Run wave 1\'s final checks')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:d1', 'view:a1'])
  await band.unmount()
})

test('an agent launched before the mod was looking is placed from its transcript, whose first line is its brief', async ($, on) => {
  const w = engine(on, [agent('h1', 'Hunt the settings pages'), agent('a1', 'Build the importer'), agent('a2', 'Fix the toast notes')], {
    ...log('a1', 'Task T4 of the sweep. Worktree: /repo/.claude/worktrees/tidy-wave-2 (branch lcw/tidy-wave-2).'),
    ...log('a2', 'Read the rules first: /lcw/repos/r/runs/tidy/waves/1/review-brief.md'),
    ...log('h1', 'Hunt the settings pages in /repo/.claude/worktrees/tidy-latest'),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:a2', 'view:a1', 'view:h1'])
  const asked = () => w.reads.filter((p) => p.startsWith('/t/s1/subagents/')).length
  expect(asked()).toBe(3)
  await w.advance(20000)
  expect(asked()).toBe(3)
  await band.unmount()
})

test('a transcript that is not there is asked for three times and no more', async ($, on) => {
  const w = engine(on, [agent('a1', 'Build the importer')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await w.advance(30000)
  expect(w.reads.filter((p) => p === '/t/s1/subagents/agent-a1.jsonl').length).toBe(3)
  expect(await viewed(band)).toEqual(['view:a1'])
  await band.unmount()
})
