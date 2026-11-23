#!/usr/bin/env node
import { sessionFile } from '../lib/key.mjs'
import { home, readJson } from './lib/store.mjs'
import { open } from './lib/runs.mjs'
import { sessionIdentity } from './lib/quota-session.mjs'
import { reconcileGate } from './lib/gate.mjs'

let result = { ok: false, hold: true, code: 'invalid-request' }
try {
  const text = process.argv[2]
  if (process.argv.length !== 3 || typeof text !== 'string' || Buffer.byteLength(text) > 16384) throw new Error()
  const request = JSON.parse(text)
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!object(request) || typeof request.sessionId !== 'string' || !/^[\w.-]{1,256}$/.test(request.sessionId) || /^\.+$/.test(request.sessionId) || !['sync', 'retry', 'ack'].includes(request.action)) throw new Error()
  if (!Object.hasOwn(request, 'expectedGate') || (request.expectedGate !== null && !object(request.expectedGate)) || (request.expectedQuota !== undefined && !object(request.expectedQuota))) throw new Error()
  const session = readJson(sessionFile(home(), request.sessionId))
  const anchor = readJson(sessionFile(home(), sessionIdentity(request.sessionId)))
  const run = open(session?.runDir ?? anchor?.runDir)
  if (!run) result = { ok: false, hold: true, code: 'run-unavailable' }
  else {
    const now = process.env.LCW_NOW && Number.isFinite(Number(process.env.LCW_NOW)) ? Number(process.env.LCW_NOW) : Date.now()
    result = reconcileGate(run.paths, request.expectedGate, request.action, now, request.expectedQuota)
  }
} catch {}
console.log(JSON.stringify(result))
