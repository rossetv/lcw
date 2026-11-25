import { sessionFile, spendFile } from '../../lib/key.mjs'
import { aliasRows, rowBilling, sessionAnchor, sessionPick } from '../../lib/session.mjs'
import { activeQuota, selectQuota, quotaOff, evaluateQuota, normalizeEndpoint } from '../../lib/quota.mjs'
import { home, readJson, writeJson, removeFile } from './store.mjs'
import { readQuotaState, maybeRefreshQuota } from './quota-command.mjs'
import { alive } from './awake.mjs'

export { quotaLine } from '../../lib/mark.mjs'

export const readRow = (name) => readJson(sessionFile(home(), name))
export const callerPid = () => Number(process.env.CLAUDE_PID)

/** sessionPick over the session files, for the Claude Code this runs under. */
export const pickSession = (ids) => sessionPick(ids, readRow, alive, callerPid())

export const sessionIdentity = (id) => sessionAnchor(id, readRow, alive, callerPid())

function noteAliases(ids) {
  for (const [id, next] of Object.entries(aliasRows(ids, readRow, alive, callerPid()))) writeJson(sessionFile(home(), id), next)
}

const records = (ids) => [].concat(ids ?? []).filter(Boolean).map((id) => ({ id, session: readJson(sessionFile(home(), id)) ?? {} }))

export function sessionBilling(session, state = readQuotaState(home())) {
  return rowBilling(session, quotaOff(state))
}

/** Only the session's own hooks select from their environment; a driver is read by its saved identity. */
export function noteQuotaSession(ids, { startup = false, endpoint = process.env.ANTHROPIC_BASE_URL, defaultBilling } = {}) {
  noteAliases(ids)
  const rows = records(ids)
  if (!rows.length) return
  const state = readQuotaState(home())
  const saved = rows.find(({ session }) => Object.hasOwn(session, 'quotaSelection'))?.session
  let selection = saved?.quotaSelection ?? null
  if (quotaOff(state)) selection = null
  else if (startup && activeQuota(state)) {
    const matched = selectQuota(endpoint, state)
    if (matched || !selection || (selection.endpoint && normalizeEndpoint(endpoint) !== selection.endpoint)) selection = matched
  } else if (!selection) selection = selectQuota(endpoint, state)
  if (!selection && !saved?.quotaSelection) return
  const history = saved?.quotaDefaultBilling ?? rows.find(({ session }) => session.billing)?.session.billing
  const prior = !history || history === 'unclear' ? defaultBilling ?? 'unclear' : history
  for (const { id, session } of rows) {
    const next = { ...session, quotaSelection: selection, billing: selection ? 'subscription' : prior }
    if (selection) next.quotaDefaultBilling = prior
    else delete next.quotaDefaultBilling
    if (JSON.stringify(next) !== JSON.stringify(session)) writeJson(sessionFile(home(), id), next)
    if (selection) removeFile(spendFile(home(), id))
  }
}

/** The session's outside quota as it stands at now, or null; reads only, and starts nothing. */
export function sessionQuota(ids, now, mark) {
  return evaluateQuota(pickSession(ids).quotaSelection, readQuotaState(home()), now, mark)
}

/** sessionQuota, and a refresh of the figure in the background when it is due. */
export function readSessionQuota(ids, now, mark) {
  const view = sessionQuota(ids, now, mark)
  if (view) maybeRefreshQuota(home(), now)
  return view
}

export function quotaUsage(view, now) {
  return view ? { at: view.observedAt ?? now, source: view.sourceId, sevenDay: view.status === 'ok' ? { percentUsed: view.percentUsed, resetsAt: view.resetsAt } : null } : null
}
