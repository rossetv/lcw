import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordReading, spendSince, machineSpend, ratePerDay, pacePeak, pace, markUsdOf, next0800, runSpend, moneyFrom } from '../../lib/spend.mjs'

process.env.TZ = 'Europe/Dublin' // summer time there, so local midnight is not UTC midnight

const at = (day, h = 0, m = 0) => new Date(2026, 5, day, h, m).getTime() // June <day> 2026, local
const HOUR = 3600000
const DAY = 24 * HOUR

/** A record built from [time, cost] readings, as a session's status line would feed it. */
const feed = (readings, rec = null) => readings.reduce((r, [t, cost]) => recordReading(r, cost, t), rec)

test('the first reading sets the base and nothing before it counts', () => {
  const rec = feed([[at(10, 9), 300]])
  assert.equal(rec.base, 300)
  assert.equal(spendSince([rec], at(3), at(10, 9)), 0)
  const later = recordReading(rec, 312, at(10, 10))
  assert.equal(spendSince([later], at(3), at(10, 10)), 12)
})

test('a lower reading is ignored, and a resumed session counts only what it spends after resuming', () => {
  // $40 spent last Friday (June 5), the session resumed on Tuesday (June 9): its first tick shows the old $40.
  let rec = feed([[at(5, 9), 0], [at(5, 12), 40]])
  assert.equal(machineSpend([rec], at(9, 9)).week, 40)
  assert.equal(recordReading(rec, 25, at(9, 9)), rec)
  rec = feed([[at(9, 9), 40], [at(9, 10), 50]], rec)
  assert.equal(machineSpend([rec], at(9, 10)).week, 50)
})

test('after /clear the new session counts from its own start, beside the old one', () => {
  const old = feed([[at(10, 8), 0], [at(10, 9), 100]])
  const fresh = feed([[at(10, 10), 7], [at(10, 11), 9]]) // a new id starts at its own base
  assert.equal(machineSpend([old, fresh], at(10, 12)).week, 102)
})

test('several sessions at once are all summed', () => {
  const a = feed([[at(10, 8), 0], [at(10, 11), 30]])
  const b = feed([[at(10, 8), 500], [at(10, 11), 520]])
  const c = feed([[at(10, 9), 1], [at(10, 11), 4]])
  assert.equal(machineSpend([a, b, c], at(10, 12)).week, 53)
})

test('buckets older than 8 days are dropped and the base moves, so a session resumed later is not counted again', () => {
  const rec = feed([[at(1, 9), 0], [at(2, 9), 20], [at(12, 9), 20], [at(12, 10), 25]])
  assert.equal(rec.base, 20)
  assert.equal(Object.keys(rec.q).length, 2)
  assert.equal(machineSpend([rec], at(12, 10)).week, 5)
})

test('spend since midnight and since 7 days are cut at the local clock', () => {
  // Midnight in Dublin in June is 23:00 UTC the day before. 30 at 23:30 local on the 9th is yesterday's.
  const rec = feed([[at(9, 20), 0], [at(9, 23, 30), 30], [at(10, 9), 50], [at(10, 14, 45), 80]])
  assert.deepEqual(machineSpend([rec], at(10, 15)), { week: 80, today: 50 })
})

test('spend 7 days old drops out of the week', () => {
  const rec = feed([[at(1, 9), 0], [at(1, 10), 60], [at(9, 9), 60], [at(9, 10), 70]])
  assert.equal(machineSpend([rec], at(9, 12)).week, 10)
})

test('the rate counts at least one hour of the day', () => {
  assert.equal(ratePerDay(10, at(10, 0, 30)), 240)
  assert.equal(ratePerDay(120, at(10, 12)), 240)
  assert.equal(ratePerDay(0, at(10, 5)), 0)
})

test('the pace peak lets old spend age out, so the peak comes just before it drops', () => {
  const now = at(10, 12)
  const rec = feed([[now - 4 * DAY, 0], [now - 3 * DAY, 700]])
  assert.equal(pacePeak([rec], 0, now), 700)
  // $700 falls out after 4 days; at 100 a day the week peaks at 700 + 4 x 100 just before that.
  assert.equal(pacePeak([rec], 100, now), 1100)
})

test('the pace is spare under the cap, short over it, and spare 0 at it', () => {
  assert.deepEqual(pace(1100, 4000), { usd: 2900, short: false })
  assert.deepEqual(pace(4500, 4000), { usd: 500, short: true })
  assert.deepEqual(pace(4000, 4000), { usd: 0, short: false })
})

test('the mark is a dollar mark as given, a share of the cap, or 75% of it by default', () => {
  assert.equal(markUsdOf({ markUsd: 5500 }, 4000), 5500)
  assert.equal(markUsdOf({ markPercent: 50 }, 4000), 2000)
  assert.equal(markUsdOf({ markPercent: 50 }, 6000), 3000) // a share mark follows the cap
  assert.equal(markUsdOf({}, 4000), 3000)
  assert.equal(markUsdOf(null, 4000), 3000)
})

test('the next 08:00 is the same day before 08:00 and the next day from 08:00 on', () => {
  assert.equal(next0800(at(10, 6)), at(10, 8))
  assert.equal(next0800(at(10, 9)), at(11, 8))
  assert.equal(next0800(at(10, 8)), at(11, 8)) // the retry itself must move on, not repeat
})

test('a run spends what its session spent since it began, plus what came before', () => {
  assert.equal(runSpend({ usdAtStart: 40 }, 55), 15)
  assert.equal(runSpend({ usdBefore: 20, usdAtStart: 40 }, 55), 35)
  assert.equal(runSpend({}, 55), 0)
  assert.equal(runSpend(undefined, 55), 0)
})

test('moneyFrom builds the view for a share mark, a stated cap and a run', () => {
  const now = at(10, 12)
  const rec = feed([[at(10, 8), 0], [at(10, 11), 1200]])
  const view = moneyFrom({ records: [rec], cap: { usd: 2000 }, session: { markPercent: 50 }, state: { usdAtStart: 100 }, sessionCum: 1200, now })
  assert.equal(view.spentUsd, 1200)
  assert.equal(view.todayUsd, 1200)
  assert.equal(view.ratePerDay, 1200 / 12 * 24)
  assert.equal(view.capUsd, 2000)
  assert.equal(view.capAssumed, false)
  assert.equal(view.markUsd, 1000)
  assert.equal(view.markShare, 50)
  assert.equal(view.atMark, true)
  assert.equal(view.runUsd, 1100)
  assert.equal(view.pace.short, true)
})

test('moneyFrom assumes the default cap when there is none, and a dollar mark has no share', () => {
  const now = at(10, 12)
  const none = moneyFrom({ records: [], cap: null, session: {}, now })
  assert.deepEqual([none.capUsd, none.capAssumed, none.markUsd, none.markShare, none.atMark, none.pace], [4000, true, 3000, 75, false, { usd: 4000, short: false }])
  assert.equal('runUsd' in none, false)
  const dollars = moneyFrom({ records: [], cap: { usd: 4000 }, session: { markUsd: 5500 }, now })
  assert.deepEqual([dollars.markUsd, dollars.markShare], [5500, null])
})
