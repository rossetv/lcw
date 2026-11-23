import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const home = () => process.env.LCW_HOME || `${process.env.HOME}/.lcw`

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
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
      if (!/\.\d+\.tmp$/.test(name)) continue
      try { if (now - fs.statSync(`${dir}/${name}`).mtimeMs >= 3600_000) fs.rmSync(`${dir}/${name}`, { force: true }) } catch {}
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
