export type Span = { t: string; c?: string; bg?: string; b?: boolean; id?: string; r?: boolean; href?: string; plain?: string }
export type Row = Span[]
export type CardAgent = {
  id: string; description: string; model: string; effort: string; tokens: number
  startTime: number; parentId?: string; status: string; quietMs: number
  held: boolean; heldMs: number; listedMs: number; hasChild: boolean
  spark: number[]; tokensWas: number; movedAt: number | null
  wave?: number
}
export type Seen = Record<string, { tokens: number; since: number; spark?: number[]; from?: number; base?: number; was?: number; movedAt?: number | null; heldSince?: number | null; listed?: number }>
export const SPARK_EVERY: number
export const SPARK_CELLS: number
export type SevenDay = { percentUsed: number; resetsAt?: string | null }
export type Gate = { reason: string; markPercent: number; usedPercent: number; resetsAt: string | null; at: number }
export type UsdGate = { reason: string; unit: 'usd'; markUsd: number; usedUsd: number; retryAt: number; retried: boolean; at: number }
type Money = import('../lib/spend.mjs').Money
type SpendRecord = import('../lib/spend.mjs').SpendRecord
type Billing = import('../lib/billing.mjs').Billing

export function isShown(state: any, now: number): boolean
export function cardPace(mode: string, working: boolean): 0 | 200 | 1000
export function cardMotion(pace: number, since: number, now: number): { step: number; tick?: number; beat?: number }
export function themeFrom(configRows: readonly { key: string; value: unknown }[] | undefined): 'dark' | 'light'
export function trackAgents(list: readonly any[] | undefined, seen: Seen | undefined, now: number): { agents: CardAgent[]; seen: Seen }
export function buttons(row: Row): { id?: string; spans: Span[] }[]
export function layout(row: Row, cols: number): { left: Row; gap: number; right: Row }
export type Totals = { agents: number; tokens: number; seen: Record<string, number>; used?: { main: number; agents: number } }
export function addTotals(totals: Partial<Totals> | null | undefined, list: readonly any[] | undefined, since?: number): Totals
export function addUsage(totals: Partial<Totals> | null | undefined, usage: any, byAgent: boolean): Totals
export function countsTurn(state: any, turnStartedAt: number): boolean
export function usageTokens(usage: any): number
export function agentTokens(agent: any): number
export function gateFor(state: any, sevenDay: SevenDay | null | undefined, now: number): Gate | null
export function gateFor(state: any, sevenDay: SevenDay | null | undefined, now: number, money: Money | null | undefined): Gate | UsdGate | null
export function gateIdentity(gate: any): string
export function quotaWakeEvidence(gate: any, quota: import('../lib/quota.mjs').QuotaView | null | undefined, now: number): { gate: string; evidence: string } | null
export function replacesGate(current: { unit?: string; resetsAt?: string | null } | null | undefined, next: Gate | UsdGate | null | undefined): boolean
export function wakeDue(gate: { resetsAt?: string | null; unit?: string; retryAt?: number } | null | undefined, now: number,
  wokeFor: string | number | null | undefined, billing?: Billing | string, quota?: import('../lib/quota.mjs').QuotaView | null): boolean
type QuotaSession = { billing?: Billing; quotaSelection?: import('../lib/quota.mjs').QuotaSelection | null; quotaDefaultBilling?: Billing }
export function quotaBilling(session: QuotaSession | null | undefined, quota: import('../lib/quota.mjs').QuotaView | null | undefined): Billing
export function measureStep(session: QuotaSession | null | undefined, rec: SpendRecord | null | undefined,
  reading: { weekly: unknown; cost: number | undefined; quota?: import('../lib/quota.mjs').QuotaView | null }, now: number): { billing: Billing; changed: boolean; record: SpendRecord | null; drop: boolean }
export function usdWakePrompt(root: string, markUsd: number | null): string
export function wakeable(state: any): boolean
export function reopenDue(state: any, gate: unknown, aliveAt: number | null | undefined, now: number): boolean
export function waveOfBrief(prompt: unknown, description: unknown, name: string | null | undefined): number | null
export function briefOf(head: unknown): string
export function usageFrom(rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[] | undefined, now: number, seen?: number):
  { at: number; seen?: number; sevenDay: SevenDay; source: string } | null
export function compactInstructions(state: any, runDir: string, step: string): string
export function resumePrompt(root: string, step: string): string
export function wakePrompt(root: string): string
export function completionPrompt(root: string): string
export function reopenPrompt(root: string): string
export function quietCounts(agents: readonly CardAgent[] | undefined, quietMs?: number, stalledMs?: number): { quiet: number; stalled: number }
export type Nudged = Record<string, { at: number; times: number; tokens?: number }>
export function nudgeable(state: any): boolean
export function stallNudges(agents: readonly CardAgent[] | undefined, nudged: Nudged | undefined, now: number, stalledMs?: number, againMs?: number):
  { due: (CardAgent & { times: number; why: 'still' | 'held' })[]; nudged: Nudged }
export type Told = Record<string, 1>
export function longNudges(agents: readonly CardAgent[] | undefined, told: Told | undefined, longMs?: number, stalledMs?: number):
  { due: (CardAgent & { why: 'long' })[]; told: Told }
export function stallPrompt(due: readonly (CardAgent & { times?: number; why?: 'still' | 'held' | 'long' })[], all: readonly CardAgent[] | undefined): string
export type Sat = { run?: string; waves?: Record<string, { since: number; queued: boolean; told?: number; mark?: string }>; last?: number; again?: number }
export type SittingWave = { n: number; queued: boolean; stage: string; waits: string; ms: number; again: boolean }
export function sittingWaves(state: any, agents: readonly { held?: boolean; wave?: number | null }[] | undefined, sat: Sat | undefined, now: number, sitMs?: number, againMs?: number, apartMs?: number):
  { due: SittingWave[]; sat: Sat }
export function sittingPrompt(due: readonly SittingWave[], unplaced?: number): string
export type Carry = { firstAt: number; kind: string; tries: number; dueAt: number | null }
export function carryFailed(carry: Carry | null | undefined, kind: string, now: number): Carry | null
export function carryDue(carry: Carry | null | undefined, now: number, blocked: boolean): { carry: Carry | null | undefined; send: number }
export function carryPrompt(kind: string, tries: number): string
