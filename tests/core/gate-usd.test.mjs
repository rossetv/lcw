import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp } from './helpers.mjs'
import { runPaths, runsDir, repoKey, sessionFile, spendFile } from '../../lib/key.mjs'
import { readMoney, recordSpend, dropSpend, setBilling, writeCap, readCap } from '../../scripts/lib/money.mjs'
import { setSessionMark, applyGate, gateHolds, sessionMark } from '../../scripts/lib/gate.mjs'

process.env.TZ = 'Europe/Dublin'

const at = (day, h = 0, m = 0) => new Date(2026, 5, day, h, m).getTime() // June <day> 2026, local
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

/** A fresh LCW home for this test; the scripts' helpers read LCW_HOME on every call. */
function fresh() {
  const home = tmp('home')
  process.env.LCW_HOME = home
  return home
}

/** A run folder where readMoney looks for it, and its state. */
function runOf(home, driver, extra = {}) {
  const state = { id: 'r1', repoRoot: '/work/demo', driver, status: 'running', pausedReason: null, markPercent: 75, ...extra }
  const paths = runPaths(`${runsDir(home, repoKey(state.repoRoot))}/${state.id}`)
  fs.mkdirSync(paths.dir, { recursive: true })
  return { paths, state }
}

test('no money view unless the session is billed per token', () => {
  fresh()
  recordSpend('s', 0, at(10, 9))
  recordSpend('s', 50, at(10, 10))
  assert.equal(readMoney({ sessionId: 's', now: at(10, 11) }), null, 'no billing recorded reads as unclear')
  setBilling('s', 'unclear')
  assert.equal(readMoney({ sessionId: 's', now: at(10, 11) }), null)
  setBilling('s', 'subscription')
  assert.equal(readMoney({ sessionId: 's', now: at(10, 11) }), null)
  setBilling('s', 'payg')
  const money = readMoney({ sessionId: 's', now: at(10, 11) })
  assert.equal(money.spentUsd, 50)
  assert.equal(money.capAssumed, true)
  assert.equal(money.markUsd, 3000)
})

test('a resumed session counts only what it spends after resuming, and /clear starts a new count', () => {
  const home = fresh()
  setBilling('a', 'payg')
  recordSpend('a', 0, at(5, 9))
  recordSpend('a', 40, at(5, 12))
  // Resumed on the 9th: the same id, its first tick shows the old $40 again (or less), then $10 more.
  recordSpend('a', 40, at(9, 9))
  recordSpend('a', 25, at(9, 9, 30))
  recordSpend('a', 50, at(9, 10))
  assert.equal(readMoney({ sessionId: 'a', now: at(9, 11) }).spentUsd, 50)
  // A tick that changes nothing, or that has no cost yet, writes nothing.
  const stamp = new Date(at(9, 10))
  fs.utimesSync(spendFile(home, 'a'), stamp, stamp)
  recordSpend('a', 50, at(9, 10, 5))
  assert.equal(fs.statSync(spendFile(home, 'a')).mtimeMs, stamp.getTime())
  recordSpend('z', undefined, at(9, 10))
  assert.equal(fs.existsSync(spendFile(home, 'z')), false)
  // /clear gives a new id that starts at its own first reading.
  recordSpend('b', 3, at(9, 12))
  recordSpend('b', 10, at(9, 13))
  assert.equal(readMoney({ sessionId: 'a', now: at(9, 14) }).spentUsd, 57)
})

test('two sessions at once are both counted, and a session found to be a subscription is taken back out', () => {
  const home = fresh()
  setBilling('a', 'payg')
  for (const [id, base] of [['a', 0], ['b', 500]]) {
    recordSpend(id, base, at(10, 9))
    recordSpend(id, base + 30, at(10, 10))
  }
  fs.copyFileSync(spendFile(home, 'b'), `${home}/spend/b.json.123.tmp`) // a write in flight is not read
  assert.equal(readMoney({ sessionId: 'a', now: at(10, 11) }).spentUsd, 60)
  dropSpend('b')
  assert.equal(fs.existsSync(spendFile(home, 'b')), false)
  assert.equal(readMoney({ sessionId: 'a', now: at(10, 11) }).spentUsd, 30)
})

test('setting a mark of one kind clears the other and keeps the rest of the session file', () => {
  const home = fresh()
  setBilling('s', 'payg')
  setSessionMark('s', 80)
  setSessionMark('s', { usd: 5500 })
  assert.deepEqual(json(sessionFile(home, 's')), { billing: 'payg', markUsd: 5500 })
  assert.equal(sessionMark('s'), 75, 'a dollar mark is not read as a share')
  setSessionMark('s', 90)
  assert.deepEqual(json(sessionFile(home, 's')), { billing: 'payg', markPercent: 90 })
})

test('setting the billing writes only when it changes and leaves the mark alone', () => {
  const home = fresh()
  assert.equal(setBilling('s', 'unclear'), true)
  setSessionMark('s', { usd: 3500 })
  assert.equal(setBilling('s', 'unclear'), false)
  assert.equal(setBilling('s', 'payg'), true)
  assert.deepEqual(json(sessionFile(home, 's')), { billing: 'payg', markUsd: 3500 })
})

test('a share mark moves with a new weekly cap and a dollar mark stays where it was set', () => {
  fresh()
  for (const id of ['share', 'usd']) setBilling(id, 'payg')
  setSessionMark('share', 80)
  setSessionMark('usd', { usd: 5500 })
  const marks = () => ['share', 'usd'].map((id) => readMoney({ sessionId: id, now: at(10, 9) }).markUsd)
  assert.deepEqual(marks(), [3200, 5500])
  assert.equal(readCap(), null)
  writeCap(5000, at(10, 8))
  assert.equal(readMoney({ sessionId: 'share', now: at(10, 9) }).capAssumed, false)
  assert.deepEqual(marks(), [4000, 5500])
})

test('at the dollar mark the run is gated until 08:00, and the gate holds only while the 7-day spend is at the mark', () => {
  const home = fresh()
  setBilling('d', 'payg')
  writeCap(1000, at(1))
  // $800 spent on June 3, $10 on the 9th: $810 in the week on the 9th, over the $750 mark.
  recordSpend('d', 0, at(3, 9))
  recordSpend('d', 800, at(3, 10))
  recordSpend('d', 810, at(9, 22))
  const run = runOf(home, 'd')
  const now = at(9, 23)
  const money = readMoney({ sessionId: 'd', now, state: run.state })
  assert.equal(applyGate(run.paths, run.state, null, now, money), true)
  const gate = json(run.paths.gate)
  assert.deepEqual({ ...gate, at: 0 }, { reason: 'mark', unit: 'usd', markUsd: 750, usedUsd: 810, retryAt: at(10, 8), retried: false, at: 0 })
  assert.equal(gateHolds(run.paths, run.state, now), true)
  assert.equal(readMoney({ sessionId: 'd', now, state: run.state }).retryAt, at(10, 8))
  // On the 10th at 11:00 the $800 of the 3rd has dropped out: new agents may start again, at any hour.
  assert.equal(gateHolds(run.paths, run.state, at(10, 11)), false)
})

test('a dollar gate never stops a session that turned out to be a subscription', () => {
  const home = fresh()
  setBilling('d', 'subscription')
  const run = runOf(home, 'd')
  fs.writeFileSync(run.paths.gate, JSON.stringify({ reason: 'mark', unit: 'usd', markUsd: 3000, usedUsd: 3020, retryAt: at(10, 8), retried: false, at: at(9, 10) }))
  assert.equal(gateHolds(run.paths, run.state, at(9, 12)), false)
})

test('a run paused at its dollar mark keeps its gate under the mark, waiting for 08:00; a running one loses it', () => {
  const home = fresh()
  setBilling('d', 'payg')
  recordSpend('d', 0, at(9, 9))
  recordSpend('d', 100, at(9, 10))
  const gate = { reason: 'mark', unit: 'usd', markUsd: 3000, usedUsd: 3020, retryAt: at(10, 8), retried: false, at: at(9, 10) }
  const paused = runOf(home, 'd', { status: 'paused', pausedReason: 'mark' })
  fs.writeFileSync(paused.paths.gate, JSON.stringify(gate))
  const now = at(9, 12)
  const money = readMoney({ sessionId: 'd', now })
  assert.equal(applyGate(paused.paths, paused.state, null, now, money), false)
  assert.deepEqual(json(paused.paths.gate), gate)
  const running = { ...paused.state, status: 'running', pausedReason: null }
  applyGate(paused.paths, running, null, now, money)
  assert.equal(fs.existsSync(paused.paths.gate), false)
})

test('the run share is the session\'s own spend since the run began', () => {
  const home = fresh()
  setBilling('d', 'payg')
  recordSpend('d', 0, at(9, 9))
  recordSpend('d', 120, at(9, 10))
  const run = runOf(home, 'd', { usdAtStart: 20, usdBefore: 0 })
  assert.equal(readMoney({ sessionId: 'd', now: at(9, 11), state: run.state }).runUsd, 100)
  assert.equal('runUsd' in readMoney({ sessionId: 'd', now: at(9, 11) }), false)
})

test('without a money view the percent gate is written and checked as before', () => {
  const home = fresh()
  const run = runOf(home, 's1')
  const usage = { at: 1, sevenDay: { percentUsed: 80, resetsAt: new Date(at(12)).toISOString() } }
  fs.writeFileSync(`${home}/usage.json`, JSON.stringify(usage))
  assert.equal(applyGate(run.paths, run.state, usage, at(10)), true)
  assert.deepEqual(json(run.paths.gate), { reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt: usage.sevenDay.resetsAt, at: at(10) })
  assert.equal(gateHolds(run.paths, run.state, at(10)), true)
  // Paused at the mark and under it again: the percent gate goes, as today.
  const under = { sevenDay: { ...usage.sevenDay, percentUsed: 70 } }
  assert.equal(applyGate(run.paths, run.state, under, at(10)), true)
  assert.equal(json(run.paths.gate).usedPercent, 80)
  fs.writeFileSync(`${home}/usage.json`, JSON.stringify(under))
  assert.equal(applyGate(run.paths, { ...run.state, status: 'paused', pausedReason: 'mark' }, usage, at(10)), false)
  assert.equal(fs.existsSync(run.paths.gate), false)
})

test('a spend file untouched for 8 days is kept but not read, and counts again once its session writes to it', () => {
  const home = fresh()
  setBilling('a', 'payg')
  for (const [id, base] of [['a', 0], ['b', 500]]) {
    recordSpend(id, base, at(10, 9))
    recordSpend(id, base + 30, at(10, 10))
  }
  const old = new Date(at(1))
  fs.utimesSync(spendFile(home, 'b'), old, old)
  assert.equal(readMoney({ sessionId: 'a', now: at(10, 11) }).spentUsd, 30)
  assert.ok(fs.existsSync(spendFile(home, 'b')), 'kept, so a resumed session is not counted twice')
  recordSpend('b', 545, at(10, 12))
  assert.equal(readMoney({ sessionId: 'a', now: at(10, 13) }).spentUsd, 75)
})
