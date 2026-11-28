import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmp, installedConfig } from './helpers.mjs'
import { STATUS_FILES } from '../../scripts/lib/status-files.mjs'
import { noticesFile } from '../../lib/key.mjs'

const SETUP = new URL('../../scripts/setup.mjs', import.meta.url).pathname
const INSTALLED = installedConfig()
// install waits 300 ms for older mods after it sets a notice for them; a notice already there skips the wait
const setup = (home, settings, cmd) => {
  const notices = noticesFile(home)
  if (!fs.existsSync(notices)) { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(notices, JSON.stringify({ statusline: 'moved' })) }
  const r = spawnSync('node', [SETUP, cmd, '--settings', settings], { cwd: tmp('cwd'), encoding: 'utf8', env: { ...process.env, LCW_HOME: home, CLAUDE_CONFIG_DIR: INSTALLED } })
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

test('the status line files setup and the session start copy are every file in scripts/bin, and only those', () => {
  assert.deepEqual([...STATUS_FILES].sort(), fs.readdirSync(new URL('../../scripts/bin', import.meta.url)).sort())
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

test('the status line runs from a home with a space or a quote in its path', () => {
  const input = JSON.stringify({ model: { display_name: 'Opus 5' }, cwd: tmp('cwd') })
  for (const label of ['my home', "it's"]) {
    const home = tmp(label) + '/.lcw', settings = tmp('s') + '/settings.json'
    assert.equal(setup(home, settings, 'install').code, 0, label)
    const r = spawnSync('sh', ['-c', read(settings).statusLine.command], { input, encoding: 'utf8', env: { ...process.env, LCW_HOME: home, COLUMNS: '100' } })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /Opus 5/, `${label}: it printed the rows`)
  }
})

test('a status line installed before paths were quoted is still LCW\'s own, and uninstall takes it out', () => {
  const home = tmp('my home') + '/.lcw', settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: `node ${home}/bin/statusline.mjs`, refreshInterval: 1, padding: 0 } }))
  assert.match(setup(home, settings, 'status').out, /statusLine: LCW/)
  setup(home, settings, 'uninstall')
  assert.equal(read(settings).statusLine, undefined)
})

// each limit install raises: LCW's own figure goes at uninstall, a figure the person set (any of these) stays
for (const [key, ours, theirs] of [['CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH', '5', ['5']], ['CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS', '80', ['40', '80']]]) {
  test(`uninstall removes ${key} only when install set it`, () => {
    const home = tmp('home'), settings = tmp('s') + '/settings.json'
    fs.writeFileSync(settings, JSON.stringify({ theme: 'dark' }))
    assert.equal(setup(home, settings, 'install').code, 0)
    assert.equal(read(settings).env[key], ours)
    assert.equal(setup(home, settings, 'install').code, 0, 'a second install finds it set and keeps the record')
    setup(home, settings, 'uninstall')
    assert.deepEqual(read(settings), { theme: 'dark' })

    for (const value of theirs) {
      const fresh = tmp('home')
      fs.writeFileSync(settings, JSON.stringify({ env: { [key]: value } }))
      setup(fresh, settings, 'install')
      assert.equal(read(settings).env[key], value, 'install keeps the figure the person set')
      setup(fresh, settings, 'uninstall')
      assert.equal(read(settings).env[key], value, 'uninstall leaves it')
    }
  })
}

test('limits raises every agent limit under what a run needs, a figure the person set included, and uninstall puts theirs back', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark', env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '40', KEEP: '1' } }))
  const r = setup(home, settings, 'limits')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /80 agents at once, nested 5 deep/)
  assert.deepEqual(read(settings).env, { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '80', KEEP: '1', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '5' })
  assert.equal(setup(home, settings, 'limits').code, 0)
  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings), { theme: 'dark', env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '40', KEEP: '1' } })
})

test('limits leaves a limit that is already enough, however it was set', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  const theirs = { env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '120', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '6' } }
  fs.writeFileSync(settings, JSON.stringify(theirs))
  assert.equal(setup(home, settings, 'limits').code, 0)
  assert.deepEqual(read(settings), theirs)
  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings).env, theirs.env)
})

test('uninstall leaves an attribution the person changed after install, and keeps the keys they added', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ model: 'opus' }))
  setup(home, settings, 'install')
  const s = read(settings)
  s.attribution = { commit: 'Reviewed-by: me', pr: '' }
  fs.writeFileSync(settings, JSON.stringify(s))
  assert.equal(setup(home, settings, 'uninstall').code, 0)
  assert.deepEqual(read(settings).attribution, { commit: 'Reviewed-by: me', pr: '' })
  assert.ok(!fs.existsSync(`${home}/previous-attribution.json`), 'the record is dropped')

  fs.writeFileSync(settings, JSON.stringify({ attribution: { commit: 'Co-Authored-By: x' } }))
  setup(home, settings, 'install')
  const t = read(settings)
  t.attribution.sessionUrl = false
  fs.writeFileSync(settings, JSON.stringify(t))
  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings).attribution, { commit: 'Co-Authored-By: x', sessionUrl: false }, 'a key added since is kept')
})

test('uninstall with a damaged attribution record leaves attribution, says so, and finishes the rest', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ model: 'opus' }))
  setup(home, settings, 'install')
  fs.writeFileSync(`${home}/previous-attribution.json`, '{"commit":')
  const r = setup(home, settings, 'uninstall')
  assert.equal(r.code, 0, r.err)
  assert.equal(read(settings).statusLine, undefined)
  assert.deepEqual(read(settings).attribution, { commit: '', pr: '' })
  assert.match(r.out, /attribution/)
  assert.equal(setup(home, settings, 'uninstall').code, 0, 'a second run does not trip on it')
})

test('setup writes through a settings link whose file is not there yet, and keeps the link', () => {
  const home = tmp('home'), dir = tmp('s'), dotfiles = tmp('dotfiles')
  fs.symlinkSync(`${dotfiles}/sub/settings.json`, `${dir}/settings.json`)
  const r = setup(home, `${dir}/settings.json`, 'install')
  assert.equal(r.code, 0, r.err)
  assert.ok(fs.lstatSync(`${dir}/settings.json`).isSymbolicLink())
  assert.deepEqual(read(`${dotfiles}/sub/settings.json`).attribution, { commit: '', pr: '' })

  fs.symlinkSync('rel/target.json', `${dir}/other.json`)
  assert.equal(setup(home, `${dir}/other.json`, 'install').code, 0)
  assert.ok(fs.lstatSync(`${dir}/other.json`).isSymbolicLink())
  assert.ok(read(`${dir}/rel/target.json`).statusLine, 'a relative link resolves against its own folder')
})

test('setup resolves a missing link target against the real folder of a linked settings folder', () => {
  const home = tmp('home'), root = tmp('root')
  fs.mkdirSync(`${root}/dotfiles/claude`, { recursive: true })
  fs.symlinkSync(`${root}/dotfiles/claude`, `${root}/dot-claude`)
  fs.symlinkSync('../shared/settings.json', `${root}/dotfiles/claude/settings.json`)
  const r = setup(home, `${root}/dot-claude/settings.json`, 'install')
  assert.equal(r.code, 0, r.err)
  assert.ok(fs.lstatSync(`${root}/dotfiles/claude/settings.json`).isSymbolicLink())
  assert.ok(read(`${root}/dotfiles/shared/settings.json`).statusLine, 'the file is where the link points, not beside the folder link')
  assert.equal(fs.existsSync(`${root}/shared`), false, 'no stray file where the link folder sits')
})

test('setup keeps every link of a chain whose last file is not there yet', () => {
  const home = tmp('home'), dir = tmp('s')
  fs.symlinkSync(`${dir}/b.json`, `${dir}/a.json`)
  fs.symlinkSync('real/c.json', `${dir}/b.json`)
  const r = setup(home, `${dir}/a.json`, 'install')
  assert.equal(r.code, 0, r.err)
  assert.ok(fs.lstatSync(`${dir}/a.json`).isSymbolicLink())
  assert.ok(fs.lstatSync(`${dir}/b.json`).isSymbolicLink(), 'the middle link is not replaced by a file')
  assert.ok(read(`${dir}/real/c.json`).statusLine)
})
