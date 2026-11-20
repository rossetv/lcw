import fs from 'node:fs'
import path from 'node:path'
import { usageFile, sessionFile } from '../../lib/key.mjs'
import { gateExpired } from '../../lib/usage.mjs'
import { thresholds } from '../../lib/theme.mjs'
import { next0800 } from '../../lib/spend.mjs'
import { home, readJson, writeJson } from './store.mjs'
import { readMoney } from './money.mjs'

export const DEFAULT_MARK = thresholds.usageMarkPercent
export const readUsage = () => readJson(usageFile(home()))

/** The ids a session is known by: its transcript's name first, which a resumed session keeps, then the id it was given. */
export function sessionIds(input) {
  const fromPath = input?.transcript_path ? path.basename(String(input.transcript_path), '.jsonl') : null
  return [...new Set([fromPath, input?.session_id].filter(Boolean))]
}

/** The usage mark the human set for a session ("run up to N%"), else the default. It belongs to the session, run or no run. */
export function sessionMark(ids) {
  for (const id of [].concat(ids ?? [])) {
    const mark = readJson(sessionFile(home(), id))?.markPercent
    if (typeof mark === 'number') return mark
  }
  return DEFAULT_MARK
}

/** Sets the session's mark: a number is a share of the week, {usd} a dollar figure. Setting one clears the other. */
export function setSessionMark(sessionId, mark) {
  const file = sessionFile(home(), sessionId)
  const { markPercent, markUsd, ...rest } = readJson(file) || {}
  writeJson(file, typeof mark === 'number' ? { ...rest, markPercent: mark } : { ...rest, markUsd: mark.usd })
}

/**
 * True when a shell line runs lcw and nothing else: one call, or several joined by &&, ; or |. Such a line is
 * winding the run down or lifting the mark, so the stop note leaves it alone. In doubt it answers false.
 */
export function lcwOnly(command) {
  const line = String(command ?? '').replace(/'\\''/g, '_') // an apostrophe inside a single-quoted text, written '\''
  if (/\$\(|`/.test(line.replace(/'[^']*'/g, ''))) return false // a command run inside the line, as in "$(npm test)"
  const parts = line
    .replace(/"[^"]*"|'[^']*'/g, (quoted) => quoted.replace(/[;&|\n]/g, ' ')) // inside quotes these are text
    .replace(/\d*>&\d+/g, '') // 2>&1 starts no second command
    .split(/[;&|\n]+/).map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 && parts.every((part) => /^node\s+("[^"]*lcw\.mjs"|'[^']*lcw\.mjs'|\S*lcw\.mjs)(\s|$)/.test(part))
}

/**
 * True when the week's figure has reached the mark and its reset time has not passed. On pay-per-token billing,
 * given the money view: when the machine's 7-day spend has reached the session's mark in dollars.
 */
export function atMark(mark, usage, now = Date.now(), money = null) {
  if (money) return money.spentUsd >= money.markUsd
  const w = usage?.sevenDay
  if (!w || typeof w.percentUsed !== 'number') return false
  if (w.resetsAt && Date.parse(w.resetsAt) <= now) return false
  return w.percentUsed >= mark
}

/**
 * Writes or removes the run's gate to match the usage figure, or with the money view the 7-day spend. Returns
 * whether the run is at its mark. A dollar gate stays while the run is paused at the mark, even once the spend
 * is under it: the run waits for its 08:00 try, which the mod makes.
 */
export function applyGate(paths, state, usage, now = Date.now(), money = null) {
  const on = atMark(state.markPercent ?? DEFAULT_MARK, usage, now, money)
  if (on && state.status === 'paused' && state.pausedReason === 'human') return false // the human paused it; resume evaluates the mark again
  const has = fs.existsSync(paths.gate)
  if (has && gateExpired(readJson(paths.gate), now)) return false // the mod wakes the session; only resume and mark remove it
  if (on && !has && money) {
    writeJson(paths.gate, { reason: 'mark', unit: 'usd', markUsd: money.markUsd, usedUsd: money.spentUsd, retryAt: next0800(now), retried: false, at: now })
  } else if (on && !has) {
    const w = usage.sevenDay
    writeJson(paths.gate, { reason: 'mark', markPercent: state.markPercent ?? DEFAULT_MARK, usedPercent: w.percentUsed, resetsAt: w.resetsAt ?? null, at: now })
  }
  const waits = money && state.status === 'paused' && state.pausedReason === 'mark' && readJson(paths.gate)?.unit === 'usd'
  if (!on && has && !waits) fs.rmSync(paths.gate, { force: true })
  return on
}

/**
 * For the launch gate: the gate file exists and the usage figure and reset time still back it. A dollar gate
 * holds only while the machine's 7-day spend is at or over the driving session's mark, at any hour; for a
 * session no longer billed per token it falls back to the week's figure.
 */
export function gateHolds(paths, state, now = Date.now()) {
  const gate = readJson(paths.gate)
  if (!gate) return false
  if (gateExpired(gate, now)) return false
  if (gate.unit === 'usd') {
    const money = state.driver ? readMoney({ sessionId: state.driver, now, state }) : null
    if (money) return atMark(null, null, now, money)
    const usage = readUsage()
    return usage ? atMark(state.markPercent ?? DEFAULT_MARK, usage, now) : false
  }
  const usage = readUsage()
  return usage ? atMark(state.markPercent ?? DEFAULT_MARK, usage, now) : true
}
