import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeUsage } from '../../lib/usage.mjs'

const R = '2026-06-14T00:00:00.000Z'
const R2 = '2026-06-21T00:00:00.000Z'
const week = (percentUsed, resetsAt) => ({ at: 1, sevenDay: { percentUsed, resetsAt }, source: 'statusline' })

test('a reading with no reset time never lowers the stored week or erases its reset time', () => {
  assert.deepEqual(mergeUsage(week(80, R), week(30, null)).sevenDay, { percentUsed: 80, resetsAt: R })
})

test('a higher reading with no reset time raises the figure and keeps the stored reset time', () => {
  assert.deepEqual(mergeUsage(week(70, R), week(80, null)).sevenDay, { percentUsed: 80, resetsAt: R })
})

test('a reading with a reset time still follows the window: same window keeps the higher, a later one replaces', () => {
  assert.equal(mergeUsage(week(80, R), week(30, R)).sevenDay.percentUsed, 80)
  assert.deepEqual(mergeUsage(week(80, R), week(10, R2)).sevenDay, { percentUsed: 10, resetsAt: R2 })
  assert.deepEqual(mergeUsage(week(80, null), week(30, null)).sevenDay, { percentUsed: 30, resetsAt: null })
})

test('a reading with no reset time replaces a stored week whose reset time has already passed', () => {
  const now = Date.parse('2026-06-14T12:00:00.000Z')
  const expired = week(95, '2026-06-14T11:00:00.000Z')
  assert.deepEqual(mergeUsage(expired, { ...week(88, null), at: now }).sevenDay, { percentUsed: 88, resetsAt: null })
})

const seen = (percentUsed, at, resetsAt = R) => ({ at, seen: at, sevenDay: { percentUsed, resetsAt }, source: 'statusline' })

test('after the limit is reset, the newer and far lower reading replaces the stored one, and an idle session\'s older high one does not put it back', () => {
  const reset = mergeUsage(seen(99, 100), seen(1, 200))
  assert.equal(reset.sevenDay.percentUsed, 1)
  assert.equal(mergeUsage(reset, seen(99, 150)), reset)
})

test('an idle session\'s older and lower reading never lowers the stored figure', () => {
  const stored = seen(80, 200)
  assert.equal(mergeUsage(stored, seen(30, 100)), stored)
})

test('a newer reading a point or two lower is another session\'s figure, not a reset, so the stored one stands', () => {
  const stored = seen(50, 100)
  assert.equal(mergeUsage(stored, seen(49, 200)), stored)
  assert.equal(mergeUsage(stored, seen(46, 200)), stored)
  assert.equal(mergeUsage(stored, seen(45, 200)).sevenDay.percentUsed, 45)
})

test('a newer and higher reading replaces the stored one, with the time it was seen', () => {
  assert.deepEqual(mergeUsage(seen(50, 100), seen(51, 200)), seen(51, 200))
})

test('a stored record from before readings said when they were seen counts from when it was written', () => {
  const old = { at: 100, sevenDay: { percentUsed: 99, resetsAt: R }, source: 'statusline' }
  assert.equal(mergeUsage(old, seen(1, 200)).sevenDay.percentUsed, 1)
  assert.equal(mergeUsage(old, seen(1, 50)), old)
})

test('a reading that does not say when it was seen keeps the higher figure', () => {
  assert.equal(mergeUsage(seen(80, 100), week(30, R)).sevenDay.percentUsed, 80)
  assert.equal(mergeUsage(seen(80, 100), week(90, R)).sevenDay.percentUsed, 90)
})
