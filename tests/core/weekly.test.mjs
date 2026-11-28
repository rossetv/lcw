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

// A `claude` stand-in written once: macOS scans each new script the first time it runs, which takes a quarter of a
// second. claude logs to STUB_LOG and refreshes, or fails when STUB_REFRESH says so.
const stubs = tmp('weekly-stubs')
fs.writeFileSync(`${stubs}/claude`, '#!/bin/sh\necho "claude $*" >> "$STUB_LOG"\n[ "$STUB_REFRESH" = fail ] && { echo "network is down" >&2; exit 1; }\nexit 0\n', { mode: 0o755 })
fs.writeFileSync(`${stubs}/gh`, '#!/bin/sh\nexit 1\n', { mode: 0o755 }) // the cleanup check asks gh about merged pull requests: never the real one

// A scratch machine: LCW home, Claude config with LCW 1.0.0 installed from the given source kind (or not at all), its
// marketplace clone holding `latest`, and the `claude` stub first on PATH.
function machine(source, { latest = '1.0.0', refresh = 'ok' } = {}) {
  const lcw = tmp('lcw')
  const claude = tmp('claude')
  const clone = tmp('clone')
  const bin = tmp('bin')
  fs.mkdirSync(`${claude}/plugins`)
  fs.mkdirSync(`${clone}/.claude-plugin`)
  const publish = (v) => fs.writeFileSync(`${clone}/.claude-plugin/plugin.json`, JSON.stringify({ name: 'lcw', version: v }))
  publish(latest)
  if (source) {
    fs.writeFileSync(`${claude}/plugins/known_marketplaces.json`, JSON.stringify({ lcw: { source: { source }, installLocation: clone } }))
    fs.writeFileSync(`${claude}/plugins/installed_plugins.json`, JSON.stringify({ plugins: { 'lcw@lcw': [{ version: '1.0.0' }] } }))
  }
  const calls = () => (fs.existsSync(`${bin}/calls.log`) ? fs.readFileSync(`${bin}/calls.log`, 'utf8').trim().split('\n') : [])
  const env = (now) => ({ ...process.env, LCW_HOME: lcw, CLAUDE_CONFIG_DIR: claude, LCW_NOW: String(now), STUB_LOG: `${bin}/calls.log`, STUB_REFRESH: refresh, PATH: `${stubs}:${process.env.PATH}` })
  return { lcw, claude, publish, calls, env }
}
function weekly(cmd, m, cwd, now, script = SCRIPT) {
  const r = spawnSync(process.execPath, [script, cmd], { cwd, encoding: 'utf8', env: m.env(now) })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
const due = (m, cwd, now = T0) => weekly('due', m, cwd, now)
const update = (m, now = T0) => weekly('update', m, notGit(), now)
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
// a repo with one merged branch: a cleanup candidate; built once, then copied
const candidateTemplate = makeRepo()
git(candidateTemplate, 'checkout', '-q', '-b', 'done-work')
fs.writeFileSync(`${candidateTemplate}/b.txt`, 'b\n')
git(candidateTemplate, 'add', '.')
git(candidateTemplate, 'commit', '-q', '-m', 'b')
git(candidateTemplate, 'checkout', '-q', 'main')
git(candidateTemplate, 'merge', '-q', '--no-ff', '-m', 'merge', 'done-work')
function repoWithCandidate() {
  const repo = tmp('repo')
  fs.cpSync(candidateTemplate, repo, { recursive: true })
  return repo
}
const notGit = () => tmp('plain')

test('nothing due prints nothing, and outside git no repo folder is left behind', () => {
  const m = machine(null)
  assert.equal(due(m, notGit()), '')
  assert.equal(fs.existsSync(`${m.lcw}/repos`), false)
})

test('a newer version on the marketplace asks for the update check in one short line', () => {
  const m = machine('github', { latest: '1.1.0' })
  const out = update(m)
  assert.match(out, /lcw:weekly skill and run its update check/)
  assert.ok(out.endsWith(`Scripts: '${path.dirname(SCRIPT)}'.`), out)
  assert.ok(out.length < 250, out)
  assert.equal(out.includes('\n'), false)
  assert.deepEqual(m.calls(), ['claude plugin marketplace update lcw'])
})

test('an up-to-date copy asks nothing, and a session a minute later looks again', () => {
  const m = machine('github')
  assert.equal(update(m), '')
  m.publish('1.1.0')
  assert.match(update(m, T0 + 60000), /update check/)
  assert.equal(m.calls().length, 2)
})

test('a version the banner already has bullets for is not asked about; a newer one is', () => {
  const m = machine('github', { latest: '1.1.0' })
  const recorded = (version) => fs.writeFileSync(`${m.lcw}/update.json`, JSON.stringify({ available: { version, from: '1.0.0', bullets: ['b'], at: 1 } }))
  recorded('1.1.0')
  assert.equal(update(m), '')
  recorded('1.0.5')
  assert.match(update(m), /update check/)
})

test('a version another session asked about is left to it for an hour, then asked again', () => {
  const m = machine('github', { latest: '1.1.0' })
  assert.match(update(m), /update check/)
  assert.deepEqual(readJson(`${m.lcw}/checks.json`).updateAsked, { version: '1.1.0', at: T0 })
  assert.equal(update(m, T0 + 30 * 60000), '')
  m.publish('1.2.0')
  assert.match(update(m, T0 + 31 * 60000), /update check/) // a newer one is not anyone's yet
  assert.equal(update(m, T0 + 60 * 60000), '')
  assert.match(update(m, T0 + 92 * 60000), /update check/)
})

test('a folder install or none at all is never looked at: no refresh, no prompt', () => {
  for (const source of ['directory', 'file', null]) {
    const m = machine(source, { latest: '9.0.0' })
    assert.equal(update(m), '')
    assert.deepEqual(m.calls(), [], String(source))
  }
})

test('a refresh that fails asks nothing, records nothing and leaves no lock behind', () => {
  const m = machine('github', { latest: '1.1.0', refresh: 'fail' })
  assert.equal(update(m), '')
  assert.equal(m.calls().length, 1)
  assert.equal(fs.existsSync(`${m.lcw}/checks.json`), false)
  assert.equal(fs.existsSync(`${m.lcw}/checks.json.update.lock`), false)
})

test('a session that finds another one looking asks nothing; a lock a crash left is taken over', () => {
  const m = machine('github', { latest: '1.1.0' })
  const lock = `${m.lcw}/checks.json.update.lock`
  fs.writeFileSync(lock, '')
  assert.equal(update(m), '')
  assert.deepEqual(m.calls(), [])
  const old = (Date.now() - 4 * 60000) / 1000
  fs.utimesSync(lock, old, old)
  assert.match(update(m), /update check/)
  assert.equal(fs.existsSync(lock), false)
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

test('the weekly check never asks about an update: that is the session start\'s', () => {
  const m = machine('github', { latest: '1.1.0' })
  assert.match(due(m, repoWithCandidate()), /cleanup check/)
  assert.equal(due(m, notGit()), '')
  assert.deepEqual(m.calls(), [])
})

test('a cleanup check another session has just taken is not asked again', () => {
  const m = machine(null)
  const repo = repoWithCandidate()
  const file = `${m.lcw}/repos/${repoKey(repo)}/checks.json`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.lock`, '')
  assert.equal(due(m, repo), '')
  assert.equal(fs.existsSync(file), false)
})

test('the script paths in the prompt are quoted, so a folder with a space still runs', () => {
  const dir = `${tmp('sp')}/my plugin`
  fs.mkdirSync(`${dir}/scripts/lib`, { recursive: true })
  fs.cpSync(path.dirname(SCRIPT), `${dir}/scripts`, { recursive: true })
  fs.cpSync(path.resolve(path.dirname(SCRIPT), '../lib'), `${dir}/lib`, { recursive: true })
  const m = machine('github', { latest: '1.1.0' })
  const out = weekly('update', m, notGit(), T0, `${dir}/scripts/weekly.mjs`)
  assert.ok(out.includes(`Scripts: '${dir}/scripts'.`), out)
})
