import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { tmp, makeRepo, run, readJson, LIMIT_HOOK } from './helpers.mjs'
import { usageFile, sessionFile, spendFile } from '../../lib/key.mjs'
import { toldFile } from '../../lib/mark.mjs'

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0)
const NOTE = /billed per token/

/** A home and repo where session s1 is billed per token and has not been told. */
function setup() {
  const home = tmp('home')
  const repo = makeRepo()
  fs.writeFileSync(usageFile(home), '{}')
  fs.mkdirSync(`${home}/sessions`, { recursive: true })
  fs.writeFileSync(sessionFile(home, 's1'), JSON.stringify({ billing: 'payg' }))
  fs.mkdirSync(`${home}/spend`)
  fs.writeFileSync(spendFile(home, 's1'), JSON.stringify({ v: 1, base: 0, max: 100, q: { [Math.floor(NOW / 900000)]: 100 } }))
  return { home, repo }
}
const tool = (repo, command = 'npm test') => JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command } })
const prompt = (repo) => JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'UserPromptSubmit' })
const start = ({ home, repo }, input) => new Promise((resolve) => {
  const child = spawn('node', [LIMIT_HOOK], { cwd: repo, env: { ...process.env, LCW_HOME: home, LCW_NOW: String(NOW), CLAUDE_PID: '' }, stdio: ['pipe', 'pipe', 'ignore'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.on('close', (code) => resolve({ code, out }))
  child.stdin.end(input)
})
const told = (rs) => rs.filter((r) => NOTE.test(r.out)).length

test('parallel tool-call hooks of one billed-per-token session give the note in exactly one output', async () => {
  const f = setup()
  const rs = await Promise.all(Array.from({ length: 8 }, () => start(f, tool(f.repo))))
  assert.deepEqual(rs.map((r) => r.code), Array(8).fill(0))
  assert.equal(told(rs), 1)
  assert.equal(readJson(toldFile(f.home, 's1')).payg, true)
  assert.equal(readJson(sessionFile(f.home, 's1')).toldPayg, true)
})

test('a prompt racing tool calls gives the note once', async () => {
  const f = setup()
  const rs = await Promise.all([prompt(f.repo), tool(f.repo), tool(f.repo), prompt(f.repo)].map((i) => start(f, i)))
  assert.equal(told(rs), 1)
})

test('a later tool call and a later prompt give no note', async () => {
  const f = setup()
  assert.equal(told([await start(f, tool(f.repo))]), 1)
  assert.equal(told([await start(f, tool(f.repo)), await start(f, prompt(f.repo))]), 0)
})

test('a told record already there means the note was given', () => {
  const f = setup()
  fs.mkdirSync(`${f.home}/told`)
  fs.writeFileSync(toldFile(f.home, 's1'), JSON.stringify({ payg: true }))
  assert.doesNotMatch(run(LIMIT_HOOK, [], { home: f.home, cwd: f.repo, env: { LCW_NOW: String(NOW) }, input: tool(f.repo) }).out, NOTE)
})

test('a call that is one of the LCW commands carries the note once, and a later call does not', () => {
  const f = setup()
  const go = (command) => run(LIMIT_HOOK, [], { home: f.home, cwd: f.repo, env: { LCW_NOW: String(NOW) }, input: tool(f.repo, command) }).out
  assert.match(go('node /p/scripts/lcw.mjs status'), NOTE)
  assert.equal(readJson(toldFile(f.home, 's1')).payg, true)
  assert.doesNotMatch(go('node /p/scripts/lcw.mjs status'), NOTE)
  assert.doesNotMatch(go('npm test'), NOTE)
})
