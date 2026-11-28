// The spend command on the bar and in the hooks: its reading gives the week's figure, a failing command says so on
// the bar, no command changes nothing, and the refresh starts once per window, on pay-per-token billing only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { drawIn } from './golden/draw.mjs'
import { tmp, makeRepo, readJson as readJsonStrict, GATE_HOOK } from '../core/helpers.mjs'
import { spendTryFile } from '../../lib/key.mjs'
import { renderStatusRows } from '../../lib/status.mjs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const LINE = ROOT + '/scripts/statusline.mjs'
const HOUR = 3600000
const NOW = Date.UTC(2026, 5, 10, 12) // a quarter-hour boundary
const QUARTER = Math.floor(NOW / 900000)
const CMD = 'echo 1240'
const CAUTION = '\x1b[38;2;230;193;115m' // the bar's caution colour on the dark theme
const plain = (s) => s.replace(/\x1b\][^\x1b]*\x1b\\/g, '').replace(/\x1b\[[0-9;]*m/g, '')
const weekly = { seven_day: { used_percentage: 20, resets_at: Math.floor(NOW / 1000) + 3 * 86400 } }

const readJson = (file) => { try { return readJsonStrict(file) } catch { return null } }
const write = (home, name, body) => {
  fs.mkdirSync(home + '/' + name.split('/').slice(0, -1).join('/'), { recursive: true })
  fs.writeFileSync(home + '/' + name, JSON.stringify(body))
}

/** A pay-per-token home with a $4,000 cap (so a $3,000 mark) and one session's records: quarters back from NOW -> cumulative cost. */
function payg(records = {}) {
  const home = tmp('home')
  write(home, 'sessions/s1.json', { billing: 'payg', toldPayg: true })
  write(home, 'cap.json', { usd: 4000 })
  const q = Object.fromEntries(Object.entries(records).map(([back, usd]) => [QUARTER - back, usd]))
  const max = Math.max(0, ...Object.values(records))
  write(home, 'spend/s1.json', { v: 1, base: 0, max, q })
  return home
}
const setting = (home, command = CMD) => write(home, 'spend-command.json', { v: 1, command, setAt: NOW - 9 * HOUR })
const reading = (home, { usd = 1240, agoMs, fails = 0, command = CMD }) => write(home, 'spend-reading.json', {
  v: 1, command, usd, at: NOW - agoMs, fails, failingSince: fails >= 3 ? NOW - agoMs : null, lastError: fails ? 'printed nothing' : null, triedAt: NOW - agoMs,
})
/** This window's lock, so that the tick starts nothing that could rewrite the reading in the middle of a check. */
const lock = (home) => { fs.mkdirSync(home + '/cache', { recursive: true }); fs.writeFileSync(spendTryFile(home, Math.floor(NOW / 300000)), '') }

const CWD = tmp('cwd') // the bar names the folder, so every tick stands in the same one
const tickEnv = (home) => ({ PATH: process.env.PATH, HOME: home, LCW_HOME: home, LCW_NOW: String(NOW), TZ: 'Europe/Dublin', COLUMNS: '130', LCW_THEME: 'dark' })
const tickInput = (billing, cwd) => {
  const input = { session_id: 's1', cwd, model: { display_name: 'Opus 5' } }
  if (billing === 'subscription') input.rate_limits = weekly
  return JSON.stringify(input)
}
/** One tick drawn in this process. The refresh it may start is the same detached runner, which takes its environment when it starts. */
async function tick(home, { billing = 'payg', cwd = CWD } = {}) {
  const raw = await drawIn(ROOT, tickInput(billing, cwd), tickEnv(home))
  return { raw, rows: plain(raw).split('\n').filter(Boolean) }
}
const spent = (rows) => /(\$[\d,]+) ▰/.exec(rows[1])?.[1]

test('a working reading gives the week its figure plus what LCW counted since, and the right part is today\'s', async () => {
  const home = payg({ 4: 500, 0: 520 }) // $500 an hour ago (before the reading), $20 since it
  setting(home); reading(home, { agoMs: 3 * 60000 }); lock(home)
  const { rows } = await tick(home)
  assert.equal(spent(rows), '$1,260', rows.join('\n')) // not LCW's own $520
  assert.match(rows[1], /\|[▰▱]* \$3,000/)
  assert.match(rows[1], /rolling 7d · \$[\d,]+ (spare|short)$/)
})

test('a command that failed 3 times in a row replaces the right part with its age, in the caution colour, and keeps the figure', async () => {
  const home = payg({ 12: 100, 4: 146 }) // $46 after the reading, which is 2 hours old
  setting(home); reading(home, { agoMs: 2 * HOUR, fails: 3 }); lock(home)
  const { raw, rows } = await tick(home)
  assert.equal(spent(rows), '$1,271', rows.join('\n')) // 2 of the reading's 168 hours have dropped out: $1,225, and $46
  assert.match(rows[1], /\|[▰▱]* \$3,000 +spend command failing · 2h old$/)
  assert.ok(!/spare|short|rolling/.test(rows[1]), rows[1])
  assert.ok(raw.includes(CAUTION + 'spend command failing · 2h old'), 'in the caution colour')
})

test('a command that has failed only twice is not yet called failing', async () => {
  const home = payg({ 12: 100, 4: 146 })
  setting(home); reading(home, { agoMs: 2 * HOUR, fails: 2 }); lock(home)
  const { rows } = await tick(home)
  assert.equal(spent(rows), '$1,271')
  assert.match(rows[1], /rolling 7d/)
  assert.ok(!rows.join('').includes('failing'))
})

test('with no command, or a reading made for another command, the bar is exactly what LCW counts alone', async () => {
  const records = { 12: 100, 4: 146 }
  const none = payg(records)
  const bare = await tick(none)
  assert.equal(spent(bare.rows), '$146')
  assert.equal(fs.existsSync(none + '/cache'), false, 'no command, so no window is claimed')
  assert.equal(fs.existsSync(none + '/spend-reading.json'), false, 'and nothing is read')
  const other = payg(records)
  setting(other); reading(other, { agoMs: 2 * HOUR, fails: 3, command: 'echo 9' }); lock(other)
  assert.equal((await tick(other)).raw, bare.raw)
  const noReading = payg(records)
  setting(noReading); lock(noReading) // a command set that has not run yet
  assert.equal((await tick(noReading)).raw, bare.raw)
})

test('on a subscription a command does nothing: the same bar, and no refresh', async () => {
  const bare = tmp('home')
  write(bare, 'sessions/s1.json', { billing: 'subscription' })
  const home = tmp('home')
  write(home, 'sessions/s1.json', { billing: 'subscription' })
  setting(home); reading(home, { usd: 2900, agoMs: HOUR, fails: 3 }) // no lock: a refresh would take it
  const { raw, rows } = await tick(home, { billing: 'subscription' })
  assert.equal(raw, (await tick(bare, { billing: 'subscription' })).raw)
  assert.ok(rows[1].includes('20%') && !rows.join('').includes('$'))
  assert.equal(fs.existsSync(home + '/cache'), false)
  assert.equal(readJson(home + '/spend-reading.json').usd, 2900) // untouched
})

test('the program, run for real, with a command set and no lock starts the refresh, and the reading appears', async () => {
  const home = payg()
  setting(home, 'echo 1300')
  const r = spawnSync('node', [LINE], { input: tickInput('payg', CWD), encoding: 'utf8', env: tickEnv(home) })
  assert.equal(r.status, 0)
  assert.ok(fs.existsSync(spendTryFile(home, Math.floor(NOW / 300000))), 'the window is claimed')
  const until = Date.now() + 20000
  while (Date.now() < until && readJson(home + '/spend-reading.json')?.usd !== 1300) await new Promise((r) => setTimeout(r, 50))
  const got = readJson(home + '/spend-reading.json')
  assert.equal(got?.usd, 1300)
  assert.equal(got.at, NOW)
  assert.equal(got.fails, 0)
})

test('the agent gate counts the command\'s figure: refused at the mark with it, let through without it', async () => {
  const repo = makeRepo()
  const gate = (home) => spawnSync('node', [GATE_HOOK], {
    cwd: repo, input: JSON.stringify({ session_id: 's1', cwd: repo }), encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, LCW_HOME: home, LCW_NOW: String(NOW) },
  })
  const home = payg({ 12: 2000 }) // LCW's own count is $2,000, under the $3,000 mark
  assert.equal(gate(home).status, 0)
  setting(home); reading(home, { usd: 3100, agoMs: 2 * HOUR }); lock(home)
  const refused = gate(home)
  assert.equal(refused.status, 2)
  assert.match(refused.stderr, /\$3,063 was spent in the last 7 days and the mark is \$3,000/) // the $3,100 reading, 2 hours old
})

test('a failing note shows at every width where one fits, whole where it fits, and no row passes the width', async () => {
  const money = { capUsd: 4000, markUsd: 3000, spentUsd: 1240, command: { failing: true, at: NOW - 12 * 60000 } }
  const FULL = 'spend command failing · 12 min old', SHORT = 'failing · 12 min old'
  const rowsAt = (width) => renderStatusRows({ model: { display_name: 'Opus 5' }, money }, { width, now: NOW })
    .map(r => r.map(s => s.t).join(''))
  for (const width of [30, 36, 40, 42, 43, 44, 45, 50, 60, 80]) {
    const rows = rowsAt(width)
    for (const row of rows) assert.ok([...row].length <= width, width + ': ' + row)
    // The row the note sits on: a row of its own when narrow, the money row otherwise.
    const narrow = width < 44
    const room = narrow ? width : width - 6 - '$1,240 '.length - ' $3,000'.length
    const fits = [FULL, SHORT].find(t => t.length <= room)
    const shown = rows.some(r => r.endsWith(FULL)) ? FULL : rows.some(r => r.endsWith(SHORT)) ? SHORT : null
    assert.equal(shown, fits ?? null, width + ': ' + JSON.stringify(rows))
  }
  assert.equal(rowsAt(40).at(-1), FULL)
  assert.equal(rowsAt(30).at(-1), SHORT)
  // The age's "min" form, drawn whole through the line.
  const home = payg({ 4: 146 })
  setting(home); reading(home, { agoMs: 12 * 60000, fails: 3 }); lock(home)
  const { rows: drawn } = await tick(home)
  assert.match(drawn[1], /spend command failing · 12 min old$/)
})
