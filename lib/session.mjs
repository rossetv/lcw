// How a session's settings are read from its rows (the session files under its names), as the hooks read them. Pure,
// so the mod reads them the same way: row(name) is the row as read (null when there is none), alive(pid) whether that
// process runs, and pid the caller's CLAUDE_PID (0 when unset).
import { thresholds } from './theme.mjs'

/** The anchor a row points at (its sessionCanonicalId) when that is a name a session file may have, else null. */
export function anchorName(session) {
  const anchor = session?.sessionCanonicalId
  return typeof anchor === 'string' && /^[\w.-]{1,256}$/.test(anchor) && !/^\.+$/.test(anchor) ? anchor : null
}

/**
 * The name of the row that holds the settings of the row named id: the anchor it points at, when the anchor points at
 * itself and is not kept by another Claude Code still running; else id itself.
 */
export function sessionAnchor(id, row, alive, pid) {
  if (!id) return id
  const own = row(id)
  const anchor = anchorName(own)
  if (!anchor) return id
  const target = row(anchor)
  const caller = own?.claudePid || pid
  if (anchor !== id && alive(target?.claudePid) && target.claudePid !== caller) return id
  return target?.sessionCanonicalId === anchor ? anchor : id
}

/**
 * The rows the hooks rewrite, before they read anything, for a session known by several names: the anchor of the first
 * and each name take that anchor and one mark, the last name's own unless it already points at an anchor, and the
 * anchor's run. By name, only the rows that change; none while the anchor is another running Claude Code's, its run
 * is another, or the last name points at an anchor of its own.
 */
export function aliasRows(ids, row, alive, pid) {
  const rows = [].concat(ids ?? []).filter(Boolean).map((id) => ({ id, session: row(id) ?? {} }))
  const out = {}
  if (rows.length < 2) return out
  const anchorId = sessionAnchor(rows[0].id, row, alive, pid)
  const anchor = row(anchorId) ?? {}
  const current = rows.at(-1)
  const own = pid || current.session.claudePid
  if (alive(anchor.claudePid) && anchor.claudePid !== own) return out
  if (current.session.runDir && anchor.runDir && current.session.runDir !== anchor.runDir) return out
  if (current.session.sessionCanonicalId && sessionAnchor(current.id, row, alive, pid) !== anchorId) return out
  const mark = current.session.sessionCanonicalId ? anchor : typeof current.session.markPercent === 'number' || typeof current.session.markUsd === 'number' ? current.session : anchor
  for (const { id, session } of [{ id: anchorId, session: anchor }, ...rows.filter((r) => r.id !== anchorId)]) {
    const { markPercent, markUsd, ...rest } = session
    const next = { ...rest, sessionCanonicalId: anchorId, ...(typeof mark.markUsd === 'number' ? { markUsd: mark.markUsd } : typeof mark.markPercent === 'number' ? { markPercent: mark.markPercent } : {}) }
    if (!next.runDir && anchor.runDir) next.runDir = anchor.runDir
    if (JSON.stringify(next) !== JSON.stringify(session)) out[id] = next
  }
  return out
}

/**
 * What the hooks read of a session known by ids: names, each id's anchor then the id; rows, theirs in that order (an
 * empty one where there is none); mark, the usage mark (the first anchor's percent mark, else the default); money,
 * the row the money view takes its mark from (the first with a mark in either unit); quotaSelection, the outside
 * quota of the first row that records one.
 */
export function sessionPick(ids, row, alive, pid) {
  const list = [].concat(ids ?? []).filter(Boolean)
  const anchors = list.map((id) => sessionAnchor(id, row, alive, pid))
  const percent = anchors.map((name) => row(name)?.markPercent).find((m) => typeof m === 'number')
  const names = [...new Set(list.flatMap((id, i) => [anchors[i], id]))]
  const rows = names.map((name) => row(name) ?? {})
  return {
    names,
    rows,
    mark: percent ?? thresholds.usageMarkPercent,
    money: rows.find((s) => typeof s.markUsd === 'number' || typeof s.markPercent === 'number') ?? null,
    quotaSelection: rows.find((s) => Object.hasOwn(s, 'quotaSelection'))?.quotaSelection,
  }
}

/** The usage mark of a run: its driver's, where a mark in dollars counts as the default share; else the run's own. */
export function runMark(state, row, alive, pid) {
  const session = state.driver ? row(sessionAnchor(state.driver, row, alive, pid)) : null
  return session?.markPercent ?? (session?.markUsd != null ? thresholds.usageMarkPercent : state.markPercent ?? thresholds.usageMarkPercent)
}

/** A row's billing: its own, or with an outside quota selected a subscription, unless that quota is turned off (off). */
export function rowBilling(session, off) {
  if (!session?.quotaSelection) return session?.billing
  return off ? session.quotaDefaultBilling ?? 'unclear' : 'subscription'
}

/** A session's billing from its rows, in sessionPick's order. */
export function rowsBilling(rows, off) {
  const source = rows.find((session) => Object.hasOwn(session, 'quotaSelection'))
  if (source?.quotaSelection && rowBilling(source, off) === 'subscription') return 'subscription'
  return rowBilling(rows.find((session) => typeof session.billing === 'string' || session.quotaSelection), off)
}
