#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { home } from './lib/store.mjs'
import { refreshQuota } from './lib/quota-command.mjs'

// The second detach survives a cancelled status-line invocation's child cleanup.
if (process.argv.includes('--launch')) {
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { detached: true, stdio: 'ignore', env: process.env })
    child.on('error', () => {})
    child.unref()
  } catch {}
} else {
  await refreshQuota(home())
}
