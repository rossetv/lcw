import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { cli } from './helpers.mjs' // first: it points HOME at a throwaway folder
import { configureQuota, disableQuota, readQuotaState, claimRefresh, recordQuotaResult, refreshQuota, runQuotaCommand } from '../../scripts/lib/quota-command.mjs'
import { evaluateQuota, selectQuota } from '../../lib/quota.mjs'
import { quotaFile } from '../../lib/key.mjs'

const at = Date.parse('2026-01-01T12:00:00.000Z')
const accountKey = 'a'.repeat(64)
const ok = { v: 1, status: 'ok', accountKey, weekly: { percentUsed: 42, resetsAt: '2026-01-02T12:00:00.000Z' }, blocked: false }
const endpoint = 'http://localhost:8080/v1'
const selection = { sourceId: 'external-quota', endpoint }
function fixture(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir }
const setup = (home, result = ok) => configureQuota(home, endpoint, 'adapter', { now: () => at, run: async () => result })
const node = (source) => `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`

test('setup requires success, preserves working settings on failure and accepts blocked success', async (t) => {
  const home = fixture(t)
  await setup(home)
  const before = readQuotaState(home)
  for (const status of ['refused', 'unavailable']) {
    const result = await configureQuota(home, endpoint, 'bad', { now: () => at, run: async () => ({ v: 1, status, code: 'auth' }) })
    assert.equal(result.ok, false)
    assert.deepEqual(readQuotaState(home), before)
  }
  assert.equal((await configureQuota(home, 'https://user:secret@host', 'bad')).code, 'invalid-endpoint')
  assert.equal((await setup(home, { ...ok, blocked: true })).ok, true)
  assert.notEqual(readQuotaState(home).revision, before.revision)
})

test('endpoint replacement cannot lend another source allowance to an existing selection', async (t) => {
  const home = fixture(t)
  await setup(home, { ...ok, weekly: { ...ok.weekly, percentUsed: 95 } })
  const selected = selectQuota(endpoint, readQuotaState(home))
  assert.equal(evaluateQuota(selected, readQuotaState(home), at, 80).hold, true)
  const lower = { ...ok, accountKey: 'b'.repeat(64), weekly: { ...ok.weekly, percentUsed: 10 } }
  const before = readQuotaState(home).revision
  await configureQuota(home, 'https://other.example/v1', 'adapter', { now: () => at, run: async () => lower })
  const mismatched = evaluateQuota(selected, readQuotaState(home), at, 80)
  assert.equal(mismatched.hold, true)
  for (const field of ['accountKey', 'requestId', 'percentUsed', 'historical']) assert.equal(mismatched[field], undefined)
  await configureQuota(home, endpoint, 'adapter', { now: () => at, run: async () => lower })
  assert.notEqual(readQuotaState(home).revision, before)
  assert.equal(evaluateQuota(selected, readQuotaState(home), at, 80).hold, false)
})

test('shared claims throttle across windows and fence late refreshes through replacement and off ABA', async (t) => {
  const home = fixture(t)
  await setup(home)
  assert.equal(await claimRefresh(home, at + 299999), null)
  const claims = await Promise.all(Array.from({ length: 8 }, () => claimRefresh(home, at + 300000)))
  const claim = claims.find(Boolean)
  assert.equal(claims.filter(Boolean).length, 1)
  assert.equal(await claimRefresh(home, at + 300001), null)
  assert.equal(await recordQuotaResult(home, { ...claim, requestId: 'wrong' }, ok, at + 300010), false)
  assert.equal(await recordQuotaResult(home, claim, ok, at + 300010), true)
  assert.equal(await recordQuotaResult(home, claim, { ...ok, blocked: true }, at + 300011), false)
  const lost = await claimRefresh(home, at + 600000)
  const old = await claimRefresh(home, at + 900000)
  assert.equal(await recordQuotaResult(home, lost, ok, at + 900001), false)
  await disableQuota(home)
  assert.equal(readQuotaState(home).enabled, false)
  await setup(home)
  assert.equal(await recordQuotaResult(home, old, { ...ok, blocked: true }, at + 600001), false)
  assert.equal(readQuotaState(home).cache.result.blocked, false)
})

test('off and newer setup invalidate pending setup without losing active state', async (t) => {
  const home = fixture(t)
  await setup(home)
  let release, started
  const entered = new Promise((r) => { started = r })
  const pending = configureQuota(home, endpoint, 'slow', { now: () => at, run: () => { started(); return new Promise((r) => { release = r }) } })
  await entered
  await disableQuota(home)
  release(ok)
  assert.equal((await pending).code, 'superseded')
  assert.equal(readQuotaState(home).enabled, false)
  let release2, started2
  const entered2 = new Promise((r) => { started2 = r })
  const older = configureQuota(home, endpoint, 'same', { now: () => at, run: () => { started2(); return new Promise((r) => { release2 = r }) } })
  await entered2
  assert.equal((await setup(home)).ok, true)
  release2(ok)
  assert.equal((await older).code, 'superseded')
  assert.equal(readQuotaState(home).command, 'adapter')
})

test('failed attempts hold immediately and history never crosses accounts or reset windows', async (t) => {
  const home = fixture(t)
  await setup(home)
  const claim = await claimRefresh(home, at + 300000)
  await recordQuotaResult(home, claim, { v: 1, status: 'unavailable', code: 'network' }, at + 300001)
  let view = evaluateQuota(selection, readQuotaState(home), at + 300002, 80)
  assert.equal(view.hold, true)
  assert.equal(view.historical.percentUsed, 42)
  const next = await claimRefresh(home, at + 600000)
  await recordQuotaResult(home, next, { v: 1, status: 'refused', code: 'provider-refused', accountKey: 'b'.repeat(64) }, at + 600001)
  assert.equal(readQuotaState(home).cache.lastGood, undefined)
  assert.equal(evaluateQuota(selection, readQuotaState(home), at + 600002, 80).historical, undefined)
  const newer = await claimRefresh(home, at + 900000)
  const reset = { ...ok, weekly: { percentUsed: 5, resetsAt: '2026-01-03T12:00:00.000Z' } }
  await recordQuotaResult(home, newer, reset, at + 900001)
  assert.deepEqual(readQuotaState(home).cache.result, reset)
})

test('observed account rotation discards history even when the new weekly data is invalid', async (t) => {
  for (const result of [{ v: 1, status: 'unavailable', code: 'account-changed' }, { ...ok, accountKey: 'b'.repeat(64), weekly: null }]) {
    const home = fixture(t)
    await setup(home)
    const claim = await claimRefresh(home, at + 300000)
    await recordQuotaResult(home, claim, result, at + 300001)
    assert.equal(readQuotaState(home).cache.lastGood, undefined)
    assert.equal(evaluateQuota(selection, readQuotaState(home), at + 300002, 80).hold, true)
  }
})

test('a failed runner is stored only as a generic code, never its output', async (t) => {
  const home = fixture(t)
  await setup(home)
  assert.equal(await refreshQuota(home, { now: () => at + 300000, run: async () => { throw new Error('credential-secret') } }), true)
  assert.equal(readQuotaState(home).cache.result.code, 'command-failed')
  assert.equal(fs.readFileSync(quotaFile(home), 'utf8').includes('credential-secret'), false)
})

test('an interrupted empty lock does not prevent disabling the source', async (t) => {
  const home = fixture(t)
  await setup(home)
  fs.mkdirSync(`${quotaFile(home)}.lock`)
  assert.deepEqual(await disableQuota(home), { ok: true })
  assert.equal(readQuotaState(home).enabled, false)
})

for (const phase of ['preparation', 'release']) test(`abandoned directories from ${phase} are reclaimed without touching live contenders or unrelated paths`, async (t) => {
  const home = fixture(t)
  const lock = `${quotaFile(home)}.lock`
  const url = new URL('../../scripts/lib/quota-command.mjs', import.meta.url).href
  const source = `
    import fs from 'node:fs'
    import { disableQuota } from ${JSON.stringify(url)}
    const lock = ${JSON.stringify(lock)}
    const mkdir = fs.mkdirSync
    fs.mkdirSync = (target, ...args) => {
      const value = mkdir(target, ...args)
      if (${JSON.stringify(phase)} === 'preparation' && String(target).startsWith(lock + '.')) process.kill(process.pid, 'SIGKILL')
      return value
    }
    const rename = fs.renameSync
    fs.renameSync = (from, to) => {
      const value = rename(from, to)
      if (${JSON.stringify(phase)} === 'release' && from === lock && String(to).startsWith(lock + '.')) process.kill(process.pid, 'SIGKILL')
      return value
    }
    await disableQuota(${JSON.stringify(home)})
  `
  await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], { timeout: 30000 }), { signal: 'SIGKILL' })
  const prefix = path.basename(lock) + '.'
  const leftovers = fs.readdirSync(home).filter((name) => name.startsWith(prefix))
  assert.equal(leftovers.length, 1)
  const deadPid = leftovers[0].slice(prefix.length).split('-')[0]
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const live = [1, 2].map((n) => `${lock}.${process.pid}-${uuid(n)}`)
  for (const dir of live) fs.mkdirSync(dir)
  fs.writeFileSync(`${live[1]}/${process.pid}-${uuid(2)}`, '')
  const unrelated = `${lock}.notes`
  fs.mkdirSync(unrelated)
  const unexpected = `${lock}.${deadPid}-${uuid(3)}`
  fs.mkdirSync(unexpected)
  fs.writeFileSync(`${unexpected}/keep`, 'unrelated')
  const target = fixture(t)
  fs.writeFileSync(`${target}/${deadPid}-${uuid(4)}`, 'keep')
  const link = `${lock}.${deadPid}-${uuid(4)}`
  fs.symlinkSync(target, link, 'dir')

  assert.deepEqual(await disableQuota(home), { ok: true })
  assert.equal(fs.existsSync(path.join(home, leftovers[0])), false)
  for (const dir of [...live, unrelated, unexpected]) assert.equal(fs.existsSync(dir), true)
  assert.equal(fs.readFileSync(`${unexpected}/keep`, 'utf8'), 'unrelated')
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true)
  assert.equal(fs.readFileSync(`${target}/${deadPid}-${uuid(4)}`, 'utf8'), 'keep')
})

test('dead-owned quota commit files are reclaimed without touching live, symlink or unrelated paths', async (t) => {
  const home = fixture(t)
  const file = quotaFile(home)
  const url = new URL('../../scripts/lib/quota-command.mjs', import.meta.url).href
  const source = `
    import fs from 'node:fs'
    import { disableQuota } from ${JSON.stringify(url)}
    const write = fs.writeFileSync
    fs.writeFileSync = (target, ...args) => {
      const value = write(target, ...args)
      if (String(target).startsWith(${JSON.stringify(file + '.')}) && String(target).endsWith('.tmp')) process.kill(process.pid, 'SIGKILL')
      return value
    }
    await disableQuota(${JSON.stringify(home)})
  `
  await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], { timeout: 30000 }), { signal: 'SIGKILL' })
  const leaked = fs.readdirSync(home).find((name) => name.endsWith('.tmp'))
  assert.ok(leaked)
  const deadPid = leaked.slice(path.basename(file).length + 1).split('.')[0]
  const uuid = '00000000-0000-4000-8000-000000000001'
  const live = `${file}.${process.pid}.${uuid}.tmp`
  const unrelated = `${home}/other.json.${deadPid}.${uuid}.tmp`
  const malformed = `${file}.${deadPid}.not-a-uuid.tmp`
  for (const name of [live, unrelated, malformed]) fs.writeFileSync(name, 'keep')
  const target = path.join(home, 'target')
  fs.writeFileSync(target, 'keep')
  const link = `${file}.${deadPid}.${uuid}.tmp`
  fs.symlinkSync(target, link)
  const directory = `${file}.${deadPid}.00000000-0000-4000-8000-000000000002.tmp`
  fs.mkdirSync(directory)
  assert.deepEqual(await disableQuota(home), { ok: true })
  assert.equal(fs.existsSync(path.join(home, leaked)), false)
  for (const name of [live, unrelated, malformed, target]) assert.equal(fs.readFileSync(name, 'utf8'), 'keep')
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true)
  assert.equal(fs.lstatSync(directory).isDirectory(), true)
})

test('the adapter group remains bounded when its runner is killed abruptly', async (t) => {
  const home = fixture(t)
  const pidFile = path.join(home, 'adapter-pids')
  const runnerFile = new URL('../../scripts/quota-refresh.mjs', import.meta.url).pathname
  const adapter = `const fs=require('node:fs'); const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,c.pid])); setInterval(()=>{},1000)`
  const command = node(adapter)
  assert.equal((await configureQuota(home, endpoint, command, { now: () => at, run: async () => ok })).ok, true)
  let pids = []
  let timer
  let watcher
  const ready = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('adapter did not start')), 30000)
    // Polled, not fs.watch: macOS can drop the one event the pid file makes under load.
    watcher = setInterval(() => {
      try {
        pids = JSON.parse(fs.readFileSync(pidFile, 'utf8'))
        if (pids.length === 2) resolve()
      } catch {}
    }, 20)
  })
  const runner = spawn(process.execPath, [runnerFile], { stdio: 'ignore', env: { ...process.env, LCW_HOME: home, LCW_NOW: String(at + 300000) } })
  t.after(() => {
    clearTimeout(timer)
    clearInterval(watcher)
    try { runner.kill('SIGKILL') } catch {}
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL') } catch {} }
  })
  await ready
  clearTimeout(timer)
  clearInterval(watcher)
  const exited = once(runner, 'exit', { signal: AbortSignal.timeout(10000) })
  runner.kill('SIGKILL')
  await exited
  const running = (pid) => {
    try { return !/^Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'Z') } catch (e) { return e.status !== 1 }
  }
  const until = Date.now() + 20000
  while (pids.some(running) && Date.now() < until) await new Promise((r) => setTimeout(r, 20))
  assert.equal(pids.some(running), false)
})

test('real separate processes serialize claims for the same revision', async (t) => {
  const home = fixture(t)
  await setup(home)
  const url = new URL('../../scripts/lib/quota-command.mjs', import.meta.url).href
  const source = `import { claimRefresh } from ${JSON.stringify(url)}; console.log(JSON.stringify(await claimRefresh(process.argv[1], ${at + 300000})))`
  fs.mkdirSync(`${quotaFile(home)}.lock`)
  const results = await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', source, home])))
  assert.equal(results.map((r) => JSON.parse(r.stdout)).filter(Boolean).length, 1)
})

test('the background entry point refreshes using the same clock and quota state', async (t) => {
  const home = fixture(t)
  const command = node(`process.stdout.write(${JSON.stringify(JSON.stringify(ok))})`)
  assert.equal((await configureQuota(home, endpoint, command, { now: () => at })).ok, true)
  const before = readQuotaState(home).cache.requestId
  const runner = new URL('../../scripts/quota-refresh.mjs', import.meta.url)
  await promisify(execFile)(process.execPath, [runner.pathname], { env: { ...process.env, LCW_HOME: home, LCW_NOW: String(at + 300000) }, timeout: 30000 })
  const state = readQuotaState(home)
  assert.notEqual(state.cache.requestId, before)
  assert.equal(state.cache.result.status, 'ok')
  assert.equal(state.cache.attemptedAt, at + 300000)
})

test('runner bounds output and time without disclosing stdout or stderr', async () => {
  assert.deepEqual(await runQuotaCommand(node(`process.stdout.write(${JSON.stringify(JSON.stringify(ok))})`), { now: () => at }), ok)
  for (const source of ["process.stdout.write('credential-secret'); process.stderr.write('private-error'); process.exitCode=7", "process.stdout.write('x'.repeat(100000))", `process.stderr.write('x'.repeat(100000)); process.stdout.write(${JSON.stringify(JSON.stringify(ok))})`]) {
    const result = await runQuotaCommand(node(source), { now: () => at })
    assert.equal(result.status, 'unavailable')
    assert.equal(JSON.stringify(result).includes('secret'), false)
  }
  const result = await runQuotaCommand(node('setInterval(() => {}, 1000)'), { timeoutMs: 40, now: () => at })
  assert.equal(result.code, 'timeout')
})

test('runner kills descendants even when the shell exits with inherited pipes still open', async (t) => {
  const dir = fixture(t)
  const pidFile = path.join(dir, 'pid')
  const source = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid)); process.stdout.write(${JSON.stringify(JSON.stringify(ok))}); c.unref()`
  const result = await runQuotaCommand(node(source), { now: () => at, timeoutMs: 20000 })
  assert.equal(result.status, 'ok')
  const pid = Number(fs.readFileSync(pidFile, 'utf8'))
  const running = () => {
    try { return !/^Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'Z') } catch (e) { return e.status !== 1 }
  }
  const until = Date.now() + 20000
  while (running() && Date.now() < until) await new Promise((r) => setTimeout(r, 20))
  assert.equal(running(), false)
})

// The command line itself, in this process through the CLI's main().
const dollarSource = 'dollar-source'
const nativeSource = 'native-source'

/** A home under a folder removed when the test ends, with the options that run the CLI in it at the fixed time. */
function cliHome(t, files = {}) {
  const dir = fixture(t)
  const home = path.join(dir, '.lcw')
  fs.mkdirSync(home)
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(home, name), body)
  const opts = { home, cwd: dir, env: { LCW_NOW: String(at) } }
  return { home, run: (...args) => cli(args, opts) }
}

test('quota command configures, inspects and disables independently of dollars and native cache', async (t) => {
  const { home, run } = cliHome(t, { 'spend-command.json': dollarSource, 'usage.json': nativeSource })
  const command = node(`process.stdout.write(${JSON.stringify(JSON.stringify(ok))})`)
  const unset = await run('quota-command')
  assert.equal(unset.code, 0)
  assert.equal((await run('quota-command', 'http://localhost:8080/v1', 'printf credential-secret')).code, 1)
  assert.equal(fs.existsSync(path.join(home, 'quota-command.json')), false)
  assert.equal((await run('quota-command')).out, unset.out)
  const set = await run('quota-command', 'http://LOCALHOST:8080/v1/', command, '--session', 'test-session')
  assert.equal(set.code, 0, set.out)
  const state = JSON.parse(fs.readFileSync(path.join(home, 'quota-command.json'), 'utf8'))
  assert.equal(state.endpoint, 'http://localhost:8080/v1')
  assert.equal(state.command, command)
  const inspect = await run('quota-command')
  assert.match(inspect.out, /42%/)
  assert.match(inspect.out, /http:\/\/localhost:8080\/v1/)
  assert.equal(inspect.out.includes(command), false)
  const bad = await run('quota-command', 'http://localhost:8080/v1', 'printf credential-secret')
  assert.equal(bad.code, 1)
  assert.equal(bad.out.includes('credential-secret'), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'quota-command.json'), 'utf8')).revision, state.revision)
  assert.equal((await run('quota-command', 'off')).code, 0)
  const off = JSON.parse(fs.readFileSync(path.join(home, 'quota-command.json'), 'utf8'))
  assert.equal(off.enabled, false)
  assert.notEqual(off.revision, state.revision)
  assert.equal(fs.readFileSync(path.join(home, 'spend-command.json'), 'utf8'), dollarSource)
  assert.equal(fs.readFileSync(path.join(home, 'usage.json'), 'utf8'), nativeSource)
  assert.match((await run('help')).out, /quota-command/)
})

test('a quota file holding only the id of an interrupted setup reads as no command set', async (t) => {
  const { run } = cliHome(t, { 'quota-command.json': JSON.stringify({ setupRequestId: 'abc' }) })
  const r = await run('quota-command')
  assert.equal(r.code, 0)
  assert.match(r.out, /No external quota command set\./)
})

test('a quota file that names an endpoint but is not usable still says new work is held', async (t) => {
  const { run } = cliHome(t, { 'quota-command.json': JSON.stringify({ endpoint: 'http://localhost:8080/v1', setupRequestId: 'abc' }) })
  const r = await run('quota-command')
  assert.equal(r.code, 0)
  assert.match(r.out, /http:\/\/localhost:8080\/v1.*new work held/)
})
