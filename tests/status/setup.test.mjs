import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmp, installedConfig } from '../core/helpers.mjs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const SETUP = `${ROOT}/scripts/setup.mjs`
// Claude Code's records name this copy as the installed plugin, unless a test says otherwise
const INSTALLED = installedConfig()
const setup = (home, settings, cmd, ...more) => {
  const r = spawnSync('node', [SETUP, cmd, ...more, '--settings', settings], { encoding: 'utf8', env: { ...process.env, LCW_HOME: home, CLAUDE_CONFIG_DIR: INSTALLED } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const BIN = fs.readdirSync(`${ROOT}/scripts/bin`)
const BROKEN = 'LCW · status line could not load · see ~/.lcw/statusline.log\n'
const playerCommand = (home) => `lcw_bin='${home}/bin'; [ -r "$lcw_bin/statusline.sh" ] && . "$lcw_bin/statusline.sh"; node "$lcw_bin/statusline.mjs" || printf '%s\\n' '${BROKEN.trim()}'`
const lcwLine = (home) => ({ type: 'command', command: playerCommand(home), refreshInterval: 1, padding: 0 })
const oldLine = (home) => ({ type: 'command', command: `node ${home}/bin/statusline.mjs`, refreshInterval: 1, padding: 0 })
const notices = (home) => read(home + '/notices.json')
const INPUT = JSON.stringify({ session_id: 's1', model: { display_name: 'Opus 5' }, cwd: '/' })
/** Runs a status line command as Claude Code does, through sh, with Claude Code's input on stdin. */
const tick = (home, command, env = {}) => spawnSync('sh', ['-c', command], { input: INPUT, encoding: 'utf8', env: { ...process.env, LCW_HOME: home, COLUMNS: '100', ...env } })
const plain = (t) => t.replace(/\x1b\][^\x1b]*\x1b\\/g, '').replace(/\x1b\[[0-9;]*m/g, '')

test('install, status, uninstall round trip', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  const prev = { type: 'command', command: 'my-line' }
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark', statusLine: prev, env: { A: '1' } }))

  const i = setup(home, settings, 'install')
  assert.equal(i.code, 0, i.err)
  let s = read(settings)
  assert.equal(s.theme, 'dark')
  assert.deepEqual(s.statusLine, lcwLine(home))
  assert.deepEqual(s.env, { A: '1', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '5', CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '80' })
  assert.deepEqual(read(home + '/previous-statusline.json'), prev)
  assert.equal(fs.readdirSync(home + '/backup').length, 1)
  for (const f of BIN) assert.equal(fs.readFileSync(`${home}/bin/${f}`, 'utf8'), fs.readFileSync(`${ROOT}/scripts/bin/${f}`, 'utf8'), f)
  assert.equal(fs.readFileSync(`${home}/bin/setup-root`, 'utf8'), ROOT + '\n')
  assert.match(plain(tick(home, s.statusLine.command).stdout), /Opus 5/)
  assert.match(i.out, /statusLine/)

  assert.match(setup(home, settings, 'status').out, /statusLine: LCW/)

  const u = setup(home, settings, 'uninstall')
  assert.equal(u.code, 0, u.err)
  s = read(settings)
  assert.deepEqual(s, { theme: 'dark', statusLine: prev, env: { A: '1' } })
  assert.deepEqual(fs.readdirSync(home + '/bin'), [])
  assert.match(setup(home, settings, 'status').out, /another command/)
})

test('an uninstall that cannot write the settings keeps its records, so a later one still restores them', { skip: process.getuid?.() === 0 }, () => {
  const home = tmp('home'), dir = tmp('s'), settings = dir + '/settings.json'
  const prev = { type: 'command', command: 'my-line' }
  fs.writeFileSync(settings, JSON.stringify({ statusLine: prev, attribution: { commit: 'mine' } }))
  assert.equal(setup(home, settings, 'install').code, 0)
  fs.chmodSync(dir, 0o555) // the settings file cannot be replaced
  try { assert.notEqual(setup(home, settings, 'uninstall').code, 0) } finally { fs.chmodSync(dir, 0o755) }
  assert.deepEqual(read(home + '/previous-statusline.json'), prev)
  assert.ok(fs.existsSync(home + '/previous-attribution.json'))
  assert.equal(setup(home, settings, 'uninstall').code, 0)
  assert.deepEqual(read(settings).statusLine, prev)
})

test('install creates a missing settings file and keeps an existing depth', () => {
  const home = tmp('home'), dir = tmp('s'), settings = dir + '/new/settings.json'
  assert.equal(setup(home, settings, 'install').code, 0)
  assert.equal(read(settings).env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '5')
  const f2 = dir + '/b.json'
  fs.writeFileSync(f2, JSON.stringify({ env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '3' } }))
  setup(home, f2, 'install')
  assert.equal(read(f2).env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '3')
})

test('refuses a settings file that does not parse', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, '{ nope')
  for (const cmd of ['install', 'uninstall']) {
    const r = setup(home, settings, cmd)
    assert.equal(r.code, 1)
    assert.equal(fs.readFileSync(settings, 'utf8'), '{ nope')
  }
})

test('the launcher, as the first installs ran it, prints rows four cells short of COLUMNS, all that the padding setup writes shows', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  setup(home, settings, 'install')
  const input = JSON.stringify({ model: { display_name: 'Opus 5' }, cwd: tmp('cwd'), rate_limits: { seven_day: { used_percentage: 20, resets_at: Math.floor(Date.now() / 1000) + 3 * 86400 } } })
  for (const columns of [100, 126]) {
    const r = spawnSync('node', [home + '/bin/statusline.mjs'], { input, encoding: 'utf8', env: { ...process.env, LCW_HOME: home, COLUMNS: String(columns) } })
    assert.equal(r.status, 0)
    const cells = r.stdout.replace(/\x1b\][^\x1b]*\x1b\\/g, '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean).map((row) => [...row].length)
    assert.ok(cells.length > 0 && cells.every((n) => n === columns - 4), columns + ': ' + cells.join(',') + r.stderr)
  }
})

test('install adds the LCW folder to additionalDirectories, uninstall takes it out', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ permissions: { additionalDirectories: ['/other'] } }))
  const i = setup(home, settings, 'install')
  assert.match(i.out, /additionalDirectories/)
  assert.deepEqual(read(settings).permissions.additionalDirectories, ['/other', home])
  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings).permissions, { additionalDirectories: ['/other'] })
})

test('install --advisor turns the advisor on, and uninstall takes back only what it set', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark' }))
  assert.equal(read(settings).advisorModel, undefined)
  assert.equal(setup(home, settings, 'install').code, 0)
  assert.equal(read(settings).advisorModel, undefined, 'plain install leaves the advisor alone')
  const i = setup(home, settings, 'install', '--advisor')
  assert.equal(i.code, 0, i.err)
  assert.equal(read(settings).advisorModel, 'fable')
  assert.match(setup(home, settings, 'status').out, /advisorModel: fable/)
  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings), { theme: 'dark' })
})

test('install turns AI attribution off and uninstall puts back what was there; an attribution already off is left alone', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ attribution: { commit: 'Co-Authored-By: x', sessionUrl: false } }))
  assert.equal(setup(home, settings, 'install').code, 0)
  assert.deepEqual(read(settings).attribution, { commit: '', pr: '', sessionUrl: false })
  assert.match(setup(home, settings, 'status').out, /AI attribution: off/)
  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings).attribution, { commit: 'Co-Authored-By: x', sessionUrl: false })

  const off = { commit: '', pr: '' }
  fs.writeFileSync(settings, JSON.stringify({ attribution: off }))
  setup(home, settings, 'install')
  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings).attribution, off)
})

test('the advisor the human already chose is never changed or removed', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ advisorModel: 'opus' }))
  const a = setup(home, settings, 'advisor')
  assert.equal(a.code, 0, a.err)
  assert.match(a.out, /already/)
  assert.equal(read(settings).advisorModel, 'opus')
  setup(home, settings, 'install', '--advisor')
  setup(home, settings, 'uninstall')
  assert.equal(read(settings).advisorModel, 'opus')
})

test('auto turns the status rows on when there is no status line, with a backup and one line, and then stays quiet', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark', attribution: { commit: '', pr: '' } }))
  const r = setup(home, settings, 'auto')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(read(settings), { theme: 'dark', attribution: { commit: '', pr: '' }, statusLine: lcwLine(home) })
  assert.equal(fs.readdirSync(home + '/backup').length, 1)
  assert.ok(fs.existsSync(home + '/bin/statusline.mjs'))
  assert.equal(r.out.trim().split('\n').length, 1, r.out)
  assert.match(r.out, /status rows/)
  assert.match(r.out, /uninstall LCW/)
  assert.equal(setup(home, settings, 'auto').out, '')
  assert.equal(fs.readdirSync(home + '/backup').length, 1, 'no second backup when nothing changes')
})

test('auto leaves a status line of the person\'s own, and one they chose to keep', () => {
  const mineLine = { type: 'command', command: 'my-line' }
  for (const kept of [null, { statusline: 'never' }, { statusline: 'moved', statuslineKept: 'never' }]) {
    const home = tmp('home'), settings = tmp('s') + '/settings.json'
    if (kept) fs.writeFileSync(home + '/notices.json', JSON.stringify(kept))
    fs.writeFileSync(settings, JSON.stringify(kept ? { attribution: { commit: '', pr: '' } } : { statusLine: mineLine, attribution: { commit: '', pr: '' } }))
    const before = fs.readFileSync(settings, 'utf8')
    const r = setup(home, settings, 'auto')
    assert.equal(r.out, '')
    assert.equal(fs.readFileSync(settings, 'utf8'), before)
    assert.ok(!fs.existsSync(home + '/bin/statusline.mjs'))
  }
})

test('auto leaves the status line alone when the folder\'s own settings set one, but still turns attribution off', () => {
  for (const f of ['settings.json', 'settings.local.json']) {
    const home = tmp('home'), settings = tmp('s') + '/settings.json', cwd = tmp('proj')
    fs.mkdirSync(cwd + '/.claude')
    fs.writeFileSync(cwd + '/.claude/' + f, JSON.stringify({ statusLine: { type: 'command', command: 'proj-line' } }))
    fs.writeFileSync(settings, '{}')
    const r = spawnSync('node', [SETUP, 'auto', '--settings', settings], { encoding: 'utf8', cwd, env: { ...process.env, LCW_HOME: home, CLAUDE_CONFIG_DIR: INSTALLED } })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(read(settings).statusLine, undefined, f)
    assert.deepEqual(read(settings).attribution, { commit: '', pr: '' })
    assert.ok(!/status rows/.test(r.stdout), r.stdout)
  }
})

test('a change that finds the settings the same as the newest backup does not write another backup', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark' }))
  setup(home, settings, 'statusline')
  assert.equal(fs.readdirSync(home + '/backup').length, 1)
  const after = fs.readFileSync(settings, 'utf8')
  setup(home, settings, 'statusline') // changes nothing but is saved again: a copy of the first result is a new backup
  assert.equal(fs.readdirSync(home + '/backup').length, 2)
  fs.writeFileSync(settings, after) // the same text as the newest backup now
  setup(home, settings, 'statusline')
  assert.equal(fs.readdirSync(home + '/backup').length, 2)
})

test('auto turns attribution off keeping the rest of it, saves the original once, tells once, and puts it back off when turned on again', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  const original = { commit: 'Co-Authored-By: x', sessionUrl: false }
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'my-line' }, attribution: original }))
  const first = setup(home, settings, 'auto')
  assert.deepEqual(read(settings).attribution, { commit: '', pr: '', sessionUrl: false })
  assert.match(first.out, /attribution/)
  assert.equal(first.out.trim().split('\n').length, 1)
  assert.equal(notices(home).attributionTold, true)
  assert.equal(fs.readdirSync(home + '/backup').length, 1)

  const s = read(settings)
  s.attribution = { commit: 'again', pr: 'again' }
  fs.writeFileSync(settings, JSON.stringify(s))
  const second = setup(home, settings, 'auto')
  assert.equal(second.out, '', 'told once')
  assert.deepEqual(read(settings).attribution, { commit: '', pr: '' })
  assert.deepEqual(read(home + '/previous-attribution.json'), original, 'the original is never replaced')

  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings).attribution, original)
})

test('uninstall writes auto off, keeping the other notices, and auto then does nothing', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(home + '/notices.json', JSON.stringify({ guide: 'never' }))
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark' }))
  setup(home, settings, 'install')
  setup(home, settings, 'uninstall')
  assert.deepEqual(notices(home), { guide: 'never', statusline: 'moved', auto: 'off' })
  const r = setup(home, settings, 'auto')
  assert.equal(r.out, '')
  assert.deepEqual(read(settings), { theme: 'dark' })
})

test('statusline puts LCW\'s rows back and saves another status line first', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  const prev = { type: 'command', command: 'my-line' }
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark', statusLine: prev }))
  const r = setup(home, settings, 'statusline')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(read(settings), { theme: 'dark', statusLine: lcwLine(home) })
  assert.deepEqual(read(home + '/previous-statusline.json'), prev)
  assert.equal(fs.readdirSync(home + '/backup').length, 1)
})

test('without --settings the file is the one in CLAUDE_CONFIG_DIR when set, else in HOME/.claude', () => {
  const home = tmp('home'), config = installedConfig(), fakeHome = tmp('fh')
  fs.cpSync(installedConfig(), fakeHome + '/.claude', { recursive: true })
  const go = (env) => spawnSync('node', [SETUP, 'auto'], { encoding: 'utf8', env: { ...process.env, LCW_HOME: home, HOME: fakeHome, CLAUDE_CONFIG_DIR: '', ...env } })
  assert.equal(go({ CLAUDE_CONFIG_DIR: config }).status, 0)
  assert.ok(read(config + '/settings.json').statusLine)
  assert.ok(!fs.existsSync(fakeHome + '/.claude/settings.json'))
  fs.rmSync(home, { recursive: true })
  assert.equal(go({}).status, 0)
  assert.ok(read(fakeHome + '/.claude/settings.json').statusLine)
})

test('install turns automatic setup back on after uninstall, keeping the other notices', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  setup(home, settings, 'install')
  fs.writeFileSync(home + '/notices.json', JSON.stringify({ attributionTold: true }))
  setup(home, settings, 'uninstall')
  assert.equal(read(home + '/notices.json').auto, 'off')
  setup(home, settings, 'install')
  assert.deepEqual(read(home + '/notices.json'), { attributionTold: true, statusline: 'moved' })
})

test('install lets the advisor and spend boxes ask again and leaves the other boxes\' choices', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  const kept = { statusline: 'never', 'cleanup:k': 'never', awake: 'never', guide: 'never', 'whatsnew:1.2.3': 'never', attributionTold: true }
  fs.writeFileSync(home + '/notices.json', JSON.stringify({ ...kept, advisor: 'never', spend: 'never', auto: 'off' }))
  assert.equal(setup(home, settings, 'install').code, 0)
  assert.deepEqual(read(home + '/notices.json'), kept)
})

test('putting LCW\'s line back over a newer line of the person\'s saves that one for uninstall', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'starship' } }))
  setup(home, settings, 'install')
  const newer = { type: 'command', command: 'ccstatusline' }
  fs.writeFileSync(settings, JSON.stringify({ statusLine: newer }))
  setup(home, settings, 'statusline')
  assert.deepEqual(read(home + '/previous-statusline.json'), newer)
  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings).statusLine, newer)
})

test('putting LCW\'s line back over LCW\'s own keeps the saved line', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  const first = { type: 'command', command: 'starship' }
  fs.writeFileSync(settings, JSON.stringify({ statusLine: first }))
  setup(home, settings, 'install')
  setup(home, settings, 'statusline')
  assert.deepEqual(read(home + '/previous-statusline.json'), first)
  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings).statusLine, first)
})

test('uninstall drops the saved status line even when the person had replaced the LCW line', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'starship' } }))
  setup(home, settings, 'install')
  const cc = { type: 'command', command: 'ccstatusline' }
  fs.writeFileSync(settings, JSON.stringify({ statusLine: cc }))
  setup(home, settings, 'uninstall')
  setup(home, settings, 'install')
  setup(home, settings, 'uninstall')
  assert.deepEqual(read(settings).statusLine, cc)
})

test('uninstall leaves no status line when the person deleted theirs before LCW put its own back', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'starship' } }))
  setup(home, settings, 'install')
  fs.writeFileSync(settings, '{}')
  setup(home, settings, 'auto')
  assert.equal(read(settings).statusLine.command, lcwLine(home).command)
  setup(home, settings, 'uninstall')
  assert.equal(read(settings).statusLine, undefined)
  assert.ok(!fs.existsSync(home + '/previous-statusline.json'))
})

test('uninstall does not restore a saved record that is not a status line', () => {
  for (const bad of ['[1]', '"echo"', '5', '{}', '{"command":5}', '{"command":""}', '{"command":"  "}']) {
    const home = tmp('home'), settings = tmp('s') + '/settings.json'
    fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'echo A' } }))
    setup(home, settings, 'install')
    fs.writeFileSync(home + '/previous-statusline.json', bad)
    const u = setup(home, settings, 'uninstall')
    assert.equal(read(settings).statusLine, undefined, bad)
    assert.doesNotMatch(u.out, /restored your previous statusLine/, bad)
    assert.match(u.out, /removed statusLine/, bad)
    assert.ok(!fs.existsSync(home + '/previous-statusline.json'), bad)
  }
})

test('from the installed copy, auto turns LCW\'s older command into the new one once, silently, after the notice that quiets older mods', () => {
  for (const [old, label] of [[oldLine, 'home'], [(h) => ({ ...oldLine(h), command: `node '${h}/bin/statusline.mjs'`, padding: 2 }), 'my home']]) {
    const home = tmp(label) + '/.lcw', settings = tmp('s') + '/settings.json'
    fs.mkdirSync(home + '/bin', { recursive: true })
    fs.writeFileSync(home + '/bin/statusline.mjs', '// an older launcher\n')
    fs.writeFileSync(settings, JSON.stringify({ theme: 'dark', statusLine: old(home), attribution: { commit: '', pr: '' } }))
    const r = setup(home, settings, 'auto')
    assert.equal(r.code, 0, r.err)
    assert.equal(r.out, '', 'nothing is said')
    assert.deepEqual(read(settings), { theme: 'dark', statusLine: { ...old(home), command: playerCommand(home) }, attribution: { commit: '', pr: '' } })
    assert.deepEqual(notices(home), { statusline: 'moved' })
    assert.ok(fs.statSync(settings).mtimeMs - fs.statSync(home + '/notices.json').mtimeMs >= 250, 'the settings wait behind the notice')
    for (const f of BIN) assert.equal(fs.readFileSync(`${home}/bin/${f}`, 'utf8'), fs.readFileSync(`${ROOT}/scripts/bin/${f}`, 'utf8'), f)
    assert.match(plain(tick(home, old(home).command).stdout), /Opus 5/, 'the old command still prints rows')
    assert.match(plain(tick(home, playerCommand(home)).stdout), /Opus 5/)

    const after = fs.readFileSync(settings, 'utf8'), backups = fs.readdirSync(home + '/backup').length
    assert.equal(setup(home, settings, 'auto').out, '')
    assert.equal(fs.readFileSync(settings, 'utf8'), after, 'a second call changes nothing')
    assert.equal(fs.readdirSync(home + '/backup').length, backups)
  }
})

test('a Keep mine chosen before is kept when LCW\'s own command moves', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(home + '/notices.json', JSON.stringify({ statusline: 'never' }))
  fs.writeFileSync(settings, JSON.stringify({ statusLine: oldLine(home), attribution: { commit: '', pr: '' } }))
  setup(home, settings, 'auto')
  assert.equal(read(settings).statusLine.command, playerCommand(home))
  assert.deepEqual(notices(home), { statusline: 'never' })
})

test('auto under one LCW home leaves a command that names another home\'s files as it is, old or new', () => {
  for (const line of [oldLine, lcwLine]) {
    const a = tmp('a'), b = tmp('b'), settings = tmp('s') + '/settings.json'
    fs.writeFileSync(settings, JSON.stringify({ statusLine: line(a), attribution: { commit: '', pr: '' } }))
    const before = fs.readFileSync(settings, 'utf8')
    const r = setup(b, settings, 'auto')
    assert.equal(r.code, 0, r.err)
    assert.equal(fs.readFileSync(settings, 'utf8'), before, line(a).command)
    assert.deepEqual(fs.readdirSync(b), [])
  }
})

/** A copy of this plugin at dir, as Claude Code keeps one or as a checkout holds it. */
const pluginCopy = (dir) => { for (const d of ['scripts', 'lib', '.claude-plugin']) fs.cpSync(`${ROOT}/${d}`, `${dir}/${d}`, { recursive: true }); return dir }
/** Claude Code's records in config: these marketplaces, and these install records unless null. */
const records = (config, markets, plugins) => {
  fs.mkdirSync(`${config}/plugins`, { recursive: true })
  fs.writeFileSync(`${config}/plugins/known_marketplaces.json`, JSON.stringify(markets))
  if (plugins) fs.writeFileSync(`${config}/plugins/installed_plugins.json`, JSON.stringify({ version: 2, plugins }))
  else fs.rmSync(`${config}/plugins/installed_plugins.json`, { force: true })
}
/** Whether auto from the copy at dir, under these records, moves LCW's older command to the new one; it writes no file when it does not. */
function autoMoves(dir, config) {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  fs.writeFileSync(settings, JSON.stringify({ statusLine: oldLine(home), attribution: { commit: '', pr: '' } }))
  const r = spawnSync('node', [`${dir}/scripts/setup.mjs`, 'auto', '--settings', settings], { encoding: 'utf8', env: { ...process.env, LCW_HOME: home, CLAUDE_CONFIG_DIR: config } })
  assert.equal(r.status, 0, r.stderr)
  const command = read(settings).statusLine.command
  if (command === oldLine(home).command) { assert.ok(!fs.existsSync(home + '/bin')); return false }
  assert.equal(command, playerCommand(home))
  return true
}

test('auto moves LCW\'s command only from a version an install record names, in any order; a cached one none names changes nothing, unless there are no records', () => {
  const config = tmp('claude')
  const v = Object.fromEntries(['0.8.1', '0.8.0', '0.7.9'].map((n) => [n, pluginCopy(`${config}/plugins/cache/lcw/lcw/${n}`)]))
  const market = { lcw: { source: { source: 'github', repo: 'owner/lcw' } } }
  records(config, market, { 'lcw@lcw': [{ scope: 'project', projectPath: '/a/project', installPath: v['0.8.0'] }, { scope: 'user', installPath: v['0.8.1'] }] })
  assert.deepEqual(['0.8.1', '0.8.0', '0.7.9'].map((n) => autoMoves(v[n], config)), [true, true, false])
  records(config, market, null)
  assert.equal(autoMoves(v['0.7.9'], config), true)
})

test('auto moves LCW\'s command from the checkout a directory marketplace loads, not from the older cached copy its record names', () => {
  const config = tmp('claude')
  const checkout = pluginCopy(`${tmp('dev')}/lcw`), stale = pluginCopy(`${config}/plugins/cache/lcw/lcw/0.6.22`)
  records(config, { lcw: { source: { source: 'directory', path: checkout } } }, { 'lcw@lcw': [{ scope: 'user', installPath: stale }] })
  assert.equal(autoMoves(checkout, config), true)
  assert.equal(autoMoves(stale, config), false)
})

test('auto from a throwaway copy changes no setting and no file, whatever the status line', () => {
  const elsewhere = installedConfig(tmp('installed'))
  for (const line of [undefined, oldLine]) {
    const home = tmp('home'), settings = tmp('s') + '/settings.json'
    fs.mkdirSync(home + '/bin')
    if (line) fs.writeFileSync(home + '/bin/statusline.mjs', '// an older launcher\n')
    fs.writeFileSync(settings, JSON.stringify(line ? { statusLine: line(home) } : { theme: 'dark' }))
    const before = fs.readFileSync(settings, 'utf8')
    const r = spawnSync('node', [SETUP, 'auto', '--settings', settings], { encoding: 'utf8', env: { ...process.env, LCW_HOME: home, CLAUDE_CONFIG_DIR: elsewhere } })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
    assert.equal(fs.readFileSync(settings, 'utf8'), before)
    assert.deepEqual(fs.readdirSync(home), ['bin'])
    assert.deepEqual(fs.readdirSync(home + '/bin'), line ? ['statusline.mjs'] : [])
  }
})

test('with LCW\'s code broken and no rows saved, the status line prints exactly the fallback line and ends well', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  setup(home, settings, 'install')
  const broken = tmp('broken')
  fs.mkdirSync(broken + '/scripts')
  fs.writeFileSync(broken + '/scripts/statusline.mjs', 'syntax error here\n')
  fs.writeFileSync(home + '/plugin-root', broken + '\n')
  const r = tick(home, read(settings).statusLine.command)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, BROKEN)

  fs.rmSync(home + '/bin/statusline.sh')
  // a PATH of one empty folder: no Node on it, and the rest of the command is the shell's own
  const noNode = spawnSync('/bin/sh', ['-c', read(settings).statusLine.command], { input: INPUT, encoding: 'utf8', env: { LCW_HOME: home, HOME: tmp('h'), PATH: tmp('empty') } })
  assert.equal(noNode.status, 0, 'without the player and without Node')
  assert.equal(noNode.stdout, BROKEN)
})

test('the command setup wrote under one LCW home draws, and saves its frames, under the LCW home the session has', () => {
  const a = tmp('a') + '/.lcw', b = tmp('b') + '/.lcw', settings = tmp('s') + '/settings.json'
  fs.mkdirSync(b)
  assert.equal(setup(a, settings, 'install').code, 0)
  const r = spawnSync('/bin/sh', ['-c', read(settings).statusLine.command], { input: INPUT, encoding: 'utf8', env: { ...process.env, LCW_HOME: b, COLUMNS: '100' } })
  assert.equal(r.status, 0, r.stderr)
  const rows = plain(r.stdout).split('\n').filter(Boolean)
  assert.equal(rows.length, 2, r.stdout)
  assert.match(rows.join('\n'), /Opus 5/)
  assert.ok(fs.existsSync(b + '/frames/s1'), 'the frames are under the session\'s LCW home')
  assert.ok(!fs.existsSync(a + '/frames'))
})

test('on Windows setup writes the node command, and no notice', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  const win = tmp('win') + '/win.mjs'
  fs.writeFileSync(win, "Object.defineProperty(process, 'platform', { value: 'win32' })\n")
  const r = spawnSync('node', ['--import', win, SETUP, 'install', '--settings', settings], { encoding: 'utf8', env: { ...process.env, LCW_HOME: home, CLAUDE_CONFIG_DIR: INSTALLED } })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(read(settings).statusLine, oldLine(home))
  assert.ok(!fs.existsSync(home + '/notices.json'))
  const auto = spawnSync('node', ['--import', win, SETUP, 'auto', '--settings', settings], { encoding: 'utf8', env: { ...process.env, LCW_HOME: home, CLAUDE_CONFIG_DIR: INSTALLED } })
  assert.equal(auto.stdout, '')
  assert.deepEqual(read(settings).statusLine, oldLine(home), 'auto leaves the node command as it is')
})
