import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { gitOf } from '../../scripts/lib/diff.mjs'
import { tmp, lcw, readJson, makeRepo, git } from '../core/helpers.mjs'

const LINE = new URL('../../scripts/statusline.mjs', import.meta.url).pathname
const NOW = Date.UTC(2026, 2, 10, 12)

// Counts, in the process it is loaded into, the reads of each file and the git commands it starts.
const TRACER = tmp('tracer') + '/trace.mjs'
fs.writeFileSync(TRACER, `
import fs from 'node:fs'
import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
const reads = {}, gits = []
const read = fs.readFileSync, write = fs.writeFileSync, exec = cp.execFileSync
const count = (p) => { if (typeof p === 'string') reads[p] = (reads[p] ?? 0) + 1 }
// every way a file is read: whole, as a handle, as a stream; the promise forms too
for (const [o, names] of [[fs, ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream']], [fs.promises, ['readFile', 'open']]]) {
  for (const n of names) { const f = o[n]; o[n] = function (p, ...a) { count(p); return f.call(this, p, ...a) } }
}
cp.execFileSync = function (c, a, ...r) { if (c === 'git') gits.push(a.join(' ')); return exec.call(this, c, a, ...r) }
syncBuiltinESMExports()
process.on('exit', () => write(process.env.TRACE_OUT, JSON.stringify({ reads, gits })))
`)

function line(home, input, { now = NOW, trace = false } = {}) {
  const env = { ...process.env, LCW_HOME: home, COLUMNS: '120', TZ: 'UTC', LCW_NOW: String(now) }
  delete env.CLAUDE_PID
  const out = trace ? `${tmp('trace')}/out.json` : null
  if (out) env.TRACE_OUT = out
  const r = spawnSync('node', [...(out ? ['--import', TRACER] : []), LINE], { input: JSON.stringify(input), encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  return { text: r.stdout.replace(/\x1b\[[0-9;]*m/g, ''), ...(out ? readJson(out) : {}) }
}

const LAUNCHER = new URL('../../scripts/bin/statusline.mjs', import.meta.url).pathname
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')

/** One run of the launcher the settings' command starts, as it draws frames ahead from the second `at`. */
function launched(home, input, { now = NOW, bin } = {}) {
  const env = { ...process.env, LCW_HOME: home, COLUMNS: '120', TZ: 'UTC', LCW_NOW: String(now), TRACE_OUT: `${tmp('trace')}/out.json` }
  delete env.CLAUDE_PID
  const r = spawnSync('node', ['--import', TRACER, bin, `${Math.floor(now / 1000)}+0000`], { input: JSON.stringify(input), encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!r.stdout.includes('could not'), r.stdout)
  return { text: r.stdout, ...readJson(env.TRACE_OUT) }
}

/** The launcher beside a pointer to this plugin, as setup leaves them in the home. */
function installedLauncher() {
  const dir = tmp('installed')
  fs.mkdirSync(`${dir}/bin`)
  fs.copyFileSync(LAUNCHER, `${dir}/bin/statusline.mjs`)
  fs.writeFileSync(`${dir}/plugin-root`, ROOT + '\n')
  return `${dir}/bin/statusline.mjs`
}

const inputFor = (cwd, extra = {}) => ({
  session_id: 's1', transcript_path: `${cwd}/../s1.jsonl`, cwd, model: { display_name: 'Opus 5' }, effort: { level: 'high' },
  context_window: { used_percentage: 42, context_window_size: 1_000_000 },
  rate_limits: { seven_day: { used_percentage: 31, resets_at: NOW / 1000 + 3 * 86400 } }, ...extra,
})

/** A repository with changes on a branch, and a home where session s1 drives a run in it. */
function withRun() {
  const repo = makeRepo(), home = tmp('home')
  git(repo, 'checkout', '-q', '-b', 'feat')
  fs.writeFileSync(repo + '/a.txt', 'one\ntwo\n')
  assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home, cwd: repo, session: 's1' }).code, 0)
  return { repo, home, dir: readJson(home + '/sessions/s1.json').runDir }
}

/** Every file and folder under dir, with its size, time and, for a file, its bytes. */
function snapshot(dir) {
  const out = {}
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name), st = fs.statSync(p)
      out[p] = { dir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs, bytes: st.isDirectory() ? null : fs.readFileSync(p, 'utf8') }
      if (st.isDirectory()) walk(p)
    }
  }
  walk(dir)
  return out
}
const changedFiles = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => !(a[p] ?? b[p]).dir && JSON.stringify(a[p]) !== JSON.stringify(b[p])).sort()

describe('one status line run', { concurrency: true }, () => {
  test('reads no file more than once, on its first run and on a settled one', () => {
    const { repo, home } = withRun()
    for (const now of [NOW, NOW + 1000]) {
      const { reads } = line(home, inputFor(repo), { now, trace: true })
      const mine = Object.entries(reads).filter(([p]) => p.startsWith(home) || p.startsWith(repo))
      assert.ok(mine.length > 5, 'the run reads its records')
      assert.deepEqual(mine.filter(([, n]) => n > 1), [])
    }
  })

  for (const [name, make] of [['a session with a run', withRun], ['a session with no run', () => ({ repo: makeRepo(), home: tmp('home') })]]) {
    test(`frames drawn ahead read no file more than once, for ${name}`, () => {
      const { repo, home } = make()
      const bin = installedLauncher()
      for (const now of [NOW, NOW + 1000]) {
        const { reads, text } = launched(home, inputFor(repo), { now, bin })
        assert.match(text, /Opus 5/)
        const mine = Object.entries(reads).filter(([p]) => p.startsWith(home) || p.startsWith(repo))
        assert.ok(mine.length > 2, 'the run reads its records')
        assert.deepEqual(mine.filter(([, n]) => n > 1), [])
      }
    })
  }

  test('with nothing new it leaves the home as it was, byte for byte and time for time', () => {
    const { repo, home } = withRun()
    line(home, inputFor(repo))
    const before = snapshot(home)
    line(home, inputFor(repo), { now: NOW + 1000 })
    assert.deepEqual(snapshot(home), before)
  })

  test('something new is written, and only that', () => {
    const { repo, home } = withRun()
    line(home, inputFor(repo))
    const a = snapshot(home)
    line(home, inputFor(repo, { context_window: { used_percentage: 43, context_window_size: 1_000_000 } }), { now: NOW + 1000 })
    const b = snapshot(home)
    assert.deepEqual(changedFiles(a, b), [`${home}/cache/context-s1.json`])
    line(home, inputFor(repo, { context_window: { used_percentage: 43, context_window_size: 1_000_000 }, rate_limits: { seven_day: { used_percentage: 33, resets_at: NOW / 1000 + 3 * 86400 } } }), { now: NOW + 2000 })
    assert.deepEqual(changedFiles(b, snapshot(home)), [`${home}/usage.json`])
    assert.equal(readJson(`${home}/usage.json`).sevenDay.percentUsed, 33)
  })

  test('the context size is stamped again once its record is five minutes old', () => {
    const repo = makeRepo(), home = tmp('home')
    const at = () => readJson(`${home}/cache/context-s1.json`).at
    line(home, inputFor(repo))
    line(home, inputFor(repo), { now: NOW + 299_000 })
    assert.equal(at(), NOW)
    line(home, inputFor(repo), { now: NOW + 300_000 })
    assert.equal(at(), NOW + 300_000)
  })

  test('git is asked once in fifteen seconds for a folder, and each folder shows its own figures', () => {
    const alpha = makeRepo(), beta = makeRepo(), home = tmp('home')
    git(alpha, 'checkout', '-q', '-b', 'alpha'); git(beta, 'checkout', '-q', '-b', 'beta')
    const first = line(home, inputFor(alpha), { trace: true })
    assert.match(first.text, /· alpha/)
    assert.ok(first.gits.length > 0)
    const other = line(home, inputFor(beta), { now: NOW + 1000, trace: true })
    assert.match(other.text, /· beta/)
    assert.ok(other.gits.length > 0, 'another folder is asked for its own figures')
    git(alpha, 'checkout', '-q', '-b', 'alpha-2')
    const kept = line(home, inputFor(alpha), { now: NOW + 14_999, trace: true })
    assert.deepEqual(kept.gits, [])
    assert.match(kept.text, /· alpha$/m)
    const again = line(home, inputFor(alpha), { now: NOW + 15_000, trace: true })
    assert.ok(again.gits.length > 0)
    assert.match(again.text, /· alpha-2/)
  })

  test('a run that has nothing new still holds a session over its mark', () => {
    const { repo, home, dir } = withRun()
    const over = inputFor(repo, { rate_limits: { seven_day: { used_percentage: 80, resets_at: NOW / 1000 + 3 * 86400 } } })
    line(home, over)
    assert.equal(readJson(dir + '/gate').reason, 'mark')
    fs.rmSync(dir + '/gate')
    line(home, over, { now: NOW + 1000 })
    assert.equal(readJson(dir + '/gate').reason, 'mark', 'the gate is put back with nothing else new')
    const before = snapshot(home)
    line(home, over, { now: NOW + 2000 })
    assert.deepEqual(snapshot(home), before, 'a gate that stands is not written again, nor its lock taken')
  })
})

describe('one refresh of a folder\'s git record', () => {
  test('asks git no question twice', () => {
    const repo = makeRepo(), home = tmp('home'), bin = tmp('bin'), log = `${bin}/log`
    git(repo, 'checkout', '-q', '-b', 'feat')
    fs.writeFileSync(repo + '/b.txt', 'one\ntwo\n')
    const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    fs.writeFileSync(`${bin}/git`, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 })
    const path = process.env.PATH
    process.env.PATH = `${bin}:${path}`
    let facts
    try { facts = gitOf(repo, home, NOW, ['diff', 'main', 'branch']) } finally { process.env.PATH = path }
    assert.deepEqual(facts.diff, { added: 2, removed: 0 })
    assert.equal(facts.branch, 'feat')
    const asked = fs.readFileSync(log, 'utf8').trim().split('\n').map((q) => q.replace('--no-optional-locks -c diff.autoRefreshIndex=false ', ''))
    assert.ok(asked.length > 5)
    assert.deepEqual(asked.filter((q, i) => asked.indexOf(q) !== i), [])
  })
})
