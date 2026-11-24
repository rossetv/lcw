// The usage mark: when a session is at it, and what Claude is told then. Pure, so the hook that runs at a prompt
// and the mod that runs after a tool call say the same things.
import { dollars } from './format.mjs'
import { idName } from './key.mjs'

/**
 * True when a shell line runs lcw and nothing else: one call, or several joined by &&, ; or |. Such a line is
 * winding the run down or lifting the mark, so the stop note leaves it alone. In doubt it answers false.
 */
export function lcwOnly(command) {
  const line = String(command ?? '').replace(/'\\''/g, '_') // an apostrophe inside a single-quoted text, written '\''
  if (/\$\(|`/.test(line.replace(/'[^']*'/g, ''))) return false // a command run inside the line, as in "$(npm test)"
  const parts = line
    .replace(/"[^"]*"|'[^']*'/g, (quoted) => quoted.replace(/[;&|\n]/g, ' ')) // inside quotes these are text
    .replace(/\d*>&\d+/g, '') // 2>&1 starts no second command
    .split(/[;&|\n]+/).map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 && parts.every((part) => /^node\s+("[^"]*lcw\.mjs"|'[^']*lcw\.mjs'|\S*lcw\.mjs)(\s|$)/.test(part))
}

/**
 * True when the week's figure has reached the mark and its reset time has not passed. On pay-per-token billing,
 * given the money view: when the machine's 7-day spend has reached the session's mark in dollars.
 */
export function atMark(mark, usage, now = Date.now(), money = null) {
  if (money) return money.spentUsd >= money.markUsd
  const w = usage?.sevenDay
  if (!w || typeof w.percentUsed !== 'number') return false
  if (w.resetsAt && Date.parse(w.resetsAt) <= now) return false
  return w.percentUsed >= mark
}

/** The mod's own record of what a session was told once: { payg: true } once the pay-per-token note was given. */
export const toldFile = (lcwHome, sessionId) => `${lcwHome}/told/${idName(sessionId)}.json`

/** The lcw command line of the plugin at root, as one shell word, so a folder with a space or a quote still runs. */
export function lcwCommand(root) {
  const script = `${root}/scripts/lcw.mjs`
  return `node ${/^[\w@%+=:,./-]+$/.test(script) ? script : `'${script.replace(/'/g, `'\\''`)}'`}`
}

export function quotaLine(view) {
  return view.status === 'ok'
    ? `external week: ${view.percentUsed}% used${view.blocked ? '; provider refused new work' : ''}`
    : `external quota: ${view.status}${view.code ? ` (${view.code})` : ''}; new work held`
}

/** The lines for a session billed per token. cli is the lcw command line; money is the session's money view. */
export function paygLines(cli, money) {
  const { markUsd, markShare, capUsd, capAssumed } = money
  const mark = markShare == null
    ? `${dollars(markUsd)}, as the user set it`
    : `${dollars(markUsd)} (${markShare}% of the ${dollars(capUsd)} weekly cap${capAssumed ? ', assumed' : ''})${markShare === 75 ? ' unless the user raises it' : ', as the user set it'}`
  const lines = [
    `This session is billed per token, so LCW counts this machine's spend in dollars over the last 7 days (Claude Code's own estimate). It has a usage mark, run or no run: ${mark}. It holds for this session only. When a hook tells you the session is at its mark, stop and tell the user; never raise the mark without their explicit words. A spend command, set with lcw spend-command, can supply the 7-day figure; set, change or turn it off only on the user's explicit words, as with the mark.`,
  ]
  if (capAssumed) {
    lines.push(`The user has not stated their weekly cap on this machine yet, so ${dollars(capUsd)} is assumed; an LCW banner above the prompt asks them. When they say "Set my weekly cap for LCW.", ask in one line for the dollars they allow in any 7 days, then run the cap command below with their answer.`)
  }
  lines.push(`When they say "Set up my LCW spend check.", ask in a few lines for the command that prints their spend for the last 7 days in dollars: one number such as 1240.55, printed within 30 seconds; LCW runs it every 5 minutes. If they have none, offer to help write one for where their bill lives (the Anthropic Console, AWS Bedrock, Google Vertex), reading their credentials from where they already keep them. Then run ${cli} spend-command <their command line>. It saves the command only when it prints a figure: tell them what it printed, or why it failed and what to change.`)
  lines.push(`Turn their words into commands, writing no dollar sign in the command. Their weekly cap ("4000 USD", "my weekly cap is now 5000"): run ${cli} cap 5000, with their figure; it keeps for every later session on this machine. A dollar mark ("run up to 5500" or "run up to $5,500"): run ${cli} mark 5500usd. A share of the cap ("run up to 80%"): run ${cli} mark 80. To finish regardless of the limit: run ${cli} mark 100. Each prints a confirmation: tell the user what it says, and that they can say "run up to" a dollar figure for this session, or change their cap by saying so.`)
  return lines
}

/**
 * Everything Claude is told now, in order: the once-only note when its command line is given as `cli`, then the
 * stop that applies. event is UserPromptSubmit or PostToolUse. heldQuota is the held outside quota (the session's
 * or its run's driver's), quota the session's own view; money the session's money view; mark and usage the
 * percent mark and the week's figure; hasRun whether the session has a run; driverHeld whether the run's driver
 * is at its mark, with driverMoney and driverMark its figures.
 */
export function stopTexts({ event, lcwCall, hasRun, cli, money, quota, heldQuota, mark, usage, now, driverHeld, driverMoney, driverMark }) {
  const texts = []
  if (cli) texts.push('LCW: this session turned out to be billed per token.', ...paygLines(cli, money))
  if (heldQuota && !lcwCall) {
    texts.push(`LCW: STOP. ${quotaLine(heldQuota)}. ${hasRun ? 'Launch nothing new: let running agents finish, record the state, then run lcw pause mark.' : 'Stop work and tell the user.'} A reset alone is not permission: wait for a fresh allowable reading. Explaining LCW (lcw:learn) may continue. Never raise the mark without the user.`)
  } else if (money && !lcwCall && atMark(null, null, now, money)) {
    const used = dollars(money.spentUsd)
    const markUsd = dollars(money.markUsd)
    // At the full cap already, "finish this regardless" (the full cap) lifts nothing: only a dollar mark above the cap does.
    const lift = money.markUsd < money.capUsd
      ? 'Only the user\'s explicit words lift this: "run up to $X" (then run `lcw mark Xusd`), "run up to N%" of the weekly cap (then run `lcw mark N`), or "finish this regardless of the limit" (then run `lcw mark 100`).'
      : 'Only the user\'s explicit words lift this: "run up to $X" past the weekly cap (then run `lcw mark Xusd`).'
    texts.push(event === 'UserPromptSubmit'
      ? `LCW: STOP. This session is at its usage mark: ${used} was spent on this machine in the last 7 days and the mark is ${markUsd}. Do not start or continue work. Explaining how LCW works (the lcw:learn conversation) is not work: it goes on at the mark, so teach it. If this message from the user lifts the mark, run that command first and carry on. Otherwise, if they are not asking how LCW works, tell them in a line or two that the session is at its mark, and end your turn. ${lift}`
      : `STOP! LCW: this session is at its usage mark (${used} spent in the last 7 days, mark ${markUsd}). ${hasRun ? 'Launch nothing new: let the running agents finish, record the state, run `lcw pause mark` and end your turn.' : 'Make no further tool call for the work: end your turn now and tell the user.'} Explaining how LCW works (lcw:learn and the reading it does) is not work: it goes on. ${lift}`)
  } else if (!quota && !money && !lcwCall && atMark(mark, usage, now)) {
    const used = usage.sevenDay.percentUsed
    // At 100% already nothing the user says lifts it: the week itself has run out.
    const lift = mark < 100
      ? 'Only the user\'s explicit words lift this: "run up to N%" (then run `lcw mark N`), or "finish this regardless of the limit" (then run `lcw mark 100`).'
      : 'The mark is already the whole week, so nothing lifts it before the weekly limit resets.'
    texts.push(event === 'UserPromptSubmit'
      ? `LCW: STOP. This session is at its usage mark: ${used}% of the week is used and the mark is ${mark}%. Do not start or continue work. Explaining how LCW works (the lcw:learn conversation) is not work: it goes on at the mark, so teach it. If this message from the user lifts the mark, run that command first and carry on. Otherwise, if they are not asking how LCW works, tell them in a line or two that the session is at its mark, and end your turn. ${lift}`
      : `STOP! LCW: this session is at its usage mark (${used}% of the week used, mark ${mark}%). ${hasRun ? 'Launch nothing new: let the running agents finish, record the state, run `lcw pause mark` and end your turn.' : 'Make no further tool call for the work: end your turn now and tell the user.'} Explaining how LCW works (lcw:learn and the reading it does) is not work: it goes on. ${lift}`)
  } else if (driverHeld && !lcwCall) {
    const figure = driverMoney
      ? `${dollars(driverMoney.spentUsd)} spent in the last 7 days, mark ${dollars(driverMoney.markUsd)}`
      : `${usage.sevenDay.percentUsed}% of the week used, mark ${driverMark}%`
    texts.push(`LCW: STOP. This run's driving session is at its usage mark (${figure}). Launch nothing new: let running agents finish, record the state, run lcw pause mark and end your turn. Explaining LCW (lcw:learn) may continue. Never raise the mark without the user.`)
  }
  return texts
}
