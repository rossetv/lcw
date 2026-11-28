import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { tmp, cli, makeRepo } from '../core/helpers.mjs'
import { sweepTemp } from '../../scripts/lib/store.mjs'
import { keyText, main, ahead } from '../../scripts/statusline.mjs'
import { fixtures, expectedFile } from './golden/fixtures.mjs'
import { withEnv } from './golden/draw.mjs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const NOW = Date.UTC(2026, 2, 10, 12)
const DAY = 86400_000
const SHELLS = ['sh', 'bash', 'zsh', 'dash'].filter((s) => spawnSync(s, ['-c', ':']).status === 0)

function aged(file, ms, text = '{}') {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  fs.utimesSync(file, (NOW - ms) / 1000, (NOW - ms) / 1000)
}

/** A program run with `input` on its stdin, without blocking: its status, stdout and stderr. */
const exec = (file, args, { input = '', env } = {}) => new Promise((resolve) => {
  const p = execFile(file, args, { env, encoding: 'utf8', maxBuffer: 1 << 24 }, (err, stdout, stderr) => resolve({ status: err ? (err.code ?? 1) : 0, stdout, stderr }))
  p.stdin.end(input)
})

/**
 * On the PATH of every shell run, written once (a script written fresh costs its first run dearly): a `date` that
 * prints LCW_FAKE_DATE, and a `node` that notes each start in the file LCW_NODE_LOG names.
 */
const FAKE = tmp('frames-fake')
fs.writeFileSync(`${FAKE}/date`, '#!/bin/sh\nprintf "%s\\n" "$LCW_FAKE_DATE"\n', { mode: 0o755 })
fs.writeFileSync(`${FAKE}/node`, `#!/bin/sh\necho start >> "$LCW_NODE_LOG"\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 })
const starts = (dir) => (fs.existsSync(`${dir}/node.log`) ? fs.readFileSync(`${dir}/node.log`, 'utf8').split('\n').filter(Boolean).length : 0)

/**
 * A plugin folder whose status line is the player, sourced in `shell`, drawing with this repository's code: given to
 * drawFixture, each of a fixture's seconds is one tick of the new command. Nothing changes between a fixture's
 * seconds but its heartbeat, so every record is set back before a tick: one a draw wrote in that same second
 * would otherwise read as a change.
 */
function playerRoot(shell) {
  const r = tmp('player-root')
  fs.mkdirSync(`${r}/scripts`)
  fs.writeFileSync(`${r}/scripts/statusline.mjs`, `import fs from 'node:fs'
import { execFile } from 'node:child_process'
export async function main({ input, write }) {
  const home = process.env.LCW_HOME, bin = home + '/bin'
  if (!fs.existsSync(bin + '/statusline.sh')) {
    fs.mkdirSync(bin, { recursive: true })
    for (const f of ['statusline.mjs', 'installed.mjs', 'statusline.sh']) fs.copyFileSync(${JSON.stringify(ROOT)} + '/scripts/bin/' + f, bin + '/' + f)
    fs.writeFileSync(home + '/plugin-root', ${JSON.stringify(ROOT)} + '\\n')
  }
  const old = (Date.now() - 100000) / 1000
  const back = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (d === home && e.name === 'frames') continue; if (e.isDirectory()) back(d + '/' + e.name); fs.utimesSync(d + '/' + e.name, old, old) } }
  back(home)
  // the pinned bytes are of the script run alone, which leaves a margin of 5 where the installed command leaves 4
  const env = { ...process.env, COLUMNS: String(process.env.COLUMNS - 1), PATH: ${JSON.stringify(FAKE)} + ':' + process.env.PATH, LCW_FAKE_DATE: Math.floor(Number(process.env.LCW_NOW) / 1000) + '+0000', LCW_NODE_LOG: ${JSON.stringify(`${r}/node.log`)} }
  write(await new Promise((resolve) => {
    const p = execFile(${JSON.stringify(shell)}, ['-c', '. "' + bin + '/statusline.sh"'], { env, encoding: 'utf8' }, (e, stdout) => resolve(stdout))
    p.stdin.end(input)
  }))
}
`)
  return r
}

/**
 * Draws a fixture in a process of its own: a draw takes over the environment of the process it runs in, so
 * fixtures drawn side by side need a process each.
 */
const RUNNER = `${tmp('frames-runner')}/run.mjs`
fs.writeFileSync(RUNNER, `import { fixtures, drawFixture } from ${JSON.stringify(pathToFileURL(`${ROOT}/tests/status/golden/fixtures.mjs`).href)}
const [name, root] = process.argv.slice(2)
const bytes = await drawFixture(root, fixtures.find((f) => f.name === name))
process.stdout.write(JSON.stringify(bytes), () => process.exit(0))
`)

describe('frames drawn ahead and played back print the pinned bytes, second by second', { concurrency: true }, () => {
  // The golden test pins every fixture's bytes in process; here the player plays them, so a fixture goes through it once
  // per kind of thing it watches. Left out, each a twin of one that is in: another activity state or failure count, another
  // width past the mascot's, a heartbeat that stops at another millisecond, an ask that holds nothing or holds the run.
  const twins = ['activity-failed', 'activity-needs', 'run-open-question', 'five-failed-calls', 'too-narrow-for-mascot', 'run-heartbeat-stops-100', 'run-ask-that-holds-nothing']
  // The other shells run the two that play most of the script: a heartbeat that goes stale, and a figure that changes with the clock.
  const runs = [...fixtures.filter((f) => !twins.includes(f.name)).map((f) => [f, 'sh']), ...SHELLS.filter((s) => s !== 'sh').flatMap((s) => ['activity-yawning', 'run-heartbeat-stops-999'].map((n) => [fixtures.find((f) => f.name === n), s]))]
  for (const [f, shell] of runs) {
    test(`${f.name} in ${shell}`, async () => {
      const root = playerRoot(shell)
      const want = JSON.parse(fs.readFileSync(expectedFile(f), 'utf8'))
      const r = await exec(process.execPath, [RUNNER, f.name, root], { env: process.env })
      assert.equal(r.status, 0, r.stderr)
      const got = JSON.parse(r.stdout)
      for (const [i, bytes] of got.entries()) assert.equal(bytes, want[i], `${f.name}, second ${i}`)
      // one draw before the first second gives the next 15 and the 16th needs another; a mod that stops costs one
      // more, in the second its heartbeat turns 15 s old, where whether it runs depends on the millisecond
      assert.equal(starts(root), f.name.startsWith('run-heartbeat-stops') ? 3 : 2)
    })
  }
})

/** A scratch home with the launcher installed and a session in a repository. */
function scratch() {
  const t = tmp('frames')
  const home = `${t}/lcw`
  fs.mkdirSync(`${home}/bin`, { recursive: true })
  fs.mkdirSync(`${t}/h`)
  for (const f of ['statusline.mjs', 'installed.mjs']) fs.copyFileSync(`${ROOT}/scripts/bin/${f}`, `${home}/bin/${f}`)
  fs.writeFileSync(`${home}/plugin-root`, ROOT + '\n')
  return { t, home, repo: makeRepo() }
}
const baseInput = (s, extra = {}) => ({
  session_id: 's1', cwd: s.repo, model: { display_name: 'Opus 5' }, context_window: { used_percentage: 42, context_window_size: 1000000 },
  rate_limits: { seven_day: { used_percentage: 31, resets_at: NOW / 1000 + 3 * 86400 } }, ...extra,
})

// A draw in this process takes over its environment while it runs, as an lcw command does, and gets nothing of this machine's but the way to find node and git.
const alone = (job, env = {}) => withEnv({ PATH: process.env.PATH, ...env }, job)
const startRun = async (s) => assert.equal((await alone(() => cli(['start', 'demo', '--title', 'Demo'], { home: s.home, cwd: s.repo, session: 's1' }))).code, 0)

/** One draw at `now`, as the launcher makes it: with `at`, the draw ahead for that second; without, one fresh draw. */
function launch(s, input, now, { at, home = s.home, tz = 'UTC', zone = '+0000' } = {}) {
  return alone(async () => {
    if (at !== undefined) return await ahead(JSON.stringify(input), { at: `${at}${zone}`, margin: 4 })
    let out = ''
    await main({ margin: 4, input: JSON.stringify(input), write: (text) => { out += text } })
    return out
  }, { LCW_HOME: home, HOME: `${s.t}/h`, COLUMNS: '120', TZ: tz, LCW_NOW: String(now) })
}
/** The frames the last draw saved for session s1, by second. */
function saved(home) {
  const dir = `${home}/frames/s1`
  const tag = fs.readFileSync(`${dir}/key`, 'utf8').split('\n')[2]
  return new Map(fs.readdirSync(`${dir}/${tag}`).filter((n) => /^\d+$/.test(n)).map((n) => [Number(n), fs.readFileSync(`${dir}/${tag}/${n}`, 'utf8')]))
}
/** Each saved frame against a fresh draw at its own second, each in a copy of the home as the draw ahead left it. */
async function compareFresh(s, input, frames, ms = 0) {
  for (const [second, rows] of frames) {
    const copy = `${tmp('copy')}/lcw`
    fs.cpSync(s.home, copy, { recursive: true })
    assert.equal(await launch(s, input, second * 1000 + ms, { home: copy }), rows, `second ${second}`)
  }
  return frames.size
}

describe('each frame is what a fresh draw prints at its own second, across a value that the clock flips', { concurrency: true }, () => {
  const S = NOW / 1000
  const activity = (s, rec) => { fs.mkdirSync(`${s.home}/activity`, { recursive: true }); fs.writeFileSync(`${s.home}/activity/s1.json`, JSON.stringify(rec)) }

  test('a turn that ended stops being happy part-way', async () => {
    const s = scratch()
    activity(s, { state: 'done', at: NOW - 60_000 + 5000 })
    await launch(s, baseInput(s), NOW, { at: S })
    const frames = saved(s.home)
    assert.equal(frames.size, 16)
    assert.notEqual(frames.get(S + 4), frames.get(S + 6))
    assert.equal(await compareFresh(s, baseInput(s), frames), 16)
  })

  test('failed calls stop counting part-way', async () => {
    const s = scratch()
    activity(s, { state: 'working', at: NOW - 1000, fails: 5, failAt: NOW - 120_000 + 7000 })
    await launch(s, baseInput(s), NOW, { at: S })
    assert.equal(await compareFresh(s, baseInput(s), saved(s.home)), 16)
  })

  test('the week resets part-way', async () => {
    const s = scratch()
    await startRun(s)
    const input = baseInput(s, { rate_limits: { seven_day: { used_percentage: 80, resets_at: S + 5 } } })
    await launch(s, input, NOW - 1000)
    await launch(s, input, NOW, { at: S })
    const frames = saved(s.home)
    assert.ok(/resets in/.test(frames.get(S + 4)) && !/resets in/.test(frames.get(S + 5)))
    assert.equal(await compareFresh(s, input, frames), frames.size)
  })

  test('the heartbeat goes stale part-way: each frame judges it at its own moment, by the millisecond', async () => {
    const s = scratch()
    await startRun(s)
    const dir = JSON.parse(fs.readFileSync(`${s.home}/sessions/s1.json`, 'utf8')).runDir
    // 15 s old at NOW + 5500: running in the frame drawn at S + 5, 437 ms into its second, stale in the next
    fs.writeFileSync(`${dir}/mod-alive`, String(NOW - 9500))
    await launch(s, baseInput(s), NOW + 437, { at: S })
    const frames = saved(s.home)
    assert.ok(!/LCW Build/.test(frames.get(S + 5)) && /LCW Build/.test(frames.get(S + 6)))
    assert.equal(await compareFresh(s, baseInput(s), frames, 437), frames.size)
  })

  test('the clocks go forward part-way: the frames stop at the change, as they are for one offset only', async () => {
    const s = scratch()
    const change = Date.UTC(2026, 2, 29, 1) / 1000
    await launch(s, baseInput(s), (change - 5) * 1000, { at: change - 5, tz: 'Europe/London' })
    assert.deepEqual([...saved(s.home).keys()], [0, 1, 2, 3, 4].map((i) => change - 5 + i))
    assert.match(fs.readFileSync(`${s.home}/frames/s1/key`, 'utf8'), /^120 dark \+0000\n/)
  })

  /** A session billed per token whose week holds `usd` in a quarter-hour that leaves the week five seconds into the frames. */
  function spentUntil(s, usd) {
    const Q = 900_000, edge = NOW - 7 * DAY
    fs.mkdirSync(`${s.home}/spend`, { recursive: true }); fs.mkdirSync(`${s.home}/sessions`, { recursive: true })
    fs.writeFileSync(`${s.home}/spend/old.json`, JSON.stringify({ v: 1, base: 0, max: usd + 10, q: { [edge / Q - 1]: usd, [edge / Q + 4]: usd + 10 } }))
    fs.writeFileSync(`${s.home}/sessions/old.json`, JSON.stringify({ billing: 'payg' }))
    return { input: baseInput(s, { rate_limits: undefined, cost: { total_cost_usd: 2 } }), first: NOW / 1000 - 5 }
  }
  const dollars = (rows) => rows.replace(/\x1b\[[0-9;]*m/g, '').match(/\$[\d,.]+/)?.[0]

  test('a spend bucket leaves the week part-way', async () => {
    const s = scratch()
    const { input, first } = spentUntil(s, 900)
    await launch(s, input, first * 1000 - 1000)
    await launch(s, input, first * 1000, { at: first })
    const frames = saved(s.home)
    assert.notEqual(dollars(frames.get(first + 4)), dollars(frames.get(first + 5)))
    assert.equal(await compareFresh(s, input, frames), frames.size)
  })

  test('the week\'s spend falls under the mark part-way: the frames stop where the run\'s gate would be lifted', async () => {
    const s = scratch()
    await startRun(s)
    const { input, first } = spentUntil(s, 3000)
    await launch(s, input, first * 1000 - 1000)
    const dir = JSON.parse(fs.readFileSync(`${s.home}/sessions/s1.json`, 'utf8')).runDir
    assert.equal(JSON.parse(fs.readFileSync(`${dir}/gate`, 'utf8')).unit, 'usd')
    await launch(s, input, first * 1000, { at: first })
    const frames = saved(s.home)
    assert.equal(frames.size, 5)
    assert.equal(await compareFresh(s, input, frames), 5)
  })
})

test('a draw ahead asks git again once its figures are 10 seconds old, so its strip runs whole, and shows none older than 15', async () => {
  const s = scratch()
  const S = NOW / 1000
  const gitAt = () => JSON.parse(fs.readFileSync(`${s.home}/cache/${fs.readdirSync(`${s.home}/cache`).find((n) => n.startsWith('git-'))}`, 'utf8')).at
  const seconds = (from, n) => Array.from({ length: n }, (_, i) => from + i)
  await launch(s, baseInput(s), NOW, { at: S })
  await launch(s, baseInput(s, { model: { display_name: 'Nine' } }), NOW + 9000, { at: S + 9 })
  assert.equal(gitAt(), NOW)
  assert.deepEqual([...saved(s.home).keys()], seconds(S + 9, 7))
  await launch(s, baseInput(s, { model: { display_name: 'Ten' } }), NOW + 10_000, { at: S + 10 })
  assert.equal(gitAt(), NOW + 10_000)
  assert.deepEqual([...saved(s.home).keys()], seconds(S + 10, 16))
})

describe('what a draw saves', { concurrency: true }, () => {
  test('a draw with nothing new writes nothing but its frames', async () => {
    const s = scratch()
    await startRun(s)
    await launch(s, baseInput(s), NOW - 1000)
    const snap = () => {
      const out = {}
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (p === `${s.home}/frames` || p.startsWith(`${s.home}/cache/git-`)) continue; if (e.isDirectory()) walk(p); else out[p] = [fs.statSync(p).mtimeMs, fs.readFileSync(p, 'utf8')] } }
      walk(s.home)
      return out
    }
    const before = snap()
    await launch(s, baseInput(s), NOW, { at: NOW / 1000 })
    assert.deepEqual(snap(), before)
    assert.ok(fs.existsSync(`${s.home}/frames/s1/key`))
  })

  test('the key is written only for a whole strip, however far a draw got before it was stopped', async () => {
    const s = scratch()
    const S = NOW / 1000
    await launch(s, baseInput(s), NOW, { at: S })
    const steps = await cutDraws(s, baseInput(s), NOW, S)
    assert.ok(steps > 10, `a draw makes ${steps} changes to its files`)
  })

  test('two draws of one session that overlap each leave a strip their key names', async () => {
    const s = scratch()
    const S = NOW / 1000
    // the first draw is held just before it writes its key while a second one, for another model, runs to the end
    const held = `${s.t}/release`
    const slow = await exec('sh', ['-c', `${JSON.stringify(process.execPath)} --import ${JSON.stringify(holdBeforeKey(s.t, held))} ${JSON.stringify(`${s.home}/bin/statusline.mjs`)} ${S}+0000 < ${JSON.stringify(inputFile(s, 'a', {}))} > /dev/null &
      while [ ! -e ${JSON.stringify(`${s.t}/waiting`)} ]; do sleep 0.02; done
      LCW_NOW=${NOW} ${JSON.stringify(process.execPath)} ${JSON.stringify(`${s.home}/bin/statusline.mjs`)} ${S}+0000 < ${JSON.stringify(inputFile(s, 'b', { model: { display_name: 'Other' } }))} > /dev/null
      : > ${JSON.stringify(held)}; wait`], { env: { PATH: process.env.PATH, HOME: `${s.t}/h`, LCW_HOME: s.home, COLUMNS: '120', TZ: 'UTC', LCW_NOW: String(NOW) } })
    assert.equal(slow.status, 0, slow.stderr)
    // the held draw wrote its key last: it names that draw's own strip, whole, of the first model
    const frames = saved(s.home)
    assert.equal(frames.size, 16)
    assert.match(frames.get(S + 3), /Opus 5/)
    assert.equal(await compareFresh(s, baseInput(s), new Map([[S + 3, frames.get(S + 3)]])), 1)
  })

  test('the sweep clears git records not written for a day, and every old diff record', async () => {
    const home = tmp('home')
    aged(`${home}/cache/git-00000001.json`, DAY + 1000)
    aged(`${home}/cache/git-00000002.json`, DAY - 1000)
    aged(`${home}/cache/diff-00000003.json`, 1000)
    aged(`${home}/cache/context-s1.json`, 2 * DAY)
    sweepTemp(home, NOW)
    assert.deepEqual(fs.readdirSync(`${home}/cache`).sort(), ['context-s1.json', 'git-00000002.json'])
  })

  test('the sweep clears records of once-only notes not written for a week', async () => {
    const home = tmp('home')
    aged(`${home}/told/old.json`, 7 * DAY + 1000)
    aged(`${home}/told/live.json`, 7 * DAY - 1000)
    sweepTemp(home, NOW)
    assert.deepEqual(fs.readdirSync(`${home}/told`), ['live.json'])
  })

  test('the sweep clears a session\'s frames once they are a day old, and leaves a live session\'s', async () => {
    const home = tmp('home')
    aged(`${home}/frames/old/1/1`, 0); fs.utimesSync(`${home}/frames/old`, (NOW - DAY - 1000) / 1000, (NOW - DAY - 1000) / 1000)
    aged(`${home}/frames/live/1/1`, 0); fs.utimesSync(`${home}/frames/live`, (NOW - 1000) / 1000, (NOW - 1000) / 1000)
    sweepTemp(home, NOW)
    assert.deepEqual(fs.readdirSync(`${home}/frames`), ['live'])
  })
})

function inputFile(s, name, extra) {
  const file = `${s.t}/${name}.json`
  fs.writeFileSync(file, JSON.stringify(baseInput(s, extra)))
  return file
}

/** A module for --import that, before the key is renamed into place, says so and waits for `release` to exist. */
function holdBeforeKey(dir, release) {
  const file = `${dir}/hold.mjs`
  fs.writeFileSync(file, `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const rename = fs.renameSync
fs.renameSync = function (a, b, ...r) {
  if (String(b).endsWith('/key')) { fs.writeFileSync(${JSON.stringify(`${dir}/waiting`)}, ''); while (!fs.existsSync(${JSON.stringify(release)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20) }
  return rename.call(this, a, b, ...r)
}
syncBuiltinESMExports()
`)
  return file
}

/**
 * Draws ahead again, each time stopped dead at the next change it makes to the session's frames, and checks after each
 * that the key on disk, if any, names a strip whose every frame is a whole one of its own draw. Each stop is in a copy
 * of the home that one whole draw left, and the stops are made side by side, ten at a time, until one draw runs to the
 * end. Returns how many changes a whole draw makes.
 */
async function cutDraws(s, input, now, S) {
  const stop = `${s.t}/stop.mjs`
  fs.writeFileSync(stop, `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
let n = Number(process.env.STOP_AT)
for (const name of ['writeFileSync', 'renameSync', 'utimesSync', 'rmSync', 'mkdirSync']) {
  const real = fs[name]
  fs[name] = function (p, ...r) { if (String(p).includes('/frames/') && --n < 0) process.kill(process.pid, 'SIGKILL'); return real.call(this, p, ...r) }
}
syncBuiltinESMExports()
`)
  const other = { ...input, model: { display_name: 'Other' } }
  const cut = async (step) => {
    const home = `${tmp('cut')}/lcw`
    // the key keeps its time: a newer one would let the launcher play the saved frames and draw nothing
    fs.cpSync(s.home, home, { recursive: true, preserveTimestamps: true })
    // every other draw is for another model, so a key that named the wrong strip would show the wrong rows
    const r = await exec(process.execPath, ['--import', stop, `${home}/bin/statusline.mjs`, `${S}+0000`], { input: JSON.stringify(step % 2 ? other : input), env: { PATH: process.env.PATH, HOME: `${s.t}/h`, LCW_HOME: home, COLUMNS: '120', TZ: 'UTC', LCW_NOW: String(now), STOP_AT: String(step) } })
    const dir = `${home}/frames/s1`
    if (fs.existsSync(`${dir}/key`)) {
      const key = fs.readFileSync(`${dir}/key`, 'utf8')
      const tag = key.split('\n')[2]
      const names = fs.readdirSync(`${dir}/${tag}`).filter((n) => /^\d+$/.test(n))
      assert.equal(names.length, 16, `after ${step} changes`)
      const model = key.includes('"Other"') ? 'Other' : 'Opus 5'
      for (const n of names) assert.match(fs.readFileSync(`${dir}/${tag}/${n}`, 'utf8'), new RegExp(model), `after ${step} changes`)
    }
    return r.status === 0
  }
  for (let from = 0; from < 60; from += 10) {
    const done = await Promise.all(Array.from({ length: 10 }, (_, i) => cut(from + i)))
    if (done.includes(true)) return from + done.indexOf(true)
  }
  return 60
}

describe('the key a draw saves', () => {
  const head = ['120 dark +0000', '', 'tag']
  const input = '{"session_id":"s1","cost":{"total_cost_usd":0.5,"total_duration_ms":25365},"model":{"id":"m"}}'

  test('the input is cut at the values that may change, and the rest is kept as it is', async () => {
    const key = keyText(input, { head, watched: ['/a', '!/b'], strict: ['total_duration_ms', 'total_cost_usd'] })
    assert.equal(key, ['120 dark +0000', '', 'tag', '@@', '/a', '!/b', '@@', '{"session_id":"s1","cost":{"total_cost_usd":', '@@', ',"total_duration_ms":', '@@', '},"model":{"id":"m"}}', '@@', ''].join('\n'))
  })

  test('no key for an input with a NUL or a CR in it', async () => {
    assert.equal(keyText(input.replace('"m"', '"m\0"'), { head, watched: [] }), null)
    assert.equal(keyText(input + '\r', { head, watched: [] }), null)
  })

  test('no key when a value that may change is not a plain one; another field that is not is only compared', async () => {
    const odd = input.replace('25365', '"25s"')
    assert.equal(keyText(odd, { head, watched: [], strict: ['total_duration_ms'] }), null)
    assert.ok(keyText(odd, { head, watched: [], lenient: ['total_duration_ms'] }).includes('"25s"'))
  })

  test('no key with a watched line the player cannot read', async () => {
    for (const bad of ['relative/file', '-/x', '/a\nb', '!relative', '+0', '+x']) assert.equal(keyText(input, { head, watched: [bad] }), null, bad)
  })

  test('the line between the parts is none of the other lines', async () => {
    const key = keyText('{"a":1,\n@@\n"total_duration_ms":2}', { head: ['@@@', '', 'tag'], watched: ['/x'], strict: ['total_duration_ms'] })
    assert.ok(key.split('\n').includes('@@@@'))
    assert.equal(key.split('\n').filter((l) => l === '@@@@').length, 4)
  })
})
