import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp } from './helpers.mjs'
import { spendFile } from '../../lib/key.mjs'
import { readMoney, recordSpend, setBilling } from '../../scripts/lib/money.mjs'

process.env.TZ = 'Europe/Dublin'

const at = (day, h = 0) => new Date(2026, 5, day, h).getTime()

function fresh() {
  const home = tmp('home')
  process.env.LCW_HOME = home
  setBilling('s', 'payg')
  return home
}

test('a reading over a spend file caught mid-write leaves the file and the week figure alone', () => {
  const home = fresh()
  recordSpend('s', 0, at(10, 9))
  recordSpend('s', 40, at(10, 10))
  assert.equal(readMoney({ sessionId: 's', now: at(10, 11) }).spentUsd, 40)

  const file = spendFile(home, 's')
  for (const partial of ['', '{"v":1,"base":0,"max":4']) {
    fs.writeFileSync(file, partial)
    assert.equal(recordSpend('s', 41, at(10, 11)), null)
    assert.equal(fs.readFileSync(file, 'utf8'), partial, 'the half-written file is not replaced')
  }
})

test('a missing spend file still starts a record', () => {
  const home = fresh()
  assert.equal(recordSpend('s', 41, at(10, 11)).base, 41)
  assert.equal(JSON.parse(fs.readFileSync(spendFile(home, 's'), 'utf8')).max, 41)
})
