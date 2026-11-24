// Records what the session is doing, for the mascot beside the status rows: working, done, waiting for the
// person, and how many tool calls have failed in this turn. It prints nothing, blocks nothing, and whatever goes
// wrong it exits 0.
import fs from 'node:fs'

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  if (!input.agent_id) { // a subagent's events say nothing about the session's own turn
    const { activityFile } = await import('../lib/key.mjs')
    const { next } = await import('../lib/activity.mjs')
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
