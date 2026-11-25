import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { usageFile, sessionFile, sessionNames } from '../../lib/key.mjs'
import { gateExpired } from '../../lib/usage.mjs'
import { thresholds } from '../../lib/theme.mjs'
import { next0800 } from '../../lib/spend.mjs'
import { home, readJson, writeJson, removeFile, forgetReads } from './store.mjs'
import { readMoney } from './money.mjs'
import { readSessionQuota, sessionQuota, sessionIdentity, pickSession, readRow, callerPid } from './quota-session.mjs'
import { runMark } from '../../lib/session.mjs'
import { alive } from './awake.mjs'
import { isDeepStrictEqual } from 'node:util'
import { atMark, lcwOnly } from '../../lib/mark.mjs'

export { atMark, lcwOnly }

export const DEFAULT_MARK = thresholds.usageMarkPercent
export const readUsage = () => readJson(usageFile(home()))

/** The ids a session is known by, as sessionNames chooses them from the hook's input and the session files. */
export function sessionIds(input) {
  const fromPath = input?.transcript_path ? path.basename(String(input.transcript_path), '.jsonl') : null
  return sessionNames(fromPath, input?.session_id, readRow, alive, callerPid())
}

/** The usage mark the human set for a session ("run up to N%"), else the default. It belongs to the session, run or no run. */
export const sessionMark = (ids) => pickSession(ids).mark

export const driverMark = (state) => runMark(state, readRow, alive, callerPid())

/** Sets the session's mark: a number is a share of the week, {usd} a dollar figure. Setting one clears the other. */
export function setSessionMark(sessionId, mark) {
  for (const id of new Set([sessionId, sessionIdentity(sessionId)])) {
    const file = sessionFile(home(), id)
    const { markPercent, markUsd, ...rest } = readJson(file) || {}
    writeJson(file, typeof mark === 'number' ? { ...rest, markPercent: mark } : { ...rest, markUsd: mark.usd })
  }
}

/**
 * Writes or removes the run's gate to match the usage figure, or with the money view the 7-day spend. Returns
 * whether the run is at its mark. A dollar gate stays while the run is paused at the mark, even once the spend
 * is under it: the run waits for its 08:00 try, which the mod makes.
 */
function updateDefaultGate(paths, state, usage, now, money, intent, io) {
  if (intent === 'resume') { io.remove(paths.gate); return false }
  const on = atMark(driverMark(state), usage, now, money)
  const previous = readJson(paths.gate)
  if (previous?.unit === 'quota' && !on && !intent) return false
  if (previous?.unit === 'quota' || (previous?.unit === 'usd' && !money && on)) io.remove(paths.gate)
  if (intent === 'mark' && (gateExpired(readJson(paths.gate), now) || (money && !atMark(null, null, now, money)))) io.remove(paths.gate)
  if (on && state.status === 'paused' && state.pausedReason === 'human') return on // the human paused it, so no gate: resume evaluates the mark again
  const has = fs.existsSync(paths.gate)
  if (has && gateExpired(readJson(paths.gate), now)) return false // the mod wakes the session; only resume and mark remove it
  const repair = !money && previous && !previous.unit && !Number.isFinite(Date.parse(previous.resetsAt ?? '')) && Date.parse(usage?.sevenDay?.resetsAt ?? '') > now
  if (on && !has && money) {
    io.write(paths.gate, { reason: 'mark', unit: 'usd', markUsd: money.markUsd, usedUsd: money.spentUsd, retryAt: next0800(now), retried: false, at: now })
  } else if (on && (!has || repair)) {
    const w = usage.sevenDay
    io.write(paths.gate, { reason: 'mark', markPercent: driverMark(state), usedPercent: w.percentUsed, resetsAt: w.resetsAt ?? null, at: now })
  }
  const waits = money && state.status === 'paused' && state.pausedReason === 'mark' && readJson(paths.gate)?.unit === 'usd'
  if (!on && has && !waits) io.remove(paths.gate)
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
    forgetReads()
    try { return fn() } finally { fs.renameSync(lock, prepared) }
  } catch { return fallback }
  finally {
    try { fs.unlinkSync(`${prepared}/${marker}`) } catch {}
    try { fs.rmdirSync(prepared) } catch {}
  }
}

const quotaEvidence = (quota) => ({ sourceId: quota.sourceId, revision: quota.revision, requestId: quota.requestId ?? null, accountKey: quota.accountKey ?? null, resetsAt: quota.resetsAt ?? null, observedAt: quota.observedAt ?? null })

const live = { write: writeJson, remove: removeFile }

function updateGate(paths, state, usage, now, money, intent, io = live) {
  const quota = (io.quota ?? readSessionQuota)(state.driver, now, driverMark(state))
  const currentMoney = state.driver ? readMoney({ sessionId: state.driver, now, state }) : money
  if (!intent && (['finished', 'stopped'].includes(state.status) || (state.status === 'paused' && state.pausedReason === 'human'))) return quota?.hold ?? atMark(driverMark(state), readUsage() ?? usage, now, currentMoney)
  if (!quota) return updateDefaultGate(paths, state, readUsage() ?? usage, now, currentMoney, intent, io)
  if (state.status === 'paused' && state.pausedReason === 'human') return quota.hold
  if (intent === 'resume' && !quota.hold) { io.remove(paths.gate); return false }
  const previous = readJson(paths.gate)
  const evidence = quotaEvidence(quota)
  if (quota.hold) {
    const gate = { reason: 'mark', unit: 'quota', ...evidence, status: quota.status, blocked: !!quota.blocked, code: quota.code ?? null, markPercent: driverMark(state), usedPercent: quota.percentUsed ?? null }
    const { at, holdId, recoveredBy, ...old } = previous ?? {}
    if (recoveredBy || !isDeepStrictEqual(old, gate)) io.write(paths.gate, { ...gate, holdId: randomUUID(), at: now })
  } else if (previous?.unit === 'quota' && !isDeepStrictEqual(previous.recoveredBy, evidence)) {
    io.write(paths.gate, { ...previous, recoveredBy: evidence })
  }
  return quota.hold
}

export function applyGate(paths, state, usage, now = Date.now(), money = null, intent = null) {
  // Source and state are re-read only after acquisition; a display's older snapshot cannot retire a newer hold.
  return withGateLock(paths, () => updateGate(paths, readJson(paths.state) ?? state, usage, now, money, intent))
}

const CHANGES = Symbol('the gate would change')
const judging = { write: () => { throw CHANGES }, remove: (file) => { if (fs.existsSync(file)) throw CHANGES } }

/**
 * applyGate for a display that redraws every second: the gate is judged from what was already read, and the lock is
 * taken, and the gate applied afresh under it, only when the gate has to change.
 */
export function settleGate(paths, state, usage, now, money) {
  try { updateGate(paths, readJson(paths.state) ?? state, usage, now, money, null, judging); return } catch (e) { if (e !== CHANGES) throw e }
  applyGate(paths, state, usage, now, money)
}

/** Whether settleGate at now would leave the gate as it is. It writes nothing and starts nothing. */
export function gateStands(paths, state, usage, now, money) {
  try { updateGate(paths, readJson(paths.state) ?? state, usage, now, money, null, { ...judging, quota: sessionQuota }); return true } catch (e) { if (e !== CHANGES) throw e }
  return false
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
