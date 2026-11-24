// The status line command: reads Claude Code's JSON on stdin, prints the rows. Always prints, always exits 0.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { usageFile, activityFile, sessionFile, spendFile, runPaths, contextFile } from '../lib/key.mjs'
import { home, readJson, readText, writeJson, holdReads } from './lib/store.mjs'
import { findRun } from './lib/runs.mjs'
import { settleGate, sessionIds, sessionMark, DEFAULT_MARK, driverMark } from './lib/gate.mjs'
import { maybeRefresh } from './lib/spend-command.mjs'
import { readMoney, recordSpend, dropSpend, setBilling } from './lib/money.mjs'
import { settle, replied } from '../lib/billing.mjs'
import { mergeUsage } from '../lib/usage.mjs'
import { diffOf, gitOf } from './lib/diff.mjs'
import { workOf } from '../lib/banner.mjs'
import { noteQuotaSession, readSessionQuota, quotaUsage, sessionIdentity } from './lib/quota-session.mjs'

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

/** Claude Code's input -> the renderer's input, plus the usage figures. `also` names more git figures of the folder to ask in the same go. */
export function mapInput(inp, now = Date.now(), markPercent = DEFAULT_MARK, also = []) {
  inp = inp && typeof inp === 'object' ? inp : {}
  const cwd = inp.cwd || inp.workspace?.current_dir || process.cwd()
  const seven = inp.rate_limits?.seven_day
  const iso = (s) => (num(s) ? new Date(s * 1000).toISOString() : null)
  const used = num(seven?.used_percentage)
  const resetMs = num(seven?.resets_at) ? seven.resets_at * 1000 : null
  const elapsed = elapsedPercent(resetMs, now)
  const want = [...wanted(inp), ...also]
  const git = want.length ? gitOf(cwd, home(), now, want) : {}
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

/** What a run adds to the mascot's mood: its questions, its pause, how its requirements, tasks and agents stand. */
function runFacts(f, now, share) {
  const { run } = f
  if (!run) return f.finishedAt ? { finishedAgo: now - f.finishedAt } : {}
  const count = (list, status) => (list ?? []).filter((x) => x.status === status).length
  const { tasks, requirements } = workOf(run.state)
  // The mod's count of quiet and stalled agents stands only while the mod is alive to keep it.
  const agents = now - f.alive <= 15000 ? f.quiet : null
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
function readRecords(inp, now) {
  const h = home()
  let run = null
  const ids = sessionIds(inp)
  try { noteQuotaSession(ids) } catch {}
  try { settleBilling(inp, ids, now) } catch {}
  for (const id of ids.length ? ids : [undefined]) {
    try { run = findRun({ sessionId: id, cwd: inp?.cwd || inp?.workspace?.current_dir }) } catch {}
    if (run) break
  }
  // The mark is the session's own, run or no run; a run carries its driving session's.
  let mark = DEFAULT_MARK
  try { mark = sessionMark(ids) } catch {}
  const quota = readSessionQuota(ids, now, mark)
  const driverQuota = run ? readSessionQuota(run.state.driver, now, driverMark(run.state)) : null
  // While the session's run has its worktree, that is where the work is: the bar names the run's branch and
  // counts the run's changes. Without one, it counts the checkout the session is in.
  // A sweep has no worktree of its own: its latest work is the newest wave's worktree that still exists.
  const latest = run && Array.isArray(run.state.sweep?.waves) ? [...run.state.sweep.waves].reverse().find((x) => x?.worktree && fs.existsSync(x.worktree)) : null
  const runTree = latest ? latest.worktree : run?.state.worktree && fs.existsSync(run.state.worktree) ? run.state.worktree : null
  const runBranch = latest ? latest.branch ?? run.state.branch : run?.state.branch
  const mapped = mapInput(inp, now, mark, runTree ? [] : ['diff'])
  const input = mapped.input
  if (quota) input.quota = quota
  // The context's size for lcw checkpoint, which cannot see it: the share Claude Code reports of the window it reports.
  const pct = num(inp.context_window?.used_percentage), win = num(inp.context_window?.context_window_size)
  if (pct !== null && win) for (const id of ids) try { saveContext(contextFile(h, id), Math.round(pct / 100 * win), win, now) } catch {}
  // Claude Code hands each session the figure it saw at its own last reply, so two bars can differ. The newest
  // one any session has reported is kept in usage.json, and that is what every bar and mascot shows: nothing
  // once the week it was read in is over.
  let usage = readJson(usageFile(h))
  if (mapped.usage && !quota) {
    try {
      const merged = mergeUsage(usage, mapped.usage)
      if (!isDeepStrictEqual({ ...merged, at: 0 }, { ...usage, at: 0 })) writeJson(usageFile(h), merged)
      usage = merged
    } catch {}
  }
  // On pay-per-token billing the 7-day spend is what the mark is held against, and that needs no weekly figure.
  // The run is gated by its driving session's view, which is this session's own when it is the driver.
  if (quota) usage = quotaUsage(quota, now)
  let money = null
  try { money = readMoney({ sessionId: ids, now, state: run?.state }) } catch {}
  if (money) input.money = money
  if (run) {
    try {
      const driver = run.state.driver
      const driverMoney = !driver || ids.includes(driver) ? money : readMoney({ sessionId: driver, now, state: run.state })
      settleGate(run.paths, run.state, readJson(usageFile(h)), now, driverMoney)
    } catch {}
  }
  if (runTree && runBranch) input.branch = runBranch
  try { input.diff = runTree ? diffOf(runTree, h, now) : mapped.git.diff } catch {}
  let transcriptAt = 0
  try { transcriptAt = fs.statSync(inp.transcript_path).mtimeMs } catch {}
  const f = {
    ids, run, mark, money, usage, driverQuota, input, transcriptAt,
    stored: readJson(usageFile(h)),
    // The hooks write under the transcript's name and the mod under the session's id, which differ in a
    // resumed session: the latest record is the one that counts.
    activity: ids.map((id) => readJson(activityFile(h, id))).filter(Boolean).sort((a, b) => b.at - a.at)[0] ?? null,
  }
  if (run) {
    f.alive = Number(readText(run.paths.modAlive)?.trim()) || 0
    f.quiet = readJson(run.paths.quiet)
    f.gate = readJson(run.paths.gate)
    f.cardMoney = readMoney({ sessionId: run.state.driver ?? ids, now, state: run.state })
    f.driverMark = driverMark(run.state)
  } else {
    // A finished run is no longer the session's run, but the session still points at it.
    for (const id of ids) {
      const dir = readJson(sessionFile(h, id))?.runDir
      const state = dir && readJson(runPaths(dir).state)
      if (state?.status === 'finished' && state.finishedAt) { f.finishedAt = state.finishedAt; break }
    }
  }
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
  if (run && now - f.alive > 15000) {
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

export async function main({ margin = 5 } = {}) {
  let inp = {}
  try { inp = JSON.parse(fs.readFileSync(0, 'utf8')) } catch {}
  let f = null
  holdReads()
  try {
    const now = clock()
    f = readRecords(inp, now)
    // COLUMNS is the full terminal width. Claude Code shows the first COLUMNS - 5 cells of each line, or
    // COLUMNS - 4 under the padding setup writes, which its shim passes as the margin.
    const cols = Number(process.env.COLUMNS)
    const width = cols > 5 ? cols - margin : 121
    const theme = process.env.LCW_THEME === 'light' ? 'light' : 'dark'
    process.stdout.write(await draw(f, now, { width, theme }) + '\n')
    // After the bar is out: on pay-per-token billing, at most one runner per window across every session.
    if (f.money) maybeRefresh(home(), now)
  } catch {
    process.stdout.write(plainRow(f?.input ?? {}) + '\n')
  } finally {
    holdReads(false)
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(() => process.stdout.write('LCW\n')).finally(() => process.exit(0))
}
