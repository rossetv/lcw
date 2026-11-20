import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordReading, moneyFrom, readingOf, pacePeak, SPEND_COMMAND_FAILS } from '../../lib/spend.mjs'

process.env.TZ = 'Europe/Dublin'

const at = (day, h = 0, m = 0) => new Date(2026, 5, day, h, m).getTime()
const feed = (readings) => readings.reduce((r, [t, cost]) => recordReading(r, cost, t), null)
const base = { cap: { usd: 4000 }, session: { markPercent: 75 } }
const setting = { v: 1, command: 'print-spend', setAt: 1 }
const raw = (over = {}) => ({ v: 1, command: 'print-spend', usd: 1000, at: at(10, 9), fails: 0, failingSince: null, lastError: null, triedAt: at(10, 9), ...over })
const reading = (over) => readingOf(setting, raw(over))

test('without a reading the money view is what it was, with no command field', () => {
  const records = [feed([[at(9, 8), 0], [at(10, 11), 30]])]
  const input = { ...base, records, now: at(10, 12) }
  const plain = moneyFrom(input)
  assert.deepEqual(moneyFrom({ ...input, reading: null }), plain)
  assert.deepEqual(moneyFrom({ ...input, reading: undefined }), plain)
  assert.equal(plain.spentUsd, 30)
  assert.equal('command' in plain, false)
})

test('the 7-day figure is the reading plus what LCW counted since it', () => {
  // $50 before the reading, $30 after it (a later quarter).
  const records = [feed([[at(9, 8), 0], [at(10, 8), 50], [at(10, 10), 80]])]
  const view = moneyFrom({ ...base, records, now: at(10, 12), reading: reading() })
  assert.equal(view.spentUsd, 1030)
  assert.equal(view.command.sinceUsd, 30)
  assert.equal(view.command.readingUsd, 1000)
  assert.equal(view.todayUsd, 80) // LCW's own count
})

test('spend from before the reading is not counted twice', () => {
  const records = [feed([[at(9, 8), 0], [at(10, 8), 500]])]
  const view = moneyFrom({ ...base, records, now: at(10, 12), reading: reading() })
  assert.equal(view.spentUsd, 1000)
  assert.equal(view.command.sinceUsd, 0)
})

test('the quarter that holds the reading counts whole, so the figure errs high', () => {
  // reading at 09:10; $20 spent at 09:05 is in the same quarter and counts, $5 at 09:20 counts too.
  const records = [feed([[at(10, 8), 0], [at(10, 9, 5), 20], [at(10, 9, 20), 25]])]
  const view = moneyFrom({ ...base, records, now: at(10, 12), reading: reading({ at: at(10, 9, 10) }) })
  assert.equal(view.command.sinceUsd, 25)
  assert.equal(view.spentUsd, 1025)
})

test('the mark follows the figure from the reading', () => {
  const view = moneyFrom({ ...base, records: [], now: at(10, 12), reading: reading({ usd: 3000 }) })
  assert.equal(view.atMark, true)
  assert.equal(moneyFrom({ ...base, records: [], now: at(10, 12), reading: reading({ usd: 2999 }) }).atMark, false)
})

test('three failed runs in a row make the command failing, and the figure still never drops', () => {
  const records = [feed([[at(10, 8), 0], [at(10, 10), 40]])]
  const run = (fails) => moneyFrom({ ...base, records, now: at(10, 12), reading: reading({ fails, failingSince: at(10, 10), lastError: 'printed "401 Unauthorized"' }) })
  assert.equal(SPEND_COMMAND_FAILS, 3)
  assert.equal(run(2).command.failing, false)
  const failing = run(3)
  assert.equal(failing.command.failing, true)
  assert.equal(failing.spentUsd, 1040)
  assert.equal(failing.command.failingSince, at(10, 10))
  assert.equal(failing.command.lastError, 'printed "401 Unauthorized"')
})

test('the pace holds the reading dollars for the whole horizon and adds LCW records after it', () => {
  // The reading covers $3000, and a record from before it must not age out the reading's dollars.
  const old = feed([[at(4, 8), 0], [at(4, 9), 900]])
  const view = moneyFrom({ ...base, records: [old], now: at(10, 12), reading: reading({ usd: 3000 }) })
  assert.deepEqual(view.pace, { usd: 1000, short: false }) // peak 3000, rate 0: never lower than the reading
  // A record after the reading ages out as today: the peak is the reading plus LCW's own peak.
  const fresh = feed([[at(10, 8), 0], [at(10, 10), 100]])
  const rate = moneyFrom({ ...base, records: [fresh], now: at(10, 12) }).ratePerDay
  const peak = 3000 + pacePeak([fresh], rate, at(10, 12))
  const next = moneyFrom({ ...base, records: [fresh], now: at(10, 12), reading: reading({ usd: 3000 }) })
  assert.deepEqual(next.pace, { usd: Math.abs(4000 - peak), short: peak > 4000 })
  assert.equal(next.pace.short, true)
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
