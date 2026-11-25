export interface Usage { at?: number; seen?: number; sevenDay?: { percentUsed: number; resetsAt: string }; source?: string }
export function mergeUsage(stored: Usage | null | undefined, next: Usage | null | undefined): Usage | null
export function gateExpired(gate: { resetsAt?: string } | null | undefined, now: number): boolean
