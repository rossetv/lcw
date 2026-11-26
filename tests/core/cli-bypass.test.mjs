import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, git, lcw, readJson } from './helpers.mjs'

const BYPASS = /BYPASS, not standard LCW: /

/** A sweep in Hunt with wave 1 started, in Plan. */
function planning() {
  const home = tmp('home')
  const repo = makeRepo()
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
  const o = { home, cwd: repo, session: 's1' }
  const dir = /^folder: (.+)$/m.exec(lcw(['start', 'tidy', '--title', 'Tidy the backlog', '--shape', 'sweep'], o).out)[1]
  const cli = (...a) => lcw(a, o)
  fs.writeFileSync(`${dir}/charter.md`, 'goals: fix the backlog\n')
  cli('approval')
  cli('stage', 'Hunt')
  cli('worktree')
  cli('wave', 'add', '1')
  const ledger = () => fs.readFileSync(`${dir}/ledger.md`, 'utf8')
  const waveLedger = () => fs.readFileSync(`${dir}/waves/1/ledger.md`, 'utf8')
  const wt = /^worktree: (.+)$/m.exec(cli('wave', 'start').out)[1]
  const state = () => readJson(`${dir}/state.json`)
  return { o, repo, dir, wt, cli, ledger, waveLedger, state, wave: () => state().sweep.waves[0] }
}

function commit(wt, file) {
  fs.writeFileSync(`${wt}/${file}`, 'fix\n')
  git(wt, 'add', file)
  git(wt, 'commit', '-q', '-m', `change ${file}`)
}

/** planning(), with wave 1 shipped as pull request #5, and a gh that shows each pull request in the state GH_STATE names, or fails with none. */
function shipped() {
  const t = planning()
  commit(t.wt, 'b.txt')
  t.cli('stage', 'Ship')
  t.cli('wave', 'step', 'final checks')
  t.cli('wave', 'step', 'merging')
  assert.equal(t.cli('wave', 'shipped', '--pr', '5').code, 0)
  const bin = tmp('bin')
  fs.writeFileSync(`${bin}/gh`, '#!/bin/sh\n[ -n "$GH_STATE" ] || exit 1\necho "{\\"state\\":\\"$GH_STATE\\"}"\n', { mode: 0o755 })
  t.gh = (state, ...a) => lcw(a, { ...t.o, env: { PATH: `${bin}:${process.env.PATH}`, GH_STATE: state } })
  return t
}

test('a process refusal names --bypass, and with a reason the command goes ahead and the ledgers say so', () => {
  const t = planning()
  const refused = t.cli('wave', 'round')
  assert.equal(refused.code, 1)
  assert.match(refused.out, /review round is raised in Review.*--bypass "<why>"/)
  assert.equal(t.wave().round, 0)

  const r = t.cli('wave', 'round', '--bypass', 'the review ran early by hand')
  assert.equal(r.code, 0, r.out)
  assert.equal(t.wave().round, 1)
  const line = /BYPASS, not standard LCW: the review ran early by hand; went past: Wave 1 is in Plan; a review round is raised in Review\.$/m
  assert.match(r.out, /BYPASS, not standard LCW: the review ran early by hand; went past: .* \(list it to the person at the end\)$/m)
  assert.match(t.ledger(), line)
  assert.match(t.waveLedger(), line)
})

test('an empty bypass reason is refused and changes nothing', () => {
  const t = planning()
  for (const flag of [['--bypass', ''], ['--bypass=  ']]) {
    const r = t.cli('wave', 'round', ...flag)
    assert.equal(r.code, 1)
    assert.match(r.out, /--bypass needs the reason/)
  }
  assert.equal(t.wave().round, 0)
  assert.doesNotMatch(t.ledger(), BYPASS)
})

test('a command that goes past a process refusal and then cannot work writes no bypass', () => {
  const t = planning()
  // a folder that is not the hunt's sits where the next round's worktree goes
  fs.mkdirSync(`${t.repo}/.claude/worktrees/tidy-latest`, { recursive: true })
  fs.writeFileSync(`${t.repo}/.claude/worktrees/tidy-latest/notes.txt`, 'mine\n')
  const r = t.cli('stage', 'Hunt', '--bypass', 'testing')
  assert.equal(r.code, 1)
  assert.match(r.out, /not the hunt's/)
  assert.doesNotMatch(t.ledger(), BYPASS)
})

test('a hard refusal comes before a process one, so it never names --bypass', () => {
  const t = planning()
  commit(t.wt, 'b.txt')
  t.cli('req', 'add', 'R2', 'the 409')
  for (const flags of [[], ['--bypass', 'want it anyway']]) {
    const r = t.cli('wave', 'shipped', ...flags)
    assert.equal(r.code, 1)
    assert.match(r.out, /cannot ship with R2 todo/)
    assert.doesNotMatch(r.out, /--bypass/)
  }
  assert.equal(t.wave().status, 'running')
})

test('final checks start past a running task with --bypass', () => {
  const t = planning()
  t.cli('stage', 'Ship')
  t.cli('task', 'add', 'T1', 'fix it')
  t.cli('task', 'T1', 'running')
  assert.match(t.cli('wave', 'step', 'final checks').out, /still running.*--bypass/)
  const r = t.cli('wave', 'step', 'final checks', '--bypass', 'the worker only writes its report')
  assert.equal(r.code, 0, r.out)
  assert.equal(t.wave().step, 'final checks')
})

test('the refusals LCW keeps hard do not give way to --bypass', () => {
  const t = planning()
  t.cli('task', 'add', 'T1', 'fix it')
  t.cli('task', 'T1', 'running')
  t.cli('req', 'add', 'R1', 'the 409')
  t.cli('req', 'R1', 'park')
  const cases = [
    ['set', 'markPercent=95'], // the usage mark moves only on the person's words
    ['merge', '1'], // the charter chose no merging as it goes
    // a worker may be committing to the wave
    ['wave', 'take'], ['wave', 'shipped'],
    ['req', 'R1', 'pass'], // the sweep counts it parked
  ]
  for (const c of cases) {
    const r = t.cli(...c, '--bypass', 'want it anyway')
    assert.equal(r.code, 1, c.join(' '))
    assert.doesNotMatch(r.out, /--bypass/, c.join(' '))
  }
  assert.doesNotMatch(t.ledger(), BYPASS)
  assert.equal(t.state().sweep.parked, 1)
  assert.equal(t.wave().status, 'running')
})

test('a shipped wave\'s lists, whose fixes the sweep has counted, do not give way to --bypass', () => {
  const t = shipped()
  for (const c of [['task', 'add', 'T9', 'late'], ['req', 'add', 'R9', 'late']]) {
    const r = t.cli(...c, '--wave', '1', '--bypass', 'want it anyway')
    assert.equal(r.code, 1, c.join(' '))
    assert.doesNotMatch(r.out, /--bypass/)
  }
})

test('a pull request recorded past the closed-unmerged rule says what GitHub showed of the one it replaces', () => {
  const t = shipped()
  assert.match(t.gh('OPEN', 'wave', 'pr', '1', '6').out, /--bypass/)
  const open = t.gh('OPEN', 'wave', 'pr', '1', '6', '--bypass', 'the old one is stale')
  assert.equal(open.code, 0, open.out)
  assert.match(open.out, /in place of #5, which GitHub shows open/)
  const unread = t.gh('', 'wave', 'pr', '1', '7', '--bypass', 'gh is offline')
  assert.match(unread.out, /in place of #6, whose state could not be read from GitHub/)
  assert.doesNotMatch(t.ledger(), /in place of #\d+, which GitHub closed unmerged/)
  assert.equal(t.wave().pr, 7)
})

test('a wave shipped past its stage and final checks leaves a sweep that carries on', () => {
  const t = planning()
  commit(t.wt, 'b.txt')
  t.cli('stage', 'Build')
  const r = t.cli('wave', 'shipped', '--bypass', 'checked by hand')
  assert.equal(r.code, 0, r.out)
  assert.equal(t.wave().status, 'shipped')
  assert.equal(t.cli('status').code, 0)
  t.cli('wave', 'add', '1')
  const next = t.cli('wave', 'start')
  assert.equal(next.code, 0, next.out)
  assert.equal(t.cli('wave', 'files').code, 0)
  assert.equal(t.cli('wave', 'take').code, 0)
  assert.match(fs.readFileSync(`${/^worktree: (.+)$/m.exec(next.out)[1]}/b.txt`, 'utf8'), /fix/, 'the next wave holds the shipped work')
})

test('a wave shipped before its final checks started is bypassed once per refusal, with no false moved-head line', () => {
  const t = planning()
  commit(t.wt, 'b.txt')
  t.cli('stage', 'Build')
  assert.equal(t.cli('wave', 'shipped', '--bypass', 'checked by hand').code, 0)
  const lines = t.ledger().split('\n').filter((l) => BYPASS.test(l))
  assert.equal(lines.length, 2, lines.join('\n'))
  assert.doesNotMatch(t.ledger(), /moved from null/)
  assert.match(t.cli('status').out, /^bypasses: 2$/m)
  // The state keeps the count, for the card.
  assert.equal(t.state().bypasses, 2)
})

test('a pull request GitHub shows merged is not replaced, even with --bypass', () => {
  const t = shipped()
  const r = t.gh('MERGED', 'wave', 'pr', '1', '6', '--bypass', 'the old one is stale')
  assert.equal(r.code, 1, r.out)
  assert.doesNotMatch(r.out, /--bypass/)
  assert.doesNotMatch(t.ledger(), BYPASS)
  assert.equal(t.wave().pr, 5)
})

test('status counts the bypasses in the ledger', () => {
  const t = planning()
  t.cli('ledger', 'the person asked what BYPASS, not standard LCW: means')
  assert.doesNotMatch(t.cli('status').out, /bypasses:/, 'a note that quotes one is not a bypass')
  t.cli('wave', 'round', '--bypass', 'the review ran early by hand')
  assert.match(t.cli('status').out, /^bypasses: 1$/m)
})
