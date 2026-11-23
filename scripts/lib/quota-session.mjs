import fs from 'node:fs'
import { sessionFile, spendFile } from '../../lib/key.mjs'
import { activeQuota, selectQuota, quotaOff, evaluateQuota } from '../../lib/quota.mjs'
import { home, readJson, writeJson } from './store.mjs'
import { readQuotaState, maybeRefreshQuota } from './quota-command.mjs'

const records = (ids) => [].concat(ids ?? []).filter(Boolean).map((id) => ({ id, session: readJson(sessionFile(home(), id)) ?? {} }))

export function sessionBilling(session, state = readQuotaState(home())) {
  if (!session?.quotaSelection) return session?.billing
  return quotaOff(state) ? session.quotaDefaultBilling ?? 'unclear' : 'subscription'
}

/** Only the session's own hooks select from their environment; a driver is read by its saved identity. */
export function noteQuotaSession(ids, { startup = false, endpoint = process.env.ANTHROPIC_BASE_URL, defaultBilling } = {}) {
  const rows = records(ids)
  if (!rows.length) return
  const state = readQuotaState(home())
  const saved = rows.find(({ session }) => Object.hasOwn(session, 'quotaSelection'))?.session
  let selection = saved?.quotaSelection ?? null
  if (quotaOff(state) || (startup && activeQuota(state))) selection = selectQuota(endpoint, state)
  else if (!selection) selection = selectQuota(endpoint, state)
  if (!selection && !saved?.quotaSelection) return
  const prior = saved?.quotaDefaultBilling ?? rows.find(({ session }) => session.billing)?.session.billing ?? defaultBilling ?? 'unclear'
  for (const { id, session } of rows) {
    const next = { ...session, quotaSelection: selection, billing: selection ? 'subscription' : prior }
    if (selection) next.quotaDefaultBilling = prior
    else delete next.quotaDefaultBilling
    if (JSON.stringify(next) !== JSON.stringify(session)) writeJson(sessionFile(home(), id), next)
    if (selection) fs.rmSync(spendFile(home(), id), { force: true })
  }
}

export function readSessionQuota(ids, now, mark) {
  const selection = records(ids).find(({ session }) => Object.hasOwn(session, 'quotaSelection'))?.session.quotaSelection
  const view = evaluateQuota(selection, readQuotaState(home()), now, mark)
  if (view) maybeRefreshQuota(home(), now)
  return view
}

export function quotaUsage(view, now) {
  return view ? { at: view.observedAt ?? now, source: view.sourceId, sevenDay: view.status === 'ok' ? { percentUsed: view.percentUsed, resetsAt: view.resetsAt } : null } : null
}

export function quotaLine(view) {
  return view.status === 'ok'
    ? `external week: ${view.percentUsed}% used${view.blocked ? '; provider refused new work' : ''}`
    : `external quota: ${view.status}${view.code ? ` (${view.code})` : ''}; new work held`
}
