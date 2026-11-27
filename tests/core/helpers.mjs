import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
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
// nor Claude Code's real config folder, which would decide whether the plugin under test counts as installed
delete process.env.CLAUDE_CONFIG_DIR

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

export function run(script, args, { home, cwd, session, input, env: more = {} } = {}) {
  const env = { ...process.env, ...gitEnv, LCW_HOME: home, LCW_LOAD: '0' } // the machine's real load would add a line
  delete env.CLAUDE_CODE_SESSION_ID
  delete env.CLAUDE_PID // the hook would read the real Claude Code's command line
  if (session) env.CLAUDE_CODE_SESSION_ID = session
  Object.assign(env, more)
  const r = spawnSync('node', [script, ...args], { cwd, env, input, encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

export const lcw = (args, opts) => run(CLI, args, opts)

/** A live process whose program is named claude, as Claude Code's is: node under a link of that name. Kill it when done. */
export function fakeClaude() {
  const bin = `${tmp('bin')}/claude`
  fs.symlinkSync(process.execPath, bin)
  const child = spawn(bin, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
  child.unref()
  for (let i = 0; i < 100 && !/claude/.test(execFileSync('ps', ['-o', 'args=', '-p', String(child.pid)], { encoding: 'utf8' })); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  return child
}
export const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

/** A scratch Claude Code config folder whose records name `plugin` as the installed LCW; pass it as CLAUDE_CONFIG_DIR. */
export function installedConfig(plugin = root) {
  const dir = tmp('claude')
  fs.mkdirSync(`${dir}/plugins`)
  fs.writeFileSync(`${dir}/plugins/known_marketplaces.json`, JSON.stringify({ lcw: { source: { source: 'github', repo: 'owner/lcw' }, installLocation: `${dir}/plugins/marketplaces/lcw` } }))
  fs.writeFileSync(`${dir}/plugins/installed_plugins.json`, JSON.stringify({ version: 2, plugins: { 'lcw@lcw': [{ scope: 'user', installPath: plugin, version: '1.0.0' }] } }))
  return dir
}

/** A repo, a home and a started run; returns paths and a bound helper. */
export function started(name = 'demo') {
  const home = tmp('home')
  const repo = makeRepo()
  const o = { home, cwd: repo, session: 's1' }
  const r = lcw(['start', name, '--title', 'Demo run'], o)
  const dir = /^folder: (.+)$/m.exec(r.out)[1]
  return { home, repo, o, dir, state: () => readJson(`${dir}/state.json`), cli: (...a) => lcw(a, o) }
}
