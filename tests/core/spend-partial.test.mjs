import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
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

test('a reading over an unparseable spend file modified just now leaves the file alone', () => {
  const home = fresh()
  recordSpend('s', 0, at(10, 9))
  recordSpend('s', 40, at(10, 10))
  assert.equal(readMoney({ sessionId: 's', now: at(10, 11) }).spentUsd, 40)

  const file = spendFile(home, 's')
  for (const partial of ['', '{"v":1,"base":0,"max":4']) {
    fs.writeFileSync(file, partial)
    fs.utimesSync(file, new Date(at(10, 11)), new Date(at(10, 11)))
    assert.equal(recordSpend('s', 41, at(10, 11)), null)
    assert.equal(fs.readFileSync(file, 'utf8'), partial, 'the half-written file is not replaced')
  }
})

test('a spend file that stayed unparseable for ten minutes is replaced by a fresh record', () => {
  const home = fresh()
  const file = spendFile(home, 's')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '{"v":1,"base":0,"max":4')
  const old = new Date(at(10, 11) - 10 * 60 * 1000)
  fs.utimesSync(file, old, old)
  assert.equal(recordSpend('s', 41, at(10, 11)).base, 41)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).max, 41)
})

test('a missing spend file still starts a record', () => {
  const home = fresh()
  assert.equal(recordSpend('s', 41, at(10, 11)).base, 41)
  assert.equal(JSON.parse(fs.readFileSync(spendFile(home, 's'), 'utf8')).max, 41)
})
