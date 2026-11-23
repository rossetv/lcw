import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../../scripts/lcw.mjs', import.meta.url))
const at = Date.parse('2026-01-01T12:00:00.000Z')
const ok = { v: 1, status: 'ok', accountKey: 'a'.repeat(64), weekly: { percentUsed: 42, resetsAt: '2026-01-02T12:00:00.000Z' }, blocked: false }

test('quota command configures, inspects and disables independently of dollars and native cache', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-quota-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const home = path.join(dir, '.lcw')
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(home, 'spend-command.json'), 'dollar-source')
  fs.writeFileSync(path.join(home, 'usage.json'), 'native-source')
  const env = { ...process.env, HOME: dir, LCW_HOME: home, LCW_NOW: String(at) }
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 5000 })
  const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`process.stdout.write(${JSON.stringify(JSON.stringify(ok))})`)}`
  const unset = run('quota-command')
  assert.equal(unset.status, 0)
  assert.equal(run('quota-command', 'http://localhost:8080/v1', 'printf credential-secret').status, 1)
  assert.equal(fs.existsSync(path.join(home, 'quota-command.json')), false)
  assert.equal(run('quota-command').stdout, unset.stdout)
  const set = run('quota-command', 'http://LOCALHOST:8080/v1/', command, '--session', 'test-session')
  assert.equal(set.status, 0, set.stdout + set.stderr)
  const state = JSON.parse(fs.readFileSync(path.join(home, 'quota-command.json'), 'utf8'))
  assert.equal(state.endpoint, 'http://localhost:8080/v1')
  assert.equal(state.command, command)
  const inspect = run('quota-command')
  assert.match(inspect.stdout, /42%/)
  assert.match(inspect.stdout, /http:\/\/localhost:8080\/v1/)
  assert.equal(inspect.stdout.includes(command), false)
  const bad = run('quota-command', 'http://localhost:8080/v1', 'printf credential-secret')
  assert.equal(bad.status, 1)
  assert.equal(bad.stdout.includes('credential-secret'), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'quota-command.json'), 'utf8')).revision, state.revision)
  assert.equal(run('quota-command', 'off').status, 0)
  const off = JSON.parse(fs.readFileSync(path.join(home, 'quota-command.json'), 'utf8'))
  assert.equal(off.enabled, false)
  assert.notEqual(off.revision, state.revision)
  assert.equal(fs.readFileSync(path.join(home, 'spend-command.json'), 'utf8'), 'dollar-source')
  assert.equal(fs.readFileSync(path.join(home, 'usage.json'), 'utf8'), 'native-source')
  assert.match(execFileSync(process.execPath, [cli, 'help'], { env, encoding: 'utf8' }), /quota-command/)
})

test('a quota file holding only the id of an interrupted setup reads as no command set', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-quota-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const home = path.join(dir, '.lcw')
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(home, 'quota-command.json'), JSON.stringify({ setupRequestId: 'abc' }))
  const env = { ...process.env, HOME: dir, LCW_HOME: home, LCW_NOW: String(at) }
  const r = spawnSync(process.execPath, [cli, 'quota-command'], { env, encoding: 'utf8', timeout: 5000 })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /No external quota command set\./)
})
