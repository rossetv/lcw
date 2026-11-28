import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fnv1a32hex, repoKey } from '../../lib/key.mjs'
import { inWsl } from '../../scripts/lib/awake.mjs'
import { spawn } from 'node:child_process'
import { tmp, makeRepo, git, cli, readJson, begin, fakeClaude } from './helpers.mjs'

test('start creates the run, binds the session, prints paths', async () => {
  const t = await begin('export-csv')
  const s = t.state()
  const n = new Date()
  const today = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`
  assert.equal(s.id, `${today}-export-csv`, 'the id is the local date and the name')
  assert.equal(s.stage, 'Brainstorm')
  assert.equal(s.status, 'with-you')
  assert.equal(s.repoRoot, t.repo)
  for (const f of ['brainstorm.md', 'spec.md', 'plan.md', 'ledger.md', 'artifacts']) assert.ok(fs.existsSync(`${t.dir}/${f}`))
  assert.equal(readJson(`${t.home}/sessions/s1.json`).runDir, t.dir)
  assert.equal((await t.cli('where')).out.trim(), t.dir)
})

test('the first three runs on a machine, in any repository, are guided, and only the very first is the first on the machine', async () => {
  const home = tmp('home')
  const marks = []
  for (const [i, name] of ['a', 'b', 'c', 'd'].entries()) {
    const out = (await cli(['start', name, '--title', 'x'], { home, cwd: makeRepo(), session: `s${i}` })).out
    const s = readJson(`${/^folder: (.+)$/m.exec(out)[1]}/state.json`)
    marks.push([s.guide === true, s.firstOnMachine === true])
  }
  assert.deepEqual(marks, [[true, true], [true, false], [true, false], [false, false]])
})

test('where --json names the main checkout, its key and the session\'s run, from a worktree or with no run at all', async () => {
  const t = await begin()
  const wt = (await t.cli('worktree')).out.trim()
  const key = repoKey(t.repo)
  assert.deepEqual(JSON.parse((await cli(['where', '--json'], { ...t.o, cwd: wt })).out), { main: t.repo, key, run: t.dir })
  const none = await cli(['where', '--json'], { home: t.home, cwd: t.repo, session: 'other' })
  assert.equal(none.code, 0)
  assert.deepEqual(JSON.parse(none.out), { main: t.repo, key, run: null })
})

test('worktree records the commit the run branched from, and status prints it as base', async () => {
  const t = await begin()
  const head = git(t.repo, 'rev-parse', 'HEAD')
  await t.cli('worktree')
  assert.equal(t.state().base, head)
  assert.match((await t.cli('status')).out, new RegExp(`  base: ${head}$`, 'm'))
})

test('commands without a run exit 1; usage and runs do not', async () => {
  const home = tmp('home')
  const o = { home, cwd: makeRepo(), session: 'none' }
  assert.equal((await cli(['status'], o)).code, 1)
  assert.equal((await cli(['stage', 'Spec'], o)).code, 1)
  assert.equal((await cli(['usage'], o)).code, 0)
  assert.equal((await cli(['runs'], o)).code, 0)
  assert.equal((await cli(['nonsense'], o)).code, 1)
})

test('findRun: session binding', async () => {
  const t = await begin()
  const elsewhere = tmp('elsewhere')
  assert.equal((await cli(['where'], { home: t.home, cwd: elsewhere, session: 's1' })).out.trim(), t.dir)
})

test('findRun: walks up to a place pointer from a subfolder of the run worktree', async () => {
  const t = await begin()
  const wt = (await t.cli('worktree')).out.trim()
  fs.mkdirSync(`${wt}/src/deep`, { recursive: true })
  const o = { home: t.home, cwd: `${wt}/src/deep`, session: 'fresh' }
  assert.equal((await cli(['where'], o)).out.trim(), t.dir)
  assert.equal(readJson(`${t.home}/sessions/fresh.json`).runDir, t.dir)
})

test('findRun: a session in the main checkout that did not start the run is not bound', async () => {
  const t = await begin()
  await t.cli('worktree')
  const r = await cli(['where'], { home: t.home, cwd: t.repo, session: 'stranger' })
  assert.equal(r.code, 1)
  assert.ok(!fs.existsSync(`${t.home}/sessions/stranger.json`))
})

test('a finished run is not found', async () => {
  const t = await begin()
  await t.cli('finish')
  assert.equal((await t.cli('where')).code, 1)
})

test('runs lists newest first', async () => {
  const t = await begin('older')
  await cli(['start', 'newer', '--title', 'Newer'], { ...t.o, session: 's9' })
  const lines = (await t.cli('runs')).out.trim().split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /newer/)
})

test('reusing a run name keeps id, name and branch in agreement', async () => {
  const t = await begin('again')
  await t.cli('worktree')
  const r = await cli(['start', 'again', '--title', 'Second'], { home: t.home, cwd: t.repo, session: 's2' })
  assert.match(r.out, /^Run .*-again-2$/m)
  const w = await cli(['worktree'], { home: t.home, cwd: t.repo, session: 's2' })
  assert.equal(w.code, 0, w.out)
  assert.equal(git(w.out.trim(), 'rev-parse', '--abbrev-ref', 'HEAD'), 'lcw/again-2')
})

test('start works in a folder that is not a git repository', async () => {
  const r = await cli(['start', 'demo', '--title', 'Demo'], { home: tmp('home'), cwd: tmp('plain'), session: 's1' })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /^folder: .+demo$/m)
})

test('start without a title, or without a name, is refused and creates nothing', async () => {
  const home = tmp('home')
  const o = { home, cwd: makeRepo(), session: 's1' }
  for (const args of [['start', 'no-title'], ['start', '--title', 'No name']]) {
    const r = await cli(args, o)
    assert.equal(r.code, 1, args.join(' '))
  }
  assert.equal((await cli(['runs'], o)).out.trim(), 'no runs')
  assert.ok(!fs.existsSync(`${home}/sessions/s1.json`))
})

test('a run counts its own dollars: the session meter at the start, carried over to a session that takes it up', async () => {
  const t = await begin('money')
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
  await t.cli('set', 'usdAtStart=100')
  meter('s1', 130)
  const wt = (await t.cli('worktree')).out.trim()
  const later = { home: t.home, cwd: wt, session: 'later' }
  meter('later', 500)
  billed('later')
  assert.equal((await cli(['set', 'health=carrying on'], later)).code, 0)
  assert.deepEqual([t.state().usdBefore, t.state().usdAtStart], [30, 500], 'what s1 spent stays with the run; the new session counts from its own meter')
  meter('later', 520)
  assert.equal((await cli(['finish'], later)).code, 0)
  assert.equal(t.state().totals.usd, 50)
})

test('status and a take-over name a pay-per-token mark in dollars, not the stale percent', async () => {
  const t = await begin('mark')
  const w = await t.cli('worktree')
  assert.equal(w.code, 0, JSON.stringify(w))
  const o = { home: t.home, cwd: w.out.trim(), session: 's1' }
  const sf = `${t.home}/sessions/s1.json`
  fs.writeFileSync(sf, JSON.stringify({ ...readJson(sf), billing: 'payg' }))
  const m = await cli(['mark', '5500usd'], o)
  assert.equal(m.code, 0, JSON.stringify(m))
  const line = (await cli(['status'], o)).out.match(/^mark: .*/m)[0]
  assert.match(line, /\$5,500/)
  assert.ok(!line.includes('75%'), line)
})

test('finish stores no dollars for a session that is not billed per token', async () => {
  const t = await begin('plain')
  fs.mkdirSync(`${t.home}/spend`, { recursive: true })
  fs.writeFileSync(`${t.home}/spend/s1.json`, JSON.stringify({ v: 1, base: 0, max: 80, q: { 1: 80 } }))
  await t.cli('finish')
  assert.ok(!('usd' in t.state().totals))
})

test('awake holds only for a Claude Code process on record, not any live process with that pid', { skip: process.platform !== 'darwin' && process.platform !== 'linux' ? 'LCW holds off sleep only on macOS and Linux' : inWsl(process.env) ? 'WSL cannot hold off the computer\'s sleep' : false }, async () => {
  // stand-ins that stay alive while STUB_WAIT_PID does, as the real ones do for Claude Code, so no test holds off this computer's sleep
  const stubs = tmp('stubs')
  for (const f of ['caffeinate', 'systemd-inhibit']) fs.writeFileSync(`${stubs}/${f}`, '#!/bin/sh\nwhile kill -0 "$STUB_WAIT_PID" 2>/dev/null; do sleep 0.1; done\n', { mode: 0o755 })
  const t = await begin()
  await t.cli('stage', 'Build')
  const pidOnRecord = (pid) => fs.writeFileSync(`${t.home}/sessions/s1.json`, JSON.stringify({ runDir: t.dir, claudePid: pid }))
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' })
  const claude = fakeClaude()
  const env = { PATH: `${stubs}:${process.env.PATH}`, STUB_WAIT_PID: String(claude.pid) }
  try {
    pidOnRecord(other.pid)
    const r = await cli(['awake'], { ...t.o, env })
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /no Claude Code process on record/)
    assert.equal(fs.existsSync(`${t.dir}/awake`), false)
    pidOnRecord(claude.pid)
    const ok = await cli(['awake'], { ...t.o, env })
    assert.equal(ok.code, 0, ok.out)
    assert.equal(ok.out.trim(), 'kept awake')
  } finally { other.kill(); claude.kill() }
})

test('health that is longer than the card shows, or names waves by number, is saved and the reply says what to say instead', async () => {
  const t = await begin()
  const long = 'The importer is built, but its review found the progress bar wrong on nine points, which are being fixed now, one by one. Live next: the importer, then exports by email, then the settings pages.'
  assert.match((await t.cli('set', `health=${long}`)).out, /cuts it at about 160/)
  assert.equal(t.state().health, long)
  assert.match((await t.cli('set', 'health=waves 4 and 5 finish review; then the screens of 6')).out, /names waves by number.*what the card cannot/)
  assert.equal((await t.cli('set', 'health=The importer is in review. Live next: exports by email.')).out.trim(), 'set health')
})

test('worktree whose folder git refuses leaves no branch behind, and outside a git repository says it needs one', async () => {
  const t = await begin()
  const dir = `${t.repo}/.claude/worktrees/demo`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(`${dir}/stray.txt`, 'x')
  assert.equal((await t.cli('worktree')).code, 1)
  assert.equal(git(t.repo, 'branch', '--list', 'lcw/demo'), '')
  fs.rmSync(`${dir}/stray.txt`)
  assert.equal((await t.cli('worktree')).code, 0)

  const home = tmp('home')
  const plain = tmp('plain')
  const o = { home, cwd: plain, session: 's1' }
  assert.equal((await cli(['start', 'demo', '--title', 'x'], o)).code, 0)
  const r = await cli(['worktree'], o)
  assert.equal(r.code, 1)
  assert.match(r.out, /needs a git repository/)
  assert.doesNotMatch(r.out, /fatal/)
})
