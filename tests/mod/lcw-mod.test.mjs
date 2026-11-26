process.env.TZ = 'Europe/Dublin' // the 08:00 a dollar gate tries again at is local time
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addTotals, addUsage, agentTokens, buttons, cardMotion, cardPace, countsTurn, compactInstructions, gateFor, isShown, layout, reopenDue, reopenPrompt, resumePrompt,
  longNudges, quietCounts, replacesGate, sittingPrompt, sittingWaves, stallNudges, stallPrompt, themeFrom, trackAgents, usageFrom, wakeDue, wakePrompt, waveOfBrief, briefOf,
  measureStep, usdWakePrompt, carryDue, carryFailed, carryPrompt,
} from '../../hooks/lcw-mod.mjs'
import { buildView, renderCard } from '../../lib/card.mjs'
import { inputsOf } from '../render/boards.mjs'

const MIN = 60 * 1000
const NOW = Date.parse('2026-11-18T12:00:00Z')

test('the card steps five times a second while work is in flight, once while it waits on the person, never when paused or finished', () => {
  assert.equal(cardPace('running', true), 200)
  assert.equal(cardPace('with-you', true), 200)
  assert.equal(cardPace('running', false), 1000)
  assert.equal(cardPace('with-you', false), 1000)
  for (const working of [true, false]) {
    assert.equal(cardPace('paused', working), 0)
    assert.equal(cardPace('finished', working), 0)
  }
})

test('at five steps a second a fade lasts as long as at ten: the step is read from the clock, in 100 ms units', () => {
  const since = NOW - 37
  const frame = tick => renderCard(buildView(inputsOf('NeedsYou')), { width: 100, frame: true, tick })[0][0].c
  // Drawn anywhere within a step, the tick is the clock's count of 100 ms at the step's start, as at ten steps a second.
  for (let ms = 0; ms <= 2800; ms += 200) assert.equal(cardMotion(200, since, since + ms + 150).tick, ms / 100)
  // The needs-you frame fades out and back in 2.8 seconds, as today.
  assert.equal(frame(cardMotion(200, since, since + 2800).tick), frame(cardMotion(200, since, since).tick))
  assert.notEqual(frame(cardMotion(200, since, since + 1400).tick), frame(cardMotion(200, since, since).tick))
})

test('at one step a second the beat counts whole seconds from the clock', () => {
  const since = NOW - 950
  assert.deepEqual([0, 999, 1000, 4999, 5000].map(ms => cardMotion(1000, since, since + ms).beat), [0, 0, 1, 4, 5])
})

test('a run is shown until ten minutes after it finished; a stopped run never', () => {
  assert.equal(isShown(null, NOW), false)
  assert.equal(isShown({ status: 'running' }, NOW), true)
  assert.equal(isShown({ status: 'with-you' }, NOW), true)
  assert.equal(isShown({ status: 'finished', finishedAt: NOW - 9 * MIN }, NOW), true)
  assert.equal(isShown({ status: 'finished', finishedAt: NOW - 11 * MIN }, NOW), false)
  assert.equal(isShown({ status: 'finished' }, NOW), false)
  assert.equal(isShown({ status: 'stopped' }, NOW), false)
})

test('the theme follows a light Claude Code theme, else dark', () => {
  assert.equal(themeFrom([{ key: 'theme', value: 'light' }]), 'light')
  assert.equal(themeFrom([{ key: 'theme', value: 'light-daltonized' }]), 'light')
  assert.equal(themeFrom([{ key: 'theme', value: 'dark-ansi' }]), 'dark')
  assert.equal(themeFrom([{ key: 'theme', value: 'auto' }]), 'dark')
  assert.equal(themeFrom([]), 'dark')
  assert.equal(themeFrom(undefined), 'dark')
})

const agent = (over) => ({
  id: 'a1', description: 'Add date filters', status: 'running', tokenCount: 1000,
  startTime: NOW - 5 * MIN, model: 'claude-sonnet-5-5', ...over,
})

test('agents are normalised for the card and finished ones dropped', () => {
  const { agents, seen } = trackAgents([
    agent({ parentId: 'o1', lastRequest: { effort: 'medium' } }),
    agent({ id: 'a2', status: 'completed' }),
    agent({ id: 'a3', status: 'idle' }),
  ], {}, NOW)
  assert.deepEqual(agents, [{
    id: 'a1', description: 'Add date filters', model: 'claude-sonnet-5-5', effort: 'medium',
    tokens: 1000, startTime: NOW - 5 * MIN, parentId: 'o1', status: 'running', quietMs: 0,
    held: false, heldMs: 0, listedMs: 0, hasChild: false,
    spark: [], tokensWas: 1000, movedAt: null,
  }])
  assert.deepEqual(Object.keys(seen), ['a1'])
})

test('a running agent whose tokens stop moving grows quiet; new tokens reset it', () => {
  let r = trackAgents([agent()], {}, NOW)
  r = trackAgents([agent()], r.seen, NOW + 6 * MIN)
  assert.equal(r.agents[0].quietMs, 6 * MIN)
  r = trackAgents([agent({ tokenCount: 1200 })], r.seen, NOW + 7 * MIN)
  assert.equal(r.agents[0].quietMs, 0)
})

test('an agent keeps what it gained in each of its last eight 20-second spans, and where its figure moved from', () => {
  const S = 20 * 1000
  let r = trackAgents([agent()], {}, NOW)
  r = trackAgents([agent({ tokenCount: 1300 })], r.seen, NOW + 2000)
  assert.deepEqual([r.agents[0].tokensWas, r.agents[0].movedAt, r.agents[0].spark], [1000, NOW + 2000, []])
  r = trackAgents([agent({ tokenCount: 1500 })], r.seen, NOW + S)
  assert.deepEqual(r.agents[0].spark, [500])
  r = trackAgents([agent({ tokenCount: 1500 })], r.seen, NOW + 2 * S)
  assert.deepEqual(r.agents[0].spark, [500, 0])
  // spans the mod missed: what was gained shows in the first of them, the rest are empty, and eight are kept
  r = trackAgents([agent({ tokenCount: 2500 })], r.seen, NOW + 12 * S)
  assert.deepEqual(r.agents[0].spark, [1000, 0, 0, 0, 0, 0, 0, 0])
})

test('an agent waiting on a shell or a child is never quiet', () => {
  let r = trackAgents([agent({ status: 'waiting' })], {}, NOW)
  r = trackAgents([agent({ status: 'waiting' })], r.seen, NOW + 20 * MIN)
  assert.equal(r.agents[0].quietMs, 0)
  r = trackAgents([agent()], r.seen, NOW + 21 * MIN)
  assert.equal(r.agents[0].quietMs, MIN)
})

test('an agent whose turn has ended is held while it stays listed with no live agent of its own', () => {
  const ended = (over) => agent({ status: 'waiting', taskStatus: 'completed', ...over })
  let r = trackAgents([ended()], {}, NOW)
  assert.deepEqual([r.agents[0].held, r.agents[0].heldMs], [true, 0])
  r = trackAgents([ended()], r.seen, NOW + 16 * MIN)
  assert.deepEqual([r.agents[0].heldMs, r.agents[0].quietMs], [16 * MIN, 0])
  r = trackAgents([agent({ taskStatus: 'running' })], r.seen, NOW + 17 * MIN)
  assert.deepEqual([r.agents[0].held, r.agents[0].heldMs], [false, 0], 'its turn runs again')
  r = trackAgents([ended()], r.seen, NOW + 18 * MIN)
  assert.equal(r.agents[0].heldMs, 0, 'a later hold starts from nothing')
  const withChild = [ended(), agent({ id: 'kid', parentId: 'a1' })]
  r = trackAgents(withChild, trackAgents(withChild, {}, NOW).seen, NOW + 20 * MIN)
  assert.deepEqual([r.agents[0].held, r.agents[0].heldMs, r.agents[0].hasChild], [false, 0, true])
})

test('an agent is listed in one go from when it is first seen, and afresh once it has left the list', () => {
  let r = trackAgents([agent()], {}, NOW)
  r = trackAgents([agent({ tokenCount: 2000 })], r.seen, NOW + 61 * MIN)
  assert.equal(r.agents[0].listedMs, 61 * MIN)
  r = trackAgents([agent({ status: 'completed' })], r.seen, NOW + 62 * MIN)
  r = trackAgents([agent()], r.seen, NOW + 70 * MIN)
  assert.equal(r.agents[0].listedMs, 0)
})

test('neighbouring spans of one id are one button, with no hotkey', () => {
  const row = [{ t: '▸ ', id: 'more' }, { t: '3 more', id: 'more' }, { t: ' x' }, { t: '→ a', id: 'view:a' }]
  assert.deepEqual(buttons(row).map((g) => [g.id, g.spans.length, 'key' in g]), [['more', 2, false], [undefined, 1, false], ['view:a', 1, false]])
})

test('the right group is pushed to the edge', () => {
  assert.equal(layout([{ t: 'abc' }, { t: '12m', r: true }], 20).gap, 14)
  assert.equal(layout([{ t: '→ abc', id: 'view:a' }, { t: '12m', r: true }], 20).gap, 12)
  assert.equal(layout([{ t: 'abc' }, { t: 'x', r: true }], 3).gap, 2)
  assert.equal(layout([{ t: 'abc' }], 20).gap, 0)
})

test('where a gap of two does not fit, the description gives up its padding, then its end', () => {
  const row = [{ t: '│ ' }, { t: '▾ ', id: 'toggle:o1' }, { t: 'Own the work   ', id: 'view:o1' }, { t: 'Opus' }, { t: '5m', r: true }, { t: ' │', r: true }]
  assert.equal(layout(row, 40).left[2].t, 'Own the work   ')
  const padded = layout(row, 27)
  assert.deepEqual([padded.left[2].t, padded.gap], ['Own the work ', 2])
  const clipped = layout(row, 22)
  assert.deepEqual([clipped.left[2].t, clipped.gap], ['Own the…', 2])
})

// The card as the terminal draws it.
function draw(card, cols) {
  return card.map((row) => {
    const { left, gap, right } = layout(row, cols)
    return [...left, ...(gap ? [{ t: ' '.repeat(gap) }] : []), ...right].map((s) => s.t).join('')
  })
}

test('every row is as wide as the band, with the model and sparkline columns lined up', () => {
  const many = inputsOf('ManyAgents')
  const o1 = many.agents[0].id
  const cases = [
    ['ManyAgents', {}], ['ManyAgents', { expanded: { [o1]: true } }], ['ManyAgents', { moreOpen: true }], ['AgentsOpen', {}],
    ['RunningA', {}], ['Stalled', {}], ['NoMod', {}],
  ]
  for (const [board, ui] of cases) for (const cols of [126, 100, 80]) for (const maxRows of [undefined, 12]) {
    const i = inputsOf(board)
    const lines = draw(renderCard(buildView({ ...i, ui: { ...i.ui, ...ui } }), { width: cols, frame: true, maxRows }), cols)
    const at = board + ' ' + JSON.stringify(ui) + ' at ' + cols + ': '
    lines.forEach((l) => assert.equal([...l].length, cols, at + l))
    assert.ok(!lines.some((l) => /\b[0-9a-z]: /.test(l)), at + 'no hotkey numbers')
    const agents = lines.filter((l) => /^│ (?:[▾▸] )? *[→◈] /.test(l))
    assert.ok(agents.length >= 1, at + 'agent rows')
    const model = new Set(agents.map((l) => l.search(/(Fable|Opus|Sonnet|Haiku) \d/)).filter((n) => n > 0))
    assert.equal(model.size, 1, at + 'the model column')
    const spark = new Set(agents.filter((l) => /[▁-█]{8}/.test(l)).map((l) => l.search(/[▁-█]{8}/)))
    assert.ok(spark.size <= 1, at + 'the sparkline column')
  }
})

test('the card reads as wanted', () => {
  const lines = draw(renderCard(buildView(inputsOf('AgentsOpen')), { width: 126, frame: true }), 126)
  const has = (re) => assert.ok(lines.some((l) => re.test(l)), re + '\n' + lines.join('\n'))
  has(/^│ ▾ ◈ Own the billing workstream · 6 workers +Opus/)
  has(/^│ {5}→ Add proration to the invoice builder +Sonnet/)
  has(/^│ {5}▸ 3 more workers +│$/)
  has(/^│ ▸ 3 more agents +\S+ tokens in flight │$/)
})

test('the rows of the wanted sample, as drawn at 101 columns', () => {
  const a = (id, description, model, effort, k, secs, parentId) =>
    ({ id, description, model, effort, tokens: k * 1000, startTime: NOW - secs * 1000, status: 'running', quietMs: 0, parentId })
  const agents = [
    a('A', 'Add from/to date filters to the export API', 'claude-sonnet-5-5', 'medium', 18, 41),
    a('B', 'Write the CSV writer', 'claude-sonnet-5-5', 'medium', 10, 41),
    a('C', 'Check the header order', 'claude-haiku-5-5', 'low', 10, 41),
    a('O', 'Own the billing workstream', 'claude-haiku-5-5', 'low', 19, 41),
    a('M', 'Move the tax rules into one module', 'claude-haiku-5-5', 'low', 22, 57, 'O'),
    a('D', 'd', 'claude-haiku-5-5', 'low', 19, 41),
    a('E', 'e', 'claude-haiku-5-5', 'low', 19, 41),
  ]
  const view = buildView({ state: { name: 'x', status: 'running', stage: 'Build', stageSince: NOW }, agents, now: NOW, ui: { expanded: { O: true } } })
  // as the mod draws it: no hotkey numbers, and the description takes the room up to the model
  const full = renderCard(view, { width: 101, frame: true })
  const lines = draw(renderCard(view, { width: 101, frame: true, maxRows: full.length - 1 }), 101)
  for (const want of [
    '│   → Add from/to date filters to the export API        Sonnet 5.5 medium    ▁▁▁▁▁▁▁▁   18k     41s │',
    '│ ▾ ◈ Own the billing workstream                        Haiku 5.5  low       ▁▁▁▁▁▁▁▁   19k     41s │',
    '│     → Move the tax rules into one module              Haiku 5.5  low       ▁▁▁▁▁▁▁▁   22k     57s │',
  ]) assert.ok(lines.includes(want), want + '\n' + lines.join('\n'))
  assert.ok(lines.some((l) => /^│ ▸ 2 more agents +117k tokens in flight │$/.test(l)), lines.join('\n'))
})

test('below 44 columns the agent row and its more row start at the edge', () => {
  const lines = draw(renderCard(buildView(inputsOf('Narrow')), { width: 40 }), 40)
  assert.match(lines.find((l) => l.includes('→')), /^→ Add /)
  assert.match(lines.find((l) => /more$/.test(l)), /^▸ \d+ more$/)
  lines.forEach((l) => assert.ok([...l].length <= 40, l))
})

test('totals: distinct agents, kept across a reload, and the tokens their turns used', () => {
  const list = [agent({ id: 'a1', tokenCount: 100 }), agent({ id: 'a2', tokenCount: 50, status: 'completed' })]
  let t = addTotals({}, list, NOW - 60 * MIN)
  assert.equal(t.agents, 2)
  t = addTotals(t, [agent({ id: 'a1' })], NOW - 60 * MIN)
  assert.equal(t.agents, 2, 'a finished agent that left the list still counts')
  const reloaded = addTotals(JSON.parse(JSON.stringify(t)), [agent({ id: 'a1' }), agent({ id: 'a3' })], NOW - 60 * MIN)
  assert.equal(reloaded.agents, 3)
  assert.equal(addTotals({}, [agent({ startTime: NOW - 90 * MIN })], NOW - 60 * MIN).agents, 0, 'an agent from before the run')
  assert.deepEqual(addTotals(null, undefined), { agents: 0, tokens: 0, seen: {} })
  // a turn's tokens are every count /cost has for it, cache reads included, kept apart for the session and the agents
  const turn = { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 50000, cache_creation_input_tokens: 3000, model: 'm' }
  t = addUsage(reloaded, turn, false)
  t = addUsage(t, turn, true)
  t = addUsage(addTotals(t, [agent({ id: 'a4', tokenCount: 999999 })], NOW - 60 * MIN), turn, true)
  assert.deepEqual([t.agents, t.tokens, t.used], [4, 3 * 53210, { main: 53210, agents: 2 * 53210 }], 'what an agent holds is not what it used')
})

test('a turn counts for the run while it runs, and the turn that finished it counts too', () => {
  assert.equal(countsTurn({ status: 'running' }, NOW), true)
  assert.equal(countsTurn({ status: 'finished', finishedAt: NOW }, NOW - MIN), true, 'the turn that ran lcw finish')
  assert.equal(countsTurn({ status: 'finished', finishedAt: NOW }, NOW + MIN), false, 'a turn after it')
  assert.equal(countsTurn({ status: 'stopped' }, NOW), false)
})

test('an agent row shows what the agent has used, not what it holds', () => {
  const u = (n) => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: n, cache_creation_input_tokens: 0, model: 'm' })
  assert.equal(agentTokens(agent({ tokenCount: 40000, usage: [u(30000), u(40000)] })), 70000)
  assert.equal(agentTokens(agent({ tokenCount: 40000 })), 40000, 'before its first request is counted')
})

test('a gate is written once the week reaches the mark of an unfinished run', () => {
  const resetsAt = '2026-11-22T14:00:00.000Z'
  const state = { status: 'running', markPercent: 75 }
  assert.equal(gateFor(state, { percentUsed: 74.9, resetsAt }, NOW), null)
  assert.deepEqual(gateFor(state, { percentUsed: 75, resetsAt }, NOW),
    { reason: 'mark', markPercent: 75, usedPercent: 75, resetsAt, at: NOW })
  assert.equal(gateFor({ status: 'running' }, { percentUsed: 80, resetsAt }, NOW).markPercent, 75)
  assert.equal(gateFor({ ...state, status: 'finished' }, { percentUsed: 90, resetsAt }, NOW), null)
  assert.equal(gateFor(state, { percentUsed: 90, resetsAt: '2026-11-18T11:00:00Z' }, NOW), null, 'a stale reading')
  assert.equal(gateFor(state, null, NOW), null)
  assert.equal(gateFor({ ...state, status: 'paused', pausedReason: 'human' }, { percentUsed: 90, resetsAt }, NOW), null, 'the human paused it')
  assert.equal(gateFor({ ...state, status: 'paused', pausedReason: 'mark' }, { percentUsed: 90, resetsAt }, NOW).reason, 'mark')
})

test('a gate is written over one on disk only where that one has no reset time and the new one has', () => {
  const resetsAt = '2026-11-22T14:00:00.000Z'
  const known = { reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt, at: NOW }
  const unknown = { ...known, resetsAt: null }
  assert.equal(replacesGate(null, known), true)
  assert.equal(replacesGate(null, unknown), true, 'a gate with no reset time still holds the run at its mark')
  assert.equal(replacesGate(unknown, known), true)
  assert.equal(replacesGate({ ...known, resetsAt: undefined }, known), true, 'one another program wrote without the field')
  assert.equal(replacesGate(known, { ...known, usedPercent: 90 }), false)
  assert.equal(replacesGate(unknown, unknown), false)
  assert.equal(replacesGate({ reason: 'mark', unit: 'usd', retryAt: NOW }, known), false, 'a dollar gate')
  assert.equal(replacesGate(unknown, null), false)
})

test('the wake comes once, after the reset time', () => {
  const gate = { resetsAt: '2026-11-18T11:59:00.000Z' }
  assert.equal(wakeDue(gate, NOW, null), true)
  assert.equal(wakeDue(gate, NOW, gate.resetsAt), false)
  assert.equal(wakeDue({ resetsAt: '2026-11-18T12:01:00Z' }, NOW, null), false)
  assert.equal(wakeDue({ resetsAt: null }, NOW, null), false)
  assert.equal(wakeDue(null, NOW, null), false)
  assert.equal(wakeDue({ resetsAt: '2026-11-14T12:00:00Z' }, NOW, null), true, 'a reset days ago')
  assert.equal(wakeDue({ resetsAt: 'soon' }, NOW, null), false)
})

test('a reopened session carries on only a running run with no gate that no live mod is drawing', () => {
  assert.equal(reopenDue({ status: 'running' }, null, null, NOW), true, 'no mod-alive')
  assert.equal(reopenDue({ status: 'running' }, null, NaN, NOW), true, 'an unreadable mod-alive')
  assert.equal(reopenDue({ status: 'running' }, null, NOW - 16000, NOW), true, 'a stale mod-alive')
  assert.equal(reopenDue({ status: 'running' }, null, NOW - 4000, NOW), false, 'a plugin reload')
  for (const status of ['with-you', 'paused', 'finished', 'stopped']) assert.equal(reopenDue({ status }, null, null, NOW), false, status)
  assert.equal(reopenDue({ status: 'paused', pausedReason: 'human' }, null, null, NOW), false, 'paused by the human')
  assert.equal(reopenDue({ status: 'running' }, { resetsAt: '2026-11-19T12:00:00Z' }, null, NOW), false, 'a holding gate')
  assert.equal(reopenDue({ status: 'running' }, { resetsAt: '2026-11-17T12:00:00Z' }, null, NOW), false, 'an expired gate is the wake\'s')
  assert.equal(reopenDue(null, null, null, NOW), false)
})

test('usage.json keeps the weekly figure, and nothing is written without one', () => {
  const limits = [
    { kind: 'five_hour', percentUsed: 12, resetsAt: '2026-11-18T15:00:00Z' },
    { kind: 'seven_day', percentUsed: 23, resetsAt: '2026-11-22T14:00:00Z' },
  ]
  assert.deepEqual(usageFrom(limits, NOW), {
    at: NOW, source: 'mod',
    sevenDay: { percentUsed: 23, resetsAt: '2026-11-22T14:00:00Z' },
  })
  assert.equal(usageFrom(limits, NOW, NOW - 5000).seen, NOW - 5000)
  assert.equal(usageFrom([], NOW), null)
  assert.equal(usageFrom([limits[0]], NOW), null)
})

test('the compaction keeps the run id, the folder and the step; the prompts name the CLI', () => {
  const kept = compactInstructions({ id: '20261118-export-csv' }, '/h/runs/20261118-export-csv', 'start T4')
  for (const part of ['20261118-export-csv', '/h/runs/20261118-export-csv', 'start T4']) assert.ok(kept.includes(part))
  const resume = resumePrompt('/plug', 'start T4')
  assert.ok(resume.includes('node "/plug/scripts/lcw.mjs" status') && resume.includes('start T4'))
  const wake = wakePrompt('/plug')
  assert.ok(wake.indexOf('node "/plug/scripts/lcw.mjs" resume') < wake.indexOf('node "/plug/scripts/lcw.mjs" status') && wake.includes('ledger'))
  assert.ok(wake.indexOf('lcw.mjs" resume') >= 0)
  const reopen = reopenPrompt('/plug')
  assert.ok(reopen.includes('lcw:lcw') && reopen.includes('node "/plug/scripts/lcw.mjs" status') && reopen.includes('reopened'))
})

test('every row of the framed card is as wide as the band, from 44 columns up', () => {
  const state = { id: '20261118-x', name: 'x', status: 'running', stage: 'Build', stageSince: NOW - 5 * MIN,
    tasks: [{ id: 'T1', status: 'done' }, { id: 'T2', status: 'running' }, { id: 'T3', status: 'todo' }] }
  const { agents } = trackAgents([
    agent({ id: 'o1', description: 'Own the billing workstream', model: 'claude-opus-5-5', effort: 'high', tokenCount: 1200000 }),
    agent({ parentId: 'o1', description: 'Add proration to the invoice builder', effort: 'medium', tokenCount: 212000 }),
    agent({ id: 'a2', description: 'Map DB columns to the CSV header order', effort: 'medium' }),
  ], {}, NOW)
  for (let cols = 44; cols <= 130; cols++) {
    const view = buildView({ state, agents, usage: null, gate: null, now: NOW, ui: { expanded: { o1: true }, moreOpen: false } })
    const rows = renderCard(view, { width: cols, theme: 'dark', frame: true })
    assert.ok(rows.some((row) => row.some((s) => s.id)), 'the card has buttons')
    for (const row of rows) {
      const { left, gap, right } = layout(row, cols)
      const width = [...[...left, ...right].map((s) => s.t).join('')].length + gap
      assert.equal(width, cols, JSON.stringify(row.map((s) => s.t).join('')))
    }
  }
})

const stalling = (id, quietMin, more = {}) => ({ id, description: 'Build the ' + id, model: 'sonnet', effort: 'medium', tokens: 1000, startTime: NOW - 30 * MIN, status: 'running', quietMs: quietMin * MIN, ...more })

test('the orchestrator is told when an agent stalls, then twice more, five minutes apart, and no more', () => {
  let r = stallNudges([stalling('a', 14), stalling('b', 3)], {}, NOW)
  assert.deepEqual(r.due, [], 'quiet is not stalled')
  r = stallNudges([stalling('a', 15), stalling('b', 4)], r.nudged, NOW + MIN)
  assert.deepEqual(r.due.map((a) => [a.id, a.times]), [['a', 1]])
  r = stallNudges([stalling('a', 17)], r.nudged, NOW + 3 * MIN)
  assert.deepEqual(r.due, [], 'not again within five minutes')
  r = stallNudges([stalling('a', 20)], r.nudged, NOW + 6 * MIN)
  assert.deepEqual(r.due.map((a) => [a.id, a.times]), [['a', 2]])
  r = stallNudges([stalling('a', 25)], r.nudged, NOW + 11 * MIN)
  assert.deepEqual(r.due.map((a) => [a.id, a.times]), [['a', 3]])
  r = stallNudges([stalling('a', 60)], r.nudged, NOW + 46 * MIN)
  assert.deepEqual(r.due, [], 'three times is enough')
})

test('an agent that moves again, or ends, is forgotten, and is reported afresh if it stalls again', () => {
  let r = stallNudges([stalling('a', 15)], {}, NOW)
  assert.equal(r.due.length, 1)
  r = stallNudges([stalling('a', 0, { tokens: 1200 })], r.nudged, NOW + MIN)
  assert.deepEqual(r.nudged, {})
  r = stallNudges([stalling('a', 15, { tokens: 1200 })], r.nudged, NOW + 16 * MIN)
  assert.deepEqual(r.due.map((a) => a.times), [1])
  assert.deepEqual(stallNudges([], r.nudged, NOW + 17 * MIN).nudged, {})
})

test('an agent whose clock starts over without its tokens moving keeps its record, so three notices stay three', () => {
  let r = stallNudges([stalling('a', 15)], { a: { at: NOW - 20 * MIN, times: 3, tokens: 1000 } }, NOW)
  assert.deepEqual(r.due, [])
  r = stallNudges([stalling('a', 0)], r.nudged, NOW + MIN)
  assert.equal(r.nudged.a.times, 3)
  r = stallNudges([stalling('a', 15)], r.nudged, NOW + 16 * MIN)
  assert.deepEqual(r.due, [])
})

test('an agent that only waits on a shell or a child is never reported', () => {
  const list = [{ id: 'w', description: 'x', status: 'waiting', tokenCount: 5 }]
  const t1 = trackAgents(list, {}, NOW)
  const t2 = trackAgents(list, t1.seen, NOW + 40 * MIN)
  assert.deepEqual(stallNudges(t2.agents, {}, NOW + 40 * MIN).due, [])
})

test('a held agent is reported on the same schedule as a stalled one, as held', () => {
  const held = (minutes) => stalling('h', 0, { status: 'waiting', held: true, heldMs: minutes * MIN })
  let r = stallNudges([held(14)], {}, NOW)
  assert.deepEqual(r.due, [])
  r = stallNudges([held(15)], r.nudged, NOW + MIN)
  assert.deepEqual(r.due.map((a) => [a.id, a.times, a.why]), [['h', 1, 'held']])
  r = stallNudges([held(20)], r.nudged, NOW + 6 * MIN)
  assert.deepEqual(r.due.map((a) => [a.times, a.why]), [[2, 'held']])
  assert.equal(stallNudges([stalling('a', 15)], {}, NOW).due[0].why, 'still')
})

test('an agent long at work is named once, and not while held, stalled or waiting on an agent of its own', () => {
  const at = (minutes, more = {}) => stalling('w', 0, { listedMs: minutes * MIN, ...more })
  let r = longNudges([at(59)], {})
  assert.deepEqual(r.due, [])
  for (const more of [{ held: true }, { hasChild: true }, { quietMs: 15 * MIN }]) assert.deepEqual(longNudges([at(90, more)], {}).due, [], JSON.stringify(more))
  r = longNudges([at(60)], r.told)
  assert.deepEqual(r.due.map((a) => [a.id, a.why]), [['w', 'long']])
  r = longNudges([at(61)], r.told)
  assert.deepEqual(r.due, [], 'once')
  assert.deepEqual(longNudges([], r.told).told, {}, 'forgotten once it has left the list')
})

test('the prompt tells a held agent and a long one apart from a stalled one, each with what to do', () => {
  const held = stallPrompt([{ ...stalling('p1', 0, { heldMs: 16 * MIN }), times: 1, why: 'held' }], [])
  for (const fact of ['Build the p1', 'id p1', 'gave its report 16 minutes ago', 'ListAgents may call it completed', 'Do not message it', 'TaskStop with its id', 'leave it']) assert.ok(held.includes(fact), fact)
  assert.ok(!held.includes('When an agent stalls'))
  const long = stallPrompt([{ ...stalling('w1', 0, { listedMs: 61 * MIN, tokens: 1200000 }), why: 'long' }], [])
  for (const fact of ['Build the w1', 'id w1', '61 minutes', '1.2M tokens', 'a check, not a fault', 'do nothing', 'told this once']) assert.ok(long.includes(fact), fact)
  const both = stallPrompt([{ ...stalling('a', 15), times: 1, why: 'still' }, { ...stalling('p1', 0, { heldMs: 15 * MIN }), times: 1, why: 'held' }], []).split('\n\n')
  assert.equal(both.length, 2)
  assert.ok(both[0].includes('has not moved for 15 minutes') && both[0].includes('When an agent stalls'))
  assert.ok(both[1].includes('gave its report 15 minutes ago') && !both[1].includes('When an agent stalls'))
})

test('the stall prompt names the agent, how long, who launched it, and where to read what to do', () => {
  const orch = stalling('o1', 0, { description: 'Drive the API milestone' })
  const one = stallPrompt([{ ...stalling('w1', 16, { parentId: 'o1' }), times: 1 }], [orch])
  for (const fact of ['Build the w1', 'id w1', 'Drive the API milestone', 'id o1', '16 minutes', 'When an agent stalls']) assert.ok(one.includes(fact), fact)
  const two = stallPrompt([{ ...stalling('w1', 21), times: 2 }, { ...stalling('w2', 15), times: 1 }], [])
  for (const fact of ['2 agents', 'Build the w1', '21 minutes', 'second time', 'Build the w2', '15 minutes']) assert.ok(two.includes(fact), fact)
})

test('a stall notice can arrive after the agent has moved on, so it asks for action only if the agent is still stalled', () => {
  const one = stallPrompt([{ ...stalling('w1', 16), times: 1 }], [])
  assert.match(one, /16 minutes\. If it is still stalled, /)
  const two = stallPrompt([{ ...stalling('w1', 21), times: 1 }, { ...stalling('w2', 15), times: 1 }], [])
  assert.match(two, /15 minutes\. If they are still stalled, /)
})

// A sweep with wave 1 in Review, wave 2 in Build and wave 3 queued; over changes a wave by its number.
const sweepOf = (over = {}) => ({
  id: 'run-1',
  sweep: { waves: [
    { n: 1, status: 'running', stage: 'Review', tasks: [{ status: 'done' }], ...over[1] },
    { n: 2, status: 'running', stage: 'Build', tasks: [{ status: 'running' }], ...over[2] },
    { n: 3, status: 'queued', ...over[3] },
  ] },
})
const on = (...waves) => waves.map((wave) => ({ wave, held: false }))
// Looks at the sweep at each of the given minutes in turn, and gives what was due at each.
function looks(steps, sat = {}) {
  const due = []
  for (const [minute, state, agents] of steps) {
    const r = sittingWaves(state, agents, sat, NOW + minute * MIN)
    sat = r.sat
    due.push(r.due.map((d) => (d.queued ? 'queued ' : '') + d.n + (d.again ? ' again' : '')))
  }
  return { due, sat }
}

test('a wave with no agent at work for ten minutes is named, once; a wave with an agent is not, nor one that got one meanwhile', () => {
  const s = sweepOf({ 3: { status: 'shipped' } })
  assert.deepEqual(looks([[0, s, on(2)], [9, s, on(2)], [10, s, on(2)], [11, s, on(2)], [40, s, on(2)]]).due, [[], [], ['1'], [], []])
  // wave 2 loses its agent at minute 5 and gets one back at minute 12: it never sat for ten
  assert.deepEqual(looks([[0, s, on(1, 2)], [5, s, on(1)], [12, s, on(1, 2)], [20, s, on(1, 2)]]).due, [[], [], [], []])
  // and a wave that sat, was named and got an agent is named afresh when it sits again
  assert.deepEqual(looks([[0, s, on(2)], [10, s, on(2)], [20, s, on(1, 2)], [21, s, on(2)], [30, s, on(2)], [31, s, on(2)]]).due, [[], ['1'], [], [], [], ['1']])
})

test('a wave in Ship, one that waits on the person and one that has shipped are never named, and a held agent is not at work', () => {
  const s = sweepOf({ 1: { stage: 'Ship' }, 2: { waiting: true }, 3: { status: 'shipped', stage: 'Ship' } })
  assert.deepEqual(looks([[0, s, []], [30, s, []]]).due, [[], []])
  const built = sweepOf({ 3: { status: 'shipped' } })
  assert.deepEqual(looks([[0, built, [{ wave: 1, held: true }, { wave: 2, held: false }]], [10, built, [{ wave: 1, held: true }, { wave: 2, held: false }]]]).due, [[], ['1']])
})

test('a sitting wave is named again only once a task has ended or a wave has moved, and no sooner than thirty minutes on', () => {
  const s = sweepOf({ 3: { status: 'shipped' } })
  const moved = sweepOf({ 2: { tasks: [{ status: 'done' }] }, 3: { status: 'shipped' } })
  // nothing has changed: never again
  assert.deepEqual(looks([[0, s, on(2)], [10, s, on(2)], [45, s, on(2)], [120, s, on(2)]]).due, [[], ['1'], [], []])
  // a task ended at minute 20: named again at minute 40, thirty after the first time, and then not until more has changed
  assert.deepEqual(looks([[0, s, on(2)], [10, s, on(2)], [20, moved, on(2)], [39, moved, on(2)], [40, moved, on(2)], [80, moved, on(2)]]).due, [[], ['1'], [], [], ['1 again'], []])
})

test('waves that come to sit close together are asked about in one notice, and repeats share one clock', () => {
  const s = sweepOf({ 3: { status: 'shipped' } })
  // wave 1 sits from minute 0 and wave 2 from minute 5: wave 2 is ten minutes in at 15, but a notice went at 10, so it waits for 25
  assert.deepEqual(looks([[0, s, on(2)], [5, s, []], [10, s, []], [15, s, []], [24, s, []], [25, s, []]]).due, [[], [], ['1'], [], [], ['2']])
  // a task ends: wave 1 is named again at 40. Wave 2's own thirty minutes are up at 55 and a wave has moved by then, but
  // repeats are thirty apart, so it waits for 70, and wave 1 goes with it
  const moved = sweepOf({ 1: { tasks: [{ status: 'done' }, { status: 'done' }] }, 3: { status: 'shipped' } })
  const round2 = sweepOf({ 1: { tasks: [{ status: 'done' }, { status: 'done' }], round: 2 }, 3: { status: 'shipped' } })
  const first = looks([[0, s, on(2)], [5, s, []], [10, s, []], [25, s, []]])
  assert.deepEqual(looks([[40, moved, []], [55, round2, []], [69, round2, []], [70, round2, []]], first.sat).due, [['1 again'], [], [], ['1 again', '2 again']])
})

test('the front queued wave is named once it has been queued ten minutes, not while an agent already works for it, and starts over once it starts', () => {
  const s = sweepOf()
  assert.deepEqual(looks([[0, s, on(1, 2)], [10, s, on(1, 2)], [11, s, on(1, 2)]]).due, [[], ['queued 3'], []])
  assert.deepEqual(looks([[0, s, on(1, 2, 3)], [10, s, on(1, 2, 3)]]).due, [[], []])
  // only the front one: a second queued wave waits its turn
  const two = { id: 'run-1', sweep: { waves: [...s.sweep.waves, { n: 4, status: 'queued' }] } }
  assert.deepEqual(looks([[0, two, on(1, 2)], [10, two, on(1, 2)]]).due, [[], ['queued 3']])
  // started at minute 12 with no agent yet: its ten minutes run from there
  const started = sweepOf({ 3: { status: 'running', stage: 'Plan' } })
  assert.deepEqual(looks([[0, s, on(1, 2)], [10, s, on(1, 2)], [12, started, on(1, 2)], [21, started, on(1, 2)], [26, started, on(1, 2)]]).due, [[], ['queued 3'], [], [], ['3']])
})

test('what was kept for another run is not used, and a record holds only the waves still sitting', () => {
  const s = sweepOf({ 3: { status: 'shipped' } })
  const { sat } = looks([[0, s, on(2)], [10, s, on(2)]])
  assert.deepEqual(Object.keys(sat.waves), ['1'])
  assert.equal(sat.run, 'run-1')
  // the same waves under another run's id start their ten minutes again
  assert.deepEqual(looks([[11, { ...s, id: 'run-2' }, on(2)], [20, { ...s, id: 'run-2' }, on(2)], [21, { ...s, id: 'run-2' }, on(2)]], sat).due, [[], [], ['1']])
  assert.deepEqual(sittingWaves({ id: 'a-build' }, [], {}, NOW).due, [])
})

test('the notice names each wave, how long, what was recorded for it, and how to record why; a queued wave and an unplaced agent have words of their own', () => {
  const p = sittingPrompt([
    { n: 18, queued: false, stage: 'Build', waits: '', ms: 12 * MIN, again: false },
    { n: 19, queued: false, stage: 'Review', waits: 'its screens need the player files', ms: 58 * MIN, again: true },
    { n: 24, queued: true, stage: '', waits: '', ms: 135 * MIN, again: false },
  ], 2)
  for (const fact of [/^LCW: work is sitting in this sweep\./, /wave 18 \(in Build, 12 minutes\) and wave 19 \(in Review, 58 minutes, as when you were last asked; you recorded "its screens need the player files", so see whether that still holds\)/,
    /start now whatever can run/, /lcw set waits="<why>" --wave <n>/, /Wave 24 has been queued for 135 minutes: see whether it can start now/, /2 agents are at work whose wave LCW could not read/]) assert.match(p, fact)
  const one = sittingPrompt([{ n: 24, queued: true, stage: '', waits: '', ms: 10 * MIN, again: false }])
  assert.doesNotMatch(one, /No agent is at work|lcw set waits|could not read/)
})

test('agents are counted quiet after five still minutes and stalled after fifteen, as the card marks them', () => {
  const agents = [4, 5, 14, 15, 40].map((minutes, i) => ({ id: 'a' + i, quietMs: minutes * MIN }))
  assert.deepEqual(quietCounts(agents), { quiet: 2, stalled: 2 })
  assert.deepEqual(quietCounts([]), { quiet: 0, stalled: 0 })
  assert.deepEqual(quietCounts(undefined), { quiet: 0, stalled: 0 })
})

test('a held agent counts as stalled after fifteen minutes, and never as quiet', () => {
  assert.deepEqual(quietCounts([{ id: 'a', quietMs: 0, heldMs: 6 * MIN }, { id: 'b', quietMs: 0, heldMs: 15 * MIN }]), { quiet: 0, stalled: 1 })
})

// Pay-per-token billing. NOW is 12:00 in Dublin (winter, so local time is UTC): the next 08:00 is tomorrow's.
const WEEKLY = { at: NOW, sevenDay: { percentUsed: 10, resetsAt: '2026-11-22T00:00:00Z' } }
const REC = { v: 1, base: 5, max: 12, q: { [Math.floor((NOW - 3600000) / 900000)]: 12 } }
const TOMORROW_8 = Date.parse('2026-11-19T08:00:00Z')

test('a weekly figure settles a subscription, over any other sign-in, and its spend is dropped and not recorded', () => {
  for (const billing of ['unclear', 'payg', undefined]) {
    const step = measureStep({ billing }, REC, { weekly: WEEKLY, cost: 20 }, NOW)
    assert.deepEqual(step, { billing: 'subscription', changed: true, record: null, drop: true })
  }
  const settled = measureStep({ billing: 'subscription' }, null, { weekly: null, cost: 20 }, NOW)
  assert.deepEqual(settled, { billing: 'subscription', changed: false, record: null, drop: false })
})

test('an unclear session becomes pay-per-token only once a reply costs something without a weekly figure', () => {
  assert.equal(measureStep({}, null, { weekly: null, cost: 0 }, NOW).billing, 'unclear')
  assert.equal(measureStep({}, null, { weekly: null, cost: undefined }, NOW).billing, 'unclear')
  const step = measureStep({}, null, { weekly: null, cost: 0.4 }, NOW)
  assert.equal(step.billing, 'payg')
  assert.equal(step.changed, true)
  assert.equal(step.record.max, 0.4)
})

test('a pay-per-token session records a higher cost, and nothing for a lower one or where the host keeps no ledger', () => {
  const step = measureStep({ billing: 'payg' }, REC, { weekly: null, cost: 15 }, NOW)
  assert.equal(step.changed, false)
  assert.equal(step.record.max, 15)
  assert.equal(measureStep({ billing: 'payg' }, REC, { weekly: null, cost: 9 }, NOW).record, null, 'a resumed session showing its old cost')
  assert.equal(measureStep({ billing: 'payg' }, REC, { weekly: null, cost: undefined }, NOW).record, null)
})

const atMark = { spentUsd: 3020, markUsd: 3000, atMark: true }
const under = { spentUsd: 2900, markUsd: 3000, atMark: false }

test('on pay-per-token billing the gate is written in dollars once the 7-day spend reaches the mark, to try again at 08:00', () => {
  const state = { status: 'running' }
  assert.deepEqual(gateFor(state, null, NOW, atMark),
    { reason: 'mark', unit: 'usd', markUsd: 3000, usedUsd: 3020, retryAt: TOMORROW_8, retried: false, at: NOW })
  assert.equal(gateFor(state, null, NOW, under), null)
  assert.equal(gateFor({ status: 'paused', pausedReason: 'human' }, null, NOW, atMark), null, 'the human paused it')
  assert.equal(gateFor({ status: 'finished' }, null, NOW, atMark), null)
  const early = Date.parse('2026-11-18T06:30:00Z')
  assert.equal(gateFor(state, null, early, atMark).retryAt, Date.parse('2026-11-18T08:00:00Z'), 'before 08:00 it is the same day')
})

test('a dollar gate is due once at its retryAt, and at once on a session settled as a subscription', () => {
  const gate = { unit: 'usd', retryAt: TOMORROW_8 }
  assert.equal(wakeDue(gate, TOMORROW_8 - 1, null, 'payg'), false)
  assert.equal(wakeDue(gate, TOMORROW_8, null, 'payg'), true)
  assert.equal(wakeDue(gate, TOMORROW_8 + 60000, TOMORROW_8, 'payg'), false, 'this try was made')
  assert.equal(wakeDue(gate, NOW, null, 'subscription'), true)
  assert.equal(wakeDue(gate, NOW, TOMORROW_8, 'subscription'), false)
})

test('the dollar wake names the mark in dollars and the commands to carry on; a subscription hears no dollars', () => {
  assert.match(usdWakePrompt('/p', 3000), /under your \$3,000 mark.*node "\/p\/scripts\/lcw\.mjs" resume.*status/)
  assert.doesNotMatch(usdWakePrompt('/p', null), /\$/)
})

// Each try sent at once and failing at once, as from 11:29: when the tries go out, in minutes after the first error.
function carrySends(kind = 'server_error') {
  const sent = []
  let carry = carryFailed(null, kind, NOW)
  for (let guard = 0; carry && guard < 50; guard++) {
    const step = carryDue(carry, carry.dueAt, false)
    sent.push((carry.dueAt - NOW) / MIN)
    carry = carryFailed(step.carry, kind, carry.dueAt)
  }
  return sent
}

test('a lost connection is tried again 1, 5 and 15 minutes after each failed try, then every 30, for 3 hours', () => {
  assert.deepEqual(carrySends(), [1, 6, 21, 51, 81, 111, 141, 171])
  assert.deepEqual(carrySends('overloaded'), [1, 6, 21, 51, 81, 111, 141, 171])
})

test('a try is due at its time, numbered, and not before', () => {
  const carry = carryFailed(null, 'server_error', NOW)
  assert.equal(carryDue(carry, NOW + MIN - 1, false).send, 0)
  const step = carryDue(carry, NOW + MIN, false)
  assert.equal(step.send, 1)
  assert.equal(carryDue(step.carry, NOW + 9 * MIN, false).send, 0)
})

test('a try that falls due while blocked counts, and the next one is 5 minutes later', () => {
  const step = carryDue(carryFailed(null, 'server_error', NOW), NOW + MIN, true)
  assert.equal(step.send, 0)
  assert.equal(step.carry.tries, 1)
  assert.equal(step.carry.dueAt, NOW + 6 * MIN)
})

test('a try that falls due more than 3 hours after the first error, after a sleep, is never sent', () => {
  const carry = { ...carryFailed(null, 'server_error', NOW), tries: 4 }
  assert.deepEqual(carryDue(carry, NOW + 181 * MIN, false), { carry: null, send: 0 })
})

test('an error that does not clear on its own, or of a kind not known, is never carried on, and ends a carry-on under way', () => {
  const under = carryFailed(null, 'server_error', NOW)
  for (const kind of ['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'verification_required', 'billing_error', 'rate_limit',
    'invalid_request', 'model_not_found', 'max_output_tokens', 'cloud_credential_error', 'unknown', 'teapot', undefined]) {
    assert.equal(carryFailed(null, kind, NOW), null, String(kind))
    assert.equal(carryFailed(under, kind, NOW), null, String(kind))
  }
})

test('the carry-on prompt says what went wrong, that the reply may have stopped part-way, to carry on, and which try it is', () => {
  assert.match(carryPrompt('server_error', 3), /connection was lost.*part-way.*Carry on from where it stopped.*try 3\b/)
  assert.match(carryPrompt('overloaded', 1), /overloaded.*try 1\b/)
})

test('a row with wide characters is laid out to the width in terminal cells', async () => {
  const { len } = await import('../../lib/format.mjs')
  const row = [{ t: '→ ' }, { t: '再試行ポリシーのテストを書く 🧪', id: 'view:a' }, { t: ' Sonnet' }, { t: '12m', r: true }]
  const { left, gap, right } = layout(row, 30)
  const wide = (spans) => len(spans.map((s) => s.t).join(''))
  assert.equal(wide(left) + gap + wide(right), 30)
  assert.match(left[1].t, /…$/)
})

test('an agent\'s wave is read from its brief: a --wave flag first, then the wave\'s worktree, the wave\'s records, the description, the opening words', () => {
  assert.equal(waveOfBrief('Work only in /repo/.claude/worktrees/tidy-wave-13.', 'Build the importer', 'tidy'), 13)
  const tools = 'Tests: /repo/.claude/worktrees/tidy-wave-6/.venv/bin/python -m pytest. When done: lcw task X7 done --wave 12.'
  assert.equal(waveOfBrief(tools, 'Fix the cards', 'tidy'), 12, 'another wave\'s folder named in passing is not the agent\'s wave')
  assert.equal(waveOfBrief('Mark it: lcw task X1 done --wave 7', 'Fix it', 'tidy'), 7)
  assert.equal(waveOfBrief('Read and follow /home/runs/r/waves/9/review-brief.md', 'Review R2', 'tidy'), 9)
  assert.equal(waveOfBrief('Read /home/runs/r/artifacts/wave12/common.md first', 'Fix it', 'tidy'), 12)
  assert.equal(waveOfBrief('Do as the brief says.', 'Deploy wave 8 to the server', 'tidy'), 8)
  assert.equal(waveOfBrief('Design reviewer D of wave 13, with no requirement.', 'Check the ratings', 'tidy'), 13)
  assert.equal(waveOfBrief('x'.repeat(200) + ' as wave 4 did', 'Check the ratings', 'tidy'), null, 'a wave named far into the brief is another wave\'s')
  assert.equal(waveOfBrief('Hunt the settings pages in /repo/.claude/worktrees/tidy-latest', 'Hunt settings', 'tidy'), null)
  assert.equal(waveOfBrief('Work in /repo/.claude/worktrees/other-wave-2', 'Build it', 'tidy'), null, 'another sweep\'s worktree')
  assert.equal(waveOfBrief(null, undefined, null), null)
})

test('an agent\'s brief is the first line of its transcript, as text or as blocks; a line cut short is given as it is', () => {
  const first = (content) => JSON.stringify({ parentUuid: null, agentId: 'a1', type: 'user', message: { role: 'user', content } })
  assert.equal(briefOf(first('Task X1 of wave 13. Work in /repo/.claude/worktrees/tidy-wave-13') + '\n{"type":"assistant"}\n'), 'Task X1 of wave 13. Work in /repo/.claude/worktrees/tidy-wave-13')
  assert.equal(briefOf(first([{ type: 'text', text: 'Read the brief' }, { type: 'text', text: 'then build' }])), 'Read the brief\nthen build')
  const cut = first('Work in /repo/.claude/worktrees/tidy-wave-7 and ' + 'x'.repeat(500)).slice(0, 200)
  assert.equal(waveOfBrief(briefOf(cut), 'Build it', 'tidy'), 7)
  assert.equal(briefOf(first(undefined)), '')
  assert.equal(briefOf(''), '')
  assert.equal(briefOf(null), '')
})
