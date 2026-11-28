// The fixtures the status line's exact bytes are pinned for, and the way to draw them.
// A fixture is drawn for 16 consecutive seconds from a settled scratch home; expected/<name>.json holds the
// bytes printed for each of those seconds.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cli } from '../../core/helpers.mjs'
import { drawIn } from './draw.mjs'

export const EXPECTED = path.join(path.dirname(fileURLToPath(import.meta.url)), 'expected')
export const SECONDS = 16
export const NOW0 = Date.UTC(2026, 2, 10, 12, 0, 0)
// A fixture with sameAs has no file of its own: it must print what the named fixture prints.
export const expectedFile = (f) => path.join(EXPECTED, (f.sameAs ?? f.name) + '.json')
export const times = (f) => Array.from({ length: SECONDS }, (_, i) => f.now + i * 1000)

const sec = (ms) => Math.floor(ms / 1000)
const baseInput = (f, extra = {}) => ({
  session_id: 'golden-1', cwd: f.repo, model: { display_name: 'Opus 5' }, effort: { level: 'high' },
  context_window: { used_percentage: 42, context_window_size: 1000000 },
  rate_limits: { seven_day: { used_percentage: 31, resets_at: sec(f.now) + 3 * 86400 } }, ...extra,
})

/** What each fixture adds to the scratch home; ctx is { root, home, repo, run, now, cli }. */
const activity = (state, extra = {}) => (c) => {
  fs.mkdirSync(c.home + '/activity', { recursive: true })
  fs.writeFileSync(c.home + '/activity/golden-1.json', JSON.stringify({ state, at: c.now - 2000, ...extra }))
}
const withRun = (after) => async (c) => { await c.cli(['start', 'demo', '--title', 'Demo']); await after?.(c) }
const heartbeat = (age) => (c) => fs.writeFileSync(c.runDir() + '/mod-alive', String(c.now - age))

const defs = [
  { name: 'subscription-no-run' },
  { name: 'pay-per-token', input: (f) => ({ ...baseInput(f), rate_limits: undefined, cost: { total_cost_usd: 3.5 } }) },
  { name: 'run-fresh-heartbeat', beat: true, setup: withRun((c) => {
    fs.writeFileSync(c.runDir() + '/quiet-agents.json', JSON.stringify({ quiet: 2, stalled: 0 })); heartbeat(0)(c) }) },
  { name: 'run-stale-heartbeat', setup: withRun(heartbeat(60000)) },
  { name: 'activity-working', transcript: true, setup: activity('working') },
  { name: 'activity-done', setup: activity('done') },
  { name: 'activity-failed', setup: activity('failed') },
  { name: 'activity-needs', setup: activity('needs') },
  { name: 'run-open-question', sameAs: 'activity-needs', beat: true, setup: withRun(async (c) => { await c.cli(['ask', 'Which database?']); heartbeat(0)(c) }) },
  // An ask that holds nothing leaves the mascot as it was: it shouts only for what holds the run.
  { name: 'run-ask-that-holds-nothing', sameAs: 'run-fresh-heartbeat', beat: true, setup: withRun(async (c) => {
    await c.cli(['ask', 'Look at the mock', '--no-wait'])
    fs.writeFileSync(c.runDir() + '/quiet-agents.json', JSON.stringify({ quiet: 2, stalled: 0 })); heartbeat(0)(c) }) },
  { name: 'activity-needs-answered', sameAs: 'activity-working', transcript: true, setup: (c) => {
    activity('needs')(c); const t = (c.now + 60000) / 1000; fs.utimesSync(c.transcript, t, t) } },
  { name: 'activity-asleep', setup: (c) => activity('rest')({ ...c, now: c.now - 10 * 60000 }) },
  { name: 'activity-yawning', setup: (c) => activity('rest')({ ...c, now: c.now - 5 * 60000 + 7000 }) },
  { name: 'three-failed-calls', setup: (c) => activity('working', { fails: 3, failAt: c.now - 10000 })(c) },
  { name: 'five-failed-calls', setup: (c) => activity('working', { fails: 5, failAt: c.now - 10000 })(c) },
  { name: 'narrow-window', columns: '70' },
  { name: 'too-narrow-for-mascot', columns: '50' },
  { name: 'theme-light', theme: 'light', setup: activity('working') },
  { name: 'night-hour', now: Date.UTC(2026, 2, 10, 3, 0, 0), setup: activity('rest') },
  // A heartbeat that is not on a whole second: a mod that stopped, its last beat 9.5 s before a first second that
  // falls 100, 437 or 999 ms into a second, so that it turns 15 s old within the sixth; and a mod that keeps beating.
  ...[100, 437, 999].map((ms) => ({ name: `run-heartbeat-stops-${ms}`, now: NOW0 + ms, ...(ms === 437 ? { sameAs: 'run-heartbeat-stops-100' } : {}),
    setup: withRun((c) => fs.writeFileSync(c.runDir() + '/mod-alive', String(NOW0 - 9500))) })),
  { name: 'run-heartbeat-off-the-second', now: NOW0 + 437, beat: true, setup: withRun((c) => {
    fs.writeFileSync(c.runDir() + '/quiet-agents.json', JSON.stringify({ quiet: 2, stalled: 0 })); heartbeat(0)(c) }) },
]

export const fixtures = defs.map((d) => ({ columns: '120', theme: 'dark', tz: 'Europe/London', now: NOW0, ...d }))

const gitEnv = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

/** The environment a draw runs in: nothing from this machine but the way to find node and git. */
const envOf = (f, home, now) => ({ PATH: process.env.PATH, HOME: home + '/h', LCW_HOME: home, COLUMNS: f.columns, TZ: f.tz, LCW_THEME: f.theme, LCW_NOW: String(now), ...gitEnv })

const git = (repo, ...a) => { const r = spawnSync('git', a, { cwd: repo, env: { PATH: process.env.PATH, ...gitEnv }, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); return r.stdout.trim() }
// Every fixture starts from the same project: built once, copied for each.
let template
function projectTemplate() {
  if (template) return template
  template = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lcw-golden-proj-')))
  const g = (...a) => git(template, ...a)
  g('init', '-q', '-b', 'main')
  fs.writeFileSync(template + '/a.txt', 'one\ntwo\nthree\n'); g('add', '.'); g('commit', '-q', '-m', 'init')
  g('checkout', '-q', '-b', 'feat/golden')
  fs.writeFileSync(template + '/a.txt', 'one\n2\nthree\nfour\n'); fs.writeFileSync(template + '/new.txt', 'x\ny\nz\n')
  process.on('exit', () => fs.rmSync(template, { recursive: true, force: true }))
  return template
}

async function build(root, f, scratch) {
  const home = scratch + '/lcw', repo = scratch + '/proj'
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(scratch + '/h')
  fs.cpSync(projectTemplate(), repo, { recursive: true })
  git(repo, 'update-index', '-q', '--refresh') // the copy's files have new times
  const transcript = scratch + '/golden-1.jsonl'
  fs.writeFileSync(transcript, '{}\n')
  const t = f.now / 1000 - 30; fs.utimesSync(transcript, t, t)
  const ctx = {
    root, home, repo, now: f.now, transcript,
    // the run's own commands, from this checkout's lcw: root names the status line to draw
    cli: async (args) => {
      const r = await cli(args, { home, cwd: repo, session: 'golden-1', env: { HOME: home + '/h', TZ: f.tz, LCW_NOW: String(f.now) } })
      if (r.code) throw new Error(r.out)
    },
    runDir: () => { const d = path.join(home, 'repos'); const find = (p) => fs.readdirSync(p, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? find(path.join(p, e.name)) : e.name === 'state.json' ? [p] : []); return find(d)[0] },
  }
  await f.setup?.(ctx)
  const input = JSON.stringify({ ...(f.input ? f.input({ ...f, repo }) : baseInput({ ...f, repo })), ...(f.transcript ? { transcript_path: transcript } : {}) })
  return { ctx, input }
}

const draw = async (root, f, home, input, now) => drawIn(root, input, envOf(f, home, now))

/** Builds the fixture in a scratch folder, draws once to settle it, then draws each of its 16 seconds in order. Returns the bytes of each. */
export async function drawFixture(root, f) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lcw-golden-')))
  try {
    const { ctx, input } = await build(root, f, scratch)
    await draw(root, f, ctx.home, input, f.now - 1000)
    const out = []
    for (const [i, now] of times(f).entries()) {
      // a running mod writes its heartbeat every 5 seconds
      if (f.beat && i % 5 === 0) fs.writeFileSync(ctx.runDir() + '/mod-alive', String(now))
      out.push(await draw(root, f, ctx.home, input, now))
    }
    return out
  } finally { fs.rmSync(scratch, { recursive: true, force: true }) }
}
