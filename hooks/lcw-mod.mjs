// The mod's pure decisions, kept apart from register.tsx so node --test can reach them.

import { gateExpired } from '../lib/usage.mjs'
import { thresholds as TH } from '../lib/theme.mjs'
import { recordReading, next0800 } from '../lib/spend.mjs'
import { settle } from '../lib/billing.mjs'
import { dollars } from '../lib/format.mjs'

const LIVE = ['pending', 'running', 'waiting']
const TEN_MINUTES = 10 * 60 * 1000

/** Whether the card is drawn for this state: stopped never, finished for ten minutes. */
export function isShown(state, now) {
  if (!state || state.status === 'stopped') return false
  if (state.status !== 'finished') return true
  const at = state.finishedAt ?? state.updatedAt
  return typeof at === 'number' && now - at <= TEN_MINUTES
}

/** Only a finished card holds still; every other state has a heartbeat. */
export const isAnimating = (state) => state.status !== 'finished'

/** 'light' when Claude Code's theme setting names a light theme, else 'dark'. */
export function themeFrom(configRows) {
  const row = (configRows ?? []).find((r) => r.key === 'theme')
  return /light/i.test(String(row?.value ?? '')) ? 'light' : 'dark'
}

export const SPARK_EVERY = 20_000
export const SPARK_CELLS = 8

/**
 * Normalises $.agent.list() for the card and tracks when each agent's tokens last moved.
 * An agent that is not running (waiting on a shell or a child, or pending) is never quiet.
 * seen: {id: {tokens, since, ...}} from the previous poll; the returned seen holds live agents only.
 * Each agent also keeps, for the card, the tokens it gained in each of its last eight 20-second spans (spark,
 * oldest first; replaying real agents' transcripts, shorter spans gave near-flat lines),
 * and the figure its tokens moved from and when, so the card can roll the number up to the new one.
 */
export function trackAgents(list, seen, now) {
  const agents = []
  const next = {}
  for (const a of list ?? []) {
    if (!LIVE.includes(a.status)) continue
    const tokens = agentTokens(a)
    const prev = seen?.[a.id]
    const since = !prev || prev.tokens !== tokens || a.status !== 'running' ? now : prev.since
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
    next[a.id] = { tokens, since, spark, from, base, was, movedAt }
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
      spark,
      tokensWas: was,
      movedAt,
    })
  }
  return { agents, seen: next }
}

/**
 * How many agents the card would mark as quiet and as stalled: running, with tokens that have not moved for
 * five minutes and for fifteen. The mascot beside the status rows reads this count.
 */
export function quietCounts(agents, quietMs = TH.agentQuietAfterMinutes * 6e4, stalledMs = TH.agentStalledAfterMinutes * 6e4) {
  let quiet = 0, stalled = 0
  for (const a of agents ?? []) {
    if (a.quietMs >= stalledMs) stalled++
    else if (a.quietMs >= quietMs) quiet++
  }
  return { quiet, stalled }
}

/** Whether stalled agents are reported to the orchestrator for this run: not once it is finished, stopped or paused. */
export const nudgeable = (state) => !!state && !['finished', 'stopped', 'paused'].includes(state.status)

/**
 * Which stalled agents the orchestrator is told about now. An agent is stalled when it is running and its
 * tokens have not moved for stalledMs (the card's own threshold). It is named when it gets there, then again
 * every againMs while it stays there, three times in all: by then the orchestrator has been told enough.
 * nudged: {id: {at, times}} from the previous poll; the returned one holds only agents that are still stalled.
 */
export function stallNudges(agents, nudged, now, stalledMs = TH.agentStalledAfterMinutes * 6e4, againMs = TH.agentQuietAfterMinutes * 6e4) {
  const due = []
  const next = {}
  for (const a of agents ?? []) {
    if (!(a.quietMs >= stalledMs)) continue
    const last = nudged?.[a.id]
    if (!last) { next[a.id] = { at: now, times: 1 }; due.push({ ...a, times: 1 }) }
    else if (last.times < 3 && now - last.at >= againMs) { next[a.id] = { at: now, times: last.times + 1 }; due.push({ ...a, times: last.times + 1 }) }
    else next[a.id] = last
  }
  return { due, nudged: next }
}

/** The prompt that tells the orchestrator which agents have stalled; all is every live agent, to name a parent. */
export function stallPrompt(due, all) {
  const one = (a) => {
    const parent = (all ?? []).find((p) => p.id === a.parentId)
    const mins = Math.floor(a.quietMs / 6e4)
    return `"${a.description || 'an agent'}" (${a.model || 'model unknown'}, id ${a.id}${parent ? `, launched by "${parent.description}", id ${parent.id}` : ''}) has not moved for ${mins} minutes${a.times > 1 ? ', and this is the ' + (a.times === 2 ? 'second' : 'third and last') + ' time you are told' : ''}`
  }
  const what = due.length === 1 ? `the agent ${one(due[0])}` : `${due.length} agents have stalled: ${due.map(one).join('; ')}`
  return `LCW: ${what}. Do not keep waiting. Act now as the lcw skill says under "When an agent stalls": ask it once what it is doing; if it has already been asked, or is going round in circles, stop it and give its work to a fresh agent.`
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

const cells = (spans) => [...spans.map((s) => String(s.t ?? '')).join('')].length

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
    const t = [...String(left[d].t ?? '')]
    const pad = t.length - t.join('').trimEnd().length
    const keep = t.length - short
    const shorter = short <= pad ? t.slice(0, keep).join('') : t.slice(0, Math.max(0, keep - 1)).join('') + '…'
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

/**
 * True once a gate's reset time has passed and this reset has not been handled yet. A dollar gate is due at its
 * retryAt, and at once in a session settled as a subscription, where a dollar mark never holds.
 */
export function wakeDue(gate, now, wokeFor, billing) {
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

/** usage.json from a session.measure reading; null when it has no weekly figure. */
export function usageFrom(rateLimits, now) {
  const r = (rateLimits ?? []).find((x) => x.kind === 'seven_day')
  return r ? { at: now, sevenDay: { percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null }, source: 'mod' } : null
}

/**
 * The morning try at a dollar gate: null when the run may go on (the 7-day spend is under the mark, or money is
 * null because the session is no longer billed per token), else the gate moved on to the following 08:00.
 */
export function retryGate(gate, money, now) {
  if (!money?.atMark) return null
  return { ...gate, retryAt: next0800(now), retried: true }
}

/**
 * What one session.measure reading does to the session's billing and its spend record. A weekly figure settles a
 * subscription, whose spend is dropped; a reply (a cost above 0) without one settles an unclear session as
 * pay-per-token. Spend is recorded unless the session is a subscription; cost is undefined where the host keeps
 * no ledger, and then nothing is recorded. rec is the stored record, null when there is none (undefined when it
 * could not be read). record is the record to write, or null when nothing changed.
 */
export function measureStep(session, rec, { weekly, cost }, now) {
  const was = session?.billing ?? 'unclear'
  const billing = settle(was, { weekly, replied: cost > 0 })
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

export const COMPACT_AT = 250_000

/** Whether a checkpoint compacts a context of this size: one too small to be worth a fresh start is kept. */
export function checkpointCompacts(context) {
  const tokens = Number(context?.tokens)
  if (!(tokens > 0)) return true
  const window = Number(context?.window)
  // A smaller window would fill and compact on its own mid-milestone before it ever reached COMPACT_AT.
  return tokens >= (window > 0 ? Math.min(COMPACT_AT, window * 0.6) : COMPACT_AT)
}

export function keptPrompt(step) {
  return `LCW checkpoint: the context is small enough to keep, so it was not compacted. Carry on with the next step: ${step}`
}

export function wakePrompt(root) {
  return `LCW: the weekly usage limit has reset. Run \`${cli(root)} resume\`, then \`${cli(root)} status\`, and carry on from the ledger.`
}

/** The wake at a dollar gate; markUsd null when the session turned out to be a subscription. */
export function usdWakePrompt(root, markUsd) {
  const why = markUsd == null ? 'this session is billed by subscription, so the pause at the mark is lifted' : `the 7-day spend is back under your ${dollars(markUsd)} mark`
  return `LCW: ${why}. Run \`${cli(root)} resume\`, then \`${cli(root)} status\`, and carry on from the ledger.`
}

export function reopenPrompt(root) {
  return `LCW: this session was reopened with an unfinished LCW run. Load the lcw:lcw skill with the Skill tool, run \`${cli(root)} status\`, and carry on.`
}
