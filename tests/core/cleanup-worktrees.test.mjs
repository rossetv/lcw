import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmp, makeRepo, git } from './helpers.mjs'
import { commit, branch, worktree, runState, names, branches } from './cleanup-fixtures.mjs'
import { candidates, record, apply } from '../../scripts/lib/cleanup.mjs'

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

test('a live sweep keeps the branch of every wave, a merged one with no worktree too; a sweep that is over frees them', () => {
  const repo = makeRepo()
  const h = tmp('home')
  for (const b of ['lcw/s', 'lcw/s-wave-1', 'lcw/s-wave-2', 'lcw/t-wave-1']) git(repo, 'branch', b)
  const waves = [{ n: 1, status: 'shipped', merged: true, branch: 'lcw/s-wave-1', worktree: null }, { n: 2, status: 'shipped', merged: true, branch: null, worktree: null }]
  runState(h, repo, 'r-sweep', { status: 'running', shape: 'sweep', name: 's', branch: 'lcw/s', worktree: null, sweep: { waves } })
  runState(h, repo, 'r-done', { status: 'finished', shape: 'sweep', name: 't', branch: 'lcw/t', sweep: { waves: [{ n: 1, status: 'shipped', branch: 'lcw/t-wave-1' }] } })
  const listed = names(candidates(repo, h))
  assert.ok(listed.includes('branch:lcw/t-wave-1'))
  assert.ok(!listed.some((n) => n.startsWith('branch:lcw/s')), listed.join(' '))
})

test('a live sweep keeps its detached -latest hunt worktree even at a tip already in main; a sweep that is over frees it', () => {
  const repo = makeRepo()
  const h = tmp('home')
  const latest = (name) => {
    const dir = `${repo}/.claude/worktrees/${name}-latest`
    git(repo, 'worktree', 'add', '-q', '--detach', dir, 'main')
    return fs.realpathSync(dir)
  }
  const live = latest('s')
  const over = latest('t')
  runState(h, repo, 'r-live', { status: 'running', shape: 'sweep', name: 's', repoRoot: repo, worktree: null, sweep: { waves: [] } })
  runState(h, repo, 'r-over', { status: 'finished', shape: 'sweep', name: 't', repoRoot: repo, sweep: { waves: [] } })
  const listed = names(candidates(repo, h))
  assert.ok(!listed.includes(`worktree:${live}`))
  assert.ok(listed.includes(`worktree:${over}`))
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
  const dir = Array(3).fill('d'.repeat(200)).join('/')
  const index = Array.from({ length: 1400 }, (_, i) => `100644 ${blob}\t${dir}/${String(i).padStart(4, '0')}${'f'.repeat(200)}\n`).join('')
  execFileSync('git', ['update-index', '--index-info'], { cwd: repo, input: index })
  git(repo, 'commit', '-q', '-m', 'many long paths') // main's own folder is left without the files: only the worktree's index is read
  git(repo, 'branch', 'done')
  const wt = worktree(repo, 'done')
  assert.ok(execFileSync('git', ['ls-files', '-v', '-z'], { cwd: wt, maxBuffer: 1 << 28 }).length > 1024 * 1024)
  assert.ok(names(candidates(repo, tmp('home'))).includes(`worktree:${fs.realpathSync(wt)}`))
})
