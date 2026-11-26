import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmp, readJson, started, fakeClaude, CLI } from './helpers.mjs'
import { othersHold, canHold, startHold } from '../../scripts/lib/awake.mjs'

// What `pmset -g assertions` printed on a Mac: macOS's own holders, Claude Code's 5-minute caffeinate holds, Amphetamine.
const OWN = `Listed by owning process:
   pid 72152(caffeinate): [0x000a8e060001872c] 00:02:59 PreventUserIdleSystemSleep named: "caffeinate command-line tool"  
\tDetails: caffeinate asserting for 300 secs
\tLocalized=THE CAFFEINATE TOOL IS PREVENTING SLEEP.
\tTimeout will fire in 121 secs Action=TimeoutActionRelease
   pid 358(powerd): [0x0009c2ac000183e1] 14:30:37 PreventUserIdleSystemSleep named: "Powerd - Prevent sleep while display is on"  
   pid 705(sharingd): [0x000a8b270001866d] 00:15:14 PreventUserIdleSystemSleep named: "Handoff"  
   pid 22780(Amphetamine): [0x000a415f00059b18] 05:30:02 PreventUserIdleDisplaySleep named: "Amphetamine (Single-Use - Display)"  
`
// a hold that lasts until a process exits, as LCW's own does
const WAITING = `   pid 95052(caffeinate): [0x000a8ed600018756] 00:20:00 PreventUserIdleSystemSleep named: "caffeinate command-line tool"  
\tDetails: caffeinate asserting on behalf of Process ID 95050
\tCreated for PID: 95050. 
`
const AMPHETAMINE = '   pid 22780(Amphetamine): [0x000a415f00019b17] 05:30:02 PreventUserIdleSystemSleep named: "Amphetamine (Single-Use - System)"  \n'

test('on macOS, only a hold by something else counts: not macOS\'s own, not Claude Code\'s short ones, not ours', () => {
  assert.equal(othersHold('darwin', OWN + WAITING, 95052), false)
  assert.equal(othersHold('darwin', OWN + AMPHETAMINE + WAITING, 95052), true)
  assert.equal(othersHold('darwin', OWN + WAITING, null), true, 'a caffeinate holding until a process exits is not a short hold')
})

test('on macOS, macOS daemons and holds under a minute old do not count, a real app\'s long hold does', () => {
  const held = (who, time, kind = 'PreventUserIdleSystemSleep') => `   pid 900(${who}): [0x0001] ${time} ${kind} named: "x"  \n`
  for (const d of ['runningboardd', 'installd', 'installer', 'softwareupdated']) assert.equal(othersHold('darwin', held(d, '00:30:00'), null), false, d)
  assert.equal(othersHold('darwin', held('Amphetamine', '00:00:00'), null), false)
  assert.equal(othersHold('darwin', held('Amphetamine', '00:00:59'), null), false)
  assert.equal(othersHold('darwin', held('Amphetamine', '00:01:00'), null), true)
  assert.equal(othersHold('darwin', held('Claude', '22:56:49', 'NoIdleSleepAssertion'), null), true)
})

test('on macOS, the older NoIdleSleepAssertion name of the same hold counts', () => {
  const old = '   pid 900(Claude): [0x0001] 00:10:00 NoIdleSleepAssertion named: "Electron"  \n'
  assert.equal(othersHold('darwin', OWN + old + WAITING, 95052), true)
})

test('on Linux, only another program\'s block on idle or sleep counts', () => {
  const head = 'WHO            UID  USER PID  COMM            WHAT                    WHY                         MODE\n'
  const delay = 'ModemManager   0    root 1114 ModemManager    sleep                   ModemManager needs to reset delay\n'
  const keys = 'GNOME Shell    1000 me   2000 gsd-power       handle-lid-switch       Lid is handled              block\n'
  const ours = 'LCW            1000 me   3000 systemd-inhibit idle:sleep              LCW run demo                block\n'
  assert.equal(othersHold('linux', head + delay + keys + ours, 3000), false)
  assert.equal(othersHold('linux', head + ours, null), true)
})

// Stand-ins for caffeinate, systemd-inhibit and pmset, so no test holds off this computer's sleep. A hold waits
// for STUB_WAIT_PID (this test process) to exit, as the real one waits for Claude Code.
const stubs = tmp('stubs')
const wait = '#!/bin/sh\nwhile kill -0 "$STUB_WAIT_PID" 2>/dev/null; do sleep 0.1; done\n'
fs.writeFileSync(`${stubs}/caffeinate`, wait)
fs.writeFileSync(`${stubs}/systemd-inhibit`, `#!/bin/sh\n[ "$1" = --list ] && exec cat "$STUB_LIST"\n${wait.split('\n')[1]}\n`)
fs.writeFileSync(`${stubs}/pmset`, '#!/bin/sh\ncat "$STUB_LIST"\n')
for (const f of ['caffeinate', 'systemd-inhibit', 'pmset']) fs.chmodSync(`${stubs}/${f}`, 0o755)
fs.writeFileSync(`${stubs}/list`, process.platform === 'darwin' ? OWN : '')
Object.assign(process.env, { PATH: `${stubs}:${process.env.PATH}`, STUB_WAIT_PID: String(process.pid), STUB_LIST: `${stubs}/list` })
const host = process.platform === 'darwin' || process.platform === 'linux' ? {} : { skip: 'LCW holds off sleep only on macOS and Linux' }

const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
async function gone(pid) {
  for (let i = 0; i < 100 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50))
  return !alive(pid)
}

// A hold is kept only for a process that is Claude Code's, so each run records a stand-in one.
const claudes = []
after(() => claudes.forEach((c) => c.kill()))

function building() {
  const t = started()
  t.cli('stage', 'Build')
  const file = `${t.home}/sessions/s1.json`
  claudes.push(fakeClaude())
  fs.writeFileSync(file, JSON.stringify({ ...readJson(file), claudePid: claudes.at(-1).pid }))
  return { ...t, check: () => JSON.parse(t.cli('awake', '--check').out) }
}

test('keep awake starts a hold that outlives the command, and pausing the run ends it', host, async () => {
  const t = building()
  assert.deepEqual(t.check(), { canHold: true, heldByOther: false, kept: false })
  // a hold still tied to lcw's output or process group would keep this waiting past the timeout
  const env = { ...process.env, LCW_HOME: t.home, CLAUDE_CODE_SESSION_ID: 's1' }
  const r = spawnSync('node', [CLI, 'awake'], { cwd: t.repo, env, encoding: 'utf8', timeout: 15000 })
  assert.equal(r.status, 0, r.stdout)
  const hold = readJson(`${t.dir}/awake`)
  assert.ok(alive(hold.pid), 'the hold is still running after lcw awake returned')
  assert.deepEqual(t.check(), { canHold: true, heldByOther: false, kept: true })
  assert.equal(t.cli('awake').out.trim(), 'already kept awake')
  t.cli('pause', 'human')
  assert.ok(await gone(hold.pid))
  assert.equal(fs.existsSync(`${t.dir}/awake`), false)
  assert.equal(t.check().kept, false)
})

test('a run going back to the person ends the hold', host, async () => {
  const t = building()
  t.cli('awake')
  const hold = readJson(`${t.dir}/awake`)
  t.cli('stage', 'Brainstorm')
  assert.equal(t.state().status, 'with-you')
  assert.ok(await gone(hold.pid))
  assert.equal(fs.existsSync(`${t.dir}/awake`), false)
})

test('releasing never kills a process that only took over the hold\'s pid', host, async () => {
  const t = building()
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' })
  try {
    fs.writeFileSync(`${t.dir}/awake`, JSON.stringify({ pid: other.pid, at: 0, how: `caffeinate -i -w ${process.pid}` }))
    assert.equal(t.check().kept, false)
    t.cli('stop')
    await new Promise((r) => setTimeout(r, 100)) // long enough for a signal sent by lcw stop to land
    assert.deepEqual([other.exitCode, other.signalCode, alive(other.pid)], [null, null, true])
    assert.equal(fs.existsSync(`${t.dir}/awake`), false)
  } finally { other.kill() }
})

test('keep awake refuses without Claude Code\'s pid, or for a run that is not running', host, () => {
  const t = building()
  fs.writeFileSync(`${t.home}/sessions/s1.json`, JSON.stringify({ runDir: t.dir }))
  assert.equal(t.cli('awake').code, 1)
  const u = building()
  u.cli('pause', 'human')
  assert.equal(u.cli('awake').code, 1)
  for (const run of [t, u]) assert.equal(fs.existsSync(`${run.dir}/awake`), false)
})

test('a hold that dies at once is not reported as started', host, () => {
  const bad = tmp('bad-inhibit')
  fs.writeFileSync(`${bad}/systemd-inhibit`, '#!/bin/sh\nexit 1\n')
  fs.chmodSync(`${bad}/systemd-inhibit`, 0o755)
  const path = process.env.PATH
  process.env.PATH = `${bad}:${path}`
  try { assert.equal(startHold(tmp('run'), process.pid, 'x', 0, 'linux'), null) } finally { process.env.PATH = path }
})

test('a live hold is started and recorded', host, async () => {
  const dir = tmp('run')
  const hold = startHold(dir, process.pid, 'x', 0, process.platform)
  assert.ok(hold && alive(hold.pid))
  process.kill(-hold.pid, 'SIGTERM')
  assert.ok(await gone(hold.pid))
})

test('WSL cannot hold off the computer\'s sleep', { skip: process.platform === 'win32' }, () => {
  assert.equal(canHold('linux', { WSL_DISTRO_NAME: 'Ubuntu' }), false)
  assert.equal(canHold('darwin', { WSL_DISTRO_NAME: 'Ubuntu' }), process.platform === 'darwin')
})
