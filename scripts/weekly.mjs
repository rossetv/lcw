#!/usr/bin/env node
// node scripts/weekly.mjs update | due
// Each prints the prompt of a check to ask, or nothing; the mod submits it into the person's idle session, and Claude has a
// Sonnet probe do the looking. Never a stack trace.
// update: run at the start of every session. Compares the installed LCW with its marketplace in code, and asks only when
// a newer version is out that the banner has no bullets for yet and no other session has just asked about.
// due: the weekly cleanup check of this repository. The asked time is recorded here, so a crash or a declined prompt does
// not ask again for a week.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { home, git, readJson, writeJson, mainCheckout } from './lib/store.mjs'
import { candidates, recorded, boxFile, boxCurrent } from './lib/cleanup.mjs'
import { updatable, marketVersion, newer } from './lib/update.mjs'
import { checksFile, repoChecksFile, noticesFile, repoKey, updateFile } from '../lib/key.mjs'

const WEEK = 7 * 24 * 3600 * 1000
// How long a version another session asked about is left to it: the prompt waits for that session to be idle, so one
// closed before it went out does not lose the version for good.
const ASKED_FOR = 3600 * 1000
// The marketplace refresh takes up to 120 s: a lock held longer was left by a crash.
const REFRESH_STALE = 180000
const scripts = path.dirname(fileURLToPath(import.meta.url))
// a path as one shell word, so a folder with a space or a quote in it still runs
const sh = (p) => `'${p.replace(/'/g, `'\\''`)}'`
const now = () => (process.env.LCW_NOW && Number.isFinite(Number(process.env.LCW_NOW)) ? Number(process.env.LCW_NOW) : Date.now())
const overdue = (at) => !Number.isFinite(at) || now() - at > WEEK

// The briefs live in the lcw:weekly skill; the line carries only what the skill cannot know, where the scripts are.
const updatePrompt = () => `LCW weekly check: load the lcw:weekly skill and run its update check. Scripts: ${sh(scripts)}.`
const cleanupPrompt = () => `LCW weekly check: load the lcw:weekly skill and run its cleanup check in this folder. Scripts: ${sh(scripts)}.`

// Runs fn holding the lock file, or returns false when another session holds it. A lock older than staleMs was left
// behind by a crash and is taken over.
function locked(lock, staleMs, fn) {
  fs.mkdirSync(path.dirname(lock), { recursive: true })
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) fs.rmSync(lock, { force: true })
  } catch {}
  try { fs.closeSync(fs.openSync(lock, 'wx')) } catch { return false }
  try {
    return fn()
  } finally {
    fs.rmSync(lock, { force: true })
  }
}

// Takes the check: under the lock, reads the asked time and, when it is overdue, writes the new one before anything slow
// runs, so a second session reaching the check at the same moment finds it taken.
function claim(file, key) {
  return locked(`${file}.lock`, 60000, () => {
    const asked = readJson(file) || {}
    if (!overdue(asked[key])) return false
    writeJson(file, { ...asked, [key]: now() })
    return true
  })
}

// A session that finds the lock held asks nothing: the holder is looking at the same moment.
function update() {
  const lcwHome = home()
  if (!updatable()) return null
  const file = checksFile(lcwHome)
  return locked(`${file}.update.lock`, REFRESH_STALE, () => {
    const found = marketVersion()
    if (!found || !newer(found.version, found.mine.version)) return null
    if (readJson(updateFile(lcwHome))?.available?.version === found.version) return null // the banner has its bullets
    const checks = readJson(file) || {}
    const asked = checks.updateAsked
    if (asked?.version === found.version && now() - asked.at < ASKED_FOR) return null
    writeJson(file, { ...checks, updateAsked: { version: found.version, at: now() } })
    return updatePrompt()
  }) || null
}

function due(cwd) {
  const lcwHome = home()
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

const cmd = process.argv[2]
if (cmd !== 'update' && cmd !== 'due') {
  console.error('usage: weekly.mjs update | due')
  process.exit(2)
}
try {
  const prompt = cmd === 'update' ? update() : due(process.cwd())
  if (prompt) console.log(prompt)
} catch {
  // a failed check prints nothing and asks again next time
}
