import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fnv1a32hex, repoKey } from '../../lib/key.mjs'
import { spawn } from 'node:child_process'
import { tmp, makeRepo, git, lcw, readJson, started, fakeClaude, CLI } from './helpers.mjs'

test('start creates the run, binds the session, prints paths', () => {
  const t = started('export-csv')
  const s = t.state()
  assert.match(s.id, /^\d{8}-export-csv$/)
  assert.equal(s.stage, 'Brainstorm')
  assert.equal(s.status, 'with-you')
  assert.equal(s.repoRoot, t.repo)
  for (const f of ['brainstorm.md', 'spec.md', 'plan.md', 'ledger.md', 'artifacts']) assert.ok(fs.existsSync(`${t.dir}/${f}`))
  assert.equal(readJson(`${t.home}/sessions/s1.json`).runDir, t.dir)
  assert.equal(t.cli('where').out.trim(), t.dir)
  const again = lcw(['start', 'export-csv', '--title', 'x'], { ...t.o, session: 's2' })
  assert.match(again.out, /export-csv-2/)
})

test('the first three runs on a machine, in any repository, are guided, and only the very first is the first on the machine', () => {
  const home = tmp('home')
  const marks = ['a', 'b', 'c', 'd'].map((name, i) => {
    const out = lcw(['start', name, '--title', 'x'], { home, cwd: makeRepo(), session: `s${i}` }).out
    const s = readJson(`${/^folder: (.+)$/m.exec(out)[1]}/state.json`)
    return [s.guide === true, s.firstOnMachine === true]
  })
  assert.deepEqual(marks, [[true, true], [true, false], [true, false], [false, false]])
})

test('where --json names the main checkout, its key and the session\'s run, from a worktree or with no run at all', () => {
  const t = started()
  const wt = t.cli('worktree').out.trim()
  const key = repoKey(t.repo)
  assert.deepEqual(JSON.parse(lcw(['where', '--json'], { ...t.o, cwd: wt }).out), { main: t.repo, key, run: t.dir })
  const none = lcw(['where', '--json'], { home: t.home, cwd: t.repo, session: 'other' })
  assert.equal(none.code, 0)
  assert.deepEqual(JSON.parse(none.out), { main: t.repo, key, run: null })
})

test('worktree records the commit the run branched from, and status prints it as base', () => {
  const t = started()
  const head = git(t.repo, 'rev-parse', 'HEAD')
  t.cli('worktree')
  assert.equal(t.state().base, head)
  assert.match(t.cli('status').out, new RegExp(`  base: ${head}$`, 'm'))
})

test('commands without a run exit 1; usage and runs do not', () => {
  const home = tmp('home')
  const o = { home, cwd: makeRepo(), session: 'none' }
  assert.equal(lcw(['status'], o).code, 1)
  assert.equal(lcw(['stage', 'Spec'], o).code, 1)
  assert.equal(lcw(['usage'], o).code, 0)
  assert.equal(lcw(['runs'], o).code, 0)
  assert.equal(lcw(['nonsense'], o).code, 1)
})

test('findRun: session binding', () => {
  const t = started()
  const elsewhere = tmp('elsewhere')
  assert.equal(lcw(['where'], { home: t.home, cwd: elsewhere, session: 's1' }).out.trim(), t.dir)
})

test('findRun: walks up to a place pointer from a subfolder of the run worktree', () => {
  const t = started()
  const wt = t.cli('worktree').out.trim()
  fs.mkdirSync(`${wt}/src/deep`, { recursive: true })
  const o = { home: t.home, cwd: `${wt}/src/deep`, session: 'fresh' }
  assert.equal(lcw(['where'], o).out.trim(), t.dir)
  assert.equal(readJson(`${t.home}/sessions/fresh.json`).runDir, t.dir)
})

test('findRun: a session in the main checkout that did not start the run is not bound', () => {
  const t = started()
  t.cli('worktree')
  const r = lcw(['where'], { home: t.home, cwd: t.repo, session: 'stranger' })
  assert.equal(r.code, 1)
  assert.ok(!fs.existsSync(`${t.home}/sessions/stranger.json`))
})

test('a finished run is not found', () => {
  const t = started()
  t.cli('finish')
  assert.equal(t.cli('where').code, 1)
})

test('run id uses the local date', () => {
  const t = started()
  const n = new Date()
  const today = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`
  assert.ok(t.state().id.startsWith(today))
})

test('runs lists newest first', () => {
  const t = started('older')
  lcw(['start', 'newer', '--title', 'Newer'], { ...t.o, session: 's9' })
  const lines = t.cli('runs').out.trim().split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /newer/)
})

test('reusing a run name keeps id, name and branch in agreement', () => {
  const t = started('again')
  t.cli('worktree')
  const r = lcw(['start', 'again', '--title', 'Second'], { home: t.home, cwd: t.repo, session: 's2' })
  assert.match(r.out, /^Run .*-again-2$/m)
  const w = lcw(['worktree'], { home: t.home, cwd: t.repo, session: 's2' })
  assert.equal(w.code, 0, w.out)
  assert.equal(git(w.out.trim(), 'rev-parse', '--abbrev-ref', 'HEAD'), 'lcw/again-2')
})

test('start works in a folder that is not a git repository', () => {
  const r = lcw(['start', 'demo', '--title', 'Demo'], { home: tmp('home'), cwd: tmp('plain'), session: 's1' })
  assert.equal(r.code, 0, r.out + r.err)
  assert.match(r.out, /^folder: .+demo$/m)
})

test('start without a title, or without a name, is refused and creates nothing', () => {
  const home = tmp('home')
  const o = { home, cwd: makeRepo(), session: 's1' }
  for (const args of [['start', 'no-title'], ['start', '--title', 'No name']]) {
    const r = lcw(args, o)
    assert.equal(r.code, 1, args.join(' '))
    assert.match(r.out + r.err, /Usage: lcw start/)
  }
  assert.equal(lcw(['runs'], o).out.trim(), 'no runs')
  assert.ok(!fs.existsSync(`${home}/sessions/s1.json`))
})

test('a run counts its own dollars: the session meter at the start, carried over to a session that takes it up', () => {
  const t = started('money')
  const meter = (id, max) => {
    fs.mkdirSync(`${t.home}/spend`, { recursive: true })
    fs.writeFileSync(`${t.home}/spend/${id}.json`, JSON.stringify({ v: 1, base: 0, max, q: { 1: max } }))
  }
  const billed = (id) => {
    fs.mkdirSync(`${t.home}/sessions`, { recursive: true })
    fs.writeFileSync(`${t.home}/sessions/${id}.json`, JSON.stringify({ billing: 'payg' }))
  }
  assert.deepEqual([t.state().usdBefore, t.state().usdAtStart], [0, 0], 'a session with no spend on record starts at zero')
  // the run of s1: s1 stood at 100 when it began, and has since spent 30
  t.cli('set', 'usdAtStart=100')
  meter('s1', 130)
  const wt = t.cli('worktree').out.trim()
  const later = { home: t.home, cwd: wt, session: 'later' }
  meter('later', 500)
  billed('later')
  assert.equal(lcw(['set', 'health=carrying on'], later).code, 0)
  assert.deepEqual([t.state().usdBefore, t.state().usdAtStart], [30, 500], 'what s1 spent stays with the run; the new session counts from its own meter')
  meter('later', 520)
  assert.equal(lcw(['finish'], later).code, 0)
  assert.equal(t.state().totals.usd, 50)
})

test('status and a take-over name a pay-per-token mark in dollars, not the stale percent', () => {
  const t = started('mark')
  const w = t.cli('worktree')
  assert.equal(w.code, 0, JSON.stringify(w))
  const o = { home: t.home, cwd: w.out.trim(), session: 's1' }
  const sf = `${t.home}/sessions/s1.json`
  fs.writeFileSync(sf, JSON.stringify({ ...readJson(sf), billing: 'payg' }))
  const m = lcw(['mark', '5500usd'], o)
  assert.equal(m.code, 0, JSON.stringify(m))
  const line = lcw(['status'], o).out.match(/^mark: .*/m)[0]
  assert.match(line, /\$5,500/)
  assert.ok(!line.includes('75%'), line)
})

test('finish stores no dollars for a session that is not billed per token', () => {
  const t = started('plain')
  fs.mkdirSync(`${t.home}/spend`, { recursive: true })
  fs.writeFileSync(`${t.home}/spend/s1.json`, JSON.stringify({ v: 1, base: 0, max: 80, q: { 1: 80 } }))
  t.cli('finish')
  assert.ok(!('usd' in t.state().totals))
})

test('awake holds only for a Claude Code process on record, not any live process with that pid', { skip: process.platform === 'darwin' || process.platform === 'linux' ? false : 'LCW holds off sleep only on macOS and Linux' }, () => {
  // stand-ins that end at once, so no test holds off this computer's sleep
  const stubs = tmp('stubs')
  for (const f of ['caffeinate', 'systemd-inhibit']) fs.writeFileSync(`${stubs}/${f}`, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const env = { PATH: `${stubs}:${process.env.PATH}` }
  const t = started()
  t.cli('stage', 'Build')
  const pidOnRecord = (pid) => fs.writeFileSync(`${t.home}/sessions/s1.json`, JSON.stringify({ runDir: t.dir, claudePid: pid }))
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' })
  const claude = fakeClaude()
  try {
    pidOnRecord(other.pid)
    const r = lcw(['awake'], { ...t.o, env })
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /no Claude Code process on record/)
    assert.equal(fs.existsSync(`${t.dir}/awake`), false)
    pidOnRecord(claude.pid)
    const ok = lcw(['awake'], { ...t.o, env })
    assert.equal(ok.code, 0, ok.out)
    assert.equal(ok.out.trim(), 'kept awake')
  } finally { other.kill(); claude.kill() }
})

test('health that is longer than the card shows, or names waves by number, is saved and the reply says what to say instead', () => {
  const t = started()
  const long = 'The importer is built, but its review found the progress bar wrong on nine points, which are being fixed now, one by one. Live next: the importer, then exports by email, then the settings pages.'
  assert.match(t.cli('set', `health=${long}`).out, /cuts it at about 160/)
  assert.equal(t.state().health, long)
  assert.match(t.cli('set', 'health=waves 4 and 5 finish review; then the screens of 6').out, /names waves by number.*what the card cannot/)
  assert.equal(t.cli('set', 'health=The importer is in review. Live next: exports by email.').out.trim(), 'set health')
})
