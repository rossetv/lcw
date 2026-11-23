#!/usr/bin/env node
import { executeQuotaCommand } from './lib/quota-command.mjs'

// The supervisor exists before the adapter; losing its caller terminates the adapter group too.
process.once('disconnect', () => process.kill(process.pid, 'SIGTERM'))
process.once('message', async (request) => {
  const result = await executeQuotaCommand(request?.command, {
    timeoutMs: request?.timeoutMs,
    now: () => request?.validationNow,
  })
  if (process.connected) process.send(result, () => { if (process.connected) process.disconnect() })
})
