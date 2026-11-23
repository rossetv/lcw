import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { usageFile, sessionFile } from '../../lib/key.mjs'
import { gateExpired } from '../../lib/usage.mjs'
import { thresholds } from '../../lib/theme.mjs'
import { next0800 } from '../../lib/spend.mjs'
import { home, readJson, writeJson } from './store.mjs'
import { readMoney } from './money.mjs'
import { readSessionQuota, sessionIdentity } from './quota-session.mjs'
import { alive } from './awake.mjs'
import { isDeepStrictEqual } from 'node:util'

export const DEFAULT_MARK = thresholds.usageMarkPercent
export const readUsage = () => readJson(usageFile(home()))

/** The ids a session is known by: its transcript's name first, which a resumed session keeps, then the id it was given. */
export function sessionIds(input) {
  const fromPath = input?.transcript_path ? path.basename(String(input.transcript_path), '.jsonl') : null
  if (fromPath && input?.session_id && fromPath !== input.session_id) {
    const transcript = readJson(sessionFile(home(), fromPath))
    const current = readJson(sessionFile(home(), input.session_id))
    const pid = Number(process.env.CLAUDE_PID) || current?.claudePid
    if (alive(transcript?.claudePid) && transcript.claudePid !== pid) return [input.session_id]
    if (Number(process.env.CLAUDE_PID) && alive(current?.claudePid) && current.claudePid !== Number(process.env.CLAUDE_PID)) return [fromPath]
  }
  return [...new Set([fromPath, input?.session_id].filter(Boolean))]
}

/** The usage mark the human set for a session ("run up to N%"), else the default. It belongs to the session, run or no run. */
export function sessionMark(ids) {
  for (const id of [].concat(ids ?? [])) {
    const mark = readJson(sessionFile(home(), sessionIdentity(id)))?.markPercent
    if (typeof mark === 'number') return mark
  }
  return DEFAULT_MARK
}

export function driverMark(state) {
  const session = state.driver ? readJson(sessionFile(home(), sessionIdentity(state.driver))) : null
  return session?.markPercent ?? (session?.markUsd != null ? DEFAULT_MARK : state.markPercent ?? thresholds.usageMarkPercent)
}

/** Sets the session's mark: a number is a share of the week, {usd} a dollar figure. Setting one clears the other. */
export function setSessionMark(sessionId, mark) {
  for (const id of new Set([sessionId, sessionIdentity(sessionId)])) {
    const file = sessionFile(home(), id)
    const { markPercent, markUsd, ...rest } = readJson(file) || {}
    writeJson(file, typeof mark === 'number' ? { ...rest, markPercent: mark } : { ...rest, markUsd: mark.usd })
  }
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
function updateDefaultGate(paths, state, usage, now, money, intent) {
  if (intent === 'resume') { fs.rmSync(paths.gate, { force: true }); return false }
  const on = atMark(driverMark(state), usage, now, money)
  const previous = readJson(paths.gate)
  if (previous?.unit === 'quota' && !on && !intent) return false
  if (previous?.unit === 'quota' || (previous?.unit === 'usd' && !money && on)) fs.rmSync(paths.gate, { force: true })
  if (intent === 'mark' && (gateExpired(readJson(paths.gate), now) || (money && !atMark(null, null, now, money)))) fs.rmSync(paths.gate, { force: true })
  if (on && state.status === 'paused' && state.pausedReason === 'human') return false // the human paused it; resume evaluates the mark again
  const has = fs.existsSync(paths.gate)
  if (has && gateExpired(readJson(paths.gate), now)) return false // the mod wakes the session; only resume and mark remove it
  if (on && !has && money) {
    writeJson(paths.gate, { reason: 'mark', unit: 'usd', markUsd: money.markUsd, usedUsd: money.spentUsd, retryAt: next0800(now), retried: false, at: now })
  } else if (on && !has) {
    const w = usage.sevenDay
    writeJson(paths.gate, { reason: 'mark', markPercent: driverMark(state), usedPercent: w.percentUsed, resetsAt: w.resetsAt ?? null, at: now })
  }
  const waits = money && state.status === 'paused' && state.pausedReason === 'mark' && readJson(paths.gate)?.unit === 'usd'
  if (!on && has && !waits) fs.rmSync(paths.gate, { force: true })
  return on
}

const gateOwner = /^[1-9]\d*-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

function reapGateLock(lock, owner = null) {
  try {
    if (!fs.lstatSync(lock).isDirectory()) return
    const names = fs.readdirSync(lock)
    if (!owner && !names.length) { fs.rmdirSync(lock); return }
    const marker = owner ?? names[0]
    if (!gateOwner.test(marker) || names.length > 1 || (names.length && names[0] !== marker)) return
    try { process.kill(Number(marker.split('-')[0]), 0); return } catch (e) { if (e.code !== 'ESRCH') return }
    if (names.length) {
      if (!fs.lstatSync(`${lock}/${marker}`).isFile()) return
      fs.unlinkSync(`${lock}/${marker}`)
    }
    fs.rmdirSync(lock)
  } catch {}
}

function withGateLock(paths, fn, fallback = true) {
  const lock = `${paths.gate}.lock`
  const marker = `${process.pid}-${randomUUID()}`
  const prepared = `${lock}.${marker}`
  try {
    for (const entry of fs.readdirSync(path.dirname(lock), { withFileTypes: true })) {
      const prefix = `${path.basename(lock)}.`
      const owner = entry.name.slice(prefix.length)
      if (entry.isDirectory() && entry.name.startsWith(prefix) && gateOwner.test(owner)) reapGateLock(path.join(path.dirname(lock), entry.name), owner)
    }
    fs.mkdirSync(prepared, { mode: 0o700 })
    fs.writeFileSync(`${prepared}/${marker}`, '', { flag: 'wx', mode: 0o600 })
    try { fs.renameSync(prepared, lock) } catch (e) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(e.code)) throw e
      reapGateLock(lock)
      fs.renameSync(prepared, lock)
    }
    try { return fn() } finally { fs.renameSync(lock, prepared) }
  } catch { return fallback }
  finally {
    try { fs.unlinkSync(`${prepared}/${marker}`) } catch {}
    try { fs.rmdirSync(prepared) } catch {}
  }
}

const quotaEvidence = (quota) => ({ sourceId: quota.sourceId, revision: quota.revision, requestId: quota.requestId ?? null, accountKey: quota.accountKey ?? null, resetsAt: quota.resetsAt ?? null, observedAt: quota.observedAt ?? null })

function updateGate(paths, state, usage, now, money, intent) {
  const quota = readSessionQuota(state.driver, now, driverMark(state))
  const currentMoney = state.driver ? readMoney({ sessionId: state.driver, now, state }) : money
  if (!intent && (['finished', 'stopped'].includes(state.status) || (state.status === 'paused' && state.pausedReason === 'human'))) return quota?.hold ?? atMark(driverMark(state), readUsage() ?? usage, now, currentMoney)
  if (!quota) return updateDefaultGate(paths, state, readUsage() ?? usage, now, currentMoney, intent)
  if (state.status === 'paused' && state.pausedReason === 'human') return quota.hold
  if (intent === 'resume' && !quota.hold) { fs.rmSync(paths.gate, { force: true }); return false }
  const previous = readJson(paths.gate)
  const evidence = quotaEvidence(quota)
  if (quota.hold) {
    const gate = { reason: 'mark', unit: 'quota', ...evidence, status: quota.status, blocked: !!quota.blocked, code: quota.code ?? null, markPercent: driverMark(state), usedPercent: quota.percentUsed ?? null }
    const { at, holdId, recoveredBy, ...old } = previous ?? {}
    if (recoveredBy || !isDeepStrictEqual(old, gate)) writeJson(paths.gate, { ...gate, holdId: randomUUID(), at: now })
  } else if (previous?.unit === 'quota' && !isDeepStrictEqual(previous.recoveredBy, evidence)) {
    writeJson(paths.gate, { ...previous, recoveredBy: evidence })
  }
  return quota.hold
}

export function applyGate(paths, state, usage, now = Date.now(), money = null, intent = null) {
  // Source and state are re-read only after acquisition; a display's older snapshot cannot retire a newer hold.
  return withGateLock(paths, () => updateGate(paths, readJson(paths.state) ?? state, usage, now, money, intent))
}

export function reconcileGate(paths, expected, action, now, expectedQuota) {
  const unavailable = { ok: false, hold: true, code: 'gate-unavailable' }
  return withGateLock(paths, () => {
    const state = readJson(paths.state)
    if (!state) return unavailable
    const previous = readJson(paths.gate)
    if (!isDeepStrictEqual(previous, expected)) return { ok: false, hold: true, code: 'superseded' }
    const quota = readSessionQuota(state.driver, now, driverMark(state))
    const money = readMoney({ sessionId: state.driver, now, state })
    let hold = quota?.hold ?? atMark(driverMark(state), readUsage(), now, money)
    if (action === 'sync') hold = updateGate(paths, state, readUsage(), now, money)
    else if (action === 'retry') {
      if (quota || previous?.unit !== 'usd') return { ok: false, hold: true, code: 'superseded' }
      if (!money && hold) hold = updateGate(paths, state, readUsage(), now, null)
      else if (!hold) fs.rmSync(paths.gate, { force: true })
      else if (previous.retryAt <= now) writeJson(paths.gate, { ...previous, retryAt: next0800(now), retried: true })
    } else if (action === 'ack') {
      if (hold) return { ok: false, hold: true, code: 'held' }
      if ((!quota && expectedQuota !== undefined) || (quota && !isDeepStrictEqual(quotaEvidence(quota), expectedQuota))) return { ok: false, hold: true, code: 'superseded' }
      fs.rmSync(paths.gate, { force: true })
    } else return { ok: false, hold: true, code: 'invalid-request' }
    return { ok: true, changed: !isDeepStrictEqual(previous, readJson(paths.gate)), hold }
  }, unavailable)
}

export function gateHolds(paths, state, now = Date.now()) {
  const quota = readSessionQuota(state.driver, now, driverMark(state))
  if (quota) return applyGate(paths, state, null, now)
  const money = state.driver ? readMoney({ sessionId: state.driver, now, state }) : null
  if (atMark(driverMark(state), readUsage(), now, money)) return true
  const gate = readJson(paths.gate)
  if (!gate || gate.unit === 'quota') return false
  if (gateExpired(gate, now)) return false
  if (gate.unit === 'usd') {
    const money = state.driver ? readMoney({ sessionId: state.driver, now, state }) : null
    if (money) return atMark(null, null, now, money)
    const usage = readUsage()
    return usage ? atMark(driverMark(state), usage, now) : false
  }
  const usage = readUsage()
  return usage ? atMark(driverMark(state), usage, now) : true
}
