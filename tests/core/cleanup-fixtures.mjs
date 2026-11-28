// What the cleanup tests share: a PATH with git and a stub gh, and small helpers to build branches and worktrees.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmp, git } from './helpers.mjs'
import { repoKey } from '../../lib/key.mjs'

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/cleanup.mjs')

// git alone on PATH, or git with a stub gh that prints the file named by GH_STUB and fails when it is unset:
// no test reaches GitHub or the person's own gh.
const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim()
process.env.GIT_EXEC_PATH = execPath
export const onlyGit = tmp('bin-git')
export const withGh = tmp('bin-gh')
for (const dir of [onlyGit, withGh]) fs.symlinkSync(`${execPath}/git`, `${dir}/git`)
fs.writeFileSync(`${withGh}/gh`, '#!/bin/sh\n[ -n "$GH_STUB" ] && exec /bin/cat "$GH_STUB"\nexit 1\n', { mode: 0o755 })
process.env.PATH = withGh
delete process.env.GH_STUB
process.env.CLAUDE_CONFIG_DIR = tmp('claude') // no open sessions unless a test writes one
// the many commits and merges would each start git's background upkeep, which nothing here needs
Object.assign(process.env, { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'maintenance.auto', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'gc.auto', GIT_CONFIG_VALUE_1: '0' })

export const sha = (dir, ref = 'HEAD') => git(dir, 'rev-parse', ref)
export function commit(dir, file) {
  fs.writeFileSync(`${dir}/${file}`, `${file}\n`)
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', file)
  return sha(dir)
}
// one git process writes the commit, and a real merge into main (two parents, main's files kept) when asked, in place of a checkout, a commit and a merge each
export function branch(repo, name, { merge = false } = {}) {
  const file = `${name.replace(/\//g, '-')}.txt`
  const commit = (ref, msg, ...parents) => `commit ${ref}\ncommitter t <t@t> 1700000000 +0000\ndata ${msg.length}\n${msg}\n${parents.join('\n')}\nM 100644 inline ${file}\ndata 5\n${file.slice(0, 4)}\n\n`
  const stream = commit(`refs/heads/${name}`, file, 'from refs/heads/main') + (merge ? commit('refs/heads/main', `merge ${name}`, 'from refs/heads/main^0', `merge refs/heads/${name}`) : '')
  execFileSync('git', ['fast-import', '--quiet'], { cwd: repo, input: stream })
  if (merge) git(repo, 'reset', '-q', '--hard') // main moved under its checkout
  return sha(repo, name)
}
export function worktree(repo, ...args) {
  const dir = `${tmp('wt')}/tree`
  git(repo, 'worktree', 'add', '-q', dir, ...args)
  return dir
}
export function runState(lcwHome, repo, id, state) {
  const dir = `${lcwHome}/repos/${repoKey(repo)}/runs/${id}`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(`${dir}/state.json`, JSON.stringify({ id, createdAt: 1, ...state }))
}
export const names = (list) => list.map((i) => (i.type === 'branch' ? `branch:${i.name}` : `worktree:${i.path}`)).sort()
export const branches = (repo) => git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n')
export function cli(args, cwd, lcwHome) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: { ...process.env, LCW_HOME: lcwHome }, encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

