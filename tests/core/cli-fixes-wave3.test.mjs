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

test('two starts with the same name at the same instant get two runs', async () => {
  const home = tmp('home')
  const repo = makeRepo()
  const env = { ...process.env, LCW_HOME: home, LCW_NOW: String(Date.parse('2026-01-01T12:00:00Z')), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  const go = (session) => new Promise((resolve) => {
    const c = spawn('node', [CLI, 'start', 'same', '--title', `T ${session}`], { cwd: repo, env: { ...env, CLAUDE_CODE_SESSION_ID: session } })
    let out = ''
    c.stdout.on('data', (d) => { out += d })
    c.on('close', () => resolve(/^folder: (.+)$/m.exec(out)?.[1]))
  })
  const [a, b] = await Promise.all([go('sa'), go('sb')])
  assert.ok(a && b)
  assert.notEqual(a, b)
  assert.deepEqual([readJson(`${a}/state.json`).title, readJson(`${b}/state.json`).title].sort(), ['T sa', 'T sb'])
})
