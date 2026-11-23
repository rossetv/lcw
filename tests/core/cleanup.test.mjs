import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmp, makeRepo, git } from './helpers.mjs'
import { repoKey } from '../../lib/key.mjs'
import { candidates, record, apply } from '../../scripts/lib/cleanup.mjs'

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/cleanup.mjs')

// git alone on PATH, or git with a stub gh that prints the file named by GH_STUB and fails when it is unset:
// no test reaches GitHub or the person's own gh.
const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim()
process.env.GIT_EXEC_PATH = execPath
const onlyGit = tmp('bin-git')
const withGh = tmp('bin-gh')
for (const dir of [onlyGit, withGh]) fs.symlinkSync(`${execPath}/git`, `${dir}/git`)
fs.writeFileSync(`${withGh}/gh`, '#!/bin/sh\n[ -n "$GH_STUB" ] && exec /bin/cat "$GH_STUB"\nexit 1\n', { mode: 0o755 })
process.env.PATH = withGh
delete process.env.GH_STUB
process.env.CLAUDE_CONFIG_DIR = tmp('claude') // no open sessions unless a test writes one

const sha = (dir, ref = 'HEAD') => git(dir, 'rev-parse', ref)
function commit(dir, file) {
  fs.writeFileSync(`${dir}/${file}`, `${file}\n`)
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', file)
  return sha(dir)
}
function branch(repo, name, { merge = false } = {}) {
  git(repo, 'checkout', '-q', '-b', name)
  commit(repo, `${name.replace(/\//g, '-')}.txt`)
  git(repo, 'checkout', '-q', 'main')
  if (merge) git(repo, 'merge', '-q', '--no-ff', '-m', `merge ${name}`, name)
  return sha(repo, name)
}
function worktree(repo, ...args) {
  const dir = `${tmp('wt')}/tree`
  git(repo, 'worktree', 'add', '-q', dir, ...args)
  return dir
}
function runState(lcwHome, repo, id, state) {
  const dir = `${lcwHome}/repos/${repoKey(repo)}/runs/${id}`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(`${dir}/state.json`, JSON.stringify({ id, createdAt: 1, ...state }))
}
const names = (list) => list.map((i) => (i.type === 'branch' ? `branch:${i.name}` : `worktree:${i.path}`)).sort()
const branches = (repo) => git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n')
function cli(args, cwd, lcwHome) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: { ...process.env, LCW_HOME: lcwHome }, encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

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
  assert.equal(JSON.parse(cli(['list', '--recorded'], repo, h).out).items[0].head, head)
  const r = cli(['apply'], repo, h)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /removed branch fix-login/)
  assert.deepEqual(branches(repo), ['main', 'wip'])
  assert.equal(git(bare, 'for-each-ref'), remoteBefore)
  assert.equal(JSON.parse(cli(['list', '--recorded'], repo, h).out), null)
})

test('a branch checked out in the main checkout is not listed, nor is the default branch', () => {
  const repo = makeRepo()
  branch(repo, 'done', { merge: true })
  git(repo, 'checkout', '-q', 'done')
  assert.deepEqual(candidates(repo, tmp('home')), [])
})

test('dirty and untracked worktrees are not listed, nor their branches; a clean one comes with its branch', () => {
  const repo = makeRepo()
  for (const b of ['a', 'b', 'c']) branch(repo, b, { merge: true })
  const [a, b, c] = ['a', 'b', 'c'].map((name) => worktree(repo, name))
  fs.writeFileSync(`${a}/a.txt`, 'changed\n')
  fs.writeFileSync(`${b}/new.txt`, 'untracked\n')
  const listed = candidates(repo, tmp('home'))
  assert.deepEqual(names(listed), ['branch:c', `worktree:${c}`])
  assert.equal(listed.find((i) => i.type === 'branch').worktree, c)
})

test('a worktree holding an ignored file is not listed, nor its branch', () => {
  const repo = makeRepo()
  branch(repo, 'done', { merge: true })
  const wt = worktree(repo, 'done')
  fs.appendFileSync(`${repo}/.git/info/exclude`, '*.env\n')
  fs.writeFileSync(`${wt}/local.env`, 'SECRET=1\n')
  assert.deepEqual(candidates(repo, tmp('home')), [])
})

test('a worktree that got an ignored file after the box was recorded is skipped at apply and stays', () => {
  const repo = makeRepo()
  const h = tmp('home')
  branch(repo, 'done', { merge: true })
  const wt = worktree(repo, 'done')
  record(repo, h, { title: 'done squash tree', bullets: ['b'], items: [`worktree:${wt}`] })
  fs.appendFileSync(`${repo}/.git/info/exclude`, '*.env\n')
  fs.writeFileSync(`${wt}/local.env`, 'SECRET=1\n')
  const done = apply(repo, h)
  assert.deepEqual(done.removed, [])
  assert.match(done.skipped[0].reason, /ignored/)
  assert.ok(fs.existsSync(`${wt}/local.env`))
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
  assert.equal(cli(['record', '--title', 't', '--bullet', 'x'.repeat(201), '--item', 'branch:done'], repo, h).code, 1)
  assert.equal(JSON.parse(cli(['list', '--recorded'], repo, h).out), null)
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
  assert.equal(cli(['record', '--title', 'old stuff', '--item', 'branch:done'], repo, h).code, 1)
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
  assert.ok(rec('the tree folder is done', [`worktree:${wt}`]))
})

test('a worktree is named by its path or its folder name', () => {
  const repo = makeRepo()
  const h = tmp('home')
  branch(repo, 'done', { merge: true })
  const wt = worktree(repo, 'done')
  const items = [`worktree:${wt}`, 'branch:done']
  assert.throws(() => record(repo, h, { title: 'done', bullets: [], items }), /never name/)
  assert.ok(record(repo, h, { title: 'done', bullets: [`the folder ${path.basename(wt)}`], items }))
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

test('a worktree that a run started using after the box was recorded is skipped at apply and stays', () => {
  const repo = makeRepo()
  const h = tmp('home')
  branch(repo, 'done', { merge: true })
  const wt = worktree(repo, 'done')
  record(repo, h, { title: 'done squash tree', bullets: ['b'], items: [`worktree:${wt}`] })
  runState(h, repo, 'r', { status: 'running', worktree: wt, branch: 'done' })
  const done = apply(repo, h)
  assert.deepEqual(done.removed, [])
  assert.match(done.skipped[0].reason, /LCW run r/)
  assert.ok(fs.existsSync(wt))
})

test('outside a git repository nothing is listed', () => {
  assert.deepEqual(candidates(tmp('plain'), tmp('home')), [])
})

test('a branch that got a new commit after the box was recorded is skipped at apply', () => {
  const repo = makeRepo()
  const h = tmp('home')
  const head = branch(repo, 'done', { merge: true })
  record(repo, h, { title: 'done squash tree', bullets: ['b'], items: ['branch:done'] })
  git(repo, 'update-ref', 'refs/heads/done', git(repo, 'commit-tree', 'done^{tree}', '-p', head, '-m', 'more'))
  const done = apply(repo, h)
  assert.deepEqual(done.removed, [])
  assert.equal(done.skipped[0].item.name, 'done')
  assert.ok(branches(repo).includes('done'))
})

test('a branch moved to another merged commit after the box was recorded is skipped as changed', () => {
  const repo = makeRepo()
  const h = tmp('home')
  branch(repo, 'done', { merge: true })
  record(repo, h, { title: 'done squash tree', bullets: ['b'], items: ['branch:done'] })
  git(repo, 'branch', '-f', 'done', 'main')
  const done = apply(repo, h)
  assert.match(done.skipped[0].reason, /changed/)
  assert.ok(branches(repo).includes('done'))
})

test('a running LCW run\'s worktree and branches are not listed; a stopped run\'s worktree goes and keeps its branch', () => {
  const repo = makeRepo()
  const h = tmp('home')
  branch(repo, 'lcw/live', { merge: true })
  git(repo, 'branch', 'lcw/early')
  git(repo, 'branch', 'lcw/old')
  const live = worktree(repo, 'lcw/live')
  const old = worktree(repo, 'lcw/old')
  commit(old, 'old.txt')
  runState(h, repo, 'r-live', { status: 'running', worktree: live, branch: 'lcw/live' })
  runState(h, repo, 'r-early', { status: 'paused', worktree: null, branch: 'lcw/early' })
  runState(h, repo, 'r-old', { status: 'stopped', worktree: old, branch: 'lcw/old' })
  const listed = candidates(repo, h)
  assert.deepEqual(names(listed), [`worktree:${old}`])
  assert.equal(listed[0].why, 'LCW run r-old stopped')
  record(repo, h, { title: 'done squash tree', bullets: ['b'], items: [`worktree:${old}`] })
  assert.equal(apply(repo, h).removed.length, 1)
  assert.equal(fs.existsSync(old), false)
  assert.ok(branches(repo).includes('lcw/old'))
})

test('a detached worktree whose commit is in no branch is not listed, even for a finished run', () => {
  const repo = makeRepo()
  const h = tmp('home')
  const wt = worktree(repo, '--detach', 'main')
  commit(wt, 'orphan.txt')
  runState(h, repo, 'r', { status: 'finished', worktree: wt, branch: null })
  assert.deepEqual(candidates(repo, h), [])
})

test('the worktree this session is in and one an open Claude Code session is in are not listed', () => {
  const repo = makeRepo()
  for (const b of ['here', 'open', 'gone']) branch(repo, b, { merge: true })
  const [here, open, gone] = ['here', 'open', 'gone'].map((b) => worktree(repo, b))
  const sessions = `${process.env.CLAUDE_CONFIG_DIR}/sessions`
  fs.mkdirSync(sessions, { recursive: true })
  fs.writeFileSync(`${sessions}/1.json`, JSON.stringify({ pid: process.pid, cwd: open }))
  fs.writeFileSync(`${sessions}/2.json`, JSON.stringify({ pid: 2 ** 22 + 7, cwd: gone })) // no such process
  try {
    assert.deepEqual(names(candidates(here, tmp('home'))), ['branch:gone', `worktree:${gone}`])
  } finally {
    fs.rmSync(sessions, { recursive: true })
  }
})

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

test('a pull request merged into another branch than the default one does not count', () => {
  const repo = makeRepo()
  squashed(repo, false)
  try {
    assert.deepEqual(candidates(repo, tmp('home')), [])
  } finally { delete process.env.GH_STUB }
})

test('a branch with a commit after its merged pull request is not listed', () => {
  const repo = makeRepo()
  const head = squashed(repo)
  try {
    git(repo, 'update-ref', 'refs/heads/squash', git(repo, 'commit-tree', 'squash^{tree}', '-p', head, '-m', 'after'))
    assert.deepEqual(candidates(repo, tmp('home')), [])
  } finally { delete process.env.GH_STUB }
})

test('without gh a squash-merged branch is not listed', () => {
  const repo = makeRepo()
  squashed(repo)
  process.env.PATH = onlyGit
  try {
    assert.deepEqual(candidates(repo, tmp('home')), [])
  } finally { process.env.PATH = withGh; delete process.env.GH_STUB }
})

test('a worktree whose folder was deleted by hand is offered, with its branch when that is merged, and Clean Up removes them; one holding a commit nothing else has stays', () => {
  const repo = makeRepo()
  const h = tmp('home')
  branch(repo, 'old-fix', { merge: true })
  branch(repo, 'wip')
  const merged = worktree(repo, 'old-fix')
  const unmerged = worktree(repo, 'wip')
  const loose = worktree(repo, '--detach')
  commit(loose, 'only-here.txt') // a commit no branch holds: git's record of the worktree is its only reference
  for (const dir of [merged, unmerged, loose]) fs.rmSync(dir, { recursive: true, force: true })
  const list = candidates(repo, h)
  assert.deepEqual(names(list), ['branch:old-fix', `worktree:${merged}`, `worktree:${unmerged}`].sort())
  assert.equal(list.find((i) => i.path === merged).why, 'its folder is gone')
  record(repo, h, { title: 'old-fix is merged and two worktree folders are gone', bullets: [`${merged} and ${unmerged} no longer exist`], items: ['branch:old-fix', `worktree:${merged}`, `worktree:${unmerged}`] })
  assert.equal(apply(repo, h).removed.length, 3)
  assert.deepEqual(branches(repo).sort(), ['main', 'wip'])
  assert.deepEqual(git(repo, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).sort(), [repo, loose].sort())
})

test('a live sweep keeps every wave worktree, open or shipped; an ended one frees them', () => {
  const repo = makeRepo()
  const h = tmp('home')
  const [open, shipped, other] = ['lcw/s-wave-1', 'lcw/s-wave-2', 'lcw/t-wave-1'].map((b) => { git(repo, 'branch', b); return worktree(repo, b) })
  const waves = [{ n: 1, status: 'shipped', worktree: shipped }, { n: 2, status: 'running', stage: 'Build', worktree: open }]
  runState(h, repo, 'r-sweep', { status: 'running', shape: 'sweep', worktree: null, sweep: { waves } })
  runState(h, repo, 'r-done', { status: 'finished', shape: 'sweep', sweep: { waves: [{ n: 1, status: 'shipped', worktree: other }] } })
  const listed = names(candidates(repo, h))
  assert.ok(listed.includes(`worktree:${other}`))
  assert.ok(!listed.includes(`worktree:${open}`) && !listed.includes(`worktree:${shipped}`))
})

test('a worktree with a skip-worktree or assume-unchanged edit is not listed, nor its branch', () => {
  for (const flag of ['--skip-worktree', '--assume-unchanged']) {
    const repo = makeRepo()
    branch(repo, 'done', { merge: true })
    const wt = worktree(repo, 'done')
    git(wt, 'update-index', flag, 'a.txt')
    fs.writeFileSync(`${wt}/a.txt`, 'my local edit\n')
    assert.deepEqual(candidates(repo, tmp('home')), [], flag)
  }
})

test('a skip-worktree path that is not on disk, as in a sparse checkout, does not hold a worktree', () => {
  const repo = makeRepo()
  branch(repo, 'done', { merge: true })
  const wt = worktree(repo, 'done')
  git(wt, 'update-index', '--skip-worktree', 'a.txt')
  fs.rmSync(`${wt}/a.txt`)
  assert.deepEqual(names(candidates(repo, tmp('home'))), [`branch:done`, `worktree:${fs.realpathSync(wt)}`].sort())
})

test('a merged worktree of a repository with over 1 MB of tracked paths is still listed', () => {
  const repo = makeRepo()
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: 'x\n', encoding: 'utf8' }).trim()
  const dir = 'd'.repeat(200)
  const index = Array.from({ length: 3000 }, (_, i) => `100644 ${blob}\t${dir}/${String(i).padStart(4, '0')}${'f'.repeat(200)}\n`).join('')
  execFileSync('git', ['update-index', '--index-info'], { cwd: repo, input: index })
  git(repo, 'commit', '-q', '-m', 'many long paths')
  git(repo, 'reset', '-q', '--hard')
  branch(repo, 'done', { merge: true })
  const wt = worktree(repo, 'done')
  assert.ok(execFileSync('git', ['ls-files', '-v', '-z'], { cwd: wt, maxBuffer: 1 << 28 }).length > 1024 * 1024)
  assert.ok(names(candidates(repo, tmp('home'))).includes(`worktree:${fs.realpathSync(wt)}`))
})
