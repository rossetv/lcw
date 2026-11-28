import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, cli, run, START_HOOK, readJson } from './helpers.mjs'
import { sessionFile } from '../../lib/key.mjs'

const now = Date.parse('2026-11-23T12:00:00.000Z')

test('configured endpoint selects only matching sessions and disabling restores default selection', async (t) => {
  const home = tmp('quota-integration-home')
  const cwd = makeRepo()
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(cwd, { recursive: true, force: true }) })
  const reader = `${home}/reader.mjs`
  fs.writeFileSync(reader, `process.stdout.write(JSON.stringify({ v: 1, status: 'ok', accountKey: 'a'.repeat(64), weekly: { percentUsed: 42, resetsAt: '2026-12-01T12:00:00.000Z' }, blocked: false }))`)
  const command = `${process.execPath} ${reader}`
  const env = { LCW_NOW: String(now), LCW_AUTH_STATUS_JSON: '{"authMethod":"api_key"}' }
  const options = (session, endpoint = '') => ({ home, cwd, session, env: { ...env, ANTHROPIC_BASE_URL: endpoint } })
  const lcw = (args, opts = options('matching')) => cli(args, opts)
  const hook = (id, endpoint) => run(START_HOOK, [], { ...options(id, endpoint), input: JSON.stringify({ session_id: id, cwd }) })

  const set = await lcw(['quota-command', 'https://proxy.example/v1', command])
  assert.equal(set.code, 0, set.out)
  assert.match((await lcw(['quota-command'])).out, /42%/)
  assert.equal(hook('matching', 'https://PROXY.example/v1/').code, 0)
  assert.equal(hook('other', 'https://other.example/v1').code, 0)
  assert.equal(hook('native', '').code, 0)
  assert.equal(readJson(sessionFile(home, 'matching')).quotaSelection.sourceId, 'external-quota')
  for (const id of ['other', 'native']) assert.equal(readJson(sessionFile(home, id)).quotaSelection, undefined)
  assert.match((await lcw(['usage'], options('matching', 'https://proxy.example/v1'))).out, /42%/)

  assert.equal((await lcw(['quota-command', 'off'])).code, 0)
  assert.match((await lcw(['quota-command'])).out, /No external quota command/)
  assert.equal(hook('matching', 'https://proxy.example/v1').code, 0)
  assert.equal(readJson(sessionFile(home, 'matching')).quotaSelection, null)
})
