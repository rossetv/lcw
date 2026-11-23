import type { Banner, BannerFacts, BannerRun } from '../lib/banner.mjs'

export const SHOWN_WITHIN_MS: number
export const WEEKLY_AFTER_MS: number
export const WEEKLY_EVERY_MS: number
export const RUNS_EVERY_MS: number
export const AWAKE_EVERY_MS: number
export const LEARN_TEXT: string

export function proxyQuotaEndpoint(value: unknown, configuration: any, ...sessions: any[]): string | null
export function runFact(state: any, kept?: boolean): BannerRun | null
export function awakeApplies(state: any): boolean
export function usageFact(args: { state?: any; session?: any; usage?: any; money?: any; quota?: import('../lib/quota.mjs').QuotaView | null; now: number }): NonNullable<BannerFacts['usage']>
export const BELOW_MARK_MS: number
export type MarkSpell = { since: number; below: number }
export function markSpell(prev: MarkSpell | null | undefined, atMark: boolean | undefined, now: number): MarkSpell
export function claudeCommand(args: string | null | undefined): boolean
export function spendFailingFact(reading: { fails: number; failingSince: number | null; lastError: string | null } | null | undefined): BannerFacts['spendFailing']
export function statusLineFact(setting: unknown, lcwHome: string): { command: string; mine: boolean } | null
export function nextStepOf(ledger: string | null | undefined): string | null
export type RunSeen = { dir: string; state: any; shownAt: number }
export function unfinishedCandidates(runs: readonly RunSeen[] | null | undefined, now: number, ownDir?: string | null, dismissed?: Set<string>): RunSeen[]
export function unfinishedFact(run: RunSeen, ledger: string | null | undefined): NonNullable<BannerFacts['unfinished']> & { status?: string; pausedReason?: string }
export type Idle = { interactive: boolean; turnRunning: boolean; driving: boolean; atMark?: boolean; startedAt: number; turnEndedAt?: number; now: number }
export function weeklyIdle(args: Idle): boolean
export function weeklyDue(args: Idle & { askedAt?: number }): boolean
export function awakeCheckWanted(state: any, notices: Record<string, unknown> | null | undefined, dismissed: Set<string> | undefined): boolean
export function dismissKeys(banner: Banner): string[]
export function approveText(banner: Banner, option: string): string | undefined
export function sameBox(drawn: Banner | null | undefined, fresh: Banner | null | undefined, option: string): boolean

export function raisePrompt(root: string, sessionId: string, run: BannerRun, label: string): string
export function resumePrompt(root: string, sessionId: string, unfinished: any, resumed: boolean): string
export function fixSpendPrompt(root: string, sessionId: string, failing: BannerFacts['spendFailing']): string
export function discussPrompt(root: string, cleanup: BannerFacts['cleanup'], cleanupPath: string): string

export type Step = { argv: string[]; timeoutMs?: number; halt?: RegExp }
export type Plan = {
  steps?: Step[]
  fail?: string
  notices?: Record<string, string>
  prompt?: { text: string; asUser?: true }
  promptFailed?: string
  owe?: string
  fill?: number
  fillText?: string
  proxyQuotaChoice?: { endpoint: string; choice: string }
  dismiss?: boolean
  toast?: string
}
export function pressPlan(banner: Banner | null | undefined, option: string, facts: BannerFacts | null | undefined,
  ctx: { root: string; sessionId: string; repoKey?: string; cleanupPath?: string }): Plan | null
export function said(result: { stdout?: string; stderr?: string } | null | undefined): string
