import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, git, lcw, cli, readJson, begin, fakeClaude } from './helpers.mjs'

// Claude Code's own session files are read from here, never from the person's real ones
const claudeDir = tmp('claude')
process.env.CLAUDE_CONFIG_DIR = claudeDir
fs.mkdirSync(`${claudeDir}/sessions`)

// A run no session has shown for 20 minutes: its state, its ledger and the mod's mark of drawing it all look old.
function leftAlone(dir) {
  const old = new Date(Date.now() - 20 * 60000)
  for (const f of ['state.json', 'ledger.md']) fs.utimesSync(`${dir}/${f}`, old, old)
  fs.writeFileSync(`${dir}/mod-alive`, String(old.getTime()))
  fs.utimesSync(`${dir}/mod-alive`, old, old)
}

// A started run with its worktree, left alone, and another session in the main checkout
async function abandoned(name = 'demo') {
  const t = await begin(name)
  const wt = (await t.cli('worktree')).out.trim()
  leftAlone(t.dir)
  const other = { home: t.home, cwd: t.repo, session: 's2' }
  return { ...t, wt, id: t.state().id, other, branchExists: () => git(t.repo, 'branch', '--list', `lcw/${name}`) !== '' }
}

test('take refuses a run a session has shown in the last 15 minutes, and changes nothing', async () => {
  const t = await abandoned()
  fs.writeFileSync(`${t.dir}/mod-alive`, String(Date.now() - 60000))
  const before = fs.readFileSync(`${t.dir}/state.json`, 'utf8')
  const r = await cli(['take', t.id], t.other)
  assert.equal(r.code, 1)
  assert.match(r.out, /shown by a session/)
  assert.equal(fs.readFileSync(`${t.dir}/state.json`, 'utf8'), before)
  assert.equal(fs.existsSync(`${t.home}/sessions/s2.json`), false)
  const fresh = await begin()
  assert.equal((await cli(['abandon', fresh.state().id], { ...fresh.o, session: 's2' })).code, 1, 'a run whose state just changed counts as shown')
  assert.equal(fresh.state().status, 'with-you')
})

test('take binds this session to a run left alone, makes it the driver and prints where its worktree is', async () => {
  const t = await abandoned()
  const r = await cli(['take', t.id], t.other)
  assert.equal(r.code, 0, r.out)
  assert.equal(readJson(`${t.home}/sessions/s2.json`).runDir, t.dir)
  assert.equal(t.state().driver, 's2')
  assert.match(r.out, new RegExp(`^worktree: ${t.wt}$`, 'm'))
  assert.equal((await cli(['where'], t.other)).out.trim(), t.dir)
  assert.equal((await cli(['where'], t.o)).code, 1, 'the session that drove it before no longer finds it')
  assert.equal((await cli(['take', t.id], { ...t.other, session: 's3' })).code, 1, 'the take itself shows the run, so a second click elsewhere is refused')
})

test('take by the session that already drives the run keeps it bound to the run', async () => {
  const t = await abandoned()
  const r = await cli(['take', t.id], t.o)
  assert.equal(r.code, 0, r.out)
  assert.equal(readJson(`${t.home}/sessions/s1.json`).runDir, t.dir)
  assert.equal((await cli(['status'], t.o)).code, 0)
})

test('take and abandon refuse a run whose driving session\'s Claude Code is still running', async () => {
  const t = await abandoned()
  const claude = fakeClaude()
  const file = `${t.home}/sessions/s1.json`
  fs.writeFileSync(file, JSON.stringify({ ...readJson(file), claudePid: claude.pid }))
  leftAlone(t.dir)
  try {
    for (const cmd of ['take', 'abandon']) {
      const r = await cli([cmd, t.id], t.other)
      assert.equal(r.code, 1)
      assert.match(r.out, /still open/)
    }
  } finally { claude.kill() }
  assert.deepEqual([t.state().status, t.state().driver], ['with-you', 's1'])
})

test('take and abandon treat a driver whose pid now belongs to an unrelated process as closed', async () => {
  const t = await abandoned()
  const file = `${t.home}/sessions/s1.json`
  fs.writeFileSync(file, JSON.stringify({ ...readJson(file), claudePid: process.pid })) // a live process, but not Claude Code
  assert.equal(lcw(['take', t.id], t.other).code, 0)
  assert.equal(t.state().driver, 's2')
})

test('take is allowed when the driving session has the same Claude Code process as the caller, as after /clear', async () => {
  const t = await abandoned()
  const claude = fakeClaude()
  try {
    for (const id of ['s1', 's2']) {
      const file = `${t.home}/sessions/${id}.json`
      fs.writeFileSync(file, JSON.stringify({ ...(fs.existsSync(file) ? readJson(file) : {}), claudePid: claude.pid }))
    }
    assert.equal((await cli(['take', t.id], t.other)).code, 0)
    assert.equal(t.state().driver, 's2')
  } finally { claude.kill() }
})

test('abandon keeps a worktree an open Claude Code session sits in', async () => {
  const t = await abandoned()
  const session = `${claudeDir}/sessions/open.json`
  fs.writeFileSync(session, JSON.stringify({ pid: process.pid, cwd: `${t.wt}` }))
  try {
    const r = lcw(['abandon', t.id], t.other)
    assert.match(r.out, /worktree kept: .*open Claude Code session/)
    assert.ok(fs.existsSync(t.wt))
  } finally { fs.rmSync(session) }
})

test('take and abandon refuse a finished or a stopped run, and a run of another repository', async () => {
  for (const end of ['finish', 'stop']) {
    const t = await abandoned()
    await t.cli(end)
    leftAlone(t.dir)
    for (const cmd of ['take', 'abandon']) {
      const r = await cli([cmd, t.id], t.other)
      assert.equal(r.code, 1)
      assert.match(r.out, /finished|stopped/)
    }
    assert.ok(fs.existsSync(t.wt))
  }
  const t = await abandoned()
  const elsewhere = { home: t.home, cwd: makeRepo(), session: 's2' }
  for (const cmd of ['take', 'abandon']) assert.equal((await cli([cmd, t.id], elsewhere)).code, 1)
  assert.equal((await cli(['take', '../x'], t.other)).code, 1)
  assert.equal(t.state().status, 'with-you')
})

test('abandon stops the run, removes its clean worktree and its place pointer, and keeps its branch', async () => {
  const t = await abandoned()
  fs.writeFileSync(`${t.wt}/b.txt`, 'work\n')
  git(t.wt, 'add', 'b.txt')
  git(t.wt, 'commit', '-q', '-m', 'work')
  const r = await cli(['abandon', t.id], t.other)
  assert.equal(r.code, 0, r.out)
  assert.equal(t.state().status, 'stopped')
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), / abandoned$/m)
  assert.equal(fs.existsSync(t.wt), false)
  assert.ok(t.branchExists())
  assert.equal(git(t.repo, 'show', 'lcw/demo:b.txt'), 'work', 'the work on the branch is kept')
  assert.equal((await cli(['where'], { home: t.home, cwd: t.repo, session: 'fresh' })).code, 1)
})

test('abandon keeps a worktree with uncommitted, untracked or ignored files, says so, and still keeps the branch', async () => {
  const ignoredEnv = (wt) => {
    fs.writeFileSync(`${wt}/.gitignore`, '.env\n')
    git(wt, 'add', '.gitignore')
    git(wt, 'commit', '-q', '-m', 'ignore')
    fs.writeFileSync(`${wt}/.env`, 'secret\n')
  }
  const cases = [
    ['edited', (wt) => fs.writeFileSync(`${wt}/a.txt`, 'changed\n'), /uncommitted or untracked/],
    ['added', (wt) => fs.writeFileSync(`${wt}/new.txt`, 'mine\n'), /uncommitted or untracked/],
    ['hidden', (wt) => { git(wt, 'config', 'status.showUntrackedFiles', 'no'); fs.writeFileSync(`${wt}/new.txt`, 'mine\n') }, /uncommitted or untracked/],
    ['ignored', ignoredEnv, /ignored files such as \.env/],
    ['skipped', (wt) => { git(wt, 'update-index', '--skip-worktree', 'a.txt'); fs.writeFileSync(`${wt}/a.txt`, 'local edit\n') }, /a\.txt/],
  ]
  for (const [name, dirty, why] of cases) {
    const t = await abandoned(name)
    dirty(t.wt)
    const before = fs.readdirSync(t.wt).map((f) => [f, fs.statSync(`${t.wt}/${f}`).isFile() ? fs.readFileSync(`${t.wt}/${f}`, 'utf8') : null])
    const r = await cli(['abandon', t.id], t.other)
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /worktree kept: /)
    assert.match(r.out, why)
    assert.equal(t.state().status, 'stopped')
    assert.deepEqual(fs.readdirSync(t.wt).map((f) => [f, fs.statSync(`${t.wt}/${f}`).isFile() ? fs.readFileSync(`${t.wt}/${f}`, 'utf8') : null]), before)
    assert.ok(t.branchExists())
  }
})
