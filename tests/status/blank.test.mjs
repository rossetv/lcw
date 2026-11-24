import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { tmp, lcw, makeRepo } from '../core/helpers.mjs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const LINE = `${ROOT}/scripts/statusline.mjs`
const NOW = Date.UTC(2026, 2, 10, 12)
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

/** A module to load with --import that makes every money view throw. */
function brokenMoney() {
  const dir = tmp('broken-money')
  const real = pathToFileURL(`${ROOT}/scripts/lib/money.mjs`).href
  fs.writeFileSync(`${dir}/money.mjs`, `export * from '${real}?real'\nexport function readMoney() { throw new Error('broken') }\n`)
  fs.writeFileSync(`${dir}/hooks.mjs`, `export async function resolve(s, c, next) {
  const r = await next(s, c)
  return r.url === '${real}' ? { ...r, url: '${pathToFileURL(`${dir}/money.mjs`).href}' } : r
}\n`)
  fs.writeFileSync(`${dir}/register.mjs`, `import { register } from 'node:module'\nregister('${pathToFileURL(`${dir}/hooks.mjs`).href}')\n`)
  return `${dir}/register.mjs`
}

test('a card whose money cannot be worked out still leaves the rows and the card', () => {
  const repo = makeRepo(), home = tmp('home')
  assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home, cwd: repo, session: 's1' }).code, 0)
  const input = { session_id: 's1', cwd: repo, model: { display_name: 'Opus 5' }, rate_limits: { seven_day: { used_percentage: 31, resets_at: NOW / 1000 + 3 * 86400 } } }
  const env = { ...process.env, LCW_HOME: home, COLUMNS: '120', TZ: 'UTC', LCW_NOW: String(NOW) }
  delete env.CLAUDE_PID
  const r = spawnSync('node', ['--import', brokenMoney(), LINE], { input: JSON.stringify(input), encoding: 'utf8', env })
  const text = plain(r.stdout)
  assert.match(text, /Opus 5/)
  assert.match(text, /LCW Build · demo/)
})

const BROKEN = 'LCW · status line could not load · see ~/.lcw/statusline.log\n'
const S = NOW / 1000
const INPUT = JSON.stringify({ session_id: 's1', cwd: '/', model: { display_name: 'Opus 5' } })

/** A scratch home with the launcher and the player installed and the pointer naming `pointer`. */
function scratch(pointer = ROOT) {
  const t = tmp('blank')
  const home = `${t}/lcw`
  fs.mkdirSync(`${home}/bin`, { recursive: true }); fs.mkdirSync(`${t}/h`); fs.mkdirSync(`${t}/fake`)
  for (const f of ['statusline.mjs', 'installed.mjs', 'statusline.sh']) fs.copyFileSync(`${ROOT}/scripts/bin/${f}`, `${home}/bin/${f}`)
  if (pointer) fs.writeFileSync(`${home}/plugin-root`, pointer + '\n')
  fs.writeFileSync(`${t}/fake/date`, '#!/bin/sh\nprintf "%s\\n" "$LCW_FAKE_DATE"\n', { mode: 0o755 })
  return { t, home, config: `${t}/claude` }
}
/** A stand-in plugin folder whose status line prints its own name, or runs `code`. */
function plugin(dir, code = `export async function ahead() { return 'drawn by ${dir.split('/').pop()}\\n' }\nexport async function main() { process.stdout.write('fresh from ${dir.split('/').pop()}\\n') }\n`) {
  fs.mkdirSync(`${dir}/scripts`, { recursive: true }); fs.mkdirSync(`${dir}/.claude-plugin`, { recursive: true })
  fs.writeFileSync(`${dir}/.claude-plugin/plugin.json`, JSON.stringify({ name: 'lcw', version: '1.0.0' }))
  fs.writeFileSync(`${dir}/scripts/statusline.mjs`, code)
  return dir
}
const env = (s, more = {}) => ({ PATH: process.env.PATH, HOME: `${s.t}/h`, LCW_HOME: s.home, CLAUDE_CONFIG_DIR: s.config, COLUMNS: '120', TZ: 'UTC', LCW_NOW: String(NOW), ...more })
/** One run of the launcher, as the player starts it; it must end well and print something. */
function launch(s, input = INPUT, args = [`${S}+0000`]) {
  const r = spawnSync(process.execPath, [`${s.home}/bin/statusline.mjs`, ...args], { input, encoding: 'utf8', env: env(s) })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}
/** One tick of the whole command in sh, with only the fake `date` and `extra` on the PATH. */
function tick(s, { input = INPUT, path = `${s.t}/fake` } = {}) {
  const r = spawnSync('/bin/sh', ['-c', `. '${s.home}/bin/statusline.sh'`], { input, encoding: 'utf8', env: env(s, { PATH: path, LCW_FAKE_DATE: `${S}+0000` }) })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}
const logLines = (s) => (fs.existsSync(`${s.home}/statusline.log`) ? fs.readFileSync(`${s.home}/statusline.log`, 'utf8').split('\n').filter(Boolean) : [])
const lastRows = (s, rows = 'the rows on screen\n') => { fs.mkdirSync(`${s.home}/frames/s1`, { recursive: true }); fs.writeFileSync(`${s.home}/frames/s1/last`, rows); return rows }

test('the launcher draws from the folder the pointer names', () => {
  const s = scratch()
  const a = plugin(`${s.t}/a`)
  fs.writeFileSync(`${s.home}/plugin-root`, a)
  assert.equal(launch(s), 'drawn by a\n')
  assert.deepEqual(logLines(s), [])
})

test('when the pointer\'s folder is gone, the launcher draws from the folder LCW was set up from, then from the installed plugin', () => {
  const s = scratch(`${tmp('gone')}/lcw`)
  fs.writeFileSync(`${s.home}/bin/setup-root`, plugin(`${s.t}/setup`) + '\n')
  fs.mkdirSync(`${s.config}/plugins`, { recursive: true })
  const installed = plugin(`${s.t}/installed`)
  fs.writeFileSync(`${s.config}/plugins/known_marketplaces.json`, JSON.stringify({ lcw: { source: { source: 'github', repo: 'o/lcw' } } }))
  fs.writeFileSync(`${s.config}/plugins/installed_plugins.json`, JSON.stringify({ plugins: { 'lcw@lcw': [{ installPath: installed }] } }))
  assert.equal(launch(s), 'drawn by setup\n')
  assert.equal(launch(s), 'drawn by setup\n')
  assert.equal(logLines(s).length, 1, 'one line, not one a tick')
  assert.match(logLines(s)[0], /is gone; drawing from .*\/setup/)
  fs.rmSync(`${s.t}/setup`, { recursive: true })
  assert.equal(launch(s), 'drawn by installed\n')
})

/** A stand-in for a plugin folder holding code from before frames ahead: one fresh draw from the input on stdin. */
const older = (dir) => plugin(dir, `import fs from 'node:fs'
export async function main() { process.stdout.write('fresh from ' + JSON.parse(fs.readFileSync(0, 'utf8')).session_id + ' by ${dir.split('/').pop()}\\n') }
`)

test('a pointer at a folder whose code cannot draw ahead is passed over for the folder LCW was set up from', () => {
  const s = scratch(older(`${tmp('old')}/lcw`))
  fs.writeFileSync(`${s.home}/bin/setup-root`, ROOT + '\n')
  assert.match(plain(launch(s)), /Opus 5/)
  assert.ok(fs.existsSync(`${s.home}/frames/s1/key`), 'frames drawn ahead by the current code')
})

test('the installed plugin is tried when the folder LCW was set up from holds older code too', () => {
  const s = scratch(older(`${tmp('old')}/old`))
  fs.writeFileSync(`${s.home}/bin/setup-root`, older(`${s.t}/older`) + '\n')
  fs.mkdirSync(`${s.config}/plugins`, { recursive: true })
  fs.writeFileSync(`${s.config}/plugins/known_marketplaces.json`, JSON.stringify({ lcw: { source: { source: 'github', repo: 'o/lcw' } } }))
  fs.writeFileSync(`${s.config}/plugins/installed_plugins.json`, JSON.stringify({ plugins: { 'lcw@lcw': [{ installPath: plugin(`${s.t}/installed`) }] } }))
  assert.equal(launch(s), 'drawn by installed\n')
})

test('when no folder holds code that can draw ahead, each tick is one fresh draw from the code there is, and no frames are saved', () => {
  const s = scratch(older(`${tmp('old')}/old`))
  fs.writeFileSync(`${s.home}/bin/setup-root`, older(`${s.t}/older`) + '\n')
  assert.equal(launch(s), 'fresh from s1 by old\n')
  assert.ok(!fs.existsSync(`${s.home}/frames`))
})

test('a record that names an older copy of the plugin is never followed', () => {
  const s = scratch(`${tmp('gone')}/lcw`)
  const moved = `${tmp('moved')}/lcw`
  fs.mkdirSync(`${s.config}/plugins`, { recursive: true })
  fs.writeFileSync(`${s.config}/plugins/known_marketplaces.json`, JSON.stringify({ lcw: { source: { source: 'directory', path: moved } } }))
  fs.writeFileSync(`${s.config}/plugins/installed_plugins.json`, JSON.stringify({ plugins: { 'lcw@lcw': [{ installPath: plugin(`${s.t}/old`) }] } }))
  assert.equal(launch(s), BROKEN)
  assert.match(logLines(s)[0], /no installed copy of LCW was found/)
})

test('a syntax error in LCW\'s code keeps the rows on screen, writes one line, and the next tick after the repair is live', () => {
  const s = scratch()
  const a = plugin(`${s.t}/a`, 'export async function ahead( {\n')
  fs.writeFileSync(`${s.home}/plugin-root`, a)
  const rows = lastRows(s)
  assert.equal(launch(s), rows)
  assert.equal(launch(s), rows)
  assert.equal(logLines(s).length, 1)
  assert.match(logLines(s)[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ LCW's code in .* could not be loaded/)
  plugin(a)
  assert.equal(launch(s), 'drawn by a\n')
})

test('a new session while LCW is broken prints exactly the approved line', () => {
  const s = scratch()
  fs.writeFileSync(`${s.home}/plugin-root`, plugin(`${s.t}/a`, 'syntax error here\n'))
  assert.equal(launch(s), BROKEN)
  assert.equal(tick(s, { path: `${s.t}/fake:${process.env.PATH}` }), BROKEN)
})

test('a draw that fails prints the session\'s last rows again', () => {
  const s = scratch()
  fs.writeFileSync(`${s.home}/plugin-root`, plugin(`${s.t}/a`, 'export async function ahead() { throw new Error("no") }\n'))
  const rows = lastRows(s)
  assert.equal(launch(s), rows)
  assert.match(logLines(s)[0], /could not be drawn/)
})

test('with no Node to start, the command prints the last rows, or the approved line, and logs it once', () => {
  const s = scratch()
  assert.equal(tick(s), BROKEN)
  const rows = lastRows(s)
  assert.equal(tick(s), rows)
  assert.equal(logLines(s).length, 1)
  assert.match(logLines(s)[0], new RegExp(`^${new Date(NOW).toISOString().slice(0, 19)}Z node was not found`))
})

test('with the launcher missing, the command prints the approved line and says so in the log', () => {
  const s = scratch()
  fs.rmSync(`${s.home}/bin/statusline.mjs`)
  assert.equal(tick(s, { path: `${s.t}/fake:${process.env.PATH}` }), BROKEN)
  assert.match(logLines(s)[0], /bin\/statusline\.mjs is missing/)
})

test('a log that cannot be written changes nothing on screen, and puts nothing on stderr', () => {
  const s = scratch()
  fs.writeFileSync(`${s.home}/plugin-root`, plugin(`${s.t}/a`, 'syntax error here\n'))
  fs.chmodSync(s.home, 0o500)
  try {
    for (const shell of ['/bin/sh', '/bin/bash', '/bin/zsh', '/bin/dash'].filter((x) => fs.existsSync(x))) {
      const r = spawnSync(shell, ['-c', `. '${s.home}/bin/statusline.sh'`], { input: INPUT, encoding: 'utf8', env: env(s, { PATH: `${s.t}/fake`, LCW_FAKE_DATE: `${S}+0000` }) })
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, BROKEN, ''], shell)
    }
    assert.equal(launch(s), BROKEN)
  } finally { fs.chmodSync(s.home, 0o700) }
  assert.deepEqual(logLines(s), [])
})

test('the log is cut to its newest half once it passes 64 KB', () => {
  const s = scratch()
  fs.writeFileSync(`${s.home}/plugin-root`, plugin(`${s.t}/a`, 'syntax error here\n'))
  const old = Array.from({ length: 700 }, (_, i) => `2026-01-01T00:00:00Z line ${String(i).padStart(3, '0')} ${'x'.repeat(70)}`)
  fs.writeFileSync(`${s.home}/statusline.log`, old.join('\n') + '\n')
  launch(s)
  const lines = logLines(s)
  assert.ok(fs.statSync(`${s.home}/statusline.log`).size < 40 * 1024)
  assert.equal(lines[0], old[350])
  assert.match(lines.at(-1), /could not be loaded/)
})

test('the command line installed before keeps working: one fresh draw, as the launcher gives with no second', () => {
  const s = scratch()
  const input = JSON.stringify({ session_id: 's1', cwd: makeRepo(), model: { display_name: 'Opus 5' } })
  fs.writeFileSync(`${s.home}/bin/old.mjs`, `import fs from 'node:fs'
let root = ${JSON.stringify(ROOT)}
try { root = fs.readFileSync(new URL('../plugin-root', import.meta.url), 'utf8').trim() || root } catch {}
const { main } = await import(\`\${root}/scripts/statusline.mjs\`)
await main({ margin: 4 })
`)
  const r = spawnSync(process.execPath, [`${s.home}/bin/old.mjs`], { input, encoding: 'utf8', env: env(s) })
  assert.equal(r.status, 0)
  assert.match(plain(r.stdout), /Opus 5/)
  assert.equal(launch(s, input, []), r.stdout)
  assert.ok(!fs.existsSync(`${s.home}/frames`), 'no frames without a second')
})
