// Pure quota validation and evaluation shared by scripts and the mod.
export const QUOTA_SOURCE_ID = 'external-quota'
export const REFRESH_MS = 300000
export const MAX_AGE_MS = 600000
export const CLAIM_MS = 35000
export const FAILURE_CODES = Object.freeze(['auth', 'network', 'timeout', 'invalid-response', 'no-weekly-window', 'ambiguous-weekly-window', 'account-changed', 'provider-refused', 'command-failed'])

export function normalizeEndpoint(value) {
  if (typeof value !== 'string' || !/^https?:\/\/[^/@]+(?:\/.*)?$/i.test(value) || /[\s\\?#]/.test(value)) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch { return null }
}

const digest = (s) => typeof s === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/.test(s)
const invalid = (value) => ({ v: 1, status: 'unavailable', code: 'invalid-response', ...(digest(value?.accountKey) ? { accountKey: value.accountKey } : {}) })

function resetTime(value) {
  if (typeof value !== 'string') return NaN
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?(Z|([+-])(\d\d):(\d\d))$/.exec(value)
  if (!m || Number(m[5] ?? 0) > 23 || Number(m[6] ?? 0) > 59) return NaN
  const offset = m[3] === 'Z' ? 0 : (Number(m[5]) * 60 + Number(m[6])) * (m[4] === '+' ? 1 : -1)
  const ms = Date.parse(value)
  const local = `${m[1]}.${(m[2] ?? '').padEnd(3, '0')}Z`
  return Number.isFinite(ms) && new Date(ms + offset * 60000).toISOString() === local ? ms : NaN
}

export function validateQuotaResult(value, now) {
  if (!value || value.v !== 1 || !Number.isFinite(now)) return invalid(value)
  if (value.status === 'ok') {
    const w = value.weekly
    if (!digest(value.accountKey) || typeof value.blocked !== 'boolean' || !w || !Number.isFinite(w.percentUsed) || w.percentUsed < 0 || w.percentUsed > 100 || !(resetTime(w.resetsAt) > now)) return invalid(value)
    return { v: 1, status: 'ok', accountKey: value.accountKey, weekly: { percentUsed: w.percentUsed, resetsAt: new Date(resetTime(w.resetsAt)).toISOString() }, blocked: value.blocked }
  }
  if (!['unavailable', 'refused'].includes(value.status) || !FAILURE_CODES.includes(value.code) || (value.accountKey !== undefined && !digest(value.accountKey))) return invalid(value)
  return { v: 1, status: value.status, code: value.code, ...(value.accountKey === undefined ? {} : { accountKey: value.accountKey }) }
}

export function parseQuotaResult(text, now) {
  try { return validateQuotaResult(JSON.parse(text), now) } catch { return invalid() }
}

export function activeQuota(state) {
  const endpoint = normalizeEndpoint(state?.endpoint)
  return !!(state?.v === 1 && state.enabled === true && state.sourceId === QUOTA_SOURCE_ID && typeof state.revision === 'string' && state.revision && endpoint && endpoint === state.endpoint && typeof state.command === 'string' && state.command.trim())
}

export function selectQuota(endpoint, state) {
  return activeQuota(state) && normalizeEndpoint(endpoint) === state.endpoint ? { sourceId: QUOTA_SOURCE_ID, endpoint: state.endpoint } : null
}

export function quotaOff(state) {
  return state?.v === 1 && state.enabled === false && state.sourceId === QUOTA_SOURCE_ID && typeof state.revision === 'string' && !!state.revision
}

const fresh = (good, now) => good && Number.isFinite(good.observedAt) && now >= good.observedAt && now - good.observedAt < MAX_AGE_MS && validateQuotaResult(good.result, now).status === 'ok'

/** null means default billing; every selected but unusable external state holds. */
export function evaluateQuota(selection, state, now, mark = 100) {
  if (!selection || (selection.sourceId === QUOTA_SOURCE_ID && quotaOff(state))) return null
  const base = { sourceId: selection.sourceId, revision: state?.revision ?? null, status: 'unavailable', code: 'config-unavailable', hold: true }
  if (selection.sourceId !== QUOTA_SOURCE_ID || !activeQuota(state) || selection.endpoint !== state.endpoint || normalizeEndpoint(selection.endpoint) !== selection.endpoint || !Number.isFinite(now)) return base
  const c = state.cache
  if (!c || c.revision !== state.revision || typeof c.requestId !== 'string' || !Number.isFinite(c.attemptedAt) || !Number.isFinite(c.completedAt) || c.completedAt < c.attemptedAt || c.completedAt > now) return { ...base, code: 'cache-unavailable' }
  const result = validateQuotaResult(c.result, c.attemptedAt)
  const evidence = { requestId: c.requestId, observedAt: c.attemptedAt, ...(result.accountKey ? { accountKey: result.accountKey } : {}) }
  const last = result.status === 'ok' ? { result, observedAt: c.attemptedAt } : c.lastGood
  const historical = result.code !== 'account-changed' && fresh(last, now) && (!result.accountKey || result.accountKey === last.result.accountKey) ? { historical: { accountKey: last.result.accountKey, percentUsed: last.result.weekly.percentUsed, resetsAt: last.result.weekly.resetsAt, observedAt: last.observedAt } } : {}
  if (state.claim?.revision === state.revision && state.claim.requestId !== c.requestId && (!Number.isFinite(state.claim.startedAt) || now - state.claim.startedAt >= CLAIM_MS)) return { ...base, ...evidence, ...historical, code: 'timeout' }
  if (result.status !== 'ok') return { ...base, ...evidence, ...historical, status: result.status, code: result.code }
  if (!fresh(last, now)) return { ...base, ...evidence, status: 'stale', code: resetTime(result.weekly.resetsAt) <= now ? 'window-expired' : 'cache-expired' }
  return { sourceId: QUOTA_SOURCE_ID, revision: state.revision, ...evidence, status: 'ok', percentUsed: result.weekly.percentUsed, resetsAt: result.weekly.resetsAt, blocked: result.blocked, hold: result.blocked || !Number.isFinite(mark) || mark < 0 || mark > 100 || result.weekly.percentUsed >= mark }
}
