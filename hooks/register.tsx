import type { EngineInterface, Register } from 'claude-code'

import {
  activityFile, capFile, cleanupFile, noticesFile, runPaths, runsDir, sessionFile, spendCommandFile, spendDir, spendFile, spendReadingFile, updateFile, usageFile,
} from '../lib/key.mjs'
import { answerKey, bannerFor, bannerRows } from '../lib/banner.mjs'
import type { Banner, BannerFacts } from '../lib/banner.mjs'
import { moneyFrom, readingOf, spendFileCounts } from '../lib/spend.mjs'
import { buildView, renderCard } from '../lib/card.mjs'
import { hex } from '../lib/theme.mjs'
import { mergeUsage } from '../lib/usage.mjs'
import {
  addTotals, addUsage, buttons, countsTurn, compactInstructions, gateFor, isAnimating, isShown, layout, measureStep, nudgeable, quietCounts, reopenDue,
  reopenPrompt, resumePrompt, retryGate, stallNudges, stallPrompt, themeFrom, trackAgents, usageFrom, usdWakePrompt, wakeable, wakeDue, wakePrompt,
} from './lcw-mod.mjs'
import type { CardAgent, Nudged, Row, Seen, Span, Totals } from './lcw-mod.mjs'
import {
  AWAKE_EVERY_MS, RUNS_EVERY_MS, awakeApplies, awakeCheckWanted, claudeCommand, dismissKeys, markSpell, pressPlan, runFact, said, sameBox, spendFailingFact,
  statusLineFact, unfinishedCandidates, unfinishedFact, usageFact, weeklyDue, weeklyIdle,
} from './boxes.mjs'
import type { Plan, RunSeen } from './boxes.mjs'

// A blank row between the card and what Claude Code draws above it (the spinner and its tip).
const TOP_GAP = 1
// The rows a run's card keeps before a banner may be drawn above it.
const CARD_ROOM = 10
// Where a prompt the person sent comes from: typed at the prompt, from a phone or the web, or from an app driving the session.
const PERSON = ['composer', 'bridge', 'sdk']
// How long the band is drawn without buttons after its box changed: see the ui.render hook.
const UNFOCUS_MS = 300

// session is the session's file (the binding, its billing and its mark); money is the pay-per-token view, else null.
type Run = { runDir: string; paths: ReturnType<typeof runPaths>; state: any; gate: any; usage: any; session: any; money: any }

const S = {
  started: false,
  home: '',
  run: null as Run | null,
  agents: [] as CardAgent[],
  seen: {} as Seen,
  nudged: {} as Nudged,
  quiet: null as { quiet: number; stalled: number } | null,
  totals: {} as Partial<Totals>,
  totalsChanged: false,
  totalsAt: 0,
  theme: 'dark' as 'dark' | 'light',
  ui: { expanded: {} as Record<string, true>, moreOpen: false },
  hideRows: false,
  collapsed: false,
  drawnAt: 0,
  shownSince: 0,
  dirty: false,
  wokeFor: null as string | number | null,
  startedAt: 0,
  reopenChecked: false,
  // The banner pinned above the card until the person picks an option; dismissed is Not now, for this session
  // ('kind:key', or the bare kind of the three old boxes); answerFill the asks Answer now could not put in the prompt.
  banner: { shown: null as Banner | null, dismissed: new Set<string>(), answerFill: '' },
  // A person can see the session: a person at the prompt (isInteractive) or a surface attached, such as the desktop
  // app driving it through the SDK. Without either (a -p run, or an app that left): no box, no weekly check, no setting changed.
  interactive: false,
  atPrompt: false,
  version: '',
  devCheckout: false,
  // The machine is a Mac (session.info's platform): the cleanup box names it.
  mac: false,
  // This repository's key, from lcw where --json once per session; null outside a repository.
  repoKey: null as string | null,
  keyAsked: false,
  unfinished: null as BannerFacts['unfinished'],
  runsAt: 0,
  sleep: null as { canHold: boolean; heldByOther: boolean; kept: boolean } | null,
  sleepAt: 0,
  sleepFor: '',
  slowBusy: false,
  turnRunning: false,
  turnEndedAt: 0,
  // The facts the shown box was last chosen from; the run folders found finished or stopped, never read again.
  facts: null as BannerFacts | null,
  closedRuns: new Set<string>(),
  // A checkpoint's compaction is on its way: the turns that end meanwhile do not start another.
  compacting: false,
  weeklyAt: 0,
  weeklyText: '',
  // The update check is looked for once in each session; a prompt it gives waits here until weeklyText is free.
  updateAsked: false,
  updateText: '',
  mark: { since: 0, below: 0 },
  autoDone: false,
  pressing: false,
  // The box last drawn ('kind:key', '' for none), and until when the band is drawn without buttons since it changed.
  drawnBox: '',
  unfocusUntil: 0,
  // When the person last sent a prompt: one sent after the Brainstorm's playback asked for approval ends that box.
  repliedAt: 0,
}

const totalsFile = (runDir: string) => `${runDir}/totals.json`

const readJson = ($: EngineInterface, path: string) =>
  $.fs.read(path).then((text) => JSON.parse(text)).catch(() => null)

async function lcwHome($: EngineInterface) {
  if (!S.home) S.home = (await $.env.get('LCW_HOME')) || `${await $.env.get('HOME')}/.lcw`
  return S.home
}

// The run bound to this session, or null. A state.json caught mid-write throws, keeping the last one.
async function readRun($: EngineInterface, now: number): Promise<Run | null> {
  const home = await lcwHome($)
  const binding = await readJson($, sessionFile(home, await $.session.id()))
  if (!binding?.runDir) return null
  const paths = runPaths(binding.runDir)
  if (!(await $.fs.exists(paths.state))) return null
  const state = JSON.parse(await $.fs.read(paths.state))
  if (!isShown(state, now)) return null
  return {
    runDir: binding.runDir, paths, state, gate: await readJson($, paths.gate), usage: await readJson($, usageFile(home)), session: binding, money: null,
  }
}

// The name a session's spend is kept under: its transcript's, which a resumed session keeps and the status line
// goes by too, else its id. One session kept under two names would count its dollars twice.
async function spendName($: EngineInterface) {
  const path = await $.session.info().then((i) => i.transcriptPath).catch(() => '')
  return path ? path.split('/').pop()!.replace(/\.jsonl$/, '') : await $.session.id()
}

// The money view for a session billed per token, else null: the machine's spend from every session's record, the
// cap, the session's mark, the run's own spend (this session's cost so far is its record's highest reading), and
// the next try from a dollar gate. Nothing in ~/.lcw/spend is read for any other session.
async function readMoney($: EngineInterface, session: any, state: any, gate: any, now: number) {
  if (session?.billing !== 'payg') return null
  const home = await lcwHome($)
  const dir = spendDir(home)
  const names = ((await $.fs.list(dir).catch(() => [])) as { name: string; kind: string; mtimeMs: number }[])
    .filter((f) => f.kind === 'file' && f.name.endsWith('.json') && spendFileCounts(f.mtimeMs, now)).map((f) => f.name)
  const records = await Promise.all(names.map((name) => readJson($, `${dir}/${name}`)))
  const own = records[names.indexOf(`${await spendName($)}.json`)]
  const money: any = moneyFrom({
    records: records.filter(Boolean), cap: await readJson($, capFile(home)), session, state, sessionCum: own?.max, now,
    // Read only: the spend command is run by the scripts, never by the mod.
    reading: readingOf(await readJson($, spendCommandFile(home)), await readJson($, spendReadingFile(home))),
  })
  return gate?.unit === 'usd' ? { ...money, retryAt: gate.retryAt, retried: !!gate.retried } : money
}

// Deferred, as the checkpoint's prompt is: a prompt submitted from inside session.start may not land.
const submitSoon = ($: EngineInterface, text: string) =>
  void $.clock.after(700, () => void $.prompt.submit({ text }).catch(() => {}))

async function refresh($: EngineInterface) {
  const now = await $.clock.now()
  const run = await readRun($, now)
  // Before the run is shown: a card drawn without its money view would count percentages.
  if (run) run.money = await readMoney($, run.session, run.state, run.gate, now)
  if (!run && !S.run) return
  // The first run this process sees is judged once, by mod-alive as it stood before this process drew it.
  const firstSight = !!run && !S.reopenChecked
  if (firstSight) S.reopenChecked = true
  const aliveAt = firstSight && run ? Number(await $.fs.read(run.paths.modAlive).catch(() => '')) : 0
  if (!S.run || S.run.runDir !== run?.runDir) {
    S.shownSince = now
    S.totals = (run && (await readJson($, totalsFile(run.runDir)))) || {}
    S.totalsChanged = false
    S.quiet = null
  }
  S.run = run
  S.dirty = true
  if (!run) {
    S.agents = []
    S.seen = {}
    S.nudged = {}
    S.hideRows = false
    return
  }
  if (firstSight) {
    await $.fs.write(run.paths.modAlive, String(now)).catch(() => {})
    // Within ten seconds of start: the session-start hook that binds a resumed session can run after us.
    if (now - S.startedAt <= 10000 && reopenDue(run.state, run.gate, aliveAt, now)) submitSoon($, reopenPrompt($.plugin.root))
  }
  if (!wakeDue(run.gate, now, S.wokeFor, run.session?.billing)) return
  const gate = run.gate
  // Set before anything is awaited: refreshes overlap, and this try is made once.
  S.wokeFor = gate.unit === 'usd' ? gate.retryAt : gate.resetsAt
  // At 08:00 a run still at its dollar mark stays paused and tries again the next morning.
  const later = gate.unit === 'usd' && wakeable(run.state) ? retryGate(gate, run.money, now) : null
  if (later) {
    await $.fs.write(run.paths.gate, JSON.stringify(later)).catch(() => {})
    run.gate = later
    run.money = { ...run.money, retryAt: later.retryAt, retried: true }
    return
  }
  await $.process.run(['rm', '-f', run.paths.gate]).catch(() => {})
  run.gate = null
  if (run.money) run.money = { ...run.money, retryAt: undefined, retried: undefined }
  if (wakeable(run.state)) submitSoon($, gate.unit === 'usd' ? usdWakePrompt($.plugin.root, run.money?.markUsd ?? null) : wakePrompt($.plugin.root))
}

async function pollAgents($: EngineInterface) {
  const run = S.run
  if (!run) return
  const list = await $.agent.list()
  const now = await $.clock.now()
  const tracked = trackAgents(list, S.seen, now)
  S.agents = tracked.agents
  S.seen = tracked.seen
  S.dirty = true
  // The mascot beside the status rows shows trouble with agents. It cannot ask the mod, so the count of quiet
  // and stalled agents is left in the run's folder, written when it changes.
  const quiet = quietCounts(S.agents)
  if (quiet.quiet !== S.quiet?.quiet || quiet.stalled !== S.quiet?.stalled) {
    S.quiet = quiet
    await $.fs.write(run.paths.quiet, JSON.stringify({ ...quiet, at: now })).catch(() => {})
  }
  // A stalled agent is the orchestrator's to deal with: tell the main loop, which acts once it is idle.
  if (nudgeable(run.state)) {
    const stall = stallNudges(S.agents, S.nudged, now)
    S.nudged = stall.nudged
    if (stall.due.length) submitSoon($, stallPrompt(stall.due, S.agents))
  } else S.nudged = {}
  const totals = addTotals(S.totals, list, run.state.createdAt ?? 0)
  if (totals.agents !== S.totals.agents || totals.tokens !== S.totals.tokens) S.totalsChanged = true
  S.totals = totals
  // At most every five seconds; a change made in between is written on a later poll.
  if (S.totalsChanged && now - S.totalsAt >= 5000) {
    await $.fs.write(totalsFile(run.runDir), JSON.stringify(totals))
    S.totalsChanged = false
    S.totalsAt = now
  }
}

// What a finished turn used, added to the run's totals: the main session's turns and each agent's run, which is
// one turn. The count is Claude Code's own (/cost's), so it holds every request, cache reads and retries among them.
async function countTurn($: EngineInterface, e: { usage?: any; agentId?: string; durationMs?: number }) {
  if (!e.usage) return
  const now = await $.clock.now()
  const run = await readRun($, now)
  if (!run || !countsTurn(run.state, now - (e.durationMs ?? 0))) return
  const same = S.run?.runDir === run.runDir
  const totals = addUsage(same ? S.totals : (await readJson($, totalsFile(run.runDir))) || {}, e.usage, !!e.agentId)
  // kept before the write: another agent's turn that ends meanwhile then adds to these totals, not to the old ones
  if (same) {
    S.totals = totals
    S.totalsChanged = false
    S.totalsAt = now
    S.dirty = true
  }
  await $.fs.write(totalsFile(run.runDir), JSON.stringify(totals))
}

// A file's text and what it parses to: missing is null; caught mid-write (it does not parse) is undefined.
async function readParsed($: EngineInterface, path: string) {
  const text = await $.fs.read(path).catch(() => null)
  if (text === null) return null
  try { return JSON.parse(String(text)) } catch { return undefined }
}

// The session's billing settled by this reading, and its spend recorded (or dropped, on a subscription). The
// session file is written only when the billing changes, so a mark lcw mark has just written is not lost.
async function measureSpend($: EngineInterface, e: { cost?: { usd: number } }, reading: unknown, now: number) {
  const home = await lcwHome($)
  const id = await $.session.id()
  const spent = spendFile(home, await spendName($))
  const [session, rec] = await Promise.all([readParsed($, sessionFile(home, id)), readParsed($, spent)])
  const step = measureStep(session, rec, { weekly: reading, cost: e.cost?.usd }, now)
  if (step.changed && session !== undefined) await $.fs.write(sessionFile(home, id), JSON.stringify({ ...session, billing: step.billing }))
  if (step.drop) await $.process.run(['rm', '-f', spent]).catch(() => {})
  // A record caught mid-write is left for the next reading rather than started again from this one.
  if (step.record && rec !== undefined) await $.fs.write(spent, JSON.stringify(step.record))
  return step.billing
}

const lcwCli = ($: EngineInterface) => `${$.plugin.root}/scripts/lcw.mjs`

// Every fact the boxes are chosen from. The cheap files are read here, every 2 s; the run is refresh's, and the
// repository's runs and the sleep check are slowFacts', at their own pace.
async function gather($: EngineInterface, now: number): Promise<BannerFacts> {
  const home = await lcwHome($)
  const [advisorModel, statusLine, session, cap, command, reading, notices, usage, update, cleanup] = await Promise.all([
    $.settings.read({ key: 'advisorModel' }).catch(() => 'unread'),
    // The user settings file alone: the one Put LCW's back writes.
    $.settings.read({ key: 'statusLine', source: 'user' }).catch(() => undefined),
    readJson($, sessionFile(home, await $.session.id())),
    readJson($, capFile(home)),
    readJson($, spendCommandFile(home)),
    readJson($, spendReadingFile(home)),
    readJson($, noticesFile(home)),
    readJson($, usageFile(home)),
    readJson($, updateFile(home)),
    S.repoKey ? readJson($, cleanupFile(home, S.repoKey)) : null,
  ])
  const run = S.run
  const money = run ? run.money : await readMoney($, session, null, null, now)
  const runF = runFact(run?.state, S.sleep?.kept)
  const asked = runF?.asks?.length ? answerKey(runF) : ''
  const week = usageFact({ state: run?.state, session, usage: run ? run.usage : usage, money, now })
  // When the week reached the mark, until it has been below it for a minute: a climb back is another occurrence of the mark box.
  S.mark = markSpell(S.mark, week.atMark, now)
  return {
    now, mac: S.mac, billing: session?.billing, advisorModel, advisorFlag: !!session?.advisorFlag, capSet: Number(cap?.usd) > 0,
    spendCommandSet: !!command?.command, notices, dismissed: S.banner.dismissed, repoKey: S.repoKey ?? undefined,
    run: runF,
    usage: { ...week, since: S.mark.since || undefined },
    spendFailing: spendFailingFact(readingOf(command, reading)),
    unfinished: run ? null : S.unfinished,
    sleep: run && awakeApplies(run.state) ? S.sleep : null,
    // Without its own version the mod cannot tell an update applied from one waiting for a restart.
    update: S.version ? { running: S.version, available: update?.available ?? null, updated: update?.updated ?? null, devCheckout: S.devCheckout } : null,
    statusLine: statusLineFact(statusLine, home),
    cleanup: cleanup?.at && cleanup?.title ? cleanup : null,
    answerFill: asked && S.banner.answerFill === asked ? 'failed' : undefined,
    repliedAt: S.repliedAt,
  }
}

// Which box to show. It is replaced whenever what it says changes, not only its kind: the boxes change within a kind.
async function readBanner($: EngineInterface) {
  // Nobody watches: nothing is gathered at all.
  if (!S.interactive) return
  const facts = await gather($, await $.clock.now())
  S.facts = facts
  const shown = bannerFor(facts)
  if (JSON.stringify(shown) !== JSON.stringify(S.banner.shown)) { S.banner.shown = shown; S.dirty = true }
}

// The facts that cost a process or a walk over the repository's runs, each at its own pace, and the weekly check.
async function slowFacts($: EngineInterface) {
  if (!S.interactive || S.slowBusy) return
  S.slowBusy = true
  try {
    const now = await $.clock.now()
    // A run's folder names its repository's key; without one, lcw is asked once.
    const fromRun = /\/repos\/([\w.-]+)\/runs\/[^/]+$/.exec(S.run?.runDir ?? '')?.[1]
    if (fromRun) S.repoKey = fromRun
    else if (!S.keyAsked) { S.keyAsked = true; await readKey($) }
    if (S.run || !S.repoKey) S.unfinished = null
    else if (now - S.runsAt >= RUNS_EVERY_MS) { S.runsAt = now; await scanRuns($, now) }
    const run = S.run
    // Not asked while the box could not show: turned off for good, or this occurrence dismissed.
    const notices = run && awakeApplies(run.state) ? await readJson($, noticesFile(await lcwHome($))) : null
    if (run && awakeCheckWanted(run.state, notices, S.banner.dismissed)) {
      const occurrence = run.runDir + ':' + (run.state.runningSince ?? '')
      if (S.sleepFor !== occurrence || now - S.sleepAt >= AWAKE_EVERY_MS) { S.sleepFor = occurrence; S.sleepAt = now; await checkSleep($) }
    } else S.sleep = null
    await weekly($, now)
  } finally {
    S.slowBusy = false
  }
}

// The repository's key, as lcw computes it from the main checkout. No session is named, so the call binds nothing.
async function readKey($: EngineInterface) {
  const r = await $.process.run(['node', lcwCli($), 'where', '--json'], { env: { CLAUDE_CODE_SESSION_ID: '' } }).catch(() => null)
  try {
    const key = JSON.parse(String(r?.stdout ?? '')).key
    if (typeof key === 'string' && /^[\w.-]+$/.test(key)) S.repoKey = key
  } catch {}
}

// A run of this repository left halfway: open, shown by no session for 15 minutes, and its driver's Claude Code gone.
// Nothing is written into the runs looked at, or they would look shown.
async function scanRuns($: EngineInterface, now: number) {
  const dir = runsDir(await lcwHome($), S.repoKey!)
  const entries = ((await $.fs.list(dir).catch(() => [])) as { name: string; kind: string }[]).filter((f) => f.kind === 'dir')
  const seen: RunSeen[] = []
  for (const f of entries) {
    const paths = runPaths(`${dir}/${f.name}`)
    if (S.closedRuns.has(paths.dir)) continue
    const state = await readJson($, paths.state)
    if (state?.status === 'finished' || state?.status === 'stopped') S.closedRuns.add(paths.dir)
    if (!state?.id || state.status === 'finished' || state.status === 'stopped') continue
    const files = (await $.fs.list(paths.dir).catch(() => [])) as { name: string; mtimeMs: number }[]
    const time = (name: string) => files.find((x) => x.name === name)?.mtimeMs ?? 0
    const drawn = Number(String((await $.fs.read(paths.modAlive).catch(() => '')) ?? '').trim()) || 0
    seen.push({ dir: paths.dir, state, shownAt: Math.max(drawn, time('state.json'), time('ledger.md')) })
  }
  for (const c of unfinishedCandidates(seen, now, S.run?.runDir, S.banner.dismissed)) {
    if (await driverOpen($, c.state.driver)) continue
    S.unfinished = unfinishedFact(c, String((await $.fs.read(runPaths(c.dir).ledger).catch(() => '')) ?? ''))
    return
  }
  S.unfinished = null
}

// Whether the Claude Code process of the session that drove a run is still running (lcw take refuses such a run).
// One that is this session's own process is closed: /clear starts a new session in the same Claude Code. So is one
// whose pid another program now has: pids get reused.
async function driverOpen($: EngineInterface, driver: unknown) {
  const id = await $.session.id()
  if (typeof driver !== 'string' || !driver || driver === id) return false
  const home = await lcwHome($)
  const pid = Number((await readJson($, sessionFile(home, driver)))?.claudePid)
  if (!Number.isInteger(pid) || pid <= 1) return false
  if (pid === Number((await readJson($, sessionFile(home, id)))?.claudePid)) return false
  const r = await $.process.run(['ps', '-ww', '-o', 'args=', '-p', String(pid)]).catch(() => null)
  return r?.exitCode === 0 && claudeCommand(String(r.stdout ?? ''))
}

async function checkSleep($: EngineInterface) {
  const r = await $.process.run(['node', lcwCli($), 'awake', '--check', '--session', await $.session.id()]).catch(() => null)
  try {
    const j = JSON.parse(String(r?.stdout ?? ''))
    S.sleep = { canHold: j.canHold === true, heldByOther: j.heldByOther === true, kept: j.kept === true }
  } catch {
    S.sleep = null
  }
}

// What the person has typed and not sent; anything unreadable counts as typed, so nothing is submitted over it.
const draft = ($: EngineInterface) => $.prompt.read().then((b) => String(b?.text ?? '')).catch(() => '?')

// The checks' prompts. Once at the start of every watched session, without waiting for it to be idle, weekly.mjs update
// compares the installed LCW with its marketplace in code; it gives a prompt only when a newer version needs the banner's
// bullets written. A session driving a run looks once it no longer does: the banner shows no update during a run.
// The weekly ones are asked for only while the session is idle (quiet, nothing typed, no run, not at the mark):
// weekly.mjs due says which is due and records the ask. A prompt is submitted while the session is idle; one that
// cannot go yet (a turn started, something was typed, a run is driven, the submit failed) is kept for this session and
// sent at the next idle tick.
async function weekly($: EngineInterface, now: number) {
  if (!S.updateAsked && !S.run) {
    S.updateAsked = true
    // Not awaited: the marketplace refresh can take up to 120 s, and the other slow facts do not wait for it.
    void $.process.run(['node', `${$.plugin.root}/scripts/weekly.mjs`, 'update'], { timeoutMs: 150000 })
      .then((r) => { if (r?.exitCode === 0) S.updateText = String(r.stdout ?? '').trim() })
      .catch(() => {})
  }
  const idle = {
    interactive: S.interactive, turnRunning: S.turnRunning, driving: !!S.run, atMark: !!S.facts?.usage?.atMark,
    startedAt: S.startedAt, turnEndedAt: S.turnEndedAt, now,
  }
  if (!S.weeklyText && S.updateText) { S.weeklyText = S.updateText; S.updateText = '' }
  if (!S.weeklyText) {
    if (!weeklyDue({ ...idle, askedAt: S.weeklyAt })) return
    if ((await draft($)).trim()) return
    S.weeklyAt = now
    // Its survey of the repository (gh pr list alone may take 20 s) can outlast the default 30 s, which would lose the week it claimed.
    const r = await $.process.run(['node', `${$.plugin.root}/scripts/weekly.mjs`, 'due'], { timeoutMs: 120000 }).catch(() => null)
    S.weeklyText = r?.exitCode === 0 ? String(r.stdout ?? '').trim() : ''
  }
  if (!S.weeklyText || !weeklyIdle({ ...idle, turnRunning: S.turnRunning, driving: !!S.run }) || (await draft($)).trim()) return
  const text = S.weeklyText
  S.weeklyText = ''
  if (!(await $.prompt.submit({ text }).then(() => true).catch(() => false))) S.weeklyText = text
}

// LCW's status rows and attribution off, by themselves, on a watched session's first draw.
async function autoSetup($: EngineInterface) {
  const r = await $.process.run(['node', `${$.plugin.root}/scripts/setup.mjs`, 'auto']).catch(() => null)
  if (r?.exitCode !== 0) return
  for (const line of String(r.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) $.ui.toast(line, { timeoutMs: 8000 })
}

// Answer now: the oldest open ask's number at the start of the prompt, keeping what is typed there.
async function fillAnswer($: EngineInterface, n: number | undefined) {
  if (!Number.isFinite(n)) return false
  const head = `${n}: `
  const typed = (await $.prompt.read().catch(() => ({ text: '' }))).text ?? ''
  const filled = await $.prompt.fill({ text: typed.startsWith(head) ? typed : head + typed }).catch(() => null)
  return !!filled?.isFilled
}

// A reply from the approval box put in the prompt, never sent. Only into an empty prompt: a draft the person typed is
// neither replaced nor added to, and they are told to type the reply themselves.
async function fillReply($: EngineInterface, text: string) {
  if ((await draft($)).trim()) {
    $.ui.toast(`Your prompt has text in it. Clear it and press the button again, or type "${text.trim()}" yourself.`, { timeoutMs: 10000 })
    return false
  }
  const filled = await $.prompt.fill({ text }).catch(() => null)
  if (!filled?.isFilled) $.ui.toast(`LCW could not fill your prompt. Type "${text.trim()}" there and press Enter.`, { timeoutMs: 10000 })
  return !!filled?.isFilled
}

// A press's plan carried out: its commands in order (the first that fails says why and the box stays), then the
// prompt (one that cannot be sent keeps the box), the notices, the fill, and the box hidden for this occurrence.
async function carryOut($: EngineInterface, banner: Banner, plan: Plan) {
  let last: { stdout?: string; stderr?: string } | null = null
  for (const step of plan.steps ?? []) {
    const r = await $.process.run(step.argv, step.timeoutMs ? { timeoutMs: step.timeoutMs } : undefined)
      .catch((err: any) => ({ exitCode: 1, stdout: '', stderr: String(err?.message ?? err) }))
    if (r.exitCode !== 0 || step.halt?.test(String(r.stdout ?? '').trim())) {
      return $.ui.toast((plan.fail ?? '') + (said(r) || 'the command failed.'), { timeoutMs: 10000 })
    }
    last = r
  }
  if (plan.prompt) {
    const sent = await $.prompt.submit(plan.prompt).then(() => true).catch(() => false)
    if (!sent) return $.ui.toast(plan.promptFailed ?? 'Clear the prompt or wait for the turn to end, then press it again.')
  }
  if (plan.notices) {
    const file = noticesFile(await lcwHome($))
    await $.fs.write(file, JSON.stringify({ ...((await readJson($, file)) || {}), ...plan.notices }))
  }
  if (plan.fillText !== undefined && !(await fillReply($, plan.fillText))) return
  if ('fill' in plan && !(await fillAnswer($, plan.fill))) {
    S.banner.answerFill = String(banner.key)
    S.dirty = true
    return
  }
  if (plan.dismiss) for (const k of dismissKeys(banner)) S.banner.dismissed.add(k)
  S.banner.shown = null
  S.dirty = true
  const toast = plan.toast === 'output' ? said(last) : plan.toast
  if (toast) $.ui.toast(toast, { timeoutMs: 10000 })
}

// A box's option, pressed on the box as it was drawn. The facts are read again first: a box that has changed since
// (another occurrence, or the option no longer offered) is not acted on. One press at a time.
async function pressBanner($: EngineInterface, id: string, drawn: Banner | null) {
  const [, kind = '', option = ''] = id.split(':')
  if (!drawn || drawn.kind !== kind) return
  if (S.pressing) return $.ui.toast('LCW is still on the last button you pressed.')
  S.pressing = true
  try {
    await refresh($).catch(() => {})
    const facts = await gather($, await $.clock.now())
    const fresh = S.interactive ? bannerFor(facts) : null
    if (!sameBox(drawn, fresh, option)) {
      S.banner.shown = fresh
      S.dirty = true
      return $.ui.toast('That box changed before the click, so nothing was done.')
    }
    const plan = pressPlan(fresh, option, facts, {
      root: $.plugin.root, sessionId: await $.session.id(), repoKey: S.repoKey ?? undefined,
      cleanupPath: S.repoKey ? cleanupFile(await lcwHome($), S.repoKey) : undefined,
    })
    if (plan) await carryOut($, fresh!, plan)
  } finally {
    S.pressing = false
  }
  // What the press changed is seen at once: the next run to name, the hold just started.
  if (kind === 'unfinished') S.runsAt = 0
  if (kind === 'awake') S.sleepAt = 0
  await readBanner($).catch(() => {})
}

async function heartbeat($: EngineInterface) {
  if (!S.run) return
  const now = await $.clock.now()
  S.theme = themeFrom(await $.config.list())
  if (now - S.drawnAt < 5000) await $.fs.write(S.run.paths.modAlive, String(now))
}

async function checkpoint($: EngineInterface) {
  const run = await readRun($, await $.clock.now())
  if (!run) return
  const step = String((await $.fs.read(run.paths.checkpoint).catch(() => '')) ?? '').trim()
  if (!step || S.compacting) return
  S.compacting = true
  // The step stays in its file until the compaction has happened: one refused because a turn has started is
  // tried again when a turn next ends.
  $.clock.after(700, () => void (async () => {
    await $.session.compact({ instructions: compactInstructions(run.state, run.runDir, step) })
    await $.fs.write(run.paths.checkpoint, '')
    await $.prompt.submit({ text: resumePrompt($.plugin.root, step) })
  })().catch(() => {}).finally(() => { S.compacting = false }))
}

// The person pressed Stop on a running turn. No Stop hook fires for that, so the turn the mascot shows as
// working is closed here; without it the creature would go on looking busy until the next turn ended.
async function noteStopped($: EngineInterface) {
  const file = activityFile(await lcwHome($), await $.session.id())
  await $.fs.write(file, JSON.stringify({ ...(await readJson($, file)), state: 'rest', at: await $.clock.now() }))
}

async function start($: EngineInterface) {
  if (S.started) return
  S.started = true
  S.startedAt = await $.clock.now()
  const quietly = (fn: () => Promise<void>) => () => void fn().catch(() => {})
  $.clock.every(1000, quietly(() => refresh($)))
  $.clock.every(2000, quietly(() => pollAgents($)))
  $.clock.every(5000, quietly(() => heartbeat($)))
  $.clock.every(2000, quietly(() => readBanner($)))
  $.clock.every(2000, quietly(() => slowFacts($)))
  // The one place that redraws: ten times a second while the card moves, else when something changed.
  $.clock.every(100, () => {
    if (!S.dirty && !(S.run && !S.collapsed && isAnimating(S.run.state))) return
    S.dirty = false
    $.ui.invalidate('ui.render')
  })
  S.theme = themeFrom(await $.config.list())
  S.devCheckout = !$.plugin.root.includes('/plugins/cache/')
  S.mac = await $.session.info().then((i) => i.platform === 'macos').catch(() => false)
  S.version = String((await readJson($, `${$.plugin.root}/.claude-plugin/plugin.json`))?.version ?? '')
  await refresh($).catch(() => {})
  await readBanner($).catch(() => {})
  void slowFacts($).catch(() => {})
  if (!S.run) return
  await pollAgents($)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    S.atPrompt = e.isInteractive === true
    S.interactive = S.atPrompt || e.surface != null || (await $.session.surfaces().catch(() => [])).length > 0
    await start($).catch(() => {})
    return result
  })

  // A surface that joins later, such as the desktop app, makes the session a watched one; once the last one has left,
  // and no person is at the prompt, it is not watched any more.
  on('session.attach', async ($, e, next) => {
    S.interactive = true
    return next(e)
  })

  on('session.detach', async ($, e, next) => {
    const result = await next(e)
    S.interactive = S.atPrompt || (await $.session.surfaces().catch(() => [])).length > 0
    return result
  })

  // A turn of the main loop running; the weekly checks wait for none.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) S.turnRunning = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) { S.turnRunning = false; S.turnEndedAt = await $.clock.now().catch(() => S.turnEndedAt) }
    await countTurn($, e).catch(() => {})
    if (!e.agentId && !e.isAborted) await checkpoint($).catch(() => {})
    return result
  })

  // A prompt the person sent (not a slash command, nor one the engine or a plugin sent for them) is their reply to the approval box, if it shows.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const kind = (e as any).origin?.kind
    if (!e.isMeta && !e.command && (!kind || PERSON.includes(kind)) && !(result as any)?.drop) {
      S.repliedAt = await $.clock.now().catch(() => S.repliedAt)
      void readBanner($).catch(() => {})
    }
    return result
  })

  on('session.stop', async ($, e, next) => {
    const result = await next(e)
    if (e.isTurnRunning) await noteStopped($).catch(() => {})
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    try {
      const now = await $.clock.now()
      const reading = usageFrom(e.rateLimits, now)
      // Its own failure must not keep a subscriber's figure and gate from being written below.
      const billing = await measureSpend($, e, reading, now).catch(() => null)
      if (reading) {
        // Another session's newer and higher figure for this week stands over this session's older one.
        const file = usageFile(await lcwHome($))
        const usage = mergeUsage(await readJson($, file), reading as any)
        await $.fs.write(file, JSON.stringify(usage))
        const run = await readRun($, now)
        const gate = run && !run.gate ? gateFor(run.state, usage?.sevenDay, now) : null
        if (run && gate) await $.fs.write(run.paths.gate, JSON.stringify(gate))
      } else if (billing === 'payg') {
        const run = await readRun($, now)
        const money = run && !run.gate ? await readMoney($, run.session, run.state, null, now) : null
        const gate = money ? gateFor(run!.state, null, now, money) : null
        if (run && gate) await $.fs.write(run.paths.gate, JSON.stringify(gate))
      }
    } catch {}
    return result
  })

  on('ui.render', { component: 'AgentRow' }, ($, e, next) => {
    try {
      return S.run && S.hideRows ? next({ ...e, props: { ...e.props, isHidden: true } }) : next(e)
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      void start($).catch(() => {})
      if (S.interactive && !S.autoDone) { S.autoDone = true; void autoSetup($).catch(() => {}) }
      const run = S.run
      const shown = S.banner.shown
      const cols = e.props.bodyColumns
      const room = e.props.maxRows - TOP_GAP - (e.props.view.agentId ? 1 : 0)
      // Over a run's card the box is as wide as the card, which takes the whole width.
      let drawn = shown && !e.props.hasSurvey ? bannerRows(shown, cols, !!run) : []
      let banner = drawn
      if ((!run && !banner.length) || e.props.hasSurvey) {
        if (S.hideRows) { S.hideRows = false; S.dirty = true }
        return next(e)
      }
      const now = await $.clock.now()
      S.collapsed = e.props.isCollapsed
      const viewing = e.props.view.agentId
      let card: Row[] = []
      if (run) {
        // The mod's totals are newer than the run's copy: the turn that ran lcw finish is counted after it.
        const state = Number.isFinite(S.totals.tokens) ? { ...run.state, totals: { ...run.state.totals, agents: S.totals.agents, tokens: S.totals.tokens } } : run.state
        const view = buildView({ state, agents: S.agents, usage: run.usage, gate: run.gate, money: run.money, now, ui: S.ui })
        const tick = isAnimating(run.state) ? Math.floor((now - S.shownSince) / 100) : undefined
        // The mark box offers the raises, so the card does not also say "say run up to ...", unless the box waits for room.
        const draw = (maxRows: number, hideMarkHint: boolean) => {
          const opts = { width: cols, maxRows, theme: S.theme, frame: true, tick, hideMarkHint }
          return renderCard(view, opts)
        }
        const markBox = drawn.length > 0 && shown?.kind === 'mark'
        card = draw(room, markBox)
        // The approval box has a tight form, one row shorter, for where the full one would have to wait for room above the card.
        if (shown?.kind === 'approve' && drawn.length && room - drawn.length - 1 < Math.min(CARD_ROOM, card.length)) banner = drawn = bannerRows(shown, cols, true, true)
        // Where both do not fit, the card keeps the rows it needs (up to CARD_ROOM) and the box waits: the card
        // carries what is waiting on the person.
        if (drawn.length && room - drawn.length - 1 < Math.min(CARD_ROOM, card.length)) {
          banner = []
          if (markBox) card = draw(room, false)
        } else if (drawn.length) card = draw(room - drawn.length - 1, markBox)
      }
      if (!card.length && !banner.length) return next(e)
      // The band's focus ring is a place in its list of buttons, not a button: when the focused one goes and another
      // of this mod's takes its place, the ring stays there, so Enter would press a button of the next box the person
      // never chose. So when the box drawn changes, the band is drawn for a moment with no buttons at all, which makes
      // the engine let the focus go; ctrl+x Tab takes it again. A box drawn where none was moves no focus.
      const boxNow = banner.length ? shown!.kind + ':' + shown!.key : ''
      if (boxNow !== S.drawnBox) {
        if (S.drawnBox) S.unfocusUntil = now + UNFOCUS_MS
        S.drawnBox = boxNow
      }
      const unfocus = now < S.unfocusUntil
      if (unfocus) S.dirty = true
      const below: Row[] = viewing ? [...card, [{ t: '← back to the main conversation', c: 'accent', id: 'main' }]] : card
      const rows: Row[] = banner.length && below.length ? [...banner, [{ t: ' ' }], ...below] : [...banner, ...below]
      const hide = !S.collapsed && rows.some((row) => row.some((s) => /^(view|toggle):/.test(s.id ?? '')))
      if (hide !== S.hideRows) { S.hideRows = hide; S.dirty = true }
      S.drawnAt = now

      const press = async (id: string) => {
        if (id.startsWith('banner:')) return void (await pressBanner($, id, banner.length ? shown : null).catch(() => {}))
        if (id === 'main') await $.ui.view({})
        else if (id.startsWith('view:')) await $.ui.view({ agentId: id.slice(5) })
        else if (id.startsWith('toggle:')) {
          const agent = id.slice(7)
          if (S.ui.expanded[agent]) delete S.ui.expanded[agent]
          else S.ui.expanded[agent] = true
        } else if (id === 'more') S.ui.moreOpen = !S.ui.moreOpen
        S.dirty = true
      }

      const { Box, Text, Button, Link } = $.ui.resolve(e)
      const colour = (name?: string) => (name ? hex(S.theme, name) ?? name : undefined)
      const text = (s: Span) => (
        <Text color={colour(s.c)} backgroundColor={colour(s.bg)} weight={s.b ? 'bold' : undefined}>{String(s.t ?? '')}</Text>
      )
      const used: Record<string, number> = {}
      const keyOf = (id: string) => { used[id] = (used[id] ?? 0) + 1; return used[id] > 1 ? id + '#' + used[id] : id }
      const draw = (row: Row, i: number) => {
        const { left, gap, right } = layout(row, cols)
        const parts: Row = [...left, ...(gap ? [{ t: ' '.repeat(gap) }] : []), ...right]
        if (unfocus || !row.some((s) => s.id || s.href)) {
          return <Text key={'row' + i} wrap="truncate-end">{parts.map(text)}</Text>
        }
        return (
          <Box key={'row' + i}>
            {buttons(parts).map((g) => {
              const id = g.id
              if (id) return <Button key={keyOf(id)} plain onPress={() => press(id)}>{g.spans.map(text)}</Button>
              return g.spans.map((s) => (s.href ? <Link href={s.href} label={String(s.t ?? '')} /> : text(s)))
            })}
          </Box>
        )
      }
      return <Box flexDirection="column" marginTop={TOP_GAP}>{rows.map(draw)}</Box>
    } catch {
      return next(e)
    }
  })
}
