import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fnv1a32hex } from '../../lib/key.mjs'
import { spawn } from 'node:child_process'
import { tmp, makeRepo, git, lcw, readJson, started, CLI } from './helpers.mjs'

test('worktree: branch, folder, exclude, place pointer', () => {
  const t = started('wt')
  const wt = t.cli('worktree').out.trim()
  assert.equal(wt, `${t.repo}/.claude/worktrees/wt`)
  assert.ok(fs.existsSync(`${wt}/a.txt`))
  assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lcw/wt')
  assert.match(fs.readFileSync(`${t.repo}/.git/info/exclude`, 'utf8'), /^\.claude\/worktrees\/$/m)
  assert.equal(git(t.repo, 'status', '--porcelain'), '')
  assert.equal(t.state().worktree, wt)
  assert.equal(t.state().branch, 'lcw/wt')
  assert.equal(readJson(`${t.home}/places/${fnv1a32hex(wt)}.json`).runDir, t.dir)
  assert.equal(t.cli('worktree').out.trim(), wt)
})

// A run whose main checkout tracks a remote, and a second clone that has pushed one more commit to it.
function behindItsRemote(name) {
  const t = started(name)
  const bare = tmp('bare')
  git(bare, 'init', '-q', '--bare', '-b', 'main')
  git(t.repo, 'remote', 'add', 'origin', bare)
  git(t.repo, 'push', '-q', '-u', 'origin', 'main')
  const other = tmp('other')
  git(other, 'clone', '-q', bare, '.')
  fs.writeFileSync(`${other}/b.txt`, 'merged elsewhere\n')
  git(other, 'add', '.')
  git(other, 'commit', '-q', '-m', 'merged elsewhere')
  git(other, 'push', '-q', 'origin', 'main')
  return { t, tip: git(other, 'rev-parse', 'HEAD') }
}

test('worktree: a clean main checkout behind its remote is brought up to date before the run branches', () => {
  const { t, tip } = behindItsRemote('up')
  const r = t.cli('worktree')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /was 1 commits behind origin\/main and is now up to date/)
  assert.equal(git(t.repo, 'rev-parse', 'HEAD'), tip)
  assert.ok(fs.existsSync(`${t.repo}/.claude/worktrees/up/b.txt`))
})

test('worktree: a main checkout with commits of its own is left as it is, and the run keeps them', () => {
  const { t } = behindItsRemote('mine')
  fs.writeFileSync(`${t.repo}/local.txt`, 'not pushed\n')
  git(t.repo, 'add', '.')
  git(t.repo, 'commit', '-q', '-m', 'local only')
  const head = git(t.repo, 'rev-parse', 'HEAD')
  const r = t.cli('worktree')
  assert.match(r.out, /left as it is, because it has 1 commits origin\/main does not/)
  assert.equal(git(t.repo, 'rev-parse', 'HEAD'), head)
  assert.ok(fs.existsSync(`${t.repo}/.claude/worktrees/mine/local.txt`))
})

test('worktree: a main checkout with uncommitted changes is not moved', () => {
  const { t } = behindItsRemote('dirty')
  const head = git(t.repo, 'rev-parse', 'HEAD')
  fs.writeFileSync(`${t.repo}/a.txt`, 'half done\n')
  const r = t.cli('worktree')
  assert.match(r.out, /left as it is, because it has uncommitted changes/)
  assert.equal(git(t.repo, 'rev-parse', 'HEAD'), head)
  assert.equal(fs.readFileSync(`${t.repo}/a.txt`, 'utf8'), 'half done\n')
})

test('an unknown flag is refused, help prints the commands, and neither changes anything', () => {
  const t = started()
  const before = fs.readFileSync(`${t.dir}/state.json`, 'utf8')
  for (const a of [['pause', '--bogus'], ['task', 'add', 'T1', 'x', '--waiting', '1'], ['ledger', '- a note'], ['ask', 'q', '--title']]) {
    const r = t.cli(...a)
    assert.equal(r.code, 1, a.join(' '))
  }
  for (const a of [['help'], ['finish', '--help'], ['stop', '--help'], ['worktree', '--help'], ['stop', '-h']]) {
    const r = t.cli(...a)
    assert.equal(r.code, 0, a.join(' '))
    assert.match(r.out, /lcw commands/, a.join(' '))
  }
  assert.equal(fs.readFileSync(`${t.dir}/state.json`, 'utf8'), before)
  assert.equal(t.state().worktree, null)
  assert.equal(t.cli('ledger', 'a - note').code, 0)
  assert.equal(t.cli('--session', 's1', 'ask', 'why').code, 1) // the command must come first
  assert.equal(t.cli('ask', 'why - now', '--waiting', '-3').code, 0)
})

const parallel = (n, mk) => Promise.all(Array.from({ length: n }, (_, i) => new Promise((res) => {
  const t = mk(i)
  const p = spawn('node', [CLI, ...t.args], { cwd: t.o.cwd, env: { ...process.env, LCW_HOME: t.o.home, CLAUDE_CODE_SESSION_ID: t.o.session } })
  p.on('close', res)
})))

test('concurrent calls do not lose changes', async () => {
  const t = started()
  const codes = await parallel(20, (i) => ({ ...t, args: ['task', 'add', `T${i}`, `title ${i}`] }))
  assert.ok(codes.every((c) => c === 0))
  assert.equal(t.state().tasks.length, 20)
  const codes2 = await parallel(20, (i) => ({ ...t, args: ['task', `T${i}`, 'done'] }))
  assert.ok(codes2.every((c) => c === 0))
  assert.ok(t.state().tasks.every((x) => x.status === 'done'))
  assert.ok(!fs.existsSync(`${t.dir}/lock`))
})

test('a stale lock is taken over', () => {
  const t = started()
  fs.mkdirSync(`${t.dir}/lock`)
  const old = new Date(Date.now() - 60000)
  fs.utimesSync(`${t.dir}/lock`, old, old)
  assert.equal(t.cli('task', 'add', 'T1', 'x').code, 0)
})

test('pictures go to one commit on a ref outside every branch, and the change is untouched', () => {
  const t = started('pics')
  const bare = tmp('bare')
  git(bare, 'init', '-q', '--bare')
  git(t.repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
  git(t.repo, 'remote', 'set-url', '--push', 'origin', bare)
  const dir = tmp('pictures')
  for (const f of ['what.svg', 'how it works.svg']) fs.writeFileSync(`${dir}/${f}`, '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const head = git(t.repo, 'rev-parse', 'HEAD')
  const r = t.cli('pictures', `${dir}/what.svg`, `${dir}/how it works.svg`)
  assert.equal(r.code, 0, r.out + r.err)
  const sha = git(bare, 'rev-parse', 'refs/lcw/pictures/pics')
  assert.deepEqual(r.out.trim().split('\n'), [`https://github.com/acme/widgets/raw/${sha}/what.svg`, `https://github.com/acme/widgets/raw/${sha}/how%20it%20works.svg`])
  assert.deepEqual(git(bare, 'ls-tree', '--name-only', sha).split('\n').sort(), ['how it works.svg', 'what.svg'])
  assert.equal(git(bare, 'for-each-ref', 'refs/heads'), '')
  assert.equal(git(t.repo, 'rev-parse', 'HEAD'), head)
  assert.equal(git(t.repo, 'status', '--porcelain'), '')
})

test('pictures are refused without a GitHub remote', () => {
  const t = started('pics')
  const f = `${tmp('pictures')}/what.svg`
  fs.writeFileSync(f, '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const r = t.cli('pictures', f)
  assert.equal(r.code, 1)
  assert.match(r.out + r.err, /GitHub remote/)
})

test('worktree: the exclude entry gets a line of its own when the file does not end in a newline', () => {
  const t = started('wt2')
  fs.mkdirSync(`${t.repo}/.git/info`, { recursive: true })
  fs.writeFileSync(`${t.repo}/.git/info/exclude`, '*.log')
  t.cli('worktree')
  assert.deepEqual(fs.readFileSync(`${t.repo}/.git/info/exclude`, 'utf8').split('\n').filter(Boolean), ['*.log', '.claude/worktrees/'])
})
