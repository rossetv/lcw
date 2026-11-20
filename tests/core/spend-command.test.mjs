import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { tmp, CLI } from './helpers.mjs' // first: it points HOME at a throwaway folder
import {
  parseFigure, runCommand, readSetting, writeSetting, clearSetting, readReading, recordResult, claimWindow, maybeRefresh,
} from '../../scripts/lib/spend-command.mjs'
import { spendCommandFile, spendReadingFile, spendTryFile } from '../../lib/key.mjs'

const MOD = new URL('../../scripts/lib/spend-command.mjs', import.meta.url).href
const RUNNER = fileURLToPath(new URL('../../scripts/spend-refresh.mjs', import.meta.url))
const T0 = 1795000000000 // a fixed "now", in November 2026
const WINDOW = Math.floor(T0 / 300000)

test('parseFigure accepts one non-negative amount, with an optional $ and thousands commas', () => {
  for (const [text, usd] of [['1240', 1240], ['$1,240.55\n', 1240.55], ['  12,345,678 ', 12345678], ['0', 0], ['\n\n7.5\n', 7.5]]) {
    assert.equal(parseFigure(text), usd, text)
  }
})

test('parseFigure refuses anything else', () => {
  for (const text of ['', '  \n', '12\n34', '-5', '+5', 'about 12', '12 USD', '1,24', '1,2345', '$', '1.2.3', '1.', '.5', '9'.repeat(400)]) {
    assert.equal(parseFigure(text), null, JSON.stringify(text))
  }
})

test('a figure printed with exit 0 is a good reading', async () => {
  assert.deepEqual(await runCommand('echo 1,240.50'), { ok: true, usd: 1240.5 })
})

test('a figure with a non-zero exit names both what it printed and the exit code', async () => {
  assert.deepEqual(await runCommand('echo 1240; exit 3'), { ok: false, error: 'printed "1240" and exited with code 3' })
  assert.deepEqual(await runCommand('echo 5 >&2; exit 3'), { ok: false, error: 'printed "5" and exited with code 3' })
  assert.deepEqual(await runCommand('echo five >&2; exit 3'), { ok: false, error: 'printed "five"' })
})

test('colour codes are dropped and other control characters become single spaces', async () => {
  assert.deepEqual(await runCommand("printf '\\033[31mERR\\033[0m'"), { ok: false, error: 'printed "ERR"' })
  assert.deepEqual(await runCommand("printf 'a\\rb\\t\\tc\\177d'"), { ok: false, error: 'printed "a b c d"' })
})

test('the cut never lands inside an escape code or a surrogate pair', async () => {
  let r = await runCommand(`printf '${'x'.repeat(70)}\\033[31;1mred${'y'.repeat(20)}'`)
  assert.equal(r.error, `printed "${'x'.repeat(70)}red${'y'.repeat(6)}…"`)
  r = await runCommand(`printf '${'x'.repeat(78)}\\360\\237\\230\\200\\360\\237\\230\\200\\360\\237\\230\\200'`)
  assert.equal(r.error, `printed "${'x'.repeat(78)}😀…"`)
  assert.doesNotMatch(r.error, /[\ud800-\udfff]/u)
})

test('several lines are all quoted, joined by a space', async () => {
  assert.deepEqual(await runCommand('printf "12\\n34\\n"'), { ok: false, error: 'printed "12 34"' })
  assert.deepEqual(await runCommand('echo Traceback; echo ValueError >&2; exit 1'), { ok: false, error: 'printed "Traceback"' }, 'stdout wins over stderr')
})

test('output that is not a figure is quoted, whatever the exit code', async () => {
  assert.deepEqual(await runCommand('echo 401 Unauthorized; exit 1'), { ok: false, error: 'printed "401 Unauthorized"' })
  assert.deepEqual(await runCommand('echo; echo "  not yet  "'), { ok: false, error: 'printed "not yet"' })
})

test('stderr is quoted, lines joined, when stdout is empty', async () => {
  assert.deepEqual(await runCommand('echo token expired >&2; exit 2'), { ok: false, error: 'printed "token expired"' })
  assert.deepEqual(await runCommand('echo Traceback >&2; echo "  ValueError: no key " >&2; exit 1'), { ok: false, error: 'printed "Traceback ValueError: no key"' })
})

test('a command that prints nothing says so, with its exit code when it is not 0', async () => {
  assert.deepEqual(await runCommand('true'), { ok: false, error: 'printed nothing' })
  assert.deepEqual(await runCommand('echo; exit 4'), { ok: false, error: 'printed nothing and exited with code 4' })
})

test('long output is cut to 80 characters, ending with an ellipsis', async () => {
  const r = await runCommand(`echo ${'x'.repeat(200)}`)
  const quoted = /^printed "(.*)"$/.exec(r.error)[1]
  assert.equal(quoted.length, 80)
  assert.ok(quoted.endsWith('…'))
})

test('a command that reads stdin does not hang', async () => {
  assert.deepEqual(await runCommand('cat; echo 3', { timeoutMs: 2000 }), { ok: true, usd: 3 })
})

test('the command runs from the home folder', async () => {
  const r = await runCommand('[ "$(pwd -P)" = "$(cd "$HOME" && pwd -P)" ] && echo 1')
  assert.deepEqual(r, { ok: true, usd: 1 })
})

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const alive = (pid) => Number.isInteger(pid) && pid > 0 && (() => { try { process.kill(pid, 0); return true } catch { return false } })()
/** The pid the command wrote, once the file holds one (within 2 seconds); else null, so no one signals pid 0 or a junk pid. */
const readPid = async (file) => {
  const deadline = Date.now() + 2000
  for (;;) {
    let pid = NaN
    try { pid = Number(fs.readFileSync(file, 'utf8')) } catch {}
    if ((Number.isInteger(pid) && pid > 0) || Date.now() > deadline) return Number.isInteger(pid) && pid > 0 ? pid : null
    await sleep(10)
  }
}
const killPid = (pid) => { if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL') } catch {} } }
/** True once the process is gone, within 2 seconds. */
const goneSoon = async (pid) => {
  const deadline = Date.now() + 2000
  while (alive(pid) && Date.now() < deadline) await sleep(20)
  return !alive(pid)
}

test('a timeout kills everything the command started, and says how long it waited', async () => {
  const dir = tmp('spend-timeout')
  const t = Date.now()
  const r = await runCommand(`sleep 30 & echo $! > ${dir}/pid; sleep 30`, { timeoutMs: 1000 })
  assert.ok(Date.now() - t < 2000, 'resolved at the timeout')
  assert.deepEqual(r, { ok: false, error: 'took longer than 1 second' })
  const pid = await readPid(`${dir}/pid`)
  try { assert.ok(pid, 'the command wrote its background pid'); assert.equal(await goneSoon(pid), true, 'the background sleep was killed') } finally { killPid(pid) }
})

test('a command that leaves a child holding its output still gives its figure, and the child is killed', async () => {
  const dir = tmp('spend-leftover')
  const t = Date.now()
  const r = await runCommand(`sleep 30 & echo $! > ${dir}/pid; echo 5`, { timeoutMs: 1500 })
  assert.ok(Date.now() - t < 1000, 'settled at the exit, not at the timeout')
  assert.deepEqual(r, { ok: true, usd: 5 })
  const pid = await readPid(`${dir}/pid`)
  try { assert.ok(pid, 'the command wrote its background pid'); assert.equal(await goneSoon(pid), true, 'the leftover sleep was killed') } finally { killPid(pid) }
})

test('a command that exits with a figure just before the timeout is not reported as a timeout', async () => {
  // The timeout falls inside the wait for the output of a leftover child to drain.
  assert.deepEqual(await runCommand('sleep 30 & echo 5', { timeoutMs: 400 }), { ok: true, usd: 5 })
})

test('a process left behind after a normal exit is killed too', async () => {
  const dir = tmp('spend-normal')
  const r = await runCommand(`sleep 30 >/dev/null 2>&1 & echo $! > ${dir}/pid; echo 6`)
  assert.deepEqual(r, { ok: true, usd: 6 })
  const pid = await readPid(`${dir}/pid`)
  try { assert.ok(pid, 'the command wrote its background pid'); assert.equal(await goneSoon(pid), true, 'the leftover sleep was killed') } finally { killPid(pid) }
})

/** A home with a setting for `command`. */
const homeWith = (command) => {
  const home = tmp('spend-home')
  if (command) writeSetting(home, command, T0 - 1)
  return home
}

test('readSetting and clearSetting: a missing or broken file is no setting, and clearing removes the reading too', () => {
  const home = homeWith(null)
  assert.equal(readSetting(home), null)
  fs.writeFileSync(spendCommandFile(home), '{"v":1,"command":')
  assert.equal(readSetting(home), null)
  writeSetting(home, 'echo 5', T0)
  assert.deepEqual(readSetting(home), { command: 'echo 5', setAt: T0 })
  recordResult(home, 'echo 5', { ok: true, usd: 5 }, T0)
  clearSetting(home)
  assert.equal(readSetting(home), null)
  assert.equal(fs.existsSync(spendReadingFile(home)), false)
  clearSetting(home) // twice is fine
})

test('a good run saves the figure at the time the command started', () => {
  const home = homeWith('echo 1240')
  assert.equal(recordResult(home, 'echo 1240', { ok: true, usd: 1240 }, T0), true)
  assert.deepEqual(readReading(home), {
    v: 1, command: 'echo 1240', usd: 1240, at: T0, fails: 0, failingSince: null, lastError: null, triedAt: T0,
  })
})

test('failures keep the last good figure and count the streak from its first failure', () => {
  const home = homeWith('get-spend')
  recordResult(home, 'get-spend', { ok: true, usd: 900 }, T0)
  recordResult(home, 'get-spend', { ok: false, error: 'printed nothing' }, T0 + 1000)
  recordResult(home, 'get-spend', { ok: false, error: 'exited with code 2' }, T0 + 2000)
  assert.deepEqual(readReading(home), {
    v: 1, command: 'get-spend', usd: 900, at: T0, fails: 2, failingSince: T0 + 1000, lastError: 'exited with code 2', triedAt: T0 + 2000,
  })
  recordResult(home, 'get-spend', { ok: true, usd: 950 }, T0 + 3000)
  recordResult(home, 'get-spend', { ok: false, error: 'printed nothing' }, T0 + 4000)
  const r = readReading(home)
  assert.equal(r.fails, 1)
  assert.equal(r.failingSince, T0 + 4000)
  assert.equal(r.usd, 950)
})

test('a failure with no good reading yet has no figure', () => {
  const home = homeWith('get-spend')
  recordResult(home, 'get-spend', { ok: false, error: 'printed nothing' }, T0)
  const r = readReading(home)
  assert.equal(r.usd, null)
  assert.equal(r.at, null)
  assert.equal(r.fails, 1)
})

test('a result for a command that was changed or removed meanwhile is not saved', () => {
  const home = homeWith('new-cmd')
  assert.equal(recordResult(home, 'old-cmd', { ok: true, usd: 1 }, T0), false)
  assert.equal(readReading(home), null)
  clearSetting(home)
  assert.equal(recordResult(home, 'new-cmd', { ok: true, usd: 1 }, T0), false)
  assert.equal(readReading(home), null)
})

test('a new command starts from a blank reading', () => {
  const home = homeWith('old-cmd')
  recordResult(home, 'old-cmd', { ok: true, usd: 700 }, T0)
  recordResult(home, 'old-cmd', { ok: false, error: 'printed nothing' }, T0 + 1)
  writeSetting(home, 'new-cmd', T0 + 2)
  recordResult(home, 'new-cmd', { ok: false, error: 'printed "no"' }, T0 + 3)
  assert.deepEqual(readReading(home), {
    v: 1, command: 'new-cmd', usd: null, at: null, fails: 1, failingSince: T0 + 3, lastError: 'printed "no"', triedAt: T0 + 3,
  })
})

test('a window is claimed once, and the next window can be claimed again', () => {
  const home = homeWith(null)
  assert.equal(claimWindow(home, T0), true)
  assert.equal(claimWindow(home, T0 + 1000), false)
  assert.equal(claimWindow(home, T0 + 300000), true)
})

test('processes racing for one window get exactly one winner', async () => {
  const home = homeWith(null)
  const code = `import { claimWindow } from '${MOD}'; process.stdout.write(String(claimWindow(process.argv[1], ${T0})))`
  const outs = await Promise.all(Array.from({ length: 6 }, () => new Promise((done) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code, home])
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.on('close', () => done(out))
  })))
  assert.deepEqual(outs.sort(), ['false', 'false', 'false', 'false', 'false', 'true'])
})

/** Calls maybeRefresh from its own process, standing at T0, as a status line would. */
const tick = (home) => {
  const code = `import { maybeRefresh } from '${MOD}'; maybeRefresh(process.env.LCW_HOME, Number(process.env.LCW_NOW))`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, LCW_HOME: home, LCW_NOW: String(T0) } })
  assert.equal(r.status, 0)
}

test('a tick starts the runner, which saves the reading and deletes the old locks', async () => {
  const home = homeWith('echo 1240')
  fs.mkdirSync(`${home}/cache`, { recursive: true })
  for (const n of [3, WINDOW - 1]) fs.writeFileSync(spendTryFile(home, n), '')
  tick(home)
  const deadline = Date.now() + 5000
  while (!readReading(home) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 25))
  assert.deepEqual(readReading(home), {
    v: 1, command: 'echo 1240', usd: 1240, at: T0, fails: 0, failingSince: null, lastError: null, triedAt: T0,
  })
  assert.deepEqual(fs.readdirSync(`${home}/cache`), [`spend-try-${WINDOW}`])
})

/** Every process below `root`, as `ps` shows the tree: what Claude Code walks when it cancels a status-line run. */
const descendants = (root) => {
  const kids = new Map()
  for (const line of spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (pid) kids.set(ppid, [...(kids.get(ppid) || []), pid])
  }
  const found = []
  for (const queue = [root]; queue.length;) {
    for (const pid of kids.get(queue.shift()) || []) { found.push(pid); queue.push(pid) }
  }
  return found
}

test('the refresh survives Claude Code killing the status line and all its descendants', async () => {
  const marker = `${tmp('spend-hop')}/started`
  const home = homeWith(`echo $$ > ${marker}; sleep 1; echo 1240`)
  const code = `import { maybeRefresh } from '${MOD}'; maybeRefresh(process.env.LCW_HOME, Number(process.env.LCW_NOW)); setTimeout(() => {}, 10000)`
  const statusLine = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, LCW_HOME: home, LCW_NOW: String(T0) }, stdio: 'ignore',
  })
  try {
    // Once the command is running, the launcher is long gone; then do what Claude Code does on a cancel.
    let deadline = Date.now() + 5000
    while (!fs.existsSync(marker) && Date.now() < deadline) await sleep(20)
    assert.ok(fs.existsSync(marker), 'the command started')
    for (const pid of descendants(statusLine.pid)) { try { process.kill(pid, 'SIGKILL') } catch {} }
    statusLine.kill('SIGKILL')
    deadline = Date.now() + 5000
    while (!readReading(home) && Date.now() < deadline) await sleep(25)
    assert.equal(readReading(home)?.usd, 1240)
  } finally {
    statusLine.kill('SIGKILL')
  }
})

test('with no command set, a tick starts nothing', () => {
  const home = homeWith(null)
  maybeRefresh(home, T0)
  assert.equal(fs.existsSync(`${home}/cache`), false)
})

/** Waits for `fn()` to be true, within 5 seconds. */
const until = async (fn) => {
  const deadline = Date.now() + 5000
  while (!fn() && Date.now() < deadline) await sleep(20)
  return fn()
}

/** Starts `argv`, waits for the command below it to have its shell, a child and a grandchild up, signals it, and returns what is left. */
async function interrupt(argv, env, signal, pidFile) {
  const proc = spawn(process.execPath, argv, { env: { ...process.env, ...env }, stdio: 'ignore' })
  const ended = new Promise((done) => proc.on('close', (code, sig) => done({ code, sig })))
  try {
    // The command writes the pids of its two sleeps, whatever shell runs it; the rest is found below lcw.
    const pids = () => (fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').split(/\s+/).filter(Boolean).map(Number) : [])
    assert.ok(await until(() => pids().length >= 2), 'the command and its children started')
    const group = [...new Set([...descendants(proc.pid), ...pids()])]
    proc.kill(signal)
    const result = await ended
    const left = []
    for (const pid of group) if (!(await goneSoon(pid))) left.push(pid)
    for (const pid of left) killPid(pid)
    return { result, left }
  } finally {
    proc.kill('SIGKILL')
  }
}

/** A command that leaves a child and a grandchild sleeping, and writes their pids to `file`. */
const hangs = (file) => `sh -c "sleep 60 & echo \\$! >> ${file}; wait" & sleep 60 & echo $! >> ${file}; wait`

test('Ctrl-C to lcw spend-command stops the command and everything it started, and saves nothing', async () => {
  const home = tmp('spend-sigint')
  const pidFile = `${home}/pids`
  const { result, left } = await interrupt([CLI, 'spend-command', hangs(pidFile)], { LCW_HOME: home }, 'SIGINT', pidFile)
  assert.deepEqual(left, [], 'nothing of the command is left')
  assert.equal(result.sig, 'SIGINT', 'lcw ends as it would have without the handler')
  assert.deepEqual(fs.readdirSync(home).filter((f) => f.startsWith('spend-')), [])
})

test('the runner stopped with SIGTERM stops the command and everything it started', async () => {
  const pidFile = `${tmp('spend-pids')}/pids`
  const home = homeWith(hangs(pidFile))
  const { result, left } = await interrupt([RUNNER], { LCW_HOME: home, LCW_NOW: String(T0) }, 'SIGTERM', pidFile)
  assert.deepEqual(left, [], 'nothing of the command is left')
  assert.equal(result.sig, 'SIGTERM')
  assert.equal(readReading(home), null, 'an interrupted run records nothing')
})

test('the signal handlers are gone once a run settles', async () => {
  const count = () => ['SIGINT', 'SIGTERM', 'SIGHUP'].map((s) => process.listenerCount(s))
  const before = count()
  await runCommand('echo 1')
  await runCommand('true')
  assert.deepEqual(count(), before)
})
