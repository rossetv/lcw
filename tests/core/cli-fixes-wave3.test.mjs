import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { tmp, makeRepo, git, lcw, readJson, started, CLI } from './helpers.mjs'

test('a stage move keeps a paused run paused', () => {
  const t = started('hold')
  assert.equal(t.cli('pause', 'mark').code, 0)
  const r = t.cli('stage', 'Spec')
  assert.equal(r.code, 0, r.out + r.err)
  const s = t.state()
  assert.equal(s.stage, 'Spec')
  assert.equal(s.status, 'paused')
  assert.equal(s.pausedReason, 'mark')
  assert.ok(s.pausedAt)
})

test('a value that is itself a flag is reported as a missing value', () => {
  const t = started('flags')
  const r = t.cli('checkpoint', '--keep', '--session', 'x')
  assert.equal(r.code, 1)
  assert.match(r.err + r.out, /--keep needs a value/)
})

test('two starts with the same name at the same instant get two runs', async () => {
  const home = tmp('home')
  const repo = makeRepo()
  const env = { ...process.env, LCW_HOME: home, LCW_NOW: String(Date.parse('2026-01-01T12:00:00Z')), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  const go = (session) => new Promise((resolve) => {
    const c = spawn('node', [CLI, 'start', 'same', '--title', `T ${session}`], { cwd: repo, env: { ...env, CLAUDE_CODE_SESSION_ID: session } })
    let out = ''
    c.stdout.on('data', (d) => { out += d })
    c.on('close', () => resolve(/^folder: (.+)$/m.exec(out)?.[1]))
  })
  const [a, b] = await Promise.all([go('sa'), go('sb')])
  assert.ok(a && b)
  assert.notEqual(a, b)
  assert.deepEqual([readJson(`${a}/state.json`).title, readJson(`${b}/state.json`).title].sort(), ['T sa', 'T sb'])
})

test('abandon keeps a worktree holding a skip-worktree edit', () => {
  const t = started('skip')
  const wt = t.cli('worktree').out.trim()
  git(wt, 'update-index', '--skip-worktree', 'a.txt')
  fs.writeFileSync(`${wt}/a.txt`, 'local edit\n')
  const old = new Date(Date.now() - 20 * 60000)
  for (const f of ['state.json', 'ledger.md']) fs.utimesSync(`${t.dir}/${f}`, old, old)
  const r = lcw(['abandon', t.state().id], { ...t.o, session: 's2' })
  assert.equal(r.code, 0, r.out + r.err)
  assert.match(r.out, /worktree kept: .*a\.txt/)
  assert.equal(fs.readFileSync(`${wt}/a.txt`, 'utf8'), 'local edit\n')
})

test('stopping a sweep leaves another worktree that sits at its -latest path', () => {
  const home = tmp('home')
  const repo = makeRepo()
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
  const o = { home, cwd: repo, session: 's1' }
  assert.equal(lcw(['start', 'tidy', '--title', 'Tidy', '--shape', 'sweep'], o).code, 0)
  const other = `${repo}/.claude/worktrees/tidy-latest`
  git(repo, 'worktree', 'add', '-q', '-b', 'mine', other)
  fs.writeFileSync(`${other}/notes.txt`, 'unsaved\n')
  const r = lcw(['stop'], o)
  assert.equal(r.code, 0, r.out + r.err)
  assert.equal(fs.readFileSync(`${other}/notes.txt`, 'utf8'), 'unsaved\n')
  assert.match(r.out, /worktree kept: .*tidy-latest/)
})
