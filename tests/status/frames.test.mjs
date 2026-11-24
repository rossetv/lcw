import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp } from '../core/helpers.mjs'
import { sweepTemp } from '../../scripts/lib/store.mjs'

const NOW = Date.UTC(2026, 2, 10, 12)
const DAY = 86400_000

function aged(file, ms, text = '{}') {
  fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true })
  fs.writeFileSync(file, text)
  fs.utimesSync(file, (NOW - ms) / 1000, (NOW - ms) / 1000)
}

test('the sweep clears git records not written for a day, and every old diff record', () => {
  const home = tmp('home')
  aged(`${home}/cache/git-00000001.json`, DAY + 1000)
  aged(`${home}/cache/git-00000002.json`, DAY - 1000)
  aged(`${home}/cache/diff-00000003.json`, 1000)
  aged(`${home}/cache/context-s1.json`, 2 * DAY)
  sweepTemp(home, NOW)
  assert.deepEqual(fs.readdirSync(`${home}/cache`).sort(), ['context-s1.json', 'git-00000002.json'])
})
