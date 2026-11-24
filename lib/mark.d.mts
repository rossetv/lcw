import type { QuotaView } from './quota.mjs'
export function lcwOnly(command: unknown): boolean
export function atMark(mark: number | null, usage: { sevenDay?: { percentUsed: number; resetsAt?: string } | null } | null | undefined, now?: number, money?: { spentUsd: number; markUsd: number } | null): boolean
export function toldFile(lcwHome: string, sessionId: string): string
export function lcwCommand(root: string): string
export function quotaLine(view: QuotaView): string
export function paygLines(cli: string, money: { markUsd: number; markShare: number | null; capUsd: number; capAssumed: boolean }): string[]
export function stopTexts(facts: {
  event: string
  lcwCall: boolean
  hasRun: boolean
  /** The lcw command line, when the once-only note is due. */
  cli?: string | null
  money?: any
  quota?: QuotaView | null
  heldQuota?: QuotaView | null
  mark: number
  usage?: any
  now: number
  driverHeld?: boolean
  driverMoney?: any
  driverMark?: number | null
}): string[]
