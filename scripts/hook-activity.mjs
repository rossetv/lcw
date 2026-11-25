// Records what the session is doing, for the mascot beside the status rows: working, done, waiting for the
// person, how many tool calls have failed in this turn, and the error kind that ended a failed turn. It prints
// nothing, blocks nothing, and whatever goes wrong it exits 0.
import fs from 'node:fs'
import path from 'node:path'

const STALE_MS = 2000
const WAIT_MS = 400

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// Hooks of parallel calls run at once, and each reads the record and rewrites it: without the lock two failures count as one.
// Returns whether the lock is held; on giving up the caller goes ahead anyway, since a hook never blocks a call.
function lock(file) {
  const end = Date.now() + WAIT_MS
  for (;;) {
    try { fs.writeFileSync(file, '', { flag: 'wx' }); return true } catch {}
    try { if (Date.now() - fs.statSync(file).mtimeMs > STALE_MS) { fs.rmSync(file, { force: true }); continue } } catch {}
    if (Date.now() >= end) return false
    pause(10)
  }
}

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
      const lockFile = `${file}.lock`
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const held = lock(lockFile)
      try {
        const record = next(input, readJson(file), Date.now())
        if (record) writeJson(file, record)
        if (input.hook_event_name === 'SessionEnd') fs.rmSync(file, { force: true }) // a session that comes back starts a new one
      } finally {
        if (held) fs.rmSync(lockFile, { force: true })
      }
    }
  }
} catch {}
process.exit(0)
