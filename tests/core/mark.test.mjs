import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { tmp, makeRepo, run, cli, LIMIT_HOOK, CLI } from './helpers.mjs'
import { quotaFile, sessionFile, spendFile, usageFile, capFile } from '../../lib/key.mjs'
import { cases } from './mark-cases.mjs'

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0)
const QUARTER = Math.floor(NOW / 900000)
const SELECTION = { sourceId: 'external-quota', endpoint: 'http://localhost:8080/v1' }
const QUOTA = { ok: [80, false], blocked: [42, true], under: [42, false] }
const CALLS = {
  prompt: { hook_event_name: 'UserPromptSubmit' },
  tool: { hook_event_name: 'PostToolUse', tool_name: 'Edit' },
  lcw: { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'node /p/scripts/lcw.mjs mark 5500usd' } },
  agent: { hook_event_name: 'PostToolUse', tool_name: 'Edit', agent_id: 'a1' },
}
const put = (file, value) => { fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)) }

// Two processes that run for the whole file stand for the rows' running pids; a pid no process holds stands for each ended one.
const running = [0, 1].map(() => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' }))
after(() => running.forEach((kid) => kid.kill()))
const ENDED = 2000000000

/** The pid that stands for each pid the row names: a running process for each in row.running, an unheld pid for every other. */
function processes(row) {
  const named = new Set([...Object.values(row.sessions ?? {}).map((s) => s.claudePid), row.pid].filter(Boolean))
  const real = new Map()
  let ended = 0
  for (const pid of named) real.set(pid, row.running?.includes(pid) ? running[row.running.indexOf(pid)].pid : ENDED + ended++)
  return real
}

/** A home in the row's state; returns the home, the repo, and a way to put the session files back as they were. */
async function build(row, real) {
  const home = tmp('home')
  const repo = makeRepo()
  const sessions = {}
  if (row.run) {
    const r = await cli(['start', 'demo', '--title', 'Demo run'], { home, cwd: repo, session: row.run })
    sessions.p1 = { runDir: /^folder: (.+)$/m.exec(r.out)[1] }
  }
  for (const [id, body] of Object.entries(row.sessions ?? {})) sessions[id] = { ...sessions[id], ...body, ...(body.claudePid ? { claudePid: real.get(body.claudePid) } : {}) }
  for (const id of Object.keys(row.quota ?? {})) sessions[id] = { ...sessions[id], quotaSelection: SELECTION, billing: 'subscription' }
  for (const [id, body] of Object.entries(sessions)) put(sessionFile(home, id), { ...(fs.existsSync(sessionFile(home, id)) ? JSON.parse(fs.readFileSync(sessionFile(home, id), 'utf8')) : {}), ...body })
  for (const [id, usd] of Object.entries(row.spend ?? {})) put(spendFile(home, id), { v: 1, base: 0, max: usd, q: { [QUARTER]: usd } })
  if (row.week !== undefined) put(usageFile(home), { at: 1, sevenDay: { percentUsed: row.week, resetsAt: '2026-06-12T12:00:00.000Z' } })
  if (row.cap) put(capFile(home), { usd: row.cap, at: '2026-06-01T00:00:00.000Z' })
  const [percentUsed, blocked] = QUOTA[Object.values(row.quota ?? {}).find((v) => v !== 'missing')] ?? []
  if (percentUsed !== undefined) {
    const result = { v: 1, status: 'ok', accountKey: 'a'.repeat(64), weekly: { percentUsed, resetsAt: '2026-06-14T12:00:00.000Z' }, blocked }
    const attemptedAt = NOW - 60000
    put(quotaFile(home), { v: 1, enabled: true, sourceId: SELECTION.sourceId, revision: 'r1', endpoint: SELECTION.endpoint, command: 'adapter', lastAttemptAt: NOW, cache: { revision: 'r1', requestId: 'q1', attemptedAt, completedAt: attemptedAt, result } })
  }
  const saved = Object.fromEntries(Object.keys(sessions).map((id) => [id, fs.readFileSync(sessionFile(home, id), 'utf8')]))
  const reset = () => { fs.rmSync(`${home}/told`, { recursive: true, force: true }); for (const [id, text] of Object.entries(saved)) fs.writeFileSync(sessionFile(home, id), text) }
  return { home, repo, reset }
}

const say = (r) => (r.out.trim() ? JSON.parse(r.out).hookSpecificOutput.additionalContext : null)

for (const row of cases) {
  test(`the usage mark: ${row.name}`, async () => {
    const real = processes(row)
    const { home, repo, reset } = await build(row, real)
    const env = { LCW_NOW: String(NOW), ...(row.pid ? { CLAUDE_PID: String(real.get(row.pid)) } : {}) }
    const transcript = row.transcript ? { transcript_path: `/t/${row.transcript}.jsonl` } : {}
    for (const [call, want] of Object.entries(row.expect)) {
      reset() // the once-only note is written by the first call
      const r = run(LIMIT_HOOK, [], { home, cwd: repo, env, input: JSON.stringify({ session_id: 'p1', cwd: repo, ...transcript, ...CALLS[call] }) })
      assert.equal(r.code, 0, r.err)
      const cli = `node ${CLI}`
      assert.equal(say(r), want === null ? null : want.replaceAll('{cli}', cli), call)
    }
  })
}
