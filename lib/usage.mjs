// The account's usage figures as LCW keeps them in usage.json. Pure code, shared by the mod and the scripts.

/**
 * Merge a new reading into the stored one. Every open session reports the figure it saw at its own last
 * reply, so an idle session's reading can be hours old and lower. Within one reset window the weekly
 * figure never goes down, so the higher one is kept; a later reset time starts a new window.
 */
export function mergeUsage(stored, next) {
  if (!next?.sevenDay) return stored ?? null
  if (!stored?.sevenDay) return next
  const a = Date.parse(stored.sevenDay.resetsAt), b = Date.parse(next.sevenDay.resetsAt)
  if (Number.isFinite(a) && Number.isFinite(b) && b < a) return stored // an older window: ignore it
  if (Number.isFinite(a) && !Number.isFinite(b) && a > next.at) { // no reset time says nothing about the window: while the stored week runs, never lower it or lose its reset time
    return { ...next, sevenDay: { ...next.sevenDay, percentUsed: Math.max(stored.sevenDay.percentUsed ?? 0, next.sevenDay.percentUsed ?? 0), resetsAt: stored.sevenDay.resetsAt } }
  }
  const sameWindow = Number.isFinite(a) && Number.isFinite(b) && a === b
  const percentUsed = sameWindow ? Math.max(stored.sevenDay.percentUsed ?? 0, next.sevenDay.percentUsed ?? 0) : next.sevenDay.percentUsed
  return { ...next, sevenDay: { ...next.sevenDay, percentUsed } }
}

/** True when a gate's reset time has passed: the week it was written for is over. */
export const gateExpired = (gate, now) => Number.isFinite(Date.parse(gate?.resetsAt)) && Date.parse(gate.resetsAt) <= now
