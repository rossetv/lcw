export const QUOTA_SOURCE_ID: 'external-quota'
export const REFRESH_MS: number
export const MAX_AGE_MS: number
export const CLAIM_MS: number
export const FAILURE_CODES: readonly string[]
export type QuotaFailureCode = 'auth' | 'network' | 'timeout' | 'invalid-response' | 'no-weekly-window' | 'ambiguous-weekly-window' | 'account-changed' | 'provider-refused' | 'command-failed'
export type QuotaResult = { v: 1; status: 'ok'; accountKey: string; weekly: { percentUsed: number; resetsAt: string }; blocked: boolean } | { v: 1; status: 'unavailable' | 'refused'; accountKey?: string; code: QuotaFailureCode }
export type QuotaSelection = { sourceId: 'external-quota'; endpoint: string }
export type QuotaCache = { revision: string; requestId: string; attemptedAt: number; completedAt: number; result: QuotaResult; lastGood?: { result: QuotaResult; observedAt: number } }
export type QuotaState = { v: 1; sourceId: 'external-quota'; revision: string; enabled: boolean; endpoint?: string; command?: string; setAt?: number; lastAttemptAt?: number; cache?: QuotaCache; claim?: { revision: string; requestId: string; startedAt: number }; setupRequestId?: string }
export type QuotaView = { sourceId: string; revision: string | null; status: 'ok' | 'unavailable' | 'refused' | 'stale'; hold: boolean; code?: string; requestId?: string; observedAt?: number; accountKey?: string; percentUsed?: number; resetsAt?: string; blocked?: boolean; historical?: { accountKey: string; percentUsed: number; resetsAt: string; observedAt: number } }
export function normalizeEndpoint(value: unknown): string | null
export function validateQuotaResult(value: unknown, now: number): QuotaResult
export function parseQuotaResult(text: string, now: number): QuotaResult
export function activeQuota(state: unknown): boolean
export function quotaOff(state: unknown): boolean
export function selectQuota(endpoint: unknown, state: unknown): QuotaSelection | null
export function evaluateQuota(selection: QuotaSelection | null | undefined, state: unknown, now: number, mark?: number): QuotaView | null
