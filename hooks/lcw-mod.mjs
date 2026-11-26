// The mod's pure decisions, kept apart from register.tsx so node --test can reach them.

import { gateExpired } from '../lib/usage.mjs'
import { MAX_AGE_MS } from '../lib/quota.mjs'
import { thresholds as TH } from '../lib/theme.mjs'
import { recordReading, next0800 } from '../lib/spend.mjs'
import { settle, replied } from '../lib/billing.mjs'
import { clip, dollars, len, tokens as tokenCount } from '../lib/format.mjs'

const LIVE = ['pending', 'running', 'waiting']
const TEN_MINUTES = 10 * 60 * 1000

/** Whether the card is drawn for this state: stopped never, finished for ten minutes. */
export function isShown(state, now) {
  if (!state || state.status === 'stopped') return false
  if (state.status !== 'finished') return true
  const at = state.finishedAt ?? state.updatedAt
  return typeof at === 'number' && now - at <= TEN_MINUTES
}

/**
 * How long a step of the card's motion lasts, in ms, for the card's mode (buildView's): 200 while a turn or an agent
 * works, 1000 while the run waits on the person or runs with nothing at work, 0 (it holds still) when paused or finished.
 */
export const cardPace = (mode, working) => (mode !== 'running' && mode !== 'with-you' ? 0 : working ? 200 : 1000)

/**
 * The card's motion at now, from the clock: the tick in 100 ms units, so a fade lasts as long at any pace, or at
 * a pace of a second the beat, its count of seconds. step is the step's number; a redraw is due when it changes.
 */
export function cardMotion(pace, since, now) {
  const step = Math.floor((now - since) / pace)
  return pace >= 1000 ? { step, beat: step } : { step, tick: step * pace / 100 }
}

/** 'light' when Claude Code's theme setting names a light theme, else 'dark'. */
export function themeFrom(configRows) {
  const row = (configRows ?? []).find((r) => r.key === 'theme')
  return /light/i.test(String(row?.value ?? '')) ? 'light' : 'dark'
}

export const SPARK_EVERY = 20_000
export const SPARK_CELLS = 8

/**
 * Normalises $.agent.list() for the card and tracks when each agent's tokens last moved.
 * An agent that is not running (waiting on a shell or a child, or pending), or that has a live agent of its own, is never quiet.
 * An agent is held when its turn has ended and it is still listed with no live agent of its own: background work it
 * started, such as a command that never ended, keeps it there. heldMs is how long that has lasted, and listedMs how
 * long the agent has been listed in one go.
 * seen: {id: {tokens, since, ...}} from the previous poll; the returned seen holds live agents only.
 * Each agent also keeps, for the card, the tokens it gained in each of its last eight 20-second spans (spark,
 * oldest first; replaying real agents' transcripts, shorter spans gave near-flat lines),
 * and the figure its tokens moved from and when, so the card can roll the number up to the new one.
 */
export function trackAgents(list, seen, now) {
  const agents = []
  const next = {}
  const parents = new Set((list ?? []).filter((a) => LIVE.includes(a.status) && a.parentId).map((a) => a.parentId))
  for (const a of list ?? []) {
    if (!LIVE.includes(a.status)) continue
    const tokens = agentTokens(a)
    const prev = seen?.[a.id]
    const since = !prev || prev.tokens !== tokens || a.status !== 'running' || parents.has(a.id) ? now : prev.since
    const moved = !!prev && prev.tokens !== tokens
    let spark = prev?.spark ?? [], from = prev?.from ?? now, base = prev?.base ?? tokens
    // A span is closed with what was gained in it; spans the mod missed (it was not polling) count as empty.
    for (let k = 0; now - from >= SPARK_EVERY && k < SPARK_CELLS; k++) {
      spark = [...spark, Math.max(0, tokens - base)].slice(-SPARK_CELLS)
      base = tokens
      from += SPARK_EVERY
    }
    if (now - from >= SPARK_EVERY) from = now
    const was = moved ? prev.tokens : prev?.was ?? tokens
    const movedAt = moved ? now : prev?.movedAt ?? null
    const held = a.taskStatus === 'completed' && !parents.has(a.id)
    const heldSince = held ? prev?.heldSince ?? now : null
    const listed = prev?.listed ?? now
    next[a.id] = { tokens, since, spark, from, base, was, movedAt, heldSince, listed }
    agents.push({
      id: a.id,
      description: a.description ?? '',
      model: a.model ?? a.lastRequest?.model ?? '',
      effort: String(a.effort ?? a.lastRequest?.effort ?? ''),
      tokens,
      startTime: a.startTime ?? now,
      parentId: a.parentId,
      status: a.status,
      quietMs: now - since,
      held,
      heldMs: held ? now - heldSince : 0,
      listedMs: now - listed,
      hasChild: parents.has(a.id),
      spark,
      tokensWas: was,
      movedAt,
    })
  }
  return { agents, seen: next }
}

/**
 * How many agents the card would mark as quiet and as stalled: running, with tokens that have not moved for
 * five minutes and for fifteen, or held for fifteen. The mascot beside the status rows reads this count.
 */
export function quietCounts(agents, quietMs = TH.agentQuietAfterMinutes * 6e4, stalledMs = TH.agentStalledAfterMinutes * 6e4) {
  let quiet = 0, stalled = 0
  for (const a of agents ?? []) {
    if (a.quietMs >= stalledMs || a.heldMs >= stalledMs) stalled++
    else if (a.quietMs >= quietMs) quiet++
  }
  return { quiet, stalled }
}

/** Whether stalled agents are reported to the orchestrator for this run: not once it is finished, stopped or paused. */
export const nudgeable = (state) => !!state && !['finished', 'stopped', 'paused'].includes(state.status)

/**
 * Which stalled agents the orchestrator is told about now. An agent is stalled when it is running and its
 * tokens have not moved for stalledMs (the card's own threshold), or when it has been held that long. It is named
 * when it gets there, then again every againMs while it stays there, three times in all: by then the orchestrator
 * has been told enough. why says which: 'still' or 'held'.
 * nudged: {id: {at, times, tokens}} from the previous poll; the returned one holds only agents still listed whose
 * tokens have not moved since, so a record outlives a restart of the agents' clocks (a reload of the mod).
 */
export function stallNudges(agents, nudged, now, stalledMs = TH.agentStalledAfterMinutes * 6e4, againMs = TH.agentQuietAfterMinutes * 6e4) {
  const due = []
  const next = {}
  for (const a of agents ?? []) {
    const why = a.quietMs >= stalledMs ? 'still' : a.heldMs >= stalledMs ? 'held' : null
    const last = nudged?.[a.id]?.tokens === a.tokens ? nudged[a.id] : undefined
    if (!why) { if (last) next[a.id] = last; continue }
    if (!last) { next[a.id] = { at: now, times: 1, tokens: a.tokens }; due.push({ ...a, times: 1, why }) }
    else if (last.times < 3 && now - last.at >= againMs) { next[a.id] = { at: now, times: last.times + 1, tokens: a.tokens }; due.push({ ...a, times: last.times + 1, why }) }
    else next[a.id] = last
  }
  return { due, nudged: next }
}

/**
 * Which agents the orchestrator is asked to look in on now: listed for longMs in one go and still at work, so not
 * held, not stalled and not waiting on an agent of its own. Each is named once, with why 'long'.
 * told: {id: 1} from the previous poll; the returned one holds only agents that are still listed.
 */
export function longNudges(agents, told, longMs = TH.agentLongAfterMinutes * 6e4, stalledMs = TH.agentStalledAfterMinutes * 6e4) {
  const due = []
  const next = {}
  for (const a of agents ?? []) {
    if (told?.[a.id]) next[a.id] = 1
    else if (a.listedMs >= longMs && !a.held && !a.hasChild && !(a.quietMs >= stalledMs)) { next[a.id] = 1; due.push({ ...a, why: 'long' }) }
  }
  return { due, told: next }
}

/**
 * The prompt that tells the orchestrator about the agents due, a paragraph for each kind: stalled, held after
 * their report, long at work. Each says what to do, since the session's skill text may be older than this.
 * all is every live agent, to name a parent.
 */
export function stallPrompt(due, all) {
  const name = (a) => {
    const parent = (all ?? []).find((p) => p.id === a.parentId)
    return `"${a.description || 'an agent'}" (${a.model || 'model unknown'}, id ${a.id}${parent ? `, launched by "${parent.description}", id ${parent.id}` : ''})`
  }
  const mins = (ms) => Math.floor(ms / 6e4)
  const again = (a) => (a.times > 1 ? ', and this is the ' + (a.times === 2 ? 'second' : 'third and last') + ' time you are told' : '')
  const kinds = [
    ['still', (a) => `${name(a)} has not moved for ${mins(a.quietMs)} minutes${again(a)}`, 'agents have stalled',
      // The notice waits for a turn to end, and the agent may have moved on by the time it is read.
      (n) => `If ${n === 1 ? 'it is' : 'they are'} still stalled, do not keep waiting. Act now as the lcw skill says under "When an agent stalls": ask it once what it is doing; if it has already been asked, or is going round in circles, stop it and give its work to a fresh agent.`],
    ['held', (a) => `${name(a)} gave its report ${mins(a.heldMs)} minutes ago and has not ended${again(a)}`, 'agents have reported and not ended',
      'Such an agent ended its turn with background work of its own still running, such as a command that never ended, and until that work ends it stays on LCW\'s card, though ListAgents may call it completed. Do not message it: a message would start it working again. If its report was complete, stop it now, TaskStop with its id, which ends that work too: its turn has ended, and it still needs this stop. If its report said it was waiting for that work, leave it: it will report again.'],
    ['long', (a) => `${name(a)} has been at work for ${mins(a.listedMs)} minutes and has used ${tokenCount(a.tokens)} tokens`, 'agents have been at work for a long time',
      'This is a check, not a fault: long work may be going well, and then it carries on. See whether it is getting somewhere from what it has produced so far, such as its commits and the files it has changed, without interrupting it. If it is, do nothing. Only if you cannot tell, ask it once where it has got to, SendMessage to its id, and tell it to carry on after it answers. If it is going round in circles, stop it, TaskStop with its id, and give its work to a fresh agent with what you learned. You are told this once.'],
  ]
  return kinds.flatMap(([why, one, many, act]) => {
    const of = due.filter((a) => (a.why ?? 'still') === why)
    if (!of.length) return []
    return [`LCW: ${of.length === 1 ? `the agent ${one(of[0])}` : `${of.length} ${many}: ${of.map(one).join('; ')}`}. ${typeof act === 'function' ? act(of.length) : act}`]
  }).join('\n\n')
}

// A wave in one of these stages has work to hand out; one in Ship holds for its turn.
const SIT_STAGES = ['Plan', 'Build', 'Review']

// What moves when a task ends or a wave gets further: what a sitting wave waits for may have happened once this has.
const sweepMark = (state) => (state?.sweep?.waves ?? [])
  .map((w) => [w.n, w.status, w.stage ?? '', w.step ?? '', w.round ?? 0, (w.tasks ?? []).filter((t) => t.status === 'done').length].join(':')).join(' ')

/**
 * Which of a sweep's waves the orchestrator is asked about now. A wave sits when it is being planned, built or
 * reviewed, does not wait on the person, and no agent has been at work for it for sitMs (a held agent is not at work);
 * the front queued wave sits once it has been queued that long. A wave is named when it gets there. While it goes on
 * sitting it is named again only once a task has ended or a wave has moved since, and no sooner than againMs after;
 * such repeats share one clock, so one notice in againMs carries them all. No two notices come within apartMs, so
 * waves that come to sit close together are asked about together.
 * agents: the live agents, each with the wave it works for where that is known.
 * sat: {run, waves: {n: {since, queued, told, mark}}, last, again} from the previous poll; the returned one holds only
 * the waves still sitting, so a wave that gets an agent starts over.
 */
export function sittingWaves(state, agents, sat, now, sitMs = TH.waveSitsAfterMinutes * 6e4, againMs = TH.waveAskedAgainAfterMinutes * 6e4, apartMs = TH.waveNoticesApartMinutes * 6e4) {
  const waves = state?.sweep?.waves ?? []
  const before = sat?.run === state?.id ? sat : {}
  const mark = sweepMark(state)
  const busy = new Set((agents ?? []).filter((a) => !a.held && a.wave != null).map((a) => a.wave))
  const front = waves.find((w) => w.status === 'queued')
  const next = {}
  const sitting = []
  for (const w of waves) {
    const queued = w === front
    if (busy.has(w.n) || !(queued || (w.status === 'running' && SIT_STAGES.includes(w.stage) && !w.waiting))) continue
    const was = before.waves?.[w.n]
    const rec = was && !!was.queued === queued ? was : { since: now, queued }
    next[w.n] = rec
    if (now - rec.since >= sitMs) sitting.push({ n: w.n, queued, stage: w.stage ?? '', waits: typeof w.waits === 'string' ? w.waits : '', ms: now - rec.since, rec })
  }
  const first = sitting.filter((x) => x.rec.told == null)
  const again = now - (before.again ?? -Infinity) >= againMs ? sitting.filter((x) => x.rec.told != null && x.rec.mark !== mark && now - x.rec.told >= againMs) : []
  const due = now - (before.last ?? -Infinity) >= apartMs ? [...first, ...again] : []
  for (const x of due) next[x.n] = { ...x.rec, told: now, mark }
  return {
    due: due.map(({ rec, ...x }) => ({ ...x, again: rec.told != null })),
    sat: { run: state?.id, waves: next, last: due.length ? now : before.last, again: due.some((x) => x.rec.told != null) ? now : before.again },
  }
}

/**
 * The prompt that asks the orchestrator about the waves due. It says what to do and how to record a reason, since
 * the session's skill text may be older than this. unplaced: agents at work whose wave could not be read.
 */
export function sittingPrompt(due, unplaced = 0) {
  const mins = (ms) => Math.floor(ms / 6e4)
  const list = (items) => (items.length > 1 ? items.slice(0, -1).join(', ') + ' and ' + items.at(-1) : items[0])
  const open = due.filter((x) => !x.queued), queued = due.filter((x) => x.queued)
  const one = (x) => `wave ${x.n} (in ${x.stage}, ${mins(x.ms)} minutes${x.again ? ', as when you were last asked' : ''}${x.waits ? `; you recorded "${x.waits}", so see whether that still holds` : ''})`
  return [
    'LCW: work is sitting in this sweep.',
    open.length && `No agent is at work for ${list(open.map(one))}. Look at what each is waiting for and whether that has happened, and start now whatever can run, beside the work already running: the person should never have to ask why a wave has no agent. Where a wave cannot move yet, record why in a few words the person would understand, lcw set waits="<why>" --wave <n>: the card shows it under that wave, and you are asked about the wave again only once a task has ended or a wave has moved.`,
    ...queued.map((x) => `Wave ${x.n} has been queued for ${mins(x.ms)} minutes: see whether it can start now, as stages/plan.md says under "In a sweep".`),
    unplaced > 0 && `${unplaced === 1 ? 'One agent is' : unplaced + ' agents are'} at work whose wave LCW could not read; ${unplaced === 1 ? 'it' : 'one of them'} may be working for a wave named here.`,
  ].filter(Boolean).join(' ')
}

// The API errors that clear on their own; a lost connection is a server_error. Every other kind, and one not known, is left alone.
const CARRY_KINDS = ['server_error', 'overloaded']
const CARRY_WAITS = [1, 5, 15, 30].map((m) => m * 6e4)
const CARRY_FOR = 3 * 60 * 6e4

/**
 * The main session's turn ended on an API error of this kind: the carry-on with its next try due, waiting 1, 5, 15,
 * then 30 minutes after each try made so far. Null for a kind that does not clear on its own, and once the next try
 * would fall more than 3 hours after the first error. carry: {firstAt, kind, tries, dueAt} from before, or null.
 */
export function carryFailed(carry, kind, now) {
  if (!CARRY_KINDS.includes(kind)) return null
  const c = { firstAt: now, tries: 0, ...carry, kind }
  const dueAt = now + CARRY_WAITS[Math.min(c.tries, CARRY_WAITS.length - 1)]
  return dueAt - c.firstAt > CARRY_FOR ? null : { ...c, dueAt }
}

/**
 * What a carry-on does now. A try that has fallen due counts, sent or not: it is sent unless blocked (something typed,
 * a turn running, a run the person paused), else skipped with the next one scheduled. send is the try's number, or 0.
 */
export function carryDue(carry, now, blocked) {
  if (!carry || carry.dueAt == null || now < carry.dueAt) return { carry, send: 0 }
  if (now - carry.firstAt > CARRY_FOR) return { carry: null, send: 0 }
  const tries = carry.tries + 1
  if (blocked) return { carry: carryFailed({ ...carry, tries }, carry.kind, now), send: 0 }
  return { carry: { ...carry, tries, dueAt: null }, send: tries }
}

/** The prompt that carries the session on after an API error; Claude Code shows it as a message from the plugin. */
export function carryPrompt(kind, tries) {
  const what = kind === 'overloaded' ? 'the API was overloaded' : 'the API connection was lost, or the API had a server error'
  return `LCW: your last turn ended because ${what}, so your last reply may have stopped part-way. Carry on from where it stopped. This is LCW's try ${tries} to carry the session on by itself.`
}

/**
 * A row's spans with neighbouring spans of one button gathered: [{id, spans}] or [{spans}]. The buttons have no
 * hotkey, so Claude Code draws no "N: " before them: a click opens them.
 */
export function buttons(row) {
  const out = []
  for (const s of row) {
    const last = out[out.length - 1]
    if (s.id && last?.id === s.id) last.spans.push(s)
    else out.push(s.id ? { id: s.id, spans: [s] } : { spans: [s] })
  }
  return out
}

const cells = (spans) => len(spans.map((s) => String(s.t ?? '')).join(''))

/**
 * Splits a row as lib/paint.mjs does: the span with r: true starts the group pushed to the right
 * edge. Where the row is too wide for a gap of two, the agent's description gives up its padding, then its end.
 */
export function layout(row, cols) {
  const i = row.findIndex((s) => s.r)
  let left = i < 0 ? row : row.slice(0, i)
  const right = i < 0 ? [] : row.slice(i)
  if (!right.length) return { left, gap: 0, right }
  const short = cells(left) + cells(right) + 2 - cols
  const d = left.findLastIndex((s) => /^view:/.test(s.id ?? ''))
  if (short > 0 && d >= 0) {
    const t = String(left[d].t ?? '')
    const pad = t.length - t.trimEnd().length
    const shorter = short <= pad ? t.slice(0, t.length - short) : clip(t, Math.max(1, len(t) - short))
    left = left.map((s, j) => (j === d ? { ...s, t: shorter } : s))
  }
  return { left, gap: Math.max(2, cols - cells(left) - cells(right)), right }
}

/** All the tokens one request or turn used, as Claude Code counts them for /cost: new input, cache, output. */
export const usageTokens = (u) =>
  (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0)

/** What an agent has used so far: its own requests, summed. Before its first is counted, what it holds. */
export const agentTokens = (a) => (a?.usage?.length ? a.usage.reduce((sum, u) => sum + usageTokens(u), 0) : a?.tokenCount ?? 0)

const withTokens = (t) => ({ ...t, tokens: (t.used?.main ?? 0) + (t.used?.agents ?? 0) })

/**
 * The run's totals.json from one $.agent.list(): how many agents it started (seen keeps their ids, so an agent
 * still listed after a reload is not counted twice). The tokens come from the turns counted by addUsage.
 */
export function addTotals(totals, list, since = 0) {
  const seen = { ...totals?.seen }
  for (const a of list ?? []) {
    if (a?.id && !(a.startTime < since)) seen[a.id] = 1
  }
  return withTokens({ ...totals, agents: Object.keys(seen).length, seen })
}

/** A finished turn's tokens added to the run's totals: the main session's or, with an agent id, an agent's. */
export function addUsage(totals, usage, byAgent) {
  const used = { main: totals?.used?.main ?? 0, agents: totals?.used?.agents ?? 0 }
  used[byAgent ? 'agents' : 'main'] += usageTokens(usage)
  return withTokens({ agents: 0, seen: {}, ...totals, used })
}

/** Whether a turn that began at this time belongs to the run: one still going, or the turn that finished it. */
export function countsTurn(state, turnStartedAt) {
  if (!state || state.status === 'stopped') return false
  return state.status !== 'finished' || (state.finishedAt ?? 0) >= turnStartedAt
}

/**
 * The gate to write when this reading puts an unfinished run at its mark, else null. With money (the session is
 * billed per token) the reading is the machine's 7-day spend against the session's mark in dollars, and the run
 * tries again at the next 08:00.
 */
export function gateFor(state, sevenDay, now, money) {
  if (!state || state.status === 'finished' || state.status === 'stopped') return null
  if (state.status === 'paused' && state.pausedReason === 'human') return null
  if (money) {
    if (!money.atMark) return null
    return { reason: 'mark', unit: 'usd', markUsd: money.markUsd, usedUsd: money.spentUsd, retryAt: next0800(now), retried: false, at: now }
  }
  if (!sevenDay) return null
  const mark = state.markPercent ?? TH.usageMarkPercent
  if (!(sevenDay.percentUsed >= mark)) return null
  const reset = Date.parse(sevenDay.resetsAt ?? '')
  if (reset <= now) return null
  return { reason: 'mark', markPercent: mark, usedPercent: sevenDay.percentUsed, resetsAt: sevenDay.resetsAt ?? null, at: now }
}

export function gateIdentity(gate) {
  return gate?.unit === 'quota'
    ? JSON.stringify([gate.holdId, gate.sourceId, gate.revision, gate.requestId, gate.accountKey, gate.resetsAt, gate.at])
    : JSON.stringify([gate?.unit ?? 'percent', gate?.resetsAt, gate?.retryAt, gate?.markPercent, gate?.markUsd, gate?.at])
}

/** A recovery must carry a new allowable observation, not just an elapsed reset. */
export function quotaWakeEvidence(gate, quota, now) {
  if (!gate || !quota || (gate.unit === 'quota' && quota.sourceId !== gate.sourceId) || quota.status !== 'ok' || quota.hold || quota.blocked) return null
  if (!quota.revision || !quota.requestId || !quota.accountKey || !(Date.parse(quota.resetsAt) > now)) return null
  if (!Number.isFinite(quota.observedAt) || quota.observedAt > now || now - quota.observedAt >= MAX_AGE_MS) return null
  if (quota.revision === gate.revision && quota.requestId === gate.requestId) return null
  return {
    gate: gateIdentity(gate),
    evidence: JSON.stringify([quota.sourceId, quota.revision, quota.accountKey, quota.resetsAt, quota.requestId, quota.observedAt]),
  }
}

/** Whether a native usage gate can gain a known reset; dollar and external gates keep their own evidence. */
export function replacesGate(current, next) {
  if (!next) return false
  if (!current) return true
  const known = (g) => Number.isFinite(Date.parse(g?.resetsAt ?? ''))
  return !['usd', 'quota'].includes(current.unit) && !['usd', 'quota'].includes(next.unit) && !known(current) && known(next)
}

/**
 * True once a gate's reset time has passed and this reset has not been handled yet. A dollar gate is due at its
 * retryAt, and at once in a session settled as a subscription, where a dollar mark never holds.
 */
export function wakeDue(gate, now, wokeFor, billing, quota) {
  if (gate?.unit === 'quota') {
    const proof = quotaWakeEvidence(gate, quota, now)
    return !!proof && proof.gate !== wokeFor
  }
  if (quota) return false
  if (gate?.unit === 'usd') return gate.retryAt !== wokeFor && (billing === 'subscription' || gate.retryAt <= now)
  return !!gate && gate.resetsAt !== wokeFor && gateExpired(gate, now)
}

/**
 * Whether the reset may wake this run: only one running or paused at its mark. Pausing, resuming and
 * stopping are the human's, so any other run has its expired gate removed without a prompt.
 */
export const wakeable = (state) =>
  state?.status === 'running' || (state?.status === 'paused' && state.pausedReason === 'mark')

/**
 * Whether a session that has just started should carry on its run by itself: the run is running,
 * no gate exists (one that holds keeps it waiting, an expired one is the wake's), and no mod has
 * drawn it in the last 15 s. A fresh mod-alive means a plugin reload, not a reopened session.
 */
export function reopenDue(state, gate, aliveAt, now) {
  if (state?.status !== 'running' || gate) return false
  return !(now - aliveAt < 15000)
}

/**
 * The wave of a sweep an agent works for, read from its brief, or null. A brief gives its lcw commands --wave <n>, names
 * its wave's worktree (<name>-wave-<n>), or points at the wave's records (waves/<n>/, wave<n>/); failing those, the
 * description or the brief's opening words may say "wave <n>". The flag comes first: a brief also names another wave's
 * worktree in passing, such as a folder of tools kept there. name is the sweep's.
 */
export function waveOfBrief(prompt, description, name) {
  const brief = String(prompt ?? '')
  const tree = name ? new RegExp(String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-wave-(\\d+)') : null
  const found = /--wave[ =](\d+)/.exec(brief) ?? (tree && tree.exec(brief)) ?? /\/waves\/(\d+)\//.exec(brief) ?? /\/wave-?(\d+)\//.exec(brief)
    ?? /\bwave (\d+)\b/i.exec(String(description ?? '')) ?? /\bwave (\d+)\b/i.exec(brief.slice(0, 160))
  return found ? Number(found[1]) : null
}

/** Whether a brief names the worktree of a hunt round's latest work, <name>-latest: the brief of a hunt probe. */
export function isHuntBrief(prompt, name) {
  return !!name && new RegExp('\\.claude/worktrees/' + String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-latest\\b').test(String(prompt ?? ''))
}

/**
 * An agent's brief, from the start of its transcript, whose first line is the message that started it. Where that line
 * is longer than what was read it cannot be parsed, and its text is given as it is: the wave's worktree is still in it.
 */
export function briefOf(head) {
  const line = String(head ?? '').split('\n', 1)[0]
  try {
    const content = JSON.parse(line)?.message?.content
    return typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => b?.text ?? '').join('\n') : ''
  } catch {
    return line
  }
}

/**
 * usage.json from a session.measure reading; null when it has no weekly figure. seen is when the session last spoke (its
 * transcript's time), left out when not known: the event also fires as the five-hour window moves in an idle session,
 * whose weekly figure is then as old as its last reply.
 */
export function usageFrom(rateLimits, now, seen) {
  const r = (rateLimits ?? []).find((x) => x.kind === 'seven_day')
  return r ? { at: now, ...(Number.isFinite(seen) && seen > 0 ? { seen } : {}), sevenDay: { percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null }, source: 'mod' } : null
}

export function quotaBilling(session, quota) {
  return quota ? 'subscription' : session?.quotaSelection ? session.quotaDefaultBilling ?? 'unclear' : session?.billing ?? 'unclear'
}

/**
 * What one session.measure reading does to the session's billing and its spend record. A weekly figure settles a
 * subscription, whose spend is dropped; a reply (a cost above 0, or above the first reading after a resume) without
 * one settles an unclear session as pay-per-token. Spend is recorded unless the session is a subscription; cost is undefined where the host keeps
 * no ledger, and then nothing is recorded. rec is the stored record, null when there is none (undefined when it
 * could not be read). record is the record to write, or null when nothing changed.
 */
export function measureStep(session, rec, { weekly, cost, quota }, now) {
  const was = session?.billing ?? 'unclear'
  const billing = quota ? 'subscription' : settle(quotaBilling(session, quota), { weekly, replied: replied(session?.billing, rec, cost) })
  const changed = billing !== was
  if (billing === 'subscription') return { billing, changed, record: null, drop: rec !== null }
  const next = recordReading(rec, cost, now)
  return { billing, changed, record: next && next !== rec ? next : null, drop: false }
}

const cli = (root) => `node "${root}/scripts/lcw.mjs"`

export function compactInstructions(state, runDir, step) {
  return `Keep these exactly: the LCW run id ${state?.id ?? ''}, the run folder ${runDir}, and the next step: ${step}`
}

export function resumePrompt(root, step) {
  return `LCW checkpoint: the context was compacted. Run \`${cli(root)} status\`, then carry on with the next step: ${step}`
}

export function wakePrompt(root) {
  return `LCW: the weekly usage limit has reset. Run \`${cli(root)} resume\`, then \`${cli(root)} status\`, and carry on from the ledger.`
}

/** The wake at a dollar gate; markUsd null when the session turned out to be a subscription. */
export function usdWakePrompt(root, markUsd) {
  const why = markUsd == null ? 'this session is billed by subscription, so the pause at the mark is lifted' : `the 7-day spend is back under your ${dollars(markUsd)} mark`
  return `LCW: ${why}. Run \`${cli(root)} resume\`, then \`${cli(root)} status\`, and carry on from the ledger.`
}

export function completionPrompt(root) {
  return `LCW: this build is idle in Ship with no active agents or unfinished tasks recorded. Assess the remaining agreed work, including outstanding requirements and post-merge verification or setup. Only if that work is actually complete, use the supported \`${cli(root)} finish\` command with the appropriate PR or branch details. Otherwise record what remains in the requirements and ledger, and carry on where allowed or ask the person if blocked. This is an assessment, not an instruction to finish blindly.`
}

export function reopenPrompt(root) {
  return `LCW: this session was reopened with an unfinished LCW run. Load the lcw:lcw skill with the Skill tool, run \`${cli(root)} status\`, and carry on.`
}
