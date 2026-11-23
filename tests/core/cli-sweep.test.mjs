import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, git, lcw, readJson } from './helpers.mjs'

/** A repo with a GitHub origin, a home and a started sweep. */
function sweep(name = 'tidy') {
  const home = tmp('home')
  const repo = makeRepo()
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
  const o = { home, cwd: repo, session: 's1' }
  const started = lcw(['start', name, '--title', 'Tidy the backlog', '--shape', 'sweep'], o)
  const dir = /^folder: (.+)$/m.exec(started.out)[1]
  const state = () => readJson(`${dir}/state.json`)
  const edit = (fn) => { const s = state(); fn(s); fs.writeFileSync(`${dir}/state.json`, JSON.stringify(s)) }
  return { home, repo, o, dir, started, state, edit, cli: (...a) => lcw(a, o) }
}

/** A sweep past its charter, in Hunt, with its branch; start() starts the front queued wave and sets wt to its worktree. */
function hunting(name) {
  const t = sweep(name)
  fs.writeFileSync(`${t.dir}/charter.md`, 'goals: fix the backlog\n')
  t.cli('approval')
  t.cli('stage', 'Hunt')
  t.cli('worktree')
  t.start = (...a) => {
    const r = t.cli('wave', 'start', ...a)
    if (r.code === 0) t.wt = /^worktree: (.+)$/m.exec(r.out)[1]
    return r
  }
  // the only open wave's final checks pass on its head as it is, and it ships
  t.ship = (...a) => {
    t.cli('wave', 'step', 'final checks')
    t.cli('wave', 'step', 'merging')
    return t.cli('wave', 'shipped', ...a)
  }
  return t
}

/** A sweep in Ship with wave 1 (of the given size) running and its worktree. */
function shipping(fixes = 3, name) {
  const t = hunting(name)
  t.cli('wave', 'add', String(fixes))
  t.start()
  t.cli('stage', 'Ship')
  return t
}

function commit(wt, file, text) {
  fs.writeFileSync(`${wt}/${file}`, text)
  git(wt, 'add', file)
  git(wt, 'commit', '-q', '-m', `change ${file}`)
  return git(wt, 'rev-parse', 'HEAD')
}

/**
 * A gh on PATH that writes each call's arguments to a log. GH_STATE is what each pr view shows in turn, comma separated,
 * the last one again once they run out (open, then merged, by default); GH_DRAFT and GH_BASE are the rest of what it shows,
 * and the repository's default branch is main. GH_FAIL is the subcommand that fails, GH_API_ERROR what a failing api call says.
 */
function fakeGh(more = {}) {
  const bin = tmp('bin')
  const log = `${bin}/calls`
  fs.writeFileSync(`${bin}/gh`, `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in *--delete-branch*) echo "gh must not delete the branch" >&2; exit 1;; esac
if [ -n "$GH_UNDO_FAIL" ] && echo "$*" | grep -q -- --undo; then echo "cannot undo" >&2; exit 1; fi
if [ "$1 $2" = "$GH_FAIL" ]; then echo "GraphQL: not mergeable" >&2; exit 1; fi
if [ "$1 $2" = "pr view" ]; then
  states="\${GH_STATE:-OPEN,MERGED}"
  state=$(echo "$states" | cut -d, -f"$(grep -c '^pr view' "${log}")")
  [ -n "$state" ] || state=$(echo "$states" | awk -F, '{print $NF}')
  echo "{\\"state\\":\\"$state\\",\\"isDraft\\":\${GH_DRAFT:-true},\\"baseRefName\\":\\"\${GH_BASE:-main}\\"}"
fi
if [ "$1 $2" = "repo view" ]; then echo '{"defaultBranchRef":{"name":"main"}}'; fi
if [ "$1" = "api" ] && [ -n "$GH_API_ERROR" ]; then echo "$GH_API_ERROR" >&2; exit 1; fi
exit 0
`, { mode: 0o755 })
  return { env: { PATH: `${bin}:${process.env.PATH}`, ...more }, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) }
}

test('a sweep starts in Charter with the person, with its own records and no brainstorm or spec', () => {
  const t = sweep()
  const s = t.state()
  assert.equal(t.started.code, 0, t.started.out)
  assert.deepEqual([s.shape, s.stage, s.status], ['sweep', 'Charter', 'with-you'])
  assert.deepEqual(s.sweep, { prs: null, charter: 0, open: 0, approvedAt: null, round: 0, hunt: { areas: 0, hunted: 0, running: 0, findings: 0, fix: 0, park: 0, drop: 0 }, fixed: 0, parked: 0, dropped: 0, waves: [] })
  for (const f of ['charter.md', 'findings.md', 'parked.md', 'ledger.md', 'artifacts']) {
    assert.ok(fs.existsSync(`${t.dir}/${f}`), f)
    assert.ok(t.started.out.includes(`${t.dir}/${f}`), f)
  }
  for (const f of ['brainstorm.md', 'spec.md']) assert.ok(!fs.existsSync(`${t.dir}/${f}`), f)
})

test('start refuses a shape that is neither build nor sweep, and a run with no shape is a build', () => {
  const home = tmp('home')
  const o = { home, cwd: makeRepo(), session: 's1' }
  assert.equal(lcw(['start', 'x', '--title', 'X', '--shape', 'sprint'], o).code, 1)
  assert.equal(lcw(['runs'], o).out.trim(), 'no runs')
  const dir = /^folder: (.+)$/m.exec(lcw(['start', 'x', '--title', 'X'], o).out)[1]
  const s = readJson(`${dir}/state.json`)
  assert.deepEqual([s.shape, s.sweep, s.stage], [undefined, undefined, 'Brainstorm'])
})

test('each shape takes only its own stages', () => {
  const t = sweep()
  for (const stage of ['Brainstorm', 'Spec']) assert.equal(t.cli('stage', stage).code, 1, stage)
  assert.equal(t.cli('stage', 'Plan').code, 0)
  const b = { home: t.home, cwd: makeRepo(), session: 'b1' }
  lcw(['start', 'b', '--title', 'B'], b)
  for (const stage of ['Charter', 'Hunt']) assert.equal(lcw(['stage', stage], b).code, 1, stage)
})

test('Hunt is refused until the charter was put to the person in Charter and written down', () => {
  const t = sweep()
  assert.equal(t.cli('approval').code, 0)
  assert.ok(Number.isFinite(t.state().sweep.approvedAt))
  assert.equal(t.cli('stage', 'Hunt').code, 1, 'charter.md is still empty')
  assert.equal(t.state().stage, 'Charter')

  const u = sweep('other')
  fs.writeFileSync(`${u.dir}/charter.md`, 'goals: fix the backlog\n')
  assert.equal(u.cli('stage', 'Hunt').code, 1, 'no approval asked')
  assert.equal(u.state().stage, 'Charter')
  u.cli('approval')
  assert.equal(u.cli('stage', 'Hunt').code, 0)
  assert.deepEqual([u.state().stage, u.state().status], ['Hunt', 'running'])
})

test('approval is the Charter\'s question in a sweep and is refused in its other stages', () => {
  const t = hunting()
  assert.equal(t.cli('approval').code, 1)
  assert.equal(t.cli('stage', 'Charter').code, 0)
  assert.equal(t.state().status, 'with-you')
  t.cli('pause')
  t.cli('resume')
  assert.equal(t.state().status, 'with-you', 'resumed in Charter, the sweep is back with the person')
})

test('entering Hunt starts a new round with fresh counts, and a repeat in Hunt changes nothing', () => {
  const t = hunting()
  t.cli('hunt', '--areas', '4', '--hunted', '2')
  assert.equal(t.cli('stage', 'Hunt').code, 0)
  assert.equal(t.state().sweep.round, 1)
  assert.equal(t.state().sweep.hunt.areas, 4, 'the repeat did not reset the round')
  t.cli('stage', 'Ship')
  t.cli('stage', 'Hunt')
  assert.equal(t.state().sweep.round, 2)
  assert.equal(t.state().sweep.hunt.areas, 0)
})

test('set takes the charter\'s settings within their ranges and nothing else of the sweep', () => {
  const t = sweep()
  assert.equal(t.cli('set', 'sweep.charter=4', 'sweep.open=1', 'sweep.prs=merged').code, 0)
  assert.deepEqual([t.state().sweep.charter, t.state().sweep.open, t.state().sweep.prs], [4, 1, 'merged'])
  for (const pair of ['sweep.prs=squash', 'sweep.charter=11', 'sweep.charter=-1', 'sweep.open=two', 'sweep.round=5', 'sweep.waves=[]', 'sweep={}', 'shape=build']) {
    assert.equal(t.cli('set', pair).code, 1, pair)
  }
  assert.deepEqual([t.state().sweep.charter, t.state().sweep.prs, t.state().sweep.round, t.state().shape], [4, 'merged', 0, 'sweep'])
  const b = { home: t.home, cwd: makeRepo(), session: 'b1' }
  const dir = /^folder: (.+)$/m.exec(lcw(['start', 'b', '--title', 'B'], b).out)[1]
  assert.equal(lcw(['set', 'sweep.prs=merged'], b).code, 1)
  assert.equal(readJson(`${dir}/state.json`).sweep, undefined)
})

test('hunt records progress and sorting; park and drop add to the totals once, however often they are repeated', () => {
  const t = hunting()
  assert.equal(t.cli('hunt', '--areas', '5', '--hunted', '1', '--running', '3', '--findings', '2').code, 0)
  t.cli('hunt', '--fix', '6', '--park', '2', '--drop', '1')
  t.cli('hunt', '--fix', '6', '--park', '2', '--drop', '1')
  t.cli('hunt', '--park', '3')
  const s = t.state().sweep
  assert.deepEqual(s.hunt, { areas: 5, hunted: 1, running: 3, findings: 2, fix: 6, park: 3, drop: 1 })
  assert.deepEqual([s.parked, s.dropped], [3, 1])
  t.cli('stage', 'Ship')
  t.cli('stage', 'Hunt')
  t.cli('hunt', '--park', '1')
  assert.deepEqual([t.state().sweep.parked, t.state().sweep.dropped], [4, 1], 'a new round adds to what the last one parked')
  assert.equal(t.cli('hunt', '--fix', 'many').code, 1)
  t.cli('stage', 'Plan')
  assert.equal(t.cli('hunt', '--fix', '1').code, 1, 'outside Hunt')
})

test('hunt, wave and merge are refused in a build', () => {
  const o = { home: tmp('home'), cwd: makeRepo(), session: 'b1' }
  lcw(['start', 'b', '--title', 'B'], o)
  for (const a of [['hunt', '--fix', '1'], ['wave', 'add', '2'], ['merge', '1'], ['task', 'add', 'T1', 'x']]) lcw(a, o)
  for (const a of [['hunt', '--fix', '1'], ['wave', 'add', '2'], ['merge', '1'], ['task', 'T1', 'dropped'], ['stop', '--pr', 'https://github.com/a/b/pull/1']]) {
    assert.equal(lcw(a, o).code, 1, a.join(' '))
  }
})

test('wave add queues a wave for each number, and a repeat while they wait is refused', () => {
  const t = hunting()
  assert.equal(t.cli('wave', 'add', '3', '2').code, 0)
  assert.equal(t.cli('wave', 'add', '3', '2').code, 1)
  assert.equal(t.cli('wave', 'add', '0').code, 1)
  assert.deepEqual(t.state().sweep.waves, [
    { n: 1, fixes: 3, status: 'queued', branch: null, pr: null, merged: false, dropped: 0 },
    { n: 2, fixes: 2, status: 'queued', branch: null, pr: null, merged: false, dropped: 0 },
  ])
})

test('wave add queues more waves while waves are open, as long as none is queued', () => {
  const t = hunting()
  t.cli('wave', 'add', '1')
  t.start()
  assert.equal(t.cli('wave', 'add', '2').code, 0)
  assert.deepEqual(t.state().sweep.waves.map((w) => w.status), ['running', 'queued'])
})

test('the next wave starts once the wave before it is built, cut from that wave\'s branch in its own worktree, and is told the files it changed', () => {
  const t = hunting()
  t.cli('wave', 'add', '2', '2')
  t.start()
  const wt1 = t.wt
  commit(wt1, 'b.txt', 'one\n')
  for (const stage of ['Plan', 'Build']) {
    t.cli('stage', stage)
    assert.equal(t.cli('wave', 'start').code, 1, stage)
  }
  assert.deepEqual(t.state().sweep.waves.map((w) => w.status), ['running', 'queued'])
  t.cli('stage', 'Review')
  assert.match(t.cli('wave', 'files').out, /^ {2}b\.txt \(wave 1\)$/m)
  const r = t.start()
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /^ {2}b\.txt \(wave 1\)$/m)
  const w2 = t.state().sweep.waves[1]
  assert.deepEqual([w2.stage, w2.after, w2.base, w2.worktree], ['Plan', 'lcw/tidy-wave-1', git(wt1, 'rev-parse', 'HEAD'), fs.realpathSync(`${t.repo}/.claude/worktrees/tidy-wave-2`)])
  assert.equal(git(t.wt, 'rev-parse', 'HEAD'), w2.base, 'wave 2 builds on wave 1\'s work')
  assert.deepEqual([t.state().stage, t.state().sweep.waves[0].stage], ['Plan', 'Review'], 'the run\'s stage follows the newest wave')
})

test('at most two waves are built or reviewed at once: a third waits until one of them holds in Ship', () => {
  const t = hunting()
  t.cli('wave', 'add', '1', '1', '1')
  t.start()
  t.cli('stage', 'Review')
  t.start()
  t.cli('stage', 'Review', '--wave', '2')
  const r = t.cli('wave', 'start')
  assert.equal(r.code, 1)
  assert.match(r.out, /1 and 2/)
  t.cli('stage', 'Ship', '--wave', '1')
  assert.equal(t.start().code, 0)
  assert.deepEqual(t.state().sweep.waves.map((w) => w.stage), ['Ship', 'Review', 'Plan'])
  assert.equal(t.state().sweep.waves[2].after, 'lcw/tidy-wave-2')
})

/** Waves 1 and 2 started: wave 1 with a commit, in Review; wave 2 cut from it, in Build. at(n, ...) runs a command for wave n. */
function overlapping() {
  const t = hunting()
  t.cli('wave', 'add', '1', '1')
  t.start()
  const wt1 = t.wt
  commit(wt1, 'b.txt', 'one\n')
  t.cli('stage', 'Review')
  t.start()
  const at = (n, ...a) => t.cli(...a, '--wave', String(n))
  at(2, 'stage', 'Build')
  return { ...t, wt1, wt2: t.wt, at, w: (n) => t.state().sweep.waves[n - 1] }
}

test('a wave takes in what the wave before it changed since it started, before its own review', () => {
  const t = overlapping()
  commit(t.wt2, 'e.txt', 'wave 2 fix\n')
  const fix = commit(t.wt1, 'c.txt', 'review fix\n')
  const r = t.at(2, 'stage', 'Review')
  assert.equal(r.code, 1)
  assert.match(r.out, /wave take/)
  assert.equal(t.w(2).stage, 'Build')
  assert.equal(t.at(2, 'wave', 'take').code, 0)
  assert.equal(git(t.wt2, 'rev-parse', 'HEAD^2'), fix, 'a merge commit of wave 1\'s tip')
  assert.equal(t.at(2, 'stage', 'Review').code, 0)
  assert.deepEqual([t.w(2).stage, t.w(2).round], ['Review', 1])
  t.at(2, 'wave', 'round')
  assert.equal(t.w(2).round, 2)
  assert.equal(t.at(2, 'wave', 'step', 'final checks').code, 1, 'final checks are a step of Ship')
  assert.equal(t.at(2, 'wave', 'step', 'closures').code, 0)
  assert.equal(t.w(2).step, 'closures')
})

test('a take-in that conflicts is undone, and names the worktree and the branch to resolve it in', () => {
  const t = overlapping()
  commit(t.wt2, 'b.txt', 'two\n')
  commit(t.wt1, 'b.txt', 'one, reviewed\n')
  const had = git(t.wt2, 'rev-parse', 'HEAD')
  const r = t.at(2, 'wave', 'take')
  assert.equal(r.code, 1)
  assert.ok(r.out.includes(t.wt2) && r.out.includes('lcw/tidy-wave-2') && r.out.includes('b.txt'), r.out)
  assert.equal(git(t.wt2, 'rev-parse', 'HEAD'), had)
  assert.equal(git(t.wt2, 'status', '--porcelain'), '')
  assert.match(r.out, /merge was undone/)
  assert.doesNotMatch(r.out, /Nothing was changed/, 'the wave\'s ledger did get the conflict line')
  assert.match(fs.readFileSync(`${t.dir}/waves/2/ledger.md`, 'utf8'), /conflicts in b\.txt/, 'the wave\'s ledger keeps that a resolution waits')
})

test('an older wave merged straight into a wave in Review is refused at a round and on leaving Review, until the waves between take it in', () => {
  const t = three()
  t.start()
  t.ok('stage', 'Ship', '--wave', '1')
  t.ok('stage', 'Review', '--wave', '2')
  t.ok('stage', 'Ship', '--wave', '2')
  t.start()
  t.ok('stage', 'Build', '--wave', '3')
  t.ok('stage', 'Review', '--wave', '3')
  commit(t.wt1, 'f.txt', 'checks fix\n')
  git(t.wt, 'merge', '--no-edit', '-q', 'lcw/tidy-wave-1') // a worker's direct merge past wave 2, not lcw wave take
  for (const a of [['wave', 'round'], ['stage', 'Ship']]) {
    const r = t.cli(...a, '--wave', '3')
    assert.equal(r.code, 1, a.join(' '))
    assert.match(r.out, /wave take --wave 2/)
  }
  assert.deepEqual([t.w(3).stage, t.w(3).round], ['Review', 1])
  t.ok('wave', 'take', '--wave', '2')
  t.ok('wave', 'take', '--wave', '3')
  t.ok('wave', 'round', '--wave', '3')
  t.ok('stage', 'Ship', '--wave', '3')
})

/** overlapping(), with both waves in Ship and wave 1's final checks passed: it is merging. */
function bothShipping() {
  const t = overlapping()
  t.at(2, 'stage', 'Review')
  t.at(1, 'stage', 'Ship')
  t.at(2, 'stage', 'Ship')
  commit(t.wt1, 'd.txt', 'closure\n')
  return t
}

test('final checks run one wave at a time, in wave order, on a head that holds the wave before it', () => {
  const t = bothShipping()
  const r = t.at(2, 'wave', 'step', 'final checks')
  assert.equal(r.code, 1)
  assert.match(r.out, /Wave 1/)
  assert.equal(t.at(1, 'wave', 'step', 'final checks').code, 0)
  assert.equal(t.at(2, 'wave', 'step', 'final checks').code, 1, 'wave 1\'s are still running')
  assert.equal(t.at(1, 'wave', 'step', 'merging').code, 0)
  assert.match(t.at(2, 'wave', 'step', 'final checks').out, /wave take/, 'wave 2 lacks wave 1\'s closure')
  t.at(2, 'wave', 'take')
  assert.equal(t.at(2, 'wave', 'step', 'final checks').code, 0)
  assert.deepEqual([t.w(2).step, t.w(2).checked], ['final checks', git(t.wt2, 'rev-parse', 'HEAD')])
})

test('a wave whose head moved during its final checks does not merge until they run again on the settled head', () => {
  const t = shipping(1)
  commit(t.wt, 'b.txt', 'fix\n')
  t.cli('wave', 'step', 'final checks')
  const moved = commit(t.wt, 'c.txt', 'late fix\n')
  assert.equal(t.cli('wave', 'step', 'merging').code, 1)
  assert.equal(t.cli('wave', 'shipped').code, 1, 'its checks have not passed')
  t.cli('wave', 'step', 'final checks')
  assert.equal(t.state().sweep.waves[0].checked, moved)
  assert.equal(t.cli('wave', 'step', 'merging').code, 0)
  const tip = commit(t.wt, 'd.txt', 'committed while it merges\n')
  assert.equal(t.cli('wave', 'shipped').code, 1)
  assert.notEqual(git(t.repo, 'rev-parse', 'lcw/tidy'), tip)
  assert.equal(t.ship().code, 0)
  assert.equal(git(t.repo, 'rev-parse', 'lcw/tidy'), tip)
})

test('a repeat of step merging on the head that was checked says it is at merging already and changes nothing', () => {
  const t = shipping(1)
  const tip = commit(t.wt, 'b.txt', 'fix\n')
  t.cli('wave', 'step', 'final checks')
  t.cli('wave', 'step', 'merging')
  const before = JSON.stringify(t.state().sweep)
  const ledger = fs.readFileSync(`${t.dir}/ledger.md`, 'utf8')
  const r = t.cli('wave', 'step', 'merging')
  assert.equal(r.code, 0, r.out)
  assert.equal(r.out.trim(), `wave 1 is at merging already, at ${tip}`)
  assert.equal(JSON.stringify(t.state().sweep), before)
  assert.equal(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), ledger)
})

test('waves land in order, and a shipped wave\'s worktree stays as the latest work until a later wave ships', () => {
  const t = bothShipping()
  t.at(1, 'wave', 'step', 'final checks')
  t.at(1, 'wave', 'step', 'merging')
  t.at(2, 'wave', 'take')
  t.at(2, 'wave', 'step', 'final checks')
  t.at(2, 'wave', 'step', 'merging')
  const r = t.at(2, 'wave', 'shipped')
  assert.equal(r.code, 1)
  assert.match(r.out, /Wave 1/)
  assert.equal(t.at(1, 'wave', 'shipped').code, 0)
  assert.ok(fs.existsSync(t.wt1))
  assert.match(t.cli('status').out, /^ {2}review range: git diff lcw\/tidy\.\.\.lcw\/tidy-wave-2$/m, 'wave 2 reads its own changes on top of what landed')
  assert.equal(t.cli('wave', 'shipped').code, 0, 'the only open wave')
  assert.deepEqual([fs.existsSync(t.wt1), t.w(1).worktree, fs.existsSync(t.wt2)], [false, null, true])
  assert.notEqual(git(t.repo, 'branch', '--list', 'lcw/tidy-wave-1'), '', 'its branch stays')
  assert.equal(git(t.repo, 'rev-parse', 'lcw/tidy'), git(t.wt2, 'rev-parse', 'HEAD'))
  assert.match(t.cli('status').out, new RegExp(`^latest work: ${t.wt2}$`, 'm'))
})

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

/** A sweep with wave 1 and 2 shipped with pull requests 12 and 13, pull requests merged as it goes unless prs says otherwise. */
function shippedWaves(prs = 'merged') {
  const t = sweep()
  t.cli('set', `sweep.prs=${prs}`)
  t.edit((s) => {
    s.sweep.waves = [1, 2].map((n) => ({ n, fixes: 1, status: 'shipped', branch: `lcw/tidy-wave-${n}`, pr: 11 + n, merged: false, dropped: 0, fixed: 1 }))
  })
  return t
}

test('merge readies a draft, merges it with a merge commit on the GitHub remote, and records it', () => {
  const t = shippedWaves()
  const gh = fakeGh()
  const r = lcw(['merge', '1'], { ...t.o, env: gh.env })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(gh.calls(), [
    'pr view 12 -R acme/widgets --json state,isDraft,baseRefName',
    'repo view acme/widgets --json defaultBranchRef',
    'pr ready 12 -R acme/widgets',
    'pr merge 12 -R acme/widgets --merge',
    'pr view 12 -R acme/widgets --json state',
    'api -X DELETE repos/acme/widgets/git/refs/heads/lcw/tidy-wave-1',
  ])
  assert.deepEqual(t.state().sweep.waves.map((w) => w.merged), [true, false])
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /wave 1 merged/)
  assert.equal(lcw(['merge', '1'], { ...t.o, env: gh.env }).code, 1, 'merged already')
  assert.equal(gh.calls().length, 6)
})

test('a pull request the merge only queued is not recorded and keeps its branch, and a later merge records it once GitHub shows it merged', () => {
  const t = shippedWaves()
  const queued = fakeGh({ GH_STATE: 'OPEN' })
  const r = lcw(['merge', '1'], { ...t.o, env: queued.env })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /not merged yet/)
  assert.ok(queued.calls().includes('pr merge 12 -R acme/widgets --merge'), queued.calls().join('\n'))
  assert.ok(!queued.calls().some((c) => c.startsWith('api')), queued.calls().join('\n'))
  assert.equal(t.state().sweep.waves[0].merged, false)
  const later = fakeGh({ GH_STATE: 'MERGED' })
  assert.equal(lcw(['merge', '1'], { ...t.o, env: later.env }).code, 0)
  assert.ok(!later.calls().some((c) => c.startsWith('pr merge')), later.calls().join('\n'))
  assert.ok(later.calls().includes('api -X DELETE repos/acme/widgets/git/refs/heads/lcw/tidy-wave-1'))
  assert.equal(t.state().sweep.waves[0].merged, true)
})

test('a pull request still based on a wave branch is refused, with no write to GitHub', () => {
  const t = shippedWaves()
  t.edit((s) => { s.sweep.waves[0].merged = true })
  const gh = fakeGh({ GH_BASE: 'lcw/tidy-wave-1' })
  const r = lcw(['merge', '2'], { ...t.o, env: gh.env })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /lcw\/tidy-wave-1/)
  assert.match(r.out, /\bmain\b/)
  assert.ok(gh.calls().length > 0 && gh.calls().every((c) => c.startsWith('pr view') || c.startsWith('repo view')), gh.calls().join('\n'))
  assert.equal(t.state().sweep.waves[1].merged, false)
})

test('a pull request GitHub shows merged into a wave branch is not recorded, and its branch is kept', () => {
  const t = shippedWaves()
  t.edit((s) => { s.sweep.waves[0].merged = true })
  const gh = fakeGh({ GH_STATE: 'MERGED', GH_BASE: 'lcw/tidy-wave-1' })
  const r = lcw(['merge', '2'], { ...t.o, env: gh.env })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /lcw\/tidy-wave-1/)
  assert.match(r.out, /\bmain\b/)
  assert.ok(gh.calls().length > 0 && gh.calls().every((c) => c.startsWith('pr view') || c.startsWith('repo view')), gh.calls().join('\n'))
  assert.equal(t.state().sweep.waves[1].merged, false)
})

test('merge deletes the remote wave branch through the api and leaves the local branch, its tracking ref and the worktree alone', () => {
  const t = shippedWaves()
  const wt = `${tmp('wt')}/w`
  git(t.repo, 'worktree', 'add', '-q', '-b', 'lcw/tidy-wave-1', wt)
  git(t.repo, 'update-ref', 'refs/remotes/origin/lcw/tidy-wave-1', 'HEAD')
  const before = git(t.repo, 'for-each-ref')
  const gh = fakeGh()
  const r = lcw(['merge', '1'], { ...t.o, env: gh.env })
  assert.equal(r.code, 0, r.out)
  assert.ok(gh.calls().includes('api -X DELETE repos/acme/widgets/git/refs/heads/lcw/tidy-wave-1'))
  assert.ok(!r.out.includes('is left'), r.out)
  assert.equal(git(t.repo, 'for-each-ref'), before)
  assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lcw/tidy-wave-1')
  assert.ok(fs.existsSync(wt))
  assert.equal(t.state().sweep.waves[0].merged, true)
})

test('merge records a branch GitHub already deleted as deleted', () => {
  for (const GH_API_ERROR of ['gh: Reference does not exist (HTTP 422)', 'gh: Not Found (HTTP 404)']) {
    const t = shippedWaves()
    const r = lcw(['merge', '1'], { ...t.o, env: fakeGh({ GH_API_ERROR }).env })
    assert.equal(r.code, 0, r.out)
    assert.ok(!r.out.includes('is left'), r.out)
    assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /wave 1 merged.*remote branch deleted/)
    assert.equal(t.state().sweep.waves[0].merged, true)
  }
})

test('merge is recorded when the remote branch cannot be deleted, and says it is left', () => {
  const t = shippedWaves()
  const r = lcw(['merge', '1'], { ...t.o, env: fakeGh({ GH_API_ERROR: 'gh: Resource not accessible (HTTP 403)' }).env })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /remote branch lcw\/tidy-wave-1 is left/)
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /wave 1 merged.*is left/)
  assert.equal(t.state().sweep.waves[0].merged, true)
})

test('merge records a pull request GitHub already shows merged without merging it again', () => {
  const t = shippedWaves()
  const gh = fakeGh({ GH_STATE: 'MERGED' })
  const r = lcw(['merge', '1'], { ...t.o, env: gh.env })
  assert.equal(r.code, 0, r.out)
  assert.ok(!gh.calls().some((c) => c.startsWith('pr merge') || c.startsWith('pr ready')), gh.calls().join('\n'))
  assert.ok(gh.calls().some((c) => c.startsWith('api -X DELETE')))
  assert.equal(t.state().sweep.waves[0].merged, true)
})

test('merge leaves a pull request that is no longer a draft as it is', () => {
  const t = shippedWaves()
  const gh = fakeGh({ GH_DRAFT: 'false' })
  assert.equal(lcw(['merge', '1'], { ...t.o, env: gh.env }).code, 0)
  assert.ok(!gh.calls().some((c) => c.startsWith('pr ready')))
})

test('merge is refused out of order, under another choice, and for a wave with no pull request, and calls no gh', () => {
  const t = shippedWaves()
  const gh = fakeGh()
  assert.equal(lcw(['merge', '2'], { ...t.o, env: gh.env }).code, 1, 'wave 1 is not merged')
  t.edit((s) => { s.sweep.waves[0].pr = null })
  assert.equal(lcw(['merge', '1'], { ...t.o, env: gh.env }).code, 1, 'no pull request')
  const u = shippedWaves('stacked')
  assert.equal(lcw(['merge', '1'], { ...u.o, env: gh.env }).code, 1, 'stacked')
  assert.deepEqual(gh.calls(), [])
})

test('a failing gh merge is reported and records nothing', () => {
  const t = shippedWaves()
  const gh = fakeGh({ GH_FAIL: 'pr merge' })
  const r = lcw(['merge', '1'], { ...t.o, env: gh.env })
  assert.equal(r.code, 1)
  assert.match(r.out, /not mergeable/)
  assert.equal(t.state().sweep.waves[0].merged, false)
})

test('a merge GitHub refuses puts the pull request it readied back to draft, and one that was not a draft is left alone', () => {
  const t = shippedWaves()
  const refused = fakeGh({ GH_FAIL: 'pr merge' })
  assert.equal(lcw(['merge', '1'], { ...t.o, env: refused.env }).code, 1)
  assert.deepEqual(refused.calls().slice(2), ['pr ready 12 -R acme/widgets', 'pr merge 12 -R acme/widgets --merge', 'pr ready 12 -R acme/widgets --undo'])
  const open = fakeGh({ GH_FAIL: 'pr merge', GH_DRAFT: 'false' })
  assert.equal(lcw(['merge', '1'], { ...t.o, env: open.env }).code, 1)
  assert.ok(!open.calls().some((c) => c.startsWith('pr ready')), open.calls().join('\n'))
})

test('a merge that was only queued leaves the pull request ready, not back at draft', () => {
  const t = shippedWaves()
  const gh = fakeGh({ GH_STATE: 'OPEN' })
  lcw(['merge', '1'], { ...t.o, env: gh.env })
  assert.ok(gh.calls().includes('pr ready 12 -R acme/widgets'))
  assert.ok(!gh.calls().some((c) => c.includes('--undo')), gh.calls().join('\n'))
})

test('status prints the choice, the round, each wave and the totals', () => {
  const t = shippedWaves()
  t.edit((s) => {
    s.sweep.waves[0].merged = true
    s.sweep.waves.push({ n: 3, fixes: 4, status: 'queued', branch: null, pr: null, merged: false, dropped: 0 })
    Object.assign(s.sweep, { round: 2, fixed: 5, parked: 3, dropped: 1 })
  })
  const out = t.cli('status').out
  assert.match(out, /merged as it goes/)
  assert.match(out, /round: 2/)
  assert.match(out, /fixed: 5.*parked: 3.*dropped: 1/)
  assert.match(out, /^ {2}1 \[shipped\].*lcw\/tidy-wave-1.*#12 merged$/m)
  assert.match(out, /^ {2}2 \[shipped\].*#13 not merged$/m)
  assert.match(out, /^ {2}3 \[queued\].*no PR$/m)
  assert.match(out, new RegExp(`^charter: ${t.dir}/charter.md$`, 'm'))
})

test('a sweep left alone with two waves open is taken over with both worktrees named, and abandoning it removes both and keeps every branch', () => {
  const claudeDir = tmp('claude')
  fs.mkdirSync(`${claudeDir}/sessions`)
  const t = overlapping()
  const leave = () => { const old = new Date(Date.now() - 20 * 60000); for (const f of ['state.json', 'ledger.md']) fs.utimesSync(`${t.dir}/${f}`, old, old) }
  const as = (session, ...a) => lcw(a, { home: t.home, cwd: t.repo, session, env: { CLAUDE_CONFIG_DIR: claudeDir } })
  leave()
  const took = as('s2', 'take', t.state().id)
  assert.equal(took.code, 0, took.out)
  assert.match(took.out, new RegExp(`^worktree of wave 1: ${t.wt1}$`, 'm'))
  assert.match(took.out, new RegExp(`^worktree of wave 2: ${t.wt2}$`, 'm'))
  leave()
  const r = as('s3', 'abandon', t.state().id)
  assert.equal(r.code, 0, r.out)
  assert.ok(!fs.existsSync(t.wt1) && !fs.existsSync(t.wt2), r.out)
  assert.match(r.out, /lcw\/tidy, lcw\/tidy-wave-1, lcw\/tidy-wave-2/)
  assert.notEqual(git(t.repo, 'branch', '--list', 'lcw/tidy-wave-2'), '')
})

test('abandoning a sweep clears where its latest work was', () => {
  const claudeDir = tmp('claude')
  fs.mkdirSync(`${claudeDir}/sessions`)
  const t = overlapping()
  t.edit((s) => { s.sweep.latest = `${t.repo}/.claude/worktrees/gone-latest` })
  const old = new Date(Date.now() - 20 * 60000)
  for (const f of ['state.json', 'ledger.md']) fs.utimesSync(`${t.dir}/${f}`, old, old)
  const r = lcw(['abandon', t.state().id], { home: t.home, cwd: t.repo, session: 's2', env: { CLAUDE_CONFIG_DIR: claudeDir } })
  assert.equal(r.code, 0, r.out)
  assert.equal(t.state().sweep.latest, null)
})

test('stop --pr records the pull request a stopped sweep opened', () => {
  const t = sweep()
  assert.equal(t.cli('stop', '--pr', 'https://github.com/acme/widgets/pull/7').code, 0)
  assert.deepEqual([t.state().status, t.state().pr], ['stopped', { number: 7, url: 'https://github.com/acme/widgets/pull/7' }])
})

test('wave shipped is refused outside Ship, and nothing moves', () => {
  const t = hunting()
  t.cli('wave', 'add', '1')
  t.start()
  commit(t.wt, 'b.txt', 'fix\n')
  for (const stage of ['Build', 'Review']) {
    t.cli('stage', stage)
    assert.equal(t.ship().code, 1, stage)
  }
  assert.equal(t.state().sweep.waves[0].status, 'running')
  assert.notEqual(git(t.repo, 'rev-parse', 'lcw/tidy'), git(t.repo, 'rev-parse', 'lcw/tidy-wave-1'))
  t.cli('stage', 'Ship')
  assert.equal(t.ship().code, 0)
})

test('a wave with no commits ships empty with no pull request, and the waves after it merge without waiting on it', () => {
  const t = shipping(2)
  t.cli('req', 'add', 'F1', 'one')
  t.cli('req', 'F1', 'park')
  t.cli('req', 'add', 'F2', 'two')
  t.cli('req', 'F2', 'drop')
  assert.equal(t.ship('--pr', '5').code, 1, 'a pull request for nothing')
  assert.equal(t.ship().code, 0)
  const empty = t.state().sweep.waves[0]
  assert.deepEqual([empty.status, empty.empty, empty.pr, empty.fixed], ['shipped', true, null, 0])
  assert.match(t.cli('status').out, /^ {2}1 \[shipped\].*empty/m)
  assert.equal(t.cli('wave', 'pr', '1', '5').code, 1, 'an empty wave takes no pull request')
  assert.equal(lcw(['merge', '1'], { ...t.o, env: fakeGh().env }).code, 1, 'and has none to merge')

  t.cli('set', 'sweep.prs=merged')
  t.cli('wave', 'add', '1')
  t.start()
  t.cli('stage', 'Ship')
  commit(t.wt, 'b.txt', 'fix\n')
  assert.equal(t.ship('--pr', '9').code, 0)
  const gh = fakeGh()
  const r = lcw(['merge', '2'], { ...t.o, env: gh.env })
  assert.equal(r.code, 0, r.out)
  assert.ok(gh.calls().includes('pr merge 9 -R acme/widgets --merge'))
})

test('wave pr records the pull request of a shipped wave that has none, as a number or a URL, once', () => {
  const t = shipping(1)
  commit(t.wt, 'b.txt', 'fix\n')
  assert.equal(t.cli('wave', 'pr', '1', '3').code, 1, 'still running')
  t.ship()
  assert.equal(t.cli('wave', 'pr', '1', 'soon').code, 1)
  assert.equal(t.cli('wave', 'pr', '2', '3').code, 1, 'no such wave')
  assert.equal(t.cli('wave', 'pr', '1', 'https://github.com/acme/widgets/pull/31').code, 0)
  assert.equal(t.state().sweep.waves[0].pr, 31)
  assert.equal(t.cli('wave', 'pr', '1', '32').code, 1, 'it has one')
  assert.equal(t.state().sweep.waves[0].pr, 31)
  const u = shipping(1, 'bare')
  commit(u.wt, 'b.txt', 'fix\n')
  u.ship()
  assert.equal(u.cli('wave', 'pr', '1', '7').code, 0)
  assert.equal(u.state().sweep.waves[0].pr, 7)
  const queued = hunting('queued')
  queued.cli('wave', 'add', '1')
  assert.equal(queued.cli('wave', 'pr', '1', '3').code, 1, 'queued')
})

test('req park takes a fix out of the running wave once, and the wave ships counting only what passed', () => {
  const t = hunting()
  t.cli('wave', 'add', '3')
  assert.equal(t.cli('req', 'F1', 'park').code, 1, 'no wave runs')
  t.start()
  for (const id of ['F1', 'F2', 'F3']) t.cli('req', 'add', id, `fix ${id}`)
  assert.equal(t.cli('req', 'F1', 'park').code, 0)
  assert.equal(t.cli('req', 'F1', 'park').code, 0)
  assert.equal(t.cli('req', 'nope', 'park').code, 1)
  assert.deepEqual(t.state().sweep.waves[0].requirements.map((r) => r.status), ['parked', 'todo', 'todo'])
  assert.equal(t.state().sweep.parked, 1)
  t.cli('req', 'F2', 'pass')
  t.cli('req', 'F3', 'park')
  t.cli('stage', 'Ship')
  commit(t.wt, 'b.txt', 'fix\n')
  t.ship()
  const s = t.state().sweep
  assert.deepEqual([s.fixed, s.parked, s.waves[0].fixed], [1, 2, 1])
})

test('req park is refused in a build', () => {
  const o = { home: tmp('home'), cwd: makeRepo(), session: 'b1' }
  lcw(['start', 'b', '--title', 'B'], o)
  lcw(['req', 'add', 'R1', 'one'], o)
  assert.equal(lcw(['req', 'R1', 'park'], o).code, 1)
})

test('Hunt is refused while a wave is queued or still being built, and starts an early round once every open wave is in Review', () => {
  const t = hunting()
  t.cli('wave', 'add', '1')
  t.cli('stage', 'Ship')
  assert.equal(t.cli('stage', 'Hunt').code, 1, 'queued')
  t.start()
  commit(t.wt, 'b.txt', 'fix\n')
  assert.equal(t.cli('stage', 'Hunt').code, 1, 'in Plan')
  t.cli('stage', 'Build')
  const unbuilt = t.cli('stage', 'Hunt')
  assert.equal(unbuilt.code, 1, 'in Build, not built yet')
  assert.match(unbuilt.out, /Wave 1 \(Build\) is still being planned or built/)
  assert.equal(t.state().stage, 'Build')
  t.cli('stage', 'Review')
  const early = t.cli('stage', 'Hunt')
  assert.equal(early.code, 0, 'built and in Review')
  assert.match(early.out, /early round: wave 1 \(Review\) is short of Ship/)
  assert.deepEqual([t.state().stage, t.state().sweep.round, t.state().sweep.early, t.state().sweep.waves[0].stage], ['Hunt', 2, [1], 'Review'])
  assert.match(t.cli('status').out, /round: 2 \(early: wave 1 was short of Ship when it started/)
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /stage: Hunt; .*early round: wave 1 \(Review\)/)
  assert.equal(t.cli('hunt', '--areas', '3').code, 0, 'the hunt round records while the wave is reviewed')
  t.cli('stage', 'Build')
  assert.deepEqual([t.state().stage, t.state().sweep.waves[0].stage], ['Hunt', 'Build'], 'a wave back in Build for its review fixes leaves the hunt round running')
  t.cli('wave', 'add', '1')
  const next = t.start()
  assert.equal(next.code, 0)
  assert.match(next.out, /files the open waves have changed:\n  b\.txt \(wave 1\)/, 'the new wave is told the files the wave still in review has changed')
  assert.deepEqual([t.state().stage, t.state().sweep.waves[1].after], ['Plan', 'lcw/tidy-wave-1'], 'the next wave ends the hunt round')
})

test('a round that starts with every open wave holding in Ship is not an early one', () => {
  const t = shipping(1)
  const r = t.cli('stage', 'Hunt')
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.out, /early round/)
  assert.deepEqual([t.state().sweep.round, t.state().sweep.early], [2, []])
  assert.doesNotMatch(t.cli('status').out, /early:/)
  t.cli('hunt', '--fix', '0', '--park', '0', '--drop', '1')
  assert.equal(t.cli('stage', 'Hunt').out.trim(), 'stage Hunt', 'a repeat changes nothing')
  assert.equal(t.state().sweep.round, 2)
})

test('an early round that finds nothing to fix is followed by one more, once it is sorted and every open wave holds in Ship', () => {
  const t = hunting()
  t.cli('wave', 'add', '1')
  t.start()
  commit(t.wt, 'b.txt', 'fix\n')
  t.cli('stage', 'Build')
  t.cli('stage', 'Review')
  t.cli('stage', 'Hunt')
  assert.match(t.cli('stage', 'Hunt').out, /round 2 stands, an early one\. Once it is sorted, record its counts/, 'not sorted yet: a repeat starts no round and says why')
  assert.equal(t.state().sweep.round, 2)
  t.cli('hunt', '--fix', '0', '--park', '0', '--drop', '2')
  const waits = t.cli('stage', 'Hunt')
  assert.equal(waits.code, 0)
  assert.match(waits.out, /round 2 stands; the round that follows this early one starts once wave 1 holds in Ship/)
  assert.equal(t.state().sweep.round, 2)
  t.cli('stage', 'Ship')
  assert.deepEqual([t.state().stage, t.state().sweep.waves[0].stage], ['Hunt', 'Ship'])
  const follows = t.cli('stage', 'Hunt')
  assert.equal(follows.code, 0, follows.out)
  assert.doesNotMatch(follows.out, /early round/)
  assert.deepEqual([t.state().sweep.round, t.state().sweep.early, t.state().sweep.sorted, t.state().sweep.hunt.drop], [3, [], false, 0])
  assert.equal(t.state().sweep.dropped, 2, 'the early round\'s drops stay counted')
})

test('an early round that found fixes is not repeated: its waves are queued', () => {
  const t = hunting()
  t.cli('wave', 'add', '1')
  t.start()
  t.cli('stage', 'Build')
  t.cli('stage', 'Review')
  t.cli('stage', 'Hunt')
  t.cli('hunt', '--fix', '3', '--park', '0', '--drop', '0')
  t.cli('stage', 'Ship')
  assert.equal(t.cli('stage', 'Hunt').out.trim(), 'stage Hunt')
  assert.equal(t.state().sweep.round, 2)
})

test('wave round takes a number, which sets the round and puts a mistaken raise right', () => {
  const t = shipping(1)
  t.cli('stage', 'Review')
  t.cli('wave', 'round')
  t.cli('wave', 'round')
  assert.equal(t.state().sweep.waves[0].round, 3)
  const r = t.cli('wave', 'round', '2')
  assert.equal(r.code, 0)
  assert.match(r.out, /wave 1: round 2/)
  assert.equal(t.state().sweep.waves[0].round, 2)
  assert.equal(t.cli('wave', 'round', '0').code, 1)
  assert.equal(t.cli('wave', 'round', 'two').code, 1)
  assert.equal(t.state().sweep.waves[0].round, 2)
  assert.equal(t.cli('wave', 'round', '4').code, 0, 'a number above the round raises it')
  assert.equal(t.state().sweep.waves[0].round, 4)
})

test('a flag may hold its value in the same word, set takes --wave with a key of the run, and a ledger line may name a shipped wave', () => {
  const t = overlapping()
  assert.equal(t.cli('task', 'add', 'T1', 'one', '--wave 2').code, 0, 'as a shell variable that was not split gives it')
  assert.equal(t.cli('task', 'add', 'T2', 'two', '--wave=2').code, 0)
  assert.deepEqual(t.w(2).tasks.map((x) => x.id), ['T1', 'T2'])
  assert.equal(t.cli('task', 'add', 'T3', 'three', '--wave').code, 1, 'a flag with no value is still refused')
  const set = t.cli('set', 'health=wave 2 building', '--wave', '2')
  assert.equal(set.code, 0, set.out)
  assert.equal(t.state().health, 'wave 2 building')
  t.at(1, 'stage', 'Ship')
  t.at(1, 'wave', 'step', 'final checks')
  t.at(1, 'wave', 'step', 'merging')
  assert.equal(t.at(1, 'wave', 'shipped').code, 0)
  const line = t.cli('ledger', 'its pull request was merged by hand', '--wave', '1')
  assert.equal(line.code, 0, line.out)
  assert.match(fs.readFileSync(`${t.dir}/waves/1/ledger.md`, 'utf8'), /its pull request was merged by hand/)
  assert.equal(t.cli('ask', 'a question', '--wave', '1').code, 1, 'a shipped wave still takes no ask')
})

test('going back to Charter clears the approval, so Hunt needs the charter put to the person again', () => {
  const t = hunting()
  t.cli('stage', 'Charter')
  assert.equal(t.state().sweep.approvedAt, null)
  assert.equal(t.cli('stage', 'Hunt').code, 1)
  t.cli('approval')
  assert.equal(t.cli('stage', 'Hunt').code, 0)
})

test('start is refused while this session drives an unfinished run of either shape, and allowed once it is finished or stopped', () => {
  const t = sweep()
  const again = t.cli('start', 'second', '--title', 'Second')
  assert.equal(again.code, 1)
  assert.ok(again.out.includes(t.state().id) && /another session/.test(again.out), again.out)
  assert.ok(!/lcw stop/.test(again.out), again.out)
  assert.equal(lcw(['runs'], t.o).out.trim().split('\n').length, 1)
  assert.equal(lcw(['start', 'other', '--title', 'Other'], { ...t.o, session: 's2' }).code, 0, 'another session is free to start')
  t.cli('finish')
  assert.equal(t.cli('start', 'second', '--title', 'Second').code, 0)
  const b = { home: t.home, cwd: t.repo, session: 'b1' }
  lcw(['start', 'build', '--title', 'Build'], b)
  assert.equal(lcw(['start', 'again', '--title', 'Again'], b).code, 1, 'a build blocks too')
  lcw(['stop'], b)
  assert.equal(lcw(['start', 'again', '--title', 'Again'], b).code, 0)
})

test('finish and stop take a pull request as a bare number or a URL', () => {
  const t = sweep()
  t.cli('stop', '--pr', '7')
  assert.deepEqual(t.state().pr, { number: 7, url: 'https://github.com/acme/widgets/pull/7' })
  const o = { home: t.home, cwd: makeRepo(), session: 'f1' }
  const dir = /^folder: (.+)$/m.exec(lcw(['start', 'f', '--title', 'F'], o).out)[1]
  lcw(['finish', '--pr', '9'], o)
  assert.equal(readJson(`${dir}/state.json`).pr.number, 9)
  const u = { ...o, session: 'f2' }
  const dir2 = /^folder: (.+)$/m.exec(lcw(['start', 'g', '--title', 'G'], u).out)[1]
  lcw(['finish', '--pr', 'https://github.com/acme/widgets/pull/11'], u)
  assert.equal(readJson(`${dir2}/state.json`).pr.number, 11)
})

test('a parked fix cannot also be passed, failed or reset, it can be dropped once, and parking it again is harmless', () => {
  const t = hunting()
  t.cli('wave', 'add', '1')
  t.start()
  t.cli('req', 'add', 'F1', 'fix one')
  t.cli('req', 'F1', 'park')
  for (const s of ['pass', 'failing', 'todo']) {
    const r = t.cli('req', 'F1', s)
    assert.equal(r.code, 1, s)
    assert.match(r.out, /stays parked; it can only be dropped/)
  }
  assert.equal(t.cli('req', 'F1', 'park').code, 0)
  const wave = () => t.state().sweep.waves[0]
  assert.deepEqual([wave().requirements[0].status, t.state().sweep.parked, wave().dropped], ['parked', 1, 0])
  assert.equal(t.cli('req', 'F1', 'drop').code, 0)
  assert.deepEqual([wave().requirements.length, t.state().sweep.parked, wave().dropped], [0, 0, 1])
})

test('dropping a parked fix of a shipped wave counts it dropped once, and the shipped wave does not take it', () => {
  const t = shipping(1)
  t.cli('req', 'add', 'F1', 'fix one')
  t.cli('req', 'F1', 'park')
  commit(t.wt, 'b.txt', 'fix\n')
  t.ship()
  assert.deepEqual([t.state().sweep.parked, t.state().sweep.dropped], [1, 0])
  assert.equal(t.cli('req', 'F1', 'pass', '--wave', '1').code, 1, 'a shipped wave\'s lists stay as they shipped')
  assert.equal(t.cli('req', 'F1', 'drop', '--wave', '1').code, 0)
  assert.deepEqual([t.state().sweep.parked, t.state().sweep.dropped, t.state().sweep.waves[0].dropped], [0, 1, 0])
})

test('wave pr is refused under one pull request at the end', () => {
  const t = shipping(1)
  commit(t.wt, 'b.txt', 'fix\n')
  t.ship()
  t.edit((s) => { s.sweep.prs = 'end' })
  assert.equal(t.cli('wave', 'pr', '1', '3').code, 1)
  assert.equal(t.state().sweep.waves[0].pr, null)
})

test('a merge GitHub refuses says so when the pull request could not be put back to draft', () => {
  const t = shippedWaves()
  const r = lcw(['merge', '1'], { ...t.o, env: fakeGh({ GH_FAIL: 'pr merge', GH_UNDO_FAIL: '1' }).env })
  assert.equal(r.code, 1)
  assert.match(r.out, /still marked ready/)
})

test('stage Charter in Charter changes nothing, so an approval already asked stays', () => {
  const t = sweep()
  t.cli('approval')
  const at = t.state().sweep.approvedAt
  assert.ok(at)
  assert.equal(t.cli('stage', 'Charter').code, 0)
  assert.equal(t.state().sweep.approvedAt, at)
})

test('wave shipped --pr is refused when the charter chose one pull request at the end', () => {
  const t = shipping(1)
  t.cli('set', 'sweep.prs=end')
  commit(t.wt, 'a.txt', 'x\n')
  assert.equal(t.ship('--pr', '5').code, 1)
  assert.equal(t.state().sweep.waves[0].status, 'running')
  assert.equal(t.ship().code, 0)
})

test('a question is added with its choices, picked once, answered in words or used, and shown in status', () => {
  const t = hunting()
  const add = (...a) => t.cli('question', 'add', ...a)
  assert.equal(add('Q1', '--text', 'Allow a 422?', '--a', 'Answer 422').code, 1, 'two choices, each with what it means')
  assert.equal(add('Q1', '--text', 'Allow a 422?', '--why', 'a 409 names the owner', '--a', 'Answer 422: fixed next wave', '--b', 'Keep the 409: closed as decided').code, 0)
  assert.equal(add('Q1', '--text', 'again', '--a', 'x: y', '--b', 'z: w').code, 1)
  assert.equal(t.cli('question', 'Q1', 'used').code, 1, 'only an answered question is used')
  assert.equal(t.cli('question', 'Q1', 'pick', 'd').code, 1)
  assert.equal(t.cli('question', 'Q1', 'pick', 'a').code, 0)
  assert.match(t.cli('question', 'Q1', 'pick', 'b').out, /answered already/)
  assert.deepEqual([t.state().questions[0].status, t.state().questions[0].pick], ['answered', 'a'])
  assert.match(t.cli('status').out, /Q1 \[answered: a, Answer 422\] Allow a 422\?/)
  assert.equal(t.cli('question', 'Q1', 'used').code, 0)

  add('Q2', '--text', 'Which cutoff?', '--a', '30 days: x', '--b', '90 days: y')
  assert.equal(t.cli('question', 'Q2', 'pick', 'other').code, 1, 'their own words come through answer')
  t.cli('question', 'Q2', 'answer', '60 days')
  assert.deepEqual([t.state().questions[1].status, t.state().questions[1].words], ['answered', '60 days'])
})

test('a question used with an answer settles one parked item, never below none, and one left parked does not', () => {
  const t = hunting()
  t.cli('hunt', '--fix', '0', '--park', '2', '--drop', '0')
  const ask = (id) => t.cli('question', 'add', id, '--text', `${id}?`, '--a', 'Yes: fix it', '--b', 'No: leave it')
  for (const id of ['Q1', 'Q2', 'Q3', 'Q4']) ask(id)
  t.cli('question', 'Q1', 'pick', 'a')
  assert.match(t.cli('question', 'Q1', 'used').out, /Q1: used/)
  assert.equal(t.state().sweep.parked, 1)
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /question Q1 used; parked down to 1/)
  t.cli('question', 'Q2', 'pick', 'park')
  t.cli('question', 'Q2', 'used')
  assert.equal(t.state().sweep.parked, 1, 'left parked')
  t.cli('question', 'Q3', 'answer', 'only the second half')
  t.cli('question', 'Q3', 'used')
  assert.equal(t.state().sweep.parked, 0)
  t.cli('question', 'Q4', 'pick', 'b')
  t.cli('question', 'Q4', 'used')
  assert.equal(t.state().sweep.parked, 0)
  assert.doesNotMatch(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /question Q4 used;/)
})

test('questions are a sweep\'s own', () => {
  const home = tmp('home')
  const o = { home, cwd: makeRepo(), session: 's1' }
  lcw(['start', 'b', '--title', 'B'], o)
  const r = lcw(['question', 'add', 'Q1', '--text', 't', '--a', 'x: y', '--b', 'z: w'], o)
  assert.equal(r.code, 1)
  assert.match(r.out, /is for a sweep/)
})

/** A sweep with waves 1 and 2 open, each with its own folder as its worktree, written straight into the state. */
function twoOpen() {
  const t = hunting()
  const wts = [1, 2].map(() => tmp('wave'))
  t.edit((s) => {
    s.stage = 'Build'
    s.sweep.waves = [1, 2].map((n) => ({
      n, fixes: 2, status: 'running', branch: `lcw/tidy-wave-${n}`, pr: null, merged: false, dropped: 0, stage: n === 1 ? 'Review' : 'Build',
      stageSince: 0, step: null, round: n === 1 ? 1 : 0, waiting: false, tasks: [], requirements: [], plan: { tasks: 0, atOnce: 0, models: {} },
      milestone: null, worktree: wts[n - 1], after: n === 1 ? 'lcw/tidy' : 'lcw/tidy-wave-1', base: null, checked: null,
    }))
  })
  const wave = (n) => t.state().sweep.waves[n - 1]
  return { ...t, wts, wave, at: (where, ...a) => lcw(a, { ...t.o, cwd: where }) }
}

test('with two waves open a wave command needs --wave, except inside a wave\'s worktree, where that wave is meant', () => {
  const t = twoOpen()
  const r = t.cli('task', 'add', 'T1', 'one')
  assert.equal(r.code, 1)
  assert.match(r.out, /1 and 2.*--wave/)
  assert.equal(t.cli('task', 'add', 'T1', 'one', '--wave', '1').code, 0)
  assert.equal(t.at(t.wts[1], 'task', 'add', 'T1', 'two').code, 0)
  assert.equal(t.at(t.wts[1], 'task', 'T1', 'done').code, 0)
  assert.equal(t.at(t.wts[1], 'set', 'plan.tasks=3', 'milestone=1 of 2').code, 0)
  assert.equal(t.cli('req', 'add', 'F1', 'fix', '--wave', '2').code, 0)
  assert.deepEqual([t.wave(1).tasks.map((x) => x.status), t.wave(2).tasks.map((x) => x.status)], [['todo'], ['done']])
  assert.deepEqual([t.wave(2).plan.tasks, t.wave(2).milestone, t.wave(2).requirements.length, t.wave(1).plan.tasks], [3, '1 of 2', 1, 0])
  assert.deepEqual([t.state().tasks, t.state().requirements], [[], []])
  assert.equal(t.cli('stage', 'Ship').code, 1)
  assert.equal(t.cli('task', 'add', 'T2', 'x', '--wave', '3').code, 1, 'no wave 3')
  assert.equal(t.cli('set', 'sweep.open=1', '--wave', '1').code, 0, 'a key of the run is set on the run, whatever wave is named')
  assert.deepEqual([t.state().sweep.open, t.wave(1).sweep], [1, undefined])
})

test('a ledger line about one wave goes to its own ledger too, and one with several waves open to the run\'s only', () => {
  const t = twoOpen()
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '')
  t.cli('ledger', 'both waves')
  t.cli('ledger', 'about wave 2', '--wave', '2')
  t.at(t.wts[0], 'ledger', 'from wave 1')
  assert.match(read(`${t.dir}/ledger.md`), /both waves[\s\S]*about wave 2[\s\S]*from wave 1/)
  assert.ok(!read(`${t.dir}/waves/1/ledger.md`).includes('both waves') && !read(`${t.dir}/waves/2/ledger.md`).includes('both waves'))
  assert.match(read(`${t.dir}/waves/2/ledger.md`), /about wave 2/)
  assert.match(read(`${t.dir}/waves/1/ledger.md`), /from wave 1/)
  assert.ok(!read(`${t.dir}/waves/1/ledger.md`).includes('about wave 2'))
})

test('ask --wave marks that wave waiting until its last ask is answered', () => {
  const t = twoOpen()
  t.cli('ask', 'push needs your token', '--wave', '1')
  t.cli('ask', 'and the tag?', '--wave', '1')
  t.cli('ask', 'about the run')
  assert.deepEqual([t.wave(1).waiting, t.wave(2).waiting], [true, false])
  t.cli('answer', '1', 'here')
  assert.equal(t.wave(1).waiting, true, 'ask 2 still names it')
  t.cli('answer', '2', 'v1')
  assert.equal(t.wave(1).waiting, false)
  assert.equal(t.state().asks.length, 1)
})

test('a sweep from before waves kept their own records has its running wave\'s stage, lists and worktree moved onto it by the next change', () => {
  const t = hunting()
  const wt = tmp('old')
  t.edit((s) => {
    s.sweep.waves = [{ n: 1, fixes: 2, status: 'shipped', branch: 'lcw/tidy-wave-1', pr: 4, merged: false, dropped: 0, fixed: 2 }, { n: 2, fixes: 2, status: 'running', branch: 'lcw/tidy-wave-2', pr: null, merged: false, dropped: 0 }]
    Object.assign(s, { stage: 'Review', stageSince: 1234, worktree: wt, base: 'abc', milestone: '1 of 1', plan: { tasks: 2, atOnce: 2, models: {} } })
    s.tasks = [{ id: 'T1', title: 'one', status: 'done' }]
    s.requirements = [{ id: 'F1', name: 'fix', status: 'todo' }]
  })
  assert.match(t.cli('status').out, /waves\/2\/plan.md/, 'status shows the wave as it will be')
  assert.equal(t.state().sweep.waves[1].stage, undefined, 'status changes nothing')
  assert.equal(t.cli('req', 'F1', 'pass').code, 0)
  const s = t.state()
  const w = s.sweep.waves[1]
  assert.deepEqual([w.stage, w.stageSince, w.round, w.worktree, w.base, w.after, w.milestone, w.plan.tasks], ['Review', 1234, 1, wt, 'abc', 'lcw/tidy', '1 of 1', 2])
  assert.deepEqual([w.tasks.map((x) => x.id), w.requirements.map((x) => x.status)], [['T1'], ['pass']])
  assert.deepEqual([s.tasks, s.requirements, s.worktree, s.stage], [[], [], null, 'Review'])
  assert.equal(s.sweep.waves[0].stage, undefined, 'a shipped wave is left as it was')
})

test('a shipped wave held for its merge is not the default wave: run-level commands act on the run, and a new wave on itself', () => {
  const t = hunting()
  t.cli('set', 'sweep.prs=merged')
  t.cli('wave', 'add', '1')
  t.start()
  t.cli('stage', 'Ship')
  commit(t.wt, 'b.txt', 'fix\n')
  assert.equal(t.ship('--pr', '5').code, 0)
  assert.equal(t.cli('stage', 'Hunt').code, 0, 'wave 1 holds for its merge')
  const wave = (n) => t.state().sweep.waves[n - 1]
  assert.equal(t.cli('ask', 'about the run').code, 0)
  assert.equal(wave(1).waiting, false)
  assert.equal(t.cli('ask', 'merge it?', '--wave', '1').code, 0)
  assert.equal(wave(1).waiting, true, 'still reached with --wave')
  for (const a of [['task', 'add', 'T1', 'one'], ['req', 'add', 'F1', 'fix'], ['set', 'plan.tasks=2']]) assert.equal(t.cli(...a).code, 0, a.join(' '))
  assert.deepEqual([t.state().tasks.length, t.state().requirements.length, t.state().plan.tasks, wave(1).tasks.length], [1, 1, 2, 0])

  t.cli('wave', 'add', '1')
  t.start()
  assert.equal(t.cli('task', 'add', 'T1', 'two').code, 0, 'the running wave, not a refusal for two open')
  assert.equal(t.cli('stage', 'Build').code, 0)
  assert.deepEqual([wave(2).tasks.length, wave(2).stage, wave(1).stage], [1, 'Build', 'Ship'])
})

test('a shipped wave drops only its parked fixes, and a fix that passed keeps its count', () => {
  const t = shipping(2)
  t.cli('req', 'add', 'F1', 'one')
  t.cli('req', 'F1', 'pass')
  t.cli('req', 'add', 'F2', 'two')
  t.cli('req', 'F2', 'park')
  commit(t.wt, 'b.txt', 'fix\n')
  t.ship()
  assert.equal(t.cli('req', 'F1', 'drop', '--wave', '1').code, 1)
  assert.match(t.cli('req', 'F2', 'drop').out, /--wave 1/, 'with no --wave it names the shipped wave')
  const s = t.state().sweep
  assert.deepEqual([s.waves[0].requirements.map((r) => r.id), s.fixed, s.dropped], [['F1', 'F2'], 1, 0])
  assert.equal(t.cli('req', 'F2', 'drop', '--wave', '1').code, 0)
})

test('a sweep whose worktree from before waves had their own sits on its branch ships a wave and moves that worktree with the branch', () => {
  const t = hunting()
  const old = `${tmp('old')}/wt`
  git(t.repo, 'worktree', 'add', '-q', old, 'lcw/tidy')
  t.edit((s) => { s.worktree = old })
  t.cli('wave', 'add', '1')
  t.start()
  t.cli('stage', 'Ship')
  const tip = commit(t.wt, 'b.txt', 'fix\n')
  const r = t.ship()
  assert.equal(r.code, 0, r.out)
  assert.deepEqual([git(t.repo, 'rev-parse', 'lcw/tidy'), git(old, 'rev-parse', 'HEAD'), git(old, 'symbolic-ref', 'HEAD')], [tip, tip, 'refs/heads/lcw/tidy'])
  assert.equal(fs.readFileSync(`${old}/b.txt`, 'utf8'), 'fix\n')
})

test('a wave sent back to Build keeps its review round when it enters Review again', () => {
  const t = shipping(1)
  t.cli('stage', 'Review')
  t.cli('wave', 'round')
  t.cli('stage', 'Build')
  t.cli('stage', 'Review')
  assert.equal(t.state().sweep.waves[0].round, 2)
  t.cli('wave', 'round')
  assert.equal(t.state().sweep.waves[0].round, 3)
})

test('a wave with no commits of its own still ships empty after taking in the wave before it, and holds its work', () => {
  const t = overlapping()
  const fix = commit(t.wt1, 'c.txt', 'review fix\n')
  assert.equal(t.at(2, 'wave', 'take').code, 0)
  t.at(1, 'stage', 'Ship')
  t.at(1, 'wave', 'step', 'final checks')
  t.at(1, 'wave', 'step', 'merging')
  assert.equal(t.at(1, 'wave', 'shipped').code, 0)
  assert.equal(t.at(2, 'wave', 'take').code, 0)
  t.at(2, 'stage', 'Review')
  t.at(2, 'stage', 'Ship')
  t.at(2, 'wave', 'step', 'final checks')
  t.at(2, 'wave', 'step', 'merging')
  assert.equal(t.at(2, 'wave', 'shipped').code, 0)
  assert.equal(t.w(2).empty, true)
  assert.equal(git(t.repo, 'merge-base', '--is-ancestor', fix, 'lcw/tidy-wave-2'), '')
})

test('a run-level ledger line during a hunt stays out of a shipped wave held for its merge', () => {
  const t = hunting()
  t.cli('set', 'sweep.prs=merged')
  t.cli('wave', 'add', '1')
  t.start()
  t.cli('stage', 'Ship')
  commit(t.wt, 'b.txt', 'fix\n')
  t.ship('--pr', '5')
  t.cli('stage', 'Hunt')
  assert.equal(t.cli('hunt', '--fix', '2').code, 0)
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /hunt, round/)
  assert.ok(!fs.readFileSync(`${t.dir}/waves/1/ledger.md`, 'utf8').includes('hunt, round'))
})

test('ask and ledger with no --wave, run from the main checkout while one wave is held and another runs, are the run\'s own', () => {
  const t = shippedWaves()
  t.edit((s) => { s.sweep.waves.pop(); s.sweep.waves.push({ n: 2, fixes: 1, status: 'running', branch: 'lcw/tidy-wave-2', worktree: `${t.repo}/.claude/worktrees/tidy-wave-2`, stage: 'Build', step: null, round: 0, waiting: false, tasks: [], requirements: [], plan: { tasks: 0, atOnce: 0, models: {} } }) })
  assert.equal(t.cli('ask', 'which way?').code, 0)
  assert.equal(t.cli('ledger', 'a note for the run').code, 0)
  assert.equal(t.state().sweep.waves[1].waiting, false)
  assert.equal(t.state().asks[0].wave, undefined)
  const own = fs.readFileSync(`${t.dir}/ledger.md`, 'utf8')
  assert.match(own, /which way\?/)
  assert.match(own, /a note for the run/)
  const wl = `${t.dir}/waves/2/ledger.md`
  assert.equal(fs.existsSync(wl) && /which way|a note for the run/.test(fs.readFileSync(wl, 'utf8')), false)
})

/** Waves 1 to 3 queued, wave 1 started with a commit and in Review; ok runs a command that must pass, wt is the newest started wave's worktree. */
function three() {
  const t = hunting()
  t.cli('wave', 'add', '1', '1', '1')
  t.start()
  const wt1 = t.wt
  commit(wt1, 'b.txt', 'one\n')
  t.cli('stage', 'Review')
  const ok = (...a) => { const r = t.cli(...a); assert.equal(r.code, 0, `${a.join(' ')}\n${r.out}`); return r }
  return { ...t, wt1, ok, w: (n) => t.state().sweep.waves[n - 1], get wt() { return t.wt } }
}

test('a wave sent back from Ship waits while two other waves are being built or reviewed', () => {
  const t = three()
  t.start()
  t.ok('stage', 'Ship', '--wave', '1')
  t.ok('stage', 'Review', '--wave', '2')
  t.start()
  const r = t.cli('stage', 'Build', '--wave', '1')
  assert.equal(r.code, 1)
  assert.match(r.out, /2 \(Review\) and 3 \(Plan\)/)
  assert.equal(t.w(1).stage, 'Ship')
  t.ok('stage', 'Ship', '--wave', '2')
  t.ok('stage', 'Build', '--wave', '1')
})

test('a wave back in Build for review fixes counts as built, so the next wave may start', () => {
  const t = three()
  t.ok('stage', 'Build')
  assert.equal(t.start().code, 0)
})

test('wave files lists each open wave\'s own changes, not a file it only took in from a wave that shipped', () => {
  const t = overlapping()
  commit(t.wt2, 'e.txt', 'wave 2 fix\n')
  commit(t.wt1, 'c.txt', 'review fix\n')
  t.at(2, 'wave', 'take')
  t.at(1, 'stage', 'Ship')
  t.at(1, 'wave', 'step', 'final checks')
  t.at(1, 'wave', 'step', 'merging')
  assert.equal(t.at(1, 'wave', 'shipped').code, 0)
  const out = t.cli('wave', 'files').out
  assert.match(out, /^ {2}e\.txt \(wave 2\)$/m)
  assert.doesNotMatch(out, /c\.txt|b\.txt/)
})

test('a wave takes in a fix an earlier wave got after the wave it was cut from, and is reviewed only with it', () => {
  const t = three()
  t.start()
  t.ok('stage', 'Ship', '--wave', '1')
  t.ok('stage', 'Review', '--wave', '2')
  t.ok('stage', 'Ship', '--wave', '2')
  t.start()
  t.ok('stage', 'Build', '--wave', '3')
  t.ok('stage', 'Build', '--wave', '1')
  const fix = commit(t.wt1, 'f.txt', 'checks fix\n')
  const r = t.cli('stage', 'Review', '--wave', '3')
  assert.equal(r.code, 1)
  assert.match(r.out, /lcw\/tidy-wave-1/)
  t.ok('wave', 'take', '--wave', '2')
  t.ok('wave', 'take', '--wave', '3')
  assert.equal(git(t.wt, 'rev-parse', 'HEAD'), fix, 'a wave with no commits of its own fast-forwards')
  t.ok('stage', 'Review', '--wave', '3')
})

test('a wave takes in only the wave before it, once that wave holds every earlier one, so its review range and files are its own', () => {
  const t = three()
  t.start()
  t.ok('stage', 'Ship', '--wave', '1')
  commit(t.wt, 'e.txt', 'wave 2 fix\n')
  t.ok('stage', 'Review', '--wave', '2')
  t.ok('stage', 'Ship', '--wave', '2')
  t.start()
  const had = commit(t.wt, 'g.txt', 'wave 3 fix\n')
  t.ok('stage', 'Build', '--wave', '3')
  t.ok('stage', 'Build', '--wave', '1')
  commit(t.wt1, 'f.txt', 'checks fix\n')
  const r = t.cli('wave', 'take', '--wave', '3')
  assert.equal(r.code, 1)
  assert.match(r.out, /lcw wave take --wave 2\b/)
  assert.equal(git(t.wt, 'rev-parse', 'HEAD'), had)
  t.ok('wave', 'take', '--wave', '2')
  t.ok('wave', 'take', '--wave', '3')
  const range = /^wave 3: .*\n {2}review range: git diff (\S+)$/m.exec(t.cli('status').out)[1]
  assert.equal(git(t.repo, 'diff', '--name-only', range), 'g.txt')
  assert.deepEqual(t.cli('wave', 'files').out.trim().split('\n').slice(1), ['  b.txt (wave 1)', '  e.txt (wave 2)', '  f.txt (wave 1)', '  g.txt (wave 3)'])
  t.ok('stage', 'Review', '--wave', '3')
})

test('an earlier wave whose head moved after its final checks passed holds back the next wave\'s final checks', () => {
  const t = bothShipping()
  t.at(1, 'wave', 'step', 'final checks')
  t.at(1, 'wave', 'step', 'merging')
  commit(t.wt1, 'g.txt', 'late\n')
  t.at(2, 'wave', 'take')
  const r = t.at(2, 'wave', 'step', 'final checks')
  assert.equal(r.code, 1)
  assert.match(r.out, /Wave 1/)
})

test('final checks do not start while a task of the wave is running', () => {
  const t = shipping(1)
  t.cli('task', 'add', 'T1', 'fix it')
  t.cli('task', 'T1', 'running')
  const r = t.cli('wave', 'step', 'final checks')
  assert.equal(r.code, 1)
  assert.match(r.out, /T1/)
  t.cli('task', 'T1', 'done')
  assert.equal(t.cli('wave', 'step', 'final checks').code, 0)
})

test('a wave with nothing of its own beyond what it took in merges with no final checks, once the wave before it has passed', () => {
  const t = overlapping()
  t.at(1, 'stage', 'Ship')
  t.at(2, 'stage', 'Review')
  t.at(2, 'stage', 'Ship')
  const early = t.at(2, 'wave', 'step', 'merging')
  assert.equal(early.code, 1)
  assert.match(early.out, /Wave 1's final checks have not passed/)
  t.at(1, 'wave', 'step', 'final checks')
  t.at(1, 'wave', 'step', 'merging')
  const r = t.at(2, 'wave', 'step', 'merging')
  assert.equal(r.code, 0, r.out)
  assert.equal(t.at(1, 'wave', 'shipped').code, 0)
  assert.equal(t.at(2, 'wave', 'shipped').code, 0)
  assert.equal(t.w(2).empty, true)
})

/** Waves 1 and 2 both holding in Ship, each with a commit, and wave 1 with a closure wave 2 has not taken in. */
function holdingWithClosure(closure = ['d.txt', 'closure\n']) {
  const t = overlapping()
  commit(t.wt2, 'e.txt', 'wave 2 fix\n')
  t.at(2, 'stage', 'Review')
  t.at(1, 'stage', 'Ship')
  t.at(2, 'stage', 'Ship')
  commit(t.wt1, ...closure)
  return t
}

test('a hunt beside open waves reads a fresh worktree of every wave\'s latest work, removed when the sweep finishes', () => {
  const t = holdingWithClosure()
  const r = t.cli('stage', 'Hunt')
  assert.equal(r.code, 0, r.out)
  const latest = fs.realpathSync(`${t.repo}/.claude/worktrees/tidy-latest`)
  assert.match(t.cli('status').out, new RegExp(`^latest work: ${latest}$`, 'm'))
  assert.ok(fs.existsSync(`${latest}/d.txt`) && fs.existsSync(`${latest}/e.txt`), 'both waves\' work')
  assert.equal(git(t.repo, 'rev-parse', 'lcw/tidy-wave-2'), git(t.wt2, 'rev-parse', 'HEAD'), 'no wave\'s branch moves')
  assert.equal(git(t.repo, 'rev-parse', `refs/lcw/tidy/hunt-${t.state().sweep.round}`), git(latest, 'rev-parse', 'HEAD'), 'the round\'s commit stays reachable')
  assert.equal(t.cli('finish').code, 0)
  assert.ok(!fs.existsSync(latest))
  assert.equal(git(t.repo, 'for-each-ref', 'refs/lcw/'), '')
})

test('a worktree folder deleted outside git does not block wave start or a hunt from making it again', () => {
  const t = hunting()
  t.cli('wave', 'add', '1')
  const gone = (dir, ...a) => { git(t.repo, 'worktree', 'add', '-q', ...a, dir); fs.rmSync(dir, { recursive: true, force: true }) }
  gone(`${t.repo}/.claude/worktrees/tidy-wave-1`, '-b', 'stray')
  const started = t.start()
  assert.equal(started.code, 0, started.out)
  t.cli('stage', 'Ship')
  gone(`${t.repo}/.claude/worktrees/tidy-latest`, '--detach')
  const hunt = t.cli('stage', 'Hunt')
  assert.equal(hunt.code, 0, hunt.out)
  assert.equal(t.state().sweep.round, 2)
  assert.ok(fs.existsSync(`${t.repo}/.claude/worktrees/tidy-latest/a.txt`))
})

test('stop removes the hunt\'s worktree and the refs that kept its rounds\' commits', () => {
  const t = holdingWithClosure()
  assert.equal(t.cli('stage', 'Hunt').code, 0)
  const latest = `${t.repo}/.claude/worktrees/tidy-latest`
  assert.notEqual(git(t.repo, 'for-each-ref', 'refs/lcw/'), '')
  assert.equal(t.cli('stop').code, 0)
  assert.ok(!fs.existsSync(latest))
  assert.equal(git(t.repo, 'for-each-ref', 'refs/lcw/'), '')
})

test('a take-in is refused while a task of the wave is running, and nothing moves', () => {
  const t = overlapping()
  commit(t.wt1, 'c.txt', 'review fix\n')
  t.at(2, 'task', 'add', 'T1', 'fix it')
  t.at(2, 'task', 'T1', 'running')
  const had = git(t.wt2, 'rev-parse', 'HEAD')
  const r = t.at(2, 'wave', 'take')
  assert.equal(r.code, 1)
  assert.match(r.out, /T1.*still running.*wait/s)
  assert.equal(git(t.wt2, 'rev-parse', 'HEAD'), had)
  t.at(2, 'task', 'T1', 'done')
  assert.equal(t.at(2, 'wave', 'take').code, 0)
})

/** three(), with waves 1 and 2 in Ship and wave 3 started: wave 3 has merged wave 2's tip and wave 1's later fix, but wave 2 lacks that fix. */
function mergedPastTheWaveBefore() {
  const t = three()
  t.start()
  const wt2 = t.wt
  commit(wt2, 'e.txt', 'wave 2 fix\n')
  t.ok('stage', 'Ship', '--wave', '1')
  t.ok('stage', 'Review', '--wave', '2')
  t.ok('stage', 'Ship', '--wave', '2')
  t.start()
  const wt3 = t.wt
  commit(wt3, 'g.txt', 'wave 3 fix\n')
  t.ok('stage', 'Build', '--wave', '1')
  const fix = commit(t.wt1, 'f.txt', 'checks fix\n')
  git(wt3, 'merge', '--no-ff', '--no-edit', '-q', 'lcw/tidy-wave-2')
  git(wt3, 'merge', '--no-ff', '--no-edit', '-q', 'lcw/tidy-wave-1')
  t.ok('stage', 'Build', '--wave', '3')
  return { ...t, wt2, wt3, fix }
}

test('a wave that merged an older wave straight in cannot enter Review until the wave before it has taken that wave in', () => {
  const t = mergedPastTheWaveBefore()
  const r = t.cli('stage', 'Review', '--wave', '3')
  assert.equal(r.code, 1)
  assert.match(r.out, /Wave 2, the wave before wave 3/)
  assert.match(r.out, /lcw wave take --wave 2\b/)
  assert.equal(t.w(3).stage, 'Build')
  t.ok('wave', 'take', '--wave', '2')
  assert.equal(git(t.wt2, 'rev-parse', 'HEAD^2'), t.fix)
  t.ok('wave', 'take', '--wave', '3')
  t.ok('stage', 'Review', '--wave', '3')
})

test('stop and finish still mark a sweep whose repository folder is gone', () => {
  for (const end of ['stop', 'finish']) {
    const t = holdingWithClosure()
    assert.equal(t.cli('stage', 'Hunt').code, 0)
    fs.renameSync(t.repo, `${t.repo}-gone`)
    const r = lcw([end], { ...t.o, cwd: tmp('elsewhere') })
    assert.equal(r.code, 0, r.out + r.err)
    assert.equal(t.state().status, end === 'stop' ? 'stopped' : 'finished')
  }
})

test('only the last two hunt rounds\' commits stay kept, so a round can diff against the one before', () => {
  const t = holdingWithClosure()
  assert.equal(t.cli('stage', 'Hunt').code, 0)
  const first = t.state().sweep.round
  for (let i = 0; i < 2; i++) {
    t.edit((st) => { st.stage = 'Ship' }) // the round is over; the open waves still hold in Ship
    assert.equal(t.cli('stage', 'Hunt').code, 0)
  }
  const round = t.state().sweep.round
  assert.equal(round, first + 2)
  assert.equal(git(t.repo, 'for-each-ref', '--format=%(refname)', 'refs/lcw/'), `refs/lcw/tidy/hunt-${round - 1}\nrefs/lcw/tidy/hunt-${round}`)
})

test('a hunt whose merge of the waves fails for a reason other than a conflict is refused with git\'s message and leaves no worktree', () => {
  const t = holdingWithClosure()
  git(t.repo, 'config', 'commit.gpgSign', 'true')
  git(t.repo, 'config', 'gpg.program', 'false')
  const r = t.cli('stage', 'Hunt')
  assert.equal(r.code, 1)
  assert.match(r.out, /gpg/)
  assert.doesNotMatch(r.out, /conflict/)
  assert.ok(!fs.existsSync(`${t.repo}/.claude/worktrees/tidy-latest`))
  assert.equal(t.state().stage, 'Ship')
})

test('a hunt whose merge of the waves conflicts reads the newest wave\'s tip and says so', () => {
  const t = holdingWithClosure(['e.txt', 'wave 1 too\n'])
  const r = t.cli('stage', 'Hunt')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /conflicts/)
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /conflicts/)
  assert.equal(git(`${t.repo}/.claude/worktrees/tidy-latest`, 'rev-parse', 'HEAD'), git(t.wt2, 'rev-parse', 'HEAD'))
})

test('during a hunt, ask and ledger from the main checkout stay off a wave holding in Ship, and its worktree still reaches it', () => {
  const t = shipping(1)
  t.cli('stage', 'Hunt')
  t.cli('ask', 'which way?')
  t.cli('ledger', 'a note for the run')
  t.cli('hunt', '--fix', '2')
  lcw(['ledger', 'from the wave'], { ...t.o, cwd: t.wt })
  const wl = fs.readFileSync(`${t.dir}/waves/1/ledger.md`, 'utf8')
  assert.doesNotMatch(wl, /which way|a note for the run|hunt, round/)
  assert.match(wl, /from the wave/)
  assert.equal(t.state().sweep.waves[0].waiting, false)
})

test('status names the wave an ask is about', () => {
  const t = twoOpen()
  t.cli('ask', 'push needs your token', '--wave', '2')
  assert.match(t.cli('status').out, /^ {2}1\. push needs your token \(wave 2\)$/m)
})

test('wave files leaves out a wave once it is at merging', () => {
  const t = bothShipping()
  commit(t.wt2, 'e.txt', 'wave 2 fix\n')
  t.at(1, 'wave', 'step', 'final checks')
  assert.match(t.cli('wave', 'files').out, /^ {2}b\.txt \(wave 1\)$/m)
  t.at(1, 'wave', 'step', 'merging')
  assert.deepEqual(t.cli('wave', 'files').out.trim().split('\n').slice(1), ['  e.txt (wave 2)'])
})

test('a wave leaves Review only once every fix has its verdict', () => {
  const t = overlapping()
  for (const id of ['F1', 'F2', 'F3']) t.at(1, 'req', 'add', id, `fix ${id}`)
  t.at(1, 'req', 'F1', 'pass')
  t.at(1, 'req', 'F3', 'failing')
  const r = t.at(1, 'stage', 'Ship')
  assert.equal(r.code, 1)
  assert.match(r.out, /F2 todo, F3 failing/)
  assert.equal(t.w(1).stage, 'Review')
  t.at(1, 'req', 'F2', 'partial')
  t.at(1, 'req', 'F3', 'park')
  assert.equal(t.at(1, 'stage', 'Ship').code, 0)
})

test('a wave refuses a task named with one of its fixes\' ids', () => {
  const t = overlapping()
  t.at(1, 'req', 'add', 'F21', 'fix F21')
  const r = t.at(1, 'task', 'add', 'F21', 'move the shared rule')
  assert.equal(r.code, 1)
  assert.match(r.out, /one of wave 1's fixes/)
  assert.equal(t.at(1, 'task', 'add', 'X1', 'move the shared rule').code, 0)
  assert.deepEqual(t.w(1).tasks.map((x) => x.id), ['X1'])
})

test('a shipped wave\'s worktree goes with the files it ignores, and stays while it holds an untracked one', () => {
  for (const [stray, gone] of [[null, true], ['notes.txt', false]]) {
    const t = bothShipping()
    commit(t.wt1, '.gitignore', 'cache/\n')
    fs.mkdirSync(`${t.wt1}/cache`)
    fs.writeFileSync(`${t.wt1}/cache/built`, 'made again by a build\n')
    t.at(1, 'wave', 'step', 'final checks')
    t.at(1, 'wave', 'step', 'merging')
    t.at(2, 'wave', 'take')
    t.at(2, 'wave', 'step', 'final checks')
    t.at(2, 'wave', 'step', 'merging')
    t.at(1, 'wave', 'shipped')
    if (stray) fs.writeFileSync(`${t.wt1}/${stray}`, 'mine\n')
    const r = t.cli('wave', 'shipped')
    assert.equal(r.code, 0, r.out)
    assert.equal(fs.existsSync(t.wt1), !gone, r.out)
    assert.match(r.out, gone ? /worktree removed/ : /worktree kept: .*uncommitted or untracked/)
  }
})

test('status counts the fixes a wave holds once more have joined it than were queued', () => {
  const t = hunting()
  t.cli('wave', 'add', '1', '2')
  t.start()
  for (const id of ['F1', 'F2', 'F3']) t.cli('req', 'add', id, `fix ${id}`)
  t.cli('req', 'F3', 'drop')
  const out = t.cli('status').out
  assert.match(out, /^ {2}1 \[running\] 3 fixes /m)
  assert.match(out, /^ {2}2 \[queued\] 2 fixes /m)
})
