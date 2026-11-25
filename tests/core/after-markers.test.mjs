import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { run, tmp, fakeClaude, START_HOOK, ACTIVITY_HOOK } from './helpers.mjs'

const env = { LCW_AUTH_STATUS_JSON: '{}' }
const marker = (home, name, content, ageMs = 0) => {
  fs.mkdirSync(`${home}/after`, { recursive: true })
  const f = `${home}/after/${name}`
  fs.writeFileSync(f, content)
  const t = new Date(Date.now() - ageMs)
  fs.utimesSync(f, t, t)
  return f
}
const row = (home, id, claudePid) => {
  fs.mkdirSync(`${home}/sessions`, { recursive: true })
  fs.writeFileSync(`${home}/sessions/${id}.json`, JSON.stringify({ claudePid }))
}
const body = (session, transcript = null) => JSON.stringify({ session, transcript, at: 1 })
const start = (home, session = 'new-session') => run(START_HOOK, [], { home, cwd: tmp('cwd'), input: JSON.stringify({ session_id: session, source: 'startup', cwd: tmp('cwd') }), env })

test('a crashed session\'s marker goes at the next start', () => {
  const home = tmp('home')
  const f = marker(home, 'dead', body('dead'))
  row(home, 'dead', 2 ** 22 + 12345) // no such process
  assert.equal(start(home).code, 0)
  assert.equal(fs.existsSync(f), false)
})

test('a marker whose recorded Claude Code runs stays, found by the transcript name in its content', () => {
  const home = tmp('home')
  const child = fakeClaude()
  try {
    const f = marker(home, 'sid', body('sid', 'transcript-1'), 3600_000)
    row(home, 'transcript-1', child.pid)
    assert.equal(start(home).code, 0)
    assert.equal(fs.existsSync(f), true)
  } finally { child.kill() }
})

test('an old marker with no sign of life goes, a recent one stays', () => {
  const home = tmp('home')
  const old = marker(home, 'old', body('old'), 3600_000)
  const fresh = marker(home, 'fresh', body('fresh'))
  start(home)
  assert.equal(fs.existsSync(old), false)
  assert.equal(fs.existsSync(fresh), true)
})

test('an empty marker goes', () => {
  const home = tmp('home')
  const f = marker(home, 'idle', '')
  start(home)
  assert.equal(fs.existsSync(f), false)
})

test('a broken marker and an unreadable one do not fail the start', () => {
  const home = tmp('home')
  const broken = marker(home, 'broken', '{not json', 3600_000)
  fs.mkdirSync(`${home}/after/a-folder`, { recursive: true })
  const r = start(home)
  assert.equal(r.code, 0)
  assert.match(r.out, /LCW is installed/)
  assert.equal(fs.existsSync(broken), false)
})

test('only SessionEnd removes the marker, and only the ending session\'s own', () => {
  const home = tmp('home')
  const own = marker(home, 'sid-9', body('sid-9', 'transcript-9'))
  const named = marker(home, 'transcript-9', body('sid-9', 'transcript-9'))
  const other = marker(home, 'other', body('other'))
  const send = (hook_event_name) => run(ACTIVITY_HOOK, [], { home, input: JSON.stringify({ hook_event_name, session_id: 'sid-9', transcript_path: '/x/transcript-9.jsonl' }) })
  for (const e of ['PostToolUse', 'UserPromptSubmit', 'Stop']) {
    assert.equal(send(e).code, 0)
    assert.equal(fs.existsSync(own), true, e)
  }
  assert.equal(send('SessionEnd').code, 0)
  assert.equal(fs.existsSync(own), false)
  assert.equal(fs.existsSync(named), true)
  assert.equal(fs.existsSync(other), true)
})
