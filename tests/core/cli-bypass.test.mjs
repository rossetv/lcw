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
  cli('wave', 'start')
  const ledger = () => fs.readFileSync(`${dir}/ledger.md`, 'utf8')
  const waveLedger = () => fs.readFileSync(`${dir}/waves/1/ledger.md`, 'utf8')
  return { dir, cli, ledger, waveLedger, wave: () => readJson(`${dir}/state.json`).sweep.waves[0] }
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
  assert.match(r.out, line)
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
  const r = t.cli('wave', 'round', '0', '--bypass', 'testing')
  assert.equal(r.code, 1)
  assert.doesNotMatch(t.ledger(), BYPASS)
})

test('the refusals LCW keeps hard do not give way to --bypass', () => {
  const t = planning()
  t.cli('task', 'add', 'T1', 'fix it')
  t.cli('task', 'T1', 'running')
  const cases = [
    ['set', 'markPercent=95'], // the usage mark moves only on the person's words
    ['merge', '1'], // the charter chose no merging as it goes
    ['wave', 'take'], // a worker may be committing in the wave's worktree
  ]
  for (const c of cases) {
    const r = t.cli(...c, '--bypass', 'want it anyway')
    assert.equal(r.code, 1, c.join(' '))
    assert.doesNotMatch(r.out, /--bypass/, c.join(' '))
  }
  assert.doesNotMatch(t.ledger(), BYPASS)
})

test('status counts the bypasses in the ledger', () => {
  const t = planning()
  assert.doesNotMatch(t.cli('status').out, /bypasses:/)
  t.cli('wave', 'round', '--bypass', 'the review ran early by hand')
  assert.match(t.cli('status').out, /^bypasses: 1$/m)
})
