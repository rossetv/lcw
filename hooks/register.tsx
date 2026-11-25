import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { LcwCompletion } from '../types'

import {
  activityFile, afterFile, capFile, cleanupFile, noticesFile, proxyQuotaNoticeFile, quotaFile, runPaths, runsDir, sessionFile, sessionNames, spendCommandFile, spendDir, spendFile, spendReadingFile, updateFile, usageFile,
} from '../lib/key.mjs'
import { answerKey, bannerFor, bannerRows, limitsShort } from '../lib/banner.mjs'
import type { Banner, BannerFacts } from '../lib/banner.mjs'
import { moneyFrom, readingOf, spendFileCounts } from '../lib/spend.mjs'
import { buildView, renderCard } from '../lib/card.mjs'
import { hex, thresholds as TH } from '../lib/theme.mjs'
import { mergeUsage } from '../lib/usage.mjs'
import { atMark, stopTexts, toldFile } from '../lib/mark.mjs'
import { aliasRows, anchorName, rowsBilling, runMark, sessionPick } from '../lib/session.mjs'
import { activeQuota, CLAIM_MS, evaluateQuota, quotaOff, REFRESH_MS } from '../lib/quota.mjs'
import type { QuotaView } from '../lib/quota.mjs'
import {
  addTotals, addUsage, buttons, carryDue, carryFailed, carryPrompt, completionPrompt, countsTurn, compactInstructions, cardMotion, cardPace, gateFor, isShown, layout, measureStep,
  longNudges, nudgeable, quietCounts, reopenDue, reopenPrompt, replacesGate, resumePrompt, stallNudges, stallPrompt, themeFrom, trackAgents, usageFrom, usdWakePrompt,
  wakeable, wakeDue, wakePrompt, quotaWakeEvidence, quotaBilling, gateIdentity,
} from './lcw-mod.mjs'
import type { CardAgent, Carry, Nudged, Row, Seen, Span, Told, Totals } from './lcw-mod.mjs'
import {
  AWAKE_EVERY_MS, RUNS_EVERY_MS, awakeApplies, awakeCheckWanted, claudeCommand, dismissKeys, markSpell, pressPlan, proxyQuotaEndpoint, proxyQuotaHost, runFact, said, sameBox, spendFailingFact,
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

// What a reload of this code must not start over; a new tag makes a reload read what older code kept as absent.
const KEPT = 'kept-1'
const keptDismissed = atom({ plugin: 'lcw', key: 'dismissed' } as const, [], { shape: KEPT })
const keptReplied = atom({ plugin: 'lcw', key: 'repliedAt' } as const, 0, { shape: KEPT })
const keptTold = atom({ plugin: 'lcw', key: 'told' } as const, {}, { shape: KEPT })
const keptNudged = atom({ plugin: 'lcw', key: 'nudged' } as const, {}, { shape: KEPT })
const keptCompletion = atom({ plugin: 'lcw', key: 'completion' } as const, {}, { shape: KEPT })
const keptCarry = atom({ plugin: 'lcw', key: 'carry' } as const, null, { shape: KEPT })
const keptOwed = atom({ plugin: 'lcw', key: 'owed' } as const, null, { shape: KEPT })

// session is the session's file (the binding, its billing and its mark); money is the pay-per-token view, else null.
type Run = { runDir: string; paths: ReturnType<typeof runPaths>; state: any; gate: any; usage: any; session: any; money: any; quota: QuotaView | null }

const S = {
  started: false,
  home: '',
  run: null as Run | null,
  agents: [] as CardAgent[],
  seen: {} as Seen,
  nudged: {} as Nudged,
  told: {} as Told,
  quiet: null as { quiet: number; stalled: number } | null,
  totals: {} as Partial<Totals>,
  totalsChanged: false,
  totalsAt: 0,
  theme: 'dark' as 'dark' | 'light',
  ui: { expanded: {} as Record<string, true>, moreOpen: false },
  hideRows: false,
  collapsed: false,
  // The box's last answer held the run's card; the status line draws the card itself while mod-alive is stale.
  holdsCard: false,
  // The run whose mod-alive this process last wrote, and when.
  alive: { runDir: '', at: 0 },
  shownSince: 0,
  dirty: false,
  // What the card last showed (its view, as text, and its mode), and the step of its motion last drawn ('' still).
  shows: '',
  mode: '',
  step: '',
  wokeFor: null as string | number | null,
  quotaWaking: false,
  quotaRetry: { key: '', at: 0 },
  quotaRefresh: { revision: '', at: -Infinity, busy: false },
  proxyNotice: { host: '', file: '' },
  gateCheck: { key: '', at: -Infinity, busy: false },
  // The outside quota's reading for which the mod last asked for the run's gate to be written.
  quotaSynced: '' as string | null,
  // Whether the Claude Code owning a canonical session row was running, by row and owner, and until when that holds.
  owners: new Map<string, { until: number; open: boolean }>(),
  startedAt: 0,
  reopenChecked: false,
  // The id of the run a Resume press on the unfinished-run box takes over: no reopened session's, so no reopen prompt.
  taken: '',
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
  completion: {} as LcwCompletion,
  completionReadyAt: 0,
  completionBusy: false,
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
  // The agent limits this session runs with: undefined until read, null when they could not be.
  limits: undefined as { concurrent: number; depth: number } | null | undefined,
  setupDraft: null as { changed: boolean } | null,
  // The box last drawn ('kind:key', '' for none), and until when the band is drawn without buttons since it changed.
  drawnBox: '',
  unfocusUntil: 0,
  // When the person last sent a prompt: one sent after the Brainstorm's playback asked for approval ends that box.
  repliedAt: 0,
  // The main session's turn ended on an API error that clears on its own, as its activity record says: the tries to carry it on (carryFailed).
  carry: null as Carry | null,
  // When the main turn now running, or last run, started; after one that ended on an API error, until when its record is looked for.
  turnStartedAt: 0,
  seek: null as { since: number; until: number } | null,
  // The marker of the hook after a tool call: its file, whether it is up (undefined until looked at), and an ended session's, never raised again.
  after: { file: '', up: undefined as boolean | undefined, ended: '' },
  // A prompt that carries the run on (the reopen, the resume after a checkpoint) and has not been sent yet: see owe.
  owed: null as { runDir: string; text: string } | null,
  // A refresh has finished: until then a null run is not yet known, not none.
  refreshed: false,
  // What an earlier copy of this code kept has been read: nothing is written over it before then.
  restored: false,
}

// How often the files are looked at while the session has no run.
const IDLE_MS = 5000

const totalsFile = (runDir: string) => `${runDir}/totals.json`

// What each kept value was last written as, so it is written only when it changed.
const keptAs: Record<string, string> = {}
function changed(name: string, value: unknown) {
  if (!S.restored) return false
  const text = JSON.stringify(value)
  if (keptAs[name] === text) return false
  keptAs[name] = text
  return true
}
const unkept = (name: string) => () => { delete keptAs[name] }

function keepDismissed($: EngineInterface) {
  const dismissed = [...S.banner.dismissed]
  if (changed('dismissed', dismissed)) void update($, keptDismissed, () => dismissed).catch(unkept('dismissed'))
}

function keepReplied($: EngineInterface) {
  const at = S.repliedAt
  if (changed('repliedAt', at)) void update($, keptReplied, () => at).catch(unkept('repliedAt'))
}

function keepNotices($: EngineInterface) {
  const { told, nudged } = S
  if (changed('told', told)) void update($, keptTold, () => told).catch(unkept('told'))
  if (changed('nudged', nudged)) void update($, keptNudged, () => nudged).catch(unkept('nudged'))
}

function setCarry($: EngineInterface, carry: Carry | null) {
  S.carry = carry
  keepCarry($)
}

function keepCarry($: EngineInterface) {
  const carry = S.carry
  void $.session.id().then((session) => {
    const kept = carry && { session, carry }
    if (changed('carry', kept)) return update($, keptCarry, () => kept).catch(unkept('carry'))
  }).catch(() => {})
}

function keepOwed($: EngineInterface, owed = S.owed) {
  return $.session.id().then((session) => {
    const kept = owed && { session, ...owed }
    if (changed('owed', kept)) return update($, keptOwed, () => kept).catch(unkept('owed'))
  }).catch(() => {})
}

// What an earlier copy of this code kept, merged into what this one holds; a read that fails changes nothing.
async function restore($: EngineInterface) {
  try {
    const [dismissed, repliedAt, told, nudged, carry, session, completion, owed] = await Promise.all([
      read($, keptDismissed), read($, keptReplied), read($, keptTold), read($, keptNudged), read($, keptCarry), $.session.id(), read($, keptCompletion), read($, keptOwed),
    ])
    for (const k of dismissed) S.banner.dismissed.add(k)
    S.repliedAt = Math.max(S.repliedAt, repliedAt)
    S.told = { ...told, ...S.told }
    S.nudged = { ...nudged, ...S.nudged }
    S.completion = { ...completion, ...S.completion }
    if (!S.carry && carry?.session === session) S.carry = carry.carry
    // Owed again: it is sent only if this session still shows that run when it falls due.
    if (!S.owed && owed?.session === session) owe($, owed.runDir, owed.text)
  } catch {}
  S.restored = true
  keepDismissed($)
  keepReplied($)
  keepNotices($)
  keepCarry($)
  keepOwed($)
}

// A file is read again only when a look finds its size or time changed since it was last read; one missing is
// remembered as missing ('' its stamp). A look at a folder answers for every file in it, and any look answers again
// for LOOK_MS, so the timers that fire together and the reads within one pass share it.
const LOOK_MS = 100
// The files kept, at most HELD of them: the one read least lately goes first.
const HELD = 1000
const held = new Map<string, { stamp: string; text: string | null }>()
const looks = new Map<string, { at: number; answer: Promise<any> }>()
const gone = (err: any) => /ENOENT|ENOTDIR/.test(String(err?.code ?? '') + ' ' + String(err?.message ?? err))
const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/'))

// The answer of a look, null when the path is missing, undefined when it could not be told.
async function look<T>($: EngineInterface, key: string, take: () => Promise<T>): Promise<T | null | undefined> {
  const now = await $.clock.now()
  const kept = looks.get(key)
  if (kept && now >= kept.at && now - kept.at < LOOK_MS) return kept.answer
  const answer = take().catch((err) => (gone(err) ? null : undefined))
  // A look answers for LOOK_MS only, so the ones older than that are dropped, now and then.
  if (looks.size >= 100) for (const [k, l] of looks) if (!(now >= l.at && now - l.at < LOOK_MS)) looks.delete(k)
  looks.set(key, { at: now, answer })
  return answer
}

const folder = ($: EngineInterface, dir: string) =>
  look($, 'list:' + dir, () => $.fs.list(dir).then((entries) => new Map(entries.map((f) => [f.name, f]))))

// What was written, by the mod or a process it ran, is seen at the next read, not after a look answers again.
function forget(path?: string) {
  if (!path) return looks.clear()
  held.delete(path)
  looks.delete('list:' + folderOf(path))
  looks.delete('stat:' + path)
}

function write($: EngineInterface, path: string, text: string) {
  forget(path)
  return $.fs.write(path, text).finally(() => forget(path))
}

// A file's size and time, '' when it is missing, undefined when they cannot be told (it is then read every time).
async function stampOf($: EngineInterface, path: string) {
  const dir = folderOf(path)
  // The sessions folder keeps a file for every session there was: one file's stat is less than its listing.
  if (dir !== `${S.home}/sessions`) {
    const files = await folder($, dir)
    if (files === null) return ''
    const f = files?.get(path.slice(dir.length + 1))
    if (files && !f) return ''
    if (f?.kind === 'file') return f.size + ':' + f.mtimeMs
  }
  const stat = await look($, 'stat:' + path, () => $.fs.stat(path))
  return stat ? stat.size + ':' + stat.mtimeMs : stat === null ? '' : undefined
}

async function readText($: EngineInterface, path: string) {
  const stamp = await stampOf($, path)
  const kept = held.get(path)
  held.delete(path)
  if (stamp !== undefined && kept?.stamp === stamp) { held.set(path, kept); return kept.text }
  const text = stamp === '' ? null : await $.fs.read(path).then(String, () => null)
  if (stamp !== undefined) held.set(path, { stamp, text })
  if (held.size > HELD) held.delete(held.keys().next().value!)
  return text
}

const readJson = ($: EngineInterface, path: string) =>
  readText($, path).then((text) => (text === null ? null : JSON.parse(text))).catch(() => null)

async function lcwHome($: EngineInterface) {
  if (!S.home) S.home = (await $.env.get('LCW_HOME')) || `${await $.env.get('HOME')}/.lcw`
  return S.home
}

// The canonical row a session's own row points at, when it may be used: not a stranger's, and not one whose owner is
// another Claude Code still running. Null otherwise.
async function lentAnchor($: EngineInterface, id: string, session: any) {
  const home = await lcwHome($)
  const canonical = session?.sessionCanonicalId
  if (typeof canonical !== 'string' || !/^[\w.-]{1,256}$/.test(canonical) || /^\.+$/.test(canonical) || canonical === id) return null
  const anchor = await readJson($, sessionFile(home, canonical))
  if (anchor?.sessionCanonicalId !== canonical) return null
  const pid = Number(session?.claudePid) || Number(await $.env.get('CLAUDE_PID'))
  if (Number.isInteger(anchor.claudePid) && anchor.claudePid > 1 && anchor.claudePid !== pid) {
    const key = id + ':' + canonical + ':' + anchor.claudePid
    const now = await $.clock.now()
    // The owner's answer holds for five seconds either way: each read of the session would run ps again.
    const kept = S.owners.get(key)
    if (kept && kept.until > now) return kept.open ? null : anchor
    // ps is not available on every host; an unknown owner never lends its mark.
    const r = await $.process.run(['ps', '-p', String(anchor.claudePid), '-o', 'pid='], { timeoutMs: 1000 }).catch(() => null)
    const open = r?.exitCode !== 1 || !!String(r.stdout ?? '').trim() || !!String(r.stderr ?? '').trim()
    S.owners.set(key, { until: now + 5000, open })
    if (open) return null
  }
  return anchor
}

async function readSession($: EngineInterface, id: string) {
  const home = await lcwHome($)
  const session = await readJson($, sessionFile(home, id))
  const anchor = await lentAnchor($, id, session)
  if (!anchor) return session
  return {
    ...session, markPercent: anchor.markPercent, markUsd: anchor.markUsd,
    billing: typeof anchor.billing === 'string' || anchor.quotaSelection ? anchor.billing : session?.billing,
    ...(Object.prototype.hasOwnProperty.call(anchor, 'quotaSelection') ? { quotaSelection: anchor.quotaSelection, quotaDefaultBilling: anchor.quotaDefaultBilling } : {}),
  }
}

// The run bound to this session, or to the session row named id, or null. A state.json caught mid-write throws, keeping the last one.
async function readRun($: EngineInterface, now: number, id?: string): Promise<Run | null> {
  const home = await lcwHome($)
  const self = id ?? await $.session.id()
  const binding = await readSession($, self)
  if (!binding?.runDir) return null
  const paths = runPaths(binding.runDir)
  const text = await readText($, paths.state)
  if (text === null) return null
  let state = JSON.parse(text)
  if (!isShown(state, now)) return null
  const session = state.driver && state.driver !== self
    ? await readSession($, state.driver) : binding
  state = { ...state, markPercent: session?.markPercent ?? (session?.markUsd != null ? TH.usageMarkPercent : state.markPercent) }
  const quota = await readQuota($, session, state.markPercent ?? TH.usageMarkPercent, now)
  return {
    runDir: binding.runDir, paths, state, gate: await readJson($, paths.gate), usage: quota ? null : await readJson($, usageFile(home)), session, money: null, quota,
  }
}

async function readQuota($: EngineInterface, session: any, mark: number, now: number) {
  const home = await lcwHome($)
  const state = await readJson($, quotaFile(home))
  if (activeQuota(state) && session?.quotaSelection?.sourceId === state.sourceId && session?.quotaSelection?.endpoint === state.endpoint) {
    const last = S.quotaRefresh
    const due = !Number.isFinite(state.lastAttemptAt) || now - state.lastAttemptAt >= REFRESH_MS
    const claimed = state.claim?.revision === state.revision && now - state.claim.startedAt < CLAIM_MS
    if (due && !claimed && (last.revision !== state.revision || !last.busy && now - last.at >= REFRESH_MS)) {
      const request = { revision: state.revision, at: now, busy: true }
      S.quotaRefresh = request
      void $.process.run(['node', `${$.plugin.root}/scripts/quota-refresh.mjs`], { timeoutMs: 35000, env: { LCW_HOME: home } })
        .then((r) => { if (r.exitCode !== 0) request.at = now - REFRESH_MS + 5000 })
        .catch(() => { request.at = now - REFRESH_MS + 5000 })
        .finally(() => { request.busy = false })
    }
  }
  return evaluateQuota(session?.quotaSelection, state, now, mark)
}

// The agent limits this session runs with, for the box that offers to raise them: read once, since they hold for the
// session. Null when they are enough, so a session with room reads no setting for it.
async function limitsFact($: EngineInterface): Promise<BannerFacts['limits']> {
  if (S.limits === undefined) S.limits = await $.agent.limits().then((l) => ({ concurrent: l.concurrent, depth: l.depth })).catch(() => null)
  if (!S.limits || !limitsShort(S.limits)) return null
  const env = await $.settings.read({ key: 'env', source: 'user' }).catch(() => undefined)
  return { ...S.limits, env: env && typeof env === 'object' ? env as Record<string, unknown> : null }
}

// The name a session's spend is kept under: its transcript's, which a resumed session keeps and the status line
// goes by too, else its id. One session kept under two names would count its dollars twice.
async function spendName($: EngineInterface) {
  return (await transcriptName($)) ?? await $.session.id()
}

// The base name of the session's transcript, null when it has none. Asked as a look, so the money views and the
// timers that fire together share one answer.
async function transcriptName($: EngineInterface) {
  const path = await look($, 'info', () => $.session.info().then((i) => i.transcriptPath).catch(() => ''))
  return path ? path.split(/[\\/]/).pop()!.replace(/\.jsonl$/, '') : null
}

// The money view for a session billed per token, else null: the machine's spend from every session's record, the
// cap, the session's mark, the run's own spend (this session's cost so far is its record's highest reading), and
// the next try from a dollar gate. Nothing in ~/.lcw/spend is read for any other session.
async function readMoney($: EngineInterface, session: any, state: any, gate: any, now: number) {
  const quota = await readQuota($, session, state?.markPercent ?? session?.markPercent ?? TH.usageMarkPercent, now)
  if (quotaBilling(session, quota) !== 'payg') return null
  const spend = await spendFacts($, now)
  const own = spend.records[spend.names.indexOf(`${await spendName($)}.json`)]
  const money: any = moneyFrom({ records: spend.records.filter(Boolean), cap: spend.cap, reading: spend.reading, session: { ...session, billing: 'payg' }, state, sessionCum: own?.max, now })
  return gate?.unit === 'usd' ? { ...money, retryAt: gate.retryAt, retried: !!gate.retried } : money
}

// What the money view counts: every spend record still in the 7 days (and the file names they came from), the cap
// and the spend command's reading.
async function spendFacts($: EngineInterface, now: number) {
  const home = await lcwHome($)
  const dir = spendDir(home)
  const names = [...((await folder($, dir))?.values() ?? [])]
    .filter((f) => f.kind === 'file' && f.name.endsWith('.json') && spendFileCounts(f.mtimeMs, now)).map((f) => f.name)
  return {
    names,
    records: await Promise.all(names.map((name) => readJson($, `${dir}/${name}`))),
    cap: await readJson($, capFile(home)),
    // Read only: the spend command is run by the scripts, never by the mod.
    reading: readingOf(await readJson($, spendCommandFile(home)), await readJson($, spendReadingFile(home))),
  }
}

// The facts the usage mark is judged by, as the files stand when it is called, whatever the timers last saw (a look
// of the last LOOK_MS stands for now): this session's row, mark, outside quota and money view, the week's figure, and
// the run shown with its driver's row, mark, quota and money. A file is read only if it changed since its last read.
async function markFacts($: EngineInterface) {
  const now = await $.clock.now()
  const session = await readSession($, await $.session.id())
  const mark: number = session?.markPercent ?? TH.usageMarkPercent
  const quota = await readQuota($, session, mark, now)
  const usage = await readJson($, usageFile(await lcwHome($)))
  const money = await readMoney($, session, null, null, now)
  const run = await readRun($, now)
  if (run) run.money = await readMoney($, run.session, run.state, run.gate, now)
  return { now, session, mark, quota, usage, money, run }
}

// Whether a prompt was sent: one the engine or a hook drops (a Stop stands, a host limit reached) was not.
const submit = ($: EngineInterface, prompt: { text: string }) =>
  $.prompt.submit(prompt).then((r) => !r?.drop).catch(() => false)

// Deferred: a prompt submitted from inside session.start may not land.
const submitSoon = ($: EngineInterface, text: string) =>
  new Promise<boolean>((resolve) => void $.clock.after(700, () => void submit($, { text }).then(resolve)))

// How long after a prompt that was not sent it is tried again.
const RETRY_MS = 30000
const retryLater = ($: EngineInterface, fn: () => void) => void $.clock.after(RETRY_MS, fn)

// A prompt that carries the run on, tried again until sent while this session drives the run; the person's own takes over.
function owe($: EngineInterface, runDir: string, text: string, wait = 700) {
  const owed = { runDir, text }
  S.owed = owed
  keepOwed($)
  const due = () => void (async () => {
    if (S.owed !== owed) return
    if (!S.refreshed) return void $.clock.after(700, due)
    if (S.run?.runDir !== runDir) { S.owed = null; keepOwed($); return }
    const sent = await submit($, { text })
    if (S.owed !== owed) return
    if (sent) { S.owed = null; keepOwed($) } else owe($, runDir, text, RETRY_MS)
  })()
  $.clock.after(wait, due)
}

// Notices that were not sent are taken off the record, where no later poll has changed it, so they fall due again.
function unsay($: EngineInterface, stall: { due: { id: string }[]; nudged: Nudged }, was: Nudged, long: { id: string }[]) {
  const nudged = { ...S.nudged }
  for (const a of stall.due) {
    const before = was[a.id]
    if (nudged[a.id] !== stall.nudged[a.id]) continue
    if (before) nudged[a.id] = before
    else delete nudged[a.id]
  }
  const told = { ...S.told }
  for (const a of long) delete told[a.id]
  S.nudged = nudged
  S.told = told
  keepNotices($)
}

// Whether the gate was put right; null when nothing was run: another check is under way, or this one ran under 5 s ago.
async function reconcileGate($: EngineInterface, run: Run, action: 'sync' | 'retry' | 'ack') {
  const now = await $.clock.now()
  const key = run.runDir + ':' + action + ':' + gateIdentity(run.gate)
  if (S.gateCheck.busy || S.gateCheck.key === key && now - S.gateCheck.at < 5000) return null
  const check = { key, at: now, busy: true }
  S.gateCheck = check
  try {
    const q = run.quota
    const expectedQuota = q ? { sourceId: q.sourceId, revision: q.revision, requestId: q.requestId, accountKey: q.accountKey, resetsAt: q.resetsAt, observedAt: q.observedAt } : undefined
    const payload = { sessionId: run.state.driver || await $.session.id(), action, expectedGate: run.gate, ...(expectedQuota ? { expectedQuota } : {}) }
    const r = await $.process.run(['node', `${$.plugin.root}/scripts/gate-reconcile.mjs`, JSON.stringify(payload)], { timeoutMs: 10000, env: { LCW_HOME: await lcwHome($) } })
    return r.exitCode === 0 && JSON.parse(String(r.stdout)).ok === true
  } catch { return false } finally { check.busy = false; forget() }
}

async function recoveryProof($: EngineInterface, run: Run, now: number) {
  if (!run.gate) return null
  if (run.quota) return quotaWakeEvidence(run.gate, run.quota, now)
  if (run.gate.unit === 'quota' && run.session?.quotaSelection !== null && !quotaOff(await readJson($, quotaFile(await lcwHome($))))) return null
  const money = await readMoney($, run.session, run.state, run.gate, now)
  run.money = money
  if (run.gate.unit !== 'quota' && !wakeDue(run.gate, now, null, quotaBilling(run.session, null))) return null
  if (usageFact({ state: run.state, session: run.session, usage: run.usage, money, now }).atMark) return null
  return { gate: gateIdentity(run.gate), evidence: JSON.stringify(['default', quotaBilling(run.session, null), run.usage?.sevenDay, money?.spentUsd, money?.markUsd]) }
}

async function recoverQuota($: EngineInterface, run: Run, now: number) {
  if (!wakeable(run.state)) return
  const proof = await recoveryProof($, run, now)
  const key = run.runDir + ':' + proof?.gate
  if (!proof || S.quotaWaking || S.wokeFor === key || S.quotaRetry.key === key && now < S.quotaRetry.at) return
  S.quotaWaking = true
  try {
    const ackFile = `${run.runDir}/quota-woke`
    if ((await readJson($, ackFile))?.gate === proof.gate) { S.wokeFor = key; S.quotaWaking = false; return }
    // A binding left behind when another open session took the run over: that session wakes it, not this one too.
    // Looked at again only after a while: the other session may stay open for days, and each look runs ps.
    if (await driverOpen($, run.state.driver)) { S.quotaRetry = { key, at: now + RETRY_MS }; S.quotaWaking = false; return }
    $.clock.after(700, () => void (async () => {
      const at = await $.clock.now()
      const current = await readRun($, at)
      const fresh = current && await recoveryProof($, current, at)
      if (!current || !wakeable(current.state) || current.runDir !== run.runDir || !fresh || fresh.gate !== proof.gate) return
      // Another session may have woken the run while this one waited.
      if ((await readJson($, ackFile))?.gate === proof.gate) { S.wokeFor = key; return }
      const own = await readSession($, await $.session.id())
      const quota = await readQuota($, own, own?.markPercent ?? TH.usageMarkPercent, at)
      const money = await readMoney($, own, null, null, at)
      const usage = await readJson($, usageFile(await lcwHome($)))
      if (usageFact({ session: own, quota, money, usage, now: at }).atMark) return
      const why = current.quota ? 'a fresh subscription quota reading allows work below your mark'
        : current.gate.unit === 'quota' ? 'external quota was disabled; the default source allows work below your mark'
        : current.gate.unit === 'usd' ? 'the 7-day spend is back under your mark' : 'the weekly usage limit has reset'
      S.quotaRetry = { key, at: at + (current.quota || current.gate.unit === 'quota' ? 5000 : RETRY_MS) }
      const text = !current.quota && current.gate.unit !== 'quota'
        ? current.gate.unit === 'usd' ? usdWakePrompt($.plugin.root, current.money?.markUsd ?? null) : wakePrompt($.plugin.root)
        : `LCW: ${why}. Run \`node "${$.plugin.root}/scripts/lcw.mjs" resume\`, then \`node "${$.plugin.root}/scripts/lcw.mjs" status\`, and carry on from the ledger.`
      if (!(await submit($, { text }))) return
      S.wokeFor = key
      await write($, ackFile, JSON.stringify(fresh))
      await reconcileGate($, current, 'ack')
    })().catch(() => {}).finally(() => { S.quotaWaking = false }))
  } catch { S.quotaWaking = false }
}

function cardView(run: Run, now: number) {
  // The mod's totals are newer than the run's copy: the turn that ran lcw finish is counted after it.
  const state = Number.isFinite(S.totals.tokens) ? { ...run.state, totals: { ...run.state.totals, agents: S.totals.agents, tokens: S.totals.tokens } } : run.state
  return buildView({ state, agents: S.agents, usage: run.usage, gate: run.gate, money: run.money, quota: run.quota, now, ui: S.ui })
}

// An agent that waits (at a permission prompt, say), or has finished and is still listed, leaves the run waiting on the person.
const working = () => S.turnRunning || S.agents.some((a) => (a.status === 'running' || a.status === 'pending') && !a.held)

// The step of the card's motion at now, '' while it holds still.
const stepAt = (pace: number, now: number) => (pace ? pace + ':' + cardMotion(pace, S.shownSince, now).step : '')

// The card is redrawn when what it shows has changed: what was read, and the times it gives, which move with the clock.
function noteCard(now: number) {
  const view = S.run ? cardView(S.run, now) : null
  const shows = JSON.stringify(view)
  S.mode = view?.mode ?? ''
  if (shows !== S.shows) { S.shows = shows; S.dirty = true }
}

async function refresh($: EngineInterface) {
  const now = await $.clock.now()
  const own = await readSession($, await $.session.id())
  await readQuota($, own, own?.markPercent ?? TH.usageMarkPercent, now)
  const run = await readRun($, now)
  // Before the run is shown: a card drawn without its money view would count percentages.
  if (run) run.money = await readMoney($, run.session, run.state, run.gate, now)
  if (!run && !S.run) { S.refreshed = true; return }
  // The first run this process sees is judged once, by mod-alive as it stood before this process drew it.
  const firstSight = !!run && !S.reopenChecked
  if (firstSight) S.reopenChecked = true
  const aliveAt = firstSight && run ? Number(await readText($, run.paths.modAlive)) : 0
  if (!S.run || S.run.runDir !== run?.runDir) {
    S.shownSince = now
    S.totals = (run && (await readJson($, totalsFile(run.runDir)))) || {}
    S.totalsChanged = false
    S.quiet = null
  }
  S.run = run
  S.refreshed = true
  noteCard(now)
  if (!run) {
    S.agents = []
    S.seen = {}
    S.nudged = {}
    S.told = {}
    keepNotices($)
    S.hideRows = false
    return
  }
  if (firstSight) {
    await write($, run.paths.modAlive, String(now)).catch(() => {})
    // Within ten seconds of start: the session-start hook that binds a resumed session can run after us.
    if (now - S.startedAt <= 10000 && run.state.id !== S.taken && !run.quota?.hold && reopenDue(run.state, run.gate, aliveAt, now) && !(await driverOpen($, run.state.driver))) owe($, run.runDir, reopenPrompt($.plugin.root))
  }
  if (run.gate?.unit === 'usd' && !run.quota && wakeable(run.state) && run.money?.atMark && wakeDue(run.gate, now, null, quotaBilling(run.session, null))) {
    await reconcileGate($, run, 'retry')
    return
  }
  // An outside quota that comes to hold the run is written as its gate at once, as a week's figure is at a measure:
  // tried once for each reading (a check that could not start yet is tried at the next look), a gate already holding
  // for it left alone, and none for a run the person paused.
  const q = run.quota
  const s = run.state
  const reading = q && JSON.stringify([run.runDir, q.revision, q.requestId, q.status, q.code])
  if (q?.hold && reading !== S.quotaSynced && (run.gate?.unit !== 'quota' || run.gate.recoveredBy)
    && !['finished', 'stopped'].includes(s.status) && !(s.status === 'paused' && s.pausedReason === 'human')) {
    if ((await reconcileGate($, run, 'sync')) !== null) S.quotaSynced = reading
    return
  }
  await recoverQuota($, run, now)
}

async function pollAgents($: EngineInterface) {
  const run = S.run
  if (!run) return
  const list = await $.agent.list()
  const now = await $.clock.now()
  const tracked = trackAgents(list, S.seen, now)
  S.agents = tracked.agents
  S.seen = tracked.seen
  noteCard(now)
  // The mascot beside the status rows shows trouble with agents. It cannot ask the mod, so the count of quiet
  // and stalled agents is left in the run's folder, written when it changes.
  const quiet = quietCounts(S.agents)
  if (quiet.quiet !== S.quiet?.quiet || quiet.stalled !== S.quiet?.stalled) {
    S.quiet = quiet
    await write($, run.paths.quiet, JSON.stringify({ ...quiet, at: now })).catch(() => {})
  }
  // An agent that has stalled, or been long at work, is the orchestrator's to look at: tell the main loop, which acts
  // once it is idle. Who was told of long work is kept through a pause, so nobody is told twice.
  if (nudgeable(run.state)) {
    const was = S.nudged
    const stall = stallNudges(S.agents, S.nudged, now)
    S.nudged = stall.nudged
    const long = longNudges(S.agents, S.told)
    S.told = long.told
    const due = [...stall.due, ...long.due]
    // Recorded before it is sent, since the next poll may come first; taken off the record later if it was not sent.
    if (due.length) void submitSoon($, stallPrompt(due, S.agents)).then((sent) => sent || retryLater($, () => unsay($, stall, was, long.due)))
  } else S.nudged = {}
  keepNotices($)
  const totals = addTotals(S.totals, list, run.state.createdAt ?? 0)
  if (totals.agents !== S.totals.agents || totals.tokens !== S.totals.tokens) S.totalsChanged = true
  S.totals = totals
  // At most every five seconds; a change made in between is written on a later poll.
  if (S.totalsChanged && now - S.totalsAt >= 5000) {
    await write($, totalsFile(run.runDir), JSON.stringify(totals))
    S.totalsChanged = false
    S.totalsAt = now
  }
  await assessCompletion($)
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
  await write($, totalsFile(run.runDir), JSON.stringify(totals))
}

// A file's text and what it parses to: missing is null; caught mid-write (it does not parse) is undefined.
async function readParsed($: EngineInterface, path: string) {
  const text = await readText($, path)
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
  const control = await readSession($, id)
  const quota = await readQuota($, control, control?.markPercent ?? TH.usageMarkPercent, now)
  const step = measureStep(control, rec, { weekly: quota ? null : reading, cost: e.cost?.usd, quota }, now)
  if ((step.changed || control?.billing !== session?.billing) && session !== undefined) await write($, sessionFile(home, id), JSON.stringify({ ...session, billing: step.billing }))
  // The canonical row is the one readers take first, so the billing settled here must reach it too.
  if (step.billing !== 'unclear' && session) {
    const anchor = await lentAnchor($, id, session)
    if (anchor && anchor.billing !== step.billing) await write($, sessionFile(home, anchor.sessionCanonicalId), JSON.stringify({ ...anchor, billing: step.billing }))
  }
  if (step.drop) await $.process.run(['rm', '-f', spent]).catch(() => {}).finally(() => forget(spent))
  // A record caught mid-write is left for the next reading rather than started again from this one.
  if (step.record && rec !== undefined) await write($, spent, JSON.stringify(step.record))
  return step.billing
}

const lcwCli = ($: EngineInterface) => `${$.plugin.root}/scripts/lcw.mjs`

// Every fact the boxes are chosen from. The cheap files are looked at here, every 2 s with a run and every 5 s without;
// the run is refresh's, and the repository's runs and the sleep check are slowFacts', at their own pace.
async function gather($: EngineInterface, now: number): Promise<BannerFacts> {
  const home = await lcwHome($)
  // The run is the one the card shows, so the box and the card tell the same story. With one, the facts of the mark
  // are the run's, which the refresh has read: of this session's own only its row is needed.
  const run = S.run
  const [advisorModel, statusLine, own, cap, command, reading, notices, update, cleanup] = await Promise.all([
    $.settings.read({ key: 'advisorModel' }).catch(() => 'unread'),
    // The user settings file alone: the one Put LCW's back writes.
    $.settings.read({ key: 'statusLine', source: 'user' }).catch(() => undefined),
    run ? $.session.id().then((id) => readSession($, id)).then((session) => ({ session, quota: null, usage: null, money: null })) : markFacts($),
    readJson($, capFile(home)),
    readJson($, spendCommandFile(home)),
    readJson($, spendReadingFile(home)),
    readJson($, noticesFile(home)),
    readJson($, updateFile(home)),
    S.repoKey ? readJson($, cleanupFile(home, S.repoKey)) : null,
  ])
  const session = own.session
  const money = run ? run.money : own.money
  const runF = runFact(run?.state, S.sleep?.kept)
  const asked = runF?.asks?.length ? answerKey(runF) : ''
  const quota = run ? run.quota : own.quota
  const week = usageFact({ state: run?.state, session: run?.session ?? session, usage: run ? run.usage : own.usage, money, quota, now })
  const endpoint = proxyQuotaEndpoint(await $.env.get('ANTHROPIC_BASE_URL'), await readJson($, quotaFile(home)), session, run?.session)
  const host = endpoint ? proxyQuotaHost(endpoint) : ''
  if (host && S.proxyNotice.host !== host) {
    const file = await proxyQuotaNoticeFile(home, host).catch(() => '')
    S.proxyNotice = { host: file ? host : '', file }
  }
  const file = host && S.proxyNotice.host === host ? S.proxyNotice.file : ''
  const choice = file ? await readJson($, file) : null
  const proxyQuota = file && !(choice?.host === host && ['setup', 'keep', 'dismiss'].includes(choice?.choice)) ? {
    host, key: file.slice(file.lastIndexOf('/') + 1, -5),
    canSetup: !S.turnRunning && !S.compacting && !S.carry && !S.owed && !week.atMark && (!run || ['finished', 'stopped'].includes(run.state.status)),
  } : null
  // When the week reached the mark, until it has been below it for a minute: a climb back is another occurrence of the mark box.
  S.mark = markSpell(S.mark, week.atMark, now)
  return {
    now, mac: S.mac, billing: quotaBilling(run?.session ?? session, quota), advisorModel, advisorFlag: !!session?.advisorFlag, capSet: Number(cap?.usd) > 0,
    spendCommandSet: !!command?.command, notices, proxyQuota, dismissed: S.banner.dismissed, repoKey: S.repoKey ?? undefined,
    run: runF,
    usage: { ...week, since: S.mark.since || undefined },
    spendFailing: spendFailingFact(readingOf(command, reading)),
    unfinished: run ? null : S.unfinished,
    sleep: run && awakeApplies(run.state) ? S.sleep : null,
    // Without its own version the mod cannot tell an update applied from one waiting for a restart.
    update: S.version ? { running: S.version, available: update?.available ?? null, updated: update?.updated ?? null, devCheckout: S.devCheckout } : null,
    statusLine: statusLineFact(statusLine, home),
    cleanup: cleanup?.at && cleanup?.title ? cleanup : null,
    limits: await limitsFact($),
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
  const entries = [...((await folder($, dir))?.values() ?? [])].filter((f) => f.kind === 'dir')
  const seen: RunSeen[] = []
  for (const f of entries) {
    const paths = runPaths(`${dir}/${f.name}`)
    if (S.closedRuns.has(paths.dir)) continue
    const state = await readJson($, paths.state)
    if (state?.status === 'finished' || state?.status === 'stopped') S.closedRuns.add(paths.dir)
    if (!state?.id || state.status === 'finished' || state.status === 'stopped') continue
    const files = await folder($, paths.dir)
    const time = (name: string) => files?.get(name)?.mtimeMs ?? 0
    const drawn = Number(String((await readText($, paths.modAlive)) ?? '').trim()) || 0
    seen.push({ dir: paths.dir, state, shownAt: Math.max(drawn, time('state.json'), time('ledger.md')) })
  }
  for (const c of unfinishedCandidates(seen, now, S.run?.runDir, S.banner.dismissed)) {
    if (await driverOpen($, c.state.driver)) continue
    S.unfinished = unfinishedFact(c, (await readText($, runPaths(c.dir).ledger)) ?? '')
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

// A successful main turn must have been observed; a reload alone is not evidence that the driver is idle.
async function assessCompletion($: EngineInterface) {
  const idleAt = S.completionReadyAt
  const blocked = () => !idleAt || S.completionReadyAt !== idleAt || S.turnRunning || S.compacting || !!S.carry || !!S.owed || S.pressing
  if (!S.restored || S.completionBusy || !S.run || blocked()) return
  S.completionBusy = true
  try {
    const now = await $.clock.now()
    if (now - idleAt < RETRY_MS) return
    const run = await readRun($, now)
    if (!run || S.run?.runDir !== run.runDir) return
    const s = run.state
    if (s.status !== 'running' || s.stage !== 'Ship' || s.shape === 'sweep' || s.driver !== await $.session.id()) return
    if (s.asks?.length || s.questions?.some((q: any) => !q.used) || !s.tasks?.length || s.tasks.some((t: any) => !['done', 'dropped'].includes(t.status))) return
    const last = S.completion[run.runDir]
    if (last && (last.sent || last.tries >= 3 || now - last.at < RETRY_MS)) return
    if (run.gate || run.quota?.hold || run.quota?.blocked) return
    const money = await readMoney($, run.session, s, run.gate, now)
    if (usageFact({ state: s, session: run.session, usage: run.usage, money, quota: run.quota, now }).atMark) return
    if (String((await readText($, run.paths.checkpoint)) ?? '').trim() || (await draft($)) !== '') return
    const agents = await $.agent.list()
    if (agents.some((a) => ['pending', 'running', 'waiting'].includes(a.status)) || blocked()) return
    forget()
    const fresh = await readRun($, await $.clock.now())
    const snapshot = (r: Run) => JSON.stringify([r.runDir, r.state, r.session, r.gate, r.quota, r.usage])
    if (!fresh || snapshot(fresh) !== snapshot(run) || blocked()) return
    // Claim before submitting: the assessment's own turn must never wake another assessment, even after a reload.
    const notice = { at: now, tries: (last?.tries ?? 0) + 1, sent: true }
    S.completion = { ...S.completion, [run.runDir]: notice }
    let attempted = false
    try {
      await update($, keptCompletion, () => S.completion)
      const at = await $.clock.now()
      const currentMoney = await readMoney($, run.session, s, run.gate, at)
      const currentAgents = await $.agent.list()
      if (currentAgents.some((a) => ['pending', 'running', 'waiting'].includes(a.status))) return
      if (String((await readText($, run.paths.checkpoint)) ?? '').trim()) return
      forget()
      const current = await readRun($, await $.clock.now())
      if (!current || snapshot(current) !== snapshot(run)) return
      if (usageFact({ state: current.state, session: current.session, usage: current.usage, money: currentMoney, quota: current.quota, now: at }).atMark) return
      if ((await draft($)) !== '' || blocked()) return
      attempted = true
      if (!(await submit($, { text: completionPrompt($.plugin.root) }))) {
        notice.sent = false
        await update($, keptCompletion, () => S.completion)
      }
    } finally {
      if (!attempted) {
        if (last) S.completion[run.runDir] = last
        else delete S.completion[run.runDir]
        await update($, keptCompletion, () => S.completion)
      }
    }
  } finally {
    S.completionBusy = false
  }
}

// A try to carry the session on after an API error, once it falls due. Notifications start turns by themselves, and
// the person may have stepped in, so all is checked again right before it is sent: a try never lands in a working
// session or over a draft. A turn that ends well, or a prompt the person sends, has already ended the carry-on.
async function carryOn($: EngineInterface) {
  const c = S.carry
  if (!c || c.dueAt == null) return
  const now = await $.clock.now()
  if (now < c.dueAt) return
  const typed = (await draft($)) !== ''
  if (S.carry !== c) return
  const paused = S.run?.state?.status === 'paused'
  const step = carryDue(c, now, typed || paused || S.turnRunning)
  setCarry($, step.carry ?? null)
  if (!step.send) return
  const sent = S.carry
  if (!(await submit($, { text: carryPrompt(c.kind, step.send) })) && S.carry === sent) {
    setCarry($, carryFailed(sent, c.kind, await $.clock.now()))
  }
}

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
  if (!(await submit($, { text }))) S.weeklyText = text
}

// LCW's status rows and attribution off, by themselves, on a watched session's first draw.
async function autoSetup($: EngineInterface) {
  const r = await $.process.run(['node', `${$.plugin.root}/scripts/setup.mjs`, 'auto']).catch(() => null)
  if (r?.exitCode !== 0) return
  for (const line of String(r.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) $.ui.toast(line, { timeoutMs: 8000 })
}

// Answer now: the oldest open ask's number at the start of the prompt, keeping what is typed there; a draft
// that already starts with a number answers that ask and is left as typed.
async function fillAnswer($: EngineInterface, n: number | undefined) {
  if (!Number.isFinite(n)) return false
  const head = `${n}: `
  const typed = (await $.prompt.read().catch(() => ({ text: '' }))).text ?? ''
  const filled = await $.prompt.fill({ text: /^\d+:\s/.test(typed) ? typed : head + typed }).catch(() => null)
  return !!filled?.isFilled
}

// A button's reply put in the prompt, never sent. Only into an empty prompt: a draft the person typed is
// neither replaced nor added to, and they are told to type the reply themselves.
async function fillReply($: EngineInterface, text: string, setup?: Banner) {
  const watch = setup ? { changed: false } : null
  if (watch) S.setupDraft = watch
  try {
    let typed = await draft($)
    if (typed === '' && setup) {
      // The final draft read can outlast a control change; take a bounded snapshot after each read.
      for (let pass = 0; pass < 2; pass++) {
        forget()
        await refresh($).catch(() => {})
        const facts = await gather($, await $.clock.now())
        if (!sameBox(setup, S.interactive ? bannerFor(facts) : null, 'setup') || !facts.proxyQuota?.canSetup || watch?.changed || S.turnRunning || S.compacting || S.carry || S.owed) {
          $.ui.toast('The draft, connection or session controls changed. Nothing was filled; try setup again when this session is idle.')
          return false
        }
        if (pass === 0) typed = await draft($)
        if (typed !== '') break
      }
    }
    if (typed !== '') {
      $.ui.toast(`Your prompt has text in it. Clear it and press the button again, or type "${text.trim()}" yourself.`, { timeoutMs: 10000 })
      return false
    }
    const filled = await $.prompt.fill({ text }).catch(() => null)
    if (!filled?.isFilled) $.ui.toast(`LCW could not fill your prompt. Type "${text.trim()}" there and press Enter.`, { timeoutMs: 10000 })
    return !!filled?.isFilled
  } finally {
    if (watch && S.setupDraft === watch) S.setupDraft = null
  }
}

// A press's plan carried out: its commands in order (the first that fails says why and the box stays), then the
// prompt owed to the run, the prompt (one that cannot be sent keeps the box), the notices, the fill, and the box hidden for this occurrence.
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
  if (plan.steps?.length) forget()
  // A prompt still owed to the run (a reopen, a resume) is sent with it, not dropped for it.
  if (plan.owe && S.run) owe($, S.run.runDir, S.owed?.runDir === S.run.runDir ? S.owed.text + '\n\n' + plan.owe : plan.owe, 0)
  if (plan.prompt) {
    if (!(await submit($, plan.prompt))) return $.ui.toast(plan.promptFailed ?? 'Clear the prompt or wait for the turn to end, then press it again.')
  }
  if (plan.notices) {
    const file = noticesFile(await lcwHome($))
    await write($, file, JSON.stringify({ ...((await readJson($, file)) || {}), ...plan.notices }))
  }
  if (plan.fillText !== undefined && !(await fillReply($, plan.fillText, plan.proxyQuotaChoice?.choice === 'setup' ? banner : undefined))) return
  if (plan.proxyQuotaChoice) {
    try {
      const { host, choice } = plan.proxyQuotaChoice
      const file = S.proxyNotice.host === host ? S.proxyNotice.file : await proxyQuotaNoticeFile(await lcwHome($), host)
      await write($, file, JSON.stringify({ host, choice }))
    } catch {
      return $.ui.toast('LCW could not remember this choice. The setup offer stays available; try again.', { timeoutMs: 10000 })
    }
  }
  if ('fill' in plan && !(await fillAnswer($, plan.fill))) {
    S.banner.answerFill = String(banner.key)
    S.dirty = true
    return
  }
  if (plan.dismiss) {
    for (const k of dismissKeys(banner)) S.banner.dismissed.add(k)
    keepDismissed($)
  }
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
  let later = false
  try {
    forget()
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
    // Before its steps run: a refresh may see the run bound before the press has finished.
    if (kind === 'unfinished' && option === 'resume') S.taken = String(facts.unfinished?.id ?? '')
    if (plan?.working) {
      // A press is given ten seconds, and a clean-up or an update can take minutes: it is carried out once the press has returned.
      later = true
      $.ui.toast(plan.working, { timeoutMs: 10000 })
      $.clock.after(0, () => void carryOut($, fresh!, plan).catch(() => {}).finally(() => { S.pressing = false; return readBanner($).catch(() => {}) }))
      return
    }
    if (plan) await carryOut($, fresh!, plan)
  } finally {
    if (!later) S.pressing = false
  }
  // What the press changed is seen at once: the next run to name, the hold just started.
  if (kind === 'unfinished') S.runsAt = 0
  if (kind === 'awake') S.sleepAt = 0
  if (kind === 'unfinished' || kind === 'awake') await slowFacts($).catch(() => {})
  await readBanner($).catch(() => {})
}

function writeAlive($: EngineInterface, run: Run, now: number) {
  S.alive = { runDir: run.runDir, at: now }
  return write($, run.paths.modAlive, String(now))
}

// Kept up while the box is hidden (a dialog over the prompt does not draw it), so the card comes back without a twin.
async function heartbeat($: EngineInterface) {
  if (!S.run) return
  const now = await $.clock.now()
  const theme = themeFrom(await $.config.list())
  if (theme !== S.theme) { S.theme = theme; S.dirty = true }
  // Only for the run whose card was drawn: one bound since is not drawn until the box comes back.
  if (S.holdsCard && S.alive.runDir === S.run.runDir) await writeAlive($, S.run, now)
}

async function checkpoint($: EngineInterface) {
  const run = await readRun($, await $.clock.now())
  if (!run) return
  const step = String((await readText($, run.paths.checkpoint)) ?? '').trim()
  if (!step || S.compacting) return
  S.compacting = true
  // The step stays in its file until the compaction has happened: one refused because a turn has started, or
  // vetoed by a hook, is tried again when a turn next ends.
  $.clock.after(700, () => void (async () => {
    const done = await $.session.compact({ instructions: compactInstructions(run.state, run.runDir, step) })
    if (done?.skip) return
    const text = resumePrompt($.plugin.root, step)
    // Kept before the step leaves its file, so a reload in between still sends it.
    await keepOwed($, { runDir: run.runDir, text })
    await write($, run.paths.checkpoint, '')
    owe($, run.runDir, text, 0)
  })().catch(() => {}).finally(() => { S.compacting = false }))
}

// The mod's rewrites of the mascot's record, one at a time, so a second reads what the first wrote.
let counting: Promise<unknown> = Promise.resolve()

// The person pressed Stop on a running turn. No Stop hook fires for that, so the turn the mascot shows as
// working is closed here; without it the creature would go on looking busy until the next turn ended. A turn a hook
// has already ended is left as it is: a failed one's record is what the carry-on looks for.
function noteStopped($: EngineInterface) {
  counting = counting.catch(() => {}).then(async () => {
    const file = activityFile(await lcwHome($), await $.session.id())
    forget(file)
    const record = await readJson($, file)
    if (['failed', 'done'].includes(record?.state) && record.at >= S.turnStartedAt) return
    await write($, file, JSON.stringify({ ...record, state: 'rest', at: await $.clock.now() }))
  })
  return counting
}

// Whether the limit hook would tell Claude anything after one of the session's own tool calls now: the stop at the
// mark or the once-only note on pay-per-token billing, with the rows read and rewritten as the hook reads and rewrites
// them. What the hook reads turns on two facts the mod cannot know fresh: which Claude Code each row records still
// runs, and the CLAUDE_PID the hook is started with (none, one a row records, or another). Every answer to both is
// judged, and the hook speaks if it would under any: with k processes recorded, 2^k * (k + 2) answers, each worked
// out in memory, and only the ones that differ in what the hook would read are judged against the quota and the spend.
// One Claude Code's rows record one process; past six (at most 512 answers) the marker is kept up unjudged.
async function afterDue($: EngineInterface, transcript: string | null, id: string) {
  const home = await lcwHome($)
  const now = await $.clock.now()
  const rows = new Map<string, any>()
  const read = async (name: string) => {
    if (!rows.has(name)) rows.set(name, await readJson($, sessionFile(home, name)))
    return rows.get(name)
  }
  const load = async (name: unknown) => {
    if (typeof name !== 'string' || !name) return
    const anchor = anchorName(await read(name))
    if (anchor) await read(anchor)
  }
  await load(transcript)
  await load(id)
  // An anchor's run is the hook's too: its rewrite gives each name the anchor's run.
  const runs = new Map<string, any>()
  for (const row of [...rows.values()]) {
    const dir = row?.runDir
    if (typeof dir !== 'string' || runs.has(dir)) continue
    const text = await readText($, runPaths(dir).state)
    const state = text === null ? null : JSON.parse(text)
    runs.set(dir, state && !['finished', 'stopped'].includes(state.status) ? state : null)
    await load(state?.driver)
  }
  const told = (names: string[]) => Promise.all(names.map((name) => readJson($, toldFile(home, name)).then((t) => !!t?.payg)))
  const off = quotaOff(await readJson($, quotaFile(home)))
  const usage = await readJson($, usageFile(home))
  const marks = (row: any) => row && { markUsd: row.markUsd, markPercent: row.markPercent }

  const pids = [...new Set([...rows.values()].map((row) => row?.claudePid).filter((pid) => Number.isInteger(pid) && pid > 1))]
  if (pids.length > 6) return true
  const judged = new Set<string>()
  let spend: Promise<Awaited<ReturnType<typeof spendFacts>>> | null = null
  const money = async (pick: ReturnType<typeof sessionPick>, state: any) => {
    if (rowsBilling(pick.rows, off) !== 'payg') return null
    const { records, cap, reading } = await (spend ??= spendFacts($, now))
    return moneyFrom({ records: records.filter(Boolean), cap, reading, session: pick.money, state, now })
  }
  for (let running = 0; running < 1 << pids.length; running++) {
    const alive = (pid: unknown) => pids.includes(pid as number) && ((running >> pids.indexOf(pid as number)) & 1) === 1
    // -1 stands for a CLAUDE_PID that no row records.
    for (const pid of [0, -1, ...pids]) {
      const names = sessionNames(transcript, id, (name) => rows.get(name), alive, pid)
      const rewritten = aliasRows(names, (name) => rows.get(name), alive, pid)
      const row = (name: string) => (Object.prototype.hasOwnProperty.call(rewritten, name) ? rewritten[name] : rows.get(name))
      const own = sessionPick(names, row, alive, pid)
      const dir = names.map((name) => row(name)?.runDir).find((d) => typeof d === 'string' && runs.get(d))
      const state = dir ? runs.get(dir) : null
      const driver = state ? sessionPick(state.driver, row, alive, pid) : null
      const driverMark = state ? runMark(state, row, alive, pid) : null
      const key = JSON.stringify([
        names, names.some((name) => row(name)?.toldPayg), own.mark, own.quotaSelection, rowsBilling(own.rows, off), marks(own.money),
        dir, driverMark, driver?.quotaSelection, driver && rowsBilling(driver.rows, off), marks(driver?.money),
      ])
      if (judged.has(key)) continue
      judged.add(key)
      const quota = await readQuota($, { quotaSelection: own.quotaSelection }, own.mark, now)
      const ownMoney = await money(own, null)
      const given = ownMoney && (names.some((name) => row(name)?.toldPayg) || (await told(names)).includes(true))
      const driverQuota = state ? await readQuota($, { quotaSelection: driver!.quotaSelection }, driverMark!, now) : null
      const driverMoney = state && !driverQuota ? await money(driver!, state) : null
      const texts = stopTexts({
        event: 'PostToolUse', lcwCall: false, hasRun: !!state, cli: ownMoney && !given ? 'lcw' : null, money: ownMoney, quota,
        heldQuota: quota?.hold ? quota : driverQuota?.hold ? driverQuota : null, mark: own.mark, usage, now,
        driverHeld: !!state && !driverQuota && atMark(driverMark, usage, now, driverMoney), driverMoney, driverMark,
      })
      if (texts.length) return true
    }
  }
  return false
}

// The ticks, a start and an end take the marker one at a time, so a look begun for a session that has just ended cannot raise its marker again.
let marking: Promise<unknown> = Promise.resolve()
const inTurn = (fn: () => Promise<void>) => (marking = marking.then(fn).catch(() => {}))

// The marker (afterFile) is the one fact the command hook after a tool call reads before it starts the limit check:
// up while the check would say something. Its folder's look, fresh each tick, sees a session's start clear it.
async function markAfter($: EngineInterface) {
  const id = await $.session.id()
  const file = afterFile(await lcwHome($), id)
  if (file === S.after.ended) return
  if (file !== S.after.file) {
    await lowerAfter($)
    S.after = { ...S.after, file, up: undefined }
  }
  const transcript = await transcriptName($)
  const due = await afterDue($, transcript, id)
  if (!due && S.after.up === false) return
  const up = !!(await readText($, file))
  if (due && !up) await write($, file, JSON.stringify({ session: id, transcript, at: await $.clock.now() }))
  if (!due && up) await write($, file, '')
  S.after.up = due
}

// The engine's $.fs removes no file: a marker is lowered by emptying it.
async function lowerAfter($: EngineInterface) {
  const file = S.after.file
  if (!file || S.after.up === false) return
  if (await readText($, file)) await write($, file, '')
  S.after.up = false
}

// How long the activity record of a turn that ended on an API error is looked for: the StopFailure hook may write it after the turn ends.
const SEEK_MS = 10000

// The main turn ended on an API error: its kind is in the record the StopFailure hook writes, stamped at or after the
// turn's start. The carry-on's tries are timed from the record's own time.
async function seekFailure($: EngineInterface) {
  const seek = S.seek
  if (!seek) return
  const now = await $.clock.now()
  const home = await lcwHome($)
  const id = await $.session.id()
  for (const name of new Set([(await transcriptName($)) ?? id, id])) {
    const file = activityFile(home, name)
    forget(file)
    const record = await readJson($, file)
    if (S.seek !== seek) return
    if (record?.state === 'failed' && typeof record.at === 'number' && record.at >= seek.since) {
      S.seek = null
      setCarry($, carryFailed(S.carry, record.error, record.at))
      return
    }
  }
  if (now >= seek.until && S.seek === seek) S.seek = null
}

async function start($: EngineInterface) {
  if (S.started) return
  S.started = true
  S.startedAt = await $.clock.now()
  const quietly = (fn: () => Promise<void>) => () => void fn().catch(() => {})
  // With a run each look keeps its own pace; without one, it comes every IDLE_MS, since no card waits on it. The first is below.
  const paced = (every: number, fn: () => Promise<void>) => {
    let looked = S.startedAt
    return quietly(async () => {
      const now = await $.clock.now()
      // 100 ms of slack: a tick that read the clock a little late must not make the next one, on time, seem too soon.
      if (now - looked < (S.run ? every : IDLE_MS) - 100) return
      looked = now
      await fn()
    })
  }
  $.clock.every(1000, paced(1000, () => refresh($)))
  $.clock.every(2000, quietly(() => pollAgents($)))
  $.clock.every(5000, quietly(() => heartbeat($)))
  $.clock.every(1000, paced(2000, () => readBanner($)))
  // Its look over the repository's runs keeps its own pace, and without a run the rest reads no file.
  $.clock.every(2000, quietly(() => slowFacts($)))
  $.clock.every(1000, quietly(async () => { await seekFailure($); await carryOn($) }))
  // A look still going when the next tick comes is not queued behind.
  let free = true
  $.clock.every(1000, () => { if (free) { free = false; void inTurn(() => markAfter($)).finally(() => { free = true }) } })
  // The one place that redraws: when something changed, or the card's motion has come to its next step.
  $.clock.every(100, () => void (async () => {
    const pace = S.run && !S.collapsed ? cardPace(S.mode, working()) : 0
    const step = pace ? stepAt(pace, await $.clock.now()) : ''
    if (!S.dirty && step === S.step) return
    S.dirty = false
    S.step = step
    $.ui.invalidate('ui.render')
  })().catch(() => {}))
  S.theme = themeFrom(await $.config.list())
  S.devCheckout = !$.plugin.root.includes('/plugins/cache/')
  S.mac = await $.session.info().then((i) => i.platform === 'macos').catch(() => false)
  S.version = String((await readJson($, `${$.plugin.root}/.claude-plugin/plugin.json`))?.version ?? '')
  await refresh($).catch(() => {})
  await readBanner($).catch(() => {})
  // What the first look over the repository's runs found shows at once, not at the next look.
  void slowFacts($).then(() => readBanner($)).catch(() => {})
  if (!S.run) return
  await pollAgents($)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // A cleared or another session has no reply to carry on.
    S.carry = null
    S.owed = null
    S.seek = null
    // session.start fires again when this code is reloaded.
    await restore($)
    S.after.ended = ''
    void inTurn(() => markAfter($))
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
    if (!e.agentId) {
      S.turnRunning = true
      S.completionReadyAt = 0
      S.seek = null
      S.turnStartedAt = await $.clock.now().catch(() => S.turnStartedAt)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      S.turnRunning = false
      S.turnEndedAt = await $.clock.now().catch(() => S.turnEndedAt)
      S.completionReadyAt = !e.isAborted && e.reason === 'answer' ? S.turnEndedAt : 0
    }
    // A main turn that did not end in error has carried the session on; one that did is judged by its activity record.
    if (!e.agentId && e.reason !== 'error' && S.carry) setCarry($, null)
    if (!e.agentId && e.reason === 'error') {
      S.seek = { since: S.turnStartedAt || S.startedAt, until: S.turnEndedAt + SEEK_MS }
      await seekFailure($).catch(() => {})
    }
    await countTurn($, e).catch(() => {})
    if (!e.agentId && !e.isAborted) await checkpoint($).catch(() => {})
    return result
  })

  on('prompt.edit', ($, e, next) => {
    if (S.setupDraft) S.setupDraft.changed = true
    return next(e)
  })

  on('prompt.change', ($, e, next) => {
    if (S.setupDraft) S.setupDraft.changed = true
    return next(e)
  })

  on('prompt.fill', ($, e, next) => {
    if (S.setupDraft) S.setupDraft.changed = true
    return next(e)
  })

  // A prompt or slash command the person sent (not one the engine or a plugin sent for them) is their reply to the approval box, if it shows.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const kind = (e as any).origin?.kind
    if (!e.isMeta && (!kind || PERSON.includes(kind)) && !(result as any)?.drop) {
      // A slash command is no answer to the approval box; only a prompt is.
      if (!e.command) { S.repliedAt = await $.clock.now().catch(() => S.repliedAt); keepReplied($) }
      // What the person sends takes over from any carry-on.
      if (S.carry) setCarry($, null)
      S.seek = null
      S.owed = null
      keepOwed($)
      S.completionReadyAt = 0
      void readBanner($).catch(() => {})
    }
    return result
  })

  // A built-in command that runs locally may raise no prompt.submit; the person's run of one still takes over from a carry-on.
  on('command.run', async ($, e, next) => {
    if (PERSON.includes((e as any).origin?.kind)) {
      S.completionReadyAt = 0
      if (S.carry) setCarry($, null)
      S.seek = null
    }
    return next(e)
  })

  // The Artifact tool's definition is as large as every other tool's together and seldom used: it waits behind tool search, for the session and its agents.
  on('tool.describe', { tool: 'Artifact' }, async ($, e, next) => ({ ...(await next(e)), isDeferred: true }))

  // An ended session's marker is lowered and stays down: after a /clear the process goes on under a new id.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    await inTurn(async () => {
      const file = afterFile(await lcwHome($), e.sessionId ?? await $.session.id())
      S.after.ended = file
      if (await readText($, file)) await write($, file, '')
      if (file === S.after.file) S.after.up = false
    })
    return result
  })

  on('session.stop', async ($, e, next) => {
    const result = await next(e)
    S.completionReadyAt = 0
    if (e.isTurnRunning) await noteStopped($).catch(() => {})
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    try {
      const now = await $.clock.now()
      const home = await lcwHome($)
      const session = await readSession($, await $.session.id())
      const quota = await readQuota($, session, session?.markPercent ?? TH.usageMarkPercent, now)
      // The weekly figure is as old as this session's last word in its transcript, as the status line takes it.
      const spoke = quota ? undefined : await $.session.info().then((i) => (i.transcriptPath ? $.fs.stat(i.transcriptPath) : null)).then((f) => f?.mtimeMs).catch(() => undefined)
      const reading = quota ? null : usageFrom(e.rateLimits, now, spoke)
      // Its own failure must not keep a subscriber's figure and gate from being written below.
      const billing = await measureSpend($, e, reading, now).catch(() => null)
      if (reading) {
        // Another session's newer figure for this week stands over this session's older one.
        const file = usageFile(await lcwHome($))
        const usage = mergeUsage(await readJson($, file), reading as any)
        await write($, file, JSON.stringify(usage))
        const run = await readRun($, now)
        const gate = run && !run.quota ? gateFor(run.state, usage?.sevenDay, now) : null
        if (run && replacesGate(run.gate, gate)) await reconcileGate($, run, 'sync')
      } else if (billing === 'payg') {
        const run = await readRun($, now)
        const money = run && !run.gate ? await readMoney($, run.session, run.state, null, now) : null
        const gate = money ? gateFor(run!.state, null, now, money) : null
        if (run && gate) await reconcileGate($, run, 'sync')
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
        S.holdsCard = !!run
        if (S.hideRows) { S.hideRows = false; S.dirty = true }
        return next(e)
      }
      const now = await $.clock.now()
      S.collapsed = e.props.isCollapsed
      const viewing = e.props.view.agentId
      let card: Row[] = []
      if (run) {
        const view = cardView(run, now)
        S.shows = JSON.stringify(view)
        S.mode = view.mode
        const pace = S.collapsed ? 0 : cardPace(view.mode, working())
        S.step = stepAt(pace, now)
        const { tick, beat } = pace ? cardMotion(pace, S.shownSince, now) : { tick: undefined, beat: undefined }
        // The mark box offers the raises and the answer box shows asks (an ask with options alone), so the card does not say them again,
        // unless the box waits for room.
        const draw = (maxRows: number, boxed: boolean) => {
          const opts = { width: cols, maxRows, theme: S.theme, frame: true, tick, beat, hideMarkHint: boxed && shown?.kind === 'mark', asksInBox: boxed && shown?.kind === 'answer' ? (shown.askN === undefined ? view.asks.map((a: any) => a.n) : [shown.askN]) : undefined }
          return renderCard(view, opts)
        }
        const boxed = drawn.length > 0 && (shown?.kind === 'mark' || shown?.kind === 'answer')
        card = draw(room, boxed)
        // The approval box has a tight form, one row shorter, for where the full one does not fit above the card.
        if (shown?.kind === 'approve' && drawn.length && room - drawn.length - 1 < Math.min(CARD_ROOM, card.length)) banner = drawn = bannerRows(shown, cols, true, true)
        // A question, and an ask with options, has a short form too: the question and its buttons in a row, without what each one means.
        const choosing = shown?.kind === 'question' || (shown?.kind === 'answer' && !!shown.choices)
        if (choosing && drawn.length && room - drawn.length - 1 < Math.min(CARD_ROOM, card.length)) banner = drawn = bannerRows({ ...shown, choices: undefined, lines: [] }, cols, true)
        // Where both do not fit, the approval or the question box (or an ask's options) stays and the card takes what
        // is left, or goes: only the box asks it. Any other box waits and the card keeps the rows it needs (up to
        // CARD_ROOM), since the card carries what that box says.
        const left = room - drawn.length - 1
        if (drawn.length && left < Math.min(CARD_ROOM, card.length)) {
          if (shown?.kind === 'approve' || choosing) {
            card = draw(left, boxed)
            if (card.length > left) card = []
          } else {
            banner = []
            if (boxed) card = draw(room, false)
          }
        } else if (drawn.length) card = draw(left, boxed)
      }
      if (!card.length && !banner.length) { S.holdsCard = false; return next(e) }
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
      // Claimed even when the approval or question box, or an ask's options, leave the card no room: else the status line draws it.
      S.holdsCard = !!run
      if (run && (now - S.alive.at >= 5000 || S.alive.runDir !== run.runDir)) void writeAlive($, run, now).catch(() => {})

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
              // the keyboard lands on the filled button, the recommended one, wherever it stands
              if (id) return <Button key={keyOf(id)} plain autoFocus={g.spans.some((s) => s.bg === 'Fable') || undefined} onPress={() => press(id)}>{g.spans.map(text)}</Button>
              return g.spans.map((s) => (s.href ? <Link href={s.href} label={String(s.t ?? '')} /> : text(s)))
            })}
          </Box>
        )
      }
      return <Box flexDirection="column" marginTop={TOP_GAP}>{rows.map(draw)}</Box>
    } catch {
      S.holdsCard = false
      return next(e)
    }
  })
}
