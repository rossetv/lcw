// While a session is at its usage mark, tells Claude to stop: on each prompt and after a tool call (as the
// PostToolUse command hook, which the shell gate in hooks/hooks.json starts only while some session's after-call
// marker is up, and always on native Windows). It only adds a line for Claude to read. It never blocks a prompt
// or a tool, and whatever goes wrong it exits 0. On a prompt it also records that the session is working, for the mascot.
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
    const { readUsage, sessionIds, sessionMark, driverMark, applyGate } = await import('./lib/gate.mjs')
    const { atMark, lcwOnly, stopTexts, toldFile, lcwCommand } = await import('../lib/mark.mjs')
    const { noteQuotaSession, readSessionQuota } = await import('./lib/quota-session.mjs')
    const { readMoney } = await import('./lib/money.mjs')
    const { home, readJson, writeJson } = await import('./lib/store.mjs')
    const { sessionFile, activityFile } = await import('../lib/key.mjs')
    const now = Number(process.env.LCW_NOW) || Date.now()
    const lcwCall = event === 'PostToolUse' && lcwOnly(input.tool_input?.command) // winding down, or lifting the mark
    const ids = sessionIds(input)
    if (event === 'UserPromptSubmit' && ids[0]) { // the activity hook's record for a prompt, so a prompt starts one process
      try {
        const { next } = await import('../lib/activity.mjs')
        writeJson(activityFile(home(), ids[0]), next(input, null, Date.now())) // a prompt's record does not depend on the last one
      } catch {}
    }
    noteQuotaSession(ids)
    let run = null
    for (const id of ids.length ? ids : [undefined]) {
      run = findRun({ sessionId: id, cwd: input.cwd })
      if (run) break
    }
    const mark = sessionMark(ids)
    const quota = readSessionQuota(ids, now, mark)
    const driverQuota = run ? readSessionQuota(run.state.driver, now, driverMark(run.state)) : null
    const heldQuota = quota?.hold ? quota : driverQuota?.hold ? driverQuota : null
    const usage = readUsage()
    const money = readMoney({ sessionId: ids, now })
    const driverMoney = run && !driverQuota ? readMoney({ sessionId: run.state.driver, now, state: run.state }) : null
    const driverHeld = run && !driverQuota && atMark(driverMark(run.state), usage, now, driverMoney)
    if (run) applyGate(run.paths, run.state, usage, now, driverMoney)
    // A session that settled as pay-per-token after its start is told once, as session start tells the others. Hooks of
    // parallel tool calls run at once, so the told record is claimed with an exclusive create: only one process wins.
    const file = sessionFile(home(), ids[0])
    const session = readJson(file)
    let cli = null
    if (money && !ids.some((id) => readJson(sessionFile(home(), id))?.toldPayg || readJson(toldFile(home(), id))?.payg)) {
      const told = toldFile(home(), ids[0])
      fs.mkdirSync(path.dirname(told), { recursive: true })
      let won = false
      try { fs.writeFileSync(told, JSON.stringify({ payg: true }), { flag: 'wx' }); won = true } catch {}
      if (won) {
        for (const id of ids.slice(1)) { // the other names record it too, so a hook that sees only one of them stays quiet
          try { fs.writeFileSync(toldFile(home(), id), JSON.stringify({ payg: true })) } catch {}
          const f = sessionFile(home(), id)
          writeJson(f, { ...readJson(f), toldPayg: true })
        }
        writeJson(file, { ...session, toldPayg: true })
        cli = lcwCommand(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
      }
    }
    const texts = stopTexts({ event, lcwCall, hasRun: !!run, cli, money, quota, heldQuota, mark, usage, now, driverHeld, driverMoney, driverMark: run ? driverMark(run.state) : null })
    if (texts.length) said = JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: texts.join('\n') } })
  }
} catch {}
if (said) process.stdout.write(said + '\n')
process.exit(0)
