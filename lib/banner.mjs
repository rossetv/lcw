// The boxes LCW pins above the prompt until the person picks an option. bannerFor decides which one shows and what it
// says from a facts object; bannerRows draws it. Pure: no Node APIs, the mod imports it.
import { DEFAULT_CAP_USD, SPEND_COMMAND_FAILS, next0800 } from './spend.mjs'
import { clip, dollars } from './format.mjs'

/**
 * The waves of a sweep that are open: running, or shipped but not yet merged while the charter merges as it goes
 * (such a wave holds its lane at Ship, merging). Each comes with its stage, step, whether it waits on an answer, and its
 * own tasks and requirements. A wave a 0.4.x run left running has no stage: it reads the run's own.
 */
export function openWaves(state) {
  if (state?.shape !== 'sweep' || !Array.isArray(state.sweep?.waves)) return []
  const merging = state.sweep.prs === 'merged'
  return state.sweep.waves.filter((w) => Number.isFinite(w?.n) && (w.status === 'running' || (merging && w.status === 'shipped' && !w.merged)))
    .map((w) => {
      const held = w.status !== 'running'
      const own = typeof w.stage === 'string' && w.stage !== ''
      const list = (k) => (Array.isArray(w[k]) ? w[k] : own || held ? [] : Array.isArray(state[k]) ? state[k] : [])
      return {
        n: w.n, stage: held ? 'Ship' : own ? w.stage : state.stage, step: held ? 'merging' : own ? w.step ?? null : null, waiting: w.waiting === true,
        worktree: w.worktree, tasks: list('tasks'), requirements: list('requirements'),
      }
    })
}

/** The requirements and tasks a run stands on: the open waves' lists added up in a sweep, else the run's own. */
export function workOf(state) {
  const open = openWaves(state)
  if (!open.length) return { tasks: Array.isArray(state?.tasks) ? state.tasks : [], requirements: Array.isArray(state?.requirements) ? state.requirements : [] }
  return { tasks: open.flatMap((w) => w.tasks), requirements: open.flatMap((w) => w.requirements) }
}

// The three that ask the person to set LCW up. Their key is their kind: Not now lasts the session.
export const BANNERS = {
  advisor: {
    title: 'Turn on Fable as your advisor?',
    body: "A second model reviews each stage of a run and catches mistakes before they're built. It adds to your usage.",
    options: [['fix', 'Fix it'], ['later', 'Not now'], ['never', "Don't ask again"]],
  },
  cap: {
    title: "You're billed per token here. What's your weekly cap?",
    body: `LCW counts this machine's spend in dollars, from Claude Code's own estimate, and stops agents at 75% of the cap. Until you say, it assumes ${dollars(DEFAULT_CAP_USD)}.`,
    options: [['set', 'Set my cap'], ['keep', `Keep ${dollars(DEFAULT_CAP_USD)}`], ['later', 'Not now']],
  },
  spend: {
    title: 'Check your real spend instead of the estimate?',
    body: 'The estimate misses spend outside LCW: other machines, CI, scripts. Give LCW a command that prints your last 7 days in dollars and it uses that, every 5 minutes.',
    options: [['set', 'Set it up'], ['later', 'Not now'], ['never', "Don't ask again"]],
  },
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A time given as milliseconds or as an ISO string, or NaN.
const ms = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN)
const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many)

/** "Fri 22 Nov at 14:00" on the machine's clock, or '' when the time is unknown. */
function dayAt(t) {
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' at ' + hhmm(d)
}

/** "yesterday at 18:40", or "Fri 22 Nov at 14:00" from two days back; the bare time when it is today and bare is set. */
function agoAt(t, now, bare) {
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86400000)
  if (days <= 0) return bare ? hhmm(d) : 'today at ' + hhmm(d)
  return days === 1 ? 'yesterday at ' + hhmm(d) : dayAt(t)
}

// Dotted versions compared number by number; a part that is not a number counts as 0.
function newer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return d > 0
  }
  return false
}

// The spend command's stored failure is already a phrase ('printed "401 Unauthorized"', 'took longer than 30 s');
// only output that was not a figure is called "not a dollar figure".
const lastTime = (why) => { const t = String(why).replace(/\s+/g, ' ').trim(); return /^printed ".*"$/.test(t) ? t + ', not a dollar figure' : t }

const box = (kind, key, title, lines, bullets, options) => ({ kind, key, title, lines: lines.filter(Boolean), bullets: bullets.filter(Boolean), options })
const askText = (a) => String(a.text ?? '').replace(/\s+/g, ' ').trim()

// When the newest open question was asked. Its number cannot say: lcw gives a new question the next number after the
// open ones, so a number comes back once its question is answered.
const newestAt = (run) => Math.max(...run.asks.map((a) => ms(a.at)))

/** The answer box's occurrence: its run and when the newest open question was asked. */
export const answerKey = (run) => run.id + ':' + newestAt(run)

// The meaning beside each reply on the approval box; Go's own comes from the playback (lcw approval --meaning).
const BUT_MEANS = 'with the change you type'
const ELSE_MEANS = 'drop this and pick again'

/** The approval box's occurrence: its run and when the playback asked. */
export const approveKey = (run) => run.id + ':' + run.approval.at

// The end of the Brainstorm (a build) or of the Charter (a sweep): the question and its replies, beside what was played
// back in the chat. Its buttons only fill the prompt.
function approveBox(run) {
  const a = run.approval
  const sweep = run.shape === 'sweep'
  const go = a.go.map((label, i) => ['go' + (i + 1), label])
  const b = box('approve', approveKey(run), sweep ? 'Is this the charter you want?' : 'Is this what you want built?',
    [sweep ? 'The charter is in the chat above.' : 'The playback is in the chat above.'], [], [...go, ['but', 'Yes, but …'], ['else', 'Something else']])
  return {
    ...b, tag: sweep ? ' ◆ LCW Sweep · Charter ready ' : ' ◆ LCW Build · Brainstorm done ',
    choices: [{ ids: go.map(([id]) => id), meaning: a.meaning }, { ids: ['but'], meaning: BUT_MEANS }, { ids: ['else'], meaning: ELSE_MEANS }],
    note: 'It fills your prompt; Enter sends.',
  }
}

// A sweep's short question, one at a time: the press is saved with no turn; Other puts the person's own words in the prompt.
function questionBox(run) {
  const { open, asked, answered } = run.questions
  const q = open[0]
  const options = [...q.options.map((o) => [o.key, o.label]), ['park', 'Leave it parked'], ['other', 'Other…']]
  const b = box('question', run.id + ':' + q.id, q.text, [q.why], [], options)
  return {
    ...b, questionId: q.id, tag: ' ◆ LCW Sweep · your call ' + (answered + 1) + ' of ' + asked + ' ',
    choices: [...q.options.map((o) => ({ ids: [o.key], meaning: o.meaning })),
      { ids: ['park'], meaning: 'stays in parked.md for later' }, { ids: ['other'], meaning: 'your own answer, typed in the prompt' }],
    note: 'Saved for the next wave; nothing waits on you.',
  }
}

function answerBox(run, answerFill) {
  const asks = run.asks
  const waiting = asks.reduce((n, a) => n + (Number(a.waiting) || 0), 0)
  return box('answer', answerKey(run), (run.title || 'The run') + ' needs your answer.',
    [
      waiting && plural(waiting, 'task waits', 'tasks wait') + ' for this; the rest carry on.',
      answerFill === 'failed' && 'Answer now could not fill your prompt. Type your answer there, starting with ' + asks[0].n + ':',
    ],
    asks.map((a) => (asks.length > 1 ? a.n + ': ' : '') + askText(a)),
    [['now', 'Answer now'], ['later', 'Later']])
}

// The mark box, for a paused run (D1) or a session with no run (K). Only raises above what is used and above the mark are offered.
function markBox({ run, usage = {}, billing, now }) {
  const money = billing === 'payg' && usage.capUsd > 0 && usage.markUsd > 0
  // With no run, one occurrence is a week at the mark, or on pay-per-token billing (no week) a climb to it: since.
  // The reset as a time, not as written: the status line and the mod store it in different ISO forms.
  const tail = run ? run.id + ':' + run.pausedAt : 'session:' + (money ? usage.since : ms(usage.resetsAt)) + ':' + (money ? usage.markUsd : usage.markPercent)
  const reset = dayAt(ms(usage.resetsAt))
  const used = usage.usedPercent
  let title, rest, options
  if (money) {
    const pct = Math.round(usage.markUsd / usage.capUsd * 100)
    const mark = `${dollars(usage.markUsd)} mark (${pct}% of your ${dollars(usage.capUsd)} weekly cap)`
    const spent = Number(usage.spentUsd) || 0
    const back = 'it tries again at 08:00' + (new Date(next0800(now)).getDate() === new Date(now).getDate() ? '' : ' tomorrow') + ' if your 7-day spend is back under the mark.'
    title = run ? run.title + ' paused at your ' + mark + '.' : 'This session is at your ' + mark + '.'
    // With no run nothing is tried again at 08:00: the agent gate lets agents through once the spend is under the mark.
    rest = run ? 'Waiting, ' + back : `Your 7-day spend is ${dollars(spent)}, so Claude starts no new agents until you raise the mark or the spend is back under it.`
    options = [[0.9, 'r90'], [1, 'r100']].filter(([f]) => usage.capUsd * f > spent && usage.capUsd * f > usage.markUsd)
      .map(([f, id]) => [id, 'Run up to ' + dollars(usage.capUsd * f)])
    options.push(['wait', run ? 'Wait until 08:00' : 'Wait'])
  } else {
    if (!Number.isFinite(usage.markPercent) || !Number.isFinite(usage.usedPercent)) return null
    const mark = Math.round(usage.markPercent) + '% mark'
    title = run ? run.title + ' paused at your ' + mark + '.' : 'This session is at your ' + mark + '.'
    const resets = 'the week resets' + (reset ? ' on ' + reset : '') + '.'
    rest = run ? 'Waiting, it resumes by itself when ' + resets
      : Math.round(used) + '% of your week is used, so Claude starts no new agents until you raise the mark or ' + resets
    options = [[90, 'r90'], [100, 'r100']].filter(([p]) => p > used && p > usage.markPercent).map(([p, id]) => [id, 'Run up to ' + p + '%'])
    options.push(['wait', 'Wait until limit reset'])
  }
  let lines = [rest]
  if (run) {
    const tasks = Number.isFinite(run.done) && Number.isFinite(run.left) ? ' with ' + plural(run.done, 'task', 'tasks') + ' done and ' + run.left + ' left' : ''
    lines = [(run.stage ? 'It is in ' + run.stage + tasks : 'It is paused') + '. ' + rest]
  }
  return box('mark', tail, title, lines, [], options)
}

// One open wave in the status bar's words: "wave 1 in its final checks", "wave 2 in Build", "wave 1 waits on your answer".
function waveWords(w) {
  if (w.waiting) return 'wave ' + w.n + ' waits on your answer'
  if (w.stage === 'Ship' && w.step === 'merging') return 'wave ' + w.n + ' merging'
  if (w.stage === 'Ship' && w.step === 'final checks') return 'wave ' + w.n + ' in its final checks'
  if (w.stage === 'Review' && w.step === 'closures') return 'wave ' + w.n + ' in Review, closing out'
  return 'wave ' + w.n + (w.stage ? ' in ' + w.stage : '')
}

function unfinishedBox(u, now) {
  // name is the run's name; title is the one line it was started with, when the mod has it.
  const name = u.name ?? u.title
  // A sweep stands in a wave, a build in a milestone of its Build.
  const open = Array.isArray(u.waves) ? u.waves : []
  const where = open.length ? ' with ' + open.map(waveWords).join(', ') : (u.stage ? ' in ' + u.stage : '') + (u.wave ? ', wave ' + u.wave : u.stage === 'Build' && u.milestone ? ', milestone ' + u.milestone : '')
  const tasks = Number.isFinite(u.done) && Number.isFinite(u.left) ? ': ' + plural(u.done, 'task', 'tasks') + ' done, ' + u.left + ' left' : ''
  return box('unfinished', u.id, 'A run in this repository stopped halfway: ' + name + '.',
    [
      u.name && u.title ? 'The change: ' + String(u.title).trim().replace(/\.$/, '') + '.' : 'It was building ' + name + '.',
      'It stopped ' + agoAt(ms(u.stoppedAt), now) + where + tasks + '.' + (u.nextStep ? ' Next was "' + u.nextStep + '".' : '') + ' No open session is driving it.',
      // A run stopped before lcw worktree has neither: its box names only what it has.
      'Abandon stops it for good' + (u.worktree ? ' and removes its worktree' : '') + (u.branch ? '; its branch stays, so no work is lost.' : '.'),
    ], [], [['resume', 'Resume'], ['abandon', 'Abandon'], ['later', 'Not now']])
}

/**
 * Which box to show and what it says, or null. facts is whatever the mod gathered; a missing fact means it does not
 * apply. The first of these that applies wins: the run's answer, the approval at the end of the Brainstorm or the Charter, the mark, the spend check, an unfinished run, keeping
 * awake, the update's restart, the update, what's new, the first-run guide, cleanup, the status line, then the advisor,
 * the cap and the spend check as they were. A box shows unless dismissed holds its "kind:key" (Not now, Later: one
 * occurrence, this session) or notices says never for it. The advisor, cap and spend boxes are dismissed by their kind.
 */
export function bannerFor(facts = {}) {
  const { now = 0, billing, notices = {}, run = null, usage, update, sleep, statusLine, cleanup, unfinished, spendFailing, dismissed = new Set() } = facts
  const n = notices ?? {}
  const shows = (b) => b && !dismissed.has(b.kind + ':' + b.key) && b

  if (run?.asks?.length) {
    // Later puts off this run's questions up to the newest then open: only one asked after it brings the box back.
    const b = answerBox(run, facts.answerFill)
    const putOff = 'answer:' + run.id + ':'
    const newest = newestAt(run)
    if (![...dismissed].some((k) => k === 'answer:' + b.key || (k.startsWith(putOff) && Number(k.slice(putOff.length)) >= newest))) return b
  }
  // Until the person sends anything after the playback asked: a reply typed by hand ends it as a pressed button does.
  if (run?.approval && !(facts.repliedAt >= run.approval.at)) { const b = shows(approveBox(run)); if (b) return b }
  if (run ? run.status === 'paused' && run.pausedReason === 'mark' : usage?.atMark) { const b = shows(markBox({ run, usage, billing, now })); if (b) return b }
  if (billing === 'payg' && facts.spendCommandSet && spendFailing?.fails >= SPEND_COMMAND_FAILS) {
    const since = agoAt(ms(spendFailing.since), now, true)
    const b = shows(box('spendfail', spendFailing.since, 'Your spend check is failing.', [
      'It has failed ' + plural(spendFailing.fails, 'time', 'times') + (since ? ' since ' + since : '') + '.' +
        (spendFailing.lastError ? ' Last time it ' + lastTime(spendFailing.lastError) + '.' : '') +
        ' Until it works, LCW counts on from its last reading.',
    ], [], [['fix', 'Fix it'], ['off', 'Turn it off'], ['later', 'Not now']]))
    if (b) return b
  }
  if (!run && unfinished) { const b = shows(unfinishedBox(unfinished, now)); if (b) return b }
  if (run?.status === 'running' && run.stage && run.stage !== 'Brainstorm' && run.stage !== 'Charter' && sleep?.canHold && !sleep.heldByOther && !run.awake && !n.awake) {
    const b = shows(box('awake', run.id + ':' + run.runningSince, 'Keep this computer awake while ' + run.title + ' runs?', [
      'From here the run works on its own, often for hours. If the computer sleeps, the run stops until you are back. Keep awake holds off sleep until the run finishes or pauses; closing a laptop lid still sleeps it.',
    ], [], [['keep', 'Keep awake'], ['later', 'Not now'], ['never', "Don't ask again"]]))
    if (b) return b
  }
  if (run?.questions?.open?.length) { const b = shows(questionBox(run)); if (b) return b }
  const { updated, available } = update ?? {}
  // Only while what Update now installed is newer than what runs: after a manual update, a reinstall or a downgrade, never.
  if (updated && update.running && newer(updated.to, update.running)) {
    const b = shows(box('restart', updated.to, 'LCW is updated. Restart Claude Code to use it.',
      ['Type /exit, then claude --continue to pick up this conversation where it was.'], [], [['ok', 'Got it']]))
    if (b) return b
  }
  if (available && !update.devCheckout && !run && newer(available.version, update.running ?? available.from ?? '0')) {
    const b = shows(box('update', available.version, 'An update to LCW is ready: ' + available.version + ' (you have ' + (update.running ?? available.from) + ').',
      ['It takes effect when you restart Claude Code. Your runs and settings stay as they are.'], (available.bullets ?? []).slice(0, 3),
      [['now', 'Update now'], ['later', 'Not now']]))
    if (b) return b
  }
  // The bullets for the version now running: Update now's, or the update check's when it came some other way.
  const news = [updated && { version: updated.to, bullets: updated.bullets }, available].find((u) => u && u.version === update.running && u.bullets?.length)
  if (news && !n['whatsnew:' + news.version]) {
    const b = shows(box('whatsnew', news.version, "What's new in LCW", [], news.bullets.slice(0, 3), [['ok', 'Got it']]))
    if (b) return b
  }
  if (run?.firstOnMachine && run.stage === 'Brainstorm' && !n.guide) {
    const b = shows(box('guide', run.id, 'Your first LCW run has started.', [
      'First we agree what you want; you approve once. Then it works on its own: Spec, Plan, Build, Review, and a draft pull request for you.',
      'The card below follows it. Click an agent to talk to it. Say pause, carry on or stop at any time.',
    ], [], [['ok', 'Got it'], ['learn', 'Learn more']]))
    if (b) return b
  }
  if (cleanup && !n['cleanup:' + facts.repoKey]) {
    const b = shows(box('cleanup', cleanup.at, cleanup.title, [
      'Clean Up removes them from ' + (facts.mac ? 'this Mac' : 'this computer') + ' only. Nothing on GitHub changes, and anything not merged stays.',
    ], (cleanup.bullets ?? []).slice(0, 4), [['clean', 'Clean Up'], ['discuss', 'Discuss it'], ['later', 'Not now'], ['never', 'Do not ask again']]))
    if (b) return b
  }
  if (statusLine?.command && !statusLine.mine && !n.statusline && n.auto !== 'off') {
    const b = shows(box('statusline', statusLine.command, "LCW's status rows were replaced.", [
      'Your status line now runs another command (' + clip(statusLine.command, 40) + "). Put LCW's back to see the model, the context and your week against the mark again.",
    ], [], [['back', "Put LCW's back"], ['keep', 'Keep mine']]))
    if (b) return b
  }

  const old = (kind) => ({ kind, key: kind, title: BANNERS[kind].title, lines: [BANNERS[kind].body], bullets: [], options: BANNERS[kind].options })
  if (!facts.advisorModel && !facts.advisorFlag && n.advisor !== 'never' && !dismissed.has('advisor')) return old('advisor')
  if (billing !== 'payg') return null
  if (!facts.capSet) return dismissed.has('cap') ? null : old('cap')
  if (!facts.spendCommandSet && n.spend !== 'never' && !dismissed.has('spend')) return old('spend')
  return null
}

const HINT = 'click · or ctrl+x, Tab, Enter'
const MAX_WIDTH = 92
const len = (t) => [...t].length

// Greedy word wrap; a word longer than the line is cut so no row overflows.
function wrap(text, width) {
  const out = []
  let line = ''
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (len(word) > width) {
      if (line) { out.push(line); line = '' }
      const chars = [...word]
      out.push(chars.slice(0, width).join(''))
      word = chars.slice(width).join('')
    }
    if (line && len(line) + 1 + len(word) > width) { out.push(line); line = word } else line = line ? line + ' ' + word : word
  }
  if (line) out.push(line)
  return out
}

/**
 * The banner's rows, one cell per character, as the card's rows are: a rounded border in the Fable colour, the
 * title in bold, the bullets with a hanging indent, then the text, and the options as buttons whose id is
 * "banner:<kind>:<option>", the first one filled. As wide as the card when one is drawn under it (overCard), else at
 * most 92 cells; the hint gives way first, then the buttons go one to a row.
 */
export function bannerRows(banner, cols, overCard = false, tight = false) {
  if (!banner) return []
  if (banner.choices) return choiceRows(banner, cols, overCard, tight)
  const { kind, title, lines, bullets, options } = banner
  const width = overCard ? cols : Math.min(cols, MAX_WIDTH)
  const inner = width - 2
  if (inner < 20) return []
  const edge = (t) => ({ t, c: 'Fable' })
  const row = (spans) => {
    const used = spans.reduce((n, s) => n + len(String(s.t)), 0)
    return [edge('│'), ...spans, { t: ' '.repeat(Math.max(0, inner - used)) }, edge('│')]
  }
  const tag = ' ◆ LCW '
  const rows = [[edge('╭─'), { t: tag, c: 'Fable', b: true }, edge('─'.repeat(Math.max(0, inner - 1 - len(tag))) + '╮')]]
  for (const t of wrap(title, inner - 4)) rows.push(row([{ t: '  ' + t, c: 'text', b: true }]))
  for (const b of bullets) wrap(b, inner - 6).forEach((t, k) => rows.push(row([{ t: (k ? '    ' : '  • ') + t, c: 'text' }])))
  for (const l of lines) for (const t of wrap(l, inner - 6)) rows.push(row([{ t: '  ' + t, c: 'text' }]))
  rows.push(row([]))
  const buttons = options.map(([id, label], i) => ({
    t: '  ' + label + '  ', id: `banner:${kind}:${id}`, ...(i === 0 ? { bg: 'Fable', c: 'bg', b: true } : { bg: 'hairline', c: 'text' }),
  }))
  const gap = { t: '  ' }
  const together = [{ t: '  ' }, ...buttons.flatMap((s, i) => (i ? [gap, s] : [s]))]
  const wide = together.reduce((n, s) => n + len(s.t), 0)
  if (wide + 2 + len(HINT) + 2 <= inner) {
    rows.push(row([...together, { t: ' '.repeat(inner - wide - len(HINT) - 2) }, { t: HINT, c: 'dim' }, { t: '  ' }]))
  } else if (wide <= inner) {
    rows.push(row(together))
  } else {
    buttons.forEach((s) => rows.push(row([{ t: '  ' }, s])))
  }
  rows.push([edge('╰' + '─'.repeat(inner) + '╯')])
  return rows
}

/**
 * A box whose replies stand in a column, each with what it means beside it (the approval box): the first reply's
 * buttons filled, the others grey, a blank row between replies so their fills do not run together, and a note with
 * the hint at the foot. tight drops the plain line, for where the full box does not fit; the blank rows stay, since
 * filled cells on rows that touch run together.
 */
function choiceRows(banner, cols, overCard, tight) {
  const { kind, title, lines, options, choices, note = '' } = banner
  const width = overCard ? cols : Math.min(cols, MAX_WIDTH)
  const inner = width - 2
  if (inner < 30) return []
  const edge = (t) => ({ t, c: 'Fable' })
  const row = (spans) => {
    const used = spans.reduce((n, s) => n + len(String(s.t)), 0)
    return [edge('│'), ...spans, { t: ' '.repeat(Math.max(0, inner - used)) }, edge('│')]
  }
  const tag = banner.tag ?? ' ◆ LCW '
  const rows = [[edge('╭─'), { t: tag, c: 'Fable', b: true }, edge('─'.repeat(Math.max(0, inner - 1 - len(tag))) + '╮')]]
  for (const t of wrap(title, inner - 4)) rows.push(row([{ t: '  ' + t, c: 'text', b: true }]))
  if (!tight) for (const l of lines) for (const t of wrap(l, inner - 4)) rows.push(row([{ t: '  ' + t, c: 'dim' }]))
  rows.push(row([]))
  const labelOf = (id) => options.find((o) => o[0] === id)?.[1] ?? id
  // A button is its label with a space either side; one reply's buttons two cells apart; the column as wide as the widest reply.
  const chipsOf = (c, first) => c.ids.flatMap((id, k) => [
    ...(k ? [{ t: '  ' }] : []),
    { t: ' ' + clip(labelOf(id), inner - 8) + ' ', id: `banner:${kind}:${id}`, ...(first ? { bg: 'Fable', c: 'bg', b: true } : { bg: 'hairline', c: 'text', b: true }) },
  ])
  const sets = choices.map((c, i) => chipsOf(c, i === 0))
  const wide = (spans) => spans.reduce((n, s) => n + len(s.t), 0)
  const col = Math.max(...sets.map(wide))
  // Replies whose buttons do not fit draw no box: the chat's own question still stands.
  if (col > inner - 4) return []
  const room = inner - 2 - col - 3 - 2
  choices.forEach((c, i) => {
    if (i) rows.push(row([]))
    const chips = sets[i]
    // The last button of each reply is padded to the column, so the replies read as one list.
    chips[chips.length - 1] = { ...chips[chips.length - 1], t: chips[chips.length - 1].t + ' '.repeat(col - wide(chips)) }
    const pad = { t: ' '.repeat(col - wide(chips) + 3) }
    if (room >= 16) {
      const said = wrap(c.meaning, room)
      rows.push(row([{ t: '  ' }, ...chips, pad, { t: said[0] ?? '', c: 'mid' }]))
      for (const t of said.slice(1)) rows.push(row([{ t: ' '.repeat(2 + col + 3) + t, c: 'mid' }]))
    } else {
      rows.push(row([{ t: '  ' }, ...chips]))
      for (const t of wrap(c.meaning, inner - 6)) rows.push(row([{ t: '    ' + t, c: 'mid' }]))
    }
  })
  rows.push(row([]))
  if (len(note) + len(HINT) + 6 <= inner) rows.push(row([{ t: '  ' + note, c: 'dim' }, { t: ' '.repeat(inner - len(note) - len(HINT) - 4) }, { t: HINT, c: 'dim' }, { t: '  ' }]))
  else for (const t of wrap(note, inner - 4)) rows.push(row([{ t: '  ' + t, c: 'dim' }]))
  rows.push([edge('╰' + '─'.repeat(inner) + '╯')])
  return rows
}
