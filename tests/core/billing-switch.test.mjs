import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, run, lcw, readJson, START_HOOK, LIMIT_HOOK } from './helpers.mjs'
import { measureStep } from '../../hooks/lcw-mod.mjs'

const STATUS_LINE = new URL('../../scripts/statusline.mjs', import.meta.url).pathname
const NOW = Date.UTC(2026, 5, 10, 12, 0, 0)
const env = (authMethod) => ({
  LCW_NOW: String(NOW),
  LCW_AUTH_STATUS_JSON: authMethod ? JSON.stringify({ loggedIn: true, authMethod }) : 'fail',
  ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: '', CLAUDE_CODE_OAUTH_TOKEN: '',
})

function place(sessions) {
  const home = tmp('home')
  const repo = makeRepo()
  fs.mkdirSync(`${home}/sessions`, { recursive: true })
  for (const [id, body] of Object.entries(sessions)) fs.writeFileSync(`${home}/sessions/${id}.json`, JSON.stringify(body))
  return { home, repo }
}
const billingOf = (home, id) => readJson(`${home}/sessions/${id}.json`).billing
const start = ({ home, repo }, authMethod, input = { session_id: 'p1' }) =>
  run(START_HOOK, [], { home, cwd: repo, input: JSON.stringify({ ...input, cwd: repo }), env: env(authMethod) }).out
/** One status line tick: a cost so far, and the weekly figure a subscription's ticks carry. */
const tick = ({ home, repo }, { cost, weekly = false, id = 'p1' }) => run(STATUS_LINE, [], {
  home, cwd: repo, env: env('api_key'),
  input: JSON.stringify({ session_id: id, cwd: repo, cost: { total_cost_usd: cost }, ...(weekly ? { rate_limits: { seven_day: { used_percentage: 20, resets_at: NOW / 1000 + 3 * 86400 } } } : {}) }),
})
/** What the limit hook tells Claude on the next prompt, or null when it says nothing. */
const prompt = ({ home, repo }, id = 'p1') => {
  const r = run(LIMIT_HOOK, [], { home, cwd: repo, env: env('api_key'), input: JSON.stringify({ session_id: id, cwd: repo, hook_event_name: 'UserPromptSubmit' }) })
  assert.equal(r.code, 0, r.err)
  return r.out.trim() ? JSON.parse(r.out).hookSpecificOutput.additionalContext : null
}

test('a subscriber resumed with an API key in the environment is told nothing about dollars, and a weekly figure keeps the subscription', () => {
  const t = place({ p1: { billing: 'subscription' } })
  for (const resume of [1, 2]) assert.ok(!/per token|dollar|weekly cap/.test(start(t, 'api_key')), `resume ${resume}, before any reply`)
  tick(t, { cost: 0.4, weekly: true })
  assert.equal(billingOf(t.home, 'p1'), 'subscription')
  assert.equal(prompt(t), null)
})

test('a resumed subscriber whose first tick shows the cost from before the resume, with no weekly figure, is never made pay-per-token', () => {
  const t = place({ p1: { billing: 'subscription' } })
  start(t, 'api_key')
  tick(t, { cost: 0.00308 })
  assert.notEqual(billingOf(t.home, 'p1'), 'payg')
  assert.equal(prompt(t), null)
  tick(t, { cost: 0.00308, weekly: true })
  assert.equal(billingOf(t.home, 'p1'), 'subscription')
  assert.equal(prompt(t), null)
})

test('the mod settles a session left unclear at a resume as pay-per-token only once its cost rises past the first reading', () => {
  const first = measureStep({ billing: 'unclear' }, null, { weekly: null, cost: 0.00308 }, NOW)
  assert.equal(first.billing, 'unclear')
  assert.equal(measureStep({ billing: 'unclear' }, first.record, { weekly: null, cost: 0.05 }, NOW).billing, 'payg')
})

test('a stored subscription resumed under an API key whose reply has no weekly figure counts dollars and stops at the dollar mark', () => {
  const t = place({ p1: { billing: 'subscription', toldPayg: true } })
  start(t, 'api_key')
  tick(t, { cost: 0.4 })
  tick(t, { cost: 0.9 })
  assert.equal(billingOf(t.home, 'p1'), 'payg')
  assert.match(prompt(t), /turned out to be billed per token/)
  assert.equal(lcw(['mark', '10usd'], { home: t.home, cwd: t.repo, session: 'p1' }).code, 0)
  tick(t, { cost: 12.4 })
  assert.match(prompt(t), /STOP\. This session is at its usage mark: \$12 was spent .* the mark is \$10/)
})

test('a resume known by an older canonical id settles the canonical session too', () => {
  const t = place({ c0: { billing: 'subscription', sessionCanonicalId: 'c0' }, p1: { sessionCanonicalId: 'c0' } })
  start(t, 'api_key')
  tick(t, { cost: 0.4 })
  tick(t, { cost: 0.9 })
  assert.match(prompt(t), /turned out to be billed per token/)
})

test('a sign-in that cannot be read leaves every stored billing as it is', () => {
  const t = place({ p2: { billing: 'subscription' } })
  start(t, null, { session_id: 'p2', transcript_path: '/x/p1.jsonl' })
  assert.equal(billingOf(t.home, 'p2'), 'subscription')
})

test('a stored subscription resumed under a subscription sign-in stays a subscription', () => {
  const t = place({ p1: { billing: 'subscription' } })
  start(t, 'claude.ai')
  assert.equal(billingOf(t.home, 'p1'), 'subscription')
})
