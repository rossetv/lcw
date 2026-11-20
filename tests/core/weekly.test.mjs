import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmp, makeRepo, git } from './helpers.mjs'
import { repoKey } from '../../lib/key.mjs'

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/weekly.mjs')
const DAY = 24 * 3600 * 1000
const T0 = 1800000000000

// A scratch machine: LCW home, Claude config with LCW installed from the given source kind (or not at all).
function machine(source) {
  const lcw = tmp('lcw')
  const claude = tmp('claude')
  fs.mkdirSync(`${claude}/plugins`)
  if (source) {
    fs.writeFileSync(`${claude}/plugins/known_marketplaces.json`, JSON.stringify({ lcw: { source: { source }, installLocation: '/x' } }))
    fs.writeFileSync(`${claude}/plugins/installed_plugins.json`, JSON.stringify({ plugins: { 'lcw@lcw': [{ version: '1.0.0' }] } }))
  }
  return { lcw, claude }
}
function due(m, cwd, now = T0) {
  const r = spawnSync(process.execPath, [SCRIPT, 'due'], {
    cwd, encoding: 'utf8', env: { ...process.env, LCW_HOME: m.lcw, CLAUDE_CONFIG_DIR: m.claude, LCW_NOW: String(now) },
  })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
// a repo with one merged branch: a cleanup candidate
function repoWithCandidate() {
  const repo = makeRepo()
  git(repo, 'checkout', '-q', '-b', 'done-work')
  fs.writeFileSync(`${repo}/b.txt`, 'b\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'b')
  git(repo, 'checkout', '-q', 'main')
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge', 'done-work')
  return repo
}
const notGit = () => tmp('plain')

test('nothing due prints nothing: no install, outside git', () => {
  assert.equal(due(machine(null), notGit()), '')
})

test('an update from a git source asks once, naming the commands, and not again within 7 days', () => {
  const m = machine('github')
  const out = due(m, notGit())
  assert.match(out, /lcw:weekly skill and run its update check\. Scripts: '.*\/scripts'\.$/)
  assert.ok(out.length < 250, out)
  assert.equal(out.includes('\n'), false)
  assert.equal(readJson(`${m.lcw}/checks.json`).update, T0)
  assert.equal(due(m, notGit(), T0 + 6 * DAY), '')
  assert.match(due(m, notGit(), T0 + 8 * DAY), /update check/)
})

test('a directory source never gets an update prompt', () => {
  assert.equal(due(machine('directory'), notGit()), '')
})

test('cleanup is asked only with a candidate, once a week, and the time is recorded per repo', () => {
  const m = machine(null)
  const bare = makeRepo()
  assert.equal(due(m, bare), '') // nothing merged: no candidate, no prompt
  assert.equal(readJson(`${m.lcw}/repos/${repoKey(bare)}/checks.json`).cleanup, T0) // but the look is not repeated
  const repo = repoWithCandidate()
  const out = due(m, repo)
  assert.match(out, /lcw:weekly skill and run its cleanup check/)
  assert.ok(out.length < 250, out)
  assert.equal(readJson(`${m.lcw}/repos/${repoKey(repo)}/checks.json`).cleanup, T0)
  assert.equal(due(m, repo, T0 + 3 * DAY), '')
  assert.match(due(m, repo, T0 + 8 * DAY), /cleanup check/)
})

test('cleanup is not asked when the person said never for this repo, or a box is already recorded', () => {
  const never = machine(null)
  const repo = repoWithCandidate()
  fs.writeFileSync(`${never.lcw}/notices.json`, JSON.stringify({ [`cleanup:${repoKey(repo)}`]: 'never' }))
  assert.equal(due(never, repo), '')
  const boxed = machine(null)
  fs.mkdirSync(`${boxed.lcw}/repos/${repoKey(repo)}`, { recursive: true })
  fs.writeFileSync(`${boxed.lcw}/repos/${repoKey(repo)}/cleanup.json`, JSON.stringify({ title: 't', items: [] }))
  assert.equal(due(boxed, repo), '')
})

test('outside git nothing is claimed and no repo folder is left behind', () => {
  const m = machine(null)
  assert.equal(due(m, notGit()), '')
  assert.equal(fs.existsSync(`${m.lcw}/repos`), false)
})

test('a recorded box whose items are no longer candidates is dropped and the check asks again', () => {
  const m = machine(null)
  const repo = repoWithCandidate()
  const dir = `${m.lcw}/repos/${repoKey(repo)}`
  fs.mkdirSync(dir, { recursive: true })
  const head = git(repo, 'rev-parse', 'done-work')
  const box = (items) => fs.writeFileSync(`${dir}/cleanup.json`, JSON.stringify({ title: 'done-work', items }))
  box([{ type: 'branch', name: 'done-work', head }])
  assert.equal(due(m, repo), '') // still a candidate: the box stays
  assert.equal(fs.existsSync(`${dir}/cleanup.json`), true)
  git(repo, 'branch', '-q', '-D', 'done-work')
  assert.equal(due(m, repo), '') // gone: dropped, and no candidate to ask about
  assert.equal(fs.existsSync(`${dir}/cleanup.json`), false)
})

test('with both due, one prompt per call: update first, then cleanup on the next call', () => {
  const m = machine('github')
  const repo = repoWithCandidate()
  assert.match(due(m, repo), /update check/)
  const second = due(m, repo)
  assert.match(second, /cleanup check/)
  assert.doesNotMatch(second, /update check/)
  assert.equal(due(m, repo), '')
})

test('a check another session has just taken is not asked again', () => {
  const m = machine('github')
  fs.writeFileSync(`${m.lcw}/checks.json.lock`, '')
  assert.equal(due(m, notGit()), '')
  assert.equal(fs.existsSync(`${m.lcw}/checks.json`), false)
})

test('the script paths in the prompt are quoted, so a folder with a space still runs', () => {
  const dir = `${tmp('sp')}/my plugin`
  fs.mkdirSync(`${dir}/scripts/lib`, { recursive: true })
  fs.cpSync(path.dirname(SCRIPT), `${dir}/scripts`, { recursive: true })
  fs.cpSync(path.resolve(path.dirname(SCRIPT), '../lib'), `${dir}/lib`, { recursive: true })
  const m = machine('github')
  const r = spawnSync(process.execPath, [`${dir}/scripts/weekly.mjs`, 'due'], {
    cwd: notGit(), encoding: 'utf8', env: { ...process.env, LCW_HOME: m.lcw, CLAUDE_CONFIG_DIR: m.claude, LCW_NOW: String(T0) },
  })
  assert.ok(r.stdout.includes(`Scripts: '${dir}/scripts'.`), r.stdout + r.stderr)
})
