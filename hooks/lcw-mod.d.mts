export type Span = { t: string; c?: string; bg?: string; b?: boolean; id?: string; r?: boolean; href?: string; plain?: string }
export type Row = Span[]
export type CardAgent = {
  id: string; description: string; model: string; effort: string; tokens: number
  startTime: number; parentId?: string; status: string; quietMs: number
  spark: number[]; tokensWas: number; movedAt: number | null
}
export type Seen = Record<string, { tokens: number; since: number; spark?: number[]; from?: number; base?: number; was?: number; movedAt?: number | null }>
export const SPARK_EVERY: number
export const SPARK_CELLS: number
export type SevenDay = { percentUsed: number; resetsAt?: string | null }
export type Gate = { reason: string; markPercent: number; usedPercent: number; resetsAt: string | null; at: number }
export type UsdGate = { reason: string; unit: 'usd'; markUsd: number; usedUsd: number; retryAt: number; retried: boolean; at: number }
type Money = import('../lib/spend.mjs').Money
type SpendRecord = import('../lib/spend.mjs').SpendRecord
type Billing = import('../lib/billing.mjs').Billing

export function isShown(state: any, now: number): boolean
export function isAnimating(state: any): boolean
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
export function wakeDue(gate: { resetsAt?: string | null; unit?: string; retryAt?: number } | null | undefined, now: number,
  wokeFor: string | number | null | undefined, billing?: Billing | string): boolean
export function retryGate(gate: UsdGate, money: Money | null | undefined, now: number): UsdGate | null
export function measureStep(session: { billing?: Billing } | null | undefined, rec: SpendRecord | null | undefined,
  reading: { weekly: unknown; cost: number | undefined }, now: number): { billing: Billing; changed: boolean; record: SpendRecord | null; drop: boolean }
export function usdWakePrompt(root: string, markUsd: number | null): string
export function wakeable(state: any): boolean
export function reopenDue(state: any, gate: unknown, aliveAt: number | null | undefined, now: number): boolean
export function usageFrom(rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[] | undefined, now: number):
  { at: number; sevenDay: SevenDay; source: string } | null
export function compactInstructions(state: any, runDir: string, step: string): string
export function resumePrompt(root: string, step: string): string
export const COMPACT_AT: number
export function checkpointCompacts(context: { tokens?: number; window?: number } | undefined): boolean
export function keptPrompt(step: string): string
export function wakePrompt(root: string): string
export function reopenPrompt(root: string): string
export function quietCounts(agents: readonly CardAgent[] | undefined, quietMs?: number, stalledMs?: number): { quiet: number; stalled: number }
export type Nudged = Record<string, { at: number; times: number }>
export function nudgeable(state: any): boolean
export function stallNudges(agents: readonly CardAgent[] | undefined, nudged: Nudged | undefined, now: number, stalledMs?: number, againMs?: number):
  { due: (CardAgent & { times: number })[]; nudged: Nudged }
export function stallPrompt(due: readonly (CardAgent & { times: number })[], all: readonly CardAgent[] | undefined): string
