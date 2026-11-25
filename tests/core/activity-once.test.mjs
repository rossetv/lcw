import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { tmp, run, ACTIVITY_HOOK } from './helpers.mjs'
import { activityFile } from '../../lib/key.mjs'

const failed = (id, more = {}) => JSON.stringify({ session_id: 'p1', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: id, error: 'exit 1', ...more })

function home(record = { state: 'working', at: 5, fails: 0 }) {
  const dir = tmp('home')
  fs.mkdirSync(`${dir}/activity`)
  fs.writeFileSync(activityFile(dir, 'p1'), JSON.stringify(record))
  return dir
}
const fire = (dir, input) => assert.equal(run(ACTIVITY_HOOK, [], { home: dir, input }).code, 0)
const record = (dir) => JSON.parse(fs.readFileSync(activityFile(dir, 'p1'), 'utf8'))
const lockOf = (dir) => `${activityFile(dir, 'p1')}.lock`

const fireAsync = (dir, input) => new Promise((resolve) => {
  const p = spawn('node', [ACTIVITY_HOOK], { env: { ...process.env, LCW_HOME: dir }, stdio: ['pipe', 'ignore', 'ignore'] })
  p.on('close', resolve)
  p.stdin.end(input)
})

test('failures of parallel calls each add one', async () => {
  const dir = home()
  const ids = Array.from({ length: 8 }, (_, i) => `toolu_${i}`)
  const codes = await Promise.all(ids.map((id) => fireAsync(dir, failed(id))))
  assert.deepEqual(codes, ids.map(() => 0))
  assert.equal(record(dir).fails, 8)
  assert.equal(fs.existsSync(lockOf(dir)), false, 'the lock is removed')
})

test('the same failed call heard twice adds one, and keeps its id', () => {
  const dir = home()
  fire(dir, failed('toolu_1'))
  fire(dir, failed('toolu_1'))
  fire(dir, failed('toolu_2'))
  assert.deepEqual([record(dir).fails, record(dir).failIds], [2, ['toolu_1', 'toolu_2']])
})

test('the ids of counted calls last through a question to the person, and a new prompt starts the turn clean', () => {
  const dir = home()
  fire(dir, failed('toolu_1'))
  fire(dir, JSON.stringify({ session_id: 'p1', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }))
  fire(dir, failed('toolu_1'))
  assert.deepEqual([record(dir).state, record(dir).fails], ['needs', 1])
  fire(dir, JSON.stringify({ session_id: 'p1', hook_event_name: 'UserPromptSubmit' }))
  assert.deepEqual(Object.keys(record(dir)).sort(), ['at', 'fails', 'state'])
})

test('an interrupted call and a subagent\'s failed call are not counted', () => {
  const dir = home()
  fire(dir, failed('toolu_1', { is_interrupt: true }))
  fire(dir, failed('toolu_2', { agent_id: 'a1' }))
  assert.equal(record(dir).fails, 0)
})

test('a stale lock is broken and the failure counted', () => {
  const dir = home()
  fs.writeFileSync(lockOf(dir), '')
  const old = new Date(Date.now() - 10000)
  fs.utimesSync(lockOf(dir), old, old)
  fire(dir, failed('toolu_1'))
  assert.equal(record(dir).fails, 1)
  assert.equal(fs.existsSync(lockOf(dir)), false)
})

test('a lock that stays held never makes the hook fail or hang, and is left to its holder', () => {
  const dir = home()
  fs.writeFileSync(lockOf(dir), '')
  const t = Date.now()
  fire(dir, failed('toolu_1'))
  assert.ok(Date.now() - t < 1500)
  assert.equal(record(dir).fails, 1)
  assert.equal(fs.existsSync(lockOf(dir)), true)
})

test('a session that ends removes its record and a lock left beside it, and no other session\'s', () => {
  const dir = home()
  const other = `${activityFile(dir, 'p2')}.lock`
  fs.writeFileSync(lockOf(dir), '')
  fs.writeFileSync(other, '')
  fire(dir, JSON.stringify({ session_id: 'p1', hook_event_name: 'SessionEnd' }))
  assert.equal(fs.existsSync(activityFile(dir, 'p1')), false)
  assert.equal(fs.existsSync(lockOf(dir)), false)
  assert.equal(fs.existsSync(other), true)
})
