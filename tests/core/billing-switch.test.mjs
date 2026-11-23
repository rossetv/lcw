import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, run, readJson, START_HOOK } from './helpers.mjs'

const signIn = (authMethod) => ({ LCW_AUTH_STATUS_JSON: JSON.stringify({ loggedIn: true, authMethod }) })

/** Starts a session that was stored as a subscription, with the sign-in report given; returns its stored billing. */
function resumeStoredSubscription(report) {
  const home = tmp('home')
  const repo = makeRepo()
  fs.mkdirSync(`${home}/sessions`, { recursive: true })
  fs.writeFileSync(`${home}/sessions/p1.json`, JSON.stringify({ billing: 'subscription' }))
  const before = { ...process.env }
  Object.assign(process.env, report)
  try { run(START_HOOK, [], { home, cwd: repo, input: JSON.stringify({ session_id: 'p1', cwd: repo }) }) } finally {
    for (const k of Object.keys(report)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k] }
  }
  return readJson(`${home}/sessions/p1.json`).billing
}

test('a stored subscription resumed under an API key becomes pay-per-token', () => {
  assert.equal(resumeStoredSubscription(signIn('api_key')), 'payg')
})

test('a stored subscription resumed under a subscription sign-in stays a subscription', () => {
  assert.equal(resumeStoredSubscription(signIn('claude.ai')), 'subscription')
})
