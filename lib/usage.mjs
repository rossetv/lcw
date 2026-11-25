// The account's usage figures as LCW keeps them in usage.json. Pure code, shared by the mod and the scripts.

/** Within one window the figure falls only when the limit is reset, and a reset takes it far down: a point or two lower is another session's slightly older figure. */
export const RESET_DROP = 5

/** When a reading was seen: its `seen`; for a stored record written before that was kept, the time it was written. */
const seenOf = (usage, written) => (Number.isFinite(usage?.seen) ? usage.seen : written && Number.isFinite(usage?.at) ? usage.at : null)

/**
 * Merge a new reading into the stored one. Every open session reports the figure it saw at its own last
 * reply, so an idle session's reading can be hours old. A reading says when its session saw it (`seen`),
 * and within one reset window the newer one stands: an older one is left out whether it is lower or, after
 * the limit was reset, higher. A newer one that is lower counts only as a reset. Where it is not known which
 * is newer, the higher is kept. A later reset time starts a new window.
 */
export function mergeUsage(stored, next) {
  if (!next?.sevenDay) return stored ?? null
  if (!stored?.sevenDay) return next
  const a = Date.parse(stored.sevenDay.resetsAt), b = Date.parse(next.sevenDay.resetsAt)
  if (Number.isFinite(a) && Number.isFinite(b) && b < a) return stored // an older window: ignore it
  if (Number.isFinite(a) && !Number.isFinite(b) && a > next.at) { // no reset time says nothing about the window: while the stored week runs, never lower it or lose its reset time
    return { ...next, sevenDay: { ...next.sevenDay, percentUsed: Math.max(stored.sevenDay.percentUsed ?? 0, next.sevenDay.percentUsed ?? 0), resetsAt: stored.sevenDay.resetsAt } }
  }
  if (!(Number.isFinite(a) && Number.isFinite(b) && a === b)) return next
  const was = stored.sevenDay.percentUsed ?? 0, now = next.sevenDay.percentUsed ?? 0
  const before = seenOf(stored, true), seen = seenOf(next, false)
  if (before === null || seen === null) return { ...next, sevenDay: { ...next.sevenDay, percentUsed: Math.max(was, now) } }
  if (seen < before) return stored
  return now >= was || was - now >= RESET_DROP ? next : stored
}

/** True when a gate's reset time has passed: the week it was written for is over. */
export const gateExpired = (gate, now) => Number.isFinite(Date.parse(gate?.resetsAt)) && Date.parse(gate.resetsAt) <= now
