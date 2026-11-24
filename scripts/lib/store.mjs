import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const home = () => process.env.LCW_HOME || `${process.env.HOME}/.lcw`

// While a process holds its reads, each file is read from disk once: later reads get the same text, or what this
// process wrote or removed since. The text is kept, not the parsed value, so no caller can change another's copy.
let held = null

/** Holds reads (see above) until called with false. Only a short process that reads its records once may hold them. */
export function holdReads(on = true) { held = on ? new Map() : null }

/** Forgets what was held, so the next reads come from disk: for work under a lock, where what was read before it may be old. */
export function forgetReads() { if (held) held = new Map() }

/** A file's text, or null when it cannot be read. */
export function readText(file) {
  if (held?.has(file)) return held.get(file)
  let text = null
  try { text = fs.readFileSync(file, 'utf8') } catch {}
  held?.set(file, text)
  return text
}

export function readJson(file) {
  const text = readText(file)
  try { return text === null ? null : JSON.parse(text) } catch { return null }
}

export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
  held?.set(file, String(text))
}

/** Removes a file if it is there. */
export function removeFile(file) {
  if (fs.existsSync(file)) fs.rmSync(file, { force: true })
  held?.set(file, null)
}

export const writeJson = (file, value) => writeAtomic(file, JSON.stringify(value, null, 2) + '\n')

/**
 * Removes what writeAtomic leaves when its process is stopped between the write and the rename: files named
 * <file>.<pid>.tmp, once they are an hour old, in LCW's home folder and the folders in it that the status line,
 * the hooks and setup write to. Run folders are left alone: a temp file there is rare, and listing every run at
 * each session start would cost more with every run.
 */
export function sweepTemp(lcwHome, now = Date.now()) {
  for (const dir of [lcwHome, ...['bin', 'cache', 'sessions', 'spend', 'activity', 'places'].map((d) => `${lcwHome}/${d}`)]) {
    let names = []
    try { names = fs.readdirSync(dir) } catch { continue }
    for (const name of names) {
      // a folder's git record is asked again at its next tick; diff records are no longer read at all
      const cache = dir === `${lcwHome}/cache`
      const age = /\.\d+\.tmp$/.test(name) ? 3600_000 : cache && /^git-.*\.json$/.test(name) ? 86400_000 : cache && /^diff-.*\.json$/.test(name) ? 0 : null
      if (age === null) continue
      try { if (now - fs.statSync(`${dir}/${name}`).mtimeMs >= age) fs.rmSync(`${dir}/${name}`, { force: true }) } catch {}
    }
  }
}

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Root of the main working tree, also when called from a worktree. Outside git: cwd. */
export function mainCheckout(cwd) {
  try {
    // Not --path-format=absolute, which git before 2.31 prints back as output: git's answer can be relative to the real cwd.
    const common = fs.realpathSync(path.resolve(fs.realpathSync(cwd), git(cwd, 'rev-parse', '--git-common-dir')))
    return path.basename(common) === '.git' ? path.dirname(common) : git(cwd, 'rev-parse', '--show-toplevel')
  } catch {
    return cwd
  }
}

export const loadState = (paths) => readJson(paths.state)

export function saveState(paths, state) {
  state.updatedAt = Date.now()
  writeJson(paths.state, state)
}

export function appendLedger(paths, text) {
  fs.appendFileSync(paths.ledger, `- ${new Date().toISOString()} ${text}\n`)
}
