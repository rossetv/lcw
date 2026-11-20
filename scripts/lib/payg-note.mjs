// What Claude is told on pay-per-token billing: the mark in dollars, the cap question while the cap is unstated,
// and how to turn the person's words into commands. Shared by the session-start and limit hooks. No dollar sign
// stands in a command, so none needs shell quoting, and each command is one that lcwOnly lets through.
import { dollars } from '../../lib/format.mjs'

/** The lines for a session billed per token. cli is the lcw command line; money is the session's money view. */
export function paygLines(cli, money) {
  const { markUsd, markShare, capUsd, capAssumed } = money
  const share = markShare == null ? '' : ` (${markShare}%)`
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
