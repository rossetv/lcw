// The status line on pay-per-token billing: which billing a session is, the spend it keeps, the dollar mark and
// the subscriber's bar staying as it is. Each tick is a real run of the script, at a pinned time and time zone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmp, lcw, readJson, makeRepo } from '../core/helpers.mjs'

const ROOT = new URL('../..', import.meta.url).pathname
const LINE = ROOT + 'scripts/statusline.mjs'
const SEED = ROOT + 'tests/status/samples/seed-dollars.mjs'
const HOUR = 3600000
const NOW = Date.UTC(2026, 5, 10, 12) // 13:00 in Dublin
const weekly = { seven_day: { used_percentage: 20, resets_at: Math.floor(NOW / 1000) + 3 * 86400 } }
const plain = (s) => s.replace(/\x1b\][^\x1b]*\x1b\\/g, '').replace(/\x1b\[[0-9;]*m/g, '')

/** One tick of the status line for a session; returns the plain rows. */
function tick(home, { id = 's1', transcript, cost, rate_limits, at = NOW, cwd = tmp('cwd'), columns = '120' }) {
  const input = { session_id: id, cwd, model: { display_name: 'Opus 5' } }
  if (transcript) input.transcript_path = transcript
  if (cost !== undefined) input.cost = { total_cost_usd: cost }
  if (rate_limits) input.rate_limits = rate_limits
  const env = { ...process.env, LCW_HOME: home, LCW_NOW: String(at), TZ: 'Europe/Dublin', COLUMNS: columns }
  const r = spawnSync('node', [LINE], { input: JSON.stringify(input), encoding: 'utf8', env })
  assert.equal(r.status, 0)
  return plain(r.stdout).split('\n').filter(Boolean)
}
const session = (home, id) => readJson(home + '/sessions/' + id + '.json')
const spent = (rows) => /(\$[\d,]+) ▰/.exec(rows[1])?.[1]

test('a reply without a weekly figure settles an unclear session as pay-per-token; before it, nothing is in dollars', () => {
  const home = tmp('home')
  const before = tick(home, { cost: 0, at: NOW - 2 * HOUR })
  assert.ok(!before.join('').includes('$'))
  assert.equal(fs.existsSync(home + '/sessions/s1.json'), false) // nothing settled, so nothing written
  const after = tick(home, { cost: 9 })
  assert.equal(session(home, 's1').billing, 'payg')
  assert.equal(spent(after), '$9', after.join('\n')) // what it spent since its first reading
})

test('a weekly figure makes a subscription, wins over a stored pay-per-token, and takes the dollars back out', () => {
  const home = tmp('home')
  tick(home, { cost: 4, at: NOW - HOUR })
  tick(home, { cost: 9 })
  assert.ok(fs.existsSync(home + '/spend/s1.json'))
  const rows = tick(home, { cost: 10, rate_limits: weekly })
  assert.equal(session(home, 's1').billing, 'subscription')
  assert.equal(fs.existsSync(home + '/spend/s1.json'), false)
  assert.ok(rows[1].includes('20%') && !rows[1].includes('$'), rows[1])
})

test('a resumed session is not counted twice, /clear counts from its new start, and sessions at once add up', () => {
  const home = tmp('home')
  tick(home, { id: 'a', cost: 10, at: NOW - 3 * HOUR })
  tick(home, { id: 'a', cost: 40, at: NOW - 2 * HOUR }) // +30
  tick(home, { id: 'b', cost: 100, at: NOW - 2 * HOUR })
  tick(home, { id: 'b', cost: 120, at: NOW - HOUR }) // +20
  tick(home, { id: 'a', cost: 40, at: NOW - HOUR }) // resumed: its old $40 shows again
  tick(home, { id: 'a', cost: 55 }) // +15
  assert.equal(spent(tick(home, { id: 'a', cost: 55 })), '$65')
  assert.equal(spent(tick(home, { id: 'c', cost: 7 })), '$65') // after /clear: a new id, nothing before its first reading
})

test('billing and spend are kept under the transcript name, which a resumed session keeps', () => {
  const home = tmp('home')
  tick(home, { id: 'new-id', transcript: '/p/old-name.jsonl', cost: 3, at: NOW - HOUR })
  tick(home, { id: 'new-id', transcript: '/p/old-name.jsonl', cost: 8 })
  assert.deepEqual(fs.readdirSync(home + '/spend'), ['old-name.json'])
  assert.equal(session(home, 'old-name').billing, 'payg')
})

test('a payg run is gated at its dollar mark with no weekly figure, and the gate waits for 08:00 once the spend is under it', () => {
  const repo = makeRepo()
  const home = tmp('home')
  assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home, cwd: repo, session: 's1' }).code, 0)
  const file = home + '/sessions/s1.json'
  const dir = readJson(file).runDir
  const set = (patch) => fs.writeFileSync(file, JSON.stringify({ ...readJson(file), ...patch }))
  set({ billing: 'payg', markUsd: 100 })
  tick(home, { cost: 10, at: NOW - HOUR, cwd: repo })
  tick(home, { cost: 150, cwd: repo }) // spent 140 of a $100 mark
  const gate = readJson(dir + '/gate')
  assert.equal(gate.unit, 'usd')
  assert.equal(gate.markUsd, 100)
  assert.equal(gate.retryAt, Date.UTC(2026, 5, 11, 7)) // 08:00 in Dublin, tomorrow
  // The person raises the mark: a run still running has no use for the gate, a run paused by the mark keeps it.
  set({ markUsd: 1000 })
  const state = readJson(dir + '/state.json')
  fs.writeFileSync(dir + '/state.json', JSON.stringify({ ...state, status: 'paused', pausedReason: 'mark' }))
  tick(home, { cost: 150, cwd: repo })
  assert.ok(fs.existsSync(dir + '/gate'), 'the 08:00 try is not lost')
  fs.writeFileSync(dir + '/state.json', JSON.stringify({ ...state, status: 'running' }))
  tick(home, { cost: 150, cwd: repo })
  assert.equal(fs.existsSync(dir + '/gate'), false)
})

test('the mark on the bar is the session\'s dollar mark, or its share of the stated cap', () => {
  const home = tmp('home')
  fs.mkdirSync(home + '/sessions', { recursive: true })
  fs.writeFileSync(home + '/cap.json', JSON.stringify({ usd: 1000 }))
  fs.writeFileSync(home + '/sessions/s1.json', JSON.stringify({ billing: 'payg', markPercent: 80 }))
  assert.match(tick(home, { cost: 1 })[1], /\$800\b/)
  fs.writeFileSync(home + '/sessions/s1.json', JSON.stringify({ billing: 'payg', markUsd: 250 }))
  assert.match(tick(home, { cost: 1 })[1], /\$250\b/)
})

test('a subscriber\'s rows are the same whatever dollars are on the machine', () => {
  const bare = tmp('home')
  const busy = tmp('home')
  tick(busy, { id: 'other', cost: 5, at: NOW - HOUR })
  tick(busy, { id: 'other', cost: 500 })
  fs.writeFileSync(busy + '/cap.json', JSON.stringify({ usd: 9000 }))
  const input = { id: 'sub', cost: 12, rate_limits: weekly, cwd: tmp('cwd') }
  const rows = tick(bare, input)
  assert.deepEqual(tick(busy, input), rows)
  assert.ok(rows[1].includes('20%') && !rows.join('').includes('$'))
})

test('each approved state seeds and draws: the figures, the pace, the card and the narrow layout', () => {
  const want = {
    usual: [/\$1,260 ▰.*\|.* \$3,000/, /rolling 7d · \$[\d,]+ spare/],
    'cap-assumed': [/\$4,000 cap assumed · \$[\d,]+ spare/],
    'near-mark': [/\$2,850 ▰/, /rolling 7d · \$[\d,]+ short/],
    'at-mark-paused': [/\$3,020 ▰/, /paused at your \$3,000 mark/, /resumes at 08:00/, /the 2 running tasks finish/, /run up to \$3,400/],
    'finish-regardless': [/\$3,020 ▰.*▱\| \$4,000/],
    'mark-above-cap': [/\$4,210 ▰.*▱\| \$5,500/],
    subscriber: [/42% ▰.*\|.* 75%/],
  }
  for (const [state, patterns] of Object.entries(want)) {
    const home = tmp('seed')
    const env = { ...process.env, LCW_NOW: String(NOW), TZ: 'Europe/Dublin' }
    assert.equal(spawnSync('node', [SEED, state, home], { env }).status, 0, state)
    const r = spawnSync('node', [LINE], { input: fs.readFileSync(home + '/stdin.json'), encoding: 'utf8', env: { ...env, LCW_HOME: home + '/.lcw', COLUMNS: '100' } })
    for (const p of patterns) assert.match(plain(r.stdout), p, state)
  }
  const home = tmp('seed')
  const env = { ...process.env, LCW_NOW: String(NOW), TZ: 'Europe/Dublin' }
  spawnSync('node', [SEED, 'narrow', home], { env })
  const r = spawnSync('node', [LINE], { input: fs.readFileSync(home + '/stdin.json'), encoding: 'utf8', env: { ...env, LCW_HOME: home + '/.lcw', COLUMNS: '42' } })
  const rows = plain(r.stdout).split('\n').filter(Boolean)
  assert.equal(rows.length, 3, rows.join('\n'))
  assert.match(rows[1], /^\$1,260 ▰.*\|.* \$3,000$/)
  assert.match(rows[2], /^rolling 7d · \$[\d,]+ spare$/)
})
