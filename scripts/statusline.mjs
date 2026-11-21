// The status line command: reads Claude Code's JSON on stdin, prints the rows. Always prints, always exits 0.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { usageFile, activityFile, sessionFile, runPaths, contextFile } from '../lib/key.mjs'
import { home, readJson, writeJson, git, mainCheckout } from './lib/store.mjs'
import { findRun } from './lib/runs.mjs'
import { applyGate, sessionIds, sessionMark, DEFAULT_MARK } from './lib/gate.mjs'
import { maybeRefresh } from './lib/spend-command.mjs'
import { readMoney, recordSpend, dropSpend, setBilling } from './lib/money.mjs'
import { settle } from '../lib/billing.mjs'
import { mergeUsage } from '../lib/usage.mjs'
import { diffOf } from './lib/diff.mjs'
import { workOf } from '../lib/banner.mjs'

const WEEK_MS = 168 * 3600 * 1000
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** How far through its week a limit is, from the time it resets. Not rounded: the countdown is worked out from it, and a whole percent is 1.68 hours. */
const elapsedPercent = (resetMs, now) => (resetMs ? Math.max(0, Math.min(100, ((now - (resetMs - WEEK_MS)) / WEEK_MS) * 100)) : null)

function windowSize(n) {
  if (!n) return null
  return n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`
}

function branchOf(inp, cwd) {
  if (inp.worktree?.branch) return inp.worktree.branch
  try { return git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD') } catch { return null }
}

/** Claude Code's input -> the renderer's input, plus the usage figures. */
export function mapInput(inp, now = Date.now(), markPercent = DEFAULT_MARK) {
  inp = inp && typeof inp === 'object' ? inp : {}
  const cwd = inp.cwd || inp.workspace?.current_dir || process.cwd()
  const seven = inp.rate_limits?.seven_day
  const iso = (s) => (num(s) ? new Date(s * 1000).toISOString() : null)
  const used = num(seven?.used_percentage)
  const resetMs = num(seven?.resets_at) ? seven.resets_at * 1000 : null
  const elapsed = elapsedPercent(resetMs, now)
  const repoPath = inp.worktree?.original_cwd || mainCheckout(cwd)
  return {
    input: {
      model: inp.model?.display_name || inp.model?.id || null,
      effort: inp.effort?.level || null,
      contextPercent: num(inp.context_window?.used_percentage),
      contextWindow: windowSize(num(inp.context_window?.context_window_size)),
      repo: path.basename(repoPath) || null,
      branch: branchOf(inp, cwd),
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
  }
}

/** What a run adds to the mascot's mood: its questions, its pause, how its requirements, tasks and agents stand. */
function runFacts(run, ids, now, share) {
  if (!run) {
    // A finished run is no longer the session's run, but the session still points at it.
    for (const id of ids) {
      const dir = readJson(sessionFile(home(), id))?.runDir
      const state = dir && readJson(runPaths(dir).state)
      if (state?.status === 'finished' && state.finishedAt) return { finishedAgo: now - state.finishedAt }
    }
    return {}
  }
  const count = (list, status) => (list ?? []).filter((x) => x.status === status).length
  const { tasks, requirements } = workOf(run.state)
  // The mod's count of quiet and stalled agents stands only while the mod is alive to keep it.
  let agents = null
  try { if (now - Number(fs.readFileSync(run.paths.modAlive, 'utf8').trim()) <= 15000) agents = readJson(run.paths.quiet) } catch {}
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
 * takes its spend back out; a reply (a cost above 0) without one settles an unclear session as pay-per-token.
 * The session file is written only when the kind changes.
 */
function settleBilling(inp, ids, now) {
  const id = ids[0]
  if (!id) return
  const was = ids.map((i) => readJson(sessionFile(home(), i))?.billing).find((b) => typeof b === 'string') ?? 'unclear'
  const cost = num(inp.cost?.total_cost_usd)
  const weekly = inp.rate_limits?.seven_day
  const billing = settle(was, { weekly: weekly && typeof weekly === 'object' ? weekly : null, replied: cost > 0 })
  if (billing !== was) setBilling(id, billing)
  if (billing === 'subscription') dropSpend(id)
  else if (cost !== null) recordSpend(id, cost, now)
}

function plainRow(input) {
  const bits = [input.model, input.repo, input.branch, input.weekUsedPercent != null ? `week ${input.weekUsedPercent}%` : null]
  return bits.filter(Boolean).join(' · ') || 'LCW'
}

export async function main({ margin = 5 } = {}) {
  let inp = {}
  try { inp = JSON.parse(fs.readFileSync(0, 'utf8')) } catch {}
  let mapped = { input: {}, usage: null }
  try {
    const now = clock()
    let run = null
    const ids = sessionIds(inp)
    try { settleBilling(inp, ids, now) } catch {}
    for (const id of ids.length ? ids : [undefined]) {
      try { run = findRun({ sessionId: id, cwd: inp?.cwd || inp?.workspace?.current_dir }) } catch {}
      if (run) break
    }
    // The mark is the session's own, run or no run; a run carries its driving session's.
    let mark = DEFAULT_MARK
    try { mark = run?.state.markPercent ?? sessionMark(ids) } catch {}
    mapped = mapInput(inp, now, mark)
    // Claude Code hands each session the figure it saw at its own last reply, so two bars can differ. The newest
    // one any session has reported is kept in usage.json, and that is what every bar and mascot shows: nothing
    // once the week it was read in is over.
    // The context's size for lcw checkpoint, which cannot see it: the share Claude Code reports of the window it reports.
    const pct = num(inp.context_window?.used_percentage), win = num(inp.context_window?.context_window_size)
    if (pct !== null && win) for (const id of ids) try { writeJson(contextFile(home(), id), { tokens: Math.round(pct / 100 * win), window: win, at: now }) } catch {}
    let usage = readJson(usageFile(home()))
    if (mapped.usage) {
      try {
        usage = mergeUsage(usage, mapped.usage)
        writeJson(usageFile(home()), usage)
      } catch {}
    }
    // On pay-per-token billing the 7-day spend is what the mark is held against, and that needs no weekly figure.
    // The run is gated by its driving session's view, which is this session's own when it is the driver.
    let money = null
    try { money = readMoney({ sessionId: ids, now, state: run?.state }) } catch {}
    if (money) mapped.input.money = money
    if (run) {
      try {
        const driver = run.state.driver
        const driverMoney = !driver || ids.includes(driver) ? money : readMoney({ sessionId: driver, now, state: run.state })
        if (driverMoney) applyGate(run.paths, run.state, usage, now, driverMoney)
        else if (mapped.usage) applyGate(run.paths, run.state, usage, now)
      } catch {}
    }
    // While the session's run has its worktree, that is where the work is: the bar names the run's branch and
    // counts the run's changes. Without one, it counts the checkout the session is in.
    const runTree = run?.state.worktree && fs.existsSync(run.state.worktree) ? run.state.worktree : null
    if (runTree && run.state.branch) mapped.input.branch = run.state.branch
    try { mapped.input.diff = diffOf(runTree ?? mapped.cwd, home(), now) } catch {}
    const week = usage?.sevenDay
    const live = typeof week?.percentUsed === 'number' && !(week.resetsAt && Date.parse(week.resetsAt) <= now)
    mapped.input.weekUsedPercent = live ? week.percentUsed : null
    mapped.input.weekElapsedPercent = live ? elapsedPercent(Date.parse(week.resetsAt), now) : null
    // COLUMNS is the full terminal width. Claude Code shows the first COLUMNS - 5 cells of each line, or
    // COLUMNS - 4 under the padding setup writes, which its shim passes as the margin.
    const cols = Number(process.env.COLUMNS)
    const width = cols > 5 ? cols - margin : 121
    const theme = process.env.LCW_THEME === 'light' ? 'light' : 'dark'
    const { renderStatusRows } = await import('../lib/status.mjs')
    const { toAnsi } = await import('../lib/paint.mjs')
    // The mascot stands left of the two status rows, which are drawn that much narrower. It is left out where
    // it would push them into the narrow layout, and a failure in it costs the mascot and nothing else.
    let pet = null
    try {
      const { mascotRows, moodOf, GAP } = await import('../lib/mascot.mjs')
      const { thresholds } = await import('../lib/theme.mjs')
      let transcriptAt = 0
      try { transcriptAt = fs.statSync(inp.transcript_path).mtimeMs } catch {}
      // The hooks write under the transcript's name and the mod under the session's id, which differ in a
      // resumed session: the latest record is the one that counts.
      const activity = ids.map((id) => readJson(activityFile(home(), id))).filter(Boolean).sort((a, b) => b.at - a.at)[0] ?? null
      // Points of the week left before the session's usage mark; unknown once the week it was read in is over.
      const markLeft = live ? mark - week.percentUsed : null
      const share = run ? (await import('../lib/card.mjs')).weekShare(run.state, week) : null
      const mood = moodOf({ now, transcriptAt, activity, contextPercent: mapped.input.contextPercent, markLeft, run: runFacts(run, ids, now, share), money, hour: new Date(now).getHours() })
      const creature = mascotRows({ now, seed: ids[0], mood })
      const cells = creature[0].length + GAP
      if (width - cells >= thresholds.narrowBelowColumns) pet = { rows: creature, cells, gap: { t: ' '.repeat(GAP) } }
    } catch {}
    let rows = renderStatusRows(mapped.input, { width: width - (pet?.cells ?? 0), theme, now })
    if (pet) rows = rows.map((row, i) => [...(pet.rows[i] ?? []), pet.gap, ...row])
    const besidePet = pet ? rows.length : 0
    if (run) {
      let alive = 0
      try { alive = Number(fs.readFileSync(run.paths.modAlive, 'utf8').trim()) || 0 } catch {}
      if (now - alive > 15000) {
        const { buildView, renderCard } = await import('../lib/card.mjs')
        const gate = readJson(run.paths.gate)
        const view = buildView({ state: run.state, agents: run.state.agents ?? [], usage: readJson(usageFile(home())), gate, money, now, ui: { expanded: {}, moreOpen: false } })
        rows = rows.concat(renderCard(view, { width, theme }))
      }
    }
    let text = toAnsi(rows, theme, width)
    // Claude Code trims the spaces a row starts with unless an escape code comes first (seen in 2.1.327), and
    // the creature's rows often start with empty cells. So each of them opens with a colour reset.
    if (pet) text = text.split('\n').map((row, i) => (i < besidePet ? '\x1b[0m' + row : row)).join('\n')
    process.stdout.write(text + '\n')
    // After the bar is out: on pay-per-token billing, at most one runner per window across every session.
    if (money) maybeRefresh(home(), now)
  } catch {
    process.stdout.write(plainRow(mapped.input) + '\n')
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(() => process.stdout.write('LCW\n')).finally(() => process.exit(0))
}
