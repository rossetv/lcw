// What the mod keeps in $.state: the values that must outlive a reload of its code within the session.

export type LcwCarry = { firstAt: number; kind: string; tries: number; dueAt: number | null }
export type LcwNudged = Record<string, { at: number; times: number; tokens?: number }>

declare module 'claude-code' {
  interface PluginState {
    lcw: {
      dismissed: Shaped<string[]>
      repliedAt: Shaped<number>
      told: Shaped<Record<string, 1>>
      nudged: Shaped<LcwNudged>
      carry: Shaped<{ session: string; carry: LcwCarry } | null>
    }
  }
}
