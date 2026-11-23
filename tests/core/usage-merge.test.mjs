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
