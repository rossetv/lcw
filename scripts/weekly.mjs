#!/usr/bin/env node
// node scripts/weekly.mjs due
// Prints the one prompt whose weekly check is due (the update check first, else the cleanup check), or nothing. The mod
// submits it into the person's idle session; Claude has a Sonnet probe do the looking. The asked time is recorded here, so
// a crash or a declined prompt does not ask again for a week. Never a stack trace.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { home, git, readJson, writeJson, mainCheckout } from './lib/store.mjs'
import { candidates, recorded, boxFile, boxCurrent } from './lib/cleanup.mjs'
import { checksFile, repoChecksFile, noticesFile, repoKey } from '../lib/key.mjs'

const WEEK = 7 * 24 * 3600 * 1000
const scripts = path.dirname(fileURLToPath(import.meta.url))
// a path as one shell word, so a folder with a space or a quote in it still runs
const sh = (p) => `'${p.replace(/'/g, `'\\''`)}'`
const plugins = () => `${process.env.CLAUDE_CONFIG_DIR || `${process.env.HOME}/.claude`}/plugins`
const now = () => (process.env.LCW_NOW && Number.isFinite(Number(process.env.LCW_NOW)) ? Number(process.env.LCW_NOW) : Date.now())
const overdue = (at) => !Number.isFinite(at) || now() - at > WEEK

// Installed from a marketplace that is not a folder checkout (the same test update.mjs check makes).
function updatable() {
  const market = readJson(`${plugins()}/known_marketplaces.json`)?.lcw
  const mine = readJson(`${plugins()}/installed_plugins.json`)?.plugins?.['lcw@lcw']?.[0]
  return !!(market && mine?.version && market.source?.source !== 'directory' && market.source?.source !== 'file')
}

// The briefs live in the lcw:weekly skill; the line carries only what the skill cannot know, where the scripts are.
const updatePrompt = () => `LCW weekly check: load the lcw:weekly skill and run its update check. Scripts: ${sh(scripts)}.`
const cleanupPrompt = () => `LCW weekly check: load the lcw:weekly skill and run its cleanup check in this folder. Scripts: ${sh(scripts)}.`

// Takes the check: whoever creates the lock file reads the asked time and, when it is overdue, writes the new one before
// anything slow runs, so a second session reaching the check at the same moment finds it taken. A lock a crash left
// behind goes stale after a minute.
function claim(file, key) {
  const lock = `${file}.lock`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs > 60000) fs.rmSync(lock, { force: true })
  } catch {}
  try { fs.closeSync(fs.openSync(lock, 'wx')) } catch { return false }
  try {
    const asked = readJson(file) || {}
    if (!overdue(asked[key])) return false
    writeJson(file, { ...asked, [key]: now() })
    return true
  } finally {
    fs.rmSync(lock, { force: true })
  }
}

function due(cwd) {
  const lcwHome = home()
  if (updatable() && claim(checksFile(lcwHome), 'update')) return updatePrompt()
  try { git(cwd, 'rev-parse', '--git-dir') } catch { return null } // not a repository: nothing to claim or record
  const key = repoKey(mainCheckout(cwd))
  if (readJson(noticesFile(lcwHome))?.[`cleanup:${key}`]) return null
  const box = recorded(cwd, lcwHome)
  if (box) {
    if (boxCurrent(cwd, lcwHome, box)) return null
    fs.rmSync(boxFile(cwd, lcwHome), { force: true }) // its items are gone or changed: the click would skip them
  }
  // the time is taken even when the survey finds nothing, so an idle session does not look again for a week
  if (!claim(repoChecksFile(lcwHome, key), 'cleanup')) return null
  return candidates(cwd, lcwHome).length ? cleanupPrompt() : null
}

if (process.argv[2] !== 'due') {
  console.error('usage: weekly.mjs due')
  process.exit(2)
}
try {
  const prompt = due(process.cwd())
  if (prompt) console.log(prompt)
} catch {
  // a failed check prints nothing and asks again next time
}
