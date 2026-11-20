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

/** A sweep past its charter, in Hunt, with its worktree. */
function hunting(name) {
  const t = sweep(name)
  fs.writeFileSync(`${t.dir}/charter.md`, 'goals: fix the backlog\n')
  t.cli('approval')
  t.cli('stage', 'Hunt')
  t.wt = t.cli('worktree').out.trim()
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

test('wave start is refused with no worktree, with no wave queued, with a dirty worktree, and while a wave runs', () => {
  const t = sweep()
  fs.writeFileSync(`${t.dir}/charter.md`, 'goals\n')
  t.cli('approval')
  t.cli('stage', 'Hunt')
  t.cli('wave', 'add', '2')
  assert.equal(t.cli('wave', 'start').code, 1, 'no worktree')
  const wt = t.cli('worktree').out.trim()
  fs.writeFileSync(`${wt}/stray.txt`, 'left over\n')
  assert.equal(t.cli('wave', 'start').code, 1, 'untracked file')
  fs.rmSync(`${wt}/stray.txt`)
  assert.equal(t.cli('wave', 'start').code, 0)
  assert.equal(t.cli('wave', 'start').code, 1, 'a wave is running')
  assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lcw/tidy-wave-1')
  assert.deepEqual(t.state().sweep.waves.map((w) => w.status), ['running'])

  const u = hunting('empty')
  assert.equal(u.cli('wave', 'start').code, 1, 'no wave queued')
})

test('a wave runs on its own branch from the sweep\'s, starts clean, and its ledger lines go to both ledgers', () => {
  const t = hunting()
  t.cli('wave', 'add', '2', '1')
  t.cli('task', 'add', 'T9', 'left from before')
  t.cli('req', 'add', 'F9', 'left from before')
  t.cli('set', 'plan.tasks=4')
  const r = t.cli('wave', 'start')
  assert.equal(r.code, 0, r.out)
  const plan = `${t.dir}/waves/1/plan.md`
  assert.ok(r.out.includes(plan) && fs.existsSync(plan))
  const s = t.state()
  assert.deepEqual([s.tasks, s.requirements, s.plan.tasks], [[], [], 0])
  assert.equal(s.base, git(t.repo, 'rev-parse', 'lcw/tidy'))
  assert.equal(s.sweep.waves[0].branch, 'lcw/tidy-wave-1')
  t.cli('ledger', 'worker launched')
  const last = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').at(-1)
  assert.match(last(`${t.dir}/waves/1/ledger.md`), /worker launched$/)
  assert.match(last(`${t.dir}/ledger.md`), /worker launched$/)
  assert.match(t.cli('status').out, new RegExp(`^plan: ${plan}$`, 'm'))
})

test('wave shipped fast-forwards the sweep\'s branch, counts what passed and what was dropped, and the next wave builds on it', () => {
  const t = hunting()
  t.cli('wave', 'add', '3', '1')
  t.cli('wave', 'start')
  for (const id of ['F1', 'F2', 'F3']) t.cli('req', 'add', id, `fix ${id}`)
  t.cli('req', 'F1', 'pass')
  t.cli('req', 'F2', 'pass')
  t.cli('req', 'F3', 'drop')
  const tip = commit(t.wt, 'b.txt', 'fixed\n')
  const r = t.cli('wave', 'shipped', '--pr', '12')
  assert.equal(r.code, 0, r.out)
  assert.equal(git(t.repo, 'rev-parse', 'lcw/tidy'), tip)
  const s = t.state().sweep
  assert.deepEqual([s.fixed, s.dropped], [2, 1])
  assert.deepEqual(s.waves[0], { n: 1, fixes: 3, status: 'shipped', branch: 'lcw/tidy-wave-1', pr: 12, merged: false, dropped: 1, fixed: 2 })
  assert.match(fs.readFileSync(`${t.dir}/waves/1/ledger.md`, 'utf8'), /wave 1 shipped/)
  assert.equal(t.cli('wave', 'shipped').code, 1, 'no wave running')
  assert.equal(t.state().sweep.fixed, 2)

  assert.equal(t.cli('wave', 'start').code, 0)
  assert.equal(git(t.wt, 'rev-parse', 'HEAD'), tip, 'wave 2 starts from the sweep\'s branch as wave 1 left it')
  assert.equal(git(t.wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lcw/tidy-wave-2')
  assert.equal(t.state().base, tip)
})

test('wave shipped is refused when the sweep\'s branch cannot fast-forward to the wave, and nothing moves', () => {
  const t = hunting()
  t.cli('wave', 'add', '1')
  t.cli('wave', 'start')
  commit(t.wt, 'b.txt', 'fix\n')
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
  const wt = t.cli('worktree').out.trim()
  git(wt, 'checkout', '-q', '-b', 'lcw/tidy-wave-1')
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

test('abandoning a sweep left alone during a wave removes its worktree and keeps the sweep\'s and the wave\'s branches', () => {
  const claudeDir = tmp('claude')
  fs.mkdirSync(`${claudeDir}/sessions`)
  const t = hunting()
  t.cli('wave', 'add', '1')
  t.cli('wave', 'start')
  const old = new Date(Date.now() - 20 * 60000)
  for (const f of ['state.json', 'ledger.md']) fs.utimesSync(`${t.dir}/${f}`, old, old)
  const r = lcw(['abandon', t.state().id], { home: t.home, cwd: t.repo, session: 's2', env: { CLAUDE_CONFIG_DIR: claudeDir } })
  assert.equal(r.code, 0, r.out)
  assert.ok(!fs.existsSync(t.wt), r.out)
  assert.match(r.out, /lcw\/tidy, lcw\/tidy-wave-1/)
  assert.notEqual(git(t.repo, 'branch', '--list', 'lcw/tidy-wave-1'), '')
})

test('stop --pr records the pull request a stopped sweep opened', () => {
  const t = sweep()
  assert.equal(t.cli('stop', '--pr', 'https://github.com/acme/widgets/pull/7').code, 0)
  assert.deepEqual([t.state().status, t.state().pr], ['stopped', { number: 7, url: 'https://github.com/acme/widgets/pull/7' }])
})
