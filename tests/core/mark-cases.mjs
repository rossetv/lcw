// What a session at its usage mark is told, as plain data: for each state, the exact text at a prompt and after a
// tool call. No import, so a test that has no file system can read the same table.
//
// A row is a state and what each call says (null: nothing):
//   sessions  the session files, by id; the session under test is p1
//   spend     dollars spent in the last 7 days, by session id
//   week      the week's usage percent (the status line's figure), when there is one
//   cap       the weekly cap in dollars, when the user has stated one
//   quota     an external quota for a session, by id: ok (80%), blocked (42%, refused), under (42%) or missing
//   run       who started the run: p1, or drv (then p1 is bound to it and drv drives)
//   transcript the name of the session's transcript, when it is not p1: the session is known by both names
//   running   the Claude Code processes the rows record (claudePid) that still run; the others have ended
//   pid       the CLAUDE_PID the hook is started with, unset when not given
//   marker    the mod's after-call marker, where it differs from whether the check after a tool call says something:
//             the mod cannot see which processes run nor the hook's CLAUDE_PID, so it keeps the marker up when the
//             check would speak under any answer to those
//   expect    prompt, tool (an Edit), lcw (a Bash call of LCW's own command) and agent (a subagent's Edit); a call
//             that is not named is not pinned
// The text `{cli}` stands for the lcw command line of the plugin.

const END = 'tell them in a line or two that the session is at its mark, and end your turn.'
const PROMPT_TAIL = 'Do not start or continue work. Explaining how LCW works (the lcw:learn conversation) is not work: it goes on at the mark, so teach it. If this message from the user lifts the mark, run that command first and carry on. Otherwise, if they are not asking how LCW works, ' + END
const TOOL_TAIL = 'Explaining how LCW works (lcw:learn and the reading it does) is not work: it goes on.'
const NO_RUN = 'Make no further tool call for the work: end your turn now and tell the user.'
const RUN = 'Launch nothing new: let the running agents finish, record the state, run `lcw pause mark` and end your turn.'

const LIFT_PCT = 'Only the user\'s explicit words lift this: "run up to N%" (then run `lcw mark N`), or "finish this regardless of the limit" (then run `lcw mark 100`).'
const LIFT_WEEK = 'The mark is already the whole week, so nothing lifts it before the weekly limit resets.'
const LIFT_USD = 'Only the user\'s explicit words lift this: "run up to $X" (then run `lcw mark Xusd`), "run up to N%" of the weekly cap (then run `lcw mark N`), or "finish this regardless of the limit" (then run `lcw mark 100`).'
const LIFT_CAP = 'Only the user\'s explicit words lift this: "run up to $X" past the weekly cap (then run `lcw mark Xusd`).'

const pctPrompt = (used, mark, lift) => `LCW: STOP. This session is at its usage mark: ${used}% of the week is used and the mark is ${mark}%. ${PROMPT_TAIL} ${lift}`
const pctTool = (used, mark, run, lift) => `STOP! LCW: this session is at its usage mark (${used}% of the week used, mark ${mark}%). ${run} ${TOOL_TAIL} ${lift}`
const usdPrompt = (used, mark, lift) => `LCW: STOP. This session is at its usage mark: ${used} was spent on this machine in the last 7 days and the mark is ${mark}. ${PROMPT_TAIL} ${lift}`
const usdTool = (used, mark, run, lift) => `STOP! LCW: this session is at its usage mark (${used} spent in the last 7 days, mark ${mark}). ${run} ${TOOL_TAIL} ${lift}`

const quotaStop = (line, run) => `LCW: STOP. ${line}. ${run ? 'Launch nothing new: let running agents finish, record the state, then run lcw pause mark.' : 'Stop work and tell the user.'} A reset alone is not permission: wait for a fresh allowable reading. Explaining LCW (lcw:learn) may continue. Never raise the mark without the user.`
const driverStop = (figure) => `LCW: STOP. This run's driving session is at its usage mark (${figure}). Launch nothing new: let running agents finish, record the state, run lcw pause mark and end your turn. Explaining LCW (lcw:learn) may continue. Never raise the mark without the user.`

const NOTE_LEAD = 'LCW: this session turned out to be billed per token.'
const noteMain = (mark) => `This session is billed per token, so LCW counts this machine's spend in dollars over the last 7 days (Claude Code's own estimate). It has a usage mark, run or no run: ${mark}. It holds for this session only. When a hook tells you the session is at its mark, stop and tell the user; never raise the mark without their explicit words. A spend command, set with lcw spend-command, can supply the 7-day figure; set, change or turn it off only on the user's explicit words, as with the mark.`
const NOTE_CAP = 'The user has not stated their weekly cap on this machine yet, so $4,000 is assumed; an LCW banner above the prompt asks them. When they say "Set my weekly cap for LCW.", ask in one line for the dollars they allow in any 7 days, then run the cap command below with their answer.'
const NOTE_SPEND = 'When they say "Set up my LCW spend check.", ask in a few lines for the command that prints their spend for the last 7 days in dollars: one number such as 1240.55, printed within 30 seconds; LCW runs it every 5 minutes. If they have none, offer to help write one for where their bill lives (the Anthropic Console, AWS Bedrock, Google Vertex), reading their credentials from where they already keep them. Then run {cli} spend-command <their command line>. It saves the command only when it prints a figure: tell them what it printed, or why it failed and what to change.'
const NOTE_WORDS = 'Turn their words into commands, writing no dollar sign in the command. Their weekly cap ("4000 USD", "my weekly cap is now 5000"): run {cli} cap 5000, with their figure; it keeps for every later session on this machine. A dollar mark ("run up to 5500" or "run up to $5,500"): run {cli} mark 5500usd. A share of the cap ("run up to 80%"): run {cli} mark 80. To finish regardless of the limit: run {cli} mark 100. Each prints a confirmation: tell the user what it says, and that they can say "run up to" a dollar figure for this session, or change their cap by saying so.'
const note = (mark, assumed) => [NOTE_LEAD, noteMain(mark), ...(assumed ? [NOTE_CAP] : []), NOTE_SPEND, NOTE_WORDS].join('\n')

const PAYG = { billing: 'payg', toldPayg: true }
const USD_MARK = '$3,000 (75% of the $4,000 weekly cap, assumed) unless the user raises it'

export const cases = [
  { name: 'under the mark: nothing', week: 50, expect: { prompt: null, tool: null, lcw: null, agent: null } },
  {
    name: 'the percent mark, no run',
    week: 80,
    expect: { prompt: pctPrompt(80, 75, LIFT_PCT), tool: pctTool(80, 75, NO_RUN, LIFT_PCT), lcw: null, agent: null },
  },
  {
    name: 'the percent mark, the session drives a run',
    week: 80,
    run: 'p1',
    expect: { prompt: pctPrompt(80, 75, LIFT_PCT), tool: pctTool(80, 75, RUN, LIFT_PCT), lcw: null, agent: null },
  },
  {
    name: 'a raised mark that the week has not reached',
    sessions: { p1: { markPercent: 90 } },
    week: 80,
    expect: { prompt: null, tool: null, lcw: null },
  },
  {
    name: 'a mark of the whole week offers nothing that lifts it',
    sessions: { p1: { markPercent: 100 } },
    week: 100,
    expect: { prompt: pctPrompt(100, 100, LIFT_WEEK), tool: pctTool(100, 100, NO_RUN, LIFT_WEEK), lcw: null },
  },
  {
    name: 'the pay-per-token mark, no run',
    sessions: { p1: PAYG },
    spend: { p1: 3020 },
    expect: { prompt: usdPrompt('$3,020', '$3,000', LIFT_USD), tool: usdTool('$3,020', '$3,000', NO_RUN, LIFT_USD), lcw: null, agent: null },
  },
  {
    name: 'the pay-per-token mark, the session drives a run',
    sessions: { p1: PAYG },
    spend: { p1: 3020 },
    run: 'p1',
    expect: { prompt: usdPrompt('$3,020', '$3,000', LIFT_USD), tool: usdTool('$3,020', '$3,000', RUN, LIFT_USD), lcw: null },
  },
  {
    name: 'a pay-per-token mark at the full cap offers only a dollar mark past it',
    sessions: { p1: { ...PAYG, markPercent: 100 } },
    spend: { p1: 4020 },
    expect: { prompt: usdPrompt('$4,020', '$4,000', LIFT_CAP), tool: usdTool('$4,020', '$4,000', NO_RUN, LIFT_CAP), lcw: null },
  },
  {
    name: 'pay-per-token spend under the mark: nothing',
    sessions: { p1: PAYG },
    spend: { p1: 2900 },
    week: 90,
    expect: { prompt: null, tool: null, lcw: null },
  },
  {
    name: 'a session that turns out to be pay-per-token is told once, with the cap question',
    sessions: { p1: { billing: 'payg' } },
    spend: { p1: 100 },
    expect: { prompt: note(USD_MARK, true), tool: note(USD_MARK, true), lcw: note(USD_MARK, true), agent: null },
  },
  {
    name: 'the note gives the cap as stated and the share it is',
    sessions: { p1: { billing: 'payg', markPercent: 80 } },
    spend: { p1: 100 },
    cap: 5000,
    expect: { prompt: note('$4,000 (80% of the $5,000 weekly cap), as the user set it', false) },
  },
  {
    name: 'the note at the default share of a stated cap',
    sessions: { p1: { billing: 'payg' } },
    spend: { p1: 100 },
    cap: 5000,
    expect: { prompt: note('$3,750 (75% of the $5,000 weekly cap) unless the user raises it', false) },
  },
  {
    name: 'the note gives a mark set in dollars as it is',
    sessions: { p1: { billing: 'payg', markUsd: 5500 } },
    spend: { p1: 100 },
    expect: { prompt: note('$5,500, as the user set it', true) },
  },
  {
    name: 'the note comes before the stop, and the stop is withheld from LCW\'s own command',
    sessions: { p1: { billing: 'payg' } },
    spend: { p1: 3500 },
    expect: {
      prompt: `${note(USD_MARK, true)}\n${usdPrompt('$3,500', '$3,000', LIFT_USD)}`,
      tool: `${note(USD_MARK, true)}\n${usdTool('$3,500', '$3,000', NO_RUN, LIFT_USD)}`,
      lcw: note(USD_MARK, true),
    },
  },
  {
    name: 'an outside quota at the mark holds the session, whatever the week says',
    sessions: { p1: { billing: 'subscription' } },
    quota: { p1: 'ok' },
    week: 10,
    expect: { prompt: quotaStop('external week: 80% used', false), tool: quotaStop('external week: 80% used', false), lcw: null, agent: null },
  },
  {
    name: 'an outside quota at the mark, the session drives a run',
    sessions: { p1: { billing: 'subscription' } },
    quota: { p1: 'ok' },
    run: 'p1',
    expect: { prompt: quotaStop('external week: 80% used', true), tool: quotaStop('external week: 80% used', true), lcw: null },
  },
  {
    name: 'an outside quota that refuses new work holds the session below the mark',
    sessions: { p1: { billing: 'subscription' } },
    quota: { p1: 'blocked' },
    expect: { prompt: quotaStop('external week: 42% used; provider refused new work', false) },
  },
  {
    name: 'an outside quota that cannot be read holds the session',
    sessions: { p1: { billing: 'subscription' } },
    quota: { p1: 'missing' },
    expect: { prompt: quotaStop('external quota: unavailable (config-unavailable); new work held', false) },
  },
  {
    name: 'an outside quota under the mark holds nothing, though the week is over it',
    sessions: { p1: { billing: 'subscription' } },
    quota: { p1: 'under' },
    week: 90,
    expect: { prompt: null, tool: null, lcw: null },
  },
  {
    name: 'a driving session on an outside quota at the mark holds a session bound to its run',
    sessions: { p1: { billing: 'subscription' }, drv: { billing: 'subscription' } },
    quota: { drv: 'ok' },
    run: 'drv',
    expect: { prompt: quotaStop('external week: 80% used', true), tool: quotaStop('external week: 80% used', true), lcw: null },
  },
  {
    name: 'the run\'s driver at its mark in percent, with this session raised past it',
    sessions: { p1: { markPercent: 90 } },
    week: 80,
    run: 'drv',
    expect: { prompt: driverStop('80% of the week used, mark 75%'), tool: driverStop('80% of the week used, mark 75%'), lcw: null, agent: null },
  },
  {
    name: 'after a tool call, an outside quota that refuses new work holds the session below the mark',
    sessions: { p1: { billing: 'subscription' } },
    quota: { p1: 'blocked' },
    expect: { tool: quotaStop('external week: 42% used; provider refused new work', false), lcw: null, agent: null },
  },
  {
    name: 'after a tool call, an outside quota that cannot be read holds the session',
    sessions: { p1: { billing: 'subscription' } },
    quota: { p1: 'missing' },
    expect: { tool: quotaStop('external quota: unavailable (config-unavailable); new work held', false), lcw: null, agent: null },
  },
  {
    name: 'after a tool call, the note gives a stated cap and a mark set in dollars',
    sessions: { p1: { billing: 'payg', markUsd: 4500 } },
    spend: { p1: 100 },
    cap: 5000,
    expect: { tool: note('$4,500, as the user set it', false), agent: null },
  },
  {
    name: 'the run\'s driver at its mark in dollars',
    sessions: { p1: { billing: 'subscription' }, drv: PAYG },
    spend: { drv: 3500 },
    run: 'drv',
    expect: { prompt: driverStop('$3,500 spent in the last 7 days, mark $3,000'), tool: driverStop('$3,500 spent in the last 7 days, mark $3,000'), lcw: null },
  },
  {
    name: 'an anchor with no mark leaves the mark of the row under the id',
    transcript: 't1',
    sessions: { p1: { markPercent: 70 }, t1: { sessionCanonicalId: 'a1' }, a1: { sessionCanonicalId: 'a1' } },
    week: 72,
    expect: { prompt: pctPrompt(72, 70, LIFT_PCT), tool: pctTool(72, 70, NO_RUN, LIFT_PCT), lcw: null, agent: null },
  },
  {
    name: 'an anchor with no mark leaves the dollar mark of the row under the id',
    transcript: 't1',
    sessions: { p1: { ...PAYG, markUsd: 2000 }, t1: { ...PAYG, sessionCanonicalId: 'a1' }, a1: { sessionCanonicalId: 'a1' } },
    spend: { p1: 2500 },
    expect: { prompt: usdPrompt('$2,500', '$2,000', LIFT_USD), tool: usdTool('$2,500', '$2,000', NO_RUN, LIFT_USD), lcw: null },
  },
  {
    name: 'an anchor lends its mark to a session with none',
    transcript: 't1',
    sessions: { p1: {}, t1: { sessionCanonicalId: 'a1' }, a1: { sessionCanonicalId: 'a1', markPercent: 60 } },
    week: 65,
    expect: { prompt: pctPrompt(65, 60, LIFT_PCT), tool: pctTool(65, 60, NO_RUN, LIFT_PCT), lcw: null },
  },
  {
    name: 'an anchor lends its dollar mark to a session with none',
    transcript: 't1',
    sessions: { p1: PAYG, t1: { ...PAYG, sessionCanonicalId: 'a1' }, a1: { sessionCanonicalId: 'a1', markUsd: 2000 } },
    spend: { p1: 2500 },
    expect: { prompt: usdPrompt('$2,500', '$2,000', LIFT_USD), tool: usdTool('$2,500', '$2,000', NO_RUN, LIFT_USD), lcw: null },
  },
  {
    name: 'an anchor another running Claude Code owns lends nothing, but the marker stays up for when it ends',
    transcript: 't1',
    sessions: { p1: { claudePid: 4102 }, t1: { sessionCanonicalId: 'a1', claudePid: 4102 }, a1: { sessionCanonicalId: 'a1', markPercent: 60, claudePid: 4101 } },
    running: [4101, 4102],
    pid: 4102,
    week: 65,
    expect: { prompt: null, tool: null, lcw: null },
    marker: true,
  },
  {
    name: 'an anchor whose owner has ended lends its mark',
    transcript: 't1',
    sessions: { p1: { claudePid: 4102 }, t1: { sessionCanonicalId: 'a1', claudePid: 4102 }, a1: { sessionCanonicalId: 'a1', markPercent: 60, claudePid: 4101 } },
    running: [4102],
    pid: 4102,
    week: 65,
    expect: { prompt: pctPrompt(65, 60, LIFT_PCT), tool: pctTool(65, 60, NO_RUN, LIFT_PCT), lcw: null },
  },
  {
    name: 'rows under both names that disagree on the mark take the one under the id',
    transcript: 't1',
    sessions: { p1: { markPercent: 70 }, t1: { markPercent: 90 } },
    week: 80,
    expect: { prompt: pctPrompt(80, 70, LIFT_PCT), tool: pctTool(80, 70, NO_RUN, LIFT_PCT), lcw: null },
  },
  {
    name: 'a mark raised on the row under the id holds for the row under the transcript\'s name too',
    transcript: 't1',
    sessions: { p1: { markPercent: 90 }, t1: { markPercent: 70 } },
    week: 80,
    expect: { prompt: null, tool: null, lcw: null },
  },
  {
    name: 'a transcript row another running Claude Code keeps leaves the mark of the row under the id',
    transcript: 't1',
    sessions: { p1: { markPercent: 70 }, t1: { markPercent: 90, claudePid: 4101 } },
    running: [4101],
    week: 80,
    expect: { prompt: pctPrompt(80, 70, LIFT_PCT), tool: pctTool(80, 70, NO_RUN, LIFT_PCT), lcw: null },
  },
  {
    name: 'with the caller\'s CLAUDE_PID, an id row another running Claude Code keeps is set aside, and the note is still to give',
    transcript: 't1',
    sessions: { p1: { ...PAYG, claudePid: 4102 }, t1: { billing: 'payg', claudePid: 4101 } },
    running: [4101, 4102],
    pid: 4101,
    spend: { t1: 100 },
    expect: { prompt: note(USD_MARK, true), tool: note(USD_MARK, true), lcw: note(USD_MARK, true), agent: null },
  },
  {
    name: 'a note given under both names leaves the marker down though the transcript row records an older process',
    transcript: 't1',
    sessions: { p1: { ...PAYG, claudePid: 222 }, t1: { ...PAYG, claudePid: 111 } },
    running: [111, 222],
    pid: 222,
    spend: { t1: 100 },
    expect: { prompt: null, tool: null, lcw: null, agent: null },
  },
  {
    name: 'a note given at a resumed start under both names, which share one anchor, leaves the marker down',
    transcript: 't1',
    sessions: { t1: { billing: 'payg', claudePid: 222, sessionCanonicalId: 't1', toldPayg: true }, p1: { billing: 'payg', claudePid: 222, sessionCanonicalId: 't1', toldPayg: true } },
    running: [222],
    pid: 222,
    spend: { t1: 100 },
    expect: { prompt: null, tool: null, lcw: null, agent: null },
  },
  {
    name: 'a note given under a transcript another running Claude Code keeps is still to give under the id',
    transcript: 't1',
    sessions: { t1: { billing: 'payg', claudePid: 111, toldPayg: true }, p1: { billing: 'payg', claudePid: 222 } },
    running: [111, 222],
    pid: 222,
    spend: { t1: 100 },
    expect: { prompt: note(USD_MARK, true), tool: note(USD_MARK, true), lcw: note(USD_MARK, true), agent: null },
  },
  {
    name: 'the run\'s driver at the mark its anchor lends',
    sessions: { p1: { markPercent: 90 }, drv: { sessionCanonicalId: 'a2' }, a2: { sessionCanonicalId: 'a2', markPercent: 60 } },
    week: 65,
    run: 'drv',
    expect: { prompt: driverStop('65% of the week used, mark 60%'), tool: driverStop('65% of the week used, mark 60%'), lcw: null },
  },
  {
    name: 'the run\'s driver borrows no mark from an anchor another running Claude Code owns, but the marker stays up',
    sessions: { p1: { markPercent: 90 }, drv: { sessionCanonicalId: 'a2', claudePid: 4102 }, a2: { sessionCanonicalId: 'a2', markPercent: 60, claudePid: 4101 } },
    running: [4101],
    week: 65,
    run: 'drv',
    expect: { prompt: null, tool: null, lcw: null },
    marker: true,
  },
]
