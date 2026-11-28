import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmp, makeRepo, git, lcw } from './helpers.mjs'
import { sweep, hunting, shipping, commit, fakeGh, overlapping, bothShipping, shippedWaves, twoOpen, three, holdingWithClosure } from './sweep-kit.mjs'

test('a worktree folder deleted outside git does not block wave start or a hunt from making it again', () => {
  const t = hunting()
  t.cli('wave', 'add', '1')
  const gone = (dir, ...a) => { git(t.repo, 'worktree', 'add', '-q', ...a, dir); fs.rmSync(dir, { recursive: true, force: true }) }
  gone(`${t.repo}/.claude/worktrees/tidy-wave-1`, '-b', 'stray')
  // a worktree of the person's own whose folder is missing, such as one on a drive not plugged in, stays on git's record
  const theirs = `${tmp('theirs')}/elsewhere`
  gone(theirs, '-b', 'their-work')
  const started = t.start()
  assert.equal(started.code, 0, started.out)
  assert.match(git(t.repo, 'worktree', 'list', '--porcelain'), /their-work/)
  t.cli('stage', 'Ship')
  gone(`${t.repo}/.claude/worktrees/tidy-latest`, '--detach')
  const hunt = t.cli('stage', 'Hunt')
  assert.equal(hunt.code, 0, hunt.out)
  assert.equal(t.state().sweep.round, 2)
  assert.ok(fs.existsSync(`${t.repo}/.claude/worktrees/tidy-latest/a.txt`))
  assert.match(git(t.repo, 'worktree', 'list', '--porcelain'), /their-work/)
})

test('a hunt whose worktree git cannot read says so, and does not call the folder foreign', () => {
  const t = holdingWithClosure()
  assert.equal(t.cli('stage', 'Hunt').code, 0)
  t.edit((s) => { s.stage = 'Plan' })
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const bin = tmp('bin')
  fs.writeFileSync(`${bin}/git`, `#!/bin/sh\ncase "$PWD" in *tidy-latest) if [ "$1" = rev-parse ]; then echo "fatal: cannot read folder" >&2; exit 128; fi;; esac\nexec "${realGit}" "$@"\n`, { mode: 0o755 })
  const r = lcw(['stage', 'Hunt'], { ...t.o, env: { PATH: `${bin}:${process.env.PATH}` } })
  assert.equal(r.code, 1, r.out)
  assert.doesNotMatch(r.out, /not the hunt's/)
  assert.match(r.out, /folder at .*tidy-latest could not be read.*cannot read folder.*Move or remove it/s)
  assert.ok(fs.existsSync(`${t.repo}/.claude/worktrees/tidy-latest`), 'nothing was removed')
})

test('a hunt whose repository refs git cannot read does not blame the worktree folder', () => {
  const t = holdingWithClosure()
  assert.equal(t.cli('stage', 'Hunt').code, 0)
  t.edit((s) => { s.stage = 'Plan' })
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const bin = tmp('bin')
  fs.writeFileSync(`${bin}/git`, `#!/bin/sh\nif [ "$1" = for-each-ref ]; then echo "fatal: cannot read refs" >&2; exit 128; fi\nexec "${realGit}" "$@"\n`, { mode: 0o755 })
  const r = lcw(['stage', 'Hunt'], { ...t.o, env: { PATH: `${bin}:${process.env.PATH}` } })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /repository's refs.*cannot read refs.*Nothing was changed/s)
  assert.doesNotMatch(r.out, /folder at|Move or remove/)
  assert.ok(fs.existsSync(`${t.repo}/.claude/worktrees/tidy-latest`), 'nothing was removed')
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

test('wave files leaves out the newest open wave once it is at merging, as the next wave is cut from it', () => {
  const t = shipping(1)
  commit(t.wt, 'b.txt', 'fix\n')
  t.cli('wave', 'step', 'final checks')
  assert.match(t.cli('wave', 'files').out, /^ {2}b\.txt \(wave 1\)$/m)
  t.cli('wave', 'step', 'merging')
  assert.equal(t.cli('wave', 'files').out.trim(), 'files the open waves have changed: none')
})

test('wave files and wave start leave out an older wave at merging that the later wave the next is cut from already holds', () => {
  const t = overlapping()
  commit(t.wt2, 'e.txt', 'wave 2 fix\n')
  t.at(2, 'stage', 'Review')
  t.at(1, 'stage', 'Ship')
  t.at(1, 'wave', 'step', 'final checks')
  assert.match(t.cli('wave', 'files').out, /^ {2}b\.txt \(wave 1\)$/m)
  t.at(1, 'wave', 'step', 'merging')
  assert.deepEqual(t.cli('wave', 'files').out.trim().split('\n').slice(1), ['  e.txt (wave 2)'])
  t.cli('wave', 'add', '1')
  const r = t.start()
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(r.out.split('\n').filter((l) => /^ {2}\S+ \(wave /.test(l)), ['  e.txt (wave 2)'])
})

test('wave files lists a wave at merging whose review fix the next wave, cut beside a later wave, does not hold', () => {
  const t = overlapping()
  commit(t.wt2, 'e.txt', 'wave 2 fix\n')
  t.at(1, 'stage', 'Build')
  commit(t.wt1, 'F.txt', 'review fix\n')
  t.at(1, 'stage', 'Review')
  t.at(1, 'stage', 'Ship')
  t.at(1, 'wave', 'step', 'final checks')
  t.at(1, 'wave', 'step', 'merging')
  assert.equal(t.w(1).step, 'merging')
  assert.match(t.cli('wave', 'files').out, /^ {2}F\.txt \(wave 1\)$/m)
})

const listed = (out) => out.split('\n').filter((l) => /^ {2}\S+ \(wave /.test(l))

test('merged as it goes, wave files and wave start list everything a wave shipped and held for its merge changes, since the next wave is cut without it', () => {
  const t = overlapping('merged')
  t.at(2, 'stage', 'Review')
  commit(t.wt1, 'd.txt', 'closure\n')
  t.at(1, 'stage', 'Ship')
  t.at(1, 'wave', 'step', 'final checks')
  t.at(1, 'wave', 'step', 'merging')
  assert.equal(t.at(1, 'wave', 'shipped', '--pr', '12').code, 0)
  assert.deepEqual(listed(t.cli('wave', 'files').out), ['  b.txt (wave 1)', '  d.txt (wave 1)'])
  t.cli('wave', 'add', '1')
  const r = t.start()
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(listed(r.out), ['  b.txt (wave 1)', '  d.txt (wave 1)'])
})

test('wave files lists only what the newest built wave lacks of an older wave at merging', () => {
  const t = bothShipping()
  t.at(1, 'wave', 'step', 'final checks')
  t.at(1, 'wave', 'step', 'merging')
  assert.deepEqual(listed(t.cli('wave', 'files').out), ['  d.txt (wave 1)'])
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

test('a wave enters Ship from any stage only with every fix given its verdict and every take-in held, and an emptied wave still does', () => {
  const t = overlapping()
  for (const id of ['F1', 'F2']) t.at(1, 'req', 'add', id, `fix ${id}`)
  t.at(1, 'req', 'F1', 'pass')
  t.at(1, 'req', 'F2', 'failing')
  assert.equal(t.at(1, 'stage', 'Ship').code, 1)
  t.at(1, 'stage', 'Build')
  commit(t.wt1, 'c.txt', 'review fix\n')
  const r = t.at(1, 'stage', 'Ship')
  assert.equal(r.code, 1, 'from Build too')
  assert.match(r.out, /F2 failing/)
  assert.equal(t.w(1).stage, 'Build')
  const w2 = t.at(2, 'stage', 'Ship')
  assert.equal(w2.code, 1, 'wave 2 lacks wave 1\'s review fix')
  assert.match(w2.out, /has not taken in the latest of lcw\/tidy-wave-1/)
  assert.equal(t.w(2).stage, 'Build')
  t.at(2, 'req', 'add', 'F3', 'fix F3')
  t.at(2, 'req', 'F3', 'park')
  t.at(2, 'wave', 'take')
  assert.equal(t.at(2, 'stage', 'Ship').code, 0, 'every fix parked or dropped')
  t.at(1, 'req', 'F2', 'pass')
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

test('set waits records why a wave has no agent at work: on the wave named, in its ledger and in status, as text', () => {
  const t = twoOpen()
  const none = t.cli('set', 'waits=the screens need the player files')
  assert.equal(none.code, 1)
  assert.match(none.out, /1 and 2.*--wave/)
  assert.equal(t.cli('set', 'waits=the  screens need\nthe player files', '--wave', '2').code, 0)
  assert.equal(t.wave(2).waits, 'the screens need the player files')
  assert.equal(t.wave(1).waits, undefined)
  assert.match(t.cli('status').out, /^wave 2: Build, waits: the screens need the player files {2}branch/m)
  for (const ledger of [`${t.dir}/ledger.md`, `${t.dir}/waves/2/ledger.md`]) assert.match(fs.readFileSync(ledger, 'utf8'), /wave 2 waits: the screens need the player files/)
  // the same reason given again, as an answer to being asked again, is one line still; a new reason is a new line
  t.cli('set', 'waits=the screens need the player files', '--wave', '2')
  t.cli('set', 'waits=the player files are in, the thumbs are not', '--wave', '2')
  assert.equal(fs.readFileSync(`${t.dir}/waves/2/ledger.md`, 'utf8').match(/wave 2 waits:/g).length, 2)
  // a figure is still words, and nothing after the = takes the reason away without a ledger line
  t.cli('set', 'waits=16', '--wave', '1')
  assert.equal(t.wave(1).waits, '16')
  const lines = fs.readFileSync(`${t.dir}/ledger.md`, 'utf8').split('\n').length
  assert.equal(t.cli('set', 'waits=', '--wave', '1').code, 0)
  assert.equal('waits' in t.wave(1), false)
  assert.equal(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8').split('\n').length, lines)
})

test('what a wave waited for is over once work starts for it: a task that starts, a stage, a step or a review round takes the reason away', () => {
  const two = twoOpen()
  two.cli('set', 'waits=the screens need the player files', '--wave', '2')
  two.cli('set', 'waits=ships after the first', '--wave', '1')
  two.cli('task', 'add', 'T1', 'the screens', '--wave', '2')
  assert.equal(two.wave(2).waits, 'the screens need the player files', 'a task added has not started')
  two.cli('task', 'T1', 'running', '--wave', '2')
  assert.equal('waits' in two.wave(2), false)
  assert.equal(two.wave(1).waits, 'ships after the first', 'another wave keeps its own')

  const t = hunting()
  t.cli('wave', 'add', '2')
  t.start()
  const waits = () => t.state().sweep.waves[0].waits
  const set = () => { assert.equal(t.cli('set', 'waits=held for the first wave').code, 0); assert.equal(waits(), 'held for the first wave') }
  for (const moves of [['stage', 'Build'], ['stage', 'Review'], ['wave', 'round'], ['wave', 'step', 'closures']]) {
    set()
    assert.equal(t.cli(...moves).code, 0, moves.join(' '))
    assert.equal(waits(), undefined, moves.join(' '))
  }
})

test('set waits is refused where no wave is open: in a build, and in a sweep that is hunting', () => {
  const home = tmp('home')
  const o = { home, cwd: makeRepo(), session: 's1' }
  lcw(['start', 'b', '--title', 'A build'], o)
  const build = lcw(['set', 'waits=nothing to do'], o)
  assert.equal(build.code, 1)
  assert.match(build.out, /waits is a wave's own/)
  const t = hunting()
  assert.equal(t.cli('set', 'waits=nothing to do').code, 1)
  assert.equal('waits' in t.state(), false)
})

test('a question option with no meaning is refused by naming it and the form it needs', () => {
  const t = hunting()
  const r = t.cli('question', 'add', 'Q1', '--text', 'Allow a 422?', '--a', 'Answer 422', '--b', 'Keep the 409: closed as decided', '--recommend', 'b')
  assert.equal(r.code, 1)
  assert.match(r.out, /--a is "Answer 422"/)
  assert.match(r.out, /<label>: <what it means>/)
  const one = t.cli('question', 'add', 'Q1', '--text', 'Allow a 422?', '--a', 'Yes: fix it', '--recommend', 'a')
  assert.match(one.out, /at least two.*only --a was given/)
})

test('a sweep name is taken while a wave branch of that name is left behind', () => {
  const t = sweep()
  git(t.repo, 'branch', 'lcw/other-wave-1')
  const second = lcw(['start', 'other', '--title', 'Other', '--shape', 'sweep'], { ...t.o, session: 's2' })
  assert.equal(second.code, 0, second.out)
  assert.match(second.out, /^Run \d+-other-2$/m)
})

test('a worktree git refuses says why, not its progress line', () => {
  const t = hunting()
  t.cli('wave', 'add', '3')
  git(t.repo, 'branch', 'lcw/tidy-wave-1')
  const r = t.start()
  assert.equal(r.code, 1)
  assert.match(r.out, /already exists/)
  assert.doesNotMatch(r.out, /Preparing worktree/)
})

test('merge of a pull request GitHub closed unmerged says to open a new one first, and to open it again only while its base branch exists', () => {
  const t = shippedWaves()
  const r = lcw(['merge', '1'], { ...t.o, env: fakeGh({ GH_STATE: 'CLOSED', GH_BASE: 'lcw/tidy' }).env })
  assert.equal(r.code, 1)
  assert.match(r.out, /closed without being merged/)
  assert.match(r.out, /new pull request.*lcw wave pr 1 <number>.*only if its base branch lcw\/tidy still exists, reopen #12.*run lcw merge 1 again/)
  assert.doesNotMatch(r.out, /retarget/)
  assert.equal(t.state().sweep.waves[0].merged, false)
})

test('merge given a pull request number says it takes a wave number, and names the wave that has that pull request', () => {
  const t = shippedWaves()
  const gh = fakeGh()
  const hit = lcw(['merge', '13'], { ...t.o, env: gh.env })
  assert.equal(hit.code, 1)
  assert.match(hit.out, /takes a wave number/)
  assert.match(hit.out, /PR 13 is wave 2's: lcw merge 2/)
  const miss = lcw(['merge', '99'], { ...t.o, env: gh.env })
  assert.match(miss.out, /No wave 99\. The waves are 1, 2\. Nothing was changed/)
  assert.doesNotMatch(miss.out, /pull request number|is wave/)
  t.edit((s) => s.sweep.waves.push({ n: 3, fixes: 1, status: 'shipped', branch: 'lcw/tidy-wave-3', pr: null, empty: true, dropped: 1, fixed: 0 }))
  assert.doesNotMatch(lcw(['merge', '0'], { ...t.o, env: gh.env }).out, /is wave/, 'a wave with no pull request has none numbered 0')
  assert.deepEqual(gh.calls(), [])
})

test('a wave start whose worktree git refuses leaves no branch behind, so the retry works', () => {
  const t = hunting()
  t.cli('wave', 'add', '3')
  const dir = `${t.repo}/.claude/worktrees/tidy-wave-1`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(`${dir}/stray.txt`, 'x')
  assert.equal(t.start().code, 1)
  assert.equal(git(t.repo, 'branch', '--list', 'lcw/tidy-wave-1'), '', 'the branch the failed add made is deleted')
  fs.rmSync(`${dir}/stray.txt`)
  assert.equal(t.start().code, 0)
})

test('merge of a number that is neither a wave nor a wave\'s pull request says there is no such wave and lists the waves', () => {
  const t = sweep()
  t.cli('set', 'sweep.prs=merged')
  assert.match(t.cli('merge', '4').out, /No wave 4\. The sweep has no waves yet\. Nothing was changed/)
})

test('merge --wait on a pull request GitHub closed unmerged says so at once and never waits for checks', () => {
  const t = shippedWaves()
  const gh = fakeGh({ GH_STATE: 'CLOSED', GH_BASE: 'main', GH_CHECKS: 'pending', LCW_CHECKS_MINUTE_MS: '5000' })
  const r = lcw(['merge', '1', '--wait', '5'], { ...t.o, env: gh.env })
  assert.equal(r.code, 1)
  assert.match(r.out, /closed without being merged/)
  assert.doesNotMatch(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /waiting up to/)
})

test('re-recording a hunt round\'s park and drop counts after the totals were settled down never takes them below zero', () => {
  const t = hunting()
  t.cli('hunt', '--park', '2', '--drop', '3')
  assert.deepEqual([t.state().sweep.parked, t.state().sweep.dropped], [2, 3])
  t.edit((s) => { s.sweep.parked = 0; s.sweep.dropped = 0 }) // answered questions and dropped fixes took them off
  t.cli('hunt', '--park', '0', '--drop', '0')
  assert.deepEqual([t.state().sweep.parked, t.state().sweep.dropped], [0, 0])
})

test('awake on WSL says WSL cannot keep Windows awake', () => {
  const t = hunting()
  const env = { PATH: tmp('bin') + ':' + path.dirname(process.execPath) } // node only: no caffeinate or systemd-inhibit
  const wsl = lcw(['awake'], { ...t.o, env: { ...env, WSL_DISTRO_NAME: 'Ubuntu' } })
  assert.equal(wsl.code, 1)
  assert.match(wsl.err + wsl.out, /WSL/)
})

test('awake outside WSL names the programs', { skip: (() => { try { return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')) && 'this machine is WSL: /proc/version says so whatever the environment' } catch { return false } })() }, () => {
  const t = hunting()
  const env = { PATH: tmp('bin') + ':' + path.dirname(process.execPath) }
  const plain = lcw(['awake'], { ...t.o, env: { ...env, WSL_DISTRO_NAME: '' } })
  assert.match(plain.err + plain.out, /caffeinate.*systemd-inhibit/)
})
