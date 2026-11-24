// What the session is doing, for the mascot: the record kept after each hook event. Pure.

// The ids of the failed calls already counted that the record keeps: enough for a batch of calls run together.
const KEPT_IDS = 16

/** The record after this event, or null when the event changes nothing. */
export function next(input, was, now) {
  const ids = Array.isArray(was?.failIds) ? was.failIds : []
  const fails = { fails: was?.fails ?? 0, ...(was?.failAt ? { failAt: was.failAt } : {}), ...(ids.length ? { failIds: ids } : {}) }
  switch (input.hook_event_name) {
    case 'SessionStart': return { state: 'start', at: now }
    case 'UserPromptSubmit': return { state: 'working', at: now, fails: 0 }
    case 'PostToolUseFailure': {
      // A call the person cancelled did not fail. One already counted is not counted again: the mod and an older
      // list of hooks can both hear the same failure.
      const id = input.tool_use_id
      if (input.is_interrupt || (id && ids.includes(id))) return null
      const failIds = id ? [...ids, id].slice(-KEPT_IDS) : ids
      return { state: was?.state ?? 'working', at: was?.at ?? now, fails: fails.fails + 1, failAt: now, ...(failIds.length ? { failIds } : {}) }
    }
    case 'Stop': return { state: 'done', at: now, ...fails }
    case 'StopFailure': return { state: 'failed', at: now, ...fails }
    case 'PreToolUse': return input.tool_name === 'AskUserQuestion' ? { state: 'needs', at: now, ...fails } : null
    case 'Notification':
      if (input.notification_type !== 'idle_prompt') return { state: 'needs', at: now, ...fails }
      // An interrupted turn ends without a Stop. The idle notice a minute later is the only sign that it ended,
      // so it closes a turn that still reads as working, and changes nothing else.
      return was?.state === 'working' ? { state: 'rest', at: now, ...fails } : null
    default: return null
  }
}
