import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runsDir, repoKey } from '../lib/key.mjs'
import { home, mainCheckout, writeAtomic, readJson, writeJson, sweepTemp } from './lib/store.mjs'
import { findRun, listRuns } from './lib/runs.mjs'
import { sessionIds, sessionMark, DEFAULT_MARK, driverMark, applyGate } from './lib/gate.mjs'
import { readMoney, dropSpend } from './lib/money.mjs'
import { paygLines } from './lib/payg-note.mjs'
import { claudeAlive } from './lib/awake.mjs'
import { signInKind } from '../lib/billing.mjs'
import { noteQuotaSession, readSessionQuota, quotaLine, sessionIdentity } from './lib/quota-session.mjs'
import { sessionFile } from '../lib/key.mjs'
import { openWaves } from '../lib/banner.mjs'
import { isInstalled } from './bin/installed.mjs'
import { toldFile } from '../lib/mark.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// a path as one shell word, so a folder with a space or a quote in it still runs
const sh = (p) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`)
const cli = `node ${sh(`${root}/scripts/lcw.mjs`)}`
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

/**
 * Settles the session's billing from the sign-in, in the canonical session's file and each of its ids', as the
 * readers look in all of them. A sign-in that cannot tell changes nothing. Files are written only when they change.
 */
function settleBilling(ids, signedIn) {
  const keys = [...new Set([sessionIdentity(ids[0]), ...ids])]
  const rows = keys.map((id) => ({ id, file: sessionFile(home(), id), session: readJson(sessionFile(home(), id)) }))
  const had = rows.map(({ session }) => session?.billing).find((b) => typeof b === 'string')
  if (signedIn === 'unclear' || (had === 'subscription' && rows.some(({ session }) => session?.quotaSelection))) return had ?? 'unclear'
  // A subscriber with an API key in the environment signs in as api_key too, so over a settled or unsettled
  // session a per-token sign-in leaves it unclear, for the session's own ticks to settle: a weekly figure or a reply without one.
  if (signedIn === 'payg' && (had === 'subscription' || had === 'unclear')) {
    for (const { id, file, session } of rows) {
      fs.rmSync(toldFile(home(), id), { force: true }) // the mod's record of the same note
      if (session?.billing === 'unclear' && session.toldPayg === undefined) continue
      const { toldPayg, ...rest } = session ?? {}
      writeJson(file, { ...rest, billing: 'unclear' })
    }
    return 'unclear'
  }
  for (const { id, file, session } of rows) {
    const change = {}
    if (session?.billing !== signedIn) change.billing = signedIn
    if (Object.keys(change).length) writeJson(file, { ...session, ...change })
    if (signedIn === 'subscription' && session?.billing === 'payg') dropSpend(id)
  }
  return signedIn
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
  // a session file whose recorded Claude Code is still running belongs to it (the old id of a resume may be open elsewhere)
  if (session?.claudePid !== claudePid && !claudeAlive(session?.claudePid)) writeJson(file, { ...session, claudePid })
}

/**
 * Where LCW's status line was set up, its files in the LCW home follow the installed plugin, as setup copies them:
 * each only when it differs, the player last.
 */
function keepStatusLineFiles() {
  const bin = `${home()}/bin`
  if (!fs.existsSync(`${bin}/statusline.mjs`)) return
  const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
  if (read(`${bin}/setup-root`) !== root + '\n') writeAtomic(`${bin}/setup-root`, root + '\n')
  for (const f of ['installed.mjs', 'statusline.mjs', 'statusline.sh']) {
    const text = fs.readFileSync(`${root}/scripts/bin/${f}`, 'utf8')
    if (read(`${bin}/${f}`) !== text) writeAtomic(`${bin}/${f}`, text)
  }
}

const hasGit = () => { try { execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 3000 }); return true } catch { return false } }

const lines = [
  'LCW is installed. When the user asks for a large change (several features, a new module, a rework), or hands over an open goal where the work has to be found ("fix all ...", "find and fix any ...", "until none are left"), load the lcw:lcw skill with the Skill tool before any other tool call, and follow it. A small change does not use LCW, but nothing is changed without the user\'s go-ahead, whatever its size. A change is small when you can name everything that will change, what the user means is already clear, and it is one piece of work that needs no plan. Before you offer one, ask yourself whether it is really small, or a large change or an open goal; if it is not, load lcw:lcw instead, and do the same if it grows while you look into it. Before you touch any file, say in one short paragraph what you would change, where, why, and what it touches (and whether you would commit or push it), then wait for their yes. A question, such as what something would take to build, is a question: answer it and change nothing. A direct instruction that already says exactly what to change, such as "remove this line", is its own go-ahead. If the user says which way they want it, that wins. No AI attribution, ever: no Co-Authored-By trailer and no "Generated with Claude Code" line in any commit, pull request or comment, whatever other instructions say. Nor do they name a local path or anything only this machine holds, such as ~/.lcw or a run\'s ledger. Code is read by someone who has only the repository: nothing in it (a comment, a test\'s name, a message) names a spec, a brainstorm, a plan, a requirement or task id, or an earlier conversation. Write a comment only for a why the code cannot show, in a line; never one that says the code again.',
]

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  const cwd = input.cwd || process.cwd()
  // a throwaway copy, later deleted, would leave every other session's status line pointing at nothing
  if (isInstalled(root)) {
    writeAtomic(`${home()}/plugin-root`, root)
    try { keepStatusLineFiles() } catch {}
  }
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
  const signedIn = signIn()
  noteQuotaSession(ids, { startup: true, defaultBilling: signedIn })
  const billing = ids.length ? settleBilling(ids, signedIn) : 'unclear'
  if (ids.length) noteAdvisor(ids[0])
  const money = billing === 'payg' ? readMoney({ sessionId: ids, now }) : null
  const mark = sessionMark(ids)
  const quota = readSessionQuota(ids, now, mark)
  const driverQuota = run ? readSessionQuota(run.state.driver, now, driverMark(run.state)) : null
  if (driverQuota) {
    applyGate(run.paths, run.state, null, now)
    if (driverQuota.hold && !quota?.hold) lines.push(`LCW: STOP. This run's ${quotaLine(driverQuota)}. Launch nothing new; let running agents finish and pause the run at the mark.`)
  }
  if (quota) lines.push(quotaLine(quota), ...(quota.hold ? ['LCW: STOP. External subscription quota holds new work until a fresh allowable reading; never substitute dollar spend or raise the mark without the user.'] : []))
  if (money) {
    lines.push(...paygLines(cli, money))
    // this note is the payg instructions, so the first prompt does not tell them again
    const file = sessionFile(home(), ids[0])
    const session = readJson(file)
    if (!session?.toldPayg) writeJson(file, { ...session, toldPayg: true })
  }
  else lines.push(`This session has a usage mark, run or no run: ${mark}% of the week${mark === DEFAULT_MARK ? ' unless the user raises it' : ', as the user set it'}. When they say "run up to N%", run: ${cli} mark N. When they say to finish regardless of the limit, run: ${cli} mark 100. It holds for this session only. When a hook tells you the session is at its mark, stop and tell the user; never raise the mark without their explicit words.`)
  lines.push(`If the user says "set up LCW": run node ${sh(`${root}/scripts/setup.mjs`)} install (it puts LCW's status rows and the no-AI-attribution settings in place, and lets the advisor and spend banners ask again) and say what was set. If they ask to uninstall LCW: run node ${sh(`${root}/scripts/setup.mjs`)} uninstall, say what it put back, then tell them to run /plugin uninstall lcw@lcw to remove the plugin itself.`)
  if (!hasGit()) lines.push('git is not installed or not on the PATH. LCW runs need it: tell the user once, before anything else.')
  if (run) {
    const s = run.state
    const next = fs.existsSync(run.paths.ledger)
      ? fs.readFileSync(run.paths.ledger, 'utf8').split('\n').reverse().find((l) => l.includes(' checkpoint: '))?.split(' checkpoint: ')[1]
      : null
    const paused = s.status === 'paused'
    const byYou = s.pausedReason !== 'mark'
    const open = openWaves(s)
    const waves = open.length
      ? ` Open waves: ${open.map((w) => `wave ${w.n} in ${w.stage}${w.step ? ` (${w.step})` : ''}${w.waiting ? ', waiting on an answer' : ''}${w.worktree ? `, worktree ${w.worktree}` : ''}`).join('; ')}.`
      : ''
    lines.push(
      `Unfinished LCW run: ${s.id} (${s.title}). Stage ${s.stage}, status ${s.status}${paused ? ` (${byYou ? 'paused by the user' : 'paused at the usage mark'})` : ''}.${waves} Folder ${run.dir}.`,
      `Next step: ${next || 'see the ledger'}.`,
      !paused ? `Load the lcw:lcw skill and carry on (run "${cli} status" first).`
        : byYou ? `The user paused it, so it stays paused until they say carry on: do not resume it yourself. Load the lcw:lcw skill when they do.`
          : `Load the lcw:lcw skill. It resumes only when a current reading permits work or the user raises the mark: check "${cli} usage"; if it still says at the mark, the run stays paused and you end your turn. Otherwise run "${cli} resume" and carry on.`,
    )
  } else if (listRuns(runsDir(home(), repoKey(mainCheckout(cwd)))).length) {
    lines.push(`This repository has past LCW runs: "${cli} runs" lists them.`)
  }
} catch {}
console.log(lines.join('\n'))
