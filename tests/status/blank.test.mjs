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
