export interface SpendRecord { v: 1; base: number; max: number; q: Record<string, number> }
export interface Pace { usd: number; short: boolean }
export interface Money {
  spentUsd: number; todayUsd: number; ratePerDay: number; capUsd: number; capAssumed: boolean
  markUsd: number; markShare: number | null; pace: Pace; atMark: boolean; runUsd?: number
  retryAt?: number; retried?: boolean; command?: SpendCommandView
}
export interface SpendReading { usd: number; at: number; fails: number; failingSince: number | null; lastError: string | null }
export interface SpendCommandView {
  readingUsd: number; at: number; sinceUsd: number; failing: boolean; failingSince: number | null; lastError: string | null
}
export const DEFAULT_CAP_USD: number
export const SPEND_COMMAND_FAILS: number
export function readingOf(setting: unknown, reading: unknown): SpendReading | null
export function spendFileCounts(mtimeMs: number, now: number): boolean
export function recordReading(rec: SpendRecord | null | undefined, rawCost: unknown, now: number): SpendRecord | null
export function spendSince(records: SpendRecord[], t: number, now: number): number
export function machineSpend(records: SpendRecord[], now: number): { week: number; today: number }
export function ratePerDay(today: number, now: number): number
export function pacePeak(records: SpendRecord[], rate: number, now: number): number
export function pace(peak: number, cap: number): Pace
export function markUsdOf(session: { markUsd?: number | null; markPercent?: number | null } | null | undefined, cap: number): number
export function next0800(now: number): number
export function runSpend(state: { usdBefore?: number; usdAtStart?: number } | null | undefined, sessionCum: number): number
export function moneyFrom(args: {
  records: SpendRecord[]; cap: { usd?: number } | number | null | undefined
  session: { markUsd?: number | null; markPercent?: number | null } | null | undefined
  state?: { usdBefore?: number; usdAtStart?: number } | null; sessionCum?: number; now: number; reading?: SpendReading | null
}): Money
