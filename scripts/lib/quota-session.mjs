import { sessionFile, spendFile } from '../../lib/key.mjs'
import { activeQuota, selectQuota, quotaOff, evaluateQuota, normalizeEndpoint } from '../../lib/quota.mjs'
import { home, readJson, writeJson, removeFile } from './store.mjs'
import { readQuotaState, maybeRefreshQuota } from './quota-command.mjs'
import { alive } from './awake.mjs'

export { quotaLine } from '../../lib/mark.mjs'

export function sessionIdentity(id) {
  if (!id) return id
  const own = readJson(sessionFile(home(), id))
  const anchor = own?.sessionCanonicalId
  if (typeof anchor !== 'string' || !/^[\w.-]{1,256}$/.test(anchor) || /^\.+$/.test(anchor)) return id
  const target = readJson(sessionFile(home(), anchor))
  const pid = own?.claudePid || Number(process.env.CLAUDE_PID)
  if (anchor !== id && alive(target?.claudePid) && target.claudePid !== pid) return id
  return target?.sessionCanonicalId === anchor ? anchor : id
}

function noteAliases(rows) {
  if (rows.length < 2) return
  const anchorId = sessionIdentity(rows[0].id)
  const anchor = readJson(sessionFile(home(), anchorId)) ?? {}
  const current = rows.at(-1)
  const pid = Number(process.env.CLAUDE_PID) || current.session.claudePid
  if (alive(anchor.claudePid) && anchor.claudePid !== pid) return
  if (current.session.runDir && anchor.runDir && current.session.runDir !== anchor.runDir) return
  if (current.session.sessionCanonicalId && sessionIdentity(current.id) !== anchorId) return
  const mark = current.session.sessionCanonicalId ? anchor : typeof current.session.markPercent === 'number' || typeof current.session.markUsd === 'number' ? current.session : anchor
  for (const { id, session } of [{ id: anchorId, session: anchor }, ...rows.filter((row) => row.id !== anchorId)]) {
    const { markPercent, markUsd, ...rest } = session
    const next = { ...rest, sessionCanonicalId: anchorId, ...(typeof mark.markUsd === 'number' ? { markUsd: mark.markUsd } : typeof mark.markPercent === 'number' ? { markPercent: mark.markPercent } : {}) }
    if (!next.runDir && anchor.runDir) next.runDir = anchor.runDir
    if (JSON.stringify(next) !== JSON.stringify(session)) writeJson(sessionFile(home(), id), next)
  }
}

const records = (ids) => [].concat(ids ?? []).filter(Boolean).map((id) => ({ id, session: readJson(sessionFile(home(), id)) ?? {} }))

export function sessionBilling(session, state = readQuotaState(home())) {
  if (!session?.quotaSelection) return session?.billing
  return quotaOff(state) ? session.quotaDefaultBilling ?? 'unclear' : 'subscription'
}

/** Only the session's own hooks select from their environment; a driver is read by its saved identity. */
export function noteQuotaSession(ids, { startup = false, endpoint = process.env.ANTHROPIC_BASE_URL, defaultBilling } = {}) {
  noteAliases(records(ids))
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
  const resolved = [...new Set([].concat(ids ?? []).flatMap((id) => [sessionIdentity(id), id]))]
  const selection = records(resolved).find(({ session }) => Object.hasOwn(session, 'quotaSelection'))?.session.quotaSelection
  return evaluateQuota(selection, readQuotaState(home()), now, mark)
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
