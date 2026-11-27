// Whether this machine is overloaded, for the orchestrator's reminder: test runs are the heavy part of a run,
// and several at once (from overlapping waves or runs) slow each other until they time out.
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const RUNNERS = /(^|[\s/])(pytest|py\.test|jest|vitest|mocha|rspec|phpunit)(\s|$)|-m\s+pytest\b|\bgo\s+test\b|\bcargo\s+(test|nextest)\b/
// a wrapper's command line names the runner too; count the runner once, not its wrapper
const WRAPPERS = /^(\S*\/)?(timeout|gtimeout|nice|env|time|zsh|bash|sh|dash|fish|xargs)$/

/** The test runs in `ps -axo pid=,ppid=,command=` output: [{ pid, orphan }]. */
export function testRuns(ps) {
  const runs = []
  for (const line of ps.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
    if (!m) continue
    const [, pid, ppid, command] = m
    if (WRAPPERS.test(command.split(/\s+/)[0]) || !RUNNERS.test(command)) continue
    runs.push({ pid: Number(pid), orphan: ppid === '1' })
  }
  return runs
}

/** One line for the orchestrator when the machine is overloaded, else ''. */
export function busyLine({ load, cores, runs }) {
  if (!(cores > 0) || !(load > cores * 1.5)) return ''
  const orphans = runs.filter((r) => r.orphan).map((r) => r.pid)
  const count = runs.length === 1 ? '1 test run' : `${runs.length} test runs`
  const left = orphans.length ? ` (${orphans.length} left behind by an ended agent: pid ${orphans.join(', ')})` : ''
  return `machine busy: load ${Math.round(load)} on ${cores} cores, ${count} going${left}. Start no new whole suite until the load is under ${cores}; tell an agent waiting on a slow suite to let it finish, never to start it again. End a run left behind only when it is this run's, by its pid.`
}

/** busyLine for this machine now; '' when it is not busy or cannot be read. */
export function machineBusy() {
  try {
    if (process.platform === 'win32') return ''
    const load = process.env.LCW_LOAD ? Number(process.env.LCW_LOAD) : os.loadavg()[0] // set by tests
    const cores = os.cpus().length
    if (!(load > cores * 1.5)) return ''
    const ps = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024 * 1024 })
    return busyLine({ load, cores, runs: testRuns(ps) })
  } catch {
    return ''
  }
}
