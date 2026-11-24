import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, run, ACTIVITY_HOOK } from './helpers.mjs'
import { activityFile } from '../../lib/key.mjs'

// The mod counts a failed call and writes its id in the record; the activity hook of an older list of hooks, which
// runs after it for the same call, must find it counted.

const failed = (id, more = {}) => JSON.stringify({ session_id: 'p1', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: id, error: 'exit 1', ...more })

function home(record) {
  const dir = tmp('home')
  fs.mkdirSync(`${dir}/activity`)
  fs.writeFileSync(activityFile(dir, 'p1'), JSON.stringify(record))
  return dir
}
const fire = (dir, input) => assert.equal(run(ACTIVITY_HOOK, [], { home: dir, input }).code, 0)
const record = (dir) => JSON.parse(fs.readFileSync(activityFile(dir, 'p1'), 'utf8'))

test('a failed call the mod has counted is not counted again by the activity hook', () => {
  const dir = home({ state: 'working', at: 5, fails: 1, failAt: 6, failIds: ['toolu_1'] })
  const was = fs.readFileSync(activityFile(dir, 'p1'), 'utf8')
  fire(dir, failed('toolu_1'))
  assert.equal(fs.readFileSync(activityFile(dir, 'p1'), 'utf8'), was, 'not written at all')
})

test('the activity hook counts each new failed call once, and keeps its id for whoever hears it next', () => {
  const dir = home({ state: 'working', at: 5, fails: 0 })
  fire(dir, failed('toolu_1'))
  fire(dir, failed('toolu_1'))
  fire(dir, failed('toolu_2'))
  assert.deepEqual([record(dir).fails, record(dir).failIds], [2, ['toolu_1', 'toolu_2']])
})

test('the ids of counted calls last through a question to the person, and a new prompt starts the turn clean', () => {
  const dir = home({ state: 'working', at: 5, fails: 0 })
  fire(dir, failed('toolu_1'))
  fire(dir, JSON.stringify({ session_id: 'p1', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }))
  fire(dir, failed('toolu_1'))
  assert.deepEqual([record(dir).state, record(dir).fails], ['needs', 1])
  fire(dir, JSON.stringify({ session_id: 'p1', hook_event_name: 'UserPromptSubmit' }))
  assert.deepEqual(Object.keys(record(dir)).sort(), ['at', 'fails', 'state'])
})

test('an interrupted call and a subagent\'s failed call are not counted', () => {
  const dir = home({ state: 'working', at: 5, fails: 0 })
  fire(dir, failed('toolu_1', { is_interrupt: true }))
  fire(dir, failed('toolu_2', { agent_id: 'a1' }))
  assert.equal(record(dir).fails, 0)
})
