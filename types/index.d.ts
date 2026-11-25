// What the mod keeps in $.state: the values that must outlive a reload of its code within the session.

export type LcwCompletion = Record<string, { at: number; tries: number; sent: boolean }>
export type LcwCarry = { firstAt: number; kind: string; tries: number; dueAt: number | null }
export type LcwNudged = Record<string, { at: number; times: number; tokens?: number }>
export type LcwSat = { run?: string; waves?: Record<string, { since: number; queued: boolean; told?: number; mark?: string }>; last?: number; again?: number }

declare module 'claude-code' {
  interface PluginState {
    lcw: {
      dismissed: Shaped<string[]>
      repliedAt: Shaped<number>
      told: Shaped<Record<string, 1>>
      nudged: Shaped<LcwNudged>
      waves: Shaped<Record<string, number>>
      sat: Shaped<LcwSat>
      completion: Shaped<LcwCompletion>
      carry: Shaped<{ session: string; carry: LcwCarry } | null>
      owed: Shaped<{ session: string; runDir: string; text: string } | null>
    }
  }
}
