import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, git } from './helpers.mjs'
import { onlyGit, withGh, branch, worktree, names, branches, cli } from './cleanup-fixtures.mjs'
import { candidates, recorded, record, apply } from '../../scripts/lib/cleanup.mjs'

test('a merged branch is listed and removed through the CLI; an unmerged one stays, and the remote is untouched', () => {
  const repo = makeRepo()
  const h = tmp('home')
  const bare = tmp('bare')
  git(bare, 'init', '-q', '--bare', '-b', 'main')
  git(repo, 'remote', 'add', 'origin', bare)
  const head = branch(repo, 'fix-login', { merge: true })
  branch(repo, 'wip')
  git(repo, 'push', '-q', 'origin', 'main', 'fix-login', 'wip')
  const remoteBefore = git(bare, 'for-each-ref')

  const listed = JSON.parse(cli(['list'], repo, h).out)
  assert.deepEqual(names(listed), ['branch:fix-login'])
  assert.equal(listed[0].head, head)
  assert.equal(listed[0].why, 'in main')

  assert.equal(cli(['record', '--title', 'Two done', '--bullet', 'fix-login is merged', '--item', 'branch:fix-login'], repo, h).code, 0)
  assert.equal(recorded(repo, h).items[0].head, head)
  const r = cli(['apply'], repo, h)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /removed branch fix-login/)
  assert.deepEqual(branches(repo), ['main', 'wip'])
  assert.equal(git(bare, 'for-each-ref'), remoteBefore)
  assert.equal(recorded(repo, h), null)

  assert.equal(cli(['record', '--title', 'wip', '--item', 'branch:wip'], repo, h).code, 1, 'a refused record exits non-zero')
  assert.equal(recorded(repo, h), null)
})

test('a branch checked out in the main checkout is not listed, nor is the default branch', () => {
  const repo = makeRepo()
  branch(repo, 'done', { merge: true })
  git(repo, 'checkout', '-q', 'done')
  assert.deepEqual(candidates(repo, tmp('home')), [])
})

test('a worktree and its branch named together are both removed', () => {
  const repo = makeRepo()
  const h = tmp('home')
  branch(repo, 'done', { merge: true })
  const wt = worktree(repo, 'done')
  record(repo, h, { title: 'done squash tree', bullets: ['b'], items: ['branch:done', `worktree:${wt}`] })
  const done = apply(repo, h)
  assert.deepEqual(done.skipped, [])
  assert.equal(fs.existsSync(wt), false)
  assert.deepEqual(branches(repo), ['main'])
})

test('record refuses more than 4 bullets or a title or bullet over 200 characters, and records nothing', () => {
  const repo = makeRepo()
  const h = tmp('home')
  branch(repo, 'done', { merge: true })
  const ok = { title: 'done squash tree', bullets: ['b'], items: ['branch:done'] }
  assert.throws(() => record(repo, h, { ...ok, bullets: ['1', '2', '3', '4', '5'] }), /at most 4 bullets/)
  assert.throws(() => record(repo, h, { ...ok, bullets: ['x'.repeat(201)] }), /200 characters/)
  assert.throws(() => record(repo, h, { ...ok, title: 'x'.repeat(201) }), /200 characters/)
  assert.equal(apply(repo, h), null)
  assert.equal(record(repo, h, { ...ok, bullets: ['done', '2', '3', '4'], title: 'x'.repeat(200) }).bullets.length, 4)
})

test('record refuses an item that is not a candidate, and records nothing', () => {
  const repo = makeRepo()
  const h = tmp('home')
  branch(repo, 'done', { merge: true })
  branch(repo, 'wip')
  branch(repo, 'held', { merge: true })
  worktree(repo, 'held')
  for (const items of [['branch:done', 'branch:wip'], ['branch:held'], ['branch:main'], ['branch:nope']]) {
    assert.throws(() => record(repo, h, { title: 'done wip held main nope', bullets: ['b'], items }), items.join(' '))
  }
  assert.equal(apply(repo, h), null)
})

test('record refuses an item the title and bullets never name, and records nothing', () => {
  const repo = makeRepo()
  const h = tmp('home')
  branch(repo, 'done', { merge: true })
  branch(repo, 'other', { merge: true })
  assert.throws(() => record(repo, h, { title: 'a few old branches', bullets: ['merged long ago'], items: ['branch:done'] }), /never name/)
  assert.throws(() => record(repo, h, { title: 'done is merged', bullets: [], items: ['branch:done', 'branch:other'] }), /other/)
  assert.equal(apply(repo, h), null)
  assert.ok(record(repo, h, { title: 'old', bullets: ['done and other are merged'], items: ['branch:done', 'branch:other'] }))
})

test('an item is named only by its whole name, not as part of a longer one', () => {
  const repo = makeRepo()
  const h = tmp('home')
  branch(repo, 'fix', { merge: true })
  const wt = worktree(repo, '-b', 'other', 'main') // folder name "tree"
  const rec = (title, items) => record(repo, h, { title, bullets: [], items })
  assert.throws(() => rec('fix-login-timeout is merged', ['branch:fix']), /never name/)
  assert.throws(() => rec('prefix is merged', ['branch:fix']), /never name/)
  assert.throws(() => rec('the entree is done', [`worktree:${wt}`]), /never name/)
  assert.ok(rec('fix, merged. Also fix.', ['branch:fix']))
  assert.ok(rec('the tree folder is done', [`worktree:${wt}`]), 'a worktree is named by its folder')
  assert.ok(rec(`${wt} is done`, [`worktree:${wt}`]), 'or by its path')
})

test('a branch merged only into origin/main, with local main behind, is removed at apply', () => {
  const repo = makeRepo()
  const h = tmp('home')
  const bare = tmp('bare')
  git(bare, 'init', '-q', '-b', 'main', '--bare')
  git(repo, 'remote', 'add', 'origin', bare)
  branch(repo, 'merged-on-github', { merge: true })
  git(repo, 'push', '-q', 'origin', 'main')
  git(repo, 'reset', '-q', '--hard', 'HEAD~1') // local main is behind origin/main
  assert.deepEqual(names(candidates(repo, h)), ['branch:merged-on-github'])
  record(repo, h, { title: 'merged-on-github', bullets: [], items: ['branch:merged-on-github'] })
  const done = apply(repo, h)
  assert.deepEqual(done.skipped, [])
  assert.deepEqual(branches(repo), ['main'])
})

test('outside a git repository nothing is listed', () => {
  assert.deepEqual(candidates(tmp('plain'), tmp('home')), [])
})

for (const [name, reason, change] of [
  ['got a new commit', /changed/, (repo, head) => git(repo, 'update-ref', 'refs/heads/done', git(repo, 'commit-tree', 'done^{tree}', '-p', head, '-m', 'more'))],
  ['moved to another merged commit', /changed/, (repo) => git(repo, 'branch', '-f', 'done', 'main')],
]) {
  test(`a branch that ${name} after the box was recorded is skipped at apply and stays`, () => {
    const repo = makeRepo()
    const h = tmp('home')
    const head = branch(repo, 'done', { merge: true })
    record(repo, h, { title: 'done squash tree', bullets: ['b'], items: ['branch:done'] })
    change(repo, head)
    const done = apply(repo, h)
    assert.deepEqual(done.removed, [])
    assert.equal(done.skipped[0].item.name, 'done')
    assert.match(done.skipped[0].reason, reason)
    assert.ok(branches(repo).includes('done'))
  })
}

function squashed(repo, intoMain = true) {
  const head = branch(repo, 'squash')
  const stub = `${tmp('gh')}/prs.json`
  fs.writeFileSync(stub, JSON.stringify([
    { number: 6, baseRefName: 'other', headRefName: 'squash', headRefOid: head },
    ...(intoMain ? [{ number: 7, baseRefName: 'main', headRefName: 'squash', headRefOid: head }] : []),
  ]))
  process.env.GH_STUB = stub
  return head
}

test('a squash-merged branch whose pull request gh reports merged at its head is listed and removed', () => {
  const repo = makeRepo()
  const h = tmp('home')
  squashed(repo)
  try {
    const listed = candidates(repo, h)
    assert.deepEqual(names(listed), ['branch:squash'])
    assert.equal(listed[0].why, 'PR #7 merged')
    record(repo, h, { title: 'done squash tree', bullets: ['b'], items: ['branch:squash'] })
    assert.equal(apply(repo, h).removed.length, 1)
    assert.deepEqual(branches(repo), ['main'])
  } finally { delete process.env.GH_STUB }
})

test('a squash-merged branch is not listed when its pull request went to another branch, a commit came after it, or gh is missing', () => {
  const listed = (prepare) => {
    const repo = makeRepo()
    try { prepare(repo) ; return candidates(repo, tmp('home')) } finally { process.env.PATH = withGh; delete process.env.GH_STUB }
  }
  assert.deepEqual(listed((repo) => squashed(repo, false)), [], 'merged into another branch')
  assert.deepEqual(listed((repo) => { const head = squashed(repo); git(repo, 'update-ref', 'refs/heads/squash', git(repo, 'commit-tree', 'squash^{tree}', '-p', head, '-m', 'after')) }), [], 'a commit after the merge')
  assert.deepEqual(listed((repo) => { squashed(repo); process.env.PATH = onlyGit }), [], 'without gh')
})

