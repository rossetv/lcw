// Seeds a scratch home with one of the approved pay-per-token states, so that the status line can be run against it:
//   node tests/status/samples/seed-dollars.mjs <state> <home>
//   LCW_HOME=<home>/.lcw HOME=<home> COLUMNS=100 node scripts/statusline.mjs < <home>/stdin.json
// States: usual, cap-assumed, near-mark, at-mark-paused, finish-regardless, mark-above-cap, narrow (run with
// COLUMNS=42), subscriber. The spend sits at times relative to the clock (LCW_NOW when set, else now), so the
// figures read the same at any hour; the pace follows from the rate, and lands near the approved numbers.
import fs from 'node:fs'
import { spendFile, sessionFile, capFile, runPaths, runsDir, repoKey, usageFile } from '../../../lib/key.mjs'

const DAY = 86400000
const SESSION = 'seed-payg'
// week: the 7-day spend; rate: dollars a day today, which sets the pace; mark: what the session's mark is.
const STATES = {
  usual: { week: 1260, rate: 159, cap: 4000 },
  'cap-assumed': { week: 1260, rate: 159 },
  'near-mark': { week: 2850, rate: 568, cap: 4000 },
  'at-mark-paused': { week: 3020, rate: 653, cap: 4000, paused: true },
  'finish-regardless': { week: 3020, rate: 653, cap: 4000, markPercent: 100 },
  'mark-above-cap': { week: 4210, rate: 719, cap: 4000, markUsd: 5500 },
  narrow: { week: 1260, rate: 159, cap: 4000 },
  subscriber: {},
}

const [state, home] = process.argv.slice(2)
const spec = STATES[state]
if (!spec || !home) {
  console.error('Usage: seed-dollars.mjs <' + Object.keys(STATES).join('|') + '> <home>')
  process.exit(1)
}
const lcw = home + '/.lcw'
const now = Number(process.env.LCW_NOW) || Date.now()
const write = (file, value) => {
  fs.mkdirSync(file.replace(/\/[^/]*$/, ''), { recursive: true })
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
}

const repo = home + '/lcw'
fs.mkdirSync(repo, { recursive: true })
const stdin = JSON.parse(fs.readFileSync(new URL('./statusline-stdin-payg.json', import.meta.url), 'utf8'))
for (const o of [stdin, stdin.workspace]) for (const k of ['cwd', 'current_dir', 'project_dir']) if (k in o) o[k] = repo
stdin.worktree.original_cwd = repo
stdin.transcript_path = home + '/' + SESSION + '.jsonl'

if (state === 'subscriber') {
  // 42% of the week at 1d 5h to the reset, and the session already knows it is a subscription.
  stdin.rate_limits = { seven_day: { used_percentage: 42, resets_at: Math.floor((now + 1.19 * DAY) / 1000) } }
  write(sessionFile(lcw, SESSION), { billing: 'subscription' })
} else {
  // The 7-day spend: most of it on earlier days, and today's share at the day's rate (the first hour of the
  // day counts as a whole hour, as the rate does).
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const today = spec.rate * Math.max((now - midnight) / 3600000, 1) / 24
  const before = spec.week - today
  const q = {}
  let cum = 0
  for (const days of [5.5, 3.5, 1.5]) q[Math.floor((now - days * DAY) / 900000)] = (cum += before / 3)
  q[Math.floor(now / 900000)] = cum + today
  write(spendFile(lcw, SESSION), { v: 1, base: 0, max: spec.week, q })
  stdin.cost.total_cost_usd = spec.week
  if (spec.cap) write(capFile(lcw), { usd: spec.cap, at: new Date(now).toISOString() })
  const session = { billing: 'payg' }
  if (spec.markPercent) session.markPercent = spec.markPercent
  if (spec.markUsd) session.markUsd = spec.markUsd
  if (spec.paused) {
    // A run paused at the $3,000 mark with two tasks still running, waiting for 08:00. No mod is alive, so
    // the status line draws the run's card under the rows.
    const id = 'seed'
    const dir = runsDir(lcw, repoKey(repo)) + '/' + id
    const paths = runPaths(dir)
    const retryAt = new Date(now).setHours(8, 0, 0, 0)
    write(paths.state, {
      id, name: 'probe', title: 'Probe', repoRoot: repo, driver: SESSION, version: 1, stage: 'Build', stageSince: now - 3600000,
      createdAt: now - 6 * 3600000, status: 'paused', pausedReason: 'mark', markPercent: 75, asks: [], requirements: [],
      tasks: [{ id: 'T1', status: 'running' }, { id: 'T2', status: 'running' }, { id: 'T3', status: 'done' }, { id: 'T4', status: 'todo' }],
    })
    write(paths.gate, { reason: 'mark', unit: 'usd', markUsd: 3000, usedUsd: spec.week, retryAt: retryAt > now ? retryAt : retryAt + DAY, retried: false, at: now })
    session.runDir = dir
  }
  write(sessionFile(lcw, SESSION), session)
}
write(home + '/stdin.json', JSON.stringify(stdin))
console.log('seeded ' + state + ' in ' + home + '; now: LCW_HOME=' + lcw + ' HOME=' + home + ' COLUMNS=' + (state === 'narrow' ? 42 : 100) + ' node scripts/statusline.mjs < ' + home + '/stdin.json')
