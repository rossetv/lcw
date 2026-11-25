import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_CAP_USD } from '../../lib/spend.mjs'
import { dollars } from '../../lib/format.mjs'
import {
  LEARN_TEXT, awakeApplies, awakeCheckWanted, SHOWN_WITHIN_MS, claudeCommand, markSpell, dismissKeys, discussPrompt, fixSpendPrompt, nextStepOf, pressPlan, resumePrompt, runFact, sameBox,
  statusLineFact, unfinishedCandidates, unfinishedFact, usageFact, weeklyDue,
} from '../../hooks/boxes.mjs'
import { bannerFor, openWaves } from '../../lib/banner.mjs'
import * as boxes from '../../hooks/boxes.mjs'
import * as keys from '../../lib/key.mjs'

test('proxy setup excludes native, unsafe, selected and explicitly disabled connections', () => {
  const endpoint = 'https://proxy.example/private/team'
  const config = { v: 1, sourceId: 'external-quota', enabled: true, revision: 'r', endpoint, command: 'quota' }
  assert.equal(boxes.proxyQuotaEndpoint('https://PROXY.example:443/private/team///', null), endpoint)
  for (const value of [undefined, '', 'bad', 'https://u:secret@proxy.example', 'https://proxy.example/?key=secret', 'https://api.anthropic.com/', 'https://api.anthropic.com/v1', 'https://proxy.example/' + String.fromCharCode(0xd800), 'https://proxy.example/' + String.fromCharCode(0xdfff)]) {
    assert.equal(boxes.proxyQuotaEndpoint(value, null), null, String(value))
  }
  assert.equal(boxes.proxyQuotaEndpoint(endpoint, config), null)
  assert.equal(boxes.proxyQuotaEndpoint(endpoint + '/other', config), endpoint + '/other')
  assert.equal(boxes.proxyQuotaEndpoint(endpoint, { v: 1, enabled: false, sourceId: 'external-quota', revision: 'off' }), null)
  for (const configuration of [null, {}, { ...config, endpoint: endpoint + '/other' }]) {
    for (const selection of [{ sourceId: 'external-quota' }, { sourceId: 'external-quota', endpoint }, { sourceId: 'other' }]) {
      assert.equal(boxes.proxyQuotaEndpoint(endpoint, configuration, { quotaSelection: selection }), null)
      assert.equal(boxes.proxyQuotaEndpoint(endpoint, configuration, {}, { quotaSelection: selection }), null)
    }
  }
})

test('a proxy is known by its host name, whatever its port or path, and each host has one fixed-length choice file', async () => {
  for (const endpoint of ['https://proxy.example/private/team', 'https://proxy.example:8443', 'http://proxy.example:3456/other']) assert.equal(boxes.proxyQuotaHost(endpoint), 'proxy.example')
  assert.equal(boxes.proxyQuotaHost('http://127.0.0.1:49152'), '127.0.0.1')
  assert.equal(boxes.proxyQuotaHost('https://other.example/private/team'), 'other.example')
  assert.match(await keys.proxyQuotaNoticeFile('/lcw', 'x'.repeat(253)), /^\/lcw\/notices\/proxy-quota\/[a-f0-9]{64}\.json$/)
  assert.notEqual(await keys.proxyQuotaNoticeFile('/lcw', 'proxy.example'), await keys.proxyQuotaNoticeFile('/lcw', 'other.example'))
})

test('proxy choices only acknowledge, and setup fills a generic conversation with no configuration command', () => {
  const facts = { advisorModel: 'fable', proxyQuota: { host: 'proxy.example', key: 'connection', canSetup: true } }
  for (const choice of ['setup', 'keep', 'dismiss']) {
    const plan = press(facts, choice)
    assert.ok(plan)
    assert.deepEqual(argvs(plan), [])
    assert.equal(plan.prompt, undefined)
    assert.equal(plan.notices, undefined)
    assert.deepEqual(plan.proxyQuotaChoice, { host: facts.proxyQuota.host, choice })
    assert.equal(plan.dismiss, true)
    if (choice === 'setup') {
      assert.match(plan.fillText, /subscription/)
      assert.match(plan.fillText, /authorization/i)
      assert.doesNotMatch(plan.fillText, /proxy\.example|private|team/)
    } else assert.equal(plan.fillText, undefined)
  }
  assert.equal(press({ ...facts, proxyQuota: { ...facts.proxyQuota, canSetup: false } }, 'setup').fillText, undefined)
})

const NOW = Date.parse('2026-11-20T12:00:00Z')
const MIN = 60000
const CTX = { root: '/plug', sessionId: 's1', repoKey: 'repo-1', cleanupPath: '/lcw/repos/repo-1/cleanup.json' }
const argvs = (plan) => (plan?.steps ?? []).map((s) => s.argv.slice(2).join(' '))
const pausedRun = { id: 'r1', name: 'export-csv', status: 'paused', pausedReason: 'mark', pausedAt: '2026-11-20T03:00:00Z', stage: 'Build' }
const press = (facts, option) => {
  const box = bannerFor(facts)
  return pressPlan(box, option, facts, CTX)
}

test('a raise on a run paused at the mark sets the mark for this session, resumes, and asks Claude to carry on', () => {
  const facts = { now: NOW, run: runFact(pausedRun), usage: { usedPercent: 76, markPercent: 75, resetsAt: '2026-11-22T14:00:00Z' } }
  const plan = press(facts, 'r90')
  assert.deepEqual(argvs(plan), ['mark 90 --session s1', 'resume --session s1'])
  assert.match('this session is at the mark', plan.steps[0].halt)
  assert.match(plan.prompt.text, /lcw\.mjs" status --session s1/)
})

test('on pay-per-token billing a raise is in dollars of the cap', () => {
  const facts = { now: NOW, billing: 'payg', run: runFact(pausedRun), usage: { spentUsd: 3050, capUsd: 4000, markUsd: 3000, atMark: true } }
  assert.deepEqual(argvs(press(facts, 'r90')), ['mark 3600usd --session s1', 'resume --session s1'])
  assert.deepEqual(argvs(press(facts, 'r100')), ['mark 4000usd --session s1', 'resume --session s1'])
})

test('a raise with no run only sets the mark and resumes nothing', () => {
  const facts = { now: NOW, usage: { usedPercent: 80, markPercent: 75, atMark: true } }
  const plan = press(facts, 'r100')
  assert.deepEqual(argvs(plan), ['mark 100 --session s1'])
  assert.equal(plan.prompt, undefined)
})

test('a button the box does not offer does nothing', () => {
  const facts = { now: NOW, run: runFact(pausedRun), usage: { usedPercent: 92, markPercent: 75 } }
  assert.equal(press(facts, 'r90'), null)
})

const unfinished = (status) => unfinishedFact({ dir: '/runs/r2', shownAt: NOW - 3600000, state: { id: 'r2', name: 'old-run', status, stage: 'Build' } },
  '- t1 checkpoint: write the tests\n- t2 checkpoint: merge T3\n- t3 note')

test('Resume takes the run over, resumes it only when it was paused, and hands Claude its next step', () => {
  const running = press({ now: NOW, unfinished: unfinished('running') }, 'resume')
  assert.deepEqual(argvs(running), ['take r2 --session s1'])
  assert.doesNotMatch(running.prompt.text, /EnterWorktree/)
  assert.match(running.prompt.text, /merge T3/)
  assert.deepEqual(argvs(press({ now: NOW, unfinished: unfinished('paused') }, 'resume')), ['take r2 --session s1', 'resume --session s1'])
  const atMark = unfinishedFact({ dir: '/runs/r2', shownAt: NOW - 3600000, state: { id: 'r2', name: 'old-run', status: 'paused', pausedReason: 'mark', stage: 'Build' } }, '')
  const taken = press({ now: NOW, unfinished: atMark }, 'resume')
  assert.deepEqual(argvs(taken), ['take r2 --session s1'])
  assert.match(taken.prompt.text, /stays paused/)
  assert.deepEqual(argvs(press({ now: NOW, unfinished: unfinished('running') }, 'abandon')), ['abandon r2 --session s1'])
})

test('the never buttons write the notice the box is kept off by', () => {
  const cleanup = { at: 5, title: 'Two branches are merged', bullets: ['a'] }
  assert.deepEqual(press({ now: NOW, repoKey: 'repo-1', cleanup }, 'never').notices, { 'cleanup:repo-1': 'never' })
  const updated = { running: '0.2.0', updated: { to: '0.2.0', bullets: ['x'] } }
  assert.deepEqual(press({ now: NOW, update: updated }, 'ok').notices, { 'whatsnew:0.2.0': 'never' })
  assert.deepEqual(press({ now: NOW, statusLine: { command: 'starship', mine: false } }, 'keep').notices, { statuslineKept: 'never' })
  const off = press({ now: NOW, billing: 'payg', spendCommandSet: true, capSet: true, spendFailing: { fails: 3, since: NOW - MIN } }, 'off')
  assert.deepEqual(off.notices, { spend: 'never' })
  assert.deepEqual(argvs(off), ['spend-command off --session s1'])
})

test('Learn more sends the words as the person, and both guide buttons keep the guide off', () => {
  const facts = { now: NOW, run: runFact({ id: 'r1', name: 'x', status: 'with-you', stage: 'Brainstorm', firstOnMachine: true }) }
  const learn = press(facts, 'learn')
  assert.deepEqual(learn.prompt, { text: LEARN_TEXT, asUser: true })
  assert.deepEqual(learn.notices, { guide: 'never' })
  assert.deepEqual(press(facts, 'ok').notices, { guide: 'never' })
})

test('Clean Up gives the removal two minutes, and Keep the default cap keeps the default cap', () => {
  const clean = press({ now: NOW, repoKey: 'repo-1', cleanup: { at: 5, title: 'Merged', bullets: [] } }, 'clean')
  assert.equal(clean.steps[0].timeoutMs, 120000)
  assert.match(clean.working, /Cleaning up/)
  const keep = press({ now: NOW, billing: 'payg', advisorModel: 'fable' }, 'keep')
  assert.deepEqual(argvs(keep), [`cap ${DEFAULT_CAP_USD} --session s1`])
  assert.ok(keep.toast.includes(dollars(DEFAULT_CAP_USD)))
})

test('Raise it runs setup for the limits and says what it printed, and Do not ask again is kept for the machine', () => {
  const facts = { now: NOW, advisorModel: 'fable', billing: 'subscription', limits: { concurrent: 20, depth: 3, env: null } }
  const raise = press(facts, 'raise')
  assert.deepEqual(raise.steps.map((s) => s.argv.slice(1)), [['/plug/scripts/setup.mjs', 'limits']])
  assert.deepEqual([raise.toast, raise.dismiss], ['output', true])
  assert.deepEqual(press(facts, 'never'), { notices: { limits: 'never' }, dismiss: true })
  assert.deepEqual(press(facts, 'later'), { dismiss: true })
})

test('Update now gives the update its 180 seconds', () => {
  const plan = press({ now: NOW, update: { running: '0.1.0', available: { version: '0.2.0', from: '0.1.0' } } }, 'now')
  assert.equal(plan.steps[0].timeoutMs, 180000)
  assert.match(plan.working, /Updating LCW/)
  assert.deepEqual(plan.steps[0].argv.slice(1), ['/plug/scripts/update.mjs', 'apply'])
})

test('Not now hides one occurrence of a new box, and the bare kind of an old one', () => {
  assert.deepEqual(dismissKeys({ kind: 'answer', key: '1,2' }), ['answer:1,2'])
  assert.deepEqual(dismissKeys({ kind: 'advisor', key: 'advisor' }), ['advisor'])
  const run = (asks) => runFact({ id: 'r1', name: 'x', status: 'running', stage: 'Build', asks })
  const set = { now: NOW, advisorModel: 'fable' }
  const dismissed = new Set(dismissKeys(bannerFor({ ...set, run: run([{ n: 1, text: 'Which?', at: NOW - MIN }]) })))
  assert.equal(bannerFor({ ...set, dismissed, run: run([{ n: 1, text: 'Which?', at: NOW - MIN }]) }), null)
  assert.equal(bannerFor({ ...set, dismissed, run: run([{ n: 1, text: 'Which?', at: NOW - MIN }, { n: 2, text: 'And?', at: NOW }]) })?.kind, 'answer')
  assert.equal(bannerFor({ ...set, dismissed, run: run([{ n: 1, text: 'Again?', at: NOW }]) })?.kind, 'answer', 'a new question under an old number')
})

test('a box is acted on only while it is the same occurrence and still offers the button', () => {
  const box = { kind: 'mark', key: 'r1:a', options: [['r90', 'Run up to $3,600'], ['wait', 'Wait until 08:00']] }
  assert.equal(sameBox(box, { ...box }, 'r90'), true)
  assert.equal(sameBox(box, { ...box, key: 'r1:b' }, 'r90'), false)
  assert.equal(sameBox(box, { ...box, options: [['wait', 'Wait until 08:00']] }, 'r90'), false)
  assert.equal(sameBox(box, { ...box, options: [['r90', 'Run up to $4,500'], ['wait', 'Wait until 08:00']] }, 'r90'), false)
  assert.equal(sameBox(box, null, 'r90'), false)
})

test('an unfinished run is one no session has shown for 15 minutes, open, not this session\'s, newest first', () => {
  const r = (id, ago, status = 'running') => ({ dir: '/runs/' + id, shownAt: NOW - ago, state: { id, status } })
  const list = unfinishedCandidates([
    r('fresh', SHOWN_WITHIN_MS - 1000), r('old', 5 * 3600000), r('older', 9 * 3600000), r('done', 3600000, 'finished'),
    r('stopped', 3600000, 'stopped'), r('mine', 3600000),
  ], NOW, '/runs/mine')
  assert.deepEqual(list.map((x) => x.state.id), ['old', 'older'])
  assert.deepEqual(unfinishedCandidates([r('old', 5 * 3600000), r('older', 9 * 3600000)], NOW, null, new Set(['unfinished:old'])).map((x) => x.state.id), ['older'],
    'Not now on the newest lets the older one show')
})

test('the milestone Build records is read as written', () => {
  const fact = unfinishedFact({ dir: '/runs/r2', shownAt: NOW - 3600000, state: { id: 'r2', name: 'x', status: 'running', stage: 'Build', milestone: '2 of 3' } }, '')
  assert.match(bannerFor({ now: NOW, unfinished: fact }).lines.join(' '), /in Build, milestone 2 of 3\./)
  const none = unfinishedFact({ dir: '/runs/r2', shownAt: NOW - 3600000, state: { id: 'r2', name: 'x', status: 'running', stage: 'Build', milestone: null } }, '')
  assert.doesNotMatch(bannerFor({ now: NOW, unfinished: none }).lines.join(' '), /milestone/)
})

test('the next step is the ledger\'s last checkpoint', () => {
  assert.equal(nextStepOf('- a checkpoint: one\n- b checkpoint: two: with a colon\n- c stage: Build'), 'two: with a colon')
  assert.equal(nextStepOf('- a stage: Build'), null)
  assert.equal(nextStepOf(null), null)
})

test('the week is at the mark when used reaches the mark; a figure past its reset is not; dollars decide on pay-per-token', () => {
  const usage = (percentUsed, resetsAt = '2026-11-22T14:00:00Z') => ({ sevenDay: { percentUsed, resetsAt } })
  assert.equal(usageFact({ session: { markPercent: 80 }, usage: usage(79), now: NOW }).atMark, false)
  assert.equal(usageFact({ session: { markPercent: 80 }, usage: usage(80), now: NOW }).atMark, true)
  assert.equal(usageFact({ session: {}, usage: usage(76), now: NOW }).atMark, true)
  assert.equal(usageFact({ session: {}, usage: usage(90, '2026-11-19T00:00:00Z'), now: NOW }).atMark, false)
  assert.equal(usageFact({ state: { markPercent: 90 }, session: { markPercent: 50 }, usage: usage(80), now: NOW }).atMark, false)
  assert.equal(usageFact({ session: {}, usage: usage(99), money: { spentUsd: 10, capUsd: 4000, markUsd: 3000, atMark: false }, now: NOW }).atMark, false)
})

test('the weekly check waits for a watched, idle session two minutes old that drives no run, and asks at most every 15 minutes', () => {
  const idle = { interactive: true, turnRunning: false, driving: false, startedAt: NOW - 3 * MIN, askedAt: 0, now: NOW }
  assert.equal(weeklyDue(idle), true)
  assert.equal(weeklyDue({ ...idle, startedAt: NOW - MIN }), false)
  assert.equal(weeklyDue({ ...idle, askedAt: NOW - 14 * MIN }), false)
  assert.equal(weeklyDue({ ...idle, askedAt: NOW - 15 * MIN }), true)
  assert.equal(weeklyDue({ ...idle, turnRunning: true }), false)
  assert.equal(weeklyDue({ ...idle, driving: true }), false)
  assert.equal(weeklyDue({ ...idle, interactive: false }), false)
  assert.equal(weeklyDue({ ...idle, atMark: true }), false)
  assert.equal(weeklyDue({ ...idle, turnEndedAt: NOW - MIN }), false)
  assert.equal(weeklyDue({ ...idle, turnEndedAt: NOW - 2 * MIN }), true)
})

test('whether the computer can be kept awake is asked only while the box could show', () => {
  const state = { id: 'r1', status: 'running', stage: 'Build', runningSince: 'T' }
  assert.equal(awakeCheckWanted(state, {}, new Set()), true)
  assert.equal(awakeCheckWanted(state, { awake: 'never' }, new Set()), false)
  assert.equal(awakeCheckWanted(state, {}, new Set(['awake:r1:T'])), false)
  assert.equal(awakeCheckWanted(state, {}, new Set(['awake:r1:earlier'])), true)
  assert.equal(awakeCheckWanted({ ...state, stage: 'Brainstorm' }, {}, new Set()), false)
})

test("the status line is LCW's only when it is a command setup wrote for this home, the player's or the node one; another home's, on purpose, is another one", () => {
  assert.equal(statusLineFact(undefined, '/lcw'), null)
  assert.deepEqual(statusLineFact({ type: 'command', command: 'node /lcw/bin/statusline.mjs' }, '/lcw'), { command: 'node /lcw/bin/statusline.mjs', mine: true })
  assert.deepEqual(statusLineFact({ command: 'starship statusline' }, '/lcw'), { command: 'starship statusline', mine: false })
  const player = (h) => `lcw_bin='${h}/bin'; [ -r "$lcw_bin/statusline.sh" ] && . "$lcw_bin/statusline.sh"; node "$lcw_bin/statusline.mjs" || printf '%s\\n' 'LCW · status line could not load · see ~/.lcw/statusline.log'`
  assert.equal(statusLineFact({ command: player('/lcw') }, '/lcw').mine, true)
  assert.equal(statusLineFact({ command: player('/other') }, '/lcw').mine, false)
})

test("the replaced box keeps away under Keep mine, old or new, but not for the notice setup writes when it moves LCW's command", () => {
  const facts = (notices) => ({ now: NOW, advisorModel: 'fable', statusLine: { command: 'starship', mine: false }, notices })
  assert.equal(bannerFor(facts({ statusline: 'moved' }))?.kind, 'statusline')
  for (const kept of [{ statusline: 'never' }, { statusline: 'moved', statuslineKept: 'never' }]) assert.equal(bannerFor(facts(kept))?.kind, undefined, JSON.stringify(kept))
})

test("the status line is LCW's with its path quoted or bare, so a home with a space in it is still known", () => {
  for (const command of [`node '/a b/.lcw/bin/statusline.mjs'`, 'node /a b/.lcw/bin/statusline.mjs']) assert.equal(statusLineFact({ command }, '/a b/.lcw').mine, true, command)
  assert.equal(statusLineFact({ command: `node '/lcw/bin/statusline.mjs'` }, '/lcw').mine, true)
  assert.equal(statusLineFact({ command: `node '/it'\\''s/bin/statusline.mjs'` }, "/it's").mine, true)
  assert.equal(statusLineFact({ command: `node '/other/bin/statusline.mjs'` }, '/lcw').mine, false)
})

test('the run as the boxes read it: its name, its open asks oldest first, none once finished, and tasks only when there are some', () => {
  const state = { id: 'r1', name: 'export-csv', status: 'running', stage: 'Build', asks: [{ n: 3, text: 'b' }, { n: 1, text: 'a' }],
    tasks: [{ status: 'done' }, { status: 'running' }, { status: 'todo' }, { status: 'parked' }] }
  const fact = runFact(state)
  assert.equal(fact.title, 'export-csv')
  assert.deepEqual(fact.asks.map((a) => a.n), [1, 3])
  assert.deepEqual([fact.done, fact.left], [1, 2])
  assert.deepEqual(runFact({ ...state, status: 'finished' }).asks, [])
  assert.equal(runFact({ ...state, tasks: [] }).done, undefined)
  assert.deepEqual(runFact({ ...state, asks: [{ n: 1, text: 'a' }, { n: 2, text: 'look', nowait: true }] }).asks.map((a) => !!a.nowait), [false, true])
})

test('the prompts a button submits name the commands in full, for a session that never loaded lcw:lcw', () => {
  assert.match(resumePrompt('/plug', 's1', { id: 'r2', name: 'x' }, false), /node "\/plug\/scripts\/lcw\.mjs" status --session s1/)
  const fix = fixSpendPrompt('/plug', 's1', { fails: 4, lastError: 'printed "401 Unauthorized"' })
  assert.match(fix, /lcw\.mjs" spend-command <command line> --session s1/)
  assert.match(fix, /The last time it printed "401 Unauthorized"\./)
  const discuss = discussPrompt('/plug', { title: 'Two merged branches', bullets: ['fix-a was merged'] }, '/lcw/c.json')
  assert.match(discuss, /cleanup\.mjs" list --recorded/)
  assert.match(discuss, /fix-a was merged/)
  assert.match(discuss, /rm -f "\/lcw\/c\.json"/)
})

test('a dip below the mark shorter than a minute keeps the occurrence; a minute below ends it', () => {
  let spell = markSpell(null, true, NOW)
  spell = markSpell(spell, false, NOW + 2000)
  spell = markSpell(spell, true, NOW + 4000)
  assert.equal(spell.since, NOW, 'one low reading')
  spell = markSpell(spell, false, NOW + 6000)
  assert.equal(markSpell(spell, false, NOW + 6000 + MIN - 1).since, NOW)
  spell = markSpell(spell, false, NOW + 6000 + MIN)
  assert.equal(markSpell(spell, true, NOW + 7 * MIN).since, NOW + 7 * MIN, 'a climb back after a minute below')
})

test('a process is taken for Claude Code only when its program, or the script node runs, is claude', () => {
  assert.equal(claudeCommand('claude --continue'), true)
  assert.equal(claudeCommand('/Users/a/.local/bin/claude'), true)
  assert.equal(claudeCommand('node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js'), true)
  assert.equal(claudeCommand('/usr/bin/python3 server.py'), false, 'a reused pid')
  assert.equal(claudeCommand('node /srv/app.js'), false)
  assert.equal(claudeCommand(''), false)
})

test('the unfinished run box says it removes a worktree only for a run that has one, read from its state', () => {
  const abandon = (over) => bannerFor({ now: NOW, advisorModel: 'fable', unfinished: unfinishedFact({ dir: '/runs/r2', shownAt: NOW - 3600000,
    state: { id: 'r2', name: 'old-run', status: 'running', stage: 'Spec', worktree: null, branch: null, ...over } }, '') }).lines.at(-1)
  assert.equal(abandon({ worktree: '/repo/.claude/worktrees/old-run', branch: 'lcw/old-run' }), 'Abandon stops it for good and removes its worktree; its branch stays, so no work is lost.')
  assert.equal(abandon({}), 'Abandon stops it for good.')
})

test("the unfinished box counts a sweep's wave worktrees, as the sweep has none of its own", () => {
  const abandon = (waves) => bannerFor({ now: NOW, advisorModel: 'fable', unfinished: unfinishedFact({ dir: '/runs/s2', shownAt: NOW - 3600000,
    state: { id: 's2', name: 'old-sweep', shape: 'sweep', status: 'running', stage: 'Build', worktree: null, branch: 'lcw/old-sweep', sweep: { waves } } }, '') }).lines.at(-1)
  assert.match(abandon([{ n: 1, status: 'shipped', worktree: null }, { n: 2, status: 'running', worktree: '/wt/old-sweep-wave-2' }]), /removes its worktrees?;/)
  assert.doesNotMatch(abandon([{ n: 1, status: 'shipped', worktree: null }]), /worktree/)
})

test('the approval reaches the boxes only while the run is with the person in its Brainstorm, labels tidied, at most three', () => {
  const state = (over) => ({ id: 'r1', stage: 'Brainstorm', status: 'with-you', approval: { go: [' Go  (a) ', '', 'Go (b)', 'c', 'd'], meaning: '', at: 5 }, ...over })
  assert.deepEqual(runFact(state()).approval, { go: ['Go (a)', 'Go (b)', 'c'], meaning: 'build it as played back', at: 5 })
  assert.deepEqual(runFact(state({ approval: { go: ['Go with the long rows of a phone'], at: 5 } })).approval.go, ['Go with the long row'])
  assert.equal(runFact(state({ status: 'paused' })).approval, undefined)
  assert.equal(runFact(state({ stage: 'Spec', status: 'running' })).approval, undefined)
  assert.equal(runFact(state({ approval: { go: [] } })).approval, undefined, 'no time, no box')
})

test('a reply on the approval box only fills the prompt: no command, no prompt sent', () => {
  const facts = { now: NOW, advisorModel: 'fable', run: runFact({ id: 'r1', stage: 'Brainstorm', status: 'with-you', approval: { go: ['Go (a)', 'Go (b)'], at: 5 } }) }
  assert.deepEqual(press(facts, 'go2'), { fillText: 'Go (b)', dismiss: true })
  assert.deepEqual(press(facts, 'but'), { fillText: 'Yes, but ', dismiss: true })
  assert.deepEqual(press(facts, 'else'), { fillText: 'Something else: ', dismiss: true })
  assert.equal(press(facts, 'go3'), null)
})

test("a sweep's approval is read in its Charter, with its own Go meaning, and a reply only fills the prompt", () => {
  const state = (over) => ({ id: 's1', shape: 'sweep', stage: 'Charter', status: 'with-you', approval: { go: [], at: 5 }, ...over })
  const fact = runFact(state())
  assert.equal(fact.shape, 'sweep')
  assert.deepEqual(fact.approval, { go: ['Go'], meaning: 'starts the hunt', at: 5 })
  assert.equal(runFact(state({ stage: 'Brainstorm' })).approval, undefined, 'a sweep has no Brainstorm to approve')
  assert.equal(runFact(state({ stage: 'Hunt', status: 'running' })).approval, undefined)
  assert.equal(runFact({ ...state(), shape: undefined }).approval, undefined, 'a build is not approved in a Charter')
  assert.equal(runFact({ id: 'r1', stage: 'Brainstorm', status: 'with-you', approval: { at: 5 } }).shape, 'build')
  const facts = { now: NOW, advisorModel: 'fable', run: fact }
  assert.deepEqual(press(facts, 'go1'), { fillText: 'Go', dismiss: true })
  assert.deepEqual(press(facts, 'but'), { fillText: 'Yes, but ', dismiss: true })
  assert.deepEqual(press(facts, 'else'), { fillText: 'Something else: ', dismiss: true })
})

test("the keep-awake check does not apply in a sweep's Charter", () => {
  assert.equal(awakeApplies({ status: 'running', stage: 'Charter' }), false)
  assert.equal(awakeApplies({ status: 'running', stage: 'Hunt' }), true)
})

test('an unfinished sweep names the wave it was in: the running one, else the next queued, none between waves', () => {
  const wave = (waves, stage = 'Build') => unfinishedFact({ dir: '/runs/s2', shownAt: NOW - 3600000,
    state: { id: 's2', name: 'backlog', shape: 'sweep', status: 'running', stage, sweep: { waves } } }, '').wave
  assert.equal(wave([{ n: 1, status: 'shipped' }, { n: 2, status: 'running' }, { n: 3, status: 'queued' }]), 2)
  assert.equal(wave([{ n: 1, status: 'shipped' }, { n: 2, status: 'queued' }], 'Plan'), 2)
  assert.equal(wave([{ n: 1, status: 'shipped' }], 'Hunt'), undefined)
  const build = unfinishedFact({ dir: '/runs/r2', shownAt: NOW - 3600000, state: { id: 'r2', name: 'x', status: 'running', stage: 'Build', sweep: { waves: [{ n: 1, status: 'running' }] } } }, '')
  assert.equal(build.wave, undefined, 'a build has no waves')
})

const asking = (questions) => ({ id: 'r1', name: 'tidy', status: 'running', stage: 'Build', shape: 'sweep', questions })
const Q = (id, status = 'open') => ({ id, text: `Question ${id}?`, why: 'why', status, options: [{ key: 'a', label: 'Fix it', meaning: 'built next wave' }, { key: 'b', label: 'Keep it', meaning: 'closed as decided' }] })

test('a sweep\'s open questions show one at a time, counted among all it asked, and a press saves it with no prompt', () => {
  const facts = { now: NOW, advisorFlag: true, run: runFact(asking([Q('Q1', 'answered'), Q('Q2'), Q('Q3')])) }
  const box = bannerFor(facts)
  assert.equal(box.kind, 'question')
  assert.equal(box.questionId, 'Q2')
  assert.match(box.tag, /your call 2 of 3/)
  assert.deepEqual(box.options.map((o) => o[0]), ['a', 'b', 'park', 'other'])
  const plan = press(facts, 'a')
  assert.deepEqual(argvs(plan), ['question Q2 pick a --session s1'])
  assert.equal(plan.prompt, undefined)
  assert.equal(plan.fillText, undefined)
})

test('Other only puts the question in the prompt, and the box stays until the words sent are recorded', () => {
  const plan = press({ now: NOW, advisorFlag: true, run: runFact(asking([Q('Q2')])) }, 'other')
  assert.deepEqual(argvs(plan), [])
  assert.equal(plan.fillText, 'Your call on Q2: ')
  assert.ok(!plan.dismiss)
})

test('the keep-awake box comes before a sweep\'s questions', () => {
  const facts = { now: NOW, advisorFlag: true, sleep: { canHold: true }, run: runFact({ ...asking([Q('Q1')]), runningSince: '2026-11-20T11:00:00Z' }) }
  assert.equal(bannerFor(facts).kind, 'awake')
})

test('no box asks once every question is answered, or the run is finished', () => {
  assert.equal(bannerFor({ now: NOW, advisorFlag: true, run: runFact(asking([Q('Q1', 'answered'), Q('Q2', 'used')])) }), null)
  assert.equal(bannerFor({ now: NOW, advisorFlag: true, run: runFact({ ...asking([Q('Q1')]), status: 'finished' }) }), null)
})

test('a run paused at the mark shows the mark box before its questions', () => {
  const run = { ...asking([Q('Q1')]), status: 'paused', pausedReason: 'mark', pausedAt: '2026-11-20T03:00:00Z' }
  const facts = { now: NOW, advisorFlag: true, run: runFact(run), usage: { usedPercent: 76, markPercent: 75, resetsAt: '2026-11-22T14:00:00Z' } }
  assert.equal(bannerFor(facts).kind, 'mark')
})

test('an unfinished sweep carries every open wave and counts their tasks, not the run-level ones', () => {
  const fact = (state) => unfinishedFact({ dir: '/runs/s3', shownAt: NOW - 3600000, state: { id: 's3', name: 'backlog', shape: 'sweep', status: 'running', stage: 'Build', ...state } }, '')
  const f = fact({ tasks: [], sweep: { prs: 'stacked', waves: [
    { n: 1, status: 'running', stage: 'Ship', step: 'final checks', tasks: [{ status: 'done' }, { status: 'done' }] },
    { n: 2, status: 'running', stage: 'Build', waiting: true, tasks: [{ status: 'done' }, { status: 'todo' }] },
    { n: 3, status: 'queued' }] } })
  assert.deepEqual(f.waves.map((w) => [w.n, w.stage, w.step, w.waiting]), [[1, 'Ship', 'final checks', false], [2, 'Build', null, true]])
  assert.equal(f.wave, 1)
  assert.deepEqual([f.done, f.left], [3, 1])
})

test('a shipped wave is open only while the charter merges as it goes and its pull request is not merged', () => {
  const waves = (prs, merged) => openWaves({ shape: 'sweep', sweep: { prs, waves: [{ n: 1, status: 'shipped', merged }] } })
  assert.deepEqual(waves('merged', false).map((w) => [w.stage, w.step]), [['Ship', 'merging']])
  assert.equal(waves('merged', true).length, 0)
  assert.equal(waves('stacked', false).length, 0)
})

test('a 0.4 wave with no stage reads the run-level stage and lists', () => {
  const [w] = openWaves({ shape: 'sweep', stage: 'Review', tasks: [{ status: 'todo' }], requirements: [{ status: 'pass' }], sweep: { waves: [{ n: 1, status: 'running' }] } })
  assert.equal(w.stage, 'Review')
  assert.equal(w.tasks.length, 1)
  assert.equal(w.requirements.length, 1)
})

const choosing = (asks) => ({ now: NOW, run: runFact({ id: 'r1', name: 'export-csv', status: 'running', stage: 'Build', asks }) })
const REMOTE = { n: 2, text: 'Which remote?', at: NOW, recommend: 'b', options: [{ key: 'a', label: 'origin', meaning: 'once the token can write' }, { key: 'b', label: 'fork', meaning: 'push to your fork' }] }

test("an ask's option records the answer with its words and tells the run; Other puts the ask's number in the prompt", () => {
  const plan = press(choosing([REMOTE]), 'b')
  assert.deepEqual(plan.steps.map((s) => s.argv.slice(2)), [['answer', '2', 'fork: push to your fork', '--session', 's1']])
  assert.match(plan.owe, /ask 2/)
  assert.match(plan.owe, /fork: push to your fork/)
  assert.equal(plan.dismiss, undefined, 'the next open ask shows once this one is answered')
  assert.deepEqual(press(choosing([REMOTE]), 'other'), { fill: 2, dismiss: true })
})

test("an ask's option drawn before the ask changed is not acted on, though the new ask's option has the same label", () => {
  const drawn = bannerFor(choosing([REMOTE]))
  const next = bannerFor(choosing([{ ...REMOTE, n: 3, text: 'And the tag?' }]))
  assert.equal(sameBox(drawn, next, 'b'), false)
  assert.equal(sameBox(drawn, bannerFor(choosing([REMOTE])), 'b'), true)
})

test("Later on a question shown before an ask brings up the ask's buttons, and the question comes back once the ask is answered", () => {
  const sweep = (asks) => ({ now: NOW, run: runFact({ id: 'r1', name: 'export-csv', shape: 'sweep', status: 'running', stage: 'Build', asks,
    questions: [{ id: 'Q1', text: 'Keep the 409?', why: 'w', status: 'open', recommend: 'a', options: [{ key: 'a', label: 'Keep', meaning: 'm' }, { key: 'b', label: 'Change', meaning: 'n' }] }] }) })
  const dismissed = new Set()
  const pressOn = (facts, option) => {
    const box = bannerFor({ ...facts, dismissed })
    const plan = pressPlan(box, option, facts, CTX)
    if (plan?.dismiss) for (const k of dismissKeys(box)) dismissed.add(k)
    return { box, plan }
  }
  const asked = sweep([REMOTE])
  assert.equal(pressOn(asked, 'later').box.kind, 'question')
  const { box, plan } = pressOn(asked, 'b')
  assert.equal(box.kind, 'answer')
  assert.deepEqual(argvs(plan), ['answer 2 fork: push to your fork --session s1'])
  assert.equal(bannerFor({ ...sweep([]), dismissed })?.kind, 'question')
})

test("a press on the box of asks that hold nothing answers its own ask, not the first one open", () => {
  const options = [{ key: 'a', label: 'Ship it', meaning: 'as drawn' }, { key: 'b', label: 'Change it', meaning: 'say what' }]
  const run = runFact({ id: 'r1', name: 'export-csv', status: 'running', stage: 'Build', tasks: [],
    asks: [{ n: 1, text: 'Which format?', at: 1, options, recommend: 'a' }, { n: 2, text: 'Look at the mock', at: 2, nowait: true, options, recommend: 'a' }] })
  const facts = { now: NOW, advisorModel: 'fable', run }
  const holds = bannerFor(facts)
  const offered = bannerFor({ ...facts, dismissed: new Set(['answer:' + holds.key]) })
  assert.deepEqual(pressPlan(offered, 'a', facts, CTX).steps[0].argv.slice(2, 4), ['answer', '2'])
  assert.deepEqual(pressPlan(holds, 'a', facts, CTX).steps[0].argv.slice(2, 4), ['answer', '1'])
  const plain = { ...facts, run: { ...run, asks: run.asks.map(({ options: _, recommend: __, ...a }) => a) } }
  assert.equal(pressPlan(bannerFor({ ...plain, dismissed: new Set(['answer:' + holds.key]) }), 'now', plain, CTX).fill, 2)
})
