import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fixtures, drawFixture, expectedFile } from './golden/fixtures.mjs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')

describe('the status line prints the same bytes, second by second', () => {
  for (const f of fixtures) {
    test(f.name, async () => {
      const want = JSON.parse(fs.readFileSync(expectedFile(f), 'utf8'))
      const got = await drawFixture(ROOT, f)
      assert.equal(got.length, want.length)
      for (const [i, bytes] of got.entries()) assert.equal(bytes, want[i], `${f.name}, second ${i}`)
    })
  }
})

test('no two fixtures pin the same bytes', () => {
  const seen = new Map()
  for (const f of fixtures.filter((x) => !x.sameAs)) {
    const key = fs.readFileSync(expectedFile(f), 'utf8')
    assert.ok(!seen.has(key), `${f.name} pins the same bytes as ${seen.get(key)}`)
    seen.set(key, f.name)
  }
})
