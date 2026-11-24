import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp } from './helpers.mjs'
import { isInstalled, installedFolder } from '../../scripts/bin/installed.mjs'

const write = (file, body) => { fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true }); fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body)) }
const plugin = (dir) => { write(`${dir}/.claude-plugin/plugin.json`, { name: 'lcw', version: '1.0.0' }); return dir }

/** A config folder with the given records, set as CLAUDE_CONFIG_DIR for the code under test. */
function config({ markets, installs }) {
  const dir = tmp('claude')
  if (markets !== undefined) write(`${dir}/plugins/known_marketplaces.json`, markets)
  if (installs !== undefined) write(`${dir}/plugins/installed_plugins.json`, installs)
  process.env.CLAUDE_CONFIG_DIR = dir
  return dir
}

/** A directory marketplace listing LCW in a subfolder, whose install record names an older copy in the cache. */
function directoryMarket() {
  const market = tmp('market')
  write(`${market}/.claude-plugin/marketplace.json`, { name: 'dev', plugins: [{ name: 'other', source: './' }, { name: 'lcw', source: './lcw' }] })
  const live = plugin(`${market}/lcw`)
  const conf = config({
    markets: { dev: { source: { source: 'directory', path: market }, installLocation: market } },
    installs: { version: 2, plugins: {} },
  })
  const old = plugin(`${conf}/plugins/cache/dev/lcw/0.1.0`)
  write(`${conf}/plugins/installed_plugins.json`, { version: 2, plugins: { 'lcw@dev': [{ scope: 'user', installPath: old, version: '0.1.0' }] } })
  return { market, live, old }
}

/** A marketplace of another kind, added under a name that is not the plugin's. */
function githubMarket() {
  const conf = config({ markets: { tools: { source: { source: 'github', repo: 'owner/tools' }, installLocation: '/nowhere' } } })
  const current = plugin(`${conf}/plugins/cache/tools/lcw/2.0.0`)
  write(`${conf}/plugins/installed_plugins.json`, { version: 2, plugins: { 'lcw@tools': [{ scope: 'user', installPath: current, version: '2.0.0' }] } })
  return { conf, current }
}

test('a directory marketplace counts its listed folder as installed and a copy elsewhere as a throwaway', () => {
  const { market, live } = directoryMarket()
  assert.equal(isInstalled(live), true)
  assert.equal(isInstalled(`${market}/lcw/`), true)
  assert.equal(isInstalled(market), false, 'the marketplace folder holds another plugin, not this one')
  assert.equal(isInstalled(plugin(tmp('copy'))), false)
  assert.equal(installedFolder(), live)
})

test('a directory marketplace never follows its recorded install path to an older copy', () => {
  const { live, old } = directoryMarket()
  assert.equal(isInstalled(old), false)
  fs.rmSync(live, { recursive: true })
  assert.equal(installedFolder(), null)
})

test('another kind of marketplace counts its recorded install path and its cache copies as installed, under any marketplace name', () => {
  const { conf, current } = githubMarket()
  assert.equal(isInstalled(current), true)
  assert.equal(isInstalled(plugin(`${conf}/plugins/cache/tools/lcw/1.0.0`)), true, 'an older version in the cache')
  assert.equal(isInstalled(plugin(`${conf}/plugins/cache/tools/other/1.0.0`)), false, 'another plugin in the same cache')
  assert.equal(isInstalled(plugin(`${conf}/plugins/cache/elsewhere/lcw/1.0.0`)), false, 'a marketplace that is not known')
  assert.equal(isInstalled(`${conf}/plugins/cache/tools/lcw`), false, 'the cache folder itself')
  assert.equal(isInstalled(plugin(tmp('copy'))), false)
  assert.equal(installedFolder(), current)
})

test('a path through a link to the installed folder counts as installed', () => {
  const { live } = directoryMarket()
  const link = `${tmp('link')}/lcw`
  fs.symlinkSync(live, link)
  assert.equal(isInstalled(link), true)
  const { current } = githubMarket()
  fs.rmSync(link)
  fs.symlinkSync(current, link)
  assert.equal(isInstalled(link), true)
})

test('where the installed plugin is answers nothing once its folder is gone or no longer holds the plugin', () => {
  const { current } = githubMarket()
  fs.rmSync(`${current}/.claude-plugin`, { recursive: true })
  assert.equal(installedFolder(), null)
  fs.rmSync(current, { recursive: true })
  assert.equal(installedFolder(), null)
})

test('missing, unreadable and malformed records mean not installed, and nothing throws', () => {
  const copy = plugin(tmp('copy'))
  const cases = [
    {},
    { markets: 'not json' },
    { markets: null },
    { markets: ['lcw'] },
    { markets: { lcw: 'directory' } },
    { markets: { lcw: { source: { source: 'directory' } } } },
    { markets: { lcw: { source: { source: 'directory', path: copy } } } },
    { markets: { lcw: { source: { source: 'github' } } }, installs: { plugins: { 'lcw@lcw': { installPath: copy } } } },
    { markets: { lcw: { source: { source: 'github' } } }, installs: { plugins: { 'lcw@lcw': [{ installPath: 42 }, null] } } },
    { markets: { lcw: { source: { source: 'github' } } }, installs: 'not json' },
  ]
  for (const records of cases) {
    config(records)
    assert.equal(isInstalled(copy), false, JSON.stringify(records))
    assert.equal(installedFolder(), null, JSON.stringify(records))
  }
  const conf = config({})
  fs.mkdirSync(`${conf}/plugins/known_marketplaces.json`, { recursive: true })
  assert.equal(isInstalled(copy), false, 'a record that cannot be read')
  assert.equal(installedFolder(), null)
})

test('a directory marketplace whose listing is malformed counts nothing as installed', () => {
  const market = tmp('market')
  config({ markets: { dev: { source: { source: 'directory', path: market } } } })
  for (const listing of ['not json', { plugins: 'lcw' }, { plugins: [null, { name: 'lcw' }] }, { plugins: [{ name: 'lcw', source: { source: 'github', repo: 'owner/lcw' } }] }]) {
    write(`${market}/.claude-plugin/marketplace.json`, listing)
    assert.equal(isInstalled(market), false, JSON.stringify(listing))
    assert.equal(installedFolder(), null)
  }
})
