#!/usr/bin/env node
// The update check: `check` says whether a newer LCW is available from where it was installed, `record` saves the
// bullets an agent wrote for it, `apply` updates with Claude Code's own plugin update. Never a stack trace: one
// plain line and a non-zero exit when something outside fails.
import { home, readJson, writeJson } from './lib/store.mjs'
import { ID, sh, newer, installed, marketVersion } from './lib/update.mjs'
import { updateFile } from '../lib/key.mjs'

const MAX_BULLETS = 3
const MAX_CHANGES = 50

const now = () => (process.env.LCW_NOW && Number.isFinite(Number(process.env.LCW_NOW)) ? Number(process.env.LCW_NOW) : Date.now())

function fail(line, code = 1) {
  console.error(line)
  process.exit(code)
}

const readUpdate = (lcwHome) => {
  const u = readJson(updateFile(lcwHome))
  return { available: u?.available ?? null, updated: u?.updated ?? null }
}

/** owner/repo of a GitHub source, or null. */
function githubRepo(source) {
  if (source.source === 'github') return source.repo || null
  const m = /github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(source.url || '')
  return m ? m[1] : null
}

function changes(source, clone, from) {
  const repo = githubRepo(source)
  const head = sh('git', ['rev-parse', 'HEAD'], { cwd: clone })
  if (!head.ok || !from) return []
  const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, MAX_CHANGES)
  if (repo) {
    const r = sh('gh', ['api', `repos/${repo}/compare/${from}...${head.out}`, '--jq', '.commits[].commit.message | split("\\n")[0]'])
    if (r.ok) return lines(r.out)
  }
  const r = sh('git', ['log', '--format=%s', `${from}..${head.out}`], { cwd: clone })
  return r.ok ? lines(r.out) : []
}

function check(lcwHome) {
  let found
  try { found = marketVersion() } catch (e) { fail(e.message) }
  // A folder checkout, or no installed copy at all: nothing to update.
  if (!found) return
  const { market, mine, version } = found
  if (!newer(version, mine.version)) {
    const u = readUpdate(lcwHome)
    if (u.available) writeJson(updateFile(lcwHome), { ...u, available: null })
    return
  }
  console.log(JSON.stringify({ version, from: mine.version, changes: changes(market.source, market.installLocation, mine.gitCommitSha) }))
}

function record(lcwHome, args) {
  const take = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] !== undefined ? [args[i + 1]] : []))
  const [version] = take('--version')
  const [from] = take('--from')
  if (!version || !from) fail('record needs --version and --from', 2)
  const bullets = take('--bullet').map((b) => b.trim()).filter(Boolean).slice(0, MAX_BULLETS)
  writeJson(updateFile(lcwHome), { ...readUpdate(lcwHome), available: { version, from, bullets, at: now() } })
}

function apply(lcwHome) {
  const u = readUpdate(lcwHome)
  const before = installed()?.version
  const r = sh('claude', ['plugin', 'update', ID], { timeout: 170000 })
  if (!r.ok) fail(r.text)
  const to = installed()?.version
  if (!to || to === before) fail(`LCW is already at ${before}; the update changed nothing.`)
  // The bullets were written for the version the check found; if the marketplace moved on since, they do not describe this one.
  const bullets = u.available?.version === to ? u.available.bullets : []
  writeJson(updateFile(lcwHome), { available: null, updated: { to, from: before, bullets, at: now() } })
  console.log(`LCW updated to ${to}. Restart Claude Code to use it.`)
}

const [cmd, ...args] = process.argv.slice(2)
const lcwHome = home()
try {
  if (cmd === 'check') check(lcwHome)
  else if (cmd === 'record') record(lcwHome, args)
  else if (cmd === 'apply') apply(lcwHome)
  else fail('usage: update.mjs check | record --version V --from V [--bullet T]... | apply', 2)
} catch (e) {
  fail(`The LCW update ${cmd} failed: ${e.message}`)
}
