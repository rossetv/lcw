import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmp } from './helpers.mjs'

const SETUP = new URL('../../scripts/setup.mjs', import.meta.url).pathname
const setup = (home, settings, cmd) => {
  const r = spawnSync('node', [SETUP, cmd, '--settings', settings], { cwd: tmp('cwd'), encoding: 'utf8', env: { ...process.env, LCW_HOME: home } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

test('setup writes through a linked settings file to the file it names, and keeps the link', () => {
  for (const cmd of ['install', 'auto', 'uninstall']) {
    const home = tmp('home'), dir = tmp('s'), dotfiles = tmp('dotfiles')
    fs.writeFileSync(`${dotfiles}/settings.json`, JSON.stringify({ theme: 'dark' }))
    fs.symlinkSync(`${dotfiles}/settings.json`, `${dir}/settings.json`)
    const r = setup(home, `${dir}/settings.json`, cmd)
    assert.equal(r.code, 0, r.err)
    assert.ok(fs.lstatSync(`${dir}/settings.json`).isSymbolicLink(), cmd)
    assert.equal(read(`${dotfiles}/settings.json`).theme, 'dark', cmd)
    if (cmd !== 'uninstall') assert.deepEqual(read(`${dotfiles}/settings.json`).attribution, { commit: '', pr: '' }, cmd)
    assert.deepEqual(fs.readdirSync(dotfiles), ['settings.json'], 'no temp file is left beside it')
  }
})

test('setup keeps the settings file\'s mode', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark' }))
  fs.chmodSync(settings, 0o600)
  for (const cmd of ['install', 'uninstall']) {
    assert.equal(setup(home, settings, cmd).code, 0)
    assert.equal(fs.statSync(settings).mode & 0o777, 0o600, cmd)
  }
})

test('uninstall removes the agent depth only when install set it', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark' }))
  assert.equal(setup(home, settings, 'install').code, 0)
  assert.equal(read(settings).env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '5')
  assert.equal(setup(home, settings, 'install').code, 0, 'a second install finds it set and keeps the record')
  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings), { theme: 'dark' })

  const own = { env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '5' } }
  fs.writeFileSync(settings, JSON.stringify(own))
  setup(home, settings, 'install')
  const u = setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings).env, own.env, 'the person set it themselves')
  assert.ok(!/removed env\.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH/.test(u.out), u.out)
})
