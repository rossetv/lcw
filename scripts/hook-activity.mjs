// Records what the session is doing, for the mascot beside the status rows: working, done, waiting for the
// person, and how many tool calls have failed in this turn. It prints nothing, blocks nothing, and whatever goes
// wrong it exits 0.
import fs from 'node:fs'

/** The record after this event, or null when the event changes nothing. */
function next(input, was, now) {
  const fails = { fails: was?.fails ?? 0, ...(was?.failAt ? { failAt: was.failAt } : {}) }
  switch (input.hook_event_name) {
    case 'SessionStart': return { state: 'start', at: now }
    case 'UserPromptSubmit': return { state: 'working', at: now, fails: 0 }
    case 'PostToolUseFailure': // a call the person cancelled did not fail
      return input.is_interrupt ? null : { state: was?.state ?? 'working', at: was?.at ?? now, fails: fails.fails + 1, failAt: now }
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

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  if (!input.agent_id) { // a subagent's events say nothing about the session's own turn
    const { activityFile } = await import('../lib/key.mjs')
    const { home, readJson, writeJson } = await import('./lib/store.mjs')
    const { sessionIds } = await import('./lib/gate.mjs')
    const id = sessionIds(input)[0] // the id the status line looks under
    if (id) {
      const file = activityFile(home(), id)
      const record = next(input, readJson(file), Date.now())
      if (record) writeJson(file, record)
      if (input.hook_event_name === 'SessionEnd') fs.rmSync(file, { force: true }) // a session that comes back starts a new one
    }
  }
} catch {}
process.exit(0)
