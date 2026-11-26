import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { awakeFile } from '../../lib/key.mjs'
import { readJson, writeJson } from './store.mjs'

// Keeping the computer awake while a run runs: macOS caffeinate, or systemd's sleep inhibitor on Linux.
// The hold is a detached process that ends by itself when Claude Code exits; LCW ends it sooner when the run
// pauses, finishes or stops. Its pid and command line are kept in the run's awake file.

const PROGRAM = { darwin: 'caffeinate', linux: 'systemd-inhibit' }

const onPath = (name) => (process.env.PATH || '').split(path.delimiter).some((dir) => {
  try { fs.accessSync(path.join(dir, name), fs.constants.X_OK); return true } catch { return false }
})

// WSL: systemd-inhibit there holds only the Linux VM, so Windows would still sleep
export function inWsl(env) {
  if (env.WSL_DISTRO_NAME) return true
  try { return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')) } catch { return false }
}

/** Whether this computer can hold off sleep: macOS with caffeinate, or Linux (not WSL) with systemd-inhibit. */
export const canHold = (platform = process.platform, env = process.env) =>
  !!PROGRAM[platform] && onPath(PROGRAM[platform]) && !(platform === 'linux' && inWsl(env))

// ps shows a child that died and is not yet reaped as Z; exit status 1 is no such process. Any other ps failure
// leaves it unknown, and an unknown hold counts as running: calling a live one dead would lose track of it.
const running = (pid) => {
  try { return !/^Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'Z') } catch (e) { return e.status !== 1 }
}

/** The hold for a run, as [program, args]: it holds off idle sleep until the process claudePid exits. */
export function holdCommand(platform, claudePid, why) {
  if (platform === 'darwin') return ['caffeinate', ['-i', '-w', String(claudePid)]]
  return ['systemd-inhibit', ['--what=idle:sleep', '--who=LCW', `--why=${why}`, 'tail', `--pid=${claudePid}`, '-f', '/dev/null']]
}

/** Whether a process with this pid is running. */
export const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/** Whether pid is a running Claude Code process (pids get reused): its program (or the script node runs) is named claude. */
export function claudeAlive(pid) {
  if (!alive(pid)) return false
  try {
    const out = execFileSync('ps', ['-ww', '-o', 'args=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    const [first, second] = out.trim().split(/\s+/)
    return /claude/i.test(/(^|\/)node(js)?$/.test(first) ? second || '' : first || '')
  } catch { return false }
}

/** Whether pid is still the hold LCW started (pids get reused): its command line is the one recorded. */
function ours(hold) {
  if (!Number.isInteger(hold?.pid) || hold.pid <= 1 || typeof hold.how !== 'string' || !alive(hold.pid)) return false
  let args = ''
  try { args = execFileSync('ps', ['-ww', '-o', 'args=', '-p', String(hold.pid)], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return false }
  return args === hold.how || args.endsWith(`/${hold.how}`)
}

/** The run's hold, when there is one and it is still running. */
export function keptHold(runDir) {
  const hold = readJson(awakeFile(runDir))
  return ours(hold) ? hold : null
}

/** Starts the hold for a run and records it; returns the record. The process outlives this one. */
export function startHold(runDir, claudePid, why, at, platform = process.platform) {
  const [program, args] = holdCommand(platform, claudePid, why)
  const child = spawn(program, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
  if (!child.pid) return null
  // a hold that cannot start (systemd-inhibit with no bus) exits at once
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
  if (!running(child.pid)) return null
  const hold = { pid: child.pid, at, how: [program, ...args].join(' ') }
  writeJson(awakeFile(runDir), hold)
  return hold
}

/** Ends the run's hold, only if its pid is still our hold, and forgets it. */
export function releaseHold(runDir) {
  const file = awakeFile(runDir)
  const hold = readJson(file)
  if (!hold) return
  if (ours(hold)) {
    // its own process group: systemd-inhibit's waiting child goes with it
    try { process.kill(-hold.pid, 'SIGTERM') } catch { try { process.kill(hold.pid, 'SIGTERM') } catch {} }
  }
  fs.rmSync(file, { force: true })
}

// macOS's own holders, which do not mean someone chose to keep the computer awake
const SYSTEM = ['powerd', 'sharingd', 'runningboardd', 'installd', 'installer', 'softwareupdated', 'backupd']

/**
 * Whether something other than our own hold (ourPid) holds off idle sleep, from `pmset -g assertions` on macOS or
 * `systemd-inhibit --list` on Linux. Not counted on macOS: its own holders (the display-on rule, Handoff, installers), holds under a minute old and
 * Claude Code's short holds, which are `caffeinate -i -t 300`, timed holds of a few minutes.
 */
export function othersHold(platform, text, ourPid) {
  const lines = String(text || '').split('\n')
  if (platform === 'darwin') {
    return lines.some((line, i) => {
      const m = /^\s*pid (\d+)\((.*?)\): \[[^\]]*\] (\d+):(\d+):(\d+) (\w+) named:/.exec(line)
      if (!m || !['PreventUserIdleSystemSleep', 'NoIdleSleepAssertion'].includes(m[6]) || Number(m[1]) === ourPid || SYSTEM.includes(m[2])) return false
      if (Number(m[3]) === 0 && Number(m[4]) === 0 && Number(m[5]) < 60) return false // held under a minute: a passing hold, not a choice
      const details = []
      for (let j = i + 1; j < lines.length && /^\t/.test(lines[j]); j++) details.push(lines[j])
      const timed = /asserting for (\d+) secs/.exec(details.join('\n'))
      return !(m[2] === 'caffeinate' && timed && Number(timed[1]) <= 300)
    })
  }
  // WHO UID USER PID COMM WHAT WHY MODE; WHO and WHY can hold spaces
  return lines.some((line) => {
    const m = /\s(\d+)\s+\S+\s+(\d+)\s+\S+\s+(\S+)\s.*\s(block)\s*$/.exec(line)
    return !!m && Number(m[2]) !== ourPid && m[3].split(':').some((w) => w === 'idle' || w === 'sleep')
  })
}

/** Reads who holds off sleep now and says whether anyone but ourPid does. A reading that fails counts as no one. */
export function heldByOther(ourPid, platform = process.platform) {
  const [cmd, args] = platform === 'darwin' ? ['pmset', ['-g', 'assertions']] : ['systemd-inhibit', ['--list', '--no-pager']]
  try {
    return othersHold(platform, execFileSync(cmd, args, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }), ourPid)
  } catch { return false }
}
