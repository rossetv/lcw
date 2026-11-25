// The facts the pinned boxes are chosen from, and what each of their buttons does. Pure: no Node APIs, the mod
// imports it, so register.tsx only reads files, runs what a plan says and draws.
import { thresholds as TH } from '../lib/theme.mjs'
import { DEFAULT_CAP_USD } from '../lib/spend.mjs'
import { dollars } from '../lib/format.mjs'
import { isLcwStatusLine, openWaves, workOf } from '../lib/banner.mjs'
import { activeQuota, normalizeEndpoint, quotaOff } from '../lib/quota.mjs'

export function proxyQuotaEndpoint(value, configuration, ...sessions) {
  if (typeof value !== 'string') return null
  // URL replaces lone surrogates; reject them rather than aliasing a different connection's choice.
  try { encodeURIComponent(value) } catch { return null }
  const endpoint = normalizeEndpoint(value)
  if (!endpoint || ['https://api.anthropic.com', 'https://api.anthropic.com/v1'].includes(endpoint)) return null
  if (sessions.some((s) => s?.quotaSelection) || quotaOff(configuration) || activeQuota(configuration) && configuration.endpoint === endpoint) return null
  return endpoint
}

/** The host a proxy is known by: the box's answer holds for it whatever the port or path. */
export const proxyQuotaHost = (endpoint) => new URL(endpoint).hostname

const PROXY_QUOTA_TEXT = 'Help me work out whether my current custom AI connection is subscription-backed and whether a weekly percentage quota check is appropriate for LCW. A custom endpoint does not establish subscription billing. Discuss the generic quota-command adapter contract with me first. Do not read credentials, install an adapter, configure quota, change billing, raise marks or resume a run without my separate explicit authorization. Keep endpoint URLs and account details out of prompts and shared output.'

/** A run no session has shown for this long is no longer open anywhere (lcw take and abandon use the same). */
export const SHOWN_WITHIN_MS = 15 * 60000
/** The weekly checks are asked for no sooner than this into a session, and at most this often. */
export const WEEKLY_AFTER_MS = 2 * 60000
export const WEEKLY_EVERY_MS = 15 * 60000
/** The repository's runs are looked over this often; whether something else holds off sleep, this often. */
export const RUNS_EVERY_MS = 30000
export const AWAKE_EVERY_MS = 60000
/** What Learn more sends, as the person: the words that load the teaching conversation. */
export const LEARN_TEXT = 'Learn more about how LCW works'

const OPEN = (s) => s && s.status !== 'finished' && s.status !== 'stopped'
const count = (tasks, ...statuses) => tasks.filter((t) => statuses.includes(t?.status)).length

/** The tasks done and left, or nothing while the run has no tasks (before Build). */
function taskCounts(state) {
  const { tasks } = workOf(state)
  return tasks.length ? { done: count(tasks, 'done'), left: count(tasks, 'todo', 'running') } : {}
}

/** The run this session drives, as the boxes read it; kept says LCW already keeps the computer awake for it. */
export function runFact(state, kept) {
  if (!state?.id) return null
  const asks = OPEN(state) && Array.isArray(state.asks) ? state.asks : []
  return {
    id: state.id, title: state.name || state.id, stage: state.stage, status: state.status, pausedReason: state.pausedReason ?? undefined,
    pausedAt: state.pausedAt ?? undefined, runningSince: state.runningSince ?? undefined, ...taskCounts(state),
    asks: asks.filter((a) => Number.isFinite(a?.n)).map(askOf).sort((a, b) => a.n - b.n),
    awake: !!kept, guide: state.guide === true, firstOnMachine: state.firstOnMachine === true, shape: shapeOf(state),
    approval: approvalOf(state),
    questions: questionsOf(state),
  }
}

const optionOf = (o) => ({ key: String(o.key), label: String(o.label ?? ''), meaning: String(o.meaning ?? '') })

/** An open ask as the answer box reads it; one asked with options (lcw ask --a --b) carries them and the pick. */
const askOf = (a) => ({
  n: a.n, text: String(a.text ?? ''), waiting: a.waiting, at: a.at, ...(a.nowait ? { nowait: true } : {}),
  ...(Array.isArray(a.options) && a.options.length ? { options: a.options.map(optionOf), ...(a.recommend == null ? {} : { recommend: String(a.recommend) }) } : {}),
})

/** A sweep's short questions for the person: the open ones in the order asked, and how many were asked in all. */
function questionsOf(state) {
  const all = OPEN(state) && Array.isArray(state.questions) ? state.questions.filter((q) => q?.id && Array.isArray(q.options)) : []
  const open = all.filter((q) => q.status === 'open').map((q) => ({
    id: String(q.id), text: String(q.text ?? ''), why: String(q.why ?? ''), ...(q.recommend == null ? {} : { recommend: String(q.recommend) }),
    options: q.options.map(optionOf),
  }))
  return open.length ? { open, asked: all.length, answered: all.length - open.length } : undefined
}

const shapeOf = (state) => (state?.shape === 'sweep' ? 'sweep' : 'build')

/** The approval the Brainstorm's playback (a sweep's Charter) asks for with lcw approval, while the run is still with the person in it; else undefined. */
function approvalOf(state) {
  const a = state.approval
  const sweep = shapeOf(state) === 'sweep'
  if (state.stage !== (sweep ? 'Charter' : 'Brainstorm') || state.status !== 'with-you' || !Number.isFinite(a?.at)) return undefined
  const go = (Array.isArray(a.go) ? a.go : []).map((g) => String(g ?? '').replace(/\s+/g, ' ').trim().slice(0, 20)).filter(Boolean).slice(0, 3)
  const meaning = String(a.meaning ?? '').replace(/\s+/g, ' ').trim()
  return { go: go.length ? go : ['Go'], meaning: meaning || (sweep ? 'starts the hunt' : 'build it as played back'), at: a.at, ...(Number(a.recommend) ? { recommend: Number(a.recommend) } : {}) }
}

/** What a reply on the approval box puts in the prompt: Go's label as it is, the other two ready for the person's words. */
export function approveText(banner, option) {
  if (option === 'but') return 'Yes, but '
  if (option === 'else') return 'Something else: '
  return banner.options.find(([id]) => id === option)?.[1]
}

/** Whether the keep-awake box can apply: the run runs on its own, past the Brainstorm (a sweep's Charter). */
export const awakeApplies = (state) => state?.status === 'running' && !!state.stage && state.stage !== 'Brainstorm' && state.stage !== 'Charter'

/**
 * The week against the mark: the run's mark, else the session's, against usage.json's figure (one past its reset
 * counts as no figure); with money (the session is billed per token), the dollars, whose own atMark decides.
 */
export function usageFact({ state, session, usage, money, quota, now }) {
  const own = state ? state.markPercent : session?.markPercent
  const markPercent = typeof own === 'number' ? own : TH.usageMarkPercent
  if (quota) return {
    quota, markPercent, atMark: quota.hold,
    usedPercent: quota.status === 'ok' ? quota.percentUsed : undefined,
    resetsAt: quota.status === 'ok' ? quota.resetsAt : undefined,
  }
  const week = usage?.sevenDay
  const live = Number.isFinite(week?.percentUsed) && !(Date.parse(week.resetsAt ?? '') <= now)
  const fact = {
    usedPercent: live ? week.percentUsed : undefined, resetsAt: week?.resetsAt ?? undefined, markPercent,
    atMark: live && week.percentUsed >= markPercent,
  }
  if (money) Object.assign(fact, { spentUsd: money.spentUsd, capUsd: money.capUsd, markUsd: money.markUsd, atMark: !!money.atMark })
  return fact
}

/** How long the week must read below the mark before a climb back to it is another occurrence of the mark box. */
export const BELOW_MARK_MS = 60000

/**
 * When the week reached the mark (since), carried from one reading to the next: kept until it has read below the
 * mark for BELOW_MARK_MS (below: since when), so one low reading (a spend file caught mid-write) starts no new one.
 */
export function markSpell(prev, atMark, now) {
  if (atMark) return { since: prev?.since || now, below: 0 }
  if (!prev?.since) return { since: 0, below: 0 }
  const below = prev.below || now
  return now - below >= BELOW_MARK_MS ? { since: 0, below: 0 } : { since: prev.since, below }
}

/** Whether a command line, as ps -o args= prints it, is Claude Code's: its program, or the script node runs, is named claude (lcw judges a driver so). */
export function claudeCommand(args) {
  const [first = '', second = ''] = String(args ?? '').trim().split(/\s+/)
  return /claude/i.test(/(^|\/)node(js)?$/.test(first) ? second : first)
}

/** The spend command's failures, from readingOf's reading; null when none is set or read. */
export const spendFailingFact = (reading) => (reading ? { fails: reading.fails, since: reading.failingSince ?? undefined, lastError: reading.lastError } : null)

/**
 * The status line in the person's own user settings, as the boxes read it: mine when it is a command LCW's setup
 * wrote, null when there is none. Another command there, one that replaced LCW's or one the person had before LCW, is
 * what Put LCW's back changes; a project's status line is not, so it is never read here.
 */
export function statusLineFact(setting, lcwHome) {
  const command = typeof setting?.command === 'string' ? setting.command.trim() : ''
  return command ? { command, mine: isLcwStatusLine(command, lcwHome) } : null
}

/** The next step the run last recorded: its ledger's last checkpoint line, or null. */
export function nextStepOf(ledger) {
  const line = String(ledger ?? '').split('\n').reverse().find((l) => l.includes(' checkpoint: '))
  return line ? line.split(' checkpoint: ').slice(1).join(' checkpoint: ').trim() || null : null
}

/**
 * The runs of this repository the unfinished-run box may name, newest first: neither finished nor stopped, and shown
 * by no session for SHOWN_WITHIN_MS (shownAt: the latest of mod-alive and the state and ledger files' times), and not
 * dismissed this session (Not now on one lets an older one show).
 */
export function unfinishedCandidates(runs, now, ownDir, dismissed) {
  return (runs ?? [])
    .filter((r) => OPEN(r?.state) && r.dir !== ownDir && Number.isFinite(r.shownAt) && now - r.shownAt >= SHOWN_WITHIN_MS)
    .filter((r) => !dismissed?.has('unfinished:' + r.state.id))
    .sort((a, b) => b.shownAt - a.shownAt)
}

/** The waves a sweep has open, else its next queued wave; none for a build or between waves. */
function waveOf(state) {
  if (shapeOf(state) !== 'sweep') return {}
  const waves = Array.isArray(state.sweep?.waves) ? state.sweep.waves : []
  const open = openWaves(state)
  if (open.length) return { wave: open[0].n, waves: open.map(({ n, stage, step, waiting }) => ({ n, stage, step, waiting })) }
  const w = waves.find((x) => x?.status === 'queued')
  return Number.isFinite(w?.n) ? { wave: w.n } : {}
}

/** The unfinished-run box's facts for one candidate, with its ledger's text for the next step. */
export function unfinishedFact(run, ledger) {
  const s = run.state
  // As Build records it with lcw set milestone=…: "2 of 3", or a bare number.
  const milestone = s.milestone == null ? '' : String(s.milestone).trim()
  return {
    id: s.id, name: s.name || s.id, title: s.title || undefined, stage: s.stage, status: s.status, pausedReason: s.pausedReason ?? undefined,
    ...(milestone ? { milestone } : {}), ...waveOf(s), ...taskCounts(s), nextStep: nextStepOf(ledger) ?? undefined, stoppedAt: run.shownAt,
    worktree: !!s.worktree || (Array.isArray(s.sweep?.waves) && s.sweep.waves.some((x) => x?.worktree)), branch: !!s.branch,
  }
}

/**
 * Whether the session is idle enough for a weekly check's prompt: watched, no main-loop turn running, quiet for
 * WEEKLY_AFTER_MS since it started and since its last turn ended (nothing typed: the draft is read by the caller),
 * driving no run, and not at the usage mark (the agent gate would refuse the check's probe).
 */
export function weeklyIdle({ interactive, turnRunning, driving, atMark, startedAt, turnEndedAt, now }) {
  return !!interactive && !turnRunning && !driving && !atMark && now - Math.max(startedAt, turnEndedAt ?? 0) >= WEEKLY_AFTER_MS
}

/** Whether to ask weekly.mjs for a due check now: the session is idle, and it was not asked within WEEKLY_EVERY_MS. */
export const weeklyDue = (args) => weeklyIdle(args) && !(args.now - (args.askedAt ?? 0) < WEEKLY_EVERY_MS)

/** Whether to ask lcw whether the computer can be kept awake: the box could show (not turned off, this occurrence not dismissed). */
export const awakeCheckWanted = (state, notices, dismissed) =>
  awakeApplies(state) && notices?.awake !== 'never' && !dismissed?.has('awake:' + state.id + ':' + state.runningSince)

/** What dismissing a box adds to the session's dismissed set: its occurrence, and the bare kind for the three old boxes. */
export const dismissKeys = (banner) => (String(banner.key) === banner.kind ? [banner.kind] : [banner.kind + ':' + banner.key])

/**
 * Whether a box drawn earlier is still the one that applies: same kind and occurrence (for an ask's options, the same ask), and it still offers option
 * under the label that was drawn ("Run up to $3,600" runs 3,600 or nothing).
 */
export function sameBox(drawn, fresh, option) {
  if (!drawn || !fresh || drawn.kind !== fresh.kind || String(drawn.key) !== String(fresh.key) || drawn.askN !== fresh.askN) return false
  const label = drawn.options.find(([id]) => id === option)?.[1]
  return label !== undefined && fresh.options.some(([id, l]) => id === option && l === label)
}

const cli = (root) => `node "${root}/scripts/lcw.mjs"`
const quote = (t) => '"' + String(t).replace(/\s+/g, ' ').trim() + '"'

/** After a raise on a run paused at the mark: the run is resumed, carry on. */
export function raisePrompt(root, sessionId, run, label) {
  return `LCW: the person pressed "${label}" on the box for the run ${run.title} (${run.id}), which was paused at the usage mark. LCW has set this session's mark and resumed the run. Load the lcw:lcw skill with the Skill tool, run \`${cli(root)} status --session ${sessionId}\`, and carry on from its next step and the ledger.`
}

/**
 * After Resume on the unfinished-run box: this session has taken the run over, and resumed it when it was paused by
 * the person. A run paused at the usage mark stays paused: its mark box offers the raises.
 */
export function resumePrompt(root, sessionId, u, resumed) {
  const atMark = u.status === 'paused' && u.pausedReason === 'mark'
  return [
    `LCW: the person pressed Resume on the box for the unfinished run ${u.name} (${u.id}) of this repository. LCW has made this session take it over${resumed ? ' and resumed it' : ''}, so this session now drives it.`,
    ...(atMark ? ['It is paused at the usage mark and stays paused: do not resume it and do not raise the mark; LCW\'s box offers the person the raises.'] : []),
    `Load the lcw:lcw skill with the Skill tool and run \`${cli(root)} status --session ${sessionId}\`.`,
    `Then carry on from the run's next step${u.nextStep ? ' (' + quote(u.nextStep) + ')' : ''} and its ledger. Do not start again, and do not ask the person what was happening.`,
  ].join(' ')
}

/** After an option pressed on the answer box: LCW has recorded the answer, act on it. */
export function answeredPrompt(run, ask, words) {
  return `LCW: the person answered ask ${ask.n} of the run ${run.title} (${run.id}), ${quote(ask.text)}, by pressing an option on LCW's box: ${quote(words)}. LCW has recorded it with lcw answer, so do not record it again. Act on it as the lcw skill's "Asking the human" says for an answer.`
}

/** Fix it on the failing spend check. */
export function fixSpendPrompt(root, sessionId, f) {
  const said = f?.lastError ? ` The last time it ${String(f.lastError).replace(/\s+/g, ' ').trim()}.` : ''
  return [
    `LCW: the person pressed Fix it on the box saying their spend check is failing: the command LCW runs every 5 minutes to read their 7-day spend has failed ${f?.fails ?? 'several'} times in a row.${said}`,
    `Help them find the problem and set a command that works. Run \`${cli(root)} spend-command --session ${sessionId}\` to see what is set, run that command yourself to see what it prints, and agree a fix with them.`,
    `Set the working one with \`${cli(root)} spend-command <command line> --session ${sessionId}\`: it must print the dollars spent in the last 7 days as one number, exit 0 and finish within 30 seconds.`,
    `If they would rather have no spend check, \`${cli(root)} spend-command off --session ${sessionId}\` turns it off. Change nothing else.`,
  ].join(' ')
}

/** Discuss it on the cleanup box: go through the items with the person before anything is removed. */
export function discussPrompt(root, cleanup, cleanupPath) {
  const cleanupCli = `node "${root}/scripts/cleanup.mjs"`
  const bullets = (cleanup?.bullets ?? []).map((b) => '- ' + b).join('\n')
  return [
    `LCW: the person pressed Discuss it on LCW's cleanup box for this repository. The box said: ${quote(cleanup?.title ?? '')}`,
    ...(bullets ? [bullets] : []),
    '',
    `Go through these items with the person, one at a time, before anything is removed. \`${cleanupCli} list --recorded\` prints the items the box named, and \`${cleanupCli} list\` what is safe to remove now.`,
    `For what they agree to remove that is still safe, record just those with \`${cleanupCli} record --title <title> --bullet <why> --item branch:<name> --item worktree:<path>\` and run \`${cleanupCli} apply\`, which checks each item again and removes only what is still safe, from this computer only.`,
    'A branch on GitHub, or anything that is not merged, only on their explicit word for that item, never with a force flag, and only after saying what would be lost.',
    `If they keep everything, run \`rm -f "${cleanupPath}"\` so the box does not come back. Never push, and change nothing else.`,
  ].join('\n')
}


/**
 * What pressing option on banner does, as a plan register.tsx carries out in this order:
 * - steps: commands run one after another; the first that fails (or whose output matches its halt) ends the plan,
 *   its output said in a toast, and the box stays;
 * - working: said at once, for steps that can take minutes: they run after the press has returned, since a press is given ten seconds;
 * - prompt: submitted ({ text, asUser }); when it cannot be, the box stays and the person is told;
 * - owe: a prompt that carries the run on, sent until it goes through (the steps have already changed the run);
 * - notices: written into notices.json (the machine's "never again" choices);
 * - fill: the ask number Answer now (an ask's Other) puts in the prompt;
 * - fillText: the reply put in an empty prompt, never sent (the person presses Enter);
 * - proxyQuotaChoice: saved in its host's notice file, only after a requested fill succeeds;
 * - dismiss: the box's occurrence is hidden for this session;
 * - toast: said at the end; 'output' says the last command's output.
 * null when the box does not offer option. facts are those the box was chosen from; ctx: { root, sessionId, repoKey, cleanupPath }.
 */
export function pressPlan(banner, option, facts, ctx) {
  if (!banner || !banner.options.some(([id]) => id === option)) return null
  const { root, sessionId, repoKey, cleanupPath } = ctx
  const lcw = (...args) => ({ argv: ['node', `${root}/scripts/lcw.mjs`, ...args, '--session', sessionId] })
  const script = (name, ...args) => ({ argv: ['node', `${root}/scripts/${name}`, ...args] })
  const close = { dismiss: true }
  const run = facts?.run
  if (option === 'later' || option === 'wait') return close
  switch (banner.kind) {
    case 'proxyquota':
      if (option === 'setup' && !facts?.proxyQuota?.canSetup) return { toast: 'Wait until this session is idle, below its mark and no run is active, then press setup again.' }
      return { ...(option === 'setup' ? { fillText: PROXY_QUOTA_TEXT } : {}), proxyQuotaChoice: { host: facts.proxyQuota.host, choice: option }, dismiss: true }
    case 'approve':
      return { fillText: approveText(banner, option), dismiss: true }
    case 'answer': {
      // the box holds the asks of one kind: those that hold the run, or those that hold nothing
      const a = run?.asks?.find((x) => !!x.nowait === !!banner.forYou)
      const o = a?.options?.find((x) => x.key === option)
      if (!o) return { fill: a?.n, dismiss: true }
      if (a.n !== banner.askN) return null
      // Not dismissed: once this ask is answered the box shows the next one, if any.
      const words = o.meaning ? o.label + ': ' + o.meaning : o.label
      return { steps: [lcw('answer', String(a.n), words)], owe: answeredPrompt(run, a, words) }
    }
    case 'question': {
      const q = run?.questions?.open?.[0]
      if (!q || q.id !== banner.questionId) return null
      // Other only fills the prompt: the box stays until the words they send are recorded, so nothing is lost if they never send.
      if (option === 'other') return { fillText: `Your call on ${q.id}: ` }
      return { steps: [lcw('question', q.id, 'pick', option)], toast: 'Saved for the next wave.', dismiss: true }
    }
    case 'mark': {
      const usage = facts?.usage ?? {}
      const money = facts?.billing === 'payg' && usage.capUsd > 0 && usage.markUsd > 0
      const share = option === 'r90' ? 0.9 : 1
      const value = money ? Math.round(usage.capUsd * share) + 'usd' : String(share * 100)
      const label = banner.options.find(([id]) => id === option)[1]
      const mark = { ...lcw('mark', value), halt: /at the mark\s*$/ }
      if (run) {
        return {
          steps: [mark, lcw('resume')], prompt: { text: raisePrompt(root, sessionId, run, label) },
          promptFailed: 'LCW raised the mark and resumed the run. Say "carry on" to continue it.', dismiss: true,
        }
      }
      return { steps: [mark], toast: 'output', dismiss: true }
    }
    case 'spendfail':
      if (option === 'fix') return { prompt: { text: fixSpendPrompt(root, sessionId, facts?.spendFailing) }, dismiss: true }
      return { steps: [lcw('spend-command', 'off')], notices: { spend: 'never' }, toast: 'output', dismiss: true }
    case 'unfinished': {
      const u = facts?.unfinished
      if (!u) return null
      if (option === 'abandon') return { steps: [lcw('abandon', u.id)], toast: 'output', dismiss: true }
      // Paused at the mark it stays paused: only a Run up to press raises the mark.
      const resumed = u.status === 'paused' && u.pausedReason !== 'mark'
      return {
        steps: [lcw('take', u.id), ...(resumed ? [lcw('resume')] : [])], prompt: { text: resumePrompt(root, sessionId, u, resumed) },
        promptFailed: 'This session has taken the run over. Say "carry on" to continue it.', dismiss: true,
      }
    }
    case 'awake':
      if (option === 'never') return { notices: { awake: 'never' }, dismiss: true }
      return { steps: [lcw('awake')], toast: 'output', dismiss: true }
    case 'restart':
      return close
    case 'update':
      return { steps: [{ ...script('update.mjs', 'apply'), timeoutMs: 180000 }], working: 'Updating LCW. It says here when it is done.', fail: 'LCW could not update: ', toast: 'output', dismiss: true }
    case 'whatsnew':
      return { notices: { ['whatsnew:' + banner.key]: 'never' }, dismiss: true }
    case 'guide':
      return { notices: { guide: 'never' }, ...(option === 'learn' ? { prompt: { text: LEARN_TEXT, asUser: true } } : {}), dismiss: true }
    case 'cleanup':
      if (option === 'never') return { notices: { ['cleanup:' + repoKey]: 'never' }, dismiss: true }
      if (option === 'discuss') return { prompt: { text: discussPrompt(root, facts?.cleanup, cleanupPath) }, dismiss: true }
      return { steps: [{ ...script('cleanup.mjs', 'apply'), timeoutMs: 120000 }], working: 'Cleaning up. LCW says here when it is done.', fail: 'LCW could not clean up: ', toast: 'output', dismiss: true }
    case 'limits':
      if (option === 'never') return { notices: { limits: 'never' }, dismiss: true }
      return { steps: [script('setup.mjs', 'limits')], fail: 'LCW could not raise the limits: ', toast: 'output', dismiss: true }
    case 'statusline':
      if (option === 'keep') return { notices: { statuslineKept: 'never' }, dismiss: true }
      return { steps: [script('setup.mjs', 'statusline')], fail: "LCW could not put its status rows back: ", toast: "LCW's status rows are back.", dismiss: true }
    case 'advisor':
      if (option === 'never') return { notices: { advisor: 'never' }, dismiss: true }
      return { steps: [script('setup.mjs', 'advisor')], fail: 'LCW could not turn the advisor on: ', toast: 'Fable advisor is on from your next session.', dismiss: true }
    case 'cap':
      if (option === 'set') return { prompt: { text: 'Set my weekly cap for LCW.', asUser: true }, dismiss: true }
      return {
        steps: [lcw('cap', String(DEFAULT_CAP_USD))], fail: 'LCW could not save the cap: ',
        toast: `Weekly cap kept at ${dollars(DEFAULT_CAP_USD)}. Say "my weekly cap is ..." to change it.`, dismiss: true,
      }
    case 'spend':
      if (option === 'never') return { notices: { spend: 'never' }, dismiss: true }
      return { prompt: { text: 'Set up my LCW spend check.', asUser: true }, dismiss: true }
  }
  return null
}

/** What a command said, for a toast: its output's lines joined, stdout first. */
export const said = (r) => [r?.stdout, r?.stderr].map((t) => String(t ?? '').trim()).filter(Boolean).join('\n').split('\n').map((l) => l.trim()).filter(Boolean).join(' · ')
