import { test } from 'node:test'
import assert from 'node:assert/strict'
import { updateFile, checksFile, repoChecksFile, cleanupFile, awakeFile, runPaths } from '../../lib/key.mjs'

test('the shared paths name the update, check, cleanup and keep-awake files', () => {
  assert.equal(updateFile('/h'), '/h/update.json')
  assert.equal(checksFile('/h'), '/h/checks.json')
  assert.equal(repoChecksFile('/h', 'k'), '/h/repos/k/checks.json')
  assert.equal(cleanupFile('/h', 'k'), '/h/repos/k/cleanup.json')
  assert.equal(awakeFile('/r'), '/r/awake')
  assert.equal(runPaths('/r').awake, '/r/awake')
})

import { sessionFile, spendFile, contextFile, activityFile, afterFile } from '../../lib/key.mjs'
import { toldFile } from '../../lib/mark.mjs'

const byId = { sessionFile, spendFile, contextFile, activityFile, afterFile, toldFile }
const bad = ['../x', '../../../ESCAPED', 'a/b', '..', '.', '', 'x'.repeat(129), 'a\0b', 'a\nb', '$(id)', '`id`', 'a b', 'é', 'abc\n']

test('a real session id keeps its file name byte for byte', () => {
  for (const id of ['abc-123_XYZ', '0f8fad5b-d9cb-469f-a165-70867728950e', 'x'.repeat(128)]) {
    assert.equal(sessionFile('/h', id), `/h/sessions/${id}.json`)
    assert.equal(spendFile('/h', id), `/h/spend/${id}.json`)
    assert.equal(contextFile('/h', id), `/h/cache/context-${id}.json`)
    assert.equal(activityFile('/h', id), `/h/activity/${id}.json`)
    assert.equal(afterFile('/h', id), `/h/after/${id}`)
    assert.equal(toldFile('/h', id), `/h/told/${id}.json`)
  }
})

test('a session id that is not a plain name stays in its folder and names no real session', () => {
  const real = ['x', 'ESCAPED', 'invalid']
  for (const [name, fn] of Object.entries(byId)) {
    const seen = new Set()
    for (const id of bad) {
      const path = fn('/h', id)
      const rest = path.slice('/h/'.length)
      assert.equal(rest.split('/').length, 2, `${name}(${JSON.stringify(id)}) -> ${path}`)
      assert.ok(!/(^|\/)\.\.(\/|$)/.test(rest), path)
      assert.ok(/^[A-Za-z0-9_./-]+$/.test(path), path)
      for (const r of real) assert.notEqual(path, fn('/h', r))
      assert.ok(!seen.has(path), `${name} gives one path to two bad ids`)
      seen.add(path)
    }
  }
})
