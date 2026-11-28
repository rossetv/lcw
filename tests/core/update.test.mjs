import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmp, git, readJson } from './helpers.mjs' // first: it points HOME at a throwaway folder
import { updateFile } from '../../lib/key.mjs'

const SCRIPT = new URL('../../scripts/update.mjs', import.meta.url).pathname

// A marketplace clone that is a real git repository (version 0.1.0, then two commits and 0.2.0), built once and copied.
const template = tmp('update-clone')
fs.mkdirSync(`${template}/.claude-plugin`)
const writeVersion = (dir, v) => fs.writeFileSync(`${dir}/.claude-plugin/plugin.json`, JSON.stringify({ name: 'lcw', version: v }))
git(template, 'init', '-q', '-b', 'main')
writeVersion(template, '0.1.0')
git(template, 'add', '.')
git(template, 'commit', '-q', '-m', 'first')
const first = git(template, 'rev-parse', 'HEAD')
fs.writeFileSync(`${template}/a`, 'a')
git(template, 'add', '.')
git(template, 'commit', '-q', '-m', 'add the banner')
writeVersion(template, '0.2.0')
git(template, 'add', '.')
git(template, 'commit', '-q', '-m', 'fix the gauge')
const head = git(template, 'rev-parse', 'HEAD')

// `claude` and `gh` stand-ins, written once: macOS scans each new script the first time it runs, which takes a
// quarter of a second. What they do, and where they log, comes from the environment of each machine.
const stubs = tmp('update-stubs')
const stub = (name, body) => fs.writeFileSync(`${stubs}/${name}`, `#!/bin/sh\necho "${name} $*" >> "$STUB_LOG"\n${body}\n`, { mode: 0o755 })
stub('claude', `case "$2" in
  marketplace) [ "$STUB_REFRESH" = fail ] && { echo "network is down" >&2; exit 1; }; exit 0 ;;
  update)
    [ "$STUB_UPDATE" = fail ] && { echo "plugin update refused: disk full" >&2; exit 1; }
    if [ -n "$STUB_UPDATE_TO" ]; then
      sed -E "s/(version.:.)$STUB_INSTALLED/\\1$STUB_UPDATE_TO/" "$STUB_PLUGINS/installed_plugins.json" > "$STUB_PLUGINS/x" && mv "$STUB_PLUGINS/x" "$STUB_PLUGINS/installed_plugins.json"
    fi
    echo "Restart to apply changes"; exit 0 ;;
esac`)
stub('gh', '[ -n "$STUB_GH" ] || { echo "gh: not logged in" >&2; exit 1; }\nprintf \'%s\\n\' "$STUB_GH"')

/**
 * A scratch machine: Claude Code's plugin files and a copy of the marketplace clone. The stubs log their arguments
 * to calls.log.
 */
function machine({ source = { source: 'github', repo: 'o/lcw' }, gh = null, refresh = 'ok', update = 'ok', updateTo = '0.2.0', installed = '0.1.0', shallow = false } = {}) {
  const root = tmp('update')
  const conf = `${root}/claude`
  const clone = `${root}/clone`
  const lcwHome = `${root}/lcw`
  fs.mkdirSync(`${conf}/plugins`, { recursive: true })
  fs.cpSync(template, clone, { recursive: true })
  const version = (v) => writeVersion(clone, v)

  const json = (f, v) => fs.writeFileSync(f, JSON.stringify(v))
  json(`${conf}/plugins/known_marketplaces.json`, { lcw: { source, installLocation: clone } })
  const entry = { version: installed, gitCommitSha: shallow ? 'f'.repeat(40) : first, installPath: `${root}/cache` }
  json(`${conf}/plugins/installed_plugins.json`, { version: 2, plugins: { 'lcw@lcw': [entry] } })

  const stubEnv = { STUB_LOG: `${root}/calls.log`, STUB_REFRESH: refresh, STUB_UPDATE: update, STUB_UPDATE_TO: updateTo || '', STUB_INSTALLED: installed, STUB_PLUGINS: `${conf}/plugins`, STUB_GH: gh ? gh.join('\n') : '' }
  const run = (...args) => {
    const env = { ...process.env, ...stubEnv, CLAUDE_CONFIG_DIR: conf, LCW_HOME: lcwHome, PATH: `${stubs}:${process.env.PATH}` }
    const r = spawnSync('node', [SCRIPT, ...args], { env, encoding: 'utf8' })
    return { code: r.status, out: r.stdout, err: r.stderr }
  }
  const calls = () => (fs.existsSync(`${root}/calls.log`) ? fs.readFileSync(`${root}/calls.log`, 'utf8') : '')
  const record = () => readJson(updateFile(lcwHome))
  const seed = (v) => {
    fs.mkdirSync(lcwHome, { recursive: true })
    fs.writeFileSync(updateFile(lcwHome), JSON.stringify(v))
  }
  return { run, calls, record, seed, version, first, head, updateJson: updateFile(lcwHome) }
}

const AVAILABLE = { version: '0.2.0', from: '0.1.0', bullets: ['A banner', 'A gauge fix'], at: 5 }

test('a folder checkout is never checked: nothing printed, the marketplace not touched', () => {
  const m = machine({ source: { source: 'directory', path: '/x' } })
  const r = m.run('check')
  assert.deepEqual([r.code, r.out, r.err], [0, '', ''])
  assert.equal(m.calls(), '')
})

test('a newer version on GitHub prints the commit subjects gh gives for the installed commit to the head', () => {
  const m = machine({ gh: ['add the banner', 'fix the gauge'] })
  const r = m.run('check')
  assert.equal(r.code, 0)
  assert.deepEqual(JSON.parse(r.out), { version: '0.2.0', from: '0.1.0', changes: ['add the banner', 'fix the gauge'] })
  assert.match(m.calls(), /^claude plugin marketplace update lcw$/m)
  assert.match(m.calls(), new RegExp(`^gh api repos/o/lcw/compare/${m.first}\\.\\.\\.${m.head} `, 'm'))
})

test('a newer version without gh falls back to git log in the clone, newest first', () => {
  const m = machine({ source: { source: 'git', url: 'https://example.com/lcw.git' } })
  assert.deepEqual(JSON.parse(m.run('check').out).changes, ['fix the gauge', 'add the banner'])
  assert.doesNotMatch(m.calls(), /^gh /m) // not on GitHub: gh is not asked
  const failing = machine() // on GitHub, but gh cannot read it
  assert.deepEqual(JSON.parse(failing.run('check').out).changes, ['fix the gauge', 'add the banner'])
})

test('a newer version whose installed commit is not in the clone has no changes, and is still reported', () => {
  const m = machine({ shallow: true })
  const r = m.run('check')
  assert.equal(r.code, 0)
  assert.deepEqual(JSON.parse(r.out), { version: '0.2.0', from: '0.1.0', changes: [] })
})

test('a version that is not newer prints nothing and clears a stale available, keeping updated', () => {
  const m = machine()
  m.version('0.1.0')
  m.seed({ available: AVAILABLE, updated: { to: '0.1.0', from: '0.0.9', bullets: [], at: 1 } })
  const r = m.run('check')
  assert.deepEqual([r.code, r.out], [0, ''])
  assert.deepEqual(m.record(), { available: null, updated: { to: '0.1.0', from: '0.0.9', bullets: [], at: 1 } })
})

test('versions compare by number, not by text: 0.10.0 is newer than 0.9.0', () => {
  const m = machine({ installed: '0.9.0' })
  m.version('0.10.0')
  assert.equal(JSON.parse(m.run('check').out).version, '0.10.0')
})

test('a marketplace that cannot be refreshed is one plain line and a non-zero exit, nothing recorded', () => {
  const m = machine({ refresh: 'fail' })
  const r = m.run('check')
  assert.notEqual(r.code, 0)
  assert.equal(r.out, '')
  assert.match(r.err, /network is down/)
  assert.equal(r.err.trim().split('\n').length, 1)
  assert.equal(fs.existsSync(m.updateJson), false)
})

test('record writes the version and at most three bullets, and keeps what was updated', () => {
  const m = machine()
  m.seed({ available: null, updated: { to: '0.1.0', from: '0.0.9', bullets: ['old'], at: 1 } })
  const r = m.run('record', '--version', '0.2.0', '--from', '0.1.0', '--bullet', 'One', '--bullet', ' Two ', '--bullet', 'Three', '--bullet', 'Four')
  assert.equal(r.code, 0)
  const u = m.record()
  assert.deepEqual({ ...u.available, at: typeof u.available.at }, { version: '0.2.0', from: '0.1.0', bullets: ['One', 'Two', 'Three'], at: 'number' })
  assert.equal(u.updated.to, '0.1.0')
})

test('record without a version is refused and writes nothing', () => {
  const m = machine()
  const r = m.run('record', '--from', '0.1.0')
  assert.notEqual(r.code, 0)
  assert.equal(fs.existsSync(m.updateJson), false)
})

test('apply runs the plugin update and moves available to updated with its bullets', () => {
  const m = machine()
  m.seed({ available: AVAILABLE, updated: null })
  const r = m.run('apply')
  assert.equal(r.code, 0)
  assert.equal(r.out.trim().split('\n').length, 1)
  assert.match(m.calls(), /^claude plugin update lcw@lcw$/m)
  const u = m.record()
  assert.equal(u.available, null)
  assert.deepEqual({ ...u.updated, at: typeof u.updated.at }, { to: '0.2.0', from: '0.1.0', bullets: AVAILABLE.bullets, at: 'number' })
})

test('apply records the version now installed, not the one the check found, and drops bullets written for another', () => {
  const m = machine({ updateTo: '0.3.0' })
  m.seed({ available: AVAILABLE, updated: null })
  assert.equal(m.run('apply').code, 0)
  const u = m.record()
  assert.equal(u.available, null)
  assert.deepEqual({ to: u.updated.to, from: u.updated.from, bullets: u.updated.bullets }, { to: '0.3.0', from: '0.1.0', bullets: [] })
})

test('an update that exits 0 but changes nothing is said in one line, exits non-zero and records nothing', () => {
  const m = machine({ updateTo: null })
  m.seed({ available: AVAILABLE, updated: null })
  const r = m.run('apply')
  assert.notEqual(r.code, 0)
  assert.equal(r.err.trim().split('\n').length, 1)
  assert.deepEqual(m.record(), { available: AVAILABLE, updated: null })
})

test('a failed apply says why in the command\'s own words and leaves available as it was', () => {
  const m = machine({ update: 'fail' })
  m.seed({ available: AVAILABLE, updated: null })
  const r = m.run('apply')
  assert.notEqual(r.code, 0)
  assert.match(r.err, /plugin update refused: disk full/)
  assert.deepEqual(m.record(), { available: AVAILABLE, updated: null })
})
