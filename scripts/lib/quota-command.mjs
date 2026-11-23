import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readJson } from './store.mjs'
import { quotaFile } from '../../lib/key.mjs'
import { QUOTA_SOURCE_ID, REFRESH_MS, MAX_AGE_MS, CLAIM_MS, activeQuota, normalizeEndpoint, parseQuotaResult, validateQuotaResult } from '../../lib/quota.mjs'

const RUNNER = fileURLToPath(new URL('../quota-refresh.mjs', import.meta.url))
const WATCHDOG = fileURLToPath(new URL('../quota-watchdog.mjs', import.meta.url))
const KEEP_BYTES = 64 * 1024
const failure = (code) => ({ v: 1, status: 'unavailable', code })
const clock = () => process.env.LCW_NOW !== undefined && process.env.LCW_NOW !== '' && Number.isFinite(Number(process.env.LCW_NOW)) ? Number(process.env.LCW_NOW) : Date.now()

export const readQuotaState = (home) => readJson(quotaFile(home))

// Shared lock directories are populated before acquisition, so an empty one has no owner.
function reap(lock) {
  try {
    const names = fs.readdirSync(lock)
    if (!names.length) { fs.rmdirSync(lock); return }
    if (names.length !== 1 || !/^\d+-[a-f0-9-]+$/.test(names[0])) return
    const pid = Number(names[0].split('-')[0])
    try { process.kill(pid, 0); return } catch (e) { if (e.code !== 'ESRCH') return }
    fs.unlinkSync(`${lock}/${names[0]}`)
    fs.rmdirSync(lock)
  } catch {}
}

function reapAbandoned(home, file) {
  let entries
  try { entries = fs.readdirSync(home, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const target = `${home}/${entry.name}`
    const prepared = entry.isDirectory() && target.startsWith(`${file}.lock.`)
    const temp = entry.isFile() && target.startsWith(`${file}.`)
    if (!prepared && !temp) continue
    const prefix = prepared ? `${file}.lock.` : `${file}.`
    const marker = target.slice(prefix.length)
    const match = prepared
      ? /^([1-9]\d*)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.exec(marker)
      : /^([1-9]\d*)\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.exec(marker)
    if (!match || !Number.isSafeInteger(Number(match[1]))) continue
    try {
      try { process.kill(Number(match[1]), 0); continue } catch (e) { if (e.code !== 'ESRCH') continue }
      if (temp) { fs.unlinkSync(target); continue }
      const names = fs.readdirSync(target)
      if (names.length === 1 && names[0] === marker && fs.lstatSync(`${target}/${marker}`).isFile()) fs.unlinkSync(`${target}/${marker}`)
      else if (names.length) continue
      fs.rmdirSync(target)
    } catch {}
  }
}

async function commit(home, fn) {
  const file = quotaFile(home)
  const lock = `${file}.lock`
  const marker = `${process.pid}-${randomUUID()}`
  const prepared = `${lock}.${marker}`
  const until = Date.now() + 2000
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 })
    reapAbandoned(home, file)
    fs.mkdirSync(prepared, { mode: 0o700 })
    try {
      fs.writeFileSync(`${prepared}/${marker}`, '', { flag: 'wx', mode: 0o600 })
      for (;;) {
        try { fs.renameSync(prepared, lock); break } catch (e) {
          if (!['EEXIST', 'ENOTEMPTY'].includes(e.code) || Date.now() >= until) throw new Error('quota state unavailable')
          reap(lock)
          await new Promise((r) => setTimeout(r, 10))
        }
      }
      try {
        const state = readQuotaState(home)
        const { next, value } = fn(state)
        if (next === null) fs.rmSync(file, { force: true })
        else if (next !== undefined) {
          const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
          try {
            fs.writeFileSync(tmp, JSON.stringify(next) + '\n', { mode: 0o600, flag: 'wx' })
            fs.renameSync(tmp, file)
          } finally { try { fs.unlinkSync(tmp) } catch {} }
        }
        return value
      } finally { fs.renameSync(lock, prepared) }
    } finally { fs.rmSync(prepared, { recursive: true, force: true }) }
  } catch { throw new Error('quota state unavailable') }
}

export function runQuotaCommand(command, { timeoutMs = 30000, now = clock } = {}) {
  // Descendant termination needs POSIX process groups, not an optional external executable.
  if (process.platform === 'win32' || typeof command !== 'string' || !command.trim()) return Promise.resolve(failure('command-failed'))
  return new Promise((resolve) => {
    let child, done = false
    const finish = (result) => {
      if (done) return
      done = true
      try { if (child?.connected) child.disconnect() } catch {}
      resolve(result)
    }
    try {
      child = spawn(process.execPath, [WATCHDOG], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: process.env })
      child.on('error', () => finish(failure('command-failed')))
      child.on('close', () => finish(failure('command-failed')))
      child.on('message', (result) => {
        try { finish(validateQuotaResult(result, now())) } catch { finish(failure('command-failed')) }
      })
      child.send({ command, timeoutMs, validationNow: now() }, (error) => { if (error) finish(failure('command-failed')) })
    } catch { finish(failure('command-failed')) }
  })
}

export function executeQuotaCommand(command, { timeoutMs = 30000, now = clock } = {}) {
  if (typeof command !== 'string' || !command.trim()) return Promise.resolve(failure('command-failed'))
  return new Promise((resolve) => {
    let child, done = false, timer, drain
    let size = 0, errSize = 0
    const chunks = []
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
    const handlers = signals.map((signal) => [signal, () => { killGroup(); unhook(); process.kill(process.pid, signal) }])
    const unhook = () => { for (const [s, h] of handlers) process.removeListener(s, h) }
    const killGroup = () => {
      if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
      child?.stdout?.destroy()
      child?.stderr?.destroy()
    }
    const finish = (result) => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(drain)
      killGroup()
      unhook()
      resolve(result)
    }
    for (const [s, h] of handlers) process.on(s, h)
    timer = setTimeout(() => finish(failure('timeout')), Number.isFinite(timeoutMs) ? Math.max(1, Math.min(30000, timeoutMs)) : 30000)
    try {
      child = spawn(command, { shell: true, cwd: os.homedir(), env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch { return finish(failure('command-failed')) }
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > KEEP_BYTES) return finish(failure('invalid-response'))
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      errSize += chunk.length
      if (errSize > KEEP_BYTES) finish(failure('invalid-response'))
    })
    const settle = (code) => {
      if (done) return
      finish(code === 0 ? parseQuotaResult(Buffer.concat(chunks).toString('utf8'), now()) : failure('command-failed'))
    }
    child.on('error', () => finish(failure('command-failed')))
    child.on('exit', (code) => {
      if (!done) drain = setTimeout(() => settle(code), 50)
    })
    child.on('close', settle)
  })
}

/** Validates before replacing; concurrent off or newer setup wins over this pending setup. */
export async function configureQuota(home, endpoint, command, { now = clock, run = runQuotaCommand } = {}) {
  endpoint = normalizeEndpoint(endpoint)
  if (!endpoint) return { ok: false, code: 'invalid-endpoint' }
  if (typeof command !== 'string' || !command.trim() || command.length > 65536 || command.includes('\0')) return { ok: false, code: 'invalid-command' }
  const requestId = randomUUID()
  try {
    const startedAt = now()
    const expected = await commit(home, (state) => ({ next: { ...state, setupRequestId: requestId }, value: state?.revision ?? null }))
    let result
    try { result = validateQuotaResult(await run(command, { now }), now()) } catch { result = failure('command-failed') }
    return await commit(home, (state) => {
      if (state?.setupRequestId !== requestId || (state.revision ?? null) !== expected) return { value: { ok: false, code: 'superseded' } }
      const { setupRequestId, ...old } = state
      if (result.status !== 'ok') return { next: Object.keys(old).length ? old : null, value: { ok: false, code: result.code } }
      const revision = randomUUID()
      const completedAt = now()
      result = validateQuotaResult(result, completedAt)
      if (result.status !== 'ok') return { next: Object.keys(old).length ? old : null, value: { ok: false, code: result.code } }
      return {
        next: { v: 1, enabled: true, sourceId: QUOTA_SOURCE_ID, revision, endpoint, command, setAt: completedAt, lastAttemptAt: startedAt, cache: { revision, requestId, attemptedAt: startedAt, completedAt, result } },
        value: { ok: true, revision, result },
      }
    })
  } catch { return { ok: false, code: 'config-unavailable' } }
}

export async function disableQuota(home) {
  try {
    return await commit(home, () => ({ next: { v: 1, enabled: false, sourceId: QUOTA_SOURCE_ID, revision: randomUUID() }, value: { ok: true } }))
  } catch { return { ok: false, code: 'config-unavailable' } }
}

/** The claim and its request ID are committed before a runner can be launched. */
export async function claimRefresh(home, now = clock()) {
  if (!Number.isFinite(now)) return null
  try {
    return await commit(home, (state) => {
      if (!activeQuota(state) || (Number.isFinite(state.lastAttemptAt) && now - state.lastAttemptAt < REFRESH_MS) || (state.claim?.revision === state.revision && now - state.claim.startedAt < CLAIM_MS)) return { value: null }
      const claim = { revision: state.revision, requestId: randomUUID(), startedAt: now }
      return { next: { ...state, lastAttemptAt: now, claim }, value: { ...claim, command: state.command } }
    })
  } catch { return null }
}

export async function recordQuotaResult(home, claim, result, now = clock()) {
  try {
    return await commit(home, (state) => {
      if (!activeQuota(state) || state.revision !== claim?.revision || state.claim?.requestId !== claim?.requestId || state.claim.startedAt !== claim.startedAt) return { value: false }
      result = validateQuotaResult(result, now)
      const old = state.cache?.revision === state.revision ? state.cache : null
      const previous = old?.result?.status === 'ok' ? { result: old.result, observedAt: old.attemptedAt } : old?.lastGood
      const good = previous ? { result: validateQuotaResult(previous.result, now), observedAt: previous.observedAt } : null
      const keep = result.status !== 'ok' && result.code !== 'account-changed' && good && Number.isFinite(good.observedAt) && now >= good.observedAt && now - good.observedAt < MAX_AGE_MS && good.result.status === 'ok' && (!result.accountKey || result.accountKey === good.result.accountKey)
      const { claim: _, ...rest } = state
      return {
        next: { ...rest, cache: { revision: claim.revision, requestId: claim.requestId, attemptedAt: claim.startedAt, completedAt: now, result, ...(keep ? { lastGood: good } : {}) } }, value: true,
      }
    })
  } catch { return false }
}

export async function refreshQuota(home, { now = clock, run = runQuotaCommand, claim = null } = {}) {
  claim ??= await claimRefresh(home, now())
  if (!claim) return false
  const state = readQuotaState(home)
  if (!activeQuota(state) || state.revision !== claim.revision || state.claim?.requestId !== claim.requestId) return false
  let result
  try { result = await run(state.command, { now }) } catch { result = failure('command-failed') }
  return recordQuotaResult(home, claim, result, now())
}

/** File/claim work is in the detached runner; UI callers do not wait for it. */
export function maybeRefreshQuota(home, now = clock()) {
  try {
    const state = readQuotaState(home)
    if (!activeQuota(state) || (Number.isFinite(state.lastAttemptAt) && now - state.lastAttemptAt < REFRESH_MS)) return
    const child = spawn(process.execPath, [RUNNER, '--launch'], { detached: true, stdio: 'ignore', env: { ...process.env, LCW_HOME: home } })
    child.on('error', () => {})
    child.unref()
  } catch {}
}
