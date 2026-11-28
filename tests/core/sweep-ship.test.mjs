import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, git, lcw } from './helpers.mjs'
import { sweep, hunting, shipping, commit, overlapping, bothShipping } from './sweep-kit.mjs'

test('status prints every open wave with its stage, round, worktree, review range and own lists', () => {
  const t = overlapping()
  t.at(1, 'task', 'add', 'T1', 'fix the cache')
  t.at(2, 'req', 'add', 'F7', 'the 409')
  t.at(1, 'wave', 'round')
  const out = t.cli('status').out
  assert.match(out, new RegExp(`^wave 1: Review, round 2 .*worktree: ${t.wt1}`, 'm'))
  assert.match(out, new RegExp(`^wave 2: Build .*worktree: ${t.wt2}`, 'm'))
  assert.match(out, /^ {2}review range: git diff lcw\/tidy\.\.\.lcw\/tidy-wave-1$/m)
  assert.match(out, /^ {2}review range: git diff lcw\/tidy-wave-1\.\.\.lcw\/tidy-wave-2$/m)
  assert.match(out, /^ {4}T1 \[todo\] fix the cache$/m)
  assert.match(out, /^ {4}F7 \[todo\] the 409$/m)
  assert.match(out, new RegExp(`^latest work: ${t.wt2}$`, 'm'))
})

test('a sweep with one wave open at a time runs end to end with no --wave', () => {
  const t = hunting()
  const ok = (...a) => { const r = t.cli(...a); assert.equal(r.code, 0, `${a.join(' ')}\n${r.out}`); return r }
  ok('set', 'sweep.prs=stacked')
  ok('wave', 'add', '1', '1')
  assert.match(t.cli('status').out, new RegExp(`^latest work: ${t.repo}$`, 'm'), 'before the first wave, the main checkout')
  for (const [n, file] of [[1, 'b.txt'], [2, 'c.txt']]) {
    assert.equal(t.start().code, 0)
    ok('set', 'plan.tasks=1')
    ok('stage', 'Build')
    ok('task', 'add', 'T1', 'fix it')
    assert.equal(lcw(['task', 'T1', 'done'], { home: t.home, cwd: t.wt }).code, 0, 'a worker in the wave\'s worktree')
    commit(t.wt, file, 'fix\n')
    ok('stage', 'Review')
    ok('req', 'add', 'F1', 'fix it')
    ok('req', 'F1', 'pass')
    ok('wave', 'step', 'closures')
    ok('stage', 'Ship')
    ok('wave', 'step', 'final checks')
    ok('wave', 'step', 'merging')
    ok('wave', 'shipped', '--pr', String(n))
    assert.equal(git(t.repo, 'rev-parse', 'lcw/tidy'), git(t.wt, 'rev-parse', 'HEAD'))
  }
  const s = t.state()
  assert.deepEqual(s.sweep.waves.map((w) => [w.status, w.fixed, w.after, w.tasks[0].status]), [['shipped', 1, 'lcw/tidy', 'done'], ['shipped', 1, 'lcw/tidy', 'done']])
  assert.equal(s.sweep.fixed, 2)
  ok('stage', 'Hunt')
})

test('a wave sent back from Ship clears its own final checks and those of the waves after it', () => {
  const t = bothShipping()
  t.at(1, 'wave', 'step', 'final checks')
  t.at(1, 'wave', 'step', 'merging')
  t.at(2, 'wave', 'take')
  t.at(2, 'wave', 'step', 'final checks')
  assert.equal(t.at(1, 'stage', 'Build').code, 0)
  assert.deepEqual([t.w(1).step, t.w(1).checked, t.w(2).step, t.w(2).checked], [null, null, null, null])
  assert.equal(t.at(2, 'wave', 'step', 'final checks').code, 1)
})

test('a wave moved to the stage it is already in keeps its step, checked head and the later waves\' checks, and writes no ledger line', () => {
  const t = bothShipping()
  t.at(1, 'wave', 'step', 'final checks')
  t.at(1, 'wave', 'step', 'merging')
  t.at(2, 'wave', 'take')
  t.at(2, 'wave', 'step', 'final checks')
  const before = JSON.stringify(t.state().sweep.waves)
  const ledger = () => fs.readFileSync(`${t.dir}/waves/1/ledger.md`, 'utf8')
  const lines = ledger()
  const r = t.at(1, 'stage', 'Ship')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /wave 1 stage Ship/)
  assert.equal(JSON.stringify(t.state().sweep.waves), before)
  assert.equal(ledger(), lines)
})

test('wave defer moves fixes to the next queued wave, or queues a new wave for them', () => {
  const t = hunting()
  t.cli('wave', 'add', '4', '2')
  t.start()
  assert.equal(t.cli('wave', 'defer', '1').code, 0)
  assert.equal(t.cli('wave', 'defer', '4').code, 1, 'more than the wave holds')
  assert.equal(t.cli('wave', 'defer', '0').code, 1)
  t.cli('stage', 'Review')
  t.start()
  assert.equal(t.cli('wave', 'defer', '2', '--wave', '2').code, 0)
  assert.deepEqual(t.state().sweep.waves.map((w) => [w.fixes, w.status]), [[3, 'running'], [1, 'running'], [2, 'queued']])
})

test('a sweep\'s worktree command makes only its branch, and wave start is refused before it and with no wave queued', () => {
  const t = sweep()
  fs.writeFileSync(`${t.dir}/charter.md`, 'goals\n')
  t.cli('approval')
  t.cli('stage', 'Hunt')
  t.cli('wave', 'add', '2')
  assert.equal(t.cli('wave', 'start').code, 1, 'no branch')
  assert.equal(t.cli('worktree').out.trim(), 'lcw/tidy')
  assert.equal(git(t.repo, 'worktree', 'list').split('\n').length, 1, 'no worktree for the sweep itself')
  assert.equal(t.state().worktree, null)
  fs.writeFileSync(`${t.repo}/stray.txt`, 'left over\n')
  const r = t.cli('wave', 'start')
  assert.equal(r.code, 0, 'the main checkout need not be clean')
  const wt = /^worktree: (.+)$/m.exec(r.out)[1]
  assert.equal(wt, fs.realpathSync(`${t.repo}/.claude/worktrees/tidy-wave-1`))
  assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lcw/tidy-wave-1')
  assert.equal(git(t.repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'the main checkout stays where it was')
  assert.ok(!git(t.repo, 'status', '--porcelain').includes('.claude'), 'the wave worktrees are kept out of the main checkout\'s status')
  assert.equal(lcw(['task', 'add', 'T1', 'x'], { home: t.home, cwd: wt }).code, 0, 'lcw run in the wave\'s worktree finds the run')
  assert.equal(t.state().sweep.waves[0].tasks.length, 1)

  const u = hunting('empty')
  assert.equal(u.cli('wave', 'start').code, 1, 'no wave queued')
})

test('a wave runs on its own branch from the sweep\'s, starts clean, and its ledger lines go to both ledgers', () => {
  const t = hunting()
  t.cli('wave', 'add', '2', '1')
  t.cli('task', 'add', 'T9', 'left from before')
  t.cli('req', 'add', 'F9', 'left from before')
  t.cli('set', 'plan.tasks=4')
  const r = t.start()
  assert.equal(r.code, 0, r.out)
  const plan = `${t.dir}/waves/1/plan.md`
  assert.ok(r.out.includes(plan) && fs.existsSync(plan))
  const s = t.state()
  const w = s.sweep.waves[0]
  assert.deepEqual([s.tasks, s.requirements, s.plan.tasks, w.tasks, w.plan.tasks], [[], [], 0, [], 0])
  assert.deepEqual([w.stage, s.stage, w.branch, w.after, w.worktree], ['Plan', 'Plan', 'lcw/tidy-wave-1', 'lcw/tidy', t.wt])
  assert.equal(w.base, git(t.repo, 'rev-parse', 'lcw/tidy'))
  t.cli('ledger', 'worker launched')
  const last = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').at(-1)
  assert.match(last(`${t.dir}/waves/1/ledger.md`), /worker launched$/)
  assert.match(last(`${t.dir}/ledger.md`), /worker launched$/)
  assert.match(t.cli('status').out, new RegExp(`^ {2}plan: ${plan}$`, 'm'))
})

test('wave shipped fast-forwards the sweep\'s branch, counts what passed and what was dropped, and the next wave builds on it', () => {
  const t = hunting()
  t.cli('wave', 'add', '3', '1')
  t.start()
  t.cli('stage', 'Ship')
  for (const id of ['F1', 'F2', 'F3']) t.cli('req', 'add', id, `fix ${id}`)
  t.cli('req', 'F1', 'pass')
  t.cli('req', 'F2', 'pass')
  t.cli('req', 'F3', 'drop')
  const tip = commit(t.wt, 'b.txt', 'fixed\n')
  const r = t.ship('--pr', '12')
  assert.equal(r.code, 0, r.out)
  assert.equal(git(t.repo, 'rev-parse', 'lcw/tidy'), tip)
  const s = t.state().sweep
  assert.deepEqual([s.fixed, s.dropped], [2, 1])
  const { n, status, branch, pr, merged, dropped, fixed, tasks, requirements } = s.waves[0]
  assert.deepEqual({ n, status, branch, pr, merged, dropped, fixed }, { n: 1, status: 'shipped', branch: 'lcw/tidy-wave-1', pr: 12, merged: false, dropped: 1, fixed: 2 })
  assert.deepEqual([tasks, requirements.map((r) => r.id + ' ' + r.status)], [[], ['F1 pass', 'F2 pass']])
  assert.match(fs.readFileSync(`${t.dir}/waves/1/ledger.md`, 'utf8'), /wave 1 shipped/)
  assert.equal(t.ship().code, 1, 'no wave running')
  assert.equal(t.state().sweep.fixed, 2)

  assert.equal(t.start().code, 0)
  assert.deepEqual(t.state().sweep.waves[1].requirements, [], 'wave 2 starts its own list')
  assert.equal(t.state().sweep.waves[0].requirements.length, 2, 'wave 1 keeps its own')
  assert.equal(git(t.wt, 'rev-parse', 'HEAD'), tip, 'wave 2 starts from the sweep\'s branch as wave 1 left it')
  assert.equal(git(t.wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lcw/tidy-wave-2')
  assert.equal(t.state().sweep.waves[1].base, tip)
})

test('a partly fixed fix ships but is not counted as fixed, and status says how many were partly fixed', () => {
  const t = hunting()
  t.cli('wave', 'add', '2')
  t.start()
  t.cli('req', 'add', 'F1', 'fix one')
  t.cli('req', 'add', 'F2', 'fix two')
  t.cli('req', 'F1', 'pass')
  assert.equal(t.cli('req', 'F2', 'partial').code, 0)
  t.cli('stage', 'Ship')
  commit(t.wt, 'b.txt', 'fix\n')
  assert.match(t.ship().out, /1 fixed, 1 partly fixed/)
  const s = t.state().sweep
  assert.deepEqual([s.fixed, s.partial, s.waves[0].fixed, s.waves[0].partial], [1, 1, 1, 1])
  assert.match(t.cli('status').out, /fixed: 1 {2}partly fixed: 1 {2}parked/)
})

test('req partial is refused in a build', () => {
  const home = tmp('home')
  const o = { home, cwd: makeRepo(), session: 's1' }
  lcw(['start', 'b', '--title', 'B'], o)
  lcw(['req', 'add', 'R1', 'one'], o)
  const r = lcw(['req', 'R1', 'partial'], o)
  assert.equal(r.code, 1)
  assert.match(r.out, /Usage: lcw req <id> <todo\|pass\|failing>/)
})

test('wave shipped is refused when the sweep\'s branch cannot fast-forward to the wave, and nothing moves', () => {
  const t = shipping(1)
  commit(t.wt, 'b.txt', 'fix\n')
  t.cli('wave', 'step', 'final checks')
  t.cli('wave', 'step', 'merging')
  const aside = git(t.repo, 'commit-tree', 'lcw/tidy^{tree}', '-p', 'lcw/tidy', '-m', 'aside')
  git(t.repo, 'branch', '-f', 'lcw/tidy', aside)
  assert.equal(t.cli('wave', 'shipped').code, 1)
  assert.equal(git(t.repo, 'rev-parse', 'lcw/tidy'), aside)
  assert.equal(t.state().sweep.waves[0].status, 'running')
})

test('task dropped is a task status in a sweep', () => {
  const t = hunting()
  t.cli('task', 'add', 'T1', 'fix it')
  assert.equal(t.cli('task', 'T1', 'dropped').code, 0)
  assert.equal(t.state().tasks[0].status, 'dropped')
})
