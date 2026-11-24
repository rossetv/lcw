import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { tmp, makeRepo, run, readJson, LIMIT_HOOK, ACTIVITY_HOOK } from './helpers.mjs'
import { usageFile, activityFile } from '../../lib/key.mjs'
import { cases } from './mark-cases.mjs'

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0)
const atMark = cases.find((c) => c.name === 'the percent mark, no run')
const prompt = (repo, more = {}) => JSON.stringify({ session_id: 'p1', cwd: repo, hook_event_name: 'UserPromptSubmit', ...more })

/** A home where session p1 is at its mark and was last seen failing tool calls. */
function setup() {
  const home = tmp('home')
  const repo = makeRepo()
  fs.writeFileSync(usageFile(home), JSON.stringify({ at: 1, sevenDay: { percentUsed: atMark.week, resetsAt: '2026-06-12T12:00:00.000Z' } }))
  fs.mkdirSync(`${home}/activity`)
  fs.writeFileSync(activityFile(home, 'p1'), JSON.stringify({ state: 'done', at: 5, fails: 4, failAt: 6 }))
  return { home, repo }
}

test('one run of the limit hook at a prompt says what it said and leaves the record the activity hook left', () => {
  const one = setup()
  const before = Date.now()
  const r = run(LIMIT_HOOK, [], { home: one.home, cwd: one.repo, env: { LCW_NOW: String(NOW) }, input: prompt(one.repo) })
  assert.equal(JSON.parse(r.out).hookSpecificOutput.additionalContext, atMark.expect.prompt)
  const record = readJson(activityFile(one.home, 'p1'))

  const two = setup()
  const a = run(ACTIVITY_HOOK, [], { home: two.home, cwd: two.repo, input: prompt(two.repo) })
  assert.equal(a.out, '')
  const old = readJson(activityFile(two.home, 'p1'))
  assert.deepEqual({ ...record, at: 0 }, { ...old, at: 0 })
  assert.deepEqual(record.fails, 0)
  assert.ok(record.at >= before && record.at <= Date.now(), 'stamped with the real clock, not LCW_NOW')
})

test('a session that still starts both hooks for a prompt ends with one record, whole', async () => {
  const { home, repo } = setup()
  const start = (script) => new Promise((resolve) => {
    const child = spawn('node', [script], { cwd: repo, env: { ...process.env, LCW_HOME: home, CLAUDE_PID: '' }, stdio: ['pipe', 'ignore', 'ignore'] })
    child.on('close', resolve)
    child.stdin.end(prompt(repo))
  })
  const codes = await Promise.all([LIMIT_HOOK, ACTIVITY_HOOK, LIMIT_HOOK, ACTIVITY_HOOK].map(start))
  assert.deepEqual(codes, [0, 0, 0, 0])
  const record = readJson(activityFile(home, 'p1'))
  assert.deepEqual({ state: record.state, fails: record.fails, keys: Object.keys(record).sort() }, { state: 'working', fails: 0, keys: ['at', 'fails', 'state'] })
  assert.deepEqual(fs.readdirSync(`${home}/activity`), ['p1.json'], 'no half-written file left')
})

test('the limit hook records nothing for a tool call, a subagent or a prompt with no session', () => {
  const { home, repo } = setup()
  const was = fs.readFileSync(activityFile(home, 'p1'), 'utf8')
  const same = (input) => { run(LIMIT_HOOK, [], { home, cwd: repo, input: JSON.stringify(input) }); return fs.readFileSync(activityFile(home, 'p1'), 'utf8') }
  assert.equal(same({ session_id: 'p1', cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'Edit' }), was)
  assert.equal(same({ session_id: 'p1', cwd: repo, hook_event_name: 'UserPromptSubmit', agent_id: 'a1' }), was)
  run(LIMIT_HOOK, [], { home, cwd: repo, input: JSON.stringify({ cwd: repo, hook_event_name: 'UserPromptSubmit' }) })
  assert.deepEqual(fs.readdirSync(`${home}/activity`), ['p1.json'])
})
