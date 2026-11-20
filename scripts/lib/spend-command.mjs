// The spend command: a local command line the person names that prints their real 7-day spend. This module runs
// it, keeps its setting and its last reading under the LCW home, and starts the background runner at most once per
// 5-minute window across every open session. Nothing here ever makes the status bar or a hook wait on the command.
import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readJson, writeJson } from './store.mjs'
import { spendCommandFile, spendReadingFile, spendTryFile } from '../../lib/key.mjs'

export const WINDOW_MS = 300000
const KEEP_BYTES = 64 * 1024
const DRAIN_MS = 500 // how long after the command exits its output may still be arriving
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']
const RUNNER = fileURLToPath(new URL('../spend-refresh.mjs', import.meta.url))

/** One non-negative amount, such as "1240", "$1,240.55" or "0", alone in the text; else null. */
export function parseFigure(text) {
  const m = /^\s*\$?(\d+|\d{1,3}(?:,\d{3})+)(\.\d+)?\s*$/.exec(String(text ?? ''))
  if (!m) return null
  const usd = Number(m[1].replace(/,/g, '') + (m[2] || ''))
  return Number.isFinite(usd) ? usd : null
}

/** Cuts to `max` whole characters, never through a surrogate pair. */
const cut = (text, max) => {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text
}

/**
 * What the command printed: its output (its error output when that is empty), safe for a terminal - ANSI escape
 * sequences dropped, other control characters made spaces - lines joined by a space, cut at 80 characters.
 */
const printed = (out, err) => {
  const clean = (s) => s
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u009b[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').trim()
  return cut(clean(out) || clean(err), 80)
}

const span = (ms) => (ms % 1000 ? `${ms} ms` : ms === 1000 ? '1 second' : `${ms / 1000} seconds`)

/** The clause said after "the command" when a finished run gave no usable figure. */
function failure(out, err, code, signal) {
  const ended = code ? `exited with code ${code}` : signal ? `was killed by ${signal}` : ''
  const said = printed(out, err)
  if (!said) return ended ? `printed nothing and ${ended}` : 'printed nothing'
  return parseFigure(said) == null || !ended ? `printed "${said}"` : `printed "${said}" and ${ended}`
}

/**
 * Runs the command line in a shell from the home folder, with no stdin, in a process group of its own. Settles when
 * the command exits (not when every holder of its output has let go), then kills whatever it left in that group, so
 * nothing piles up from one run to the next. A SIGINT, SIGTERM or SIGHUP to this process meanwhile kills that group
 * too. Resolves once with {ok: true, usd} or {ok: false, error}.
 */
export function runCommand(command, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    let done = false
    let timer = null
    let drain = null
    const finish = (result) => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(drain)
      unhook()
      resolve(result)
    }
    // A signal to this process while the command runs stops the command's whole group too, then ends this process as
    // it would have ended without the handler. The handlers are gone once the run settles.
    const handlers = SIGNALS.map((sig) => [sig, () => { killGroup(); unhook(); process.kill(process.pid, sig) }])
    const unhook = () => { for (const [sig, fn] of handlers) process.removeListener(sig, fn) }
    let child
    try {
      child = spawn(command, {
        shell: true, cwd: os.homedir(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      })
    } catch (e) {
      return finish({ ok: false, error: `could not start (${e.message})` })
    }
    // Every byte is read, so a chatty command never blocks on a full pipe, but only the first 64 KB are kept.
    const keep = (stream) => {
      const chunks = []
      let size = 0
      stream.on('data', (chunk) => {
        if (size >= KEEP_BYTES) return
        chunks.push(chunk)
        size += chunk.length
      })
      return () => Buffer.concat(chunks).subarray(0, KEEP_BYTES).toString('utf8')
    }
    for (const [sig, fn] of handlers) process.on(sig, fn)
    const out = keep(child.stdout)
    const err = keep(child.stderr)
    const killGroup = () => {
      try { process.kill(-child.pid, 'SIGKILL') } catch {} // ESRCH: nothing left in the group
      child.stdout.destroy()
      child.stderr.destroy()
    }
    timer = setTimeout(() => {
      killGroup()
      finish({ ok: false, error: `took longer than ${span(timeoutMs)}` })
    }, timeoutMs)
    const settle = (code, signal) => {
      if (done) return
      killGroup()
      const text = out()
      const usd = parseFigure(text)
      if (code === 0 && usd != null) return finish({ ok: true, usd })
      finish({ ok: false, error: failure(text, err(), code, signal) })
    }
    child.on('error', (e) => finish({ ok: false, error: `could not start (${e.message})` }))
    // After the exit, the output already written gets a moment to be read; a leftover process holding the pipes open
    // must not hold the result back.
    // The drain wait bounds the settling from here on, so the timeout no longer applies; and a run that has settled
    // (the timeout killed it) starts no timer.
    child.on('exit', (code, signal) => {
      if (done) return
      clearTimeout(timer)
      drain = setTimeout(() => settle(code, signal), DRAIN_MS)
    })
    child.on('close', settle)
  })
}

/** The command line the person set, or null. */
export function readSetting(home) {
  const s = readJson(spendCommandFile(home))
  if (!s || typeof s.command !== 'string' || !s.command.trim()) return null
  return { command: s.command, setAt: s.setAt }
}

export function writeSetting(home, command, now) {
  writeJson(spendCommandFile(home), { v: 1, command, setAt: now })
}

/** Turns the command off: its setting and its reading both go. */
export function clearSetting(home) {
  for (const file of [spendCommandFile(home), spendReadingFile(home)]) {
    try { fs.rmSync(file, { force: true }) } catch {}
  }
}

export function readReading(home) {
  const r = readJson(spendReadingFile(home))
  return r && typeof r === 'object' ? r : null
}

/**
 * Saves what one run of `command`, started at startedAt, gave. A failure keeps the last good figure. Writes nothing,
 * and returns false, when the setting is gone or names another command by now.
 */
export function recordResult(home, command, result, startedAt) {
  const setting = readSetting(home)
  if (!setting || setting.command !== command) return false
  const old = readReading(home)
  const r = old && old.command === command
    ? old
    : { usd: null, at: null, fails: 0, failingSince: null, lastError: null }
  const fails = Number(r.fails) || 0
  const next = result.ok
    ? { usd: result.usd, at: startedAt, fails: 0, failingSince: null, lastError: null }
    : {
        usd: r.usd ?? null, at: r.at ?? null, fails: fails + 1,
        failingSince: fails === 0 ? startedAt : r.failingSince ?? startedAt, lastError: result.error,
      }
  writeJson(spendReadingFile(home), { v: 1, command, ...next, triedAt: startedAt })
  return true
}

/** True for the one caller that creates this 5-minute window's lock. A lock is never broken: its name dates it. */
export function claimWindow(home, now) {
  try {
    const file = spendTryFile(home, Math.floor(now / WINDOW_MS))
    fs.mkdirSync(`${home}/cache`, { recursive: true })
    fs.closeSync(fs.openSync(file, 'wx'))
    return true
  } catch {
    return false
  }
}

/**
 * Called on every status-line tick: when a command is set and this tick wins the window, starts the runner through
 * its launcher and returns at once. Never throws.
 */
export function maybeRefresh(home, now) {
  try {
    if (!readSetting(home) || !claimWindow(home, now)) return
    const child = spawn(process.execPath, [RUNNER, '--launch'], {
      detached: true, stdio: 'ignore', env: { ...process.env, LCW_HOME: home },
    })
    child.on('error', () => {})
    child.unref()
  } catch {}
}
