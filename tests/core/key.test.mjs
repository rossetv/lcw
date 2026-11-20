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
