import fs from 'node:fs'
import { findRun } from './lib/runs.mjs'
import { gateHolds, atMark, readUsage, sessionIds, sessionMark, DEFAULT_MARK } from './lib/gate.mjs'
import { readMoney } from './lib/money.mjs'
import { dollars } from '../lib/format.mjs'

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  const now = Number(process.env.LCW_NOW) || Date.now()
  const ids = sessionIds(input)
  let run = null
  for (const id of ids.length ? ids : [undefined]) {
    run = findRun({ sessionId: id, cwd: input.cwd })
    if (run) break
  }
  if (run) {
    const held = gateHolds(run.paths, run.state, now)
    let view = null
    try { view = readMoney({ sessionId: [run.state.driver, ...ids].filter(Boolean), now, state: run.state }) } catch {}
    // the gate file can be missing while the run is over its mark: resumed, paused by the user, or not yet read by this session
    if (held || atMark(run.state.markPercent ?? DEFAULT_MARK, readUsage(), now, view)) {
      const money = view && atMark(null, null, now, view) ? view : null // told in dollars only when the spend is the reason
      // "lcw pause mark" would turn the user's own pause into one that ends by itself at the reset
      const then = run.state.status === 'paused' ? 'Let the running agents finish and record the state in the ledger.' : 'Let the running agents finish, record the state in the ledger, then run "lcw pause mark".'
      process.stderr.write(money
        ? `LCW: this run is at its usage mark: ${dollars(money.spentUsd)} was spent in the last 7 days and the mark is ${dollars(money.markUsd)}. Launch no new agents. ${then}\n`
        : `LCW: this run is at its usage mark. Launch no new agents. ${then}\n`)
      process.exit(2)
    }
  } else {
    const money = readMoney({ sessionId: ids, now })
    if (atMark(sessionMark(ids), readUsage(), now, money)) {
      process.stderr.write(money
        ? `LCW: this session is at its usage mark: ${dollars(money.spentUsd)} was spent in the last 7 days and the mark is ${dollars(money.markUsd)}. Launch no new agents. Finish the step you are on, stop, and tell the user. Only their explicit "run up to" a dollar figure or a percentage lifts it: lcw mark Xusd or lcw mark N.\n`
        : 'LCW: this session is at its usage mark. Launch no new agents. Finish the step you are on, stop, and tell the user. Only their explicit "run up to N%" lifts it: lcw mark N.\n')
      process.exit(2)
    }
  }
} catch {}
process.exit(0)
