#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { runsDir, repoKey, runPaths, placeFile, slug, sessionFile, spendFile, contextFile } from '../lib/key.mjs'
import { compactChoice, tokensText, KEEP_UNDER } from '../lib/checkpoint.mjs'
import { home, readJson, writeJson, writeAtomic, git, mainCheckout, saveState, appendLedger as appendRunLedger, loadState } from './lib/store.mjs'
import { findRun, bindSession, unbindSession, listRuns, open, runOf, lastShown, machineRunCount } from './lib/runs.mjs'
import { sessionFolders } from './lib/cleanup.mjs'
import { canHold, heldByOther, keptHold, startHold, releaseHold, alive, claudeAlive } from './lib/awake.mjs'
import { readUsage, applyGate, atMark, sessionMark, setSessionMark, DEFAULT_MARK } from './lib/gate.mjs'
import { readMoney, readCap, writeCap, spendRecords } from './lib/money.mjs'
import { gateExpired } from '../lib/usage.mjs'
import { weekOf, weekShare } from '../lib/card.mjs'
import { moneyFrom, runSpend, markUsdOf, machineSpend, readingOf, SPEND_COMMAND_FAILS, DEFAULT_CAP_USD } from '../lib/spend.mjs'
import { runCommand, readSetting, writeSetting, clearSetting, readReading, recordResult, claimWindow } from './lib/spend-command.mjs'
import { dollars, ageText } from '../lib/format.mjs'
import { isOpenWave } from '../lib/banner.mjs'

class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg) }
// "now" is LCW_NOW (epoch ms) when it is set, else the clock, so tests can fix midnight and 08:00
const now = () => (Number.isFinite(Number(process.env.LCW_NOW)) && process.env.LCW_NOW !== '' ? Number(process.env.LCW_NOW) : Date.now())

// flags each command takes (all take a value); --session is accepted everywhere
const COMMAND_FLAGS = {
  start: ['title', 'shape'], task: ['model', 'effort', 'wave'], req: ['wave'], set: ['wave'], stage: ['wave'], ledger: ['wave'], ask: ['waiting', 'wave'],
  approval: ['meaning'], finish: ['pr', 'branch'], stop: ['pr'],
  hunt: ['areas', 'hunted', 'running', 'findings', 'fix', 'park', 'drop'], wave: ['pr', 'wave'], checkpoint: ['keep'], question: ['text', 'why', 'a', 'b', 'c'],
}
// flags that take no value
const SWITCHES = { where: ['json'], awake: ['check'], checkpoint: ['compact'] }
const MUTATING = ['stage', 'set', 'task', 'req', 'ask', 'answer', 'question', 'approval', 'mark', 'pause', 'resume', 'stop', 'finish', 'worktree', 'take', 'abandon', 'hunt', 'wave', 'merge']
// commands that name their run by its id, rather than acting on the run this session drives
const BY_ID = ['take', 'abandon']
// a run no session has shown for this long is no longer open anywhere
const SHOWN_WITHIN_MS = 15 * 60000
const STAGES = ['Brainstorm', 'Spec', 'Plan', 'Build', 'Review', 'Ship']
const SWEEP_STAGES = ['Charter', 'Hunt', 'Plan', 'Build', 'Review', 'Ship']
const PROTECTED = ['id', 'version', 'tasks', 'asks', 'requirements', 'driver', 'approval', 'shape', 'questions']
const PR_CHOICES = { stacked: 'stacked, one draft for each wave', merged: 'merged as it goes', end: 'one at the end' }
const HUNT_COUNTS = ['areas', 'hunted', 'running', 'findings', 'fix', 'park', 'drop']

const flags = {}
const args = []
const argv = process.argv.slice(2)
const COMMANDS = 'start status stage set task req ask answer question approval ledger checkpoint mark cap spend-command usage pause resume stop finish worktree pictures runs where take abandon awake hunt wave merge'
const USAGE = `lcw commands: ${COMMANDS}
start <name> --title "<line>" [--shape build|sweep] starts a run, a build by default. A build's stages are Brainstorm Spec Plan Build Review Ship, a sweep's Charter Hunt Plan Build Review Ship; stage takes only the run's own.
In a sweep: set sweep.charter=<0-10> (charter lines settled), sweep.open=<n> (questions open now) and sweep.prs=stacked|merged|end; approval asks for the charter in Charter, and stage Hunt needs that asked, charter.md written, no wave queued and every open wave built (in Review, back in Build from it, or in Ship); a round entered with a wave short of Ship is an early one, which status shows and which cannot end the sweep; with waves open it makes .claude/worktrees/<name>-latest, detached, holding every open wave's work (the newest wave's tip alone if they conflict), which status prints as latest work while the round runs. worktree makes only the branch lcw/<name>; the session stays in the main checkout and each wave gets its own worktree.
hunt [--areas N] [--hunted N] [--running N] [--findings N] [--fix N] [--park N] [--drop N] records this round's hunt and its sorting. wave add <fixes> ... queues one wave for each number, while none is queued. wave start starts the front queued wave in Plan, on lcw/<name>-wave-<n> in its own worktree .claude/worktrees/<name>-wave-<n>, cut from the open wave before it (or lcw/<name>), once that wave has reached Review and while fewer than two waves are in Plan, Build or Review (a wave sent back from Ship waits on the same cap); it prints the worktree, its plan and the files the open waves have changed, which its fixes must not need. wave files prints those files, each wave's over its review range, leaving out a wave at merging, whose head is settled; wave defer <k> moves k of the wave's fixes to the next queued wave, queuing one if none is. wave take merges into it, in its worktree, the latest of the sweep's branch and of every earlier open wave that it lacks, oldest first; stage Review and the final checks need all of them, and stage Ship from Review needs every fix of the wave recorded pass, partial, parked or dropped. wave round raises the review round, and wave round <r> sets it. wave step closures (in Review), "final checks" (in Ship, once every earlier open wave is at merging on the head its checks passed on, and no task of the wave is running), merging (on the head its final checks started on, or with none for a wave that sits on the head the wave before it was checked on) or none says where the wave stands; a wave sent back from Ship clears the later waves' final checks. wave shipped [--pr <number>], at step merging and in wave order, fast-forwards lcw/<name> to it (a wave with no commits is recorded empty, with no pull request) and removes the worktrees of the waves shipped before it, unless one holds uncommitted or untracked files; wave pr <n> <number|url> records the pull request of a wave that shipped without one. merge <wave> merges a shipped wave's pull request with a merge commit, in order, when sweep.prs is merged. task <id> dropped drops a task; stop --pr <number|url> records the pull request a stopped sweep opened.
--wave <n> names the wave that stage Plan|Build|Review|Ship, task, req, set plan.* or milestone, ledger, ask and wave round|step|take|defer|shipped act on. Without it they act on the open wave whose worktree lcw runs in, else the only open wave; with several open they refuse, but ledger writes the run's ledger only and ask is the run's own, as they are during a hunt. ask --wave marks the wave waiting until its asks are answered. ledger --wave may name a shipped wave, and set takes --wave with any key. A flag and its value may be one word, --wave=<n>.
req <id> rename "<name>" and req <id> drop change a requirement when what is built changes; in a sweep's running wave req <id> park takes a fix out of the wave for the person, and req <id> partial marks a fix that was built but leaves the charter's done line unmet: it is not counted as fixed. req <id> drop --wave <n> drops a fix a shipped wave parked.
approval ["<Go label>" ...] [--meaning "<what Go builds>"] puts the Brainstorm's question, Is this what you want built?, in LCW's box above the prompt, with Go (or each label given, at most 3 of up to 20 characters), Yes, but … and Something else; its buttons only fill the prompt. Asked again, it replaces the last; a new stage clears it.
take <runId> makes this session take over a run of this repository that no session has shown for 15 minutes; abandon <runId> stops such a run for good and removes its worktree when nothing in it is uncommitted, keeping its branch.
awake keeps this computer from idle sleep until the run pauses, finishes or stops, or Claude Code exits; awake --check prints {canHold, heldByOther, kept}. where --json prints {main, key, run}.
flags: --session <id> (any command); start --title --shape; task --model --effort --wave; req --wave; set --wave; stage --wave; ledger --wave; ask --waiting --wave; approval --meaning; finish --pr --branch; stop --pr; hunt --areas --hunted --running --findings --fix --park --drop; wave --pr --wave; where --json; awake --check
spend-command <command line> sets the command that prints your 7-day spend in dollars, spend-command off turns it off, spend-command alone says what is set. Everything after spend-command is the command line, joined with single spaces (quote it as one argument if it needs quotes, pipes or ;), and a final --session <id> is not part of it. The command must print the dollars spent in the last 7 days as one number, such as 1240.55 (a leading $ and thousands commas are fine), exit 0, and finish within 30 seconds. LCW runs it in the background every 5 minutes, once across all sessions; while it fails, the figure is its last reading, running down as that reading's days drop out of the 7 days, plus what LCW counted since, and lcw usage says what went wrong.
question add <id> --text --why --a "<label>: <meaning>" --b ... [--c ...] puts a short question to the person in LCW's box, in a sweep; question <id> pick <a|b|c|park> is what a press records, question <id> answer "<words>" records an answer they typed, question <id> used marks one acted on, and question alone lists them.
checkpoint "<next step>" records the next step: under 200K tokens of context nothing compacts and the turn carries on; from 200K it asks for checkpoint --compact (compact when the turn ends) or checkpoint --keep "<why>"; near the window's end, or with no reading of the size, it compacts. checkpoint --compact "<step>" compacts at any size.
help, -h and --help print this and change nothing. Any other argument starting with "-" is refused. Text such as a ledger line must not start with "-".`
const refuse = (msg) => { console.log(msg); process.exit(1) }
// an error says what went wrong in a line; the whole help is for lcw help
const SEE_HELP = 'Nothing was changed. "lcw help" prints every command.'
const help = () => { console.log(USAGE); process.exit(0) }
const allowed = COMMAND_FLAGS[argv[0]] || []
const switches = SWITCHES[argv[0]] || []
// after spend-command every word is the command line, even one that starts with "-"; only a final --session <id> pair is not
let spendWords = null
if (argv[0] === 'spend-command') {
  spendWords = argv.slice(1)
  if (spendWords.length >= 2 && spendWords.at(-2) === '--session') { flags.session = spendWords.at(-1); spendWords = spendWords.slice(0, -2) }
  if (spendWords.length === 1 && (spendWords[0] === '-h' || spendWords[0] === '--help')) help()
}
for (let i = 0; i < (spendWords ? 0 : argv.length); i++) {
  const a = argv[i]
  if (!a.startsWith('-')) { args.push(a); continue }
  // a flag may come with its value in the same word, as --wave=2, or as "--wave 2" from a shell variable that was not split
  const [, name, joined] = /^--([a-z]+)(?:[=\s]\s*([\s\S]*))?$/.exec(a) ?? []
  if (name && switches.includes(name) && joined === undefined) flags[name] = true
  else if (name && (name === 'session' || allowed.includes(name))) {
    if (joined === undefined && i + 1 >= argv.length) refuse(`${a} needs a value`)
    flags[name] = joined === undefined ? argv[++i] : joined.trim()
  } else if (a === '-h' || a === '--help') help()
  else {
    const own = [...allowed.map((n) => `--${n} <value>`), ...switches.map((n) => `--${n}`), '--session <id>']
    // a line of text that starts with "-" lands here too
    const text = !name || joined !== undefined ? ' Text such as a ledger line must not start with "-".' : ''
    refuse(`Unknown flag or argument starting with "-": ${a}.${COMMANDS.split(' ').includes(argv[0]) ? ` lcw ${argv[0]} takes ${own.join(', ')}.` : ''}${text} ${SEE_HELP}`)
  }
}
const [command, ...rest] = spendWords ? ['spend-command', ...spendWords] : args
if (command === 'help') help()
if (argv[0] !== command && argv.length) refuse(`The command must come first, as in "lcw status --session <id>". ${SEE_HELP}`)
const sessionId = flags.session || process.env.CLAUDE_CODE_SESSION_ID || null
const cwd = process.cwd()

let held = null // the run, locked and freshly read, for commands that change state
const need = () => held || findRun({ sessionId, cwd }) || fail('No LCW run for this session. Use "lcw start <name> --title ..." or "lcw runs".')
const out = (...lines) => console.log(lines.join('\n'))
const weekLine = (usage) => (usage?.sevenDay ? `week: ${usage.sevenDay.percentUsed}% used` : 'week: unknown')

/**
 * Change the state, save it atomically, note it in the ledger. A run that starts running notes since when; one that
 * stops being 'running' (pauses, goes back to the person, finishes or stops) lets the computer sleep again.
 */
function change(run, note, fn, wave) {
  const was = run.state.status
  fn(run.state)
  const s = run.state
  if (s.status === 'running' && was !== 'running') s.runningSince = new Date(now()).toISOString()
  if (s.status !== 'running') releaseHold(run.dir)
  saveState(run.paths, s)
  appendLedger(run.paths, note, wave === undefined ? ledgerWave(s) : wave)
}

const find = (list, key, value) => list.find((x) => x[key] === value) || fail(`No such item: ${value}`)

const isSweep = (s) => s.shape === 'sweep'
const stagesOf = (s) => (isSweep(s) ? SWEEP_STAGES : STAGES)
const withYou = (stage) => stage === 'Brainstorm' || stage === 'Charter'
const WAVE_STAGES = ['Plan', 'Build', 'Review', 'Ship']
/** The run's own branch and, in a sweep, its waves' branches. */
const branchesOf = (s) => [s.branch, ...(s.sweep?.waves ?? []).map((w) => w.branch)].filter(Boolean)
const waveDir = (dir, n) => `${dir}/waves/${n}`
const sweepOnly = (run) => (isSweep(run.state) ? run.state.sweep : fail(`lcw ${command} is for a sweep; run ${run.state.id} is a build. Nothing was changed.`))
const freshPlan = () => ({ tasks: 0, atOnce: 0, models: {} })

const openWaves = (s) => (s.sweep?.waves ?? []).filter((w) => isOpenWave(s, w))
const inside = (p, dir) => p === dir || p.startsWith(`${dir}/`)
/**
 * The open wave whose worktree this is run in, else the only running wave, else null; with several running, a list of them.
 * With `own` (ask, ledger), outside a worktree only a lone open wave counts, and none while the run hunts: the note is the run's.
 */
function waveHere(s, own = false) {
  const open = openWaves(s)
  let here = cwd
  try { here = fs.realpathSync(cwd) } catch {}
  const mine = open.find((w) => w.worktree && inside(here, w.worktree))
  if (mine) return mine
  if (own && (open.length > 1 || s.stage === 'Hunt')) return null
  const running = open.filter((w) => w.status === 'running')
  return running.length < 2 ? running[0] ?? null : running
}
/** The wave a ledger line with no --wave is about, or null: a held wave, one of several, or one the hunt runs beside is never assumed. */
const ledgerWave = (s) => { const w = waveHere(s, s.stage === 'Hunt'); return Array.isArray(w) ? null : w }

/** The wave an ask or ledger line with no --wave is about: as ledgerWave, but with several open and outside their worktrees, the run's own. */
const ownWave = (s) => { const w = waveHere(s, true); return Array.isArray(w) ? null : w }

/**
 * The wave a command acts on: the one --wave names, else the open wave whose worktree this is run in, else the only
 * running wave; null when none runs, so the run's own lists and stage apply. A shipped wave held for its merge is
 * reached only by --wave or from its worktree, so it never takes a command meant for the run. With several running and none of these,
 * a command refuses, or gets null when `several` is 'run'. `shipped` lets --wave name a wave that has shipped.
 */
function waveOf(s, { several = 'refuse', shipped = false } = {}) {
  if (!isSweep(s)) return flags.wave === undefined ? null : fail(`--wave is for a sweep; run ${s.id} is a build. Nothing was changed.`)
  if (flags.wave !== undefined) {
    const n = wholeNumber(flags.wave, '--wave')
    const w = s.sweep.waves.find((x) => x.n === n) || fail(`No wave ${n}. Nothing was changed.`)
    if (w.status === 'queued') fail(`Wave ${n} is queued and has not started. Nothing was changed.`)
    if (!shipped && !isOpenWave(s, w)) fail(`Wave ${n} has shipped. Nothing was changed.`)
    return w
  }
  const w = waveHere(s)
  if (!Array.isArray(w) || several === 'run') return Array.isArray(w) ? null : w
  fail(`Waves ${w.map((x) => x.n).join(' and ')} are open: pass --wave <n>. Nothing was changed.`)
}

// an open wave in these stages is being built or reviewed; one in Ship holds
const BUSY = ['Plan', 'Build', 'Review']
// a wave back in Build for its review's fixes has been built once: its round shows it reached Review
const isBuilt = (w) => w.stage === 'Review' || w.stage === 'Ship' || (w.stage === 'Build' && !!w.round)
// each step of a wave and the stage it belongs to: 'merging' means its final checks passed and it is landing
const STEPS = { closures: 'Review', 'final checks': 'Ship', merging: 'Ship', none: true }
/** What a wave cut after `after` takes in: that open wave's branch, or the sweep's own once that wave has shipped onto it. */
function takesFrom(s, after) {
  const before = s.sweep.waves.find((x) => x.branch === after)
  return before?.status === 'running' ? after : s.branch
}

const mustRun = (w) => (w.status === 'running' ? w : fail(`Wave ${w.n} has shipped. Nothing was changed.`))

/** The run's stage follows its newest open wave, except while a hunt round runs alongside the waves. */
function mirror(s) {
  const newest = openWaves(s).at(-1)
  if (newest && s.stage !== 'Hunt') { s.stage = newest.stage; s.stageSince = newest.stageSince }
}

/**
 * A sweep from before waves kept their own records holds its running wave's stage, lists, plan, milestone,
 * worktree and base at the run's level. Moves them onto that wave; returns whether it did.
 */
function moveOldWave(s) {
  const w = isSweep(s) ? s.sweep.waves.find((x) => x.status === 'running' && x.stage == null) : null
  if (!w) return false
  const stage = WAVE_STAGES.includes(s.stage) ? s.stage : 'Plan'
  Object.assign(w, {
    stage, stageSince: s.stageSince ?? now(), step: null, round: stage === 'Review' ? 1 : 0, waiting: false,
    tasks: s.tasks ?? [], requirements: s.requirements ?? [], plan: s.plan ?? freshPlan(), milestone: s.milestone ?? null,
    worktree: s.worktree ?? null, after: s.branch, base: s.base ?? null, checked: null,
  })
  Object.assign(s, { tasks: [], requirements: [], plan: freshPlan(), milestone: null, worktree: null, base: null })
  return true
}

/** A run's ledger line; a line about one of a sweep's waves goes to that wave's own ledger too. */
function appendLedger(paths, text, wave = null) {
  appendRunLedger(paths, text)
  if (!wave) return
  fs.mkdirSync(waveDir(paths.dir, wave.n), { recursive: true })
  appendRunLedger({ ledger: `${waveDir(paths.dir, wave.n)}/ledger.md` }, text)
}

/** owner/name of the repository's GitHub remote origin, or null. */
function githubRepo(root) {
  let remote = ''
  try { remote = git(root, 'remote', 'get-url', 'origin') } catch {}
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remote)
  return m ? `${m[1]}/${m[2]}` : null
}

const gh = (cwd, ...a) => execFileSync('gh', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const firstLine = (e) => String(e.stderr || e.message).trim().split('\n')[0]
const wholeNumber = (text, what) => (/^\d+$/.test(String(text)) ? Number(text) : fail(`${what} takes a whole number, not ${text}. Nothing was changed.`))

const QUESTION_KEYS = ['a', 'b', 'c']
/** "  Q82 [answered: a, Answer 422] Trade the friendly 409 for a generic 422?" */
function questionLine(q) {
  const picked = q.options.find((o) => o.key === q.pick)
  const said = q.status === 'open' ? '' : q.words ? `: ${q.words}` : q.pick === 'park' ? ': leave it parked' : picked ? `: ${q.pick}, ${picked.label}` : ''
  return `  ${q.id} [${q.status}${said}] ${q.text}`
}

/** The context the status line last saw for this session, { tokens, window }, or null when there is no fresh reading. */
function contextOf(id) {
  const c = id ? readJson(contextFile(home(), id)) : null
  return c && Number(c.tokens) > 0 && now() - Number(c.at) < 10 * 60000 ? c : null
}

function nextStepOf(run) {
  const line = fs.readFileSync(run.paths.ledger, 'utf8').split('\n').reverse().find((l) => l.includes(' checkpoint: '))
  return line ? line.split(' checkpoint: ').slice(1).join(' checkpoint: ') : null
}

/** What a session has spent so far, from its spend record (its highest cost seen), or null. */
function cumOf(id) {
  const max = id ? readJson(spendFile(home(), id))?.max : null
  return Number.isFinite(max) ? max : null
}

const billingOf = (id) => (id ? readJson(sessionFile(home(), id))?.billing : null)

// "5500usd", "$5500", "5,500 USD" and a bare "5000" read as dollars; only a bare number is not marked as such
function parseMoney(text) {
  const m = /^(\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(usd)?$/i.exec(String(text).trim())
  const usd = m ? Number(m[2].replace(/,/g, '')) : NaN
  return Number.isFinite(usd) && usd > 0 ? { usd, marked: !!(m[1] || m[3]) } : null
}

const capNow = () => readCap()?.usd ?? DEFAULT_CAP_USD
const markWord = (cap, mark) => {
  if (mark.usd !== undefined) return `This session runs up to ${dollars(mark.usd)}${mark.usd > cap ? `, past your ${dollars(cap)} weekly cap` : ''}.`
  if (mark.percent === 100) return `This session runs up to your full weekly cap, ${dollars(cap)}.`
  return `This session runs up to ${dollars(cap * mark.percent / 100)} (${mark.percent}% of ${dollars(cap)}).`
}

/** The spend command's reading, or null when none is set or it has not given a figure yet. Only reads files. */
const spendReading = () => readingOf(readSetting(home()), readReading(home()))

const pad2 = (n) => String(n).padStart(2, '0')
const hhmmOf = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** A local time of day, with its date in front when it is not on the same local day as `at`. */
function sinceText(ms, at) {
  const d = new Date(ms)
  return d.toDateString() === new Date(at).toDateString() ? hhmmOf(ms) : `${d.getDate()} ${MONTHS[d.getMonth()]} ${hhmmOf(ms)}`
}

/** The machine's money view with no session to say whose mark it is: the default mark on the stated or assumed cap. */
function machineMoney(at) {
  const records = spendRecords(at)
  const cap = readCap()
  if (!cap && !records.length) return null
  return moneyFrom({ records, cap, session: null, state: null, now: at, reading: spendReading() })
}

function parseValue(text) {
  try { return JSON.parse(text) } catch { return text }
}

function setDotted(obj, key, value) {
  const parts = key.split('.')
  let o = obj
  for (const p of parts.slice(0, -1)) {
    if (typeof o[p] !== 'object' || o[p] === null) o[p] = {}
    o = o[p]
  }
  o[parts.at(-1)] = value
}


const commands = {
  start() {
    const [name] = rest
    if (!name || !flags.title) fail('Usage: lcw start <name> --title "<one line>"')
    const shape = flags.shape ?? 'build'
    if (shape !== 'build' && shape !== 'sweep') fail(`--shape is build or sweep, not ${shape}. Nothing was changed.`)
    const sweep = shape === 'sweep'
    const driving = sessionId ? open(readJson(sessionFile(home(), sessionId))?.runDir) : null
    if (driving) fail(`This session already drives run ${driving.state.id} (${driving.state.title}). A second change needs another session, which the person opens; this run carries on here. Nothing was started.`)
    const key = repoKey(mainCheckout(cwd))
    const d = new Date(now())
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const base = `${date}-${slug(name)}`
    const main = mainCheckout(cwd)
    const branchTaken = (nm) => { try { git(main, 'rev-parse', '--verify', '-q', `refs/heads/lcw/${nm}`); return true } catch { return false } }
    let id = base, runName = slug(name), n = 1
    while (fs.existsSync(`${runsDir(home(), key)}/${id}`) || branchTaken(runName)) {
      n++
      id = `${base}-${n}`
      runName = `${slug(name)}-${n}`
    }
    const before = machineRunCount()
    const dir = `${runsDir(home(), key)}/${id}`
    const paths = runPaths(dir)
    fs.mkdirSync(paths.artifacts, { recursive: true })
    const files = sweep
      ? { charter: `${dir}/charter.md`, findings: `${dir}/findings.md`, parked: `${dir}/parked.md`, ledger: paths.ledger }
      : { brainstorm: paths.brainstorm, spec: paths.spec, plan: paths.plan, ledger: paths.ledger }
    for (const f of Object.values(files)) fs.writeFileSync(f, '')
    const at = now()
    const sevenDay = readUsage()?.sevenDay
    const week = sevenDay?.percentUsed
    const state = {
      version: 1, id, name: runName, title: flags.title, repoRoot: mainCheckout(cwd), worktree: null, branch: null,
      createdAt: at, updatedAt: at, finishedAt: null, stage: sweep ? 'Charter' : 'Brainstorm', stageSince: at, status: 'with-you',
      pausedReason: null, health: sweep ? 'agreeing the charter with you' : 'working out what you want', markPercent: sessionMark(sessionId), driver: sessionId, weekAtStart: week ?? null,
      shareBefore: 0, usdBefore: 0, usdAtStart: cumOf(sessionId) ?? 0, weekResetsAt: sevenDay?.resetsAt ?? null, weekUsed: week ?? null,
      ...(sweep ? {
        shape: 'sweep',
        sweep: {
          prs: null, charter: 0, open: 0, approvedAt: null, round: 0, hunt: Object.fromEntries(HUNT_COUNTS.map((k) => [k, 0])),
          fixed: 0, parked: 0, dropped: 0, waves: [],
        },
      } : {
        intent: { settled: [], now: '', next: [], questionsOpen: 0 },
        blindReview: { done: [], now: null, passed: false }, feasibility: { status: 'pending', limits: 0 },
        spec: { requirements: 0, scenarios: 0 },
      }),
      plan: { tasks: 0, atOnce: 0, models: {} },
      tasks: [], requirements: [], asks: [], pr: null, closing: { decisionsToCheck: 0, parked: 0 }, totals: { agents: 0, tokens: 0 },
      // the first runs on a machine explain themselves: the card's stage line and the first-run box
      ...(before < 3 ? { guide: true } : {}), ...(before === 0 ? { firstOnMachine: true } : {}),
    }
    saveState(paths, state)
    appendLedger(paths, `run started: ${flags.title}`)
    bindSession(sessionId, dir)
    const lines = [`Run ${id}`, `folder: ${dir}`, ...Object.entries(files).map(([k, f]) => `${k}: ${f}`), `artifacts: ${paths.artifacts}`]
    if (!sessionId) lines.push('note: no session id (CLAUDE_CODE_SESSION_ID or --session), so this session is not bound to the run')
    try { if (!git(cwd, 'remote')) lines.push('note: this repository has no remote; the run will end on a local branch, not a pull request') } catch {}
    out(...lines)
  },

  status() {
    const run = need()
    moveOldWave(run.state) // shown as it will be saved by the next command that changes the run
    const s = run.state
    const p = run.paths
    const ledger = fs.readFileSync(p.ledger, 'utf8').split('\n').filter(Boolean).slice(-15)
    const money = readMoney({ sessionId: s.driver ?? sessionId, now: now() })
    out(
      `Run ${s.id}: ${s.title}`,
      `stage: ${s.stage}  status: ${s.status}${s.pausedReason ? ` (${s.pausedReason})` : ''}  health: ${s.health}`,
      `mark: ${money ? moneyMark(money) : `${s.markPercent}%`}${s.worktree ? `  worktree: ${s.worktree}  branch: ${s.branch}` : ''}${s.base ? `  base: ${s.base}` : ''}`,
      'tasks:', ...(s.tasks.length ? s.tasks.map((t) => `  ${t.id} [${t.status}] ${t.title}`) : ['  none']),
      'asks:', ...(s.asks.length ? s.asks.map((a) => `  ${a.n}. ${a.text}${a.wave ? ` (wave ${a.wave})` : ''}`) : ['  none']),
      ...((s.questions ?? []).length ? ['questions (lcw question):', ...s.questions.map(questionLine)] : []),
      ...(isSweep(s) ? sweepStatus(run) : [`folder: ${run.dir}`, `brainstorm: ${p.brainstorm}`, `spec: ${p.spec}`, `plan: ${p.plan}`, `ledger: ${p.ledger}`]),
      `next step: ${nextStepOf(run) || 'none recorded'}`,
      'ledger (last 15):', ...ledger,
    )
  },

  stage() {
    const run = need()
    const stages = stagesOf(run.state)
    const stage = stages.find((s) => s.toLowerCase() === String(rest[0]).toLowerCase()) || fail(`Stage is one of: ${stages.join(', ')}`)
    if (isSweep(run.state) && WAVE_STAGES.includes(stage)) {
      const wave = waveOf(run.state)
      if (wave) return waveStage(run, mustRun(wave), stage)
    } else if (flags.wave !== undefined) fail(`--wave is for a wave's stages, ${WAVE_STAGES.join(', ')}. Nothing was changed.`)
    if (run.state.sweep && run.state.stage === 'Charter' && stage === 'Charter') return out('stage Charter')
    if (stage === 'Hunt') {
      // a repeat changes nothing, except after an early round that was sorted and found nothing to fix: once every
      // open wave holds in Ship, the round that follows it starts
      const sw = run.state.sweep
      if (run.state.stage === 'Hunt') {
        if (!sw.early?.length || sw.hunt.fix) return out('stage Hunt')
        if (!sw.sorted) return out(`stage Hunt: round ${sw.round} stands, an early one. Once it is sorted, record its counts (lcw hunt --fix <n> --park <n> --drop <n>); with nothing to fix, the round that follows it starts here`)
        const still = openWaves(run.state).filter((x) => x.status === 'running' && x.stage !== 'Ship')
        if (still.length) return out(`stage Hunt: round ${sw.round} stands; the round that follows this early one starts once ${still.length > 1 ? 'waves' : 'wave'} ${still.map((x) => x.n).join(', ')} ${still.length > 1 ? 'hold' : 'holds'} in Ship`)
      }
      const queued = run.state.sweep.waves.filter((x) => x.status === 'queued')
      if (queued.length) fail(`Waves ${queued.map((x) => x.n).join(', ')} are still queued; a new hunt starts once none is. Nothing was changed.`)
      const unbuilt = openWaves(run.state).filter((x) => x.status === 'running' && !isBuilt(x))
      if (unbuilt.length) fail(`${unbuilt.length > 1 ? 'Waves' : 'Wave'} ${unbuilt.map((x) => `${x.n} (${x.stage})`).join(', ')} ${unbuilt.length > 1 ? 'are' : 'is'} still being planned or built; a new hunt starts once every open wave is built and in Review. Nothing was changed.`)
      if (!run.state.sweep.approvedAt) fail('The charter has not been put to the person yet: ask with lcw approval in Charter first. Nothing was changed.')
      const charter = `${run.dir}/charter.md`
      if (!fs.existsSync(charter) || !fs.readFileSync(charter, 'utf8').trim()) fail('charter.md is empty: write the agreed charter there first. Nothing was changed.')
    }
    const latest = stage === 'Hunt' ? freshLatest(run.state, run.state.sweep.round + 1) : null
    // a round that starts while a wave is short of Ship reads code that wave's review may still change
    const short = stage === 'Hunt' ? openWaves(run.state).filter((x) => x.status === 'running' && x.stage !== 'Ship') : []
    const early = short.length ? `early round: ${short.length > 1 ? 'waves' : 'wave'} ${short.map((x) => `${x.n} (${x.stage})`).join(', ')} ${short.length > 1 ? 'are' : 'is'} short of Ship, so if this round finds nothing to fix the sweep does not end on it: one more round follows once every open wave holds in Ship` : null
    change(run, `stage: ${stage}${latest ? `; ${latest.note}` : ''}${early ? `; ${early}` : ''}`, (s) => {
      if (stage === 'Hunt') {
        s.sweep.latest = latest?.dir ?? null
        s.sweep.early = short.map((x) => x.n)
        s.sweep.sorted = false
        s.sweep.round++
        s.sweep.hunt = Object.fromEntries(HUNT_COUNTS.map((k) => [k, 0]))
      }
      // the brainstorm's checklist is settled once the intent is approved; left as it was, it shows a question still open
      if (s.stage === 'Brainstorm' && stage !== 'Brainstorm' && s.intent) {
        const now = s.intent.now ? [s.intent.now] : []
        s.intent = { ...s.intent, settled: [...(s.intent.settled ?? []), ...now], now: '', next: [], questionsOpen: 0 }
      }
      if (stage === 'Charter' && s.sweep) s.sweep.approvedAt = null // the charter is put to the person again before Hunt
      enterStage(s, stage)
    })
    out(`stage ${stage}`, ...(latest ? [latest.note] : []), ...(early ? [early] : []))
  },

  set() {
    const run = need()
    if (!rest.length) fail('Usage: lcw set <key>=<value> ...')
    const pairs = rest.map((a) => {
      const i = a.indexOf('=')
      if (i < 1) fail(`Not key=value: ${a}`)
      const key = a.slice(0, i)
      const top = key.split('.')[0]
      if (top === 'status' || top === 'stage') fail(`Cannot set ${key}; use lcw stage, lcw pause, lcw resume, lcw stop or lcw finish`)
      if (top === 'markPercent') fail('Cannot set markPercent; the usage mark moves only on the human\'s words, with lcw mark <percent>')
      if (PROTECTED.includes(top)) fail(`Cannot set ${key} here`)
      const value = parseValue(a.slice(i + 1))
      if (top === 'sweep') checkSweepSetting(run.state, key, value)
      return [key, value]
    })
    // a wave keeps its own plan and milestone
    const ofWave = (k) => ['plan', 'milestone'].includes(k.split('.')[0])
    const wave = pairs.some(([k]) => ofWave(k)) ? waveOf(run.state) : null
    if (wave) mustRun(wave)
    // no ledger line: set is called often and would drown the ledger
    pairs.forEach(([k, v]) => setDotted(wave && ofWave(k) ? wave : run.state, k, v))
    saveState(run.paths, run.state)
    out(`set ${pairs.map(([k]) => k).join(', ')}`)
  },

  task() { listItem('task', 'tasks', ['todo', 'running', 'done', 'parked', ...(isSweep(need().state) ? ['dropped'] : [])],(id, title) => ({ id, title, status: 'todo', model: flags.model ?? null, effort: flags.effort ?? null })) },
  req() { listItem('req', 'requirements', ['todo', 'pass', 'failing', ...(isSweep(need().state) ? ['partial'] : [])], (id, name) => ({ id, name, status: 'todo' })) },

  ask() {
    const run = need()
    const text = rest.join(' ')
    if (!text) fail('Usage: lcw ask "<question>" [--waiting N] [--wave N]')
    const wave = flags.wave === undefined ? ownWave(run.state) : waveOf(run.state)
    let n
    change(run, `ask: ${text}`, (s) => {
      // an ask keeps its number until it is answered, so the numbers the human sees never shift under them
      n = Math.max(0, ...s.asks.map((a) => a.n)) + 1
      s.asks.push({ n, text, at: now(), waiting: Number(flags.waiting) || 0, ...(wave ? { wave: wave.n } : {}) })
      if (wave) wave.waiting = true
    }, wave)
    out(`ask ${n}`)
  },

  answer() {
    const run = need()
    const n = Number(rest[0])
    const ask = run.state.asks.find((a) => a.n === n) || fail(`No open ask ${rest[0]}`)
    if (rest[1] === undefined) fail('Usage: lcw answer <n> "<answer>"')
    const wave = run.state.sweep?.waves.find((w) => w.n === ask.wave) ?? null
    change(run, `answered: Q: ${ask.text} A: ${rest.slice(1).join(' ')}`, (s) => {
      s.asks = s.asks.filter((a) => a.n !== n)
      if (wave) wave.waiting = s.asks.some((a) => a.wave === wave.n)
    }, wave ?? undefined)
    out(`answered ${n}; ${run.state.asks.length} open`)
  },

  approval() {
    const run = need()
    const asks = isSweep(run.state) ? 'Charter' : 'Brainstorm'
    if (run.state.stage !== asks) fail(`approval is the ${asks}'s question; this run is in ${run.state.stage}`)
    const go = rest.map((g) => g.replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (go.length > 3) fail('At most 3 Go labels, such as "Go (a)" "Go (b)"')
    if (go.some((g) => [...g].length > 20)) fail('A Go label is at most 20 characters, such as "Go (a)"; say what it builds with --meaning')
    const meaning = String(flags.meaning ?? '').replace(/\s+/g, ' ').trim()
    change(run, `approval asked${go.length ? ': ' + go.join(' / ') : ''}${meaning ? ' (' + meaning + ')' : ''}`, (s) => {
      s.approval = { go, meaning, at: now() }
      if (s.sweep) s.sweep.approvedAt = s.approval.at
    })
    out('approval: the box shows above the prompt until the person replies')
  },

  ledger() {
    const run = need()
    const text = rest.join(' ')
    if (!text) fail('Usage: lcw ledger "<text>"')
    appendLedger(run.paths, text, flags.wave === undefined ? ownWave(run.state) : waveOf(run.state, { shipped: true }))
    out('ledger: written')
  },

  checkpoint() {
    const run = need()
    const step = rest.join(' ')
    const usage = 'Usage: lcw checkpoint "<next step>" | checkpoint --compact ["<next step>"] | checkpoint --keep "<why>"'
    const ctx = contextOf(sessionId)
    const size = ctx ? `context ${tokensText(ctx.tokens)}` : 'context size unknown'
    const compact = (s) => {
      writeAtomic(run.paths.checkpoint, s)
      out(`${size}: checkpoint written; compaction happens when this turn ends, so end your turn now`)
    }
    if (flags.keep !== undefined) {
      if (flags.compact || step) fail(usage)
      if (compactChoice(ctx) === 'compact') fail(`${size}${ctx ? ", too near the window's end to keep" : ', so it cannot be kept'}: run lcw checkpoint --compact. Nothing was changed.`)
      appendLedger(run.paths, `${size} kept: ${flags.keep}`, ledgerWave(run.state))
      return out(`${size} kept; carry on with the next step now, and end your turn only to wait for agents' reports`)
    }
    const next = step || (flags.compact ? nextStepOf(run) : null)
    if (!next) fail(usage)
    if (step) appendLedger(run.paths, `checkpoint: ${step}`, ledgerWave(run.state))
    if (flags.compact) return compact(next)
    const choice = compactChoice(ctx)
    if (choice === 'compact') return compact(next)
    if (choice === 'keep') return out(`${size}, under ${tokensText(KEEP_UNDER)}: nothing compacts. Carry on with the next step now, and end your turn only to wait for agents' reports.`)
    out(`${size}: yours to decide.`,
      '  lcw checkpoint --compact          compacts when this turn ends, then you are prompted with the next step',
      '  lcw checkpoint --keep "<why>"     carries on with this context; end your turn only to wait for agents',
      `Every turn re-reads the whole context, so keeping it costs more on each one; a compaction keeps only what the records hold. Choose what serves the next step.`)
  },

  // A short question for the person, shown one at a time in LCW's box; their press is saved with no turn. A sweep's own.
  question() {
    const run = need()
    sweepOnly(run)
    const list = (run.state.questions ??= [])
    const [first, ...more] = rest
    if (!first) return out(...(list.length ? list.map(questionLine) : ['no questions']))
    if (first === 'add') {
      const [id] = more
      const options = QUESTION_KEYS.filter((k) => flags[k] !== undefined).map((key) => {
        const [label, ...meaning] = String(flags[key]).split(': ')
        return { key, label: label.trim(), meaning: meaning.join(': ').trim() }
      })
      if (!id || !flags.text || options.length < 2 || options.some((o) => !o.label || !o.meaning)) fail('Usage: lcw question add <id> --text "<question>" [--why "<line>"] --a "<label>: <what it means>" --b "<label>: <what it means>" [--c ...]')
      if (list.some((q) => q.id === id)) fail(`Question ${id} exists. Nothing was changed.`)
      change(run, `question ${id} added: ${flags.text}`, (s) => { s.questions.push({ id, text: flags.text, why: flags.why ?? '', options, status: 'open', pick: null, at: now() }) })
      return out(`${id} added; LCW's box puts it to the person`)
    }
    const q = list.find((x) => x.id === first) || fail(`No question ${first}. Nothing was changed.`)
    const [verb, ...words] = more
    if (verb === 'pick') {
      const pick = words[0]
      if (![...q.options.map((o) => o.key), 'park'].includes(pick)) fail(`Usage: lcw question ${q.id} pick <${[...q.options.map((o) => o.key), 'park'].join('|')}>`)
      if (q.status !== 'open') return out(`${q.id} is ${q.status} already`)
      change(run, `question ${q.id} picked: ${pick}`, () => { Object.assign(q, { status: 'answered', pick, answeredAt: now() }) })
      return out(`${q.id}: saved`)
    }
    if (verb === 'answer') {
      const text = words.join(' ')
      if (!text) fail(`Usage: lcw question ${q.id} answer "<their words>"`)
      change(run, `question ${q.id} answered: ${text}`, () => { Object.assign(q, { status: 'answered', pick: 'other', words: text, answeredAt: now() }) })
      return out(`${q.id}: answered`)
    }
    if (verb === 'used') {
      if (q.status !== 'answered') fail(`${q.id} is ${q.status}; only an answered question is used. Nothing was changed.`)
      // each question stands for one item the hunt parked: an answer other than park settles it
      const settles = q.pick !== 'park' && run.state.sweep.parked > 0
      change(run, `question ${q.id} used${settles ? `; parked down to ${run.state.sweep.parked - 1}` : ''}`, (s) => {
        q.status = 'used'
        if (settles) s.sweep.parked--
      })
      return out(`${q.id}: used`)
    }
    fail(`Usage: lcw question [add ... | <id> pick <option> | <id> answer "<words>" | <id> used]`)
  },

  // The mark belongs to the session it is said in, run or no run; a run uses the mark of the session that drives it.
  // "80" or "80%" is a share of the week (of the weekly cap on pay-per-token billing); "5500usd", "$5500" and "5,500 USD" are dollars.
  mark() {
    const text = rest.join(' ')
    const money = parseMoney(text)
    const share = /^(\d+(?:\.\d+)?)\s*%?$/.exec(text.trim())
    const pct = share ? Number(share[1]) : NaN
    const given = money?.marked ? { usd: money.usd } : { percent: pct }
    if (!money?.marked && !(pct >= 1 && pct <= 100)) fail('Usage: lcw mark <1-100 | 80% | 5500usd>')
    const run = held
    if (!run && !sessionId) fail('lcw mark needs a session: add --session <id>.')
    if (given.usd !== undefined) {
      if (!sessionId) fail('lcw mark needs a session: add --session <id>.')
      const billing = billingOf(run?.state.driver ?? sessionId)
      if (billing !== 'subscription' && billing !== 'payg') fail('This session\'s billing isn\'t known yet, so the mark is still a share of the week.\nSay a percentage, such as “run up to 80%”, or set a dollar mark after the first reply.')
      if (billing === 'subscription') fail('This account is on a subscription, so the mark is a share of the week.\nSay a percentage, such as “run up to 80%”.')
      setSessionMark(sessionId, { usd: given.usd })
    } else if (sessionId) setSessionMark(sessionId, pct)
    const at = now()
    const view = readMoney({ sessionId: run?.state.driver ?? sessionId, now: at })
    const usage = readUsage()
    const mark = given.usd !== undefined ? dollars(given.usd) : `${pct}%`
    const confirm = given.usd !== undefined || view ? markWord(capNow(), given) : null
    if (!run) return out(...(confirm ? [confirm, ...(view && atMark(null, null, at, view) ? ['at the mark'] : [])] : [`mark ${pct}%`, weekLine(usage), atMark(pct, usage, at) ? 'at the mark' : 'ok']))
    change(run, `mark set to ${mark}`, (s) => { s.markPercent = given.usd !== undefined ? DEFAULT_MARK : pct })
    if (gateExpired(readJson(run.paths.gate), at)) fs.rmSync(run.paths.gate, { force: true })
    // on pay-per-token billing a dollar gate waits for its 08:00 try, so a mark raised over the spend lifts it here
    if (view && !atMark(null, null, at, view)) fs.rmSync(run.paths.gate, { force: true })
    const on = applyGate(run.paths, run.state, usage, at, view)
    if (confirm) return out(confirm, ...(on ? ['at the mark'] : []))
    out(`mark ${pct}%`, weekLine(usage), on ? 'at the mark' : 'ok')
  },

  cap() {
    const cap = parseMoney(rest.join(' '))
    if (!cap) fail('Usage: lcw cap <usd>')
    writeCap(cap.usd, now())
    const line = `Weekly cap ${dollars(cap.usd)}.`
    if (!sessionId || billingOf(sessionId) === 'subscription') return out(line)
    const session = readJson(sessionFile(home(), sessionId))
    if (session?.markUsd != null) return out(`${line} This session's mark stays ${dollars(session.markUsd)}.`)
    const share = session?.markPercent ?? DEFAULT_MARK
    out(`${line} This session's mark is now ${dollars(markUsdOf(session, cap.usd))} (${share}%).`)
  },

  // The command belongs to the machine, as the cap does: no run or session needed. Only this command ever runs it.
  async 'spend-command'() {
    const line = rest.join(' ').trim()
    const at = now()
    if (line === 'off') {
      const had = readSetting(home())
      clearSetting(home())
      const week = dollars(machineSpend(spendRecords(at), at).week)
      return out(had ? `Spend command off. LCW counts the spend itself again: ${week} in the last 7 days.` : `No spend command was set. LCW counts the spend itself: ${week} in the last 7 days.`)
    }
    const setting = readSetting(home())
    if (!line) {
      if (!setting) return out('No spend command set.')
      const r = readingOf(setting, readReading(home()))
      const parts = [`Spend command: ${setting.command}.`, r ? `Last reading: ${dollars(r.usd)}, ${ageText(at - r.at)} ago.` : 'No reading yet.']
      if (r && r.fails >= SPEND_COMMAND_FAILS) parts.push(`Failing since ${r.failingSince == null ? 'a while' : sinceText(r.failingSince, at)}${r.lastError ? `, it ${r.lastError}` : ''}.`)
      return out(parts.join(' '))
    }
    const result = await runCommand(line)
    if (!result.ok) {
      const clause = result.error + (/^printed ".*"$/s.test(result.error) ? ', not a dollar figure' : '')
      fail(`Not set: the command ${clause}. ${setting ? 'Your spend command stays as it was.' : 'LCW keeps its own count.'}`)
    }
    writeSetting(home(), line, at)
    recordResult(home(), line, result, at)
    claimWindow(home(), at)
    out(`Spend command set. It says ${dollars(result.usd)} for the last 7 days; LCW now takes the figure from it.`)
  },

  usage() {
    const run = findRun({ sessionId, cwd })
    const at = now()
    const usage = readUsage()
    const driver = run?.state.driver ?? sessionId
    const view = driver ? readMoney({ sessionId: driver, now: at }) : machineMoney(at)
    if (view) {
      const reached = run ? applyGate(run.paths, run.state, usage, at, view) : atMark(null, null, at, view)
      const cmd = view.command
      const cap = `of a ${dollars(view.capUsd)} cap${view.capAssumed ? ' (assumed)' : ''}`
      const todayLine = `today: ${dollars(view.todayUsd)} by ${hhmmOf(at)}, a rate of ${dollars(view.ratePerDay)} a day`
      const markLine = `mark: ${moneyMark(view)} · ${reached ? 'at the mark' : 'ok'}`
      if (cmd?.failing) {
        const total = Math.round(view.spentUsd)
        const reading = Math.round(cmd.readingUsd)
        const since = Math.round(cmd.sinceUsd)
        // the reading's oldest days drop out of the 7 days as it ages, so less of it counts than it said
        const left = total - since < reading ? `${dollars(total - since)} of the ${dollars(reading)}` : dollars(reading)
        return out(
          `last 7 days: ${dollars(total)} spent (${left} from your spend command ${ageText(at - cmd.at)} ago, plus ${dollars(since)} LCW counted since) ${cap}`,
          `spend command: failing${cmd.failingSince == null ? '' : ` since ${sinceText(cmd.failingSince, at)}`}${cmd.lastError ? `, it ${cmd.lastError}` : ''}`,
          todayLine, markLine)
      }
      const source = cmd ? `(from your spend command, ${ageText(at - cmd.at)} ago)` : 'on this machine (estimate)'
      return out(
        `last 7 days: ${dollars(view.spentUsd)} spent ${source} ${cap}`,
        `${todayLine} · rolling 7d ${dollars(view.pace.usd)} ${view.pace.short ? 'short' : 'spare'}`,
        markLine)
    }
    const w = usage?.sevenDay
    const lines = [weekLine(usage), `resets: ${w?.resetsAt ?? 'unknown'}`]
    if (run) {
      lines.push(`mark: ${run.state.markPercent}%`)
      // an expired gate stays for the mod to wake the session, but the new week may be at the mark already
      if (gateExpired(readJson(run.paths.gate), at)) lines.push(atMark(run.state.markPercent ?? DEFAULT_MARK, usage, at) ? 'at the mark' : 'the limit has reset')
      else lines.push(applyGate(run.paths, run.state, usage, at) ? 'at the mark' : 'ok')
    } else if (sessionId) {
      const mark = sessionMark(sessionId)
      lines.push(`mark: ${mark}%`, atMark(mark, usage, at) ? 'at the mark' : 'ok')
    }
    out(...lines)
  },

  pause() {
    const run = need()
    const why = rest[0] || 'human'
    if (why !== 'human' && why !== 'mark') fail('Usage: lcw pause [human|mark]')
    change(run, `paused (${why})`, (s) => { s.status = 'paused'; s.pausedReason = why; s.pausedAt = new Date(now()).toISOString() })
    out(`paused (${why})`)
  },

  resume() {
    const run = need()
    fs.rmSync(run.paths.gate, { force: true })
    change(run, 'resumed', (s) => { s.status = withYou(s.stage) ? 'with-you' : 'running'; s.pausedReason = null; s.pausedAt = null })
    out('resumed')
  },

  stop() {
    const run = need()
    if (flags.pr && !isSweep(run.state)) fail('stop --pr is for a sweep that opened its pull request; a build records it with lcw finish --pr. Nothing was changed.')
    const dropped = isSweep(run.state) ? endHunts(run.state) : null
    change(run, `stopped${flags.pr ? `, pull request ${flags.pr}` : ''}${dropped ? `; ${dropped}` : ''}`, (s) => {
      s.status = 'stopped'
      if (s.sweep) s.sweep.latest = null
      if (flags.pr) s.pr = prOf(flags.pr, s.repoRoot)
    })
    out('stopped', ...(dropped ? [dropped] : []))
  },

  finish() {
    const run = need()
    const written = readJson(`${run.dir}/totals.json`)
    const share = weekShare(run.state, readUsage()?.sevenDay)
    const spent = readMoney({ sessionId: run.state.driver ?? sessionId, now: now(), state: run.state })?.runUsd
    const dropped = isSweep(run.state) ? endHunts(run.state) : null
    change(run, `finished${dropped ? `; ${dropped}` : ''}`, (s) => {
      if (s.sweep) s.sweep.latest = null
      if (written) s.totals = { ...s.totals, agents: written.agents, tokens: written.tokens }
      if (share !== null) s.totals.sharePercent = share
      if (Number.isFinite(spent)) s.totals.usd = spent
      s.stage = 'Ship'
      s.status = 'finished'
      s.health = ''
      s.pausedReason = null
      s.finishedAt = now()
      if (flags.pr) s.pr = prOf(flags.pr, s.repoRoot)
      else if (flags.branch) s.pr = { branch: flags.branch }
    })
    out(`finished ${run.state.id}`, ...(dropped ? [dropped] : []))
  },

  worktree() {
    const run = need()
    const s = run.state
    const branch = `lcw/${s.name}`
    // a sweep's session stays in the main checkout and each wave gets its own worktree, so the sweep has only its branch
    if (isSweep(s)) {
      if (s.branch) return out(s.branch)
      const caughtUp = catchUp(s.repoRoot)
      git(s.repoRoot, 'branch', branch)
      const base = git(s.repoRoot, 'rev-parse', `refs/heads/${branch}`)
      change(run, `branch ${branch} from ${base}`, (st) => { st.branch = branch; st.base = base })
      return out(branch, ...(caughtUp ? [`note: ${caughtUp}`] : []))
    }
    if (s.worktree) return out(s.worktree)
    const caughtUp = catchUp(s.repoRoot)
    const real = addWorktree(run, `${s.repoRoot}/.claude/worktrees/${s.name}`, branch)
    const base = git(real, 'rev-parse', 'HEAD') // the commit the run branched from: reviewers read the change from it
    change(run, `worktree ${real} on ${branch} from ${base}`, (st) => { st.worktree = real; st.branch = branch; st.base = base })
    out(real, ...(caughtUp ? [`note: ${caughtUp}`] : []))
  },

  // Pictures for the pull request, put where GitHub can show them without adding them to the change:
  // one commit that holds only these files, pushed to a ref outside every branch. Prints a URL for each.
  pictures() {
    const run = need()
    if (!rest.length) fail('Usage: lcw pictures <file>...')
    const root = run.state.repoRoot
    const repo = githubRepo(root) || fail('lcw pictures needs a GitHub remote named origin. Nothing was pushed.')
    const names = rest.map((f) => path.basename(f))
    if (new Set(names).size !== names.length) fail('Two of the pictures have the same file name.')
    for (const f of rest) if (!fs.existsSync(f)) fail(`No such file: ${f}`)
    const entries = rest.map((f, i) => `100644 blob ${git(root, 'hash-object', '-w', path.resolve(f))}\t${names[i]}\n`).join('')
    const tree = execFileSync('git', ['mktree'], { cwd: root, input: entries, encoding: 'utf8' }).trim()
    const commit = git(root, 'commit-tree', tree, '-m', `docs: pictures for the pull request of ${run.state.name}`)
    git(root, 'push', '-q', '--force', 'origin', `${commit}:refs/lcw/pictures/${run.state.name}`)
    appendLedger(run.paths, `pictures pushed for the pull request: ${names.join(', ')}`, ledgerWave(run.state))
    out(...names.map((n) => `https://github.com/${repo}/raw/${commit}/${encodeURIComponent(n)}`))
  },

  runs() {
    const list = listRuns(runsDir(home(), repoKey(mainCheckout(cwd))))
    out(...(list.length ? list.map((r) => `${r.state.id}  ${r.state.title}  ${r.state.stage}  ${r.state.status}  ${r.dir}`) : ['no runs']))
  },

  where() {
    if (!flags.json) return out(need().dir)
    const main = mainCheckout(cwd)
    out(JSON.stringify({ main, key: repoKey(main), run: findRun({ sessionId, cwd })?.dir ?? null }))
  },

  // Resume on the unfinished-run box: this session takes the run over and carries on from its next step.
  take() {
    const run = need()
    bindSession(sessionId, run.dir)
    if (run.from !== sessionId) unbindSession(run.from, run.dir) // the session that drove it no longer does, even if it comes back
    change(run, 'taken over by this session (Resume)', () => {})
    out(`took over ${run.state.id}`)
    commands.status()
    const open = openWaves(run.state)
    if (open.length) out(...open.map((x) => `worktree of wave ${x.n}: ${x.worktree ?? 'none'}`))
    else out(`worktree: ${run.state.worktree ?? 'none yet'}`)
  },

  // Abandon on the unfinished-run box: stopped for good; its worktree goes only when nothing in it would be lost.
  abandon() {
    const run = need()
    const s = run.state
    const latest = isSweep(s) ? endHunts(s) : null
    change(run, 'abandoned', (st) => { st.status = 'stopped'; if (st.sweep) st.sweep.latest = null })
    const wts = worktreesOf(s)
    const lines = [`abandoned ${s.id}: stopped for good`]
    if (!wts.length && !latest) lines.push('no worktree to remove')
    for (const wt of wts) {
      lines.push(dropWorktree(s, wt))
      fs.rmSync(placeFile(home(), wt), { force: true })
    }
    if (latest) lines.push(latest)
    if (s.branch) lines.push(`${branchesOf(s).length > 1 ? 'branches' : 'branch'} kept: ${branchesOf(s).join(', ')}`)
    appendLedger(run.paths, lines.slice(1).join('; '), ledgerWave(run.state))
    out(...lines)
  },

  awake() {
    if (flags.check) {
      const run = findRun({ sessionId, cwd })
      const hold = run ? keptHold(run.dir) : null
      const can = canHold()
      return out(JSON.stringify({ canHold: can, heldByOther: can && heldByOther(hold?.pid ?? null), kept: !!hold }))
    }
    const run = need()
    withLock(run.dir, () => {
      const s = loadState(run.paths)
      if (s.status !== 'running') fail(`Run ${s.id} is ${s.status}, not running; nothing was kept awake.`)
      if (!canHold()) fail('LCW cannot keep this computer awake: it needs caffeinate on macOS, or systemd-inhibit on Linux.')
      if (keptHold(run.dir)) return out('already kept awake')
      const pid = Number(sessionId ? readJson(sessionFile(home(), sessionId))?.claudePid : NaN)
      if (!claudeAlive(pid)) fail('This session has no Claude Code process on record (claudePid in its session file), so a hold could not end with it. Nothing was kept awake.')
      if (!startHold(run.dir, pid, `LCW run ${s.name}`, now())) fail('The hold did not start. Nothing was kept awake.')
      appendLedger(run.paths, 'kept awake until the run pauses, finishes or stops, or Claude Code exits', ledgerWave(run.state))
      out('kept awake')
    })
  },

  // A repeat gives the same counts, so park and drop move the sweep's totals by what changed since the last call.
  hunt() {
    const run = need()
    sweepOnly(run)
    if (run.state.stage !== 'Hunt') fail(`lcw hunt records the Hunt stage; this sweep is in ${run.state.stage}. Nothing was changed.`)
    const given = HUNT_COUNTS.filter((k) => flags[k] !== undefined).map((k) => [k, wholeNumber(flags[k], `--${k}`)])
    if (!given.length) fail(`Usage: lcw hunt ${HUNT_COUNTS.map((k) => `[--${k} N]`).join(' ')}`)
    const sorted = given.some(([k]) => ['fix', 'park', 'drop'].includes(k))
    const apply = (s) => {
      const w = s.sweep
      for (const [k, n] of given) {
        if (k === 'park') w.parked += n - w.hunt.park
        if (k === 'drop') w.dropped += n - w.hunt.drop
        w.hunt[k] = n
      }
      if (sorted) w.sorted = true
    }
    const line = given.map(([k, n]) => `${k} ${n}`).join(', ')
    // progress is reported often and would drown the ledger; the sorting is noted
    if (sorted) change(run, `hunt, round ${run.state.sweep.round}: ${line}`, apply)
    else { apply(run.state); saveState(run.paths, run.state) }
    out(`hunt: ${line}`)
  },

  wave() {
    const run = need()
    const w = sweepOnly(run)
    const s = run.state
    const [sub, ...words] = rest
    if (sub === 'add') {
      if (!words.length) fail('Usage: lcw wave add <fixes> [<fixes> ...]')
      const sizes = words.map((x) => wholeNumber(x, 'A wave'))
      if (sizes.includes(0)) fail('A wave holds at least one fix. Nothing was changed.')
      const queued = w.waves.filter((x) => x.status === 'queued')
      if (queued.length) fail(`Waves ${queued.map((x) => x.n).join(', ')} are already queued; a new round's waves are added once none is. Nothing was changed.`)
      const first = w.waves.length + 1
      change(run, `waves queued: ${sizes.map((f, i) => `${first + i} (${f} fixes)`).join(', ')}`, (st) => {
        sizes.forEach((fixes, i) => st.sweep.waves.push({ n: first + i, fixes, status: 'queued', branch: null, pr: null, merged: false, dropped: 0 }))
      })
      return out(`queued waves ${first}${sizes.length > 1 ? `-${first + sizes.length - 1}` : ''}`)
    }
    if (sub === 'start') {
      if (!s.branch) fail('The sweep has no branch yet: run lcw worktree first. Nothing was changed.')
      const open = openWaves(s)
      const newest = open.at(-1)
      if (newest?.status === 'running' && !isBuilt(newest)) fail(`Wave ${newest.n} is in ${newest.stage}; the next wave starts once it is built and in Review. Nothing was changed.`)
      const busy = open.filter((x) => x.status === 'running' && BUSY.includes(x.stage))
      if (busy.length >= 2) fail(`Waves ${busy.map((x) => x.n).join(' and ')} are being built or reviewed, and at most two are at once; the next wave starts once one of them holds in Ship. Nothing was changed.`)
      const next = w.waves.find((x) => x.status === 'queued') || fail('No wave is queued: queue one with lcw wave add. Nothing was changed.')
      const after = newest?.branch ?? s.branch
      const from = takesFrom(s, after)
      const branch = `${s.branch}-wave-${next.n}`
      const wanted = `${s.repoRoot}/.claude/worktrees/${s.name}-wave-${next.n}`
      let worktree
      try { worktree = addWorktree(run, wanted, branch, from) } catch (e) { fail(`git could not make the worktree ${wanted} on ${branch} from ${from}: ${firstLine(e)}. Nothing was changed.`) }
      const base = git(s.repoRoot, 'rev-parse', `refs/heads/${branch}`)
      const dir = waveDir(run.dir, next.n)
      fs.mkdirSync(dir, { recursive: true })
      for (const f of ['plan.md', 'ledger.md']) if (!fs.existsSync(`${dir}/${f}`)) fs.writeFileSync(`${dir}/${f}`, '')
      change(run, `wave ${next.n} started in ${worktree} on ${branch} from ${after} at ${base}`, (st) => {
        Object.assign(next, {
          status: 'running', branch, stage: 'Plan', stageSince: now(), step: null, round: 0, waiting: false,
          tasks: [], requirements: [], plan: freshPlan(), milestone: null, worktree, after, base, checked: null,
        })
        Object.assign(st, { tasks: [], requirements: [], plan: freshPlan(), milestone: null })
        enterStage(st, 'Plan')
      }, next)
      return out(`wave ${next.n} on ${branch}`, `worktree: ${worktree}`, `plan: ${dir}/plan.md`, ...changedFiles(s, open))
    }
    if (sub === 'files') return out(...changedFiles(s, openWaves(s)))
    if (sub === 'round') {
      const wave = mustRun(waveOf(s) || fail('No wave is open. Nothing was changed.'))
      if (wave.stage !== 'Review') fail(`Wave ${wave.n} is in ${wave.stage}; a review round is raised in Review. Nothing was changed.`)
      const to = words.length ? wholeNumber(words[0], 'lcw wave round') : (wave.round ?? 0) + 1
      if (to < 1) fail('A review round is 1 or more. Nothing was changed.')
      // a number at or under the round it is at puts a mistaken raise right, and starts no round
      if (to > (wave.round ?? 0)) mustHoldRange(s, wave, 'another review round')
      change(run, `wave ${wave.n}: review round ${to}`, () => { wave.round = to }, wave)
      return out(`wave ${wave.n}: round ${wave.round}`)
    }
    if (sub === 'step') {
      const step = words.join(' ')
      if (!STEPS[step]) fail(`Usage: lcw wave step <${Object.keys(STEPS).join('|')}> [--wave n]`)
      const wave = mustRun(waveOf(s) || fail('No wave is open. Nothing was changed.'))
      if (STEPS[step] !== true && wave.stage !== STEPS[step]) fail(`The step ${step} is in ${STEPS[step]}; wave ${wave.n} is in ${wave.stage}. Nothing was changed.`)
      let checked = null
      // one wave's final checks at a time, in order: each earlier wave's have passed on the head it holds now, and this wave runs on all of them
      const earlier = openWaves(s).filter((x) => x.n < wave.n && x.status === 'running')
      const inOrder = (what) => {
        const before = earlier.find((x) => x.step !== 'merging' || tipOf(s, x) !== x.checked)
        if (before?.step === 'merging') fail(`Wave ${before.n}'s head moved from ${before.checked} to ${tipOf(s, before)} after its final checks passed, so they do not count until they run again on its settled head; ${what} must wait for them. Nothing was changed.`)
        if (before) fail(`Wave ${before.n}'s final checks have not passed yet (it is in ${before.stage}${before.step ? `, ${before.step}` : ''}); final checks run one wave at a time, in order. Nothing was changed.`)
        if (!hasTakenIn(s, wave)) fail(notTakenIn(s, wave, what))
        const behind = lagging(s, wave)
        if (behind) fail(`${behind.why}, so ${what} would pass on work that is not its own. ${behind.how}, then lcw wave take --wave ${wave.n}. Nothing was changed.`)
      }
      if (step === 'final checks') {
        const running = (wave.tasks ?? []).filter((t) => t.status === 'running')
        if (running.length) fail(`Wave ${wave.n}'s ${running.length > 1 ? 'tasks' : 'task'} ${running.map((t) => t.id).join(', ')} ${running.length > 1 ? 'are' : 'is'} still running; its final checks start on a settled head, once every worker has reported. Nothing was changed.`)
        inOrder('its final checks')
        checked = tipOf(s, wave)
      }
      if (step === 'merging') {
        const tip = tipOf(s, wave)
        if (wave.step === 'final checks' && wave.checked) {
          if (tip !== wave.checked) fail(`${wave.branch} moved from ${wave.checked} to ${tip} while its final checks ran, so they do not count; run them again on the settled head. Nothing was changed.`)
        } else {
          inOrder('its merge')
          // a wave with nothing of its own beyond what it took in sits on the head the wave before it was checked on
          const under = earlier.at(-1)?.checked ?? git(s.repoRoot, 'rev-parse', `refs/heads/${s.branch}`)
          if (tip !== under) fail(`Wave ${wave.n} has no final checks running; they pass before it merges. Nothing was changed.`)
        }
        checked = tip
      }
      change(run, `wave ${wave.n} step: ${step}${checked ? ` at ${checked}` : ''}`, (st) => {
        if (step !== 'merging' && (wave.step === 'final checks' || wave.step === 'merging')) clearLater(st, wave)
        Object.assign(wave, { step: step === 'none' ? null : step, checked })
      }, wave)
      return out(`wave ${wave.n} step ${step}${checked ? ` at ${checked}` : ''}`)
    }
    if (sub === 'take') {
      const wave = mustRun(waveOf(s) || fail('No wave is open. Nothing was changed.'))
      const wt = wave.worktree && fs.existsSync(wave.worktree) ? wave.worktree : fail(`Wave ${wave.n} has no worktree to merge in. Nothing was changed.`)
      const running = (wave.tasks ?? []).filter((t) => t.status === 'running')
      if (running.length) fail(`Wave ${wave.n}'s ${running.length > 1 ? 'tasks' : 'task'} ${running.map((t) => t.id).join(', ')} ${running.length > 1 ? 'are' : 'is'} still running, and a worker may be committing in ${wt}; wait for ${running.length > 1 ? 'them' : 'it'} to report, then lcw wave take --wave ${wave.n} again. Nothing was changed.`)
      // only the wave just before, once it holds everything beneath it, so each review range's merge base stays that wave's tip
      const prev = openWaves(s).filter((x) => x.n < wave.n && x.status === 'running').at(-1)
      const behind = lagging(s, wave)
      if (behind) fail(`${behind.why}, and a wave takes in only the wave before it, oldest first. ${behind.how}, then lcw wave take --wave ${wave.n} again. Nothing was changed.`)
      const from = prev?.branch ?? s.branch
      const had = tipOf(s, wave)
      if (!contains(s, from, wave.branch)) {
        // a wave with no commits of its own fast-forwards, so it still ships empty
        let own = true
        try { git(wt, 'merge-base', '--is-ancestor', 'HEAD', from); own = false } catch {}
        try { git(wt, 'merge', own ? '--no-ff' : '--ff-only', '--no-edit', '-q', from) } catch (e) {
          let conflicted = ''
          try { git(wt, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'); conflicted = git(wt, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean).join(', ') } catch {}
          try { git(wt, 'merge', '--abort') } catch {}
          if (!conflicted) fail(`git could not merge ${from} into ${wave.branch}: ${firstLine(e)}. Nothing was changed.`)
          // the resolution is new work no round's range shows, so the ledger keeps that it waits for review
          appendLedger(run.paths, `wave ${wave.n}: taking ${from} conflicts in ${conflicted}; a worker resolves it, and its resolution waits for review`, wave)
          fail(`Taking ${from} into ${wave.branch} conflicts in ${conflicted}, so the merge was undone, and wave ${wave.n}'s ledger records the conflict. A worker runs git merge --no-ff ${from} in ${wt}, on ${wave.branch}, resolves it and commits; then lcw wave take --wave ${wave.n} again.`)
        }
      }
      const tip = tipOf(s, wave)
      const note = tip === had ? `wave ${wave.n} had ${from} already` : `wave ${wave.n} took in ${from}: ${wave.branch} now at ${tip}`
      change(run, note, () => {}, wave)
      return out(note)
    }
    if (sub === 'defer') {
      const wave = mustRun(waveOf(s) || fail('No wave is open. Nothing was changed.'))
      const k = wholeNumber(words[0], 'lcw wave defer')
      if (k < 1 || k > wave.fixes) fail(`Wave ${wave.n} holds ${wave.fixes} fixes, so it defers 1 to ${wave.fixes} of them. Nothing was changed.`)
      const later = w.waves.find((x) => x.status === 'queued')
      const n = later?.n ?? w.waves.length + 1
      change(run, `wave ${wave.n}: ${k} fixes deferred to wave ${n}`, (st) => {
        wave.fixes -= k
        if (later) later.fixes += k
        else st.sweep.waves.push({ n, fixes: k, status: 'queued', branch: null, pr: null, merged: false, dropped: 0 })
      }, wave)
      return out(`wave ${wave.n}: ${wave.fixes} fixes; wave ${n} queued with ${later?.fixes ?? k}`)
    }
    if (sub === 'shipped') {
      const wave = mustRun(waveOf(s) || fail('No wave is running. Nothing was changed.'))
      if (wave.stage !== 'Ship') fail(`A wave ships in Ship; wave ${wave.n} is in ${wave.stage}. Nothing was changed.`)
      if (wave.step !== 'merging') fail(`Wave ${wave.n}'s final checks have not passed${wave.step ? ` (it is at ${wave.step})` : ''}: lcw wave step "final checks" when they start, then lcw wave step merging. Nothing was changed.`)
      const before = w.waves.find((x) => x.n < wave.n && x.status !== 'shipped')
      if (before) fail(`Wave ${before.n} has not shipped yet, and waves land in order. Nothing was changed.`)
      if (flags.pr !== undefined && s.sweep.prs === 'end') fail('The charter chose one pull request at the end, so a wave has no pull request of its own. Nothing was changed.')
      const pr = flags.pr === undefined ? null : prOf(flags.pr).number || fail(`--pr takes the pull request's number, not ${flags.pr}. Nothing was changed.`)
      const root = s.repoRoot
      const tip = tipOf(s, wave)
      if (tip !== wave.checked) fail(`${wave.branch} moved from ${wave.checked} to ${tip} since its final checks started, so they do not count; run them again on the settled head. Nothing was changed.`)
      // every fix dropped or parked: nothing to land, so no pull request and nothing for the waves after it to wait on
      const empty = Number(git(root, 'rev-list', '--count', `${s.branch}..${tip}`)) === 0
      if (empty && pr) fail(`${wave.branch} has no commits, so there is no pull request to record. Nothing was changed.`)
      try { git(root, 'merge-base', '--is-ancestor', s.branch, tip) } catch { fail(`${s.branch} has commits ${wave.branch} does not, so it cannot fast-forward to the wave. Nothing was changed.`) }
      // a sweep from before waves had worktrees of their own may keep one on its branch, and git moves a checked-out branch only there
      let oldOnBranch = false
      try { oldOnBranch = Boolean(s.worktree) && git(s.worktree, 'symbolic-ref', '-q', 'HEAD') === `refs/heads/${s.branch}` } catch {}
      try {
        if (oldOnBranch) git(s.worktree, 'merge', '--ff-only', '-q', tip)
        else git(root, 'branch', '-f', s.branch, tip)
      } catch (e) { fail(`git could not move ${s.branch} to ${tip}: ${firstLine(e)}. Nothing was changed.`) }
      const fixed = wave.requirements.filter((r) => r.status === 'pass').length
      const partial = wave.requirements.filter((r) => r.status === 'partial').length
      // the newest shipped wave's worktree holds the sweep's latest work; an earlier one's goes once nothing in it would be lost
      const cleared = w.waves.filter((x) => x.n < wave.n && x.status === 'shipped' && x.worktree).map((x) => {
        const said = dropWorktree(s, x.worktree)
        const gone = !fs.existsSync(x.worktree)
        if (gone) fs.rmSync(placeFile(home(), x.worktree), { force: true })
        return { x, said, gone }
      })
      const note = `wave ${wave.n} shipped${empty ? ' empty, with no commits' : ''}: ${s.branch} now at ${tip}; ${fixed} fixed, ${partial ? `${partial} partly fixed, ` : ''}${wave.dropped} dropped${pr ? `; PR #${pr}` : ''}${cleared.map((c) => `; ${c.said}`).join('')}`
      change(run, note, (st) => {
        for (const c of cleared) if (c.gone) c.x.worktree = null
        Object.assign(wave, { status: 'shipped', pr, fixed, ...(partial ? { partial } : {}), ...(empty ? { empty: true } : {}) })
        st.sweep.fixed += fixed
        st.sweep.partial = (st.sweep.partial ?? 0) + partial
        st.sweep.dropped += wave.dropped
      }, wave)
      return out(note)
    }
    if (sub === 'pr') {
      const [n, ref] = words
      if (words.length !== 2) fail('Usage: lcw wave pr <n> <number|url>')
      const wave = w.waves.find((x) => x.n === wholeNumber(n, 'lcw wave pr')) || fail(`No wave ${n}. Nothing was changed.`)
      if (wave.status !== 'shipped') fail(`Wave ${wave.n} is ${wave.status}; a pull request is recorded once it has shipped. Nothing was changed.`)
      if (wave.empty) fail(`Wave ${wave.n} shipped with no commits, so it has no pull request. Nothing was changed.`)
      if (wave.pr) fail(`Wave ${wave.n} has pull request #${wave.pr} already. Nothing was changed.`)
      if (w.prs === 'end') fail('The charter chose one pull request at the end, so a wave has no pull request of its own. Nothing was changed.')
      const pr = prOf(ref).number || fail(`A pull request is its number or its URL, not ${ref}. Nothing was changed.`)
      change(run, `wave ${wave.n}: PR #${pr}`, () => { wave.pr = pr }, wave)
      return out(`wave ${wave.n}: PR #${pr}`)
    }
    fail('Usage: lcw wave add <fixes> ... | wave start | wave files | wave defer <k> | wave take | wave round | wave step <closures|final checks|merging|none> | wave shipped [--pr <number>] | wave pr <n> <number|url>, each acting on one wave taking [--wave <n>]')
  },

  merge() {
    const run = need()
    const w = sweepOnly(run)
    const n = wholeNumber(rest[0], 'lcw merge')
    if (w.prs !== 'merged') fail(`The charter's pull request choice is ${PR_CHOICES[w.prs] ?? 'not made yet'}, not merged as it goes, so the sweep merges nothing. Nothing was changed.`)
    const wave = w.waves.find((x) => x.n === n) || fail(`No wave ${n}. Nothing was changed.`)
    if (wave.empty) fail(`Wave ${n} shipped with no commits, so it has no pull request to merge. Nothing was changed.`)
    if (wave.status !== 'shipped' || !wave.pr) fail(`Wave ${n} is ${wave.status}${wave.pr ? '' : ' with no pull request'}; only a shipped wave's pull request is merged. Nothing was changed.`)
    if (wave.merged) fail(`Wave ${n}'s pull request #${wave.pr} is merged already. Nothing was changed.`)
    const open = w.waves.filter((x) => x.n < n && !x.merged && !x.empty) // an empty wave has nothing to land
    if (open.length) fail(`Wave ${open[0].n} is not merged yet; waves merge in order. Nothing was changed.`)
    const root = run.state.repoRoot
    const repo = githubRepo(root) || fail('lcw merge needs a GitHub remote named origin. Nothing was merged.')
    const pr = String(wave.pr)
    let view, main
    try {
      view = JSON.parse(gh(root, 'pr', 'view', pr, '-R', repo, '--json', 'state,isDraft,baseRefName'))
      main = JSON.parse(gh(root, 'repo', 'view', repo, '--json', 'defaultBranchRef')).defaultBranchRef.name
    } catch (e) { fail(`gh could not read #${pr}: ${firstLine(e)}. Nothing was recorded.`) }
    // merged into an earlier wave's branch whose delete failed, so GitHub never retargeted it
    if (view.state === 'MERGED' && view.baseRefName !== main) fail(`#${pr} was merged into ${view.baseRefName}, not the default branch ${main}, so its changes have not landed; it needs you. Nothing was recorded and its branch is kept.`)
    // merged earlier but never recorded: go on to the branch, do not merge twice
    if (view.state !== 'MERGED') {
      // the next wave's pull request is opened on this wave's branch, and GitHub retargets it only when that branch is deleted
      if (view.baseRefName !== main) fail(`#${pr} is based on ${view.baseRefName}, not the default branch ${main}; retarget it to ${main} first (gh pr edit ${pr} -R ${repo} --base ${main}). Nothing was merged or recorded.`)
      let state, readied = false, back = ''
      try {
        if (view.isDraft) { gh(root, 'pr', 'ready', pr, '-R', repo); readied = true }
        try { gh(root, 'pr', 'merge', pr, '-R', repo, '--merge') } catch (e) {
          // a refused merge leaves it as it was; a queued one exits 0 and is not undone
          if (readied) try { gh(root, 'pr', 'ready', pr, '-R', repo, '--undo'); back = ' It is a draft again.' } catch { back = ' It is still marked ready for review, not a draft.' }
          throw e
        }
        state = JSON.parse(gh(root, 'pr', 'view', pr, '-R', repo, '--json', 'state')).state
      } catch (e) { fail(`gh could not merge #${pr}: ${firstLine(e)}. Nothing was recorded.${back}`) }
      // a merge queue or required checks: gh returns once the merge is queued, and deleting the branch now would close it unmerged
      if (state !== 'MERGED') fail(`#${pr} is not merged yet: GitHub shows it ${state}, queued or waiting on checks. Nothing was recorded and its branch is kept; run lcw merge ${n} again once it is merged.`)
    }
    // gh's --delete-branch and git's push --delete would touch local refs, and the wave's branch is checked out in the sweep's worktree
    let left = ''
    try { gh(root, 'api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${wave.branch}`) } catch (e) {
      if (!/Reference does not exist|HTTP 404/.test(String(e.stderr || e.message))) left = `, its remote branch ${wave.branch} is left (${firstLine(e)})`
    }
    change(run, `wave ${n} merged: PR #${pr} with a merge commit${left || ', its remote branch deleted'}`, () => { wave.merged = true }, wave)
    out(`merged wave ${n}: #${pr}${left}`)
  },
}

/** A pull request given as a number or a URL; a bare number gets its URL when the repository's remote is on GitHub. */
function prOf(text, root) {
  const bare = /^\d+$/.test(text)
  const number = Number(bare ? text : /\/pull\/(\d+)/.exec(text)?.[1]) || null
  const repo = bare && root ? githubRepo(root) : null
  return { number, url: bare ? (repo ? `https://github.com/${repo}/pull/${text}` : null) : text }
}

/** Only the charter's own settings can be set in a sweep, each within its range; the rest move with lcw hunt and lcw wave. */
function checkSweepSetting(s, key, value) {
  if (!isSweep(s)) fail(`Cannot set ${key}: run ${s.id} is a build. Nothing was changed.`)
  const ok = {
    'sweep.charter': Number.isInteger(value) && value >= 0 && value <= 10,
    'sweep.open': Number.isInteger(value) && value >= 0,
    'sweep.prs': Object.hasOwn(PR_CHOICES, value),
  }
  if (!(key in ok)) fail(`Cannot set ${key}; set only sweep.charter, sweep.open and sweep.prs. Nothing was changed.`)
  if (!ok[key]) fail(`${key} is ${{ 'sweep.charter': 'a whole number from 0 to 10', 'sweep.open': 'a whole number', 'sweep.prs': 'stacked, merged or end' }[key]}, not ${JSON.stringify(value)}. Nothing was changed.`)
}

/** A new worktree on a new branch, kept out of the main checkout's git status, where lcw finds this run. Returns its real path. */
function addWorktree(run, dir, branch, from) {
  const root = run.state.repoRoot
  git(root, 'worktree', 'add', '-b', branch, dir, ...(from ? [from] : []))
  const exclude = path.resolve(root, git(root, 'rev-parse', '--git-path', 'info/exclude'))
  fs.mkdirSync(path.dirname(exclude), { recursive: true })
  const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
  if (!text.split('\n').includes('.claude/worktrees/')) fs.appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}.claude/worktrees/\n`)
  const real = fs.realpathSync(dir)
  writeJson(placeFile(home(), real), { runDir: run.dir })
  return real
}

/**
 * The files the given waves have changed, each over its review range, so not what it took in: a fix planned in a later
 * wave must not need one. A wave at merging is left out: its head is settled, and the next wave is cut from it.
 */
function changedFiles(s, waves) {
  const by = new Map()
  for (const w of waves) {
    if (!w.after || !w.branch || w.step === 'merging') continue
    for (const f of git(s.repoRoot, 'diff', '--name-only', `refs/heads/${takesFrom(s, w.after)}...refs/heads/${w.branch}`).split('\n').filter(Boolean)) by.set(f, [...(by.get(f) ?? []), w.n])
  }
  const files = [...by].sort(([a], [b]) => a.localeCompare(b)).map(([f, ns]) => `  ${f} (wave ${ns.join(', ')})`)
  return [files.length ? 'files the open waves have changed:' : 'files the open waves have changed: none', ...files]
}

/** What entering a stage does to the run itself. */
function enterStage(s, stage) {
  s.stage = stage
  s.stageSince = now()
  s.approval = null // asked for the playback of this Brainstorm only
  s.milestone = null // the build sets it again for each milestone it launches
  if (withYou(stage)) s.status = 'with-you'
  else s.status = 'running'
  s.pausedReason = null
  s.pausedAt = null
}

/** lcw stage for one of a sweep's open waves: its own stage, and the run's stage follows the newest open wave. */
function waveStage(run, wave, stage) {
  if (wave.stage === stage) return out(`wave ${wave.n} stage ${stage}`) // already there: a repeat must not clear its step, checked head or the later waves' checks
  if (stage === 'Review') mustHoldRange(run.state, wave, 'its review')
  if (stage === 'Ship' && wave.stage === 'Review') {
    mustHoldRange(run.state, wave, 'leaving Review')
    // a fix set back for a later round and never given its verdict again would ship uncounted
    const open = (wave.requirements ?? []).filter((r) => r.status === 'todo' || r.status === 'failing')
    if (open.length) fail(`Wave ${wave.n} cannot leave Review with ${open.map((r) => `${r.id} ${r.status}`).join(', ')}: record each fix as it stands, lcw req <id> pass|partial --wave ${wave.n}, or take it out with lcw req <id> park|drop --wave ${wave.n}. Nothing was changed.`)
  }
  if (wave.stage === 'Ship' && BUSY.includes(stage)) {
    const busy = openWaves(run.state).filter((x) => x !== wave && x.status === 'running' && BUSY.includes(x.stage))
    if (busy.length >= 2) fail(`Waves ${busy.map((x) => `${x.n} (${x.stage})`).join(' and ')} are being built or reviewed, and at most two are at once; wave ${wave.n} goes back to ${stage} once one of them holds in Ship. Nothing was changed.`)
  }
  change(run, `wave ${wave.n} stage: ${stage}`, (s) => {
    if (stage === 'Review' && !wave.round) wave.round = 1 // a later round is raised by lcw wave round
    // its final checks no longer count, and nor do those of the waves after it, which ran on top of it
    if (wave.step === 'final checks' || wave.step === 'merging') clearLater(s, wave)
    Object.assign(wave, { stage, stageSince: now(), step: null, milestone: null, checked: null })
    const { stage: was, stageSince: since } = s
    enterStage(s, stage)
    if (was === 'Hunt') Object.assign(s, { stage: was, stageSince: since })
    mirror(s)
  }, wave)
  out(`wave ${wave.n} stage ${stage}`)
}

/** The branches a wave must hold, directly or through the wave before it: the sweep's own, which holds the shipped waves, and every earlier open wave's. */
const takeIns = (s, w) => [s.branch, ...openWaves(s).filter((x) => x.n < w.n && x.status === 'running').map((x) => x.branch)]
const contains = (s, from, branch) => { try { git(s.repoRoot, 'merge-base', '--is-ancestor', `refs/heads/${from}`, `refs/heads/${branch}`); return true } catch { return false } }
const missingFrom = (s, w) => takeIns(s, w).filter((b) => !contains(s, b, w.branch))
/** Whether a wave's branch holds all the work now on the branches it takes in. */
const hasTakenIn = (s, w) => missingFrom(s, w).length === 0
/** When the wave just before w does not itself hold everything beneath it, w must not take in or merge anything until it does: why, and which take-ins to run first. */
function lagging(s, w) {
  const earlier = openWaves(s).filter((x) => x.n < w.n && x.status === 'running')
  const prev = earlier.at(-1)
  if (!prev || hasTakenIn(s, prev)) return null
  const first = earlier.find((x) => !hasTakenIn(s, x))
  return { why: `Wave ${prev.n}, the wave before wave ${w.n}, has not taken in the latest of ${missingFrom(s, prev).join(', ')}`, how: `Run lcw wave take --wave ${first.n} first${first === prev ? '' : ', then each later wave in turn'}` }
}
/** Fails unless w holds every branch it takes in and the wave before it is not lagging, so its review range shows only its own work. */
function mustHoldRange(s, w, what) {
  if (!hasTakenIn(s, w)) fail(notTakenIn(s, w, what))
  const behind = lagging(s, w)
  if (behind) fail(`${behind.why}, so wave ${w.n}'s review range would show work that is not its own. ${behind.how}, then lcw wave take --wave ${w.n}. Nothing was changed.`)
}
const notTakenIn = (s, w, what) => `Wave ${w.n} has not taken in the latest of ${missingFrom(s, w).join(', ')}; take it in with lcw wave take --wave ${w.n} before ${what}. Nothing was changed.`

/** The later open waves' final checks ran on top of this wave as it was, so they no longer count. */
function clearLater(s, wave) {
  for (const x of openWaves(s)) if (x.n > wave.n && x.status === 'running' && (x.step === 'final checks' || x.step === 'merging')) Object.assign(x, { step: null, checked: null })
}

const tipOf = (s, w) => git(s.repoRoot, 'rev-parse', `refs/heads/${w.branch}`)

/** The fixes a wave holds: the count it was queued with, or more once findings joined it on the way. */
const fixesIn = (x) => Math.max(x.fixes ?? 0, (x.requirements?.length ?? 0) + (x.dropped ?? 0))

/** A sweep's part of lcw status: the pull request choice, the round, each wave, each open wave's own records and its files. */
function sweepStatus(run) {
  const s = run.state
  const w = s.sweep
  return [
    `pull requests: ${PR_CHOICES[w.prs] ?? 'not chosen yet'}  round: ${w.round}${s.stage === 'Hunt' && w.early?.length ? ` (early: wave ${w.early.join(', ')} was short of Ship when it started, so it cannot end the sweep)` : ''}  fixed: ${w.fixed}  ${w.partial ? `partly fixed: ${w.partial}  ` : ''}parked: ${w.parked}  dropped: ${w.dropped}`,
    'waves:', ...(w.waves.length ? w.waves.map((x) => `  ${x.n} [${x.status}] ${fixesIn(x)} fixes  branch: ${x.branch ?? 'none yet'}  ${x.pr ? `PR #${x.pr} ${x.merged ? 'merged' : 'not merged'}` : x.empty ? 'empty, no PR' : 'no PR'}`) : ['  none queued']),
    ...openWaves(s).flatMap((x) => waveStatus(run, x)),
    // a hunt round reads its own worktree of every open wave's work; otherwise the newest wave's worktree holds the latest
    `latest work: ${s.stage === 'Hunt' && w.latest && fs.existsSync(w.latest) ? w.latest : [...w.waves].reverse().find((x) => x.worktree && fs.existsSync(x.worktree))?.worktree ?? s.repoRoot}`,
    `folder: ${run.dir}`, `charter: ${run.dir}/charter.md`, `findings: ${run.dir}/findings.md`, `parked: ${run.dir}/parked.md`, `ledger: ${run.paths.ledger}`,
  ]
}

/** One open wave in lcw status: where it stands, where its work is, what its review reads, and its own lists. */
function waveStatus(run, x) {
  const where = [x.stage, x.step, x.round ? `round ${x.round}` : '', x.waiting ? 'waits on an answer' : ''].filter(Boolean).join(', ')
  const dir = waveDir(run.dir, x.n)
  return [
    `wave ${x.n}: ${where}  branch: ${x.branch}  worktree: ${x.worktree ?? 'none'}${x.checked ? `  final checks on: ${x.checked}` : ''}`,
    `  review range: git diff ${takesFrom(run.state, x.after)}...${x.branch}`,
    `  plan: ${dir}/plan.md`, `  ledger: ${dir}/ledger.md`,
    '  tasks:', ...((x.tasks ?? []).length ? x.tasks.map((t) => `    ${t.id} [${t.status}] ${t.title}`) : ['    none']),
    '  requirements:', ...((x.requirements ?? []).length ? x.requirements.map((r) => `    ${r.id} [${r.status}] ${r.name}`) : ['    none']),
  ]
}

const latestDir = (s) => `${s.repoRoot}/.claude/worktrees/${s.name}-latest`

/** Removes the hunt's throwaway worktree, if there is one; says what became of it. It holds nothing of its own to lose. */
function dropLatest(s) {
  const dir = latestDir(s)
  if (!fs.existsSync(dir)) return null
  try { git(s.repoRoot, 'worktree', 'remove', '--force', dir) } catch (e) { return `worktree kept: ${dir}, because git would not remove it: ${firstLine(e)}` }
  return `worktree removed: ${dir}`
}

const huntRefs = (s) => git(s.repoRoot, 'for-each-ref', '--format=%(refname)', `refs/lcw/${s.name}/hunt-*`).split('\n').filter(Boolean)

/** Ends the sweep's hunts: removes the hunt's worktree and the refs that kept each round's commit; says what became of the worktree. */
function endHunts(s) {
  // a deleted repo folder has no hunt left to clear, and must not stop the run from being marked
  if (!fs.existsSync(s.repoRoot)) return null
  const said = dropLatest(s)
  try { for (const ref of huntRefs(s)) git(s.repoRoot, 'update-ref', '-d', ref) } catch {}
  return said
}

/**
 * A fresh detached worktree for hunt round `round` while waves are open: the newest open wave's tip with each earlier open
 * wave's merged in, committed only there, so probes read every wave's latest fixes and closures. On a conflict it
 * holds the newest wave's tip alone. Its head is kept under refs/lcw/<name>/hunt-<round>, since the next round diffs
 * against it after this worktree is gone; the round before's ref stays too, for this round's own diff. Returns { dir, note }, or null when no wave is open.
 */
function freshLatest(s, round) {
  const was = dropLatest(s)
  if (was?.startsWith('worktree kept')) fail(`The hunt's worktree from the last round could not be refreshed: ${was}. Nothing was changed.`)
  const open = openWaves(s)
  if (!open.length) return null
  const newest = open.at(-1)
  const dir = latestDir(s)
  try { git(s.repoRoot, 'worktree', 'add', '-q', '--detach', dir, `refs/heads/${newest.branch}`) } catch (e) { fail(`git could not make the worktree ${dir}: ${firstLine(e)}. Nothing was changed.`) }
  const real = fs.realpathSync(dir)
  const tip = git(real, 'rev-parse', 'HEAD')
  // this round diffs against the last round's commit, which may exist only there, so the two newest refs stay
  const kept = () => {
    const head = git(real, 'rev-parse', 'HEAD')
    const ref = `refs/lcw/${s.name}/hunt-${round}`
    git(s.repoRoot, 'update-ref', ref, head)
    for (const old of huntRefs(s)) if (old !== ref && old !== `refs/lcw/${s.name}/hunt-${round - 1}`) git(s.repoRoot, 'update-ref', '-d', old)
    return head
  }
  for (const x of open.slice(0, -1)) {
    try { git(real, 'merge-base', '--is-ancestor', `refs/heads/${x.branch}`, 'HEAD'); continue } catch {}
    try { git(real, '-c', 'user.name=LCW', '-c', 'user.email=lcw@localhost', 'merge', '--no-ff', '--no-edit', '--no-verify', '-q', `refs/heads/${x.branch}`) } catch (e) {
      let conflicted = ''
      try { conflicted = git(real, 'diff', '--name-only', '--diff-filter=U') } catch {}
      try { git(real, 'merge', '--abort') } catch {}
      if (!conflicted) {
        const gone = dropLatest(s) ?? `worktree ${real} was already gone`
        fail(`git could not merge ${x.branch} into the hunt's worktree: ${firstLine(e)}. The stage was not changed; ${gone}.`)
      }
      git(real, 'reset', '-q', '--hard', tip)
      kept()
      return { dir: real, note: `latest work: ${real}, with only wave ${newest.n}'s tip ${tip}, because merging wave ${x.n} into it conflicts; it lacks wave ${x.n}'s later work` }
    }
  }
  return { dir: real, note: `latest work: ${real}, at ${kept()}, holding every open wave's work` }
}

/** A run's worktrees: a build's own, and in a sweep each wave's that is still there to remove. */
const worktreesOf = (s) => [...new Set([s.worktree, ...(s.sweep?.waves ?? []).map((w) => w.worktree)].filter(Boolean))]

/** Removes one of a run's worktrees when nothing in it would be lost, keeping its branch; says what became of it. */
function dropWorktree(s, wt) {
  if (!fs.existsSync(wt)) return `worktree ${wt} was already gone`
  const why = keepWorktree(s, wt)
  if (why) return `worktree kept: ${wt}, because ${why}`
  try { git(s.repoRoot, 'worktree', 'remove', wt) } catch (e) { return `worktree kept: ${wt}, because git would not remove it: ${firstLine(e)}` }
  return `worktree removed: ${wt}`
}

/** Why one of a run's worktrees must stay, or null when removing it loses nothing. */
function keepWorktree(s, wt) {
  const here = fs.realpathSync(cwd)
  if (inside(here, wt)) return 'this session is in it'
  if (sessionFolders().some((p) => inside(p, wt))) return 'an open Claude Code session is in it'
  try {
    // every untracked file, whatever status.showUntrackedFiles says: git worktree remove would delete them
    if (git(wt, 'status', '--porcelain', '--untracked-files=all')) return 'it has uncommitted or untracked files'
    // git worktree remove deletes ignored files, such as a .env, without asking. A wave's worktree is the sweep's own:
    // only its agents wrote there, so what it ignores (an environment, caches) can be made again and does not hold it
    const ofWave = (s.sweep?.waves ?? []).some((w) => w.worktree === wt)
    const ignored = ofWave ? [] : git(wt, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory').split('\n').filter(Boolean)
    if (ignored.length) return `it holds ignored files such as ${ignored.slice(0, 2).join(', ')}, so it is left for you`
    if (!branchesOf(s).map((b) => `refs/heads/${b}`).includes(git(wt, 'symbolic-ref', '-q', 'HEAD'))) return `it is not on the run's branch ${s.branch}`
  } catch (e) { return `git could not read it: ${String(e.stderr || e.message).trim().split('\n')[0]}` }
  return null
}

/**
 * The run a take or abandon names, re-checked at the click, in its lock: it must be of this repository, neither
 * finished nor stopped, shown by no session for 15 minutes, and its driving session's Claude Code no longer running;
 * take also needs a session that drives no other run.
 */
function namedRun() {
  const id = rest[0] || fail(`Usage: lcw ${command} <runId>`)
  if (command === 'take' && !sessionId) fail('lcw take needs a session: add --session <id>.')
  return runOf(runsDir(home(), repoKey(mainCheckout(cwd))), id) || fail(`No run ${id} in this repository. Nothing was changed.`)
}

function checkClaim(run) {
  const s = run.state
  if (s.status === 'finished' || s.status === 'stopped') fail(`Run ${s.id} is ${s.status}. Nothing was changed.`)
  const ago = now() - lastShown(run.paths)
  if (ago < SHOWN_WITHIN_MS) fail(`Run ${s.id} was shown by a session ${ageText(ago)} ago, so it may still be open there. Nothing was changed.`)
  const driverPid = readJson(sessionFile(home(), s.driver ?? ''))?.claudePid
  // /clear starts a new session id in the same Claude Code process: that process is this session's own, not another's
  if (s.driver && s.driver !== sessionId && claudeAlive(driverPid) && driverPid !== readJson(sessionFile(home(), sessionId))?.claudePid) fail(`Run ${s.id} is driven by a Claude Code session that is still open. Nothing was changed.`)
  run.from = s.driver // before adopt makes this session the driver
  const mine = command === 'take' ? open(readJson(sessionFile(home(), sessionId))?.runDir) : null
  if (mine && mine.dir !== run.dir) fail(`This session drives run ${mine.state.id}. Nothing was changed.`)
}

function listItem(cmd, field, statuses, make) {
  const run = need()
  // each started wave keeps its own lists; --wave may name a shipped one, whose fixes parked for the person can still be dropped
  const wave = waveOf(run.state, { shipped: true })
  const list = wave ? (wave[field] ??= []) : run.state[field]
  const of = wave ?? undefined
  if (wave && wave.status !== 'running' && !(cmd === 'req' && rest[1] === 'drop')) fail(`Wave ${wave.n} has shipped, so its ${field} stay as they are. Nothing was changed.`)
  if (rest[0] === 'add') {
    const [, id, ...words] = rest
    const label = words.join(' ')
    if (!id || !label) fail(`Usage: lcw ${cmd} add <id> "<title>"`)
    if (list.some((x) => x.id === id)) fail(`${id} exists`)
    if (cmd === 'task' && wave?.requirements?.some((r) => r.id === id)) fail(`${id} is one of wave ${wave.n}'s fixes; its tasks are T1, T2 and on, and its fix tasks X1, X2 and on. Nothing was changed.`)
    change(run, `${cmd} ${id} added: ${label}`, () => list.push(make(id, label)), of)
    return out(`${id} added`)
  }
  const [id, status, ...words] = rest
  if (cmd === 'req' && status === 'rename') {
    const name = words.join(' ')
    if (!name) fail('Usage: lcw req <id> rename "<name>"')
    const item = find(list, 'id', id)
    change(run, `req ${id} renamed: ${name}`, () => { item.name = name }, of)
    return out(`${id} renamed`)
  }
  if (cmd === 'req' && status === 'park') {
    if (!isSweep(run.state)) fail(`req park is for a sweep; run ${run.state.id} is a build. Nothing was changed.`)
    if (!wave) fail('No wave is running, so there is no fix to park. Nothing was changed.')
    const item = find(list, 'id', id)
    if (item.status === 'parked') return out(`${id} is parked already`)
    change(run, `req ${id} parked in wave ${wave.n}: ${item.name}`, (s) => { item.status = 'parked'; s.sweep.parked++ }, of)
    return out(`${id} parked`)
  }
  if (cmd === 'req' && status === 'drop') {
    const shippedIn = flags.wave === undefined && !list.some((x) => x.id === id) ? (run.state.sweep?.waves ?? []).find((x) => x.status === 'shipped' && (x.requirements ?? []).some((r) => r.id === id)) : null
    if (shippedIn) fail(`${id} is a fix of wave ${shippedIn.n}, which has shipped: lcw req ${id} drop --wave ${shippedIn.n}. Nothing was changed.`)
    const item = find(list, 'id', id)
    // a running wave counts its dropped fixes when it ships; a shipped wave has counted its own already
    const running = wave?.status === 'running'
    if (wave && !running && item.status !== 'parked') fail(`${id} is ${item.status} in wave ${wave.n}, which has shipped; a shipped wave drops only its parked fixes. Nothing was changed.`)
    change(run, `req ${id} dropped: ${item.name}`, (s) => {
      if (item.status === 'parked') { s.sweep.parked--; if (!running) s.sweep.dropped++ }
      list.splice(list.indexOf(item), 1)
      if (running) wave.dropped++
    }, of)
    return out(`${id} dropped`)
  }
  if (!statuses.includes(status)) fail(`Usage: lcw ${cmd} <id> <${statuses.join('|')}>`)
  const item = find(list, 'id', id)
  if (cmd === 'req' && item.status === 'parked') fail(`${id} is parked for the person and stays parked; it can only be dropped. Nothing was changed.`)
  change(run, `${cmd} ${id}: ${status}`, () => { item.status = status }, of)
  out(`${id} ${status}`)
}

/**
 * Before a run branches from the main checkout, bring that checkout up to date with what it tracks, so a run
 * never starts from a stale copy of a branch someone has since merged into. Only a clean checkout that is
 * strictly behind is moved, and only by a fast-forward; anything else is left as it is and named.
 * Returns a line for the orchestrator, or null when there was nothing to say.
 */
function catchUp(root) {
  let upstream, remote
  try {
    upstream = git(root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
    remote = git(root, 'config', '--get', `branch.${git(root, 'symbolic-ref', '--short', 'HEAD')}.remote`)
  } catch { return null }
  if (remote !== '.') try {
    execFileSync('git', ['fetch', '-q', remote], {
      cwd: root, stdio: 'ignore', timeout: 20000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes' },
    })
  } catch { return `could not fetch ${remote}; the run branches from the main checkout as it is` }

  const behind = Number(git(root, 'rev-list', '--count', `HEAD..${upstream}`))
  if (!behind) return null
  const ahead = Number(git(root, 'rev-list', '--count', `${upstream}..HEAD`))
  const dirty = git(root, 'status', '--porcelain', '--untracked-files=no') !== ''
  const why = ahead ? `it has ${ahead} commits ${upstream} does not` : dirty ? 'it has uncommitted changes' : null
  if (!why) {
    try { git(root, 'merge', '--ff-only', '-q', upstream) } catch { return `the main checkout is ${behind} commits behind ${upstream} and could not fast-forward; the run branches from it as it is` }
    return `the main checkout was ${behind} commits behind ${upstream} and is now up to date`
  }
  return `the main checkout is ${behind} commits behind ${upstream} and was left as it is, because ${why}; the run branches from it`
}

/**
 * A mark is granted to one session. When another session starts to drive the run, its own mark applies
 * (the default unless the human raised it there). A run from before runs remembered their session keeps its mark.
 */
function moneyMark(view) {
  return view.markShare == null ? dollars(view.markUsd) : `${dollars(view.markUsd)} (${view.markShare}%)`
}

function adopt(run) {
  const s = run.state
  if (!sessionId || s.driver === sessionId) return
  const known = s.driver !== undefined && s.driver !== null
  // what the run has spent so far stays with it; the new session counts from where its own meter stands
  s.usdBefore = runSpend(s, (known ? cumOf(s.driver) : null) ?? s.usdAtStart ?? 0)
  s.usdAtStart = cumOf(sessionId) ?? 0
  s.driver = sessionId
  const mark = sessionMark(sessionId)
  if (known && mark !== s.markPercent) {
    s.markPercent = mark
    const money = readMoney({ sessionId, now: now() })
    appendLedger(run.paths, `another session took over the run: its own usage mark applies, ${money ? moneyMark(money) : `${mark}%`}`, ledgerWave(s))
  }
  saveState(run.paths, s)
}

function withLock(dir, fn) {
  const lock = `${dir}/lock`
  const until = Date.now() + 8000
  for (;;) {
    try { fs.mkdirSync(lock); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) { fs.rmdirSync(lock); continue } } catch {}
      if (Date.now() > until) fail('Another lcw call holds the run lock; try again.')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 + Math.random() * 30)
    }
  }
  try { fn() } finally { try { fs.rmdirSync(lock) } catch {} }
}

try {
  if (!command) fail(USAGE)
  if (!commands[command]) fail(`No lcw command "${command}". The commands are: ${COMMANDS}. ${SEE_HELP}`)
  const byId = BY_ID.includes(command)
  const run = byId ? namedRun() : MUTATING.includes(command) ? findRun({ sessionId, cwd }) : null
  if (run) withLock(run.dir, () => {
    run.state = loadState(run.paths)
    if (byId) checkClaim(run) // before anything is saved, which would make the run look shown
    if (moveOldWave(run.state)) saveState(run.paths, run.state)
    Object.assign(run.state, weekOf(run.state, readUsage()?.sevenDay))
    if (command !== 'abandon') adopt(run)
    held = run
    commands[command]()
  })
  else await commands[command]()
  // A reminder above the line, on the commands the orchestrator runs; workers' lcw calls never see it.
  if (['stage', 'set', 'status'].includes(command)) {
    const ctx = contextOf(sessionId)
    if (compactChoice(ctx) === 'ask') out(`context ${tokensText(ctx.tokens)}: compact at your next checkpoint unless the work needs this context`)
  }
} catch (e) {
  if (e instanceof Fail) console.log(e.message)
  else console.log(String(e.stderr || e.message).trim())
  process.exit(1)
}
