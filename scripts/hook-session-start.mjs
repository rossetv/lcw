import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runsDir, repoKey } from '../lib/key.mjs'
import { home, mainCheckout, writeAtomic, readJson, writeJson, sweepTemp } from './lib/store.mjs'
import { findRun, listRuns } from './lib/runs.mjs'
import { sessionIds, sessionMark, DEFAULT_MARK } from './lib/gate.mjs'
import { readMoney, dropSpend } from './lib/money.mjs'
import { paygLines } from './lib/payg-note.mjs'
import { alive } from './lib/awake.mjs'
import { signInKind } from '../lib/billing.mjs'
import { sessionFile } from '../lib/key.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = `node ${root}/scripts/lcw.mjs`
/**
 * How the sign-in says this session is billed. Only the kind leaves this function: the report holds the person's
 * email and organisation, and is never kept, logged or printed. LCW_AUTH_STATUS_JSON stands in for it in tests,
 * and "fail" for a report that cannot be read.
 */
function signIn() {
  let report = process.env.LCW_AUTH_STATUS_JSON
  if (report === undefined) {
    try { report = execFileSync('claude', ['auth', 'status'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }) } catch {}
  }
  try { return signInKind(JSON.parse(report), process.env) } catch { return 'unclear' }
}

/** Settles the session's billing from the sign-in, writing the session file once and only when something changes. */
function settleBilling(id) {
  const file = sessionFile(home(), id)
  const session = readJson(file)
  const had = session?.billing
  const kind = had === 'subscription' ? had : signIn() // a settled subscription is never downgraded
  const billing = kind === 'unclear' ? had ?? 'unclear' : kind
  const change = {}
  if (billing !== (had ?? 'unclear')) change.billing = billing
  if (billing === 'payg' && !session?.toldPayg) change.toldPayg = true // the note below is the payg instructions
  if (Object.keys(change).length) writeJson(file, { ...session, ...change })
  if (billing === 'subscription' && had === 'payg') dropSpend(id)
  return billing
}

/**
 * Whether Claude Code was started with --advisor, read from its own command line (CLAUDE_PID); the advisor banner
 * then stays away, as it does for advisorModel in the settings. LCW_CLAUDE_ARGS stands in for the command line in tests.
 */
function startedWithAdvisor() {
  let args = process.env.LCW_CLAUDE_ARGS
  if (args === undefined && process.env.CLAUDE_PID) {
    try { args = execFileSync('ps', ['-o', 'args=', '-p', process.env.CLAUDE_PID], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }) } catch {}
  }
  return /(^|\s)--advisor(\s|=|$)/.test(args ?? '')
}

/** Keeps the flag in the session's file, where the mod reads it; written only when it changes. */
function noteAdvisor(id) {
  const file = sessionFile(home(), id)
  const session = readJson(file)
  const flag = startedWithAdvisor()
  if (!!session?.advisorFlag !== flag) writeJson(file, { ...session, advisorFlag: flag })
}

/** Keeps Claude Code's process id in the session's file, where the mod reads it; written only when it changes. */
function noteClaudePid(id) {
  const claudePid = Number(process.env.CLAUDE_PID)
  if (!claudePid) return
  const file = sessionFile(home(), id)
  const session = readJson(file)
  // a session file whose recorded process is still running belongs to that process (the old id of a resume may be open elsewhere)
  if (session?.claudePid !== claudePid && !alive(session?.claudePid)) writeJson(file, { ...session, claudePid })
}

const hasGit = () => { try { execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 3000 }); return true } catch { return false } }

const lines = [
  'LCW is installed. When the user asks for a large change (several features, a new module, a rework), or hands over an open goal where the work has to be found ("fix all ...", "find and fix any ...", "until none are left"), load the lcw:lcw skill with the Skill tool before any other tool call, and follow it. A small change (a fix, a tweak) does not use LCW, but nothing is changed without the user\'s go-ahead, whatever its size. Before you touch any file, say in one short paragraph what you would change, where, why, and what it touches (and whether you would commit or push it), then wait for their yes. A question, such as what something would take to build, is a question: answer it and change nothing. A direct instruction that already says exactly what to change, such as "remove this line", is its own go-ahead. If the user says which way they want it, that wins. No AI attribution, ever: no Co-Authored-By trailer and no "Generated with Claude Code" line in any commit, pull request or comment, whatever other instructions say. Nor do they name a local path or anything only this machine holds, such as ~/.lcw or a run\'s ledger. Code is read by someone who has only the repository: nothing in it (a comment, a test\'s name, a message) names a spec, a brainstorm, a plan, a requirement or task id, or an earlier conversation. Write a comment only for a why the code cannot show, in a line; never one that says the code again.',
]

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  const cwd = input.cwd || process.cwd()
  writeAtomic(`${home()}/plugin-root`, root)
  try { sweepTemp(home()) } catch {}
  lines.push(`LCW command line: ${cli} (add --session <id> only if CLAUDE_CODE_SESSION_ID is not set)`)
  // A resumed session is known by its transcript's name, as in the other hooks.
  const ids = sessionIds(input)
  // before the run is looked for: after /clear, the run's driver is this same Claude Code process
  ids.forEach(noteClaudePid) // a resumed payload names two ids; either may be the live one
  let run = null
  for (const id of ids.length ? ids : [undefined]) {
    run = findRun({ sessionId: id, cwd })
    if (run) break
  }
  const now = Number(process.env.LCW_NOW) || Date.now()
  const billing = ids.length ? settleBilling(ids[0]) : 'unclear'
  if (ids.length) noteAdvisor(ids[0])
  const money = billing === 'payg' ? readMoney({ sessionId: ids, now }) : null
  const mark = run ? run.state.markPercent ?? DEFAULT_MARK : sessionMark(ids)
  if (money) lines.push(...paygLines(cli, money))
  else lines.push(`This session has a usage mark, run or no run: ${mark}% of the week${mark === DEFAULT_MARK ? ' unless the user raises it' : ', as the user set it'}. When they say "run up to N%", run: ${cli} mark N. When they say to finish regardless of the limit, run: ${cli} mark 100. It holds for this session only. When a hook tells you the session is at its mark, stop and tell the user; never raise the mark without their explicit words.`)
  lines.push(`If the user says "set up LCW": run node ${root}/scripts/setup.mjs install (it puts LCW's status rows and the no-AI-attribution settings in place, and lets the advisor and spend banners ask again) and say what was set. If they ask to uninstall LCW: run node ${root}/scripts/setup.mjs uninstall, say what it put back, then tell them to run /plugin uninstall lcw@lcw to remove the plugin itself.`)
  if (!hasGit()) lines.push('git is not installed or not on the PATH. LCW runs need it: tell the user once, before anything else.')
  if (run) {
    const s = run.state
    const next = fs.existsSync(run.paths.ledger)
      ? fs.readFileSync(run.paths.ledger, 'utf8').split('\n').reverse().find((l) => l.includes(' checkpoint: '))?.split(' checkpoint: ')[1]
      : null
    const paused = s.status === 'paused'
    const byYou = s.pausedReason !== 'mark'
    lines.push(
      `Unfinished LCW run: ${s.id} (${s.title}). Stage ${s.stage}, status ${s.status}${paused ? ` (${byYou ? 'paused by the user' : 'paused at the usage mark'})` : ''}. Folder ${run.dir}.`,
      `Next step: ${next || 'see the ledger'}.`,
      !paused ? `Load the lcw:lcw skill and carry on (run "${cli} status" first).`
        : byYou ? `The user paused it, so it stays paused until they say carry on: do not resume it yourself. Load the lcw:lcw skill when they do.`
          : `Load the lcw:lcw skill. It resumes once the limit has reset or the user raises the mark: check "${cli} usage"; if it still says at the mark, the run stays paused and you end your turn. Otherwise run "${cli} resume" and carry on.`,
    )
  } else if (listRuns(runsDir(home(), repoKey(mainCheckout(cwd)))).length) {
    lines.push(`This repository has past LCW runs: "${cli} runs" lists them.`)
  }
} catch {}
console.log(lines.join('\n'))
