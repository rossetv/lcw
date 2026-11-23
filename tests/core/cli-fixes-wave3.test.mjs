import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { tmp, makeRepo, git, lcw, readJson, started, CLI } from './helpers.mjs'

test('a stage move keeps a paused run paused', () => {
  const t = started('hold')
  assert.equal(t.cli('pause', 'mark').code, 0)
  const r = t.cli('stage', 'Spec')
  assert.equal(r.code, 0, r.out + r.err)
  const s = t.state()
  assert.equal(s.stage, 'Spec')
  assert.equal(s.status, 'paused')
  assert.equal(s.pausedReason, 'mark')
  assert.ok(s.pausedAt)
})

test('a value that is itself a flag is reported as a missing value', () => {
  const t = started('flags')
  const r = t.cli('checkpoint', '--keep', '--session', 'x')
  assert.equal(r.code, 1)
  assert.match(r.err + r.out, /--keep needs a value/)
})
