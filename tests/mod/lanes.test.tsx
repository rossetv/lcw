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

function engine(on: any, agents: unknown[], logs: Record<string, string> = {}, spawn?: (e: any) => unknown) {
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
  on('agent.spawn', (_: any, e: any) => spawn ? spawn(e) : ({ model: 'sonnet', agentId: e.tool_use_id.replace('toolu_', '') }))
  return { advance: (ms: number) => clock.advance(ms), reads, files }
}

// An agent's transcript as it starts: the message that launched it, then its work.
const log = (id: string, brief: string) => ({ [`/t/s1/subagents/agent-${id}.jsonl`]: JSON.stringify({ parentUuid: null, agentId: id, type: 'user', message: { role: 'user', content: brief } }) + '\n{"type":"assistant"}\n' })

// The launch of an agent as the mod is told of it: what the Agent tool was given, and the id the launch answered.
const launch = ($: any, id: string, description: string, prompt: string, from?: string, resume?: object) => $.agent.spawn({
  tool_use_id: 'toolu_' + id, prompt, description, subagentType: 'lcw:worker', background: true, fork: false,
  ...(from ? { parentAgentId: from } : {}), ...(resume ? { resume } : {}),
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

test('a resumed agent stays under the wave it was launched for', async ($, on) => {
  const w = engine(on, [agent('r1', 'Build the importer'), agent('r2', 'Review the export fix')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await launch($, 'r2', 'Review the export fix', 'Check the fix, then record it: lcw req F1 pass --wave 1')
  await launch($, 'r1', 'Build the importer', 'Work only in /repo/.claude/worktrees/tidy-wave-2')
  await launch($, 'r1', 'Build the importer', 'Check the fix, then record it: lcw req F1 pass --wave 1', undefined, { agentId: 'r1' })
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:r2', 'view:r1'])
  await band.unmount()
})

test('a launch whose brief names no wave keeps none, so the transcript is still asked', async ($, on) => {
  const agents: unknown[] = []
  const w = engine(on, agents, log('n1', 'Work only in /repo/.claude/worktrees/tidy-wave-2'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await launch($, 'n2', 'Review the export fix', 'Check the fix, then record it: lcw req F1 pass --wave 1')
  await launch($, 'n3', 'Build the importer', 'Work only in /repo/.claude/worktrees/tidy-wave-2')
  await launch($, 'n1', 'Fix the toast notes', 'Fix the notes that toasts show.')
  agents.push(agent('n1', 'Fix the toast notes'), agent('n2', 'Review the export fix'), agent('n3', 'Build the importer'))
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:n2', 'view:n1', 'view:n3'])
  await band.unmount()
})

test('a launch in a run that is not a sweep notes no wave', async ($, on) => {
  const agents: unknown[] = []
  const w = engine(on, agents)
  w.files[RUN + '/state.json'] = JSON.stringify({ ...JSON.parse(SWEEP), shape: 'build', sweep: undefined })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await w.advance(2100)
  await launch($, 'g2', 'Review the export fix', 'Check the fix, then record it: lcw req F1 pass --wave 1')
  agents.push(agent('g1', 'Fix the toast notes'), agent('g2', 'Review the export fix'))
  w.files[RUN + '/state.json'] = SWEEP
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:g1', 'view:g2'])
  await band.unmount()
})

test('a resume of an agent whose launch was not seen notes no wave from its new brief', async ($, on) => {
  const agents: unknown[] = []
  const w = engine(on, agents)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await w.advance(2100)
  await launch($, 'u2', 'Review the export fix', 'Check the fix, then record it: lcw req F1 pass --wave 1', undefined, { agentId: 'u2' })
  agents.push(agent('u1', 'Fix the toast notes'), agent('u2', 'Review the export fix'))
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:u1', 'view:u2'])
  await band.unmount()
})

test('a launch is passed on whole: its refusal comes back as it is and its error goes on', async ($, on) => {
  const answer: { value: unknown } = { value: { deny: 'no more agents' } }
  engine(on, [], {}, () => { if (answer.value instanceof Error) throw answer.value; return answer.value })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await launch($, 'v1', 'Build it', 'Work in /repo/.claude/worktrees/tidy-wave-2')).toEqual({ deny: 'no more agents' })
  answer.value = new Error('spawn failed')
  await expect(launch($, 'v1', 'Build it', 'Work in /repo/.claude/worktrees/tidy-wave-2')).rejects.toThrow()
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

test('a press on a wave folds its agents away and says how many it holds; a second press brings them back', async ($, on) => {
  const w = engine(on, [agent('a1', 'Build the importer'), agent('a2', 'Review the export fix')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await launch($, 'a1', 'Build the importer', 'Work only in /repo/.claude/worktrees/tidy-wave-2')
  await launch($, 'a2', 'Review the export fix', 'Check the fix, then record it: lcw req F1 pass --wave 1')
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:a2', 'view:a1'])
  await band.press({ key: 'wave:2' })
  await w.advance(1100)
  expect(await viewed(band)).toEqual(['view:a2'])
  expect(await band.find({ type: 'Text', text: /1 agent$/ })).toBeDefined()
  await band.press({ key: 'wave:2' })
  await w.advance(1100)
  expect(await viewed(band)).toEqual(['view:a2', 'view:a1'])
  await band.unmount()
})

test("with every wave folded the card still holds the agents, so Claude Code's own rows stay hidden", async ($, on) => {
  const w = engine(on, [agent('a1', 'Build the importer')])
  let hidden: unknown = 'not asked'
  on('ui.render', ($: any, e: any) => {
    if (e.component === 'AgentRow') hidden = e.props.isHidden
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await launch($, 'a1', 'Build the importer', 'Work only in /repo/.claude/worktrees/tidy-wave-2')
  await w.advance(2100)
  await band.press({ key: 'wave:2' })
  await w.advance(1100)
  expect(await viewed(band)).toEqual([])
  await band.unmount()
  const row = await $.ui.mount({ plugin: 'lcw', surface: 'terminal', component: 'AgentRow', requestId: 'a1', props: {
    id: 'a1', description: 'Build the importer', type: 'lcw:worker', status: 'running', kind: 'local_agent', taskStatus: 'running', label: 'Build the importer',
    startTime: 0, cwd: '/', tokenCount: 10, tokenSamples: [10], hasRow: true, rowIds: ['a1'], isHidden: false } } as any)
  expect(hidden).toBe(true)
  await row.unmount()
})

// A hunt of round 2 beside wave 2 still at work: the round has a lane, and its probes' briefs name the latest-work worktree.
const HUNTING = JSON.stringify({ ...JSON.parse(SWEEP), stage: 'Hunt', sweep: { ...JSON.parse(SWEEP).sweep, round: 2, hunt: { areas: 3, hunted: 1, running: 2, findings: 0 }, waves: [wave(2, 'Build')] } })
const PROBE = 'Hunt the settings pages. Read the code in /repo/.claude/worktrees/tidy-latest and report each problem'

test('a hunt probe is listed under the round\'s lane, and a press on the lane folds it away and says how many it holds', async ($, on) => {
  const w = engine(on, [agent('g1', 'Fix the toast notes'), agent('k1', 'Find where the export is built'), agent('h1', 'Hunt the settings pages'), agent('a1', 'Build the importer')])
  w.files[RUN + '/state.json'] = HUNTING
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await launch($, 'a1', 'Build the importer', 'Work only in /repo/.claude/worktrees/tidy-wave-2')
  await launch($, 'h1', 'Hunt the settings pages', PROBE)
  await launch($, 'k1', 'Find where the export is built', 'Which file builds the export? Read and report.', 'h1')
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:a1', 'view:k1', 'view:h1', 'view:g1'])
  await band.press({ key: 'round:2' })
  await w.advance(1100)
  expect(await viewed(band)).toEqual(['view:a1', 'view:g1'])
  expect(await band.find({ type: 'Text', text: /2 agents$/ })).toBeDefined()
  await band.press({ key: 'round:2' })
  await w.advance(1100)
  expect(await viewed(band)).toEqual(['view:a1', 'view:k1', 'view:h1', 'view:g1'])
  await band.unmount()
})

test('a hunt probe is known from its transcript when its launch was not seen', async ($, on) => {
  const w = engine(on, [agent('g1', 'Fix the toast notes'), agent('h1', 'Hunt the settings pages')], log('h1', PROBE))
  w.files[RUN + '/state.json'] = HUNTING
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await w.advance(2100)
  expect(await viewed(band)).toEqual(['view:h1', 'view:g1'])
  await band.unmount()
})
