import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fnv1a32hex } from '../../lib/key.mjs'
import { spawn, spawnSync } from 'node:child_process'
import { tmp, makeRepo, git, lcw, cli, readJson, begin, CLI } from './helpers.mjs'

test('worktree: branch, folder, exclude, place pointer', async () => {
  const t = await begin('wt')
  const wt = (await t.cli('worktree')).out.trim()
  assert.equal(wt, `${t.repo}/.claude/worktrees/wt`)
  assert.ok(fs.existsSync(`${wt}/a.txt`))
  assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lcw/wt')
  assert.match(fs.readFileSync(`${t.repo}/.git/info/exclude`, 'utf8'), /^\.claude\/worktrees\/$/m)
  assert.equal(git(t.repo, 'status', '--porcelain'), '')
  assert.equal(t.state().worktree, wt)
  assert.equal(t.state().branch, 'lcw/wt')
  assert.equal(readJson(`${t.home}/places/${fnv1a32hex(wt)}.json`).runDir, t.dir)
  assert.equal((await t.cli('worktree')).out.trim(), wt)
})

// A run whose main checkout tracks a remote, and a second clone that has pushed one more commit to it.
async function behindItsRemote(name) {
  const t = await begin(name)
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

test('worktree: a clean main checkout behind its remote is brought up to date before the run branches', async () => {
  const { t, tip } = await behindItsRemote('up')
  const r = await t.cli('worktree')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /1 commits behind/)
  assert.equal(git(t.repo, 'rev-parse', 'HEAD'), tip)
  assert.ok(fs.existsSync(`${t.repo}/.claude/worktrees/up/b.txt`))
})

test('worktree: a main checkout with commits of its own is left as it is, and the run keeps them', async () => {
  const { t } = await behindItsRemote('mine')
  fs.writeFileSync(`${t.repo}/local.txt`, 'not pushed\n')
  git(t.repo, 'add', '.')
  git(t.repo, 'commit', '-q', '-m', 'local only')
  const head = git(t.repo, 'rev-parse', 'HEAD')
  const r = await t.cli('worktree')
  assert.match(r.out, /left as it is.* 1 commits/)
  assert.equal(git(t.repo, 'rev-parse', 'HEAD'), head)
  assert.ok(fs.existsSync(`${t.repo}/.claude/worktrees/mine/local.txt`))
})

test('worktree: a main checkout with uncommitted changes is not moved', async () => {
  const { t } = await behindItsRemote('dirty')
  const head = git(t.repo, 'rev-parse', 'HEAD')
  fs.writeFileSync(`${t.repo}/a.txt`, 'half done\n')
  const r = await t.cli('worktree')
  assert.match(r.out, /left as it is.*uncommitted/)
  assert.equal(git(t.repo, 'rev-parse', 'HEAD'), head)
  assert.equal(fs.readFileSync(`${t.repo}/a.txt`, 'utf8'), 'half done\n')
})

test('an unknown flag or command, or a flag out of place, is refused in one line that names it, and changes nothing', async () => {
  const t = await begin()
  const before = fs.readFileSync(`${t.dir}/state.json`, 'utf8')
  const refused = [
    [['pause', '--bogus'], '--bogus'],
    [['task', 'add', 'T1', 'x', '--waiting', '1'], '--waiting'],
    [['frobnicate'], 'frobnicate'],
    [['ask', 'q', '--title'], '--title'],
    [['ledger', '- a note'], '- a note'],
    [['--session', 's1', 'ask', 'why'], '--session'], // the command must come first
  ]
  for (const [a, named] of refused) {
    const r = await t.cli(...a)
    assert.equal(r.code, 1, a.join(' '))
    assert.ok(r.out.includes(named), `${a.join(' ')}: ${r.out}`)
    assert.ok(r.out.includes('lcw help'), a.join(' '))
    assert.equal(r.out.trim().split('\n').length, 1, `${a.join(' ')} is refused in a line, not the whole help`)
  }
  assert.equal(fs.readFileSync(`${t.dir}/state.json`, 'utf8'), before)
  assert.equal(t.state().worktree, null)
  assert.equal((await t.cli('ledger', 'a - note')).code, 0)
  assert.equal((await t.cli('ask', 'why - now', '--waiting', '-3')).code, 0)
})

test('help, in any form, lists every command, each of which is its own, and changes nothing', async () => {
  const t = await begin()
  const before = fs.readFileSync(`${t.dir}/state.json`, 'utf8')
  const help = await t.cli('help')
  assert.equal(help.code, 0)
  const commands = /^lcw commands: (.+)$/m.exec(help.out)[1].split(' ')
  assert.ok(commands.length > 10 && commands.includes('start') && commands.includes('wave'))
  for (const a of [...commands.map((c) => [c, '--help']), ['stop', '-h']]) {
    const r = await t.cli(...a)
    assert.equal(r.code, 0, a.join(' '))
    assert.equal(r.out, help.out, a.join(' '))
  }
  assert.equal(fs.readFileSync(`${t.dir}/state.json`, 'utf8'), before)
  const none = await t.cli('frobnicate')
  assert.ok(commands.every((c) => none.out.includes(c)), 'a refused command lists the ones there are')
})

test('a value that is itself a flag is reported as a missing value, in either form, and nothing changes', async () => {
  const t = await begin('flags')
  const before = fs.readFileSync(`${t.dir}/ledger.md`, 'utf8')
  for (const next of [['--session', 'x'], ['--session=s1']]) {
    const r = await t.cli('checkpoint', '--keep', ...next)
    assert.equal(r.code, 1, next.join(' '))
    assert.match(r.out, /--keep needs a value/)
  }
  assert.equal(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), before)
})

// real processes: the lock is what keeps them apart; a busy machine must not turn a wait for it into a refusal
const parallel = (n, t, argsOf) => Promise.all(Array.from({ length: n }, (_, i) => new Promise((res) => {
  spawn('node', [CLI, ...argsOf(i)], { cwd: t.o.cwd, env: { ...process.env, LCW_LOCK_WAIT_MS: '120000', LCW_HOME: t.o.home, CLAUDE_CODE_SESSION_ID: t.o.session } }).on('close', res)
})))

test('concurrent calls do not lose changes', async () => {
  const t = await begin()
  const codes = await parallel(8, t, (i) => ['task', 'add', `T${i}`, `title ${i}`])
  assert.ok(codes.every((c) => c === 0))
  assert.equal(t.state().tasks.length, 8)
  const codes2 = await parallel(8, t, (i) => ['task', `T${i}`, 'done'])
  assert.ok(codes2.every((c) => c === 0))
  assert.ok(t.state().tasks.every((x) => x.status === 'done'))
  assert.ok(!fs.existsSync(`${t.dir}/lock`))
})

test('two starts with the same name at the same instant get two runs', async () => {
  const home = tmp('home')
  const repo = makeRepo()
  const env = { ...process.env, LCW_HOME: home, LCW_LOCK_WAIT_MS: '120000', LCW_NOW: String(Date.parse('2026-01-01T12:00:00Z')), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
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

test('a stale lock is taken over', async () => {
  const t = await begin()
  fs.mkdirSync(`${t.dir}/lock`)
  const old = new Date(Date.now() - 60000)
  fs.utimesSync(`${t.dir}/lock`, old, old)
  assert.equal((await t.cli('task', 'add', 'T1', 'x')).code, 0)
})

/** A run's lock held by pid since `ago` ms, its folder dated a minute back. */
function heldLock(t, pid, ago) {
  fs.mkdirSync(`${t.dir}/lock`)
  fs.writeFileSync(`${t.dir}/lock/holder.json`, JSON.stringify({ pid, token: 'other', at: Date.now() - ago }))
  const old = new Date(Date.now() - 60000)
  fs.utimesSync(`${t.dir}/lock`, old, old)
}

// The holders below are real processes: this test process is the live one, and a process that has exited is the dead one.
test('a lock whose holder still runs is not taken for being slow', async () => {
  const t = await begin()
  heldLock(t, process.pid, 60000)
  const r = lcw(['task', 'add', 'T1', 'x'], { ...t.o, env: { LCW_LOCK_WAIT_MS: '300' } })
  assert.equal(r.code, 1, r.out)
  assert.deepEqual(t.state().tasks, [])
  assert.equal(readJson(`${t.dir}/lock/holder.json`).token, 'other')
})

test('a lock whose holder has gone is taken at once, and one held past the long limit is taken from a live holder', async () => {
  const t = await begin()
  const gone = spawnSync(process.execPath, ['-e', '']).pid
  heldLock(t, gone, 0)
  const r = lcw(['task', 'add', 'T1', 'x'], { ...t.o, env: { LCW_LOCK_WAIT_MS: '5000' } })
  assert.equal(r.code, 0, r.out)
  assert.ok(!fs.existsSync(`${t.dir}/lock`))
  heldLock(t, process.pid, 2000)
  const hung = lcw(['task', 'add', 'T2', 'x'], { ...t.o, env: { LCW_LOCK_WAIT_MS: '5000', LCW_LOCK_HUNG_MS: '1000' } })
  assert.equal(hung.code, 0, hung.out)
  assert.deepEqual(t.state().tasks.map((x) => x.id), ['T1', 'T2'])
})

test('pictures go to one commit on a ref outside every branch, and the change is untouched', async () => {
  const t = await begin('pics')
  const bare = tmp('bare')
  git(bare, 'init', '-q', '--bare')
  git(t.repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
  git(t.repo, 'remote', 'set-url', '--push', 'origin', bare)
  const dir = tmp('pictures')
  for (const f of ['what.svg', 'how it works.svg']) fs.writeFileSync(`${dir}/${f}`, '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const head = git(t.repo, 'rev-parse', 'HEAD')
  const r = await t.cli('pictures', `${dir}/what.svg`, `${dir}/how it works.svg`)
  assert.equal(r.code, 0, r.out)
  const sha = git(bare, 'rev-parse', 'refs/lcw/pictures/pics')
  assert.deepEqual(r.out.trim().split('\n'), [`https://github.com/acme/widgets/raw/${sha}/what.svg`, `https://github.com/acme/widgets/raw/${sha}/how%20it%20works.svg`])
  assert.deepEqual(git(bare, 'ls-tree', '--name-only', sha).split('\n').sort(), ['how it works.svg', 'what.svg'])
  assert.equal(git(bare, 'for-each-ref', 'refs/heads'), '')
  assert.equal(git(t.repo, 'rev-parse', 'HEAD'), head)
  assert.equal(git(t.repo, 'status', '--porcelain'), '')
})

test('pictures are refused without a GitHub remote', async () => {
  const t = await begin('pics')
  const f = `${tmp('pictures')}/what.svg`
  fs.writeFileSync(f, '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const r = await t.cli('pictures', f)
  assert.equal(r.code, 1)
  assert.match(r.out, /GitHub remote/)
})

test('worktree: the exclude entry gets a line of its own when the file does not end in a newline', async () => {
  const t = await begin('wt2')
  fs.mkdirSync(`${t.repo}/.git/info`, { recursive: true })
  fs.writeFileSync(`${t.repo}/.git/info/exclude`, '*.log')
  await t.cli('worktree')
  assert.deepEqual(fs.readFileSync(`${t.repo}/.git/info/exclude`, 'utf8').split('\n').filter(Boolean), ['*.log', '.claude/worktrees/'])
})

/** A started sweep past its charter, in Hunt; start() starts the front queued wave and sets wt to its worktree. */
async function hunting() {
  const home = tmp('home')
  const repo = makeRepo()
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
  const o = { home, cwd: repo, session: 's1' }
  const dir = /^folder: (.+)$/m.exec((await cli(['start', 'tidy', '--title', 'Tidy', '--shape', 'sweep'], o)).out)[1]
  fs.writeFileSync(`${dir}/charter.md`, 'goals: fix the backlog\n')
  const t = { repo, o, cli: (...a) => cli(a, o) }
  for (const a of [['approval'], ['stage', 'Hunt'], ['worktree']]) await t.cli(...a)
  t.start = async () => {
    const r = await t.cli('wave', 'start')
    if (r.code === 0) t.wt = /^worktree: (.+)$/m.exec(r.out)[1]
    return r
  }
  return t
}

test('stopping a sweep leaves another worktree that sits at its -latest path', async () => {
  const repo = makeRepo()
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
  const o = { home: tmp('home'), cwd: repo, session: 's1' }
  assert.equal((await cli(['start', 'tidy', '--title', 'Tidy', '--shape', 'sweep'], o)).code, 0)
  const other = `${repo}/.claude/worktrees/tidy-latest`
  git(repo, 'worktree', 'add', '-q', '-b', 'mine', other)
  fs.writeFileSync(`${other}/notes.txt`, 'unsaved\n')
  const r = await cli(['stop'], o)
  assert.equal(r.code, 0, r.out)
  assert.equal(fs.readFileSync(`${other}/notes.txt`, 'utf8'), 'unsaved\n')
  assert.match(r.out, /worktree kept: .*tidy-latest/)
})

/** A hunt beside three open waves, where wave 1 has a later commit that merges cleanly and wave 2's branch has an unrelated history. */
async function threeWavesOneUnmergeable() {
  const t = await hunting()
  await t.cli('wave', 'add', '1', '1', '1')
  await t.start()
  const wt1 = t.wt
  fs.writeFileSync(`${wt1}/b.txt`, 'one\n')
  git(wt1, 'add', 'b.txt')
  git(wt1, 'commit', '-q', '-m', 'one')
  // only two waves are built or reviewed at once, so each goes on as the next one starts
  const ok = (r) => { assert.equal(r.code, 0, r.out); return r }
  ok(await t.cli('stage', 'Review', '--wave', '1'))
  ok(await t.start())
  ok(await t.cli('stage', 'Review', '--wave', '2'))
  ok(await t.cli('stage', 'Ship', '--wave', '1'))
  ok(await t.start())
  ok(await t.cli('stage', 'Ship', '--wave', '2'))
  ok(await t.cli('stage', 'Build', '--wave', '3'))
  ok(await t.cli('stage', 'Review', '--wave', '3'))
  fs.writeFileSync(`${wt1}/c.txt`, 'later\n')
  git(wt1, 'add', 'c.txt')
  git(wt1, 'commit', '-q', '-m', 'later')
  const branch = 'refs/heads/lcw/tidy-wave-2'
  const real = git(t.repo, 'rev-parse', branch)
  const orphan = git(t.repo, 'commit-tree', '-m', 'orphan', '4b825dc642cb6eb9a060e54bf8d69288fbee4904')
  git(t.repo, 'update-ref', branch, orphan)
  return { ...t, restore: () => git(t.repo, 'update-ref', branch, real) }
}

test('a hunt whose merge fails without a conflict frees its worktree, so the next hunt can be made', async () => {
  const t = await threeWavesOneUnmergeable()
  const latest = `${t.repo}/.claude/worktrees/tidy-latest`
  const failed = await t.cli('stage', 'Hunt')
  assert.equal(failed.code, 1)
  assert.match(failed.out, /could not merge/)
  assert.doesNotMatch(failed.out, /worktree kept/)
  assert.ok(!fs.existsSync(latest))
  t.restore()
  const again = await t.cli('stage', 'Hunt')
  assert.equal(again.code, 0, again.out)
})

test('a hunt refuses to start while a folder that is not its own sits at its worktree path', async () => {
  const t = await hunting()
  assert.equal((await t.cli('stage', 'Ship')).code, 0)
  git(t.repo, 'worktree', 'add', '-q', '-b', 'mine', `${t.repo}/.claude/worktrees/tidy-latest`)
  const r = await t.cli('stage', 'Hunt')
  assert.equal(r.code, 1)
  assert.match(r.out, /tidy-latest/)
})
