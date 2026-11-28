import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { tmp, makeRepo, git, cli, CLI } from './helpers.mjs'
import { fakeGh, shippedWaves, checks, waiting } from './sweep-kit.mjs'

test('merge readies a draft, merges it with a merge commit on the GitHub remote, and records it', async () => {
  const t = await shippedWaves()
  const gh = fakeGh()
  const r = await cli(['merge', '1'], { ...t.o, env: gh.env })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(gh.calls(), [
    'pr view 12 -R acme/widgets --json state,isDraft,baseRefName,headRefOid',
    'repo view acme/widgets --json defaultBranchRef',
    'pr ready 12 -R acme/widgets',
    'pr merge 12 -R acme/widgets --merge --match-head-commit abc123',
    'pr view 12 -R acme/widgets --json state',
    'pr list -R acme/widgets --base lcw/tidy-wave-1 --state open --json number',
    'api -X DELETE repos/acme/widgets/git/refs/heads/lcw/tidy-wave-1',
  ])
  assert.deepEqual(t.state().sweep.waves.map((w) => w.merged), [true, false])
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /wave 1 merged/)
  assert.equal((await cli(['merge', '1'], { ...t.o, env: gh.env })).code, 1, 'merged already')
  assert.equal(gh.calls().length, 7)
})

const wrote = (gh) => gh.calls().some((c) => c.startsWith('pr merge') || c.startsWith('pr ready'))

test('merge --wait waits while a check is pending, notes the wait in the ledger and merges once they pass', async () => {
  const t = await shippedWaves()
  const gh = waiting([checks('pass', 'pending'), checks('pass', 'skipping')].join('|'))
  const r = await cli(['merge', '1', '--wait', '60'], { ...t.o, env: gh.env })
  assert.equal(r.code, 0, r.out)
  assert.equal(gh.calls().filter((c) => c.startsWith('pr checks')).length, 2)
  assert.ok(gh.calls().includes('pr merge 12 -R acme/widgets --merge --match-head-commit abc123'), gh.calls().join('\n'))
  assert.equal(t.state().sweep.waves[0].merged, true)
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /wave 1: waiting up to 60 minutes for the checks of #12/)
})

test('merge --wait merges nothing once a check fails or is cancelled, whatever else still runs, or when every check was skipped', async () => {
  for (const [list, said] of [[checks('pending', 'fail'), /did not pass: job1/], [checks('pass', 'cancel'), /did not pass: job1/], [checks('skipping'), /all skipped/]]) {
    const t = await shippedWaves()
    const gh = waiting(list)
    const r = await cli(['merge', '1', '--wait', '5'], { ...t.o, env: gh.env })
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, said)
    assert.equal(gh.calls().filter((c) => c.startsWith('pr checks')).length, 1, 'settled at the first look')
    assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /wave 1: the wait for the checks of #12 ended with no merge: #12's checks/)
    assert.ok(!wrote(gh), gh.calls().join('\n'))
    assert.equal(t.state().sweep.waves[0].merged, false)
  }
})

test('merge --wait gives up when GitHub shows no checks, or when they still run as its minutes end', async () => {
  for (const [list, said] of [['NONE', /reports no checks on #12/], [checks('pass', 'pending'), /still running after 1 minutes/]]) {
    const t = await shippedWaves()
    const gh = waiting(list)
    const r = await cli(['merge', '1', '--wait', '1'], { ...t.o, env: gh.env })
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, said)
    assert.ok(!wrote(gh), gh.calls().join('\n'))
  }
})

test('merge --wait rides out two failed reads of the checks and ends on the third in a row', async () => {
  const t = await shippedWaves()
  const twice = waiting(['ERR', 'ERR', checks('pass')].join('|'))
  const r = await cli(['merge', '1', '--wait', '60'], { ...t.o, env: twice.env })
  assert.equal(r.code, 0, r.out)
  assert.equal(t.state().sweep.waves[0].merged, true)
  const u = await shippedWaves()
  const always = waiting('ERR')
  const lost = await cli(['merge', '1', '--wait', '60'], { ...u.o, env: always.env })
  assert.equal(lost.code, 1, lost.out)
  assert.match(lost.out, /could not read the checks of #12, three times running: connection reset by peer/)
  assert.equal(always.calls().filter((c) => c.startsWith('pr checks')).length, 3)
  assert.ok(!wrote(always), always.calls().join('\n'))
})

test('merge --wait waits for nothing that lcw merge refuses anyway, and takes 1 to 60 minutes', async () => {
  const t = await shippedWaves()
  const gh = waiting(checks('pending'))
  for (const m of ['0', '61', 'soon']) assert.equal((await cli(['merge', '1', '--wait', m], { ...t.o, env: gh.env })).code, 1, m)
  assert.ok(gh.calls().length === 0, gh.calls().join('\n'))
  const based = waiting(checks('pending'), { GH_BASE: 'lcw/tidy-wave-0' })
  const b = await cli(['merge', '1', '--wait', '5'], { ...t.o, env: based.env })
  assert.equal(b.code, 1, b.out)
  assert.match(b.out, /based on lcw\/tidy-wave-0.*gh pr edit 12/)
  assert.ok(!based.calls().some((c) => c.startsWith('pr checks')), based.calls().join('\n'))
  const o = { home: tmp('home'), cwd: makeRepo(), session: 'b1' }
  await cli(['start', 'x', '--title', 'X'], o)
  assert.match((await cli(['merge', '1', '--wait', '5'], { ...o, env: gh.env })).out, /^lcw merge is for a sweep/)
})

test('merge --wait ends, merging nothing, for a run paused before it or stopped while it waits', async () => {
  const t = await shippedWaves()
  await t.cli('pause', 'human')
  const quiet = waiting(checks('pending'))
  const held = await cli(['merge', '1', '--wait', '5'], { ...t.o, env: quiet.env })
  assert.equal(held.code, 1, held.out)
  assert.match(held.out, /is paused, so lcw merge --wait ends here for #12/)
  assert.match((await cli(['merge', '2', '--wait', '5'], { ...t.o, env: quiet.env })).out, /is paused, so lcw merge --wait ends here for #13/, 'checked again once the wait is over')
  assert.deepEqual(quiet.calls(), [])

  const u = await shippedWaves()
  const gh = waiting(checks('pending'), { LCW_CHECKS_MINUTE_MS: '200' })
  const p = spawn('node', [CLI, 'merge', '1', '--wait', '60'], { cwd: u.o.cwd, env: { ...process.env, ...gh.env, LCW_HOME: u.o.home, CLAUDE_CODE_SESSION_ID: u.o.session } })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  const done = new Promise((res) => p.on('close', (code) => res(code)))
  while (!gh.calls().some((c) => c.startsWith('pr checks'))) await new Promise((r) => setTimeout(r, 20))
  assert.equal((await u.cli('stop')).code, 0)
  assert.equal(await done, 1, out)
  assert.match(out, /is stopped, so lcw merge --wait ends here for #12/)
  assert.match(fs.readFileSync(`${u.dir}/ledger.md`, 'utf8'), /wave 1: the wait for the checks of #12 ended with no merge: Run \S+ is stopped/)
  assert.ok(!wrote(gh), gh.calls().join('\n'))
  assert.equal(u.state().sweep.waves[0].merged, false)
})

test('a pull request the merge only queued is not recorded and keeps its branch, and a later merge records it once GitHub shows it merged', async () => {
  const t = await shippedWaves()
  const queued = fakeGh({ GH_STATE: 'OPEN' })
  const r = await cli(['merge', '1'], { ...t.o, env: queued.env })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /not merged yet/)
  assert.ok(queued.calls().includes('pr merge 12 -R acme/widgets --merge --match-head-commit abc123'), queued.calls().join('\n'))
  assert.ok(!queued.calls().some((c) => c.startsWith('api')), queued.calls().join('\n'))
  assert.equal(t.state().sweep.waves[0].merged, false)
  const later = fakeGh({ GH_STATE: 'MERGED' })
  assert.equal((await cli(['merge', '1'], { ...t.o, env: later.env })).code, 0)
  assert.ok(!later.calls().some((c) => c.startsWith('pr merge')), later.calls().join('\n'))
  assert.ok(later.calls().includes('api -X DELETE repos/acme/widgets/git/refs/heads/lcw/tidy-wave-1'))
  assert.equal(t.state().sweep.waves[0].merged, true)
})

test('a pull request still based on a wave branch is refused, with no write to GitHub', async () => {
  const t = await shippedWaves()
  t.edit((s) => { s.sweep.waves[0].merged = true })
  const gh = fakeGh({ GH_BASE: 'lcw/tidy-wave-1' })
  const r = await cli(['merge', '2'], { ...t.o, env: gh.env })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /lcw\/tidy-wave-1/)
  assert.match(r.out, /\bmain\b/)
  assert.ok(gh.calls().length > 0 && gh.calls().every((c) => c.startsWith('pr view') || c.startsWith('repo view')), gh.calls().join('\n'))
  assert.equal(t.state().sweep.waves[1].merged, false)
})

test('a pull request GitHub shows merged into a wave branch is not recorded, and its branch is kept', async () => {
  const t = await shippedWaves()
  t.edit((s) => { s.sweep.waves[0].merged = true })
  const gh = fakeGh({ GH_STATE: 'MERGED', GH_BASE: 'lcw/tidy-wave-1' })
  const r = await cli(['merge', '2'], { ...t.o, env: gh.env })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /lcw\/tidy-wave-1/)
  assert.match(r.out, /\bmain\b/)
  assert.ok(gh.calls().length > 0 && gh.calls().every((c) => c.startsWith('pr view') || c.startsWith('repo view')), gh.calls().join('\n'))
  assert.equal(t.state().sweep.waves[1].merged, false)
})

test('merge deletes the remote wave branch through the api and leaves the local branch, its tracking ref and the worktree alone', async () => {
  const t = await shippedWaves()
  const wt = `${tmp('wt')}/w`
  git(t.repo, 'worktree', 'add', '-q', '-b', 'lcw/tidy-wave-1', wt)
  git(t.repo, 'update-ref', 'refs/remotes/origin/lcw/tidy-wave-1', 'HEAD')
  const before = git(t.repo, 'for-each-ref')
  const gh = fakeGh()
  const r = await cli(['merge', '1'], { ...t.o, env: gh.env })
  assert.equal(r.code, 0, r.out)
  assert.ok(gh.calls().includes('api -X DELETE repos/acme/widgets/git/refs/heads/lcw/tidy-wave-1'))
  assert.ok(!r.out.includes('is left'), r.out)
  assert.equal(git(t.repo, 'for-each-ref'), before)
  assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lcw/tidy-wave-1')
  assert.ok(fs.existsSync(wt))
  assert.equal(t.state().sweep.waves[0].merged, true)
})

test('merge moves a pull request based on the wave branch onto the default branch before deleting it, and keeps the branch when it cannot', async () => {
  const t = await shippedWaves()
  const gh = fakeGh({ GH_LIST: '[{"number":13}]' })
  const r = await cli(['merge', '1'], { ...t.o, env: gh.env })
  assert.equal(r.code, 0, r.out)
  const calls = gh.calls()
  const edit = calls.indexOf('pr edit 13 -R acme/widgets --base main')
  assert.ok(edit > -1 && edit < calls.indexOf('api -X DELETE repos/acme/widgets/git/refs/heads/lcw/tidy-wave-1'), calls.join('\n'))
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /wave 1 merged.*#13 moved onto main, its remote branch deleted/)
  const u = await shippedWaves()
  const stuck = fakeGh({ GH_LIST: '[{"number":13}]', GH_FAIL: 'pr edit' })
  const kept = await cli(['merge', '1'], { ...u.o, env: stuck.env })
  assert.equal(kept.code, 0, kept.out)
  assert.match(kept.out, /remote branch lcw\/tidy-wave-1 is left: a pull request based on it could not be moved onto main/)
  assert.ok(!stuck.calls().some((c) => c.startsWith('api -X DELETE')), stuck.calls().join('\n'))
  assert.equal(u.state().sweep.waves[0].merged, true)
})

test('merge records a branch GitHub already deleted as deleted', async () => {
  for (const GH_API_ERROR of ['gh: Reference does not exist (HTTP 422)', 'gh: Not Found (HTTP 404)']) {
    const t = await shippedWaves()
    const r = await cli(['merge', '1'], { ...t.o, env: fakeGh({ GH_API_ERROR }).env })
    assert.equal(r.code, 0, r.out)
    assert.ok(!r.out.includes('is left'), r.out)
    assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /wave 1 merged.*remote branch deleted/)
    assert.equal(t.state().sweep.waves[0].merged, true)
  }
})

test('merge is recorded when the remote branch cannot be deleted, and says it is left', async () => {
  const t = await shippedWaves()
  const r = await cli(['merge', '1'], { ...t.o, env: fakeGh({ GH_API_ERROR: 'gh: Resource not accessible (HTTP 403)' }).env })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /remote branch lcw\/tidy-wave-1 is left/)
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /wave 1 merged.*is left/)
  assert.equal(t.state().sweep.waves[0].merged, true)
})

test('merge records a pull request GitHub already shows merged without merging it again', async () => {
  const t = await shippedWaves()
  const gh = fakeGh({ GH_STATE: 'MERGED' })
  const r = await cli(['merge', '1'], { ...t.o, env: gh.env })
  assert.equal(r.code, 0, r.out)
  assert.ok(!gh.calls().some((c) => c.startsWith('pr merge') || c.startsWith('pr ready')), gh.calls().join('\n'))
  assert.ok(gh.calls().some((c) => c.startsWith('api -X DELETE')))
  assert.equal(t.state().sweep.waves[0].merged, true)
})

test('merge leaves a pull request that is no longer a draft as it is', async () => {
  const t = await shippedWaves()
  const gh = fakeGh({ GH_DRAFT: 'false' })
  assert.equal((await cli(['merge', '1'], { ...t.o, env: gh.env })).code, 0)
  assert.ok(!gh.calls().some((c) => c.startsWith('pr ready')))
})

test('merged as it goes, a later wave merges before an earlier one', async () => {
  const t = await shippedWaves()
  const r = await cli(['merge', '2'], { ...t.o, env: fakeGh().env })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(t.state().sweep.waves.map((w) => w.merged), [false, true])
})

test('merge is refused under another choice, and for a wave with no pull request, and writes nothing to GitHub', async () => {
  const t = await shippedWaves()
  const gh = fakeGh()
  t.edit((s) => { s.sweep.waves[0].pr = null })
  assert.equal((await cli(['merge', '1'], { ...t.o, env: gh.env })).code, 1, 'no pull request')
  const u = await shippedWaves('stacked')
  assert.equal((await cli(['merge', '1'], { ...u.o, env: gh.env })).code, 1, 'stacked')
  assert.ok(gh.calls().every((c) => c.startsWith('pr view') || c.startsWith('repo view')), gh.calls().join('\n'))
})

/** Shipped waves 1 and 2, wave 2's branch in the repository, and a gh that shows its pull request merged into main at the given head. */
async function landedOutOfOrder(head) {
  const t = await shippedWaves()
  git(t.repo, 'branch', 'lcw/tidy-wave-2')
  const gh = fakeGh({ GH_STATE: 'MERGED', GH_HEAD: head ?? git(t.repo, 'rev-parse', 'lcw/tidy-wave-2') })
  return { t, gh, merge: async (...a) => await cli(['merge', ...a], { ...t.o, env: gh.env }) }
}

test('a pull request GitHub merged ahead of an earlier wave is recorded, with no bypass, and merged by nothing', async () => {
  const { t, gh, merge } = await landedOutOfOrder()
  const r = await merge('2')
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(t.state().sweep.waves.map((w) => w.merged), [false, true])
  const ledger = fs.readFileSync(`${t.dir}/ledger.md`, 'utf8')
  assert.match(ledger, /wave 2 merged: PR #13/)
  assert.ok(!ledger.includes('BYPASS'), ledger)
  assert.ok(!gh.calls().some((c) => c.startsWith('pr merge') || c.startsWith('pr ready')), gh.calls().join('\n'))
})

test('a wave that never shipped is recorded from the pull request --pr names, and counted', async () => {
  const { t, merge } = await landedOutOfOrder()
  t.edit((s) => {
    s.sweep.waves[0].merged = true
    Object.assign(s.sweep.waves[1], { status: 'running', stage: 'Ship', step: 'merging', pr: null, fixed: 0, requirements: [{ id: 'F1', status: 'pass' }] })
  })
  const fixedBefore = t.state().sweep.fixed
  assert.match((await merge('2')).out, /lcw merge 2 --pr <number>/)
  const r = await merge('2', '--pr', '15')
  assert.equal(r.code, 0, r.out)
  const w2 = t.state().sweep.waves[1]
  assert.deepEqual([w2.status, w2.pr, w2.merged, w2.fixed], ['shipped', 15, true, 1])
  assert.equal(t.state().sweep.fixed, fixedBefore + 1)
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /PR #15 recorded as landed at \w+; its final checks had not passed on that head \(it was in Ship, merging\)/)
})

test('a merged pull request is recorded for a wave whose branch was deleted after the merge', async () => {
  const t = await shippedWaves()
  t.edit((s) => { s.sweep.waves[0].merged = true; s.sweep.waves[1].pr = null })
  const gh = fakeGh({ GH_STATE: 'MERGED' })
  const r = await cli(['merge', '2', '--pr', '13'], { ...t.o, env: gh.env })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual([t.state().sweep.waves[1].pr, t.state().sweep.waves[1].merged], [13, true])
})

test('a merged pull request is not recorded when the wave holds commits beyond what GitHub merged', async () => {
  const { t, merge } = await landedOutOfOrder('0000000000000000000000000000000000000000')
  t.edit((s) => { Object.assign(s.sweep.waves[1], { status: 'running', stage: 'Ship', step: 'merging', pr: null }) })
  const r = await merge('2', '--pr', '13')
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /has not landed\. Nothing was recorded\./)
  assert.equal(t.state().sweep.waves[1].merged, false)
})

/** Starts lcw merge 1 in the background; once gh is in its pr merge, resolves to { done }, what the merge ends with. */
async function slowMerge(t, gh) {
  const p = spawn('node', [CLI, 'merge', '1'], { cwd: t.o.cwd, env: { ...process.env, ...gh.env, LCW_HOME: t.o.home, CLAUDE_CODE_SESSION_ID: t.o.session } })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  const done = new Promise((res) => p.on('close', (code) => res({ code, out })))
  while (!gh.calls().some((c) => c.startsWith('pr merge'))) await new Promise((r) => setTimeout(r, 20))
  return { done }
}

test('a command that waits on a slow lcw merge does not lose its change, however long the merge holds the lock', async () => {
  const t = await shippedWaves()
  const gh = fakeGh({ GH_SLEEP: '1' })
  const { done: merging } = await slowMerge(t, gh)
  // a lock this old was once taken from its holder while the holder still ran
  const old = new Date(Date.now() - 60000)
  fs.utimesSync(`${t.dir}/lock`, old, old)
  const q = await t.cli('question', 'add', 'Q1', '--text', 'Allow a 422?', '--a', 'Yes: fix it', '--b', 'No: keep it', '--recommend', 'a')
  assert.equal(q.code, 0, q.out)
  const m = await merging
  assert.equal(m.code, 0, m.out)
  assert.deepEqual([t.state().sweep.waves[0].merged, t.state().questions.map((x) => x.id)], [true, ['Q1']])
})

test('a command whose lock was taken from it as hung saves nothing over the newer state, and says to run it again', async () => {
  const t = await shippedWaves()
  const gh = fakeGh({ GH_SLEEP: '1' })
  const { done: merging } = await slowMerge(t, gh)
  await new Promise((r) => setTimeout(r, 200))
  const q = await cli(['question', 'add', 'Q1', '--text', 'Allow a 422?', '--a', 'Yes: fix it', '--b', 'No: keep it', '--recommend', 'a'], { ...t.o, env: { LCW_LOCK_HUNG_MS: '100' } })
  assert.equal(q.code, 0, q.out)
  const m = await merging
  assert.equal(m.code, 1, m.out)
  assert.match(m.out, /nothing was saved to the run\. Run this command again/)
  assert.deepEqual([t.state().sweep.waves[0].merged, t.state().questions.map((x) => x.id)], [false, ['Q1']])
  assert.ok(!fs.existsSync(`${t.dir}/lock`))
  const again = await cli(['merge', '1'], { ...t.o, env: fakeGh({ GH_STATE: 'MERGED' }).env })
  assert.equal(again.code, 0, again.out)
  assert.deepEqual([t.state().sweep.waves[0].merged, t.state().questions.map((x) => x.id)], [true, ['Q1']])
})

test('a failing gh merge is reported and records nothing', async () => {
  const t = await shippedWaves()
  const gh = fakeGh({ GH_FAIL: 'pr merge' })
  const r = await cli(['merge', '1'], { ...t.o, env: gh.env })
  assert.equal(r.code, 1)
  assert.match(r.out, /not mergeable/)
  assert.equal(t.state().sweep.waves[0].merged, false)
})

test('a merge GitHub refuses puts the pull request it readied back to draft, and one that was not a draft is left alone', async () => {
  const t = await shippedWaves()
  const refused = fakeGh({ GH_FAIL: 'pr merge' })
  assert.equal((await cli(['merge', '1'], { ...t.o, env: refused.env })).code, 1)
  assert.deepEqual(refused.calls().slice(2), ['pr ready 12 -R acme/widgets', 'pr merge 12 -R acme/widgets --merge --match-head-commit abc123', 'pr ready 12 -R acme/widgets --undo'])
  const open = fakeGh({ GH_FAIL: 'pr merge', GH_DRAFT: 'false' })
  assert.equal((await cli(['merge', '1'], { ...t.o, env: open.env })).code, 1)
  assert.ok(!open.calls().some((c) => c.startsWith('pr ready')), open.calls().join('\n'))
})

test('a merge that was only queued leaves the pull request ready, not back at draft', async () => {
  const t = await shippedWaves()
  const gh = fakeGh({ GH_STATE: 'OPEN' })
  await cli(['merge', '1'], { ...t.o, env: gh.env })
  assert.ok(gh.calls().includes('pr ready 12 -R acme/widgets'))
  assert.ok(!gh.calls().some((c) => c.includes('--undo')), gh.calls().join('\n'))
})
