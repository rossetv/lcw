process.env.TZ = 'Europe/Dublin' // the 08:00 a dollar gate tries again at is local time
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addTotals, addUsage, agentTokens, buttons, countsTurn, compactInstructions, gateFor, isShown, layout, reopenDue, reopenPrompt, resumePrompt,
  quietCounts, stallNudges, stallPrompt, themeFrom, trackAgents, usageFrom, wakeDue, wakePrompt,
  measureStep, retryGate, usdWakePrompt,
} from '../../hooks/lcw-mod.mjs'
import { buildView, renderCard } from '../../lib/card.mjs'
import { inputsOf } from '../render/boards.mjs'

const MIN = 60 * 1000
const NOW = Date.parse('2026-11-18T12:00:00Z')

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
  r = stallNudges([stalling('a', 0)], r.nudged, NOW + MIN)
  assert.deepEqual(r.nudged, {})
  r = stallNudges([stalling('a', 15)], r.nudged, NOW + 16 * MIN)
  assert.deepEqual(r.due.map((a) => a.times), [1])
  assert.deepEqual(stallNudges([], r.nudged, NOW + 17 * MIN).nudged, {})
})

test('an agent that only waits on a shell or a child is never reported', () => {
  const list = [{ id: 'w', description: 'x', status: 'waiting', tokenCount: 5 }]
  const t1 = trackAgents(list, {}, NOW)
  const t2 = trackAgents(list, t1.seen, NOW + 40 * MIN)
  assert.deepEqual(stallNudges(t2.agents, {}, NOW + 40 * MIN).due, [])
})

test('the stall prompt names the agent, how long, who launched it, and where to read what to do', () => {
  const orch = stalling('o1', 0, { description: 'Drive the API milestone' })
  const one = stallPrompt([{ ...stalling('w1', 16, { parentId: 'o1' }), times: 1 }], [orch])
  for (const fact of ['Build the w1', 'id w1', 'Drive the API milestone', 'id o1', '16 minutes', 'When an agent stalls']) assert.ok(one.includes(fact), fact)
  const two = stallPrompt([{ ...stalling('w1', 21), times: 2 }, { ...stalling('w2', 15), times: 1 }], [])
  for (const fact of ['2 agents', 'Build the w1', '21 minutes', 'second time', 'Build the w2', '15 minutes']) assert.ok(two.includes(fact), fact)
})

test('agents are counted quiet after five still minutes and stalled after fifteen, as the card marks them', () => {
  const agents = [4, 5, 14, 15, 40].map((minutes, i) => ({ id: 'a' + i, quietMs: minutes * MIN }))
  assert.deepEqual(quietCounts(agents), { quiet: 2, stalled: 2 })
  assert.deepEqual(quietCounts([]), { quiet: 0, stalled: 0 })
  assert.deepEqual(quietCounts(undefined), { quiet: 0, stalled: 0 })
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

test('at 08:00 a run still at its dollar mark tries again the following morning; under the mark, or off pay-per-token, it goes on', () => {
  const gate = { reason: 'mark', unit: 'usd', markUsd: 3000, usedUsd: 3020, retryAt: TOMORROW_8, retried: false, at: NOW }
  assert.deepEqual(retryGate(gate, atMark, TOMORROW_8), { ...gate, retryAt: Date.parse('2026-11-20T08:00:00Z'), retried: true })
  assert.equal(retryGate(gate, under, TOMORROW_8), null)
  assert.equal(retryGate(gate, null, TOMORROW_8), null)
})

test('the dollar wake names the mark in dollars and the commands to carry on; a subscription hears no dollars', () => {
  assert.match(usdWakePrompt('/p', 3000), /under your \$3,000 mark.*node "\/p\/scripts\/lcw\.mjs" resume.*status/)
  assert.doesNotMatch(usdWakePrompt('/p', null), /\$/)
})
