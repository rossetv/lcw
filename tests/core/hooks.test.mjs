import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { tmp, makeRepo, run, lcw, started, readJson, fakeClaude, START_HOOK, GATE_HOOK, LIMIT_HOOK, ACTIVITY_HOOK } from './helpers.mjs'
import * as gate from '../../scripts/lib/gate.mjs'

process.env.TZ = 'Europe/Dublin'
process.env.LCW_AUTH_STATUS_JSON = 'fail' // the sign-in is stubbed: no test runs the real `claude auth status`

const gateHook = (t, input, session = 's1') => run(GATE_HOOK, [], { home: t.home, cwd: t.repo, input: typeof input === 'string' ? input : JSON.stringify(input) })
const future = () => new Date(Date.now() + 86400000).toISOString()
const past = () => new Date(Date.now() - 1000).toISOString()
const weekAt = (home, pct) => fs.writeFileSync(`${home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: pct, resetsAt: future() } }))

test('gate hook allows with no run and on broken input', () => {
  const home = tmp('home')
  const repo = makeRepo()
  for (const input of [JSON.stringify({ session_id: 'x', cwd: repo }), 'not json', '']) {
    const r = run(GATE_HOOK, [], { home, cwd: repo, input })
    assert.equal(r.code, 0)
    assert.equal(r.err, '')
  }
})

test('gate hook allows a run below its mark', () => {
  const t = started()
  assert.equal(gateHook(t, { session_id: 's1', cwd: t.repo }).code, 0)
})

test('gate hook refuses at the mark and allows after the reset time', () => {
  const t = started()
  const usage = (resetsAt) => fs.writeFileSync(`${t.home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: 80, resetsAt } }))
  usage(future())
  t.cli('usage')
  const refused = gateHook(t, { session_id: 's1', cwd: t.repo })
  assert.equal(refused.code, 2)
  assert.match(refused.err, /usage mark/)
  assert.match(refused.err, /pause mark/)

  usage(past())
  const gate = JSON.parse(fs.readFileSync(`${t.dir}/gate`, 'utf8'))
  fs.writeFileSync(`${t.dir}/gate`, JSON.stringify({ ...gate, resetsAt: past() }))
  assert.equal(gateHook(t, { session_id: 's1', cwd: t.repo }).code, 0)
})

test('gate hook keeps refusing when the usage reading is gone but the gate still stands', () => {
  const t = started()
  fs.writeFileSync(`${t.home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: 80, resetsAt: future() } }))
  t.cli('usage')
  fs.rmSync(`${t.home}/usage.json`)
  assert.equal(gateHook(t, { session_id: 's1', cwd: t.repo }).code, 2)
})

test('a process started by a test is given a throwaway home, never the real one', () => {
  assert.ok(process.env.HOME.startsWith(fs.realpathSync(os.tmpdir())), process.env.HOME)
})

test("a session that is not on the run is held to its own mark, not the run's", () => {
  const t = started()
  weekAt(t.home, 80)
  t.cli('usage')
  assert.equal(gateHook(t, { session_id: 's1', cwd: t.repo }).code, 2, 'the run is at its mark of 75')
  lcw(['mark', '95'], { home: t.home, cwd: t.repo, session: 'other' })
  assert.equal(gateHook(t, { session_id: 'other', cwd: t.repo }).code, 0, 'its own mark lets the other session go on')
  assert.equal(gateHook(t, { session_id: 's1', cwd: t.repo }).code, 2, 'and does not lift the run')
})

test('session-start hook without a run prints the rule and the command', () => {
  const home = tmp('home')
  const repo = makeRepo()
  const r = run(START_HOOK, [], { home, cwd: repo, input: JSON.stringify({ session_id: 'a', cwd: repo }) })
  assert.equal(r.code, 0)
  assert.match(r.out, /lcw:lcw skill/)
  assert.match(r.out, /open goal[^\n]*load the lcw:lcw skill/, 'an open goal loads the skill as a large change does')
  assert.match(r.out, /nothing is changed without the user's go-ahead, whatever its size/)
  assert.match(r.out, /answer it and change nothing/)
  assert.ok(!/just make it/.test(r.out))
  assert.match(r.out, /scripts\/lcw\.mjs/)
  assert.ok(!/Unfinished/.test(r.out))
  assert.ok(!/past LCW runs/.test(r.out))
  assert.ok(r.out.split('\n').length <= 25)
  assert.ok(fs.existsSync(`${fs.readFileSync(`${home}/plugin-root`, 'utf8').trim()}/scripts/lcw.mjs`))
})

test('session-start hook with an unfinished run names it and the next step', () => {
  const t = started('carry')
  t.cli('stage', 'Spec')
  t.cli('checkpoint', 'run the blind review')
  const r = run(START_HOOK, [], { home: t.home, cwd: t.repo, input: JSON.stringify({ session_id: 's1', cwd: t.repo }) })
  assert.match(r.out, /Unfinished LCW run: \d{8}-carry/)
  assert.match(r.out, /Stage Spec, status running/)
  assert.match(r.out, /Next step: run the blind review/)
  assert.match(r.out, /carry on/)
})

test('session-start hook says why a run is paused: a pause by the user stays until they say so, one at the mark ends when the limit resets', () => {
  const t = started('hold')
  const said = () => run(START_HOOK, [], { home: t.home, cwd: t.repo, input: JSON.stringify({ session_id: 's1', cwd: t.repo }) }).out
  t.cli('pause', 'human')
  const human = said()
  assert.match(human, /status paused \(paused by the user\)/)
  assert.match(human, /stays paused until they say carry on/)
  assert.ok(!/Load the lcw:lcw skill and carry on/.test(human), human)
  t.cli('resume')
  t.cli('pause', 'mark')
  const mark = said()
  assert.match(mark, /status paused \(paused at the usage mark\)/)
  assert.ok(!/stays paused until they say/.test(mark), mark)
  assert.match(mark, /lcw\.mjs resume/)
})

test('session start finds the run of a resumed session by its transcript', () => {
  const t = started('resumed')
  const input = JSON.stringify({ session_id: 'process-7', transcript_path: '/x/projects/y/s1.jsonl', cwd: t.repo })
  assert.match(run(START_HOOK, [], { home: t.home, cwd: t.repo, input }).out, /Unfinished LCW run: \d{8}-resumed/)
})

test('session start says the mark the session really has, not always the default', () => {
  const home = tmp('home')
  const repo = makeRepo()
  const said = () => run(START_HOOK, [], { home, cwd: repo, input: JSON.stringify({ session_id: 'a', cwd: repo }) }).out
  assert.match(said(), /: 75% of the week/)
  lcw(['mark', '90'], { home, cwd: repo, session: 'a' })
  assert.match(said(), /: 90% of the week/)
})

test('session-start hook binds by place and does not take over from the main checkout', () => {
  const t = started('bindme')
  const wt = t.cli('worktree').out.trim()
  const inWt = run(START_HOOK, [], { home: t.home, cwd: wt, input: JSON.stringify({ session_id: 'resumed', cwd: wt }) })
  assert.match(inWt.out, /Unfinished LCW run/)
  assert.ok(fs.existsSync(`${t.home}/sessions/resumed.json`))
  const inMain = run(START_HOOK, [], { home: t.home, cwd: t.repo, input: JSON.stringify({ session_id: 'newcomer', cwd: t.repo }) })
  assert.ok(!/Unfinished/.test(inMain.out))
  assert.match(inMain.out, /past LCW runs/)
  assert.ok(!fs.existsSync(`${t.home}/sessions/newcomer.json`))
})

test('a new session in the worktree of a run another open session drives neither carries it on nor takes it', async () => {
  const t = started('busy')
  const wt = t.cli('worktree').out.trim()
  const claude = fakeClaude()
  const driver = `${t.home}/sessions/s1.json`
  fs.writeFileSync(driver, JSON.stringify({ ...readJson(driver), claudePid: claude.pid }))
  const start = (id, env) => run(START_HOOK, [], { home: t.home, cwd: wt, input: JSON.stringify({ session_id: id, cwd: wt }), env })
  try {
    assert.ok(!/Unfinished/.test(start('second').out))
    assert.equal(lcw(['task', 'add', 'T1', 'x'], { home: t.home, cwd: wt, session: 'second' }).code, 1, 'nor do its lcw calls drive it')
    assert.equal(t.state().driver, 's1')
    assert.equal(fs.existsSync(`${t.home}/sessions/second.json`), false)
    // /clear: a new session id in the driver's own Claude Code process carries on
    assert.match(start('cleared', { CLAUDE_PID: String(claude.pid) }).out, /Unfinished LCW run: \d{8}-busy/)
  } finally { claude.kill() }
  await new Promise((resolve) => (claude.exitCode !== null || claude.signalCode !== null ? resolve() : claude.once('exit', resolve)))
  // once the driver's Claude Code has closed, a session in the worktree carries the run on
  assert.match(start('later').out, /Unfinished LCW run: \d{8}-busy/)
})

test('session-start hook survives bad input', () => {
  const r = run(START_HOOK, [], { home: tmp('home'), cwd: tmp('x'), input: 'garbage' })
  assert.equal(r.code, 0)
  assert.match(r.out, /lcw:lcw skill/)
})

test('session start no longer offers setup, but still says how to set up and uninstall LCW', () => {
  const home = tmp('home')
  const repo = makeRepo()
  const out = run(START_HOOK, [], { home, cwd: repo, input: JSON.stringify({ session_id: 'a', cwd: repo }) }).out
  assert.ok(!/one-time setup/.test(out))
  assert.match(out, /"set up LCW"[^\n]*setup\.mjs install/)
  assert.ok(!/notices\.json/.test(out), 'the person\'s standing choices are not deleted')
})

test('session start records the id of Claude Code\'s process in the session file, keeping what is there', () => {
  const home = tmp('home')
  const repo = makeRepo()
  fs.mkdirSync(`${home}/sessions`)
  fs.writeFileSync(`${home}/sessions/a.json`, JSON.stringify({ markPercent: 90 }))
  spawnSync('node', [START_HOOK], { cwd: repo, env: { ...process.env, LCW_HOME: home, CLAUDE_PID: '4242' }, input: JSON.stringify({ session_id: 'a', cwd: repo }) })
  assert.equal(readJson(`${home}/sessions/a.json`).claudePid, 4242)
  assert.equal(readJson(`${home}/sessions/a.json`).markPercent, 90)
})

test('session start records the process id under both ids of a resumed payload', () => {
  const home = tmp('home')
  const repo = makeRepo()
  spawnSync('node', [START_HOOK], { cwd: repo, env: { ...process.env, LCW_HOME: home, CLAUDE_PID: '4242' }, input: JSON.stringify({ session_id: 'old', transcript_path: '/x/new.jsonl', cwd: repo }) })
  for (const id of ['old', 'new']) assert.equal(readJson(`${home}/sessions/${id}.json`).claudePid, 4242)
})

test('session start leaves a live process id in the old session\'s file alone', () => {
  const home = tmp('home')
  const repo = makeRepo()
  fs.mkdirSync(`${home}/sessions`)
  fs.writeFileSync(`${home}/sessions/old.json`, JSON.stringify({ claudePid: process.pid }))
  spawnSync('node', [START_HOOK], { cwd: repo, env: { ...process.env, LCW_HOME: home, CLAUDE_PID: '4242' }, input: JSON.stringify({ session_id: 'old', transcript_path: '/x/new.jsonl', cwd: repo }) })
  assert.equal(readJson(`${home}/sessions/old.json`).claudePid, process.pid)
  assert.equal(readJson(`${home}/sessions/new.json`).claudePid, 4242)
})

test('a session with no run is refused new agents at its mark, and allowed once the user raises it', () => {
  const home = tmp('home')
  const repo = makeRepo()
  weekAt(home, 80)
  const ask = () => run(GATE_HOOK, [], { home, cwd: repo, input: JSON.stringify({ session_id: 'solo', cwd: repo }) })
  const refused = ask()
  assert.equal(refused.code, 2)
  assert.match(refused.err, /usage mark/)
  lcw(['mark', '90'], { home, cwd: repo, session: 'solo' })
  assert.equal(ask().code, 0)
})

test('at its mark a session is told to stop on each prompt and after each tool call, until the mark is raised', () => {
  const home = tmp('home')
  const repo = makeRepo()
  const say = (more) => {
    const r = run(LIMIT_HOOK, [], { home, cwd: repo, input: JSON.stringify({ session_id: 'solo', cwd: repo, ...more }) })
    assert.equal(r.code, 0, r.err)
    return r.out.trim() ? JSON.parse(r.out).hookSpecificOutput : null
  }
  weekAt(home, 70)
  assert.equal(say({ hook_event_name: 'PostToolUse', tool_name: 'Edit' }), null, 'below the mark it says nothing')
  weekAt(home, 80)
  const onPrompt = say({ hook_event_name: 'UserPromptSubmit' })
  assert.equal(onPrompt.hookEventName, 'UserPromptSubmit')
  for (const fact of ['STOP', 'lcw:learn', '80%', '75%', 'run up to', 'lcw mark']) assert.ok(onPrompt.additionalContext.includes(fact), fact)
  assert.match(say({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'a.txt' } }).additionalContext, /^STOP!.*lcw:learn/)
  assert.equal(say({ hook_event_name: 'PostToolUse', tool_name: 'Edit', agent_id: 'a1' }), null, 'a subagent is left to finish')
  assert.equal(say({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'node /p/scripts/lcw.mjs mark 90' } }), null, 'the command that lifts the mark is not nagged')
  assert.match(say({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'grep -n mark scripts/lcw.mjs' } }).additionalContext, /^STOP!/, 'naming lcw.mjs is not calling it')
  lcw(['mark', '90'], { home, cwd: repo, session: 'solo' })
  assert.equal(say({ hook_event_name: 'UserPromptSubmit' }), null)
  assert.equal(say({ hook_event_name: 'PostToolUse', tool_name: 'Edit' }), null)
})

test('only a shell line that runs lcw and nothing else is spared the stop note', () => {
  for (const line of [
    'node /p/scripts/lcw.mjs pause mark',
    'node "/my plugins/lcw/scripts/lcw.mjs" status 2>&1',
    "node /p/scripts/lcw.mjs ledger 'check: kept the old name; it'\\''s what the spec says && no more'",
    'node /p/scripts/lcw.mjs task T1 done && node /p/scripts/lcw.mjs task T2 done',
    "node /p/scripts/lcw.mjs ledger 'ran `npm test`, all green'",
  ]) assert.equal(gate.lcwOnly(line), true, line)
  for (const line of [
    'grep -n mark scripts/lcw.mjs',
    'node /p/scripts/lcw.mjs task T1 running && npm test',
    'npm test; node /p/scripts/lcw.mjs task T1 done',
    'node /p/scripts/lcw.mjs status | tee /tmp/out',
    'node /p/scripts/lcw.mjs ledger "$(npm test)"',
    'node /p/scripts/lcw.mjs ledger "`npm test`"',
    '',
    undefined,
  ]) assert.equal(gate.lcwOnly(line), false, String(line))
})

test('the stop hook never blocks: on broken input it exits 0 and says nothing', () => {
  const r = run(LIMIT_HOOK, [], { home: tmp('home'), cwd: makeRepo(), input: 'not json' })
  assert.equal(r.code, 0)
  assert.equal(r.out, '')
})

test('a resumed session is known by its transcript, so the mark set from its shell is the one the hooks read', () => {
  const home = tmp('home')
  const repo = makeRepo()
  weekAt(home, 80)
  lcw(['mark', '90'], { home, cwd: repo, session: 'conversation-1' })
  const input = JSON.stringify({ session_id: 'process-7', transcript_path: '/x/projects/y/conversation-1.jsonl', cwd: repo, hook_event_name: 'UserPromptSubmit' })
  assert.equal(run(LIMIT_HOOK, [], { home, cwd: repo, input }).out, '')
  assert.equal(run(GATE_HOOK, [], { home, cwd: repo, input }).code, 0)
})

test('the activity hook records the turn and its failed calls for the mascot, prints nothing, and ignores a subagent', () => {
  const home = tmp('home')
  const fire = (o) => run(ACTIVITY_HOOK, [], { home, input: JSON.stringify({ session_id: 'a1', ...o }) })
  const record = () => JSON.parse(fs.readFileSync(`${home}/activity/a1.json`, 'utf8'))
  for (const [event, state, fails] of [
    [{ hook_event_name: 'UserPromptSubmit' }, 'working', 0],
    [{ hook_event_name: 'Stop', agent_id: 'sub-1' }, 'working', 0], // a subagent's event
    [{ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash' }, 'working', 1],
    [{ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', is_interrupt: true }, 'working', 1], // cancelled, not failed
    [{ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }, 'needs', 1],
    [{ hook_event_name: 'Notification', notification_type: 'idle_prompt' }, 'needs', 1], // closes only a turn still working
    [{ hook_event_name: 'Stop' }, 'done', 1],
    [{ hook_event_name: 'UserPromptSubmit' }, 'working', 0], // a new turn starts clean
    [{ hook_event_name: 'StopFailure' }, 'failed', 0],
  ]) {
    const r = fire(event)
    assert.equal(r.code, 0)
    assert.equal(r.out + r.err, '', 'what a hook prints on a prompt goes into the conversation')
    assert.deepEqual([record().state, record().fails], [state, fails], JSON.stringify(event))
  }
  assert.equal(fire({ hook_event_name: 'SessionEnd' }).code, 0)
  assert.ok(!fs.existsSync(`${home}/activity/a1.json`), 'a session that has ended leaves no record behind')
  assert.equal(run(ACTIVITY_HOOK, [], { home, input: 'not json' }).code, 0)
})

// ---- pay-per-token billing: what Claude is told ----

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0) // 10 June 2026, 12:00 UTC
const QUARTER = Math.floor(NOW / 900000)
const writeSession = (home, id, body) => { fs.mkdirSync(`${home}/sessions`, { recursive: true }); fs.writeFileSync(`${home}/sessions/${id}.json`, JSON.stringify(body)) }
const sessionOf = (home, id) => readJson(`${home}/sessions/${id}.json`)
/** A spend record: the session spent `usd` dollars in the quarter that is `hoursAgo` hours before NOW. */
const spent = (home, id, usd, hoursAgo = 0) => {
  fs.mkdirSync(`${home}/spend`, { recursive: true })
  fs.writeFileSync(`${home}/spend/${id}.json`, JSON.stringify({ v: 1, base: 0, max: usd, q: { [QUARTER - hoursAgo * 4]: usd } }))
}
const SUB = { LCW_AUTH_STATUS_JSON: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'me@example.test' }) }
const KEY = { LCW_AUTH_STATUS_JSON: JSON.stringify({ loggedIn: true, authMethod: 'api_key', email: 'me@example.test', orgName: 'Example Org' }) }
/** Runs a hook with the clock and the sign-in report set for it. */
function withEnv(env, fn) {
  const before = {}
  for (const k of Object.keys(env)) { before[k] = process.env[k]; process.env[k] = env[k] }
  try { return fn() } finally { for (const k of Object.keys(env)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k] } }
}
const clock = { LCW_NOW: String(NOW) }
const startNote = (home, repo, env, id = 'p1') => withEnv({ ...clock, ...env }, () => run(START_HOOK, [], { home, cwd: repo, input: JSON.stringify({ session_id: id, cwd: repo }) }).out)
const limit = (home, repo, more, id = 'p1') => withEnv(clock, () => {
  const r = run(LIMIT_HOOK, [], { home, cwd: repo, input: JSON.stringify({ session_id: id, cwd: repo, ...more }) })
  assert.equal(r.code, 0, r.err)
  return r.out.trim() ? JSON.parse(r.out).hookSpecificOutput.additionalContext : null
})
const spawnGate = (home, repo, id = 'p1') => withEnv(clock, () => run(GATE_HOOK, [], { home, cwd: repo, input: JSON.stringify({ session_id: id, cwd: repo }) }))

test('session start on a per-token sign-in states the mark in dollars, asks for the cap, and keeps nothing of the sign-in report', () => {
  const home = tmp('home')
  const repo = makeRepo()
  const out = startNote(home, repo, KEY)
  assert.match(out, /billed per token/)
  assert.ok(out.includes('A spend command, set with lcw spend-command, can supply the 7-day figure; set, change or turn it off only on the user\'s explicit words, as with the mark.'), 'the spend command clause')
  assert.ok(out.includes('$3,000 (75% of the $4,000 weekly cap, assumed)'), 'the mark in dollars')
  assert.ok(out.includes('an LCW banner above the prompt asks them. When they say "Set my weekly cap for LCW."'), 'the banner asks; Claude takes the figure')
  assert.ok(out.includes('When they say "Set up my LCW spend check."'), 'and the spend check')
  assert.ok(!out.includes('% of the week'), 'the percentage line is not given')
  assert.deepEqual(sessionOf(home, 'p1'), { billing: 'payg', toldPayg: true })
  for (const file of [`${home}/sessions/p1.json`, `${home}/plugin-root`]) assert.ok(!/example/i.test(fs.readFileSync(file, 'utf8')), 'no email or organisation is kept')
  assert.ok(!/example/i.test(out), 'nor said')
})

test('session start notes a Claude Code started with --advisor, and notes it again when a later start has none', () => {
  const home = tmp('home')
  const repo = makeRepo()
  startNote(home, repo, { ...KEY, LCW_CLAUDE_ARGS: 'claude --model opus --advisor fable' })
  assert.equal(sessionOf(home, 'p1').advisorFlag, true)
  startNote(home, repo, { ...KEY, LCW_CLAUDE_ARGS: 'claude --advisor=fable' })
  assert.equal(sessionOf(home, 'p1').advisorFlag, true)
  startNote(home, repo, { ...KEY, LCW_CLAUDE_ARGS: 'claude --resume --advisory-mode x' })
  assert.equal(sessionOf(home, 'p1').advisorFlag, false, 'a flag that only starts with --advisor is not it')
})

test('session start gives every command the note names in a form lcwOnly lets through, and asks no cap question once the cap is stated', () => {
  const home = tmp('home')
  const repo = makeRepo()
  fs.writeFileSync(`${home}/cap.json`, JSON.stringify({ usd: 5000, at: new Date(NOW).toISOString() }))
  const out = startNote(home, repo, KEY)
  assert.ok(!out.includes('Set my weekly cap'), 'a stated cap is not asked for again')
  assert.ok(out.includes('$3,750 (75% of the $5,000 weekly cap) unless the user raises it'))
  const commands = [...out.matchAll(/(node \S+\/lcw\.mjs (?:cap|mark) [\w%]+)/g)].map((m) => m[1])
  assert.deepEqual(commands.map((c) => c.split('lcw.mjs ')[1]), ['cap 5000', 'mark 5500usd', 'mark 80', 'mark 100'])
  for (const c of commands) assert.ok(gate.lcwOnly(c), c)
  assert.ok(!commands.some((c) => c.includes('$')), 'no dollar sign to quote')
})

test('session start names the dollar mark the session has, as a share of the cap or as dollars', () => {
  const home = tmp('home')
  const repo = makeRepo()
  writeSession(home, 'p1', { markPercent: 80 })
  assert.ok(startNote(home, repo, KEY).includes('$3,200 (80% of the $4,000 weekly cap, assumed), as the user set it'))
  writeSession(home, 'p2', { markUsd: 5500 })
  assert.ok(startNote(home, repo, KEY, 'p2').includes('usage mark, run or no run: $5,500, as the user set it'))
})

test('session start on a subscription, an unreadable sign-in or an unclear one says exactly what it said before, and stores no dollars', () => {
  const repo = makeRepo()
  const same = (out, home) => out.split(home).join('<home>') // the setup line names the home
  const homeFor = (env) => { const home = tmp('home'); return [home, same(startNote(home, repo, env), home)] }
  const [, plain] = homeFor({ LCW_AUTH_STATUS_JSON: 'fail' })
  assert.ok(plain.includes(': 75% of the week unless the user raises it. When they say "run up to N%"'))
  for (const env of [SUB, { LCW_AUTH_STATUS_JSON: 'fail' }, { LCW_AUTH_STATUS_JSON: 'not json' }, { LCW_AUTH_STATUS_JSON: JSON.stringify({ authMethod: 'oauth_token' }) }]) {
    const [home, out] = homeFor(env)
    assert.equal(out, plain, JSON.stringify(env))
    assert.ok(!/per token|weekly cap/.test(out))
    assert.ok(!fs.existsSync(`${home}/sessions/p1.json`) || sessionOf(home, 'p1').billing === 'subscription')
  }
  const [home] = homeFor(SUB)
  assert.deepEqual(sessionOf(home, 'p1'), { billing: 'subscription' })
})

test('session start never downgrades a settled subscription, and takes back the dollars of a session the sign-in says is a subscription', () => {
  const repo = makeRepo()
  const home = tmp('home')
  writeSession(home, 'p1', { billing: 'subscription' })
  const out = startNote(home, repo, KEY)
  assert.ok(!/per token/.test(out) && out.includes('% of the week'))
  assert.equal(sessionOf(home, 'p1').billing, 'subscription')
  const other = tmp('home')
  writeSession(other, 'p1', { billing: 'payg', toldPayg: true })
  spent(other, 'p1', 40)
  startNote(other, repo, SUB)
  assert.equal(sessionOf(other, 'p1').billing, 'subscription')
  assert.ok(!fs.existsSync(`${other}/spend/p1.json`))
})

test('a sign-in that cannot tell leaves a settled per-token session as it is', () => {
  const repo = makeRepo()
  const home = tmp('home')
  writeSession(home, 'p1', { billing: 'payg', toldPayg: true })
  assert.match(startNote(home, repo, { LCW_AUTH_STATUS_JSON: 'fail' }), /billed per token/)
})

test('at the mark a per-token session is told to stop in dollars, and not once old spend has dropped out', () => {
  const home = tmp('home')
  const repo = makeRepo()
  writeSession(home, 'p1', { billing: 'payg', toldPayg: true })
  spent(home, 'p1', 2900)
  assert.equal(limit(home, repo, { hook_event_name: 'UserPromptSubmit' }), null, 'under the mark')
  spent(home, 'p1', 3020)
  const prompt = limit(home, repo, { hook_event_name: 'UserPromptSubmit' })
  for (const fact of ['STOP', 'lcw:learn', '$3,020', '$3,000', 'run up to', 'lcw mark Xusd', 'lcw mark 100']) assert.ok(prompt.includes(fact), fact)
  assert.ok(!prompt.includes('% of the week'))
  assert.match(limit(home, repo, { hook_event_name: 'PostToolUse', tool_name: 'Edit' }), /^STOP! LCW: this session is at its usage mark \(\$3,020 spent in the last 7 days, mark \$3,000\)/)
  assert.ok(limit(home, repo, { hook_event_name: 'PostToolUse', tool_name: 'Edit' }).includes('lcw:learn'))
  assert.equal(limit(home, repo, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'node /p/scripts/lcw.mjs mark 5500usd' } }), null, 'the command that lifts the mark is not nagged')
  assert.equal(limit(home, repo, { hook_event_name: 'PostToolUse', tool_name: 'Edit', agent_id: 'a1' }), null, 'a subagent is left to finish')
  writeSession(home, 'p1', { billing: 'payg', toldPayg: true, markUsd: 5500 })
  assert.equal(limit(home, repo, { hook_event_name: 'UserPromptSubmit' }), null, 'a raised dollar mark')
  writeSession(home, 'p1', { billing: 'payg', toldPayg: true })
  spent(home, 'p1', 3020, 8 * 24) // spent eight days ago: it no longer counts
  assert.equal(limit(home, repo, { hook_event_name: 'UserPromptSubmit' }), null, 'old spend drops out')
})

test('a session that turns out to be billed per token is told once, with the commands, and a subscriber is never stopped by dollars', () => {
  const home = tmp('home')
  const repo = makeRepo()
  writeSession(home, 'p1', { billing: 'unclear' })
  spent(home, 'p1', 3500)
  assert.equal(limit(home, repo, { hook_event_name: 'UserPromptSubmit' }), null, 'unclear billing shows nothing in dollars')
  writeSession(home, 'p1', { billing: 'payg' })
  const first = limit(home, repo, { hook_event_name: 'PostToolUse', tool_name: 'Edit' })
  assert.match(first, /billed per token/)
  assert.ok(first.includes('Set my weekly cap for LCW.'))
  assert.ok(first.includes('mark 5500usd') && first.includes('STOP!'), 'the stop follows when the spend is at the mark')
  assert.equal(sessionOf(home, 'p1').toldPayg, true)
  assert.ok(!/billed per token/.test(limit(home, repo, { hook_event_name: 'PostToolUse', tool_name: 'Edit' })), 'told once')
  writeSession(home, 'p1', { billing: 'subscription' })
  assert.equal(limit(home, repo, { hook_event_name: 'UserPromptSubmit' }), null, 'a subscriber with dollars on record is not stopped')
  weekAt(home, 80)
  assert.match(limit(home, repo, { hook_event_name: 'UserPromptSubmit' }), /80% of the week is used and the mark is 75%/)
})

test('the agent gate refuses new agents at a dollar mark in dollars, and only while the spend is at or over it', () => {
  const home = tmp('home')
  const repo = makeRepo()
  writeSession(home, 'p1', { billing: 'payg', toldPayg: true })
  spent(home, 'p1', 2000)
  assert.equal(spawnGate(home, repo).code, 0)
  spent(home, 'p1', 3020)
  const refused = spawnGate(home, repo)
  assert.equal(refused.code, 2)
  assert.match(refused.err, /\$3,020 was spent in the last 7 days and the mark is \$3,000/)
  assert.ok(!/%/.test(refused.err.replace(/N%/, '')))
  spent(home, 'p1', 3020, 8 * 24)
  assert.equal(spawnGate(home, repo).code, 0, 'old spend dropped out')
})

test('the agent gate holds a run at its dollar gate only while the spend is over the mark, at any hour', () => {
  const t = started('dollars')
  writeSession(t.home, 's1', { ...readJson(`${t.home}/sessions/s1.json`), billing: 'payg', toldPayg: true }) // the file also binds the session to the run
  fs.writeFileSync(`${t.dir}/gate`, JSON.stringify({ reason: 'mark', unit: 'usd', markUsd: 3000, usedUsd: 3020, retryAt: NOW + 3600000, retried: false, at: NOW }))
  spent(t.home, 's1', 3020)
  const refused = spawnGate(t.home, t.repo, 's1')
  assert.equal(refused.code, 2)
  assert.match(refused.err, /\$3,020 was spent in the last 7 days and the mark is \$3,000.*pause mark/)
  spent(t.home, 's1', 2500)
  assert.equal(spawnGate(t.home, t.repo, 's1').code, 0, 'under the mark again, though the gate file stands')
})

test('at a mark of the whole week or the full cap the stop text does not offer "finish this regardless", which would lift nothing', () => {
  const home = tmp('home')
  const repo = makeRepo()
  writeSession(home, 'p1', { billing: 'payg', toldPayg: true, markPercent: 100 })
  spent(home, 'p1', 4020)
  const usd = limit(home, repo, { hook_event_name: 'UserPromptSubmit' })
  assert.ok(usd.includes('$4,020') && usd.includes('past the weekly cap'), usd)
  assert.ok(!usd.includes('finish this regardless'), usd)
  writeSession(home, 'p2', { markPercent: 100 })
  weekAt(home, 100)
  const pct = limit(home, repo, { hook_event_name: 'UserPromptSubmit' }, 'p2')
  assert.ok(pct.includes('100% of the week is used') && pct.includes('resets'), pct)
  assert.ok(!pct.includes('finish this regardless'), pct)
})

test('session start removes the temp files a stopped writer left an hour ago or more, and nothing else', () => {
  const home = tmp('home')
  const repo = makeRepo()
  for (const dir of ['cache', 'bin']) fs.mkdirSync(`${home}/${dir}`, { recursive: true })
  const old = [`${home}/usage.json.123.tmp`, `${home}/cache/diff-a.json.456.tmp`, `${home}/bin/statusline.mjs.789.tmp`]
  const fresh = `${home}/usage.json.321.tmp` // a writer may be between its write and its rename right now
  const others = [`${home}/usage.json`, `${home}/notes.tmp`]
  for (const f of [...old, fresh, ...others]) fs.writeFileSync(f, '{}')
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000)
  for (const f of [...old, ...others]) fs.utimesSync(f, twoHoursAgo, twoHoursAgo)
  run(START_HOOK, [], { home, cwd: repo, input: JSON.stringify({ session_id: 's1', cwd: repo }) })
  for (const f of old) assert.equal(fs.existsSync(f), false, f)
  for (const f of [fresh, ...others]) assert.equal(fs.existsSync(f), true, f)
})
