#!/usr/bin/env node
// Runs the spend command once in the background and saves what it gave; started by maybeRefresh. With --launch it
// only starts itself again, detached, and exits: Claude Code kills what a cancelled status-line run left behind,
// and a runner whose launcher has already exited is nobody's child, so it survives. Prints nothing.
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { home } from './lib/store.mjs'
import { readSetting, runCommand, recordResult, WINDOW_MS } from './lib/spend-command.mjs'

if (process.argv.includes('--launch')) {
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { detached: true, stdio: 'ignore', env: process.env })
    child.on('error', () => {})
    child.unref()
  } catch {}
  process.exit(0)
}

/** "Now" as the status line sees it: LCW_NOW (epoch ms) when set. */
const clock = () => (Number.isFinite(Number(process.env.LCW_NOW)) && process.env.LCW_NOW ? Number(process.env.LCW_NOW) : Date.now())

try {
  const lcwHome = home()
  const now = clock()
  const setting = readSetting(lcwHome)
  if (setting) {
    const window = Math.floor(now / WINDOW_MS)
    let names = []
    try { names = fs.readdirSync(`${lcwHome}/cache`) } catch {}
    for (const name of names) {
      const m = /^spend-try-(\d+)$/.exec(name)
      if (m && Number(m[1]) < window) {
        try { fs.unlinkSync(`${lcwHome}/cache/${name}`) } catch {}
      }
    }
    const startedAt = now
    const result = await runCommand(setting.command)
    recordResult(lcwHome, setting.command, result, startedAt)
  }
} catch {}
process.exit(0)
