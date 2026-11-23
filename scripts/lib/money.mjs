// The money LCW counts on pay-per-token billing, read from and written to the LCW home. The maths is in
// lib/spend.mjs; this only finds the files. "now" is always passed in.
import fs from 'node:fs'
import { sessionFile, spendFile, spendDir, capFile, runsDir, runPaths, repoKey } from '../../lib/key.mjs'
import { moneyFrom, recordReading, spendFileCounts, readingOf } from '../../lib/spend.mjs'
import { home, readJson, writeJson } from './store.mjs'
import { readSetting, readReading } from './spend-command.mjs'
import { sessionBilling, sessionIdentity } from './quota-session.mjs'

const sessionsFor = (id) => [...new Set([sessionIdentity(id), id])].map((key) => readJson(sessionFile(home(), key)) ?? {})
function billingFor(sessions) {
  const source = sessions.find((session) => Object.hasOwn(session, 'quotaSelection'))
  if (source?.quotaSelection && sessionBilling(source) === 'subscription') return 'subscription'
  return sessionBilling(sessions.find((session) => typeof session.billing === 'string' || session.quotaSelection))
}

/** The stated weekly cap ({usd, at}), or null when none is stated and $4,000 is assumed. */
export function readCap() {
  const cap = readJson(capFile(home()))
  return Number.isFinite(cap?.usd) && cap.usd > 0 ? cap : null
}

export function writeCap(usd, now) {
  if (!(Number.isFinite(usd) && usd > 0)) throw new Error(`not a weekly cap: ${usd}`)
  writeJson(capFile(home()), { usd, at: new Date(now).toISOString() })
}

/** Folds a cost reading into the session's spend record; writes only when the record changed. */
export function recordSpend(sessionId, rawCost, now) {
  if (billingFor(sessionsFor(sessionId)) === 'subscription') return null
  const file = spendFile(home(), sessionId)
  const rec = readJson(file)
  const next = recordReading(rec, rawCost, now)
  if (next && next !== rec) writeJson(file, next)
  return next
}

/** Takes a session's dollars back out: it turned out to be a subscription. */
export function dropSpend(sessionId) {
  fs.rmSync(spendFile(home(), sessionId), { force: true })
}

/** Records the session's billing kind; the file is read and written only when the kind changes. */
export function setBilling(sessionId, kind) {
  const file = sessionFile(home(), sessionId)
  const session = readJson(file)
  if (session?.billing === kind) return false
  writeJson(file, { ...(session || {}), billing: kind })
  return true
}

/** Every spend record that can count at now: those written in the last 8 days. */
export function spendRecords(now) {
  const dir = spendDir(home())
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')) } catch {}
  const mtime = (n) => { try { return fs.statSync(`${dir}/${n}`).mtimeMs } catch { return 0 } }
  return names.filter((n) => spendFileCounts(mtime(n), now) && billingFor(sessionsFor(n.slice(0, -5))) !== 'subscription').map((n) => readJson(`${dir}/${n}`)).filter(Boolean)
}

/**
 * The money view for the renderer, or null unless the session is billed per token. sessionId is one id or
 * the ids a session is known by (sessionIds): the first that has a billing kind, a mark or a spend record
 * gives it. The mark is the session's own. With the run's state, it adds the run's spend and, from the run's
 * usd gate, when it tries again. A working spend command's reading gives the week's figure in place of LCW's
 * own count; it is read only here, after the billing check, so a subscription never sees it.
 */
export function readMoney({ sessionId, now, state = null }) {
  const ids = [...new Set([].concat(sessionId ?? []).flatMap((id) => [sessionIdentity(id), id]))]
  const sessions = ids.map((id) => readJson(sessionFile(home(), id)) ?? {})
  if (billingFor(sessions) !== 'payg') return null
  const session = sessions.find((s) => typeof s.markUsd === 'number' || typeof s.markPercent === 'number') ?? null
  const own = ids.map((id) => readJson(spendFile(home(), id))).find((rec) => typeof rec?.max === 'number')
  const reading = readingOf(readSetting(home()), readReading(home()))
  const money = moneyFrom({ records: spendRecords(now), cap: readCap(), session, state, sessionCum: state ? own?.max : undefined, now, reading })
  if (state?.id && state.repoRoot) {
    const gate = readJson(runPaths(`${runsDir(home(), repoKey(state.repoRoot))}/${state.id}`).gate)
    if (gate?.unit === 'usd') Object.assign(money, { retryAt: gate.retryAt, retried: !!gate.retried })
  }
  return money
}
