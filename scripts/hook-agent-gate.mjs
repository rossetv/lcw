import fs from 'node:fs'
import { findRun } from './lib/runs.mjs'
import { gateHolds, atMark, readUsage, sessionIds, sessionMark, driverMark } from './lib/gate.mjs'
import { readMoney } from './lib/money.mjs'
import { dollars } from '../lib/format.mjs'
import { noteQuotaSession, readSessionQuota, quotaLine } from './lib/quota-session.mjs'

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  const now = Number(process.env.LCW_NOW) || Date.now()
  const ids = sessionIds(input)
  noteQuotaSession(ids)
  const ownQuota = readSessionQuota(ids, now, sessionMark(ids))
  if (ownQuota?.hold) {
    process.stderr.write(`LCW: ${quotaLine(ownQuota)}. Launch no new agents. Let running agents finish; never raise the mark without the user.\n`)
    process.exit(2)
  }
  let run = null
  for (const id of ids.length ? ids : [undefined]) {
    run = findRun({ sessionId: id, cwd: input.cwd })
    if (run) break
  }
  if (run) {
    if (gateHolds(run.paths, run.state, now)) {
      // "lcw pause mark" would turn the user's own pause into one that ends by itself at the reset.
      const then = run.state.status === 'paused' ? 'Let the running agents finish and record the state in the ledger.' : 'Let the running agents finish, record the state in the ledger, then run "lcw pause mark".'
      const quota = readSessionQuota(run.state.driver, now, driverMark(run.state))
      if (quota) {
        process.stderr.write(`LCW: this run's ${quotaLine(quota)}. Launch no new agents. ${then}\n`)
        process.exit(2)
      }
      let view = null
      try { view = readMoney({ sessionId: run.state.driver, now, state: run.state }) } catch {}
      const money = view && atMark(null, null, now, view) ? view : null
      process.stderr.write(money
        ? `LCW: this run is at its usage mark: ${dollars(money.spentUsd)} was spent in the last 7 days and the mark is ${dollars(money.markUsd)}. Launch no new agents. ${then}\n`
        : `LCW: this run is at its usage mark. Launch no new agents. ${then}\n`)
      process.exit(2)
    }
  }
  if (!ownQuota) {
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
