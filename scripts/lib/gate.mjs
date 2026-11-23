import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { usageFile, sessionFile } from '../../lib/key.mjs'
import { gateExpired } from '../../lib/usage.mjs'
import { thresholds } from '../../lib/theme.mjs'
import { next0800 } from '../../lib/spend.mjs'
import { home, readJson, writeJson } from './store.mjs'
import { readMoney } from './money.mjs'
import { readSessionQuota } from './quota-session.mjs'

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
  const quota = readSessionQuota(state.driver, now, state.markPercent ?? DEFAULT_MARK)
  if (quota) return applyQuotaGate(paths, state, now)
  if (readJson(paths.gate)?.unit === 'quota') fs.rmSync(paths.gate, { force: true })
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

function applyQuotaGate(paths, state, now) {
  if (state.status === 'paused' && state.pausedReason === 'human') return readSessionQuota(state.driver, now, state.markPercent ?? DEFAULT_MARK)?.hold ?? true
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
    let on = true
    try {
      // Re-read after claiming the gate so an older success cannot replace a newer hold.
      const quota = readSessionQuota(state.driver, now, state.markPercent ?? DEFAULT_MARK)
      if (!quota) return false
      on = quota.hold
      const previous = readJson(paths.gate)
      const evidence = { sourceId: quota.sourceId, revision: quota.revision, requestId: quota.requestId ?? null, accountKey: quota.accountKey ?? null, resetsAt: quota.resetsAt ?? null, observedAt: quota.observedAt ?? null }
      if (quota.hold) {
        const gate = { reason: 'mark', unit: 'quota', ...evidence, status: quota.status, blocked: !!quota.blocked, code: quota.code ?? null, markPercent: state.markPercent ?? DEFAULT_MARK, usedPercent: quota.percentUsed ?? null }
        const { at, holdId, recoveredBy, ...old } = previous ?? {}
        if (recoveredBy || JSON.stringify(old) !== JSON.stringify(gate)) writeJson(paths.gate, { ...gate, holdId: randomUUID(), at: now })
      } else if (previous?.unit === 'quota' && JSON.stringify(previous.recoveredBy) !== JSON.stringify(evidence)) {
        writeJson(paths.gate, { ...previous, recoveredBy: evidence })
      }
    } finally { fs.renameSync(lock, prepared) }
    return on
  } catch { return true }
  finally {
    try { fs.unlinkSync(`${prepared}/${marker}`) } catch {}
    try { fs.rmdirSync(prepared) } catch {}
  }
}

export function gateHolds(paths, state, now = Date.now()) {
  const quota = readSessionQuota(state.driver, now, state.markPercent ?? DEFAULT_MARK)
  if (quota) return applyGate(paths, state, null, now)
  const money = state.driver ? readMoney({ sessionId: state.driver, now, state }) : null
  if (atMark(state.markPercent ?? DEFAULT_MARK, readUsage(), now, money)) return true
  const gate = readJson(paths.gate)
  if (!gate || gate.unit === 'quota') return false
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
