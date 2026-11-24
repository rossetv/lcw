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
    const { readUsage, sessionIds, sessionMark, driverMark, applyGate } = await import('./lib/gate.mjs')
    const { atMark, lcwOnly, stopTexts } = await import('../lib/mark.mjs')
    const { noteQuotaSession, readSessionQuota } = await import('./lib/quota-session.mjs')
    const { readMoney } = await import('./lib/money.mjs')
    const { home, readJson, writeJson } = await import('./lib/store.mjs')
    const { sessionFile } = await import('../lib/key.mjs')
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
    const driverQuota = run ? readSessionQuota(run.state.driver, now, driverMark(run.state)) : null
    const heldQuota = quota?.hold ? quota : driverQuota?.hold ? driverQuota : null
    const usage = readUsage()
    const money = readMoney({ sessionId: ids, now })
    const driverMoney = run && !driverQuota ? readMoney({ sessionId: run.state.driver, now, state: run.state }) : null
    const driverHeld = run && !driverQuota && atMark(driverMark(run.state), usage, now, driverMoney)
    if (run) applyGate(run.paths, run.state, usage, now, driverMoney)
    // A session that settled as pay-per-token after its start is told once, as session start tells the others.
    const file = sessionFile(home(), ids[0])
    const session = readJson(file)
    let cli = null
    if (money && !ids.some((id) => readJson(sessionFile(home(), id))?.toldPayg)) {
      writeJson(file, { ...session, toldPayg: true })
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
      // one shell word, so a plugin folder with a space or a quote in its path still runs
      const script = `${root}/scripts/lcw.mjs`
      cli = `node ${/^[\w@%+=:,./-]+$/.test(script) ? script : `'${script.replace(/'/g, `'\\''`)}'`}`
    }
    const texts = stopTexts({ event, lcwCall, hasRun: !!run, cli, money, quota, heldQuota, mark, usage, now, driverHeld, driverMoney, driverMark: run ? driverMark(run.state) : null })
    if (texts.length) said = JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: texts.join('\n') } })
  }
} catch {}
if (said) process.stdout.write(said + '\n')
process.exit(0)
