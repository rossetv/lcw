import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, git, cli } from './helpers.mjs'
import { sweep, hunting, shipping, commit, overlapping, bothShipping, twoOpen, three } from './sweep-kit.mjs'

test('a take-in is refused while a task of the wave is running, and nothing moves', async () => {
  const t = await overlapping()
  commit(t.wt1, 'c.txt', 'review fix\n')
  await t.at(2, 'task', 'add', 'T1', 'fix it')
  await t.at(2, 'task', 'T1', 'running')
  const had = git(t.wt2, 'rev-parse', 'HEAD')
  const r = await t.at(2, 'wave', 'take')
  assert.equal(r.code, 1)
  assert.match(r.out, /T1.*still running.*wait/s)
  assert.equal(git(t.wt2, 'rev-parse', 'HEAD'), had)
  await t.at(2, 'task', 'T1', 'done')
  assert.equal((await t.at(2, 'wave', 'take')).code, 0)
})

/** await three(), with waves 1 and 2 in Ship and wave 3 started: wave 3 has merged wave 2's tip and wave 1's later fix, but wave 2 lacks that fix. */
async function mergedPastTheWaveBefore() {
  const t = await three()
  await t.start()
  const wt2 = t.wt
  commit(wt2, 'e.txt', 'wave 2 fix\n')
  await t.ok('stage', 'Ship', '--wave', '1')
  await t.ok('stage', 'Review', '--wave', '2')
  await t.ok('stage', 'Ship', '--wave', '2')
  await t.start()
  const wt3 = t.wt
  commit(wt3, 'g.txt', 'wave 3 fix\n')
  await t.ok('stage', 'Build', '--wave', '1')
  const fix = commit(t.wt1, 'f.txt', 'checks fix\n')
  git(wt3, 'merge', '--no-ff', '--no-edit', '-q', 'lcw/tidy-wave-2')
  git(wt3, 'merge', '--no-ff', '--no-edit', '-q', 'lcw/tidy-wave-1')
  await t.ok('stage', 'Build', '--wave', '3')
  return { ...t, wt2, wt3, fix }
}

test('a wave that merged an older wave straight in cannot enter Review until the wave before it has taken that wave in', async () => {
  const t = await mergedPastTheWaveBefore()
  const r = await t.cli('stage', 'Review', '--wave', '3')
  assert.equal(r.code, 1)
  assert.match(r.out, /Wave 2, the wave before wave 3/)
  assert.match(r.out, /lcw wave take --wave 2\b/)
  assert.equal(t.w(3).stage, 'Build')
  await t.ok('wave', 'take', '--wave', '2')
  assert.equal(git(t.wt2, 'rev-parse', 'HEAD^2'), t.fix)
  await t.ok('wave', 'take', '--wave', '3')
  await t.ok('stage', 'Review', '--wave', '3')
})


test('status names the wave an ask is about', async () => {
  const t = await twoOpen()
  await t.cli('ask', 'push needs your token', '--wave', '2')
  assert.match((await t.cli('status')).out, /^ {2}1\. push needs your token \(wave 2\)$/m)
})

test('wave files leaves out the newest open wave once it is at merging, as the next wave is cut from it', async () => {
  const t = await shipping(1)
  commit(t.wt, 'b.txt', 'fix\n')
  await t.cli('wave', 'step', 'final checks')
  assert.match((await t.cli('wave', 'files')).out, /^ {2}b\.txt \(wave 1\)$/m)
  await t.cli('wave', 'step', 'merging')
  assert.equal((await t.cli('wave', 'files')).out.trim(), 'files the open waves have changed: none')
})

test('wave files and wave start leave out an older wave at merging that the later wave the next is cut from already holds', async () => {
  const t = await overlapping()
  commit(t.wt2, 'e.txt', 'wave 2 fix\n')
  await t.at(2, 'stage', 'Review')
  await t.at(1, 'stage', 'Ship')
  await t.at(1, 'wave', 'step', 'final checks')
  assert.match((await t.cli('wave', 'files')).out, /^ {2}b\.txt \(wave 1\)$/m)
  await t.at(1, 'wave', 'step', 'merging')
  assert.deepEqual((await t.cli('wave', 'files')).out.trim().split('\n').slice(1), ['  e.txt (wave 2)'])
  await t.cli('wave', 'add', '1')
  const r = await t.start()
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(r.out.split('\n').filter((l) => /^ {2}\S+ \(wave /.test(l)), ['  e.txt (wave 2)'])
})

test('wave files lists a wave at merging whose review fix the next wave, cut beside a later wave, does not hold', async () => {
  const t = await overlapping()
  commit(t.wt2, 'e.txt', 'wave 2 fix\n')
  await t.at(1, 'stage', 'Build')
  commit(t.wt1, 'F.txt', 'review fix\n')
  await t.at(1, 'stage', 'Review')
  await t.at(1, 'stage', 'Ship')
  await t.at(1, 'wave', 'step', 'final checks')
  await t.at(1, 'wave', 'step', 'merging')
  assert.equal(t.w(1).step, 'merging')
  assert.match((await t.cli('wave', 'files')).out, /^ {2}F\.txt \(wave 1\)$/m)
})

const listed = (out) => out.split('\n').filter((l) => /^ {2}\S+ \(wave /.test(l))

test('merged as it goes, wave files and wave start list everything a wave shipped and held for its merge changes, since the next wave is cut without it', async () => {
  const t = await overlapping('merged')
  await t.at(2, 'stage', 'Review')
  commit(t.wt1, 'd.txt', 'closure\n')
  await t.at(1, 'stage', 'Ship')
  await t.at(1, 'wave', 'step', 'final checks')
  await t.at(1, 'wave', 'step', 'merging')
  assert.equal((await t.at(1, 'wave', 'shipped', '--pr', '12')).code, 0)
  assert.deepEqual(listed((await t.cli('wave', 'files')).out), ['  b.txt (wave 1)', '  d.txt (wave 1)'])
  await t.cli('wave', 'add', '1')
  const r = await t.start()
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(listed(r.out), ['  b.txt (wave 1)', '  d.txt (wave 1)'])
})

test('wave files lists only what the newest built wave lacks of an older wave at merging', async () => {
  const t = await bothShipping()
  await t.at(1, 'wave', 'step', 'final checks')
  await t.at(1, 'wave', 'step', 'merging')
  assert.deepEqual(listed((await t.cli('wave', 'files')).out), ['  d.txt (wave 1)'])
})

test('a wave leaves Review only once every fix has its verdict', async () => {
  const t = await overlapping()
  for (const id of ['F1', 'F2', 'F3']) await t.at(1, 'req', 'add', id, `fix ${id}`)
  await t.at(1, 'req', 'F1', 'pass')
  await t.at(1, 'req', 'F3', 'failing')
  const r = await t.at(1, 'stage', 'Ship')
  assert.equal(r.code, 1)
  assert.match(r.out, /F2 todo, F3 failing/)
  assert.equal(t.w(1).stage, 'Review')
  await t.at(1, 'req', 'F2', 'partial')
  await t.at(1, 'req', 'F3', 'park')
  assert.equal((await t.at(1, 'stage', 'Ship')).code, 0)
})

test('a wave enters Ship from any stage only with every fix given its verdict and every take-in held, and an emptied wave still does', async () => {
  const t = await overlapping()
  for (const id of ['F1', 'F2']) await t.at(1, 'req', 'add', id, `fix ${id}`)
  await t.at(1, 'req', 'F1', 'pass')
  await t.at(1, 'req', 'F2', 'failing')
  assert.equal((await t.at(1, 'stage', 'Ship')).code, 1)
  await t.at(1, 'stage', 'Build')
  commit(t.wt1, 'c.txt', 'review fix\n')
  const r = await t.at(1, 'stage', 'Ship')
  assert.equal(r.code, 1, 'from Build too')
  assert.match(r.out, /F2 failing/)
  assert.equal(t.w(1).stage, 'Build')
  const w2 = await t.at(2, 'stage', 'Ship')
  assert.equal(w2.code, 1, 'wave 2 lacks wave 1\'s review fix')
  assert.match(w2.out, /has not taken in the latest of lcw\/tidy-wave-1/)
  assert.equal(t.w(2).stage, 'Build')
  await t.at(2, 'req', 'add', 'F3', 'fix F3')
  await t.at(2, 'req', 'F3', 'park')
  await t.at(2, 'wave', 'take')
  assert.equal((await t.at(2, 'stage', 'Ship')).code, 0, 'every fix parked or dropped')
  await t.at(1, 'req', 'F2', 'pass')
  assert.equal((await t.at(1, 'stage', 'Ship')).code, 0)
})

test('a wave refuses a task named with one of its fixes\' ids', async () => {
  const t = await overlapping()
  await t.at(1, 'req', 'add', 'F21', 'fix F21')
  const r = await t.at(1, 'task', 'add', 'F21', 'move the shared rule')
  assert.equal(r.code, 1)
  assert.match(r.out, /F21.*wave 1's fixes/, 'it names the fix and the wave it belongs to')
  assert.equal((await t.at(1, 'task', 'add', 'X1', 'move the shared rule')).code, 0)
  assert.deepEqual(t.w(1).tasks.map((x) => x.id), ['X1'])
})

test('a shipped wave\'s worktree goes with the files it ignores, and stays while it holds an untracked one', async () => {
  for (const [stray, gone] of [[null, true], ['notes.txt', false]]) {
    const t = await bothShipping()
    commit(t.wt1, '.gitignore', 'cache/\n')
    fs.mkdirSync(`${t.wt1}/cache`)
    fs.writeFileSync(`${t.wt1}/cache/built`, 'made again by a build\n')
    await t.at(1, 'wave', 'step', 'final checks')
    await t.at(1, 'wave', 'step', 'merging')
    await t.at(2, 'wave', 'take')
    await t.at(2, 'wave', 'step', 'final checks')
    await t.at(2, 'wave', 'step', 'merging')
    await t.at(1, 'wave', 'shipped')
    if (stray) fs.writeFileSync(`${t.wt1}/${stray}`, 'mine\n')
    const r = await t.cli('wave', 'shipped')
    assert.equal(r.code, 0, r.out)
    assert.equal(fs.existsSync(t.wt1), !gone, r.out)
    assert.match(r.out, gone ? /worktree removed/ : /worktree kept: .*uncommitted or untracked/)
  }
})

test('status counts the fixes a wave holds once more have joined it than were queued', async () => {
  const t = await hunting()
  await t.cli('wave', 'add', '1', '2')
  await t.start()
  for (const id of ['F1', 'F2', 'F3']) await t.cli('req', 'add', id, `fix ${id}`)
  await t.cli('req', 'F3', 'drop')
  const out = (await t.cli('status')).out
  assert.match(out, /^ {2}1 \[running\] 3 fixes /m)
  assert.match(out, /^ {2}2 \[queued\] 2 fixes /m)
})

test('set waits records why a wave has no agent at work: on the wave named, in its ledger and in status, as text', async () => {
  const t = await twoOpen()
  const none = await t.cli('set', 'waits=the screens need the player files')
  assert.equal(none.code, 1)
  assert.match(none.out, /1 and 2.*--wave/)
  assert.equal((await t.cli('set', 'waits=the  screens need\nthe player files', '--wave', '2')).code, 0)
  assert.equal(t.wave(2).waits, 'the screens need the player files')
  assert.equal(t.wave(1).waits, undefined)
  assert.match((await t.cli('status')).out, /^wave 2: Build, waits: the screens need the player files {2}branch/m)
  for (const ledger of [`${t.dir}/ledger.md`, `${t.dir}/waves/2/ledger.md`]) assert.match(fs.readFileSync(ledger, 'utf8'), /wave 2 waits: the screens need the player files/)
  // the same reason given again, as an answer to being asked again, is one line still; a new reason is a new line
  await t.cli('set', 'waits=the screens need the player files', '--wave', '2')
  await t.cli('set', 'waits=the player files are in, the thumbs are not', '--wave', '2')
  assert.equal(fs.readFileSync(`${t.dir}/waves/2/ledger.md`, 'utf8').match(/wave 2 waits:/g).length, 2)
  // a figure is still words, and nothing after the = takes the reason away without a ledger line
  await t.cli('set', 'waits=16', '--wave', '1')
  assert.equal(t.wave(1).waits, '16')
  const lines = fs.readFileSync(`${t.dir}/ledger.md`, 'utf8').split('\n').length
  assert.equal((await t.cli('set', 'waits=', '--wave', '1')).code, 0)
  assert.equal('waits' in t.wave(1), false)
  assert.equal(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8').split('\n').length, lines)
})

test('what a wave waited for is over once work starts for it: a task that starts, a stage, a step or a review round takes the reason away', async () => {
  const two = await twoOpen()
  await two.cli('set', 'waits=the screens need the player files', '--wave', '2')
  await two.cli('set', 'waits=ships after the first', '--wave', '1')
  await two.cli('task', 'add', 'T1', 'the screens', '--wave', '2')
  assert.equal(two.wave(2).waits, 'the screens need the player files', 'a task added has not started')
  await two.cli('task', 'T1', 'running', '--wave', '2')
  assert.equal('waits' in two.wave(2), false)
  assert.equal(two.wave(1).waits, 'ships after the first', 'another wave keeps its own')

  const t = await hunting()
  await t.cli('wave', 'add', '2')
  await t.start()
  const waits = () => t.state().sweep.waves[0].waits
  const set = async () => { assert.equal((await t.cli('set', 'waits=held for the first wave')).code, 0); assert.equal(waits(), 'held for the first wave') }
  for (const moves of [['stage', 'Build'], ['stage', 'Review'], ['wave', 'round'], ['wave', 'step', 'closures']]) {
    await set()
    assert.equal((await t.cli(...moves)).code, 0, moves.join(' '))
    assert.equal(waits(), undefined, moves.join(' '))
  }
})

test('set waits is refused where no wave is open: in a build, and in a sweep that is hunting', async () => {
  const home = tmp('home')
  const o = { home, cwd: makeRepo(), session: 's1' }
  await cli(['start', 'b', '--title', 'A build'], o)
  const build = await cli(['set', 'waits=nothing to do'], o)
  assert.equal(build.code, 1)
  assert.match(build.out, /waits is a wave's own/)
  const t = await hunting()
  assert.equal((await t.cli('set', 'waits=nothing to do')).code, 1)
  assert.equal('waits' in t.state(), false)
})

test('a question option with no meaning is refused by naming it and the form it needs', async () => {
  const t = await hunting()
  const r = await t.cli('question', 'add', 'Q1', '--text', 'Allow a 422?', '--a', 'Answer 422', '--b', 'Keep the 409: closed as decided', '--recommend', 'b')
  assert.equal(r.code, 1)
  assert.match(r.out, /--a is "Answer 422"/)
  assert.match(r.out, /<label>: <what it means>/)
  const one = await t.cli('question', 'add', 'Q1', '--text', 'Allow a 422?', '--a', 'Yes: fix it', '--recommend', 'a')
  assert.match(one.out, /at least two.*only --a was given/)
})

test('a sweep name is taken while a wave branch of that name is left behind', async () => {
  const t = await sweep()
  git(t.repo, 'branch', 'lcw/other-wave-1')
  const second = await cli(['start', 'other', '--title', 'Other', '--shape', 'sweep'], { ...t.o, session: 's2' })
  assert.equal(second.code, 0, second.out)
  assert.match(second.out, /^Run \d+-other-2$/m)
})

test('a worktree git refuses says why, not its progress line', async () => {
  const t = await hunting()
  await t.cli('wave', 'add', '3')
  git(t.repo, 'branch', 'lcw/tidy-wave-1')
  const r = await t.start()
  assert.equal(r.code, 1)
  assert.match(r.out, /already exists/)
  assert.doesNotMatch(r.out, /Preparing worktree/)
})

test('a wave start whose worktree git refuses leaves no branch behind, so the retry works', async () => {
  const t = await hunting()
  await t.cli('wave', 'add', '3')
  const dir = `${t.repo}/.claude/worktrees/tidy-wave-1`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(`${dir}/stray.txt`, 'x')
  assert.equal((await t.start()).code, 1)
  assert.equal(git(t.repo, 'branch', '--list', 'lcw/tidy-wave-1'), '', 'the branch the failed add made is deleted')
  fs.rmSync(`${dir}/stray.txt`)
  assert.equal((await t.start()).code, 0)
})

test('re-recording a hunt round\'s park and drop counts after the totals were settled down never takes them below zero', async () => {
  const t = await hunting()
  await t.cli('hunt', '--park', '2', '--drop', '3')
  assert.deepEqual([t.state().sweep.parked, t.state().sweep.dropped], [2, 3])
  t.edit((s) => { s.sweep.parked = 0; s.sweep.dropped = 0 }) // answered questions and dropped fixes took them off
  await t.cli('hunt', '--park', '0', '--drop', '0')
  assert.deepEqual([t.state().sweep.parked, t.state().sweep.dropped], [0, 0])
})
