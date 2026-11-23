import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmp } from '../core/helpers.mjs'

const SETUP = new URL('../../scripts/setup.mjs', import.meta.url).pathname
const setup = (home, settings, cmd, ...more) => {
  const r = spawnSync('node', [SETUP, cmd, ...more, '--settings', settings], { encoding: 'utf8', env: { ...process.env, LCW_HOME: home } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

test('install, status, uninstall round trip', () => {
  const home = tmp('home'), settings = tmp('s') + '/settings.json'
  const prev = { type: 'command', command: 'my-line' }
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark', statusLine: prev, env: { A: '1' } }))

  const i = setup(home, settings, 'install')
  assert.equal(i.code, 0, i.err)
  let s = read(settings)
  assert.equal(s.theme, 'dark')
  assert.deepEqual(s.statusLine, { type: 'command', command: `node ${home}/bin/statusline.mjs`, refreshInterval: 1, padding: 0 })
  assert.deepEqual(s.env, { A: '1', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '5' })
  assert.deepEqual(read(home + '/previous-statusline.json'), prev)
  assert.equal(fs.readdirSync(home + '/backup').length, 1)
  assert.ok(fs.existsSync(home + '/bin/statusline.mjs'))
  assert.match(i.out, /statusLine/)

  assert.match(setup(home, settings, 'status').out, /statusLine: LCW/)

  const u = setup(home, settings, 'uninstall')
  assert.equal(u.code, 0, u.err)
  s = read(settings)
  assert.deepEqual(s, { theme: 'dark', statusLine: prev, env: { A: '1' } })
  assert.equal(fs.existsSync(home + '/bin/statusline.mjs'), false)
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

test('the shim prints rows four cells short of COLUMNS, all that the padding setup writes shows', () => {
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

const lcwLine = (home) => ({ type: 'command', command: `node ${home}/bin/statusline.mjs`, refreshInterval: 1, padding: 0 })
const notices = (home) => read(home + '/notices.json')

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
  for (const kept of [null, { statusline: 'never' }]) {
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
    const r = spawnSync('node', [SETUP, 'auto', '--settings', settings], { encoding: 'utf8', cwd, env: { ...process.env, LCW_HOME: home } })
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
  assert.deepEqual(notices(home), { guide: 'never', auto: 'off' })
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
  const home = tmp('home'), config = tmp('config'), fakeHome = tmp('fh')
  fs.mkdirSync(fakeHome + '/.claude')
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
  assert.deepEqual(read(home + '/notices.json'), { attributionTold: true })
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
