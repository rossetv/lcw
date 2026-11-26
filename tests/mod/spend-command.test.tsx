import { expect, mock } from 'claude-code/testing'
import { test } from './kit'
import { gateFor } from '../../hooks/lcw-mod.mjs'
import { moneyFrom, next0800, readingOf } from '../../lib/spend.mjs'

// The mod's 7-day figure when a spend command has a reading: the dollar gate and the morning try go by it.

const NOW = Date.parse('2026-11-18T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const RUN = '/lcw/repos/r/runs/x'
const SPEND = '/lcw/spend'
const CMD = 'print-spend'
const base = (status: string) => ({
  '/lcw/sessions/s1.json': JSON.stringify({ runDir: RUN, billing: 'payg' }),
  [RUN + '/state.json']: JSON.stringify({ id: '20261118-x', name: 'x', status, pausedReason: status === 'paused' ? 'mark' : null, stage: 'Build', stageSince: NOW }),
  '/lcw/cap.json': JSON.stringify({ usd: 4000 }),
})
// What LCW counted for one session, all of it a day ago.
const spent = (usd: number) => JSON.stringify({ v: 1, base: 0, max: usd, q: { [Math.floor((NOW - DAY) / 900000)]: usd } })
const usdGate = (retryAt: number) =>
  JSON.stringify({ reason: 'mark', unit: 'usd', markUsd: 3000, usedUsd: 3050, retryAt, retried: false, at: NOW - DAY })
const setting = (command = CMD) => JSON.stringify({ v: 1, command, setAt: NOW - 3 * DAY })
// A reading taken two days ago, before what LCW counted. Five of its seven days still count: of $4,000, $2,857,
// and with the $150 LCW counted since, $3,007 reaches the $3,000 mark, which LCW's count alone does not.
const OVER = 4000
const reading = (usd: number, extra: object = {}, command = CMD) =>
  JSON.stringify({ v: 1, command, usd, at: NOW - 2 * DAY, fails: 0, failingSince: null, lastError: null, triedAt: NOW - 2 * DAY, ...extra })

function engine(on: any, files: Record<string, string>) {
  const clock = mock.clock(on, { now: NOW })
  const prompts: string[] = []
  const ran: string[][] = []
  on('session.info', () => ({ value: { transcriptPath: '' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.list', (_: any, e: any) => {
    const names = Object.keys(files).filter((p) => p.startsWith(e.path + '/')).map((p) => p.slice(e.path.length + 1))
    return { value: names.map((name) => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', (_: any, e: any) => {
    ran.push(e.argv)
    if (e.argv[1]?.endsWith('/scripts/gate-reconcile.mjs')) {
      const p = JSON.parse(e.argv[2])
      const file = RUN + '/gate'
      const g = JSON.parse(files[file] ?? 'null')
      if (JSON.stringify(g) !== JSON.stringify(p.expectedGate)) return { value: { exitCode: 0, stdout: '{"ok":false}', stderr: '' } }
      if (p.action === 'ack') delete files[file]
      if (p.action === 'retry') files[file] = JSON.stringify({ ...g, retryAt: next0800(g.retryAt), retried: true })
      if (p.action === 'sync') {
        const session = JSON.parse(files['/lcw/sessions/s1.json'] ?? 'null')
        const state = JSON.parse(files[RUN + '/state.json'] ?? 'null')
        const records = Object.entries(files).filter(([path]) => path.startsWith(SPEND + '/')).map(([, text]) => JSON.parse(text))
        const money = moneyFrom({ records, session, state, cap: JSON.parse(files['/lcw/cap.json'] ?? 'null'), now: NOW,
          reading: readingOf(JSON.parse(files['/lcw/spend-command.json'] ?? 'null'), JSON.parse(files['/lcw/spend-reading.json'] ?? 'null')) })
        const next = gateFor(state, null, NOW, money)
        if (next) files[file] = JSON.stringify(next)
      }
      return { value: { exitCode: 0, stdout: '{"ok":true}', stderr: '' } }
    }
    if (e.argv[0] === 'rm') delete files[e.argv[e.argv.length - 1]]
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('prompt.submit', (_: any, e: any) => { prompts.push(e.text); return { text: e.text } })
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  return { clock, prompts, files, ran }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const measure = ($: any, usd: number) => $.session.measure({ context: { window: 200000 }, changed: ['cost'], rateLimits: [], cost: { usd } } as any)
const json = (text?: string) => JSON.parse(text ?? 'null')

test('the dollar gate trips on the command\'s reading plus what LCW counted since, though LCW\'s count alone is under the mark', async ($, on) => {
  const w = engine(on, {
    ...base('running'), '/lcw/spend-command.json': setting(), '/lcw/spend-reading.json': reading(OVER), [SPEND + '/s1.json']: spent(150),
  })
  await start($)
  await measure($, 150)
  expect(json(w.files[RUN + '/gate'])).toMatchObject({ unit: 'usd', markUsd: 3000 })
  expect(json(w.files[RUN + '/gate']).usedUsd).toBeGreaterThanOrEqual(3000)
})

test('without a command the same spend stays under the mark and no gate is written', async ($, on) => {
  const w = engine(on, { ...base('running'), '/lcw/spend-reading.json': reading(OVER), [SPEND + '/s1.json']: spent(150) })
  await start($)
  await measure($, 150)
  expect(RUN + '/gate' in w.files).toBe(false)
})

test('a reading made for another command is ignored', async ($, on) => {
  const w = engine(on, {
    ...base('running'), '/lcw/spend-command.json': setting('other-command'), '/lcw/spend-reading.json': reading(OVER), [SPEND + '/s1.json']: spent(150),
  })
  await start($)
  await measure($, 150)
  expect(RUN + '/gate' in w.files).toBe(false)
})

test('a run paused at the mark is not woken at 08:00 while the command fails, its figure counting from the reading', async ($, on) => {
  const w = engine(on, {
    ...base('paused'), [RUN + '/gate']: usdGate(NOW + 5000), '/lcw/spend-command.json': setting(),
    '/lcw/spend-reading.json': reading(OVER, { fails: 4, failingSince: NOW - DAY, lastError: 'exit 1' }), [SPEND + '/s1.json']: spent(150),
  })
  await start($)
  await w.clock.advance(7000)
  expect(json(w.files[RUN + '/gate'])).toMatchObject({ retried: true })
  expect(w.prompts.length).toBe(0)
  expect(w.ran.some((a) => a[0] !== 'rm' && !a[1]?.endsWith('/scripts/gate-reconcile.mjs'))).toBe(false)
})

test('a run paused at the mark is woken at 08:00 once the command\'s reading is under it', async ($, on) => {
  const w = engine(on, {
    ...base('paused'), [RUN + '/gate']: usdGate(NOW + 5000), '/lcw/spend-command.json': setting(),
    '/lcw/spend-reading.json': reading(1000), [SPEND + '/s1.json']: spent(150),
  })
  await start($)
  await w.clock.advance(7000)
  expect(RUN + '/gate' in w.files).toBe(false)
  expect(w.prompts.length).toBe(1)
})
