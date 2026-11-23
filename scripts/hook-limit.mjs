// While a session is at its usage mark, tells Claude to stop: once on each prompt, and again after every tool call
// for as long as it keeps going. It only adds a line for Claude to read. It never blocks a prompt or a tool, and
// whatever goes wrong it exits 0.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let said = ''
try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  const event = input.hook_event_name
  const inAgent = !!input.agent_id // a subagent finishes its task; the main loop is the one to stop
  if ((event === 'UserPromptSubmit' || event === 'PostToolUse') && !inAgent) {
    const { findRun } = await import('./lib/runs.mjs')
    const { atMark, readUsage, sessionIds, sessionMark, lcwOnly, DEFAULT_MARK, applyGate } = await import('./lib/gate.mjs')
    const { noteQuotaSession, readSessionQuota, quotaLine } = await import('./lib/quota-session.mjs')
    const { readMoney } = await import('./lib/money.mjs')
    const { paygLines } = await import('./lib/payg-note.mjs')
    const { home, readJson, writeJson } = await import('./lib/store.mjs')
    const { sessionFile } = await import('../lib/key.mjs')
    const { dollars } = await import('../lib/format.mjs')
    const now = Number(process.env.LCW_NOW) || Date.now()
    const lcwCall = event === 'PostToolUse' && lcwOnly(input.tool_input?.command) // winding down, or lifting the mark
    const ids = sessionIds(input)
    noteQuotaSession(ids)
    let run = null
    for (const id of ids.length ? ids : [undefined]) {
      run = findRun({ sessionId: id, cwd: input.cwd })
      if (run) break
    }
    const mark = sessionMark(ids)
    const quota = readSessionQuota(ids, now, mark)
    const driverQuota = run ? readSessionQuota(run.state.driver, now, run.state.markPercent ?? DEFAULT_MARK) : null
    if (driverQuota) applyGate(run.paths, run.state, null, now)
    const heldQuota = quota?.hold ? quota : driverQuota?.hold ? driverQuota : null
    const usage = readUsage()
    const money = readMoney({ sessionId: ids, now })
    const texts = []
    // A session that settled as pay-per-token after its start is told once, as session start tells the others.
    const file = sessionFile(home(), ids[0])
    const session = readJson(file)
    if (money && !ids.some((id) => readJson(sessionFile(home(), id))?.toldPayg)) {
      writeJson(file, { ...session, toldPayg: true })
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
      texts.push('LCW: this session turned out to be billed per token.', ...paygLines(`node ${root}/scripts/lcw.mjs`, money))
    }
    if (heldQuota && !lcwCall) {
      texts.push(`LCW: STOP. ${quotaLine(heldQuota)}. ${run ? 'Launch nothing new: let running agents finish, record the state, then run lcw pause mark.' : 'Stop work and tell the user.'} A reset alone is not permission: wait for a fresh allowable reading. Explaining LCW (lcw:learn) may continue. Never raise the mark without the user.`)
    } else if (money && !lcwCall && atMark(null, null, now, money)) {
      const used = dollars(money.spentUsd)
      const markUsd = dollars(money.markUsd)
      // At the full cap already, "finish this regardless" (the full cap) lifts nothing: only a dollar mark above the cap does.
      const lift = money.markUsd < money.capUsd
        ? 'Only the user\'s explicit words lift this: "run up to $X" (then run `lcw mark Xusd`), "run up to N%" of the weekly cap (then run `lcw mark N`), or "finish this regardless of the limit" (then run `lcw mark 100`).'
        : 'Only the user\'s explicit words lift this: "run up to $X" past the weekly cap (then run `lcw mark Xusd`).'
      texts.push(event === 'UserPromptSubmit'
        ? `LCW: STOP. This session is at its usage mark: ${used} was spent on this machine in the last 7 days and the mark is ${markUsd}. Do not start or continue work. Explaining how LCW works (the lcw:learn conversation) is not work: it goes on at the mark, so teach it. If this message from the user lifts the mark, run that command first and carry on. Otherwise, if they are not asking how LCW works, tell them in a line or two that the session is at its mark, and end your turn. ${lift}`
        : `STOP! LCW: this session is at its usage mark (${used} spent in the last 7 days, mark ${markUsd}). ${run ? 'Launch nothing new: let the running agents finish, record the state, run `lcw pause mark` and end your turn.' : 'Make no further tool call for the work: end your turn now and tell the user.'} Explaining how LCW works (lcw:learn and the reading it does) is not work: it goes on. ${lift}`)
    } else if (!quota && !money && !lcwCall && atMark(mark, usage, now)) {
      const used = usage.sevenDay.percentUsed
      // At 100% already nothing the user says lifts it: the week itself has run out.
      const lift = mark < 100
        ? 'Only the user\'s explicit words lift this: "run up to N%" (then run `lcw mark N`), or "finish this regardless of the limit" (then run `lcw mark 100`).'
        : 'The mark is already the whole week, so nothing lifts it before the weekly limit resets.'
      const text = event === 'UserPromptSubmit'
        ? `LCW: STOP. This session is at its usage mark: ${used}% of the week is used and the mark is ${mark}%. Do not start or continue work. Explaining how LCW works (the lcw:learn conversation) is not work: it goes on at the mark, so teach it. If this message from the user lifts the mark, run that command first and carry on. Otherwise, if they are not asking how LCW works, tell them in a line or two that the session is at its mark, and end your turn. ${lift}`
        : `STOP! LCW: this session is at its usage mark (${used}% of the week used, mark ${mark}%). ${run ? 'Launch nothing new: let the running agents finish, record the state, run `lcw pause mark` and end your turn.' : 'Make no further tool call for the work: end your turn now and tell the user.'} Explaining how LCW works (lcw:learn and the reading it does) is not work: it goes on. ${lift}`
      texts.push(text)
    }
    if (texts.length) said = JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: texts.join('\n') } })
  }
} catch {}
if (said) process.stdout.write(said + '\n')
process.exit(0)
