import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmp, git, cli } from './helpers.mjs'
import { hunting, shipping, holdingWithClosure } from './sweep-kit.mjs'

// a git on PATH ahead of the real one: sh runs the shim's lines, then falls through to the real git
const realGit = process.env.PATH.split(path.delimiter).map((d) => `${d}/git`).find((p) => fs.existsSync(p))
const shim = (body) => {
  const bin = tmp('bin')
  fs.writeFileSync(`${bin}/git`, `#!/bin/sh\n${body}\nexec "${realGit}" "$@"\n`, { mode: 0o755 })
  return { PATH: `${bin}:${process.env.PATH}` }
}

test('a worktree folder deleted outside git does not block wave start or a hunt from making it again', async () => {
  const t = await hunting()
  await t.cli('wave', 'add', '1')
  const gone = (dir, ...a) => { git(t.repo, 'worktree', 'add', '-q', ...a, dir); fs.rmSync(dir, { recursive: true, force: true }) }
  gone(`${t.repo}/.claude/worktrees/tidy-wave-1`, '-b', 'stray')
  // a worktree of the person's own whose folder is missing, such as one on a drive not plugged in, stays on git's record
  const theirs = `${tmp('theirs')}/elsewhere`
  gone(theirs, '-b', 'their-work')
  const started = await t.start()
  assert.equal(started.code, 0, started.out)
  assert.match(git(t.repo, 'worktree', 'list', '--porcelain'), /their-work/)
  await t.cli('stage', 'Ship')
  gone(`${t.repo}/.claude/worktrees/tidy-latest`, '--detach')
  const hunt = await t.cli('stage', 'Hunt')
  assert.equal(hunt.code, 0, hunt.out)
  assert.equal(t.state().sweep.round, 2)
  assert.ok(fs.existsSync(`${t.repo}/.claude/worktrees/tidy-latest/a.txt`))
  assert.match(git(t.repo, 'worktree', 'list', '--porcelain'), /their-work/)
})

for (const [name, body, says, notSays] of [
  ['a worktree folder', `case "$PWD" in *tidy-latest) if [ "$1" = rev-parse ]; then echo "fatal: cannot read folder" >&2; exit 128; fi;; esac`,
    /folder at .*tidy-latest could not be read.*cannot read folder.*Move or remove it/s, /not the hunt's/],
  ['the repository refs', `if [ "$1" = for-each-ref ]; then echo "fatal: cannot read refs" >&2; exit 128; fi`,
    /repository's refs.*cannot read refs.*Nothing was changed/s, /folder at|Move or remove/],
]) {
  test(`a hunt whose git cannot read ${name} says what it could not read and removes nothing`, async () => {
    const t = await holdingWithClosure()
    assert.equal((await t.cli('stage', 'Hunt')).code, 0)
    t.edit((s) => { s.stage = 'Plan' })
    const r = await cli(['stage', 'Hunt'], { ...t.o, env: shim(body) })
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, says)
    assert.doesNotMatch(r.out, notSays)
    assert.ok(fs.existsSync(`${t.repo}/.claude/worktrees/tidy-latest`), 'nothing was removed')
  })
}

test('stop removes the hunt\'s worktree and the refs that kept its rounds\' commits', async () => {
  const t = await holdingWithClosure()
  assert.equal((await t.cli('stage', 'Hunt')).code, 0)
  const latest = `${t.repo}/.claude/worktrees/tidy-latest`
  assert.notEqual(git(t.repo, 'for-each-ref', 'refs/lcw/'), '')
  assert.equal((await t.cli('stop')).code, 0)
  assert.ok(!fs.existsSync(latest))
  assert.equal(git(t.repo, 'for-each-ref', 'refs/lcw/'), '')
})

test('stop and finish still mark a sweep whose repository folder is gone', async () => {
  for (const end of ['stop', 'finish']) {
    const t = await holdingWithClosure()
    assert.equal((await t.cli('stage', 'Hunt')).code, 0)
    fs.renameSync(t.repo, `${t.repo}-gone`)
    const r = await cli([end], { ...t.o, cwd: tmp('elsewhere') })
    assert.equal(r.code, 0, r.out)
    assert.equal(t.state().status, end === 'stop' ? 'stopped' : 'finished')
  }
})

test('only the last two hunt rounds\' commits stay kept, so a round can diff against the one before', async () => {
  const t = await holdingWithClosure()
  assert.equal((await t.cli('stage', 'Hunt')).code, 0)
  const first = t.state().sweep.round
  for (let i = 0; i < 2; i++) {
    t.edit((st) => { st.stage = 'Ship' }) // the round is over; the open waves still hold in Ship
    assert.equal((await t.cli('stage', 'Hunt')).code, 0)
  }
  const round = t.state().sweep.round
  assert.equal(round, first + 2)
  assert.equal(git(t.repo, 'for-each-ref', '--format=%(refname)', 'refs/lcw/'), `refs/lcw/tidy/hunt-${round - 1}\nrefs/lcw/tidy/hunt-${round}`)
})

test('a hunt whose merge of the waves fails for a reason other than a conflict is refused with git\'s message and leaves no worktree', async () => {
  const t = await holdingWithClosure()
  git(t.repo, 'config', 'commit.gpgSign', 'true')
  git(t.repo, 'config', 'gpg.program', 'false')
  const r = await t.cli('stage', 'Hunt')
  assert.equal(r.code, 1)
  assert.match(r.out, /gpg/)
  assert.doesNotMatch(r.out, /conflict/)
  assert.ok(!fs.existsSync(`${t.repo}/.claude/worktrees/tidy-latest`))
  assert.equal(t.state().stage, 'Ship')
})

test('a hunt whose merge of the waves conflicts reads the newest wave\'s tip and says so', async () => {
  const t = await holdingWithClosure(['e.txt', 'wave 1 too\n'])
  const r = await t.cli('stage', 'Hunt')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /conflicts/)
  assert.equal(git(`${t.repo}/.claude/worktrees/tidy-latest`, 'rev-parse', 'HEAD'), git(t.wt2, 'rev-parse', 'HEAD'))
})
test('during a hunt, ask and ledger from the main checkout stay off a wave holding in Ship, and its worktree still reaches it', async () => {
  const t = await shipping(1)
  await t.cli('stage', 'Hunt')
  await t.cli('ask', 'which way?')
  await t.cli('ledger', 'a note for the run')
  await t.cli('hunt', '--fix', '2')
  await cli(['ledger', 'from the wave'], { ...t.o, cwd: t.wt })
  const wl = fs.readFileSync(`${t.dir}/waves/1/ledger.md`, 'utf8')
  assert.doesNotMatch(wl, /which way|a note for the run|hunt, round/)
  assert.match(wl, /from the wave/)
  assert.equal(t.state().sweep.waves[0].waiting, false)
})
