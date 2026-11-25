// The status line command: reads Claude Code's JSON on stdin, prints the rows. Always prints, always exits 0.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { usageFile, activityFile, sessionFile, spendFile, spendDir, runPaths, contextFile } from '../lib/key.mjs'
import { home, readJson, readText, writeJson, holdReads, heldFiles } from './lib/store.mjs'
import { findRun } from './lib/runs.mjs'
import { settleGate, gateStands, sessionIds, sessionMark, DEFAULT_MARK, driverMark } from './lib/gate.mjs'
import { maybeRefresh, readSetting, WINDOW_MS } from './lib/spend-command.mjs'
import { readMoney, recordSpend, dropSpend, setBilling } from './lib/money.mjs'
import { settle, replied } from '../lib/billing.mjs'
import { mergeUsage } from '../lib/usage.mjs'
import { gitOf } from './lib/diff.mjs'
import { workOf } from '../lib/banner.mjs'
import { noteQuotaSession, readSessionQuota, sessionQuota, quotaUsage, sessionIdentity } from './lib/quota-session.mjs'
import { readQuotaState } from './lib/quota-command.mjs'
import { activeQuota, REFRESH_MS } from '../lib/quota.mjs'

const WEEK_MS = 168 * 3600 * 1000
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** How far through its week a limit is, from the time it resets. Not rounded: the countdown is worked out from it, and a whole percent is 1.68 hours. */
const elapsedPercent = (resetMs, now) => (resetMs ? Math.max(0, Math.min(100, ((now - (resetMs - WEEK_MS)) / WEEK_MS) * 100)) : null)

function windowSize(n) {
  if (!n) return null
  return n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`
}

/** The git figures the rows take from the session's folder: the main checkout and the branch, unless Claude Code gave them. */
const wanted = (inp) => [...(inp.worktree?.original_cwd ? [] : ['main']), ...(inp.worktree?.branch ? [] : ['branch'])]

/**
 * Claude Code's input -> the renderer's input, plus the usage figures. `also` names more git figures of the folder to
 * ask in the same go; git figures younger than `gitFresh` ms are taken as they are kept.
 */
export function mapInput(inp, now = Date.now(), markPercent = DEFAULT_MARK, also = [], gitFresh = undefined) {
  inp = inp && typeof inp === 'object' ? inp : {}
  const cwd = inp.cwd || inp.workspace?.current_dir || process.cwd()
  const seven = inp.rate_limits?.seven_day
  const iso = (s) => (num(s) ? new Date(s * 1000).toISOString() : null)
  const used = num(seven?.used_percentage)
  const resetMs = num(seven?.resets_at) ? seven.resets_at * 1000 : null
  const elapsed = elapsedPercent(resetMs, now)
  const want = [...wanted(inp), ...also]
  const git = want.length ? gitOf(cwd, home(), now, want, gitFresh) : {}
  const repoPath = inp.worktree?.original_cwd || git.main
  return {
    input: {
      model: inp.model?.display_name || inp.model?.id || null,
      effort: inp.effort?.level || null,
      contextPercent: num(inp.context_window?.used_percentage),
      contextWindow: windowSize(num(inp.context_window?.context_window_size)),
      repo: path.basename(repoPath) || null,
      branch: inp.worktree?.branch || git.branch,
      weekUsedPercent: used,
      weekElapsedPercent: elapsed,
      markPercent,
    },
    usage: used === null ? null : {
      at: now,
      sevenDay: { percentUsed: used, resetsAt: iso(seven.resets_at) },
      source: 'statusline',
    },
    cwd,
    git,
  }
}

/** Whether the run's mod is drawing it: its heartbeat is at most 15 seconds old at the moment drawn for. */
const modRunning = (f, now) => now - f.alive <= 15000

/** What a run adds to the mascot's mood: its questions, its pause, how its requirements, tasks and agents stand. */
function runFacts(f, now, share) {
  const { run } = f
  if (!run) return f.finishedAt ? { finishedAgo: now - f.finishedAt } : {}
  const count = (list, status) => (list ?? []).filter((x) => x.status === status).length
  const { tasks, requirements } = workOf(run.state)
  // The mod's count of quiet and stalled agents stands only while the mod is alive to keep it.
  const agents = modRunning(f, now) ? f.quiet : null
  return {
    asks: run.state.asks?.length ?? 0,
    // Paused by the person: it sleeps. Paused at the usage mark it cries instead, as any session at its mark does.
    paused: run.state.status === 'paused' && run.state.pausedReason === 'human',
    quiet: agents?.quiet ?? 0,
    stalled: agents?.stalled ?? 0,
    share,
    total: requirements.length,
    passing: count(requirements, 'pass'),
    failing: count(requirements, 'failing'),
    parked: count(tasks, 'parked'),
  }
}

/** "Now": LCW_NOW (epoch ms) when set, so a test or a review can stand at any hour. */
const clock = () => (Number.isFinite(Number(process.env.LCW_NOW)) && process.env.LCW_NOW ? Number(process.env.LCW_NOW) : Date.now())

/**
 * Settles the session's billing from this tick and keeps its spend. Billing and spend are keyed by the first
 * of the session's ids, the transcript's name, as the mod keys them. A weekly figure makes a subscription and
 * takes its spend back out; a reply (a cost above 0, or above the first reading after a resume) without one settles
 * an unclear session as pay-per-token.
 * The session file is written only when the kind changes.
 */
function settleBilling(inp, ids, now) {
  const id = ids[0]
  if (!id) return
  // the canonical session's billing is the one the readers take first
  const keys = [...new Set([sessionIdentity(id), ...ids])]
  const stored = keys.map((i) => readJson(sessionFile(home(), i))?.billing).find((b) => typeof b === 'string')
  const was = stored ?? 'unclear'
  const cost = num(inp.cost?.total_cost_usd)
  const weekly = inp.rate_limits?.seven_day
  const quotaSelected = !!readSessionQuota(ids, now, sessionMark(ids))
  const billing = settle(was, { weekly: weekly && typeof weekly === 'object' ? weekly : null, replied: replied(stored, readJson(spendFile(home(), id)), cost), quotaSelected })
  for (const alias of keys) {
    if (readJson(sessionFile(home(), alias))?.billing !== billing && billing !== 'unclear') setBilling(alias, billing)
    if (billing === 'subscription') dropSpend(alias)
  }
  if (billing !== 'subscription' && cost !== null) recordSpend(id, cost, now)
  return billing
}

function plainRow(input) {
  const bits = [input.model, input.repo, input.branch, input.weekUsedPercent != null ? `week ${input.weekUsedPercent}%` : null]
  return bits.filter(Boolean).join(' · ') || 'LCW'
}

// lcw checkpoint trusts the context size for ten minutes, so an unchanged record is stamped again after five.
const CONTEXT_STAMP_MS = 5 * 60000

function saveContext(file, tokens, window, now) {
  const saved = readJson(file)
  if (saved?.tokens === tokens && saved.window === window && now - saved.at >= 0 && now - saved.at < CONTEXT_STAMP_MS) return
  writeJson(file, { tokens, window, at: now })
}

/**
 * Reads what the rows show, each file once, and records what this tick has new: the billing, the spend, the
 * context size, the newest weekly figure and the run's gate. What it returns is all a draw needs.
 */
function readRecords(inp, now, gitFresh = undefined) {
  const h = home()
  let run = null
  const ids = sessionIds(inp)
  try { noteQuotaSession(ids) } catch {}
  let billing = 'unclear'
  try { billing = settleBilling(inp, ids, now) ?? billing } catch {}
  for (const id of ids.length ? ids : [undefined]) {
    try { run = findRun({ sessionId: id, cwd: inp?.cwd || inp?.workspace?.current_dir }) } catch {}
    if (run) break
  }
  // The mark is the session's own, run or no run; a run carries its driving session's.
  let mark = DEFAULT_MARK
  try { mark = sessionMark(ids) } catch {}
  const quota = readSessionQuota(ids, now, mark)
  if (run) readSessionQuota(run.state.driver, now, driverMark(run.state))
  // While the session's run has its worktree, that is where the work is: the bar names the run's branch and
  // counts the run's changes. Without one, it counts the checkout the session is in.
  // A sweep has no worktree of its own: its latest work is the newest wave's worktree that still exists.
  const exists = []
  const there = (p) => { const yes = fs.existsSync(p); exists.push([p, yes]); return yes }
  const latest = run && Array.isArray(run.state.sweep?.waves) ? [...run.state.sweep.waves].reverse().find((x) => x?.worktree && there(x.worktree)) : null
  const runTree = latest ? latest.worktree : run?.state.worktree && there(run.state.worktree) ? run.state.worktree : null
  const runBranch = latest ? latest.branch ?? run.state.branch : run?.state.branch
  const mapped = mapInput(inp, now, mark, runTree ? [] : ['diff'], gitFresh)
  const input = mapped.input
  // The context's size for lcw checkpoint, which cannot see it: the share Claude Code reports of the window it reports.
  const pct = num(inp.context_window?.used_percentage), win = num(inp.context_window?.context_window_size)
  if (pct !== null && win) for (const id of ids) try { saveContext(contextFile(h, id), Math.round(pct / 100 * win), win, now) } catch {}
  // Claude Code hands each session the figure it saw at its own last reply, so two bars can differ. The newest
  // one any session has reported is kept in usage.json, and that is what every bar and mascot shows: nothing
  // once the week it was read in is over.
  let transcriptAt = 0
  try { transcriptAt = fs.statSync(inp.transcript_path).mtimeMs } catch {}
  let usage = readJson(usageFile(h))
  if (mapped.usage && !quota) {
    try {
      // the figure is as old as this session's last word in its transcript: an idle session's older one must not stand over a newer
      const merged = mergeUsage(usage, transcriptAt ? { ...mapped.usage, seen: transcriptAt } : mapped.usage)
      // only a changed figure is written: every session's saved frames are drawn again when this file changes
      const figure = (u) => ({ ...u, at: 0, seen: 0 })
      if (!isDeepStrictEqual(figure(merged), figure(usage))) writeJson(usageFile(h), merged)
      usage = merged
    } catch {}
  }
  // On pay-per-token billing the 7-day spend is what the mark is held against, and that needs no weekly figure.
  // The run is gated by its driving session's view, which is this session's own when it is the driver.
  let money = null
  try { money = readMoney({ sessionId: ids, now, state: run?.state }) } catch {}
  if (run) {
    try {
      const driver = run.state.driver
      const driverMoney = !driver || ids.includes(driver) ? money : readMoney({ sessionId: driver, now, state: run.state })
      settleGate(run.paths, run.state, readJson(usageFile(h)), now, driverMoney)
    } catch {}
  }
  if (runTree && runBranch) input.branch = runBranch
  // The git figures are kept for 15 seconds, and frames drawn ahead show them no longer than that.
  const gits = [mapped.git]
  try {
    if (runTree) gits.push(gitOf(runTree, h, now, ['diff'], gitFresh))
    input.diff = gits.at(-1).diff
  } catch {}
  const f = {
    ids, run, mark, billing, merged: usage, input, transcriptAt, exists,
    gitAt: Math.min(...gits.map((g) => (num(g?.at) ?? Infinity))),
    stored: readJson(usageFile(h)),
    // The hooks write under the transcript's name and the mod under the session's id, which differ in a
    // resumed session: the latest record is the one that counts.
    activity: ids.map((id) => readJson(activityFile(h, id))).filter(Boolean).sort((a, b) => b.at - a.at)[0] ?? null,
  }
  if (run) {
    f.alive = Number(readText(run.paths.modAlive)?.trim()) || 0
    f.quiet = readJson(run.paths.quiet)
    f.gate = readJson(run.paths.gate)
    f.driverMark = driverMark(run.state)
  } else {
    // A finished run is no longer the session's run, but the session still points at it.
    for (const id of ids) {
      const dir = readJson(sessionFile(h, id))?.runDir
      const state = dir && readJson(runPaths(dir).state)
      if (state?.status === 'finished' && state.finishedAt) { f.finishedAt = state.finishedAt; break }
    }
  }
  return timed(f, now, { quota, money })
}

/**
 * Sets on f what follows from the clock at t: the outside quota's view, the money views and the usage figure
 * the mascot is drawn from. Reads only what readRecords read, and starts nothing. `known` holds views already
 * worked out at t.
 */
function timed(f, t, known = {}) {
  const { run, ids, input } = f
  const quota = 'quota' in known ? known.quota : sessionQuota(ids, t, f.mark)
  if (quota) input.quota = quota
  else delete input.quota
  f.driverQuota = run ? sessionQuota(run.state.driver, t, f.driverMark) : null
  f.usage = quota ? quotaUsage(quota, t) : f.merged
  let money = known.money ?? null
  if (!('money' in known)) try { money = readMoney({ sessionId: ids, now: t, state: run?.state }) } catch {}
  f.money = money
  if (money) input.money = money
  else delete input.money
  // Only a card that is drawn needs its money, and a failure in it costs the card's money alone.
  f.cardMoney = null
  if (run && !modRunning(f, t)) try { f.cardMoney = readMoney({ sessionId: run.state.driver ?? ids, now: t, state: run.state }) } catch {}
  return f
}

/** The rows for the moment now, from what readRecords returned; reads no file. */
async function draw(f, now, { width, theme }) {
  const { run, ids, input } = f
  const week = f.usage?.sevenDay
  const live = typeof week?.percentUsed === 'number' && !(week.resetsAt && Date.parse(week.resetsAt) <= now)
  input.weekUsedPercent = live ? week.percentUsed : null
  input.weekElapsedPercent = live ? elapsedPercent(Date.parse(week.resetsAt), now) : null
  const { renderStatusRows } = await import('../lib/status.mjs')
  const { toAnsi } = await import('../lib/paint.mjs')
  // The mascot stands left of the two status rows, which are drawn that much narrower. It is left out where
  // it would push them into the narrow layout, and a failure in it costs the mascot and nothing else.
  let pet = null
  try {
    const { mascotRows, moodOf, GAP } = await import('../lib/mascot.mjs')
    const { thresholds } = await import('../lib/theme.mjs')
    // Points of the week left before the session's usage mark; unknown once the week it was read in is over.
    const markLeft = live ? f.mark - week.percentUsed : null
    const share = run && !f.driverQuota ? (await import('../lib/card.mjs')).weekShare(run.state, f.stored?.sevenDay) : null
    const mood = moodOf({ now, transcriptAt: f.transcriptAt, activity: f.activity, contextPercent: input.contextPercent, markLeft, run: runFacts(f, now, share), money: f.money, hour: new Date(now).getHours() })
    const creature = mascotRows({ now, seed: ids[0], mood })
    const cells = creature[0].length + GAP
    if (width - cells >= thresholds.narrowBelowColumns) pet = { rows: creature, cells, gap: { t: ' '.repeat(GAP) } }
  } catch {}
  let rows = renderStatusRows(input, { width: width - (pet?.cells ?? 0), theme, now })
  if (pet) rows = rows.map((row, i) => [...(pet.rows[i] ?? []), pet.gap, ...row])
  const besidePet = pet ? rows.length : 0
  if (run && !modRunning(f, now)) {
    const { buildView, renderCard } = await import('../lib/card.mjs')
    const view = buildView({ state: { ...run.state, markPercent: f.driverMark }, agents: run.state.agents ?? [], usage: f.driverQuota ? quotaUsage(f.driverQuota, now) : f.stored, gate: f.gate, money: f.cardMoney, quota: f.driverQuota, now, ui: { expanded: {}, moreOpen: false } })
    rows = rows.concat(renderCard(view, { width, theme }))
  }
  let text = toAnsi(rows, theme, width)
  // Claude Code trims the spaces a row starts with unless an escape code comes first (seen in 2.1.327), and
  // the creature's rows often start with empty cells. So each of them opens with a colour reset.
  if (pet) text = text.split('\n').map((row, i) => (i < besidePet ? '\x1b[0m' + row : row)).join('\n')
  return text
}

/** The width the rows are drawn to and the theme, from what Claude Code sets in the command's environment. */
function surroundings(margin) {
  // COLUMNS is the full terminal width. Claude Code shows the first COLUMNS - 5 cells of each line, or
  // COLUMNS - 4 under the padding setup writes, which its shim passes as the margin.
  const cols = Number(process.env.COLUMNS)
  return { width: cols > 5 ? cols - margin : 121, theme: process.env.LCW_THEME === 'light' ? 'light' : 'dark' }
}

/** Prints one fresh draw for Claude Code's input: `input` when given, else what is on stdin. */
export async function main({ margin = 5, input } = {}) {
  let inp = {}
  try { inp = JSON.parse(input ?? fs.readFileSync(0, 'utf8')) } catch {}
  let f = null
  holdReads()
  try {
    const now = clock()
    f = readRecords(inp, now)
    process.stdout.write(await draw(f, now, surroundings(margin)) + '\n')
    // After the bar is out: on pay-per-token billing, at most one runner per window across every session.
    if (f.money) maybeRefresh(home(), now)
  } catch {
    process.stdout.write(plainRow(f?.input ?? {}) + '\n')
  } finally {
    holdReads(false)
  }
}

// Frames ahead: one draw saves the rows for this second and the 15 after it, which scripts/bin/statusline.sh
// prints with no Node while nothing the rows show has changed. What it saves, in <LCW home>/frames/<session id>/:
//   <strip>/<second>  the rows for that second, one file each, in a folder of this draw's own
//   <strip>/seen      the text of each watched file of up to 16 KB as the draw read it, for the launcher's check
//                     (scripts/bin/statusline.mjs); a larger one left out is drawn again whenever it reads as newer
//   last              the rows this draw printed, for when a later draw fails
//   key               what the player compares, written last and removed first, so it only ever names a whole strip;
//                     its time is the second before the draw read anything, and the launcher's check moves it on:
//     <COLUMNS> <LCW_THEME> <zone>      as the player sees them, ${COLUMNS:-0} ${LCW_THEME:-dark} and date's %z
//     <heartbeat file> <seconds>         the heartbeat the frames were drawn with, in whole seconds; empty with no run
//     <strip>
//     D                                  a line that is none of the others
//     what must not change, then D:  /path (there, and not newer than key)  !/path (not there)  %/path (there)  +pid (running)
//     the input cut at the values that may change, each piece followed by D
const FRAMES = 16
// A draw ahead asks git again once its figures are this old, so that no strip is cut to under 5 seconds by them.
const GIT_AHEAD_MS = 10000
const SESSION = /^[A-Za-z0-9_-]{1,128}$/
// A real input is about 2 KB; the player stops reading one past this, and the time its check takes grows with the
// square of the input's size.
const INPUT_BYTES = 32 * 1024
const SEEN_BYTES = 16 * 1024
// The fields of the input that change while the rows stay the same: how long the session has run, its token
// and prompt-cache counts, the lines it changed (the rows count them with git), the five-hour limit, and on a
// subscription its cost. Everything else is compared. The first ones always hold a plain number, and an input where
// one does not gets no frames; the others are passed over only when they do. A name is a field's name, or the text
// that stands before the value where the name alone would also find a figure the rows show.
const IGNORED = ['total_duration_ms', 'total_api_duration_ms', 'total_input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
const ALSO_IGNORED = ['total_output_tokens', 'input_tokens', 'output_tokens', 'total_lines_added', 'total_lines_removed', 'warm',
  'expires_at', 'requests', 'misses', 'expected_rebuilds', 'hit_ratio', 'cache_write_tokens', 'miss_recache_tokens', 'last_miss_at',
  'recache_tokens_if_cold', '"five_hour":{"used_percentage":']
const VALUE = /^[0-9A-Za-z.+-]+/

/** The session id as the player finds it, the text after the first "session_id":", when it is safe for a folder's name. */
function sessionKey(text, inp) {
  const at = text.indexOf('"session_id":"')
  if (at < 0) return null
  const id = text.slice(at + 14, text.indexOf('"', at + 14))
  return SESSION.test(id) && id === inp?.session_id ? id : null
}

/** date's %z for the time t on this machine's clock: +0100, -0330. */
function zoneOf(t) {
  const m = -new Date(t).getTimezoneOffset(), a = Math.abs(m)
  return `${m < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`
}

/** The text split around the values of the ignored fields, or null when the player's fold would not give it back. */
function piecesOf(text, strict, lenient) {
  const spans = []
  for (const name of [...strict, ...lenient]) {
    const key = name.startsWith('"') ? name : `"${name}":`
    const at = text.indexOf(key)
    if (at < 0) continue
    const value = VALUE.exec(text.slice(at + key.length, at + key.length + 64))?.[0]
    if (!value && strict.includes(name)) return null
    if (value) spans.push([at + key.length, at + key.length + value.length])
  }
  spans.sort((x, y) => x[0] - y[0])
  const pieces = []
  let from = 0
  for (const [a, b] of spans) {
    if (a < from) return null
    pieces.push(text.slice(from, a))
    from = b
  }
  pieces.push(text.slice(from))
  // The player's fold: each later piece is found at its first place, and what lies before it must be all so far plus one value.
  let pre = pieces[0]
  for (const p of pieces.slice(1)) {
    const at = text.indexOf(p)
    const head = text.slice(0, Math.max(at, 0))
    if (at < 0 || !head.startsWith(pre) || !new RegExp(`^${VALUE.source}$`).test(head.slice(pre.length))) return null
    pre = head + p
  }
  return pre === text ? pieces : null
}

/** What must not change for the frames to stand, as the key's lines; null when one cannot be told to the player. */
function watchedOf(f, inp, paid) {
  const h = home()
  const lines = new Set()
  for (const [file, there] of heldFiles()) {
    // the git figures may be 15 seconds old, a draw's own context record is not shown, and the heartbeat is judged by its number
    if (file.startsWith(`${h}/cache/`) || file.startsWith(`${h}/frames/`) || file === f.run?.paths.modAlive) continue
    lines.add(there ? file : `!${file}`)
    // a session's live process decides which ids and which run are the session's
    const pid = there && file.startsWith(`${h}/sessions/`) ? readJson(file)?.claudePid : null
    if (Number.isInteger(pid) && pid > 1) {
      try { process.kill(pid, 0); lines.add(`+${pid}`) } catch (e) { if (e.code === 'EPERM') return null }
    }
  }
  for (const [dir, there] of f.exists) lines.add(there ? `%${dir}` : `!${dir}`)
  // a new spend record of any session moves the week's spend
  if (paid) lines.add(fs.existsSync(spendDir(h)) ? spendDir(h) : `!${spendDir(h)}`)
  // a question is over once the conversation is written again
  const act = f.activity
  if (act?.state === 'needs' && !(f.transcriptAt > act.at + 3000) && typeof inp.transcript_path === 'string') lines.add(f.transcriptAt ? inp.transcript_path : `!${inp.transcript_path}`)
  return [...lines]
}

const WATCHED = /^([!%]?\/[^\n]*|\+[1-9]\d*)$/

/**
 * The key's text from its first lines (`head`), the watched lines and the input; null when the input holds a NUL
 * or a CR, a watched line is not one the player reads, or the player's fold would not give the input back.
 */
export function keyText(text, { head, watched, strict = [], lenient = [] }) {
  if (/[\0\r]/.test(text) || head.some((l) => l.includes('\n')) || !watched.every((l) => WATCHED.test(l))) return null
  const pieces = piecesOf(text, strict, lenient)
  if (!pieces) return null
  const body = pieces.flatMap((p) => p.split('\n'))
  let d = '@@'
  while (head.includes(d) || watched.includes(d) || body.includes(d)) d += '@'
  return [...head, d, ...watched, d, ...pieces.flatMap((p) => [...p.split('\n'), d])].join('\n') + '\n'
}

/**
 * The key for this draw and the text of each watched file of up to SEEN_BYTES that every read and write of this draw
 * gave alike, or null when no frame can be saved safely for this input.
 */
function keyOf(text, f, inp, { zone, tag, paid }) {
  const { COLUMNS = '', LCW_THEME = '' } = process.env
  if (/\s/.test(COLUMNS + LCW_THEME) || Buffer.byteLength(text) > INPUT_BYTES) return null
  const watched = watchedOf(f, inp, paid)
  const beat = f.run ? `${f.run.paths.modAlive} ${Math.floor(f.alive / 1000)}` : ''
  if (!watched || (beat && !beat.startsWith('/'))) return null
  const strict = f.billing === 'subscription' ? [...IGNORED, 'total_cost_usd'] : IGNORED
  const key = keyText(text, { head: [`${COLUMNS || '0'} ${LCW_THEME || 'dark'} ${zone}`, beat, tag], watched, strict, lenient: ALSO_IGNORED })
  const kept = heldFiles().filter(([file, there, t]) => there && typeof t === 'string' && Buffer.byteLength(t) <= SEEN_BYTES && watched.includes(file))
  return key && { key, seen: Object.fromEntries(kept.map(([file, , t]) => [file, t])) }
}

/**
 * The moment each second's frame is drawn at: the draw's own time stepped by whole seconds, and a second the
 * draw has already passed at its last moment.
 */
const frameTime = (second, now) => (second < Math.floor(now / 1000) ? second * 1000 + 999 : second * 1000 + (now % 1000))

/** The first moment from which what the records give could differ from what was read: the strip ends before it. */
function deadline(f, now) {
  let until = f.gitAt + 15001
  try {
    const q = readQuotaState(home())
    if ((f.input.quota || f.driverQuota) && activeQuota(q) && Number.isFinite(q.lastAttemptAt)) until = Math.min(until, q.lastAttemptAt + REFRESH_MS)
  } catch {}
  if (f.money && readSetting(home())) until = Math.min(until, (Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS)
  return until
}

/** Whether the run's gate would stand as it is at t, or the run has none. */
function gateHoldsAt(f, t) {
  if (!f.run) return true
  try {
    const driver = f.run.state.driver
    const money = !driver || f.ids.includes(driver) ? f.money : readMoney({ sessionId: driver, now: t, state: f.run.state })
    return gateStands(f.run.paths, f.run.state, readJson(usageFile(home())), t, money)
  } catch { return false }
}

/** Writes the strip, then `last`, then the key, each in place by a rename; clears strips older than any that can still be played. */
function save(dir, { tag, frames, out, key, seen, keyTime }) {
  const strip = `${dir}/${tag}`
  fs.mkdirSync(strip, { recursive: true })
  if (key) {
    for (const [second, rows] of frames) fs.writeFileSync(`${strip}/${second}`, rows + '\n')
    fs.writeFileSync(`${strip}/seen`, JSON.stringify(seen))
  }
  fs.writeFileSync(`${strip}/last`, out)
  fs.renameSync(`${strip}/last`, `${dir}/last`)
  if (key) {
    fs.writeFileSync(`${strip}/key`, key)
    fs.utimesSync(`${strip}/key`, keyTime, keyTime)
    fs.renameSync(`${strip}/key`, `${dir}/key`)
  }
  for (const name of fs.readdirSync(dir)) {
    if (name === tag || name === 'key' || name === 'last') continue
    try { if (Date.now() - fs.statSync(`${dir}/${name}`).mtimeMs > 20000) fs.rmSync(`${dir}/${name}`, { recursive: true, force: true }) } catch {}
  }
}

/** Which file is at a path, and how it stands: its inode, size and time; null when there is none. */
const stampOf = (file) => { try { const st = fs.statSync(file, { bigint: true }); return `${st.ino}:${st.size}:${st.mtimeNs}` } catch { return null } }

/**
 * Draws the rows for the second `at` names (date's %s%z, as the player read it) and for the 15 after it, saves
 * them for the player, and returns the rows for that second. Throws when the rows cannot be drawn. A caller that has
 * read some records already gives them as `read`, [path, text, stamp] with the stamp (stampOf) from just before the
 * read, and as `keyTime` the key's time it took before. A record written since is read again, so that a record this
 * draw writes is never worked out from a text older than the time this code took to load.
 */
export async function ahead(text, { at, margin = 4, read = [], keyTime = null } = {}) {
  // A record written from the second before this read on reads as newer than the key, whatever the shell compares.
  const own = Math.floor(Date.now() / 1000) - 1
  keyTime = Number.isFinite(keyTime) ? Math.min(keyTime, own) : own
  text = String(text ?? '')
  let inp = {}
  try { inp = JSON.parse(text) } catch {}
  const id = sessionKey(text, inp)
  const dir = id && `${home()}/frames/${id}`
  if (dir) try { fs.rmSync(`${dir}/key`, { force: true }) } catch {}
  holdReads(true, (Array.isArray(read) ? read : []).filter((r) => Array.isArray(r) && typeof r[0] === 'string' && r[2] !== undefined && stampOf(r[0]) === r[2]).map(([file, text]) => [file, text]))
  try {
    const now = clock()
    const told = /^(\d+)([+-]\d{4})$/.exec(String(at ?? ''))
    const first = told ? Number(told[1]) : Math.floor(now / 1000)
    const f = readRecords(inp, now, GIT_AHEAD_MS)
    const look = surroundings(margin)
    const zone = zoneOf(frameTime(first, now))
    const until = deadline(f, now)
    const frames = []
    let paid = false
    for (let second = first; second < first + FRAMES; second++) {
      const t = frameTime(second, now)
      if (second > first && (t >= until || zoneOf(t) !== zone || !gateHoldsAt(f, t))) break
      const g = timed({ ...f, input: { ...f.input } }, t)
      paid ||= !!(g.money || g.cardMoney)
      frames.push([second, await draw(g, t, look)])
    }
    const out = frames[0][1] + '\n'
    if (f.money) maybeRefresh(home(), now)
    if (dir) {
      try {
        const tag = `${process.pid}-${randomBytes(4).toString('hex')}`
        save(dir, { tag, frames, out, ...keyOf(text, f, inp, { zone, tag, paid }), keyTime })
      } catch {}
    }
    return out
  } finally {
    holdReads(false)
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(() => process.stdout.write('LCW\n')).finally(() => process.exit(0))
}
