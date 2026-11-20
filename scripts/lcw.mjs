#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { runsDir, repoKey, runPaths, placeFile, slug, sessionFile, spendFile } from '../lib/key.mjs'
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

class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg) }
// "now" is LCW_NOW (epoch ms) when it is set, else the clock, so tests can fix midnight and 08:00
const now = () => (Number.isFinite(Number(process.env.LCW_NOW)) && process.env.LCW_NOW !== '' ? Number(process.env.LCW_NOW) : Date.now())

// flags each command takes (all take a value); --session is accepted everywhere
const COMMAND_FLAGS = {
  start: ['title', 'shape'], task: ['model', 'effort'], ask: ['waiting'], approval: ['meaning'], finish: ['pr', 'branch'], stop: ['pr'],
  hunt: ['areas', 'hunted', 'running', 'findings', 'fix', 'park', 'drop'], wave: ['pr'],
}
// flags that take no value
const SWITCHES = { where: ['json'], awake: ['check'] }
const MUTATING = ['stage', 'set', 'task', 'req', 'ask', 'answer', 'approval', 'mark', 'pause', 'resume', 'stop', 'finish', 'worktree', 'take', 'abandon', 'hunt', 'wave', 'merge']
// commands that name their run by its id, rather than acting on the run this session drives
const BY_ID = ['take', 'abandon']
// a run no session has shown for this long is no longer open anywhere
const SHOWN_WITHIN_MS = 15 * 60000
const STAGES = ['Brainstorm', 'Spec', 'Plan', 'Build', 'Review', 'Ship']
const SWEEP_STAGES = ['Charter', 'Hunt', 'Plan', 'Build', 'Review', 'Ship']
const PROTECTED = ['id', 'version', 'tasks', 'asks', 'requirements', 'driver', 'approval', 'shape']
const PR_CHOICES = { stacked: 'stacked, one draft for each wave', merged: 'merged as it goes', end: 'one at the end' }
const HUNT_COUNTS = ['areas', 'hunted', 'running', 'findings', 'fix', 'park', 'drop']

const flags = {}
const args = []
const argv = process.argv.slice(2)
const USAGE = `lcw commands: ${'start status stage set task req ask answer approval ledger checkpoint mark cap spend-command usage pause resume stop finish worktree pictures runs where take abandon awake hunt wave merge'}
start <name> --title "<line>" [--shape build|sweep] starts a run, a build by default. A build's stages are Brainstorm Spec Plan Build Review Ship, a sweep's Charter Hunt Plan Build Review Ship; stage takes only the run's own.
In a sweep: set sweep.charter=<0-10> (charter lines settled), sweep.open=<n> (questions open now) and sweep.prs=stacked|merged|end; approval asks for the charter in Charter, and stage Hunt needs that asked and charter.md written.
hunt [--areas N] [--hunted N] [--running N] [--findings N] [--fix N] [--park N] [--drop N] records this round's hunt and its sorting. wave add <fixes> ... queues one wave for each number; wave start runs the front queued wave on lcw/<name>-wave-<n>, cut from lcw/<name> in the worktree, and prints its plan; wave shipped [--pr <number>] fast-forwards lcw/<name> to it. merge <wave> merges a shipped wave's pull request with a merge commit, in order, when sweep.prs is merged. task <id> dropped drops a task; stop --pr <url> records the pull request a stopped sweep opened.
req <id> rename "<name>" and req <id> drop change a requirement when what is built changes.
approval ["<Go label>" ...] [--meaning "<what Go builds>"] puts the Brainstorm's question, Is this what you want built?, in LCW's box above the prompt, with Go (or each label given, at most 3 of up to 20 characters), Yes, but … and Something else; its buttons only fill the prompt. Asked again, it replaces the last; a new stage clears it.
take <runId> makes this session take over a run of this repository that no session has shown for 15 minutes; abandon <runId> stops such a run for good and removes its worktree when nothing in it is uncommitted, keeping its branch.
awake keeps this computer from idle sleep until the run pauses, finishes or stops, or Claude Code exits; awake --check prints {canHold, heldByOther, kept}. where --json prints {main, key, run}.
flags: --session <id> (any command); start --title --shape; task --model --effort; ask --waiting; approval --meaning; finish --pr --branch; stop --pr; hunt --areas --hunted --running --findings --fix --park --drop; wave --pr; where --json; awake --check
spend-command <command line> sets the command that prints your 7-day spend in dollars, spend-command off turns it off, spend-command alone says what is set. Everything after spend-command is the command line, joined with single spaces (quote it as one argument if it needs quotes, pipes or ;), and a final --session <id> is not part of it. The command must print the dollars spent in the last 7 days as one number, such as 1240.55 (a leading $ and thousands commas are fine), exit 0, and finish within 30 seconds. LCW runs it in the background every 5 minutes, once across all sessions; while it fails, the figure is its last reading, running down as that reading's days drop out of the 7 days, plus what LCW counted since, and lcw usage says what went wrong.
help, -h and --help print this and change nothing. Any other argument starting with "-" is refused. Text such as a ledger line must not start with "-".`
const refuse = (msg) => { console.log(msg); process.exit(1) }
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
  const name = a.startsWith('--') ? a.slice(2) : null
  if (name && switches.includes(name)) flags[name] = true
  else if (name && (name === 'session' || allowed.includes(name))) {
    if (i + 1 >= argv.length) refuse(`${a} needs a value`)
    flags[name] = argv[++i]
  } else if (a === '-h' || a === '--help') help()
  else refuse(`Unknown flag or argument starting with "-": ${a}. Nothing was changed.\n${USAGE}`)
}
const [command, ...rest] = spendWords ? ['spend-command', ...spendWords] : args
if (command === 'help') help()
if (argv[0] !== command && argv.length) refuse(`The command must come first.\n${USAGE}`)
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
function change(run, note, fn) {
  const was = run.state.status
  fn(run.state)
  const s = run.state
  if (s.status === 'running' && was !== 'running') s.runningSince = new Date(now()).toISOString()
  if (s.status !== 'running') releaseHold(run.dir)
  saveState(run.paths, s)
  appendLedger(run.paths, note)
}

const find = (list, key, value) => list.find((x) => x[key] === value) || fail(`No such item: ${value}`)

const isSweep = (s) => s.shape === 'sweep'
const stagesOf = (s) => (isSweep(s) ? SWEEP_STAGES : STAGES)
const withYou = (stage) => stage === 'Brainstorm' || stage === 'Charter'
const runningWave = (s) => s.sweep?.waves.find((w) => w.status === 'running') ?? null
/** The run's own branch and, in a sweep, its waves' branches. */
const branchesOf = (s) => [s.branch, ...(s.sweep?.waves ?? []).map((w) => w.branch)].filter(Boolean)
const waveDir = (dir, n) => `${dir}/waves/${n}`
const sweepOnly = (run) => (isSweep(run.state) ? run.state.sweep : fail(`lcw ${command} is for a sweep; run ${run.state.id} is a build. Nothing was changed.`))

/** A run's ledger line; while a sweep's wave runs, the wave's own ledger gets it too. */
function appendLedger(paths, text) {
  appendRunLedger(paths, text)
  const wave = runningWave(readJson(paths.state) ?? {})
  if (wave) appendRunLedger({ ledger: `${waveDir(paths.dir, wave.n)}/ledger.md` }, text)
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
    const s = run.state
    const p = run.paths
    const ledger = fs.readFileSync(p.ledger, 'utf8').split('\n').filter(Boolean).slice(-15)
    const money = readMoney({ sessionId: s.driver ?? sessionId, now: now() })
    out(
      `Run ${s.id}: ${s.title}`,
      `stage: ${s.stage}  status: ${s.status}${s.pausedReason ? ` (${s.pausedReason})` : ''}  health: ${s.health}`,
      `mark: ${money ? moneyMark(money) : `${s.markPercent}%`}${s.worktree ? `  worktree: ${s.worktree}  branch: ${s.branch}` : ''}${s.base ? `  base: ${s.base}` : ''}`,
      'tasks:', ...(s.tasks.length ? s.tasks.map((t) => `  ${t.id} [${t.status}] ${t.title}`) : ['  none']),
      'asks:', ...(s.asks.length ? s.asks.map((a) => `  ${a.n}. ${a.text}`) : ['  none']),
      ...(isSweep(s) ? sweepStatus(run) : [`folder: ${run.dir}`, `brainstorm: ${p.brainstorm}`, `spec: ${p.spec}`, `plan: ${p.plan}`, `ledger: ${p.ledger}`]),
      `next step: ${nextStepOf(run) || 'none recorded'}`,
      'ledger (last 15):', ...ledger,
    )
  },

  stage() {
    const run = need()
    const stages = stagesOf(run.state)
    const stage = stages.find((s) => s.toLowerCase() === String(rest[0]).toLowerCase()) || fail(`Stage is one of: ${stages.join(', ')}`)
    if (stage === 'Hunt') {
      if (run.state.stage === 'Hunt') return out('stage Hunt')
      if (!run.state.sweep.approvedAt) fail('The charter has not been put to the person yet: ask with lcw approval in Charter first. Nothing was changed.')
      const charter = `${run.dir}/charter.md`
      if (!fs.existsSync(charter) || !fs.readFileSync(charter, 'utf8').trim()) fail('charter.md is empty: write the agreed charter there first. Nothing was changed.')
    }
    change(run, `stage: ${stage}`, (s) => {
      if (stage === 'Hunt') {
        s.sweep.round++
        s.sweep.hunt = Object.fromEntries(HUNT_COUNTS.map((k) => [k, 0]))
      }
      // the brainstorm's checklist is settled once the intent is approved; left as it was, it shows a question still open
      if (s.stage === 'Brainstorm' && stage !== 'Brainstorm' && s.intent) {
        const now = s.intent.now ? [s.intent.now] : []
        s.intent = { ...s.intent, settled: [...(s.intent.settled ?? []), ...now], now: '', next: [], questionsOpen: 0 }
      }
      s.stage = stage
      s.stageSince = now()
      s.approval = null // asked for the playback of this Brainstorm only
      s.milestone = null // the build sets it again for each milestone it launches
      if (withYou(stage)) s.status = 'with-you'
      else s.status = 'running'
      s.pausedReason = null
      s.pausedAt = null
    })
    out(`stage ${stage}`)
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
    // no ledger line: set is called often and would drown the ledger
    pairs.forEach(([k, v]) => setDotted(run.state, k, v))
    saveState(run.paths, run.state)
    out(`set ${pairs.map(([k]) => k).join(', ')}`)
  },

  task() { listItem('task', 'tasks', ['todo', 'running', 'done', 'parked', ...(isSweep(need().state) ? ['dropped'] : [])],(id, title) => ({ id, title, status: 'todo', model: flags.model ?? null, effort: flags.effort ?? null })) },
  req() { listItem('req', 'requirements', ['todo', 'pass', 'failing'], (id, name) => ({ id, name, status: 'todo' })) },

  ask() {
    const run = need()
    const text = rest.join(' ')
    if (!text) fail('Usage: lcw ask "<question>" [--waiting N]')
    let n
    change(run, `ask: ${text}`, (s) => {
      // an ask keeps its number until it is answered, so the numbers the human sees never shift under them
      n = Math.max(0, ...s.asks.map((a) => a.n)) + 1
      s.asks.push({ n, text, at: now(), waiting: Number(flags.waiting) || 0 })
    })
    out(`ask ${n}`)
  },

  answer() {
    const run = need()
    const n = Number(rest[0])
    const ask = run.state.asks.find((a) => a.n === n) || fail(`No open ask ${rest[0]}`)
    if (rest[1] === undefined) fail('Usage: lcw answer <n> "<answer>"')
    change(run, `answered: Q: ${ask.text} A: ${rest.slice(1).join(' ')}`, (s) => {
      s.asks = s.asks.filter((a) => a.n !== n)
    })
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
    appendLedger(run.paths, text)
    out('ledger: written')
  },

  checkpoint() {
    const run = need()
    const step = rest.join(' ')
    if (!step) fail('Usage: lcw checkpoint "<next step>"')
    writeAtomic(run.paths.checkpoint, step)
    appendLedger(run.paths, `checkpoint: ${step}`)
    out('checkpoint written; compaction happens when this turn ends')
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
      if (gateExpired(readJson(run.paths.gate), at)) lines.push('the limit has reset')
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
    change(run, `stopped${flags.pr ? `, pull request ${flags.pr}` : ''}`, (s) => {
      s.status = 'stopped'
      if (flags.pr) s.pr = prOf(flags.pr)
    })
    out('stopped')
  },

  finish() {
    const run = need()
    const written = readJson(`${run.dir}/totals.json`)
    const share = weekShare(run.state, readUsage()?.sevenDay)
    const spent = readMoney({ sessionId: run.state.driver ?? sessionId, now: now(), state: run.state })?.runUsd
    change(run, 'finished', (s) => {
      if (written) s.totals = { ...s.totals, agents: written.agents, tokens: written.tokens }
      if (share !== null) s.totals.sharePercent = share
      if (Number.isFinite(spent)) s.totals.usd = spent
      s.stage = 'Ship'
      s.status = 'finished'
      s.health = ''
      s.pausedReason = null
      s.finishedAt = now()
      if (flags.pr) s.pr = prOf(flags.pr)
      else if (flags.branch) s.pr = { branch: flags.branch }
    })
    out(`finished ${run.state.id}`)
  },

  worktree() {
    const run = need()
    const s = run.state
    if (s.worktree) return out(s.worktree)
    const dir = `${s.repoRoot}/.claude/worktrees/${s.name}`
    const branch = `lcw/${s.name}`
    const caughtUp = catchUp(s.repoRoot)
    git(s.repoRoot, 'worktree', 'add', '-b', branch, dir)
    const exclude = path.resolve(s.repoRoot, git(s.repoRoot, 'rev-parse', '--git-path', 'info/exclude'))
    fs.mkdirSync(path.dirname(exclude), { recursive: true })
    const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
    if (!text.split('\n').includes('.claude/worktrees/')) fs.appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}.claude/worktrees/\n`)
    const real = fs.realpathSync(dir)
    const base = git(real, 'rev-parse', 'HEAD') // the commit the run branched from: reviewers read the change from it
    change(run, `worktree ${real} on ${branch} from ${base}`, (st) => { st.worktree = real; st.branch = branch; st.base = base })
    writeJson(placeFile(home(), real), { runDir: run.dir })
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
    appendLedger(run.paths, `pictures pushed for the pull request: ${names.join(', ')}`)
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
    out(`worktree: ${run.state.worktree ?? 'none yet'}`)
  },

  // Abandon on the unfinished-run box: stopped for good; its worktree goes only when nothing in it would be lost.
  abandon() {
    const run = need()
    const s = run.state
    change(run, 'abandoned', (st) => { st.status = 'stopped' })
    const wt = s.worktree
    const lines = [`abandoned ${s.id}: stopped for good`]
    if (!wt) lines.push('no worktree to remove')
    else if (!fs.existsSync(wt)) lines.push(`worktree ${wt} was already gone`)
    else {
      const why = keepWorktree(s)
      if (!why) {
        try { git(s.repoRoot, 'worktree', 'remove', wt) } catch (e) { lines.push(`worktree kept: ${wt}, because git would not remove it: ${String(e.stderr || e.message).trim().split('\n')[0]}`) }
        if (!fs.existsSync(wt)) lines.push(`worktree removed: ${wt}`)
      } else lines.push(`worktree kept: ${wt}, because ${why}`)
    }
    if (wt) fs.rmSync(placeFile(home(), wt), { force: true })
    if (s.branch) lines.push(`${branchesOf(s).length > 1 ? 'branches' : 'branch'} kept: ${branchesOf(s).join(', ')}`)
    appendLedger(run.paths, lines.slice(1).join('; '))
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
      if (!alive(pid)) fail('This session has no Claude Code process on record (claudePid in its session file), so a hold could not end with it. Nothing was kept awake.')
      if (!startHold(run.dir, pid, `LCW run ${s.name}`, now())) fail('The hold did not start. Nothing was kept awake.')
      appendLedger(run.paths, 'kept awake until the run pauses, finishes or stops, or Claude Code exits')
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
      const waiting = w.waves.filter((x) => x.status !== 'shipped')
      if (waiting.length) fail(`Waves ${waiting.map((x) => x.n).join(', ')} are already queued or running; a new round's waves are added once those have shipped. Nothing was changed.`)
      const first = w.waves.length + 1
      change(run, `waves queued: ${sizes.map((f, i) => `${first + i} (${f} fixes)`).join(', ')}`, (st) => {
        sizes.forEach((fixes, i) => st.sweep.waves.push({ n: first + i, fixes, status: 'queued', branch: null, pr: null, merged: false, dropped: 0 }))
      })
      return out(`queued waves ${first}${sizes.length > 1 ? `-${first + sizes.length - 1}` : ''}`)
    }
    if (sub === 'start') {
      const on = runningWave(s)
      if (on) fail(`Wave ${on.n} is running on ${on.branch}; ship it with lcw wave shipped first. Nothing was changed.`)
      if (!s.worktree || !fs.existsSync(s.worktree)) fail('The sweep has no worktree yet: run lcw worktree first. Nothing was changed.')
      const next = w.waves.find((x) => x.status === 'queued') || fail('No wave is queued: queue one with lcw wave add. Nothing was changed.')
      if (git(s.worktree, 'status', '--porcelain', '--untracked-files=all')) fail(`The worktree ${s.worktree} has uncommitted or untracked files; commit or remove them first. Nothing was changed.`)
      const branch = `${s.branch}-wave-${next.n}`
      try { git(s.worktree, 'checkout', '-q', '-b', branch, s.branch) } catch (e) { fail(`git could not cut ${branch} from ${s.branch}: ${firstLine(e)}. Nothing was changed.`) }
      const base = git(s.worktree, 'rev-parse', 'HEAD')
      const dir = waveDir(run.dir, next.n)
      fs.mkdirSync(dir, { recursive: true })
      for (const f of ['plan.md', 'ledger.md']) if (!fs.existsSync(`${dir}/${f}`)) fs.writeFileSync(`${dir}/${f}`, '')
      change(run, `wave ${next.n} started on ${branch} from ${base}`, (st) => {
        const wave = st.sweep.waves.find((x) => x.n === next.n)
        wave.status = 'running'
        wave.branch = branch
        st.tasks = []
        st.requirements = []
        st.plan = { tasks: 0, atOnce: 0, models: {} }
        st.milestone = null
        st.base = base
      })
      return out(`wave ${next.n} on ${branch}`, `plan: ${dir}/plan.md`)
    }
    if (sub === 'shipped') {
      const wave = runningWave(s) || fail('No wave is running. Nothing was changed.')
      const pr = flags.pr === undefined ? null : Number(/^\d+$/.test(flags.pr) ? flags.pr : prOf(flags.pr).number) || fail(`--pr takes the pull request's number, not ${flags.pr}. Nothing was changed.`)
      const tip = git(s.worktree, 'rev-parse', `refs/heads/${wave.branch}`)
      try { git(s.worktree, 'merge-base', '--is-ancestor', s.branch, tip) } catch { fail(`${s.branch} has commits ${wave.branch} does not, so it cannot fast-forward to the wave. Nothing was changed.`) }
      try { git(s.worktree, 'branch', '-f', s.branch, tip) } catch (e) { fail(`git could not move ${s.branch} to ${tip}: ${firstLine(e)}. Nothing was changed.`) }
      const fixed = s.requirements.filter((r) => r.status === 'pass').length
      const note = `wave ${wave.n} shipped: ${s.branch} now at ${tip}; ${fixed} fixed, ${wave.dropped} dropped${pr ? `; PR #${pr}` : ''}`
      change(run, note, (st) => {
        const x = st.sweep.waves.find((y) => y.n === wave.n)
        Object.assign(x, { status: 'shipped', pr, fixed })
        st.sweep.fixed += fixed
        st.sweep.dropped += x.dropped
      })
      appendRunLedger({ ledger: `${waveDir(run.dir, wave.n)}/ledger.md` }, note) // the wave no longer runs, so change did not copy it there
      return out(note)
    }
    fail('Usage: lcw wave add <fixes> ... | wave start | wave shipped [--pr <number>]')
  },

  merge() {
    const run = need()
    const w = sweepOnly(run)
    const n = wholeNumber(rest[0], 'lcw merge')
    if (w.prs !== 'merged') fail(`The charter's pull request choice is ${PR_CHOICES[w.prs] ?? 'not made yet'}, not merged as it goes, so the sweep merges nothing. Nothing was changed.`)
    const wave = w.waves.find((x) => x.n === n) || fail(`No wave ${n}. Nothing was changed.`)
    if (wave.status !== 'shipped' || !wave.pr) fail(`Wave ${n} is ${wave.status}${wave.pr ? '' : ' with no pull request'}; only a shipped wave's pull request is merged. Nothing was changed.`)
    if (wave.merged) fail(`Wave ${n}'s pull request #${wave.pr} is merged already. Nothing was changed.`)
    const open = w.waves.filter((x) => x.n < n && !x.merged)
    if (open.length) fail(`Wave ${open[0].n} is not merged yet; waves merge in order. Nothing was changed.`)
    const root = run.state.repoRoot
    const repo = githubRepo(root) || fail('lcw merge needs a GitHub remote named origin. Nothing was merged.')
    const pr = String(wave.pr)
    try {
      if (gh(root, 'pr', 'view', pr, '-R', repo, '--json', 'isDraft', '--jq', '.isDraft') === 'true') gh(root, 'pr', 'ready', pr, '-R', repo)
      gh(root, 'pr', 'merge', pr, '-R', repo, '--merge')
    } catch (e) { fail(`gh could not merge #${pr}: ${firstLine(e)}. Nothing was recorded.`) }
    // gh's --delete-branch would also touch the wave's local branch, which is checked out in the sweep's worktree
    let left = ''
    try { git(run.state.worktree || root, 'push', '-q', 'origin', '--delete', wave.branch) } catch (e) { left = `, its remote branch ${wave.branch} is left (${firstLine(e)})` }
    change(run, `wave ${n} merged: PR #${pr} with a merge commit${left || ', its remote branch deleted'}`, (st) => {
      st.sweep.waves.find((x) => x.n === n).merged = true
    })
    out(`merged wave ${n}: #${pr}${left}`)
  },
}

const prOf = (url) => ({ number: Number(/\/pull\/(\d+)/.exec(url)?.[1]) || null, url })

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

/** A sweep's part of lcw status: the pull request choice, the round, each wave, the totals and its files. */
function sweepStatus(run) {
  const w = run.state.sweep
  const wave = runningWave(run.state)
  return [
    `pull requests: ${PR_CHOICES[w.prs] ?? 'not chosen yet'}  round: ${w.round}  fixed: ${w.fixed}  parked: ${w.parked}  dropped: ${w.dropped}`,
    'waves:', ...(w.waves.length ? w.waves.map((x) => `  ${x.n} [${x.status}] ${x.fixes} fixes  branch: ${x.branch ?? 'none yet'}  ${x.pr ? `PR #${x.pr} ${x.merged ? 'merged' : 'not merged'}` : 'no PR'}`) : ['  none queued']),
    `folder: ${run.dir}`, `charter: ${run.dir}/charter.md`, `findings: ${run.dir}/findings.md`, `parked: ${run.dir}/parked.md`, `ledger: ${run.paths.ledger}`,
    ...(wave ? [`plan: ${waveDir(run.dir, wave.n)}/plan.md`] : []),
  ]
}

/** Why a run's worktree must stay when the run is abandoned, or null when removing it loses nothing. */
function keepWorktree(s) {
  const wt = s.worktree
  const here = fs.realpathSync(cwd)
  const inside = (p) => p === wt || p.startsWith(`${wt}/`)
  if (inside(here)) return 'this session is in it'
  if (sessionFolders().some(inside)) return 'an open Claude Code session is in it'
  try {
    // every untracked file, whatever status.showUntrackedFiles says: git worktree remove would delete them
    if (git(wt, 'status', '--porcelain', '--untracked-files=all')) return 'it has uncommitted or untracked files'
    // git worktree remove deletes ignored files, such as a .env, without asking
    const ignored = git(wt, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory').split('\n').filter(Boolean)
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
  const list = run.state[field]
  if (rest[0] === 'add') {
    const [, id, ...words] = rest
    const label = words.join(' ')
    if (!id || !label) fail(`Usage: lcw ${cmd} add <id> "<title>"`)
    if (list.some((x) => x.id === id)) fail(`${id} exists`)
    change(run, `${cmd} ${id} added: ${label}`, () => list.push(make(id, label)))
    return out(`${id} added`)
  }
  const [id, status, ...words] = rest
  if (cmd === 'req' && status === 'rename') {
    const name = words.join(' ')
    if (!name) fail('Usage: lcw req <id> rename "<name>"')
    const item = find(list, 'id', id)
    change(run, `req ${id} renamed: ${name}`, () => { item.name = name })
    return out(`${id} renamed`)
  }
  if (cmd === 'req' && status === 'drop') {
    const item = find(list, 'id', id)
    change(run, `req ${id} dropped: ${item.name}`, (s) => {
      s.requirements = s.requirements.filter((x) => x !== item)
      const wave = runningWave(s)
      if (wave) wave.dropped++
    })
    return out(`${id} dropped`)
  }
  if (!statuses.includes(status)) fail(`Usage: lcw ${cmd} <id> <${statuses.join('|')}>`)
  const item = find(list, 'id', id)
  change(run, `${cmd} ${id}: ${status}`, () => { item.status = status })
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
    appendLedger(run.paths, `another session took over the run: its own usage mark applies, ${money ? moneyMark(money) : `${mark}%`}`)
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
  if (!commands[command]) fail(USAGE)
  const byId = BY_ID.includes(command)
  const run = byId ? namedRun() : MUTATING.includes(command) ? findRun({ sessionId, cwd }) : null
  if (run) withLock(run.dir, () => {
    run.state = loadState(run.paths)
    if (byId) checkClaim(run) // before anything is saved, which would make the run look shown
    Object.assign(run.state, weekOf(run.state, readUsage()?.sevenDay))
    if (command !== 'abandon') adopt(run)
    held = run
    commands[command]()
  })
  else await commands[command]()
} catch (e) {
  if (e instanceof Fail) console.log(e.message)
  else console.log(String(e.stderr || e.message).trim())
  process.exit(1)
}
