import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const home = () => process.env.LCW_HOME || `${process.env.HOME}/.lcw`

// While a process holds its reads, each file is read from disk once: later reads get the same text, or what this
// process wrote or removed since. The text is kept, not the parsed value, so no caller can change another's copy.
let held = null
// Every file read, written or removed while reads are held: whether it was there after, and its text when every read
// and write of it gave the same one (undefined when they did not). What the reads depended on.
let seen = null
const note = (file, text) => { const was = seen.get(file); seen.set(file, { there: text !== null, text: !was || was.text === text ? text : undefined }) }

/**
 * Holds reads (see above) until called with false. Only a short process that reads its records once may hold them.
 * `known` gives [path, text] pairs this process has already read from disk, which count as read once touched.
 */
export function holdReads(on = true, known = []) { held = on ? new Map(known) : null; seen = on ? new Map() : null }

/** The files touched since reads were held, as [path, whether it is there, its one text or undefined]. */
export const heldFiles = () => [...(seen ?? [])].map(([file, { there, text }]) => [file, there, text])

/** Forgets what was held, so the next reads come from disk: for work under a lock, where what was read before it may be old. */
export function forgetReads() { if (held) held = new Map() }

/** A file's text, or null when it cannot be read. */
export function readText(file) {
  if (held?.has(file)) {
    const text = held.get(file)
    if (!seen.has(file)) note(file, text)
    return text
  }
  let text = null
  try { text = fs.readFileSync(file, 'utf8') } catch {}
  if (held) { held.set(file, text); note(file, text) }
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
  if (held) { held.set(file, String(text)); note(file, String(text)) }
}

/** Removes a file if it is there. */
export function removeFile(file) {
  if (fs.existsSync(file)) fs.rmSync(file, { force: true })
  if (held) { held.set(file, null); note(file, null) }
}

export const writeJson = (file, value) => writeAtomic(file, JSON.stringify(value, null, 2) + '\n')

/**
 * Removes what writeAtomic leaves when its process is stopped between the write and the rename: files named
 * <file>.<pid>.tmp, once they are an hour old, in LCW's home folder and the folders in it that the status line,
 * the hooks and setup write to. Run folders are left alone: a temp file there is rare, and listing every run at
 * each session start would cost more with every run.
 */
export function sweepTemp(lcwHome, now = Date.now()) {
  for (const dir of [lcwHome, ...['bin', 'cache', 'sessions', 'spend', 'activity', 'places', 'told'].map((d) => `${lcwHome}/${d}`)]) {
    let names = []
    try { names = fs.readdirSync(dir) } catch { continue }
    for (const name of names) {
      // a folder's git record is asked again at its next tick; diff records are no longer read at all; the record of a
      // once-only note goes a week after it was written, so a session open longer than that may hear the note once more
      const cache = dir === `${lcwHome}/cache`
      const age = /\.\d+\.tmp$/.test(name) ? 3600_000 : cache && /^git-.*\.json$/.test(name) ? 86400_000 : cache && /^diff-.*\.json$/.test(name) ? 0
        : dir === `${lcwHome}/told` && name.endsWith('.json') ? 7 * 86400_000 : null
      if (age === null) continue
      try { if (now - fs.statSync(`${dir}/${name}`).mtimeMs >= age) fs.rmSync(`${dir}/${name}`, { force: true }) } catch {}
    }
  }
  // A session's saved frames: every draw renames into its folder, so one not written for a day belongs to a session that ended.
  let sessions = []
  try { sessions = fs.readdirSync(`${lcwHome}/frames`) } catch {}
  for (const name of sessions) {
    try { if (now - fs.statSync(`${lcwHome}/frames/${name}`).mtimeMs >= 86400_000) fs.rmSync(`${lcwHome}/frames/${name}`, { recursive: true, force: true }) } catch {}
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
