import fs from 'node:fs'
import path from 'node:path'
import { sessionFile, placeFile, runPaths } from '../../lib/key.mjs'
import { home, readJson, writeJson, loadState } from './store.mjs'

export const open = (runDir) => {
  if (!runDir) return null
  const paths = runPaths(runDir)
  const state = loadState(paths)
  if (!state || state.status === 'finished' || state.status === 'stopped') return null
  return { dir: runDir, paths, state }
}

export function bindSession(sessionId, runDir) {
  if (!sessionId) return
  const file = sessionFile(home(), sessionId)
  writeJson(file, { ...(readJson(file) || {}), runDir }) // its usage mark lives in the same file
}

/** Forgets that a session drives this run, when its binding still names it. */
export function unbindSession(sessionId, runDir) {
  if (!sessionId) return
  const file = sessionFile(home(), sessionId)
  const { runDir: bound, ...rest } = readJson(file) || {}
  if (bound === runDir) writeJson(file, rest)
}

/** The unfinished run a session drives: its binding first, else a place pointer at or above cwd. */
export function findRun({ sessionId, cwd }) {
  const h = home()
  if (sessionId) {
    const run = open(readJson(sessionFile(h, sessionId))?.runDir)
    if (run) return run
  }
  for (let dir = path.resolve(cwd || process.cwd()); ; dir = path.dirname(dir)) {
    const run = open(readJson(placeFile(h, dir))?.runDir)
    if (run) {
      bindSession(sessionId, run.dir)
      return run
    }
    if (dir === path.dirname(dir)) return null
  }
}

/** A run of a repository by its id, finished or not, or null when that repository has no such run. */
export function runOf(runsDir, id) {
  if (!/^[\w.-]+$/.test(String(id)) || /^\.+$/.test(id)) return null
  const dir = `${runsDir}/${id}`
  const paths = runPaths(dir)
  const state = loadState(paths)
  return state ? { dir, paths, state } : null
}

const mtime = (file) => { try { return fs.statSync(file).mtimeMs } catch { return 0 } }

/** When a session last showed the run (epoch ms): the mod's mark of drawing it, or its state or ledger changing. */
export function lastShown(paths) {
  let drawn = 0
  try { drawn = Number(fs.readFileSync(paths.modAlive, 'utf8').trim()) || 0 } catch {}
  return Math.max(drawn, mtime(paths.state), mtime(paths.ledger))
}

/** How many runs this machine has had, in every repository. */
export function machineRunCount() {
  const repos = `${home()}/repos`
  let n = 0
  try {
    for (const key of fs.readdirSync(repos)) try { n += fs.readdirSync(`${repos}/${key}/runs`).length } catch {}
  } catch {}
  return n
}

export function listRuns(runsDir) {
  let ids = []
  try { ids = fs.readdirSync(runsDir) } catch {}
  return ids
    .map((id) => ({ dir: `${runsDir}/${id}`, state: loadState(runPaths(`${runsDir}/${id}`)) }))
    .filter((r) => r.state)
    .sort((a, b) => b.state.createdAt - a.state.createdAt)
}
