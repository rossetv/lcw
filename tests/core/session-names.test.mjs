import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sessionNames } from '../../lib/key.mjs'

// rows by name, the processes that run, and the caller's own Claude Code (0: CLAUDE_PID unset).
const names = (transcript, id, rows = {}, running = [], pid = 0) =>
  sessionNames(transcript, id, (name) => rows[name] ?? null, (p) => running.includes(p), pid)

test('a session known by one name is known by that name alone', () => {
  assert.deepEqual(names(null, 's1'), ['s1'])
  assert.deepEqual(names('t1', undefined), ['t1'])
  assert.deepEqual(names('s1', 's1'), ['s1'])
})

test('a resumed session is known by its transcript\'s name first, then its id', () => {
  assert.deepEqual(names('t1', 's1'), ['t1', 's1'])
  assert.deepEqual(names('t1', 's1', { t1: { claudePid: 40 }, s1: { claudePid: 40 } }, [], 40), ['t1', 's1'])
})

test('a transcript row another running Claude Code keeps is set aside', () => {
  assert.deepEqual(names('t1', 's1', { t1: { claudePid: 40 } }, [40], 50), ['s1'])
  // With no CLAUDE_PID, the id's own row tells whose the session is.
  assert.deepEqual(names('t1', 's1', { t1: { claudePid: 40 }, s1: { claudePid: 50 } }, [40, 50]), ['s1'])
  assert.deepEqual(names('t1', 's1', { t1: { claudePid: 40 }, s1: { claudePid: 40 } }, [40]), ['t1', 's1'])
})

test('a recorded Claude Code that no longer runs, or is the caller, sets no row aside', () => {
  assert.deepEqual(names('t1', 's1', { t1: { claudePid: 40 }, s1: { claudePid: 60 } }, [], 50), ['t1', 's1'])
  assert.deepEqual(names('t1', 's1', { t1: { claudePid: 50 }, s1: { claudePid: 50 } }, [50], 50), ['t1', 's1'])
})

test('an id row another running Claude Code keeps is set aside only when the caller knows its own', () => {
  assert.deepEqual(names('t1', 's1', { s1: { claudePid: 60 } }, [60], 50), ['t1'])
  assert.deepEqual(names('t1', 's1', { s1: { claudePid: 60 } }, [60]), ['t1', 's1'])
})

// Both the limit hook (through sessionIds) and the mod's after-call marker choose a session's names with sessionNames,
// so the marker cannot stay down for names the hook reads.
test('the limit hook and the mod both choose the names with sessionNames', () => {
  const body = (file, start) => {
    const text = fs.readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
    const from = text.indexOf(start)
    assert.ok(from >= 0, `${start} in ${file}`)
    return text.slice(from, text.indexOf('\n}\n', from))
  }
  assert.match(body('../../scripts/lib/gate.mjs', 'export function sessionIds('), /\bsessionNames\(/)
  assert.match(body('../../hooks/register.tsx', 'async function afterDue('), /\bsessionNames\(/)
})
