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

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
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
