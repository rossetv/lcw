import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordReading, moneyFrom, readingOf, SPEND_COMMAND_FAILS } from '../../lib/spend.mjs'

process.env.TZ = 'Europe/Dublin'

const at = (day, h = 0, m = 0) => new Date(2026, 5, day, h, m).getTime()
const feed = (readings) => readings.reduce((r, [t, cost]) => recordReading(r, cost, t), null)
const base = { cap: { usd: 4000 }, session: { markPercent: 75 } }
const setting = { v: 1, command: 'print-spend', setAt: 1 }
const raw = (over = {}) => ({ v: 1, command: 'print-spend', usd: 1000, at: at(10, 9), fails: 0, failingSince: null, lastError: null, triedAt: at(10, 9), ...over })
const reading = (over) => readingOf(setting, raw(over))
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`)
// A reading covers the 7 days before it was taken; 3 hours on, 3 of its 168 hours have dropped out of the window.
const LEFT_AFTER_3H = 165 / 168

test('without a reading the money view is what it was, with no command field', () => {
  const records = [feed([[at(9, 8), 0], [at(10, 11), 30]])]
  const input = { ...base, records, now: at(10, 12) }
  const plain = moneyFrom(input)
  assert.deepEqual(moneyFrom({ ...input, reading: null }), plain)
  assert.deepEqual(moneyFrom({ ...input, reading: undefined }), plain)
  assert.equal(plain.spentUsd, 30)
  assert.equal('command' in plain, false)
})

test('the 7-day figure is what of the reading is still in the week, plus what LCW counted since it', () => {
  // $50 before the reading, $30 after it (a later quarter); the reading is 3 hours old.
  const records = [feed([[at(9, 8), 0], [at(10, 8), 50], [at(10, 10), 80]])]
  const view = moneyFrom({ ...base, records, now: at(10, 12), reading: reading({ usd: 1680 }) })
  near(view.spentUsd, 1680 * LEFT_AFTER_3H + 30) // $1,650 of the reading, and $30
  assert.equal(view.command.sinceUsd, 30)
  assert.equal(view.command.readingUsd, 1680)
  assert.equal(view.todayUsd, 80) // LCW's own count
})

test('spend from before the reading is not counted twice', () => {
  const records = [feed([[at(9, 8), 0], [at(10, 8), 500]])]
  const view = moneyFrom({ ...base, records, now: at(10, 12), reading: reading() })
  near(view.spentUsd, 1000 * LEFT_AFTER_3H)
  assert.equal(view.command.sinceUsd, 0)
})

test('the quarter that holds the reading counts whole, so the figure errs high', () => {
  // reading at 09:10; $20 spent at 09:05 is in the same quarter and counts, $5 at 09:20 counts too.
  const records = [feed([[at(10, 8), 0], [at(10, 9, 5), 20], [at(10, 9, 20), 25]])]
  const view = moneyFrom({ ...base, records, now: at(10, 12), reading: reading({ at: at(10, 9, 10) }) })
  assert.equal(view.command.sinceUsd, 25)
  near(view.spentUsd, 1000 * (1 - (170 / 60) / 168) + 25) // the reading is 2h50 old
})

test('the mark follows the figure from the reading', () => {
  const view = moneyFrom({ ...base, records: [], now: at(10, 12), reading: reading({ usd: 3000, at: at(10, 12) }) })
  assert.equal(view.atMark, true)
  assert.equal(moneyFrom({ ...base, records: [], now: at(10, 12), reading: reading({ usd: 2999, at: at(10, 12) }) }).atMark, false)
})

test('three failed runs in a row make the command failing, and the figure still counts from the reading', () => {
  const records = [feed([[at(10, 8), 0], [at(10, 10), 40]])]
  const run = (fails) => moneyFrom({ ...base, records, now: at(10, 12), reading: reading({ fails, failingSince: at(10, 10), lastError: 'printed "401 Unauthorized"' }) })
  assert.equal(SPEND_COMMAND_FAILS, 3)
  assert.equal(run(2).command.failing, false)
  const failing = run(3)
  assert.equal(failing.command.failing, true)
  near(failing.spentUsd, 1000 * LEFT_AFTER_3H + 40)
  assert.equal(failing.command.failingSince, at(10, 10))
  assert.equal(failing.command.lastError, 'printed "401 Unauthorized"')
})

test('the pace runs the reading dollars down over the week, as its days drop out, while today\'s rate adds to it', () => {
  // A fresh reading of $3000 at rate 0: the peak is now, the reading itself. A record from before it changes nothing.
  const old = feed([[at(4, 8), 0], [at(4, 9), 900]])
  const view = moneyFrom({ ...base, records: [old], now: at(10, 12), reading: reading({ usd: 3000, at: at(10, 12) }) })
  assert.deepEqual(view.pace, { usd: 1000, short: false })
  // A steady $100 a day: a $700 reading loses $100 a day as its days drop out and today's spending adds $100 a day,
  // so the 7-day figure stays at $700. Holding the reading whole would have counted the week twice: $1,400, short.
  const steady = feed([[at(10, 0), 0], [at(10, 11, 45), 50]]) // $50 by noon, before the reading's quarter
  const flat = moneyFrom({ ...base, cap: { usd: 1000 }, records: [steady], now: at(10, 12), reading: reading({ usd: 700, at: at(10, 12) }) })
  near(flat.ratePerDay, 100)
  near(flat.pace.usd, 300)
  assert.equal(flat.pace.short, false)
})

test('a reading the command could not renew runs down as it ages, so an old figure does not reach the mark', () => {
  // $700 read on the 10th and the command failing since: a day on, a seventh of it has dropped out; a week on, all of it.
  const old = reading({ usd: 700, at: at(10, 12), fails: 5 })
  const view = (now) => moneyFrom({ ...base, cap: { usd: 1000 }, records: [], now, reading: old })
  near(view(at(11, 12)).spentUsd, 600)
  assert.equal(view(at(11, 12)).atMark, false) // the mark is $750
  near(view(at(17, 12)).spentUsd, 0)
  near(view(at(10, 12)).spentUsd, 700)
})

test('a setting and a reading that do not belong together give no reading', () => {
  assert.equal(reading().usd, 1000)
  assert.equal(readingOf(setting, raw({ command: 'other' })), null)
  assert.equal(readingOf(null, raw()), null)
  assert.equal(readingOf({ command: '' }, raw({ command: '' })), null)
  assert.equal(readingOf(setting, null), null)
  assert.equal(readingOf(setting, 'x'), null)
  for (const usd of [-1, '5', null, NaN, Infinity, undefined]) assert.equal(readingOf(setting, raw({ usd })), null, String(usd))
  for (const when of [null, undefined, NaN, '1']) assert.equal(readingOf(setting, raw({ at: when })), null, String(when))
  assert.equal(readingOf(setting, raw({ usd: 0 })).usd, 0)
})

test('a damaged fails, failingSince or lastError is read as none', () => {
  for (const fails of [undefined, -1, 1.5, '2', null]) assert.equal(reading({ fails }).fails, 0, String(fails))
  assert.equal(reading({ fails: 4 }).fails, 4)
  const r = reading({ failingSince: 'x', lastError: 7 })
  assert.deepEqual([r.failingSince, r.lastError], [null, null])
})
