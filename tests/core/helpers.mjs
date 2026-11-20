import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const CLI = `${root}/scripts/lcw.mjs`
export const START_HOOK = `${root}/scripts/hook-session-start.mjs`
export const GATE_HOOK = `${root}/scripts/hook-agent-gate.mjs`
export const LIMIT_HOOK = `${root}/scripts/hook-limit.mjs`
export const ACTIVITY_HOOK = `${root}/scripts/hook-activity.mjs`

export const tmp = (label) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `lcw-${label}-`)))

// No test may reach the real home. Every process a test starts inherits this throwaway HOME, so code that
// loses LCW_HOME falls back to a temporary folder and not to the person's own ~/.lcw.
process.env.HOME = tmp('home-guard')

const gitEnv = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...gitEnv } }).trim()
}

export function makeRepo() {
  const dir = tmp('repo')
  git(dir, 'init', '-q', '-b', 'main')
  fs.writeFileSync(`${dir}/a.txt`, 'one\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

export function run(script, args, { home, cwd, session, input } = {}) {
  const env = { ...process.env, ...gitEnv, LCW_HOME: home }
  delete env.CLAUDE_CODE_SESSION_ID
  delete env.CLAUDE_PID // the hook would read the real Claude Code's command line
  if (session) env.CLAUDE_CODE_SESSION_ID = session
  const r = spawnSync('node', [script, ...args], { cwd, env, input, encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

export const lcw = (args, opts) => run(CLI, args, opts)
export const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

/** A repo, a home and a started run; returns paths and a bound helper. */
export function started(name = 'demo') {
  const home = tmp('home')
  const repo = makeRepo()
  const o = { home, cwd: repo, session: 's1' }
  const r = lcw(['start', name, '--title', 'Demo run'], o)
  const dir = /^folder: (.+)$/m.exec(r.out)[1]
  return { home, repo, o, dir, state: () => readJson(`${dir}/state.json`), cli: (...a) => lcw(a, o) }
}
