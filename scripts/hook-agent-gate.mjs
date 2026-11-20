import fs from 'node:fs'
import { findRun } from './lib/runs.mjs'
import { gateHolds, atMark, readUsage, sessionIds, sessionMark } from './lib/gate.mjs'
import { readMoney } from './lib/money.mjs'
import { readJson } from './lib/store.mjs'
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
    if (gateHolds(run.paths, run.state, now)) {
      // A dollar gate is told in dollars while the session is still billed per token, as gateHolds judges it.
      const money = readJson(run.paths.gate)?.unit === 'usd' ? readMoney({ sessionId: [run.state.driver, ...ids].filter(Boolean), now, state: run.state }) : null
      process.stderr.write(money
        ? `LCW: this run is at its usage mark: ${dollars(money.spentUsd)} was spent in the last 7 days and the mark is ${dollars(money.markUsd)}. Launch no new agents. Let the running agents finish, record the state in the ledger, then run "lcw pause mark".\n`
        : 'LCW: this run is at its usage mark. Launch no new agents. Let the running agents finish, record the state in the ledger, then run "lcw pause mark".\n')
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
