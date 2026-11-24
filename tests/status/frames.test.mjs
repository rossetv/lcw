import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmp, lcw, makeRepo } from '../core/helpers.mjs'
import { sweepTemp } from '../../scripts/lib/store.mjs'
import { keyText } from '../../scripts/statusline.mjs'
import { fixtures, drawFixture, expectedFile } from './golden/fixtures.mjs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const NOW = Date.UTC(2026, 2, 10, 12)
const DAY = 86400_000
const SHELLS = ['sh', 'bash', 'zsh', 'dash'].filter((s) => spawnSync(s, ['-c', ':']).status === 0)

function aged(file, ms, text = '{}') {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  fs.utimesSync(file, (NOW - ms) / 1000, (NOW - ms) / 1000)
}

/** Fake `date` (prints LCW_FAKE_DATE) and `node` (counts its starts in <dir>/node.log) in <dir>/fake. */
function fakes(dir) {
  fs.mkdirSync(`${dir}/fake`, { recursive: true })
  fs.writeFileSync(`${dir}/fake/date`, '#!/bin/sh\nprintf "%s\\n" "$LCW_FAKE_DATE"\n', { mode: 0o755 })
  fs.writeFileSync(`${dir}/fake/node`, `#!/bin/sh\necho start >> '${dir}/node.log'\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 })
  return `${dir}/fake`
}
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
  fs.symlinkSync(`${ROOT}/scripts/lcw.mjs`, `${r}/scripts/lcw.mjs`)
  const fake = fakes(r)
  fs.writeFileSync(`${r}/scripts/statusline.mjs`, `import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
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
const env = { ...process.env, COLUMNS: String(process.env.COLUMNS - 1), PATH: ${JSON.stringify(fake)} + ':' + process.env.PATH, LCW_FAKE_DATE: Math.floor(Number(process.env.LCW_NOW) / 1000) + '+0000' }
process.stdout.write(spawnSync(${JSON.stringify(shell)}, ['-c', '. "' + bin + '/statusline.sh"'], { input: fs.readFileSync(0), env }).stdout)
`)
  return r
}

describe('frames drawn ahead and played back print the pinned bytes, second by second', { concurrency: true }, () => {
  const runs = [...fixtures.map((f) => [f, 'sh']), ...SHELLS.filter((s) => s !== 'sh').flatMap((s) => ['run-fresh-heartbeat', 'activity-yawning'].map((n) => [fixtures.find((f) => f.name === n), s]))]
  for (const [f, shell] of runs) {
    test(`${f.name} in ${shell}`, async () => {
      const root = playerRoot(shell)
      const want = JSON.parse(fs.readFileSync(expectedFile(f), 'utf8'))
      const got = await drawFixture(root, f)
      for (const [i, bytes] of got.entries()) assert.equal(bytes, want[i], `${f.name}, second ${i}`)
      // one draw before the first second gives the next 15; the 16th needs another
      assert.equal(starts(root), 2)
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
/** One run of the launcher at `now`: with `at`, the draw ahead for that second; without, one fresh draw. */
function launch(s, input, now, { at, home = s.home } = {}) {
  const env = { PATH: process.env.PATH, HOME: `${s.t}/h`, LCW_HOME: home, COLUMNS: '120', TZ: 'UTC', LCW_NOW: String(now) }
  const r = spawnSync(process.execPath, [`${home}/bin/statusline.mjs`, ...(at === undefined ? [] : [`${at}+0000`])], { input: JSON.stringify(input), encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}
/** The frames the last draw saved for session s1, by second. */
function saved(home) {
  const dir = `${home}/frames/s1`
  const tag = fs.readFileSync(`${dir}/key`, 'utf8').split('\n')[2]
  return new Map(fs.readdirSync(`${dir}/${tag}`).map((n) => [Number(n), fs.readFileSync(`${dir}/${tag}/${n}`, 'utf8')]))
}
/** Each saved frame against a fresh draw at its own second, each in a copy of the home as the draw ahead left it. */
function compareFresh(s, input, frames, only = () => true) {
  let compared = 0
  for (const [second, rows] of frames) {
    if (!only(second)) continue
    const copy = `${tmp('copy')}/lcw`
    fs.cpSync(s.home, copy, { recursive: true })
    assert.equal(launch(s, input, second * 1000, { home: copy }), rows, `second ${second}`)
    compared++
  }
  return compared
}

describe('each frame is what a fresh draw prints at its own second, across a value that the clock flips', { concurrency: true }, () => {
  const S = NOW / 1000
  const activity = (s, rec) => { fs.mkdirSync(`${s.home}/activity`, { recursive: true }); fs.writeFileSync(`${s.home}/activity/s1.json`, JSON.stringify(rec)) }

  test('a turn that ended stops being happy part-way', () => {
    const s = scratch()
    activity(s, { state: 'done', at: NOW - 60_000 + 5000 })
    launch(s, baseInput(s), NOW, { at: S })
    const frames = saved(s.home)
    assert.equal(frames.size, 16)
    assert.notEqual(frames.get(S + 4), frames.get(S + 6))
    assert.equal(compareFresh(s, baseInput(s), frames), 16)
  })

  test('failed calls stop counting part-way', () => {
    const s = scratch()
    activity(s, { state: 'working', at: NOW - 1000, fails: 5, failAt: NOW - 120_000 + 7000 })
    launch(s, baseInput(s), NOW, { at: S })
    assert.equal(compareFresh(s, baseInput(s), saved(s.home)), 16)
  })

  test('the week resets part-way', () => {
    const s = scratch()
    assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home: s.home, cwd: s.repo, session: 's1' }).code, 0)
    const input = baseInput(s, { rate_limits: { seven_day: { used_percentage: 80, resets_at: S + 5 } } })
    launch(s, input, NOW - 1000)
    launch(s, input, NOW, { at: S })
    const frames = saved(s.home)
    assert.ok(/resets in/.test(frames.get(S + 4)) && !/resets in/.test(frames.get(S + 5)))
    assert.equal(compareFresh(s, input, frames), frames.size)
  })

  test('the heartbeat goes stale part-way: every frame is drawn as for a running mod', () => {
    const s = scratch()
    assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home: s.home, cwd: s.repo, session: 's1' }).code, 0)
    const dir = JSON.parse(fs.readFileSync(`${s.home}/sessions/s1.json`, 'utf8')).runDir
    fs.writeFileSync(`${dir}/mod-alive`, String(NOW - 10_000))
    launch(s, baseInput(s), NOW, { at: S })
    const frames = saved(s.home)
    assert.ok(!/LCW Build/.test(frames.get(S + 15)), 'no card while the mod draws it')
    // the player shows a frame only while the heartbeat is at most 15 seconds old at the start of its second
    assert.equal(compareFresh(s, baseInput(s), frames, (x) => x - (NOW - 10_000) / 1000 <= 15), 6)
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

  test('a spend bucket leaves the week part-way', () => {
    const s = scratch()
    const { input, first } = spentUntil(s, 900)
    launch(s, input, first * 1000 - 1000)
    launch(s, input, first * 1000, { at: first })
    const frames = saved(s.home)
    assert.notEqual(dollars(frames.get(first + 4)), dollars(frames.get(first + 5)))
    assert.equal(compareFresh(s, input, frames), frames.size)
  })

  test('the week\'s spend falls under the mark part-way: the frames stop where the run\'s gate would be lifted', () => {
    const s = scratch()
    assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home: s.home, cwd: s.repo, session: 's1' }).code, 0)
    const { input, first } = spentUntil(s, 3000)
    launch(s, input, first * 1000 - 1000)
    const dir = JSON.parse(fs.readFileSync(`${s.home}/sessions/s1.json`, 'utf8')).runDir
    assert.equal(JSON.parse(fs.readFileSync(`${dir}/gate`, 'utf8')).unit, 'usd')
    launch(s, input, first * 1000, { at: first })
    const frames = saved(s.home)
    assert.equal(frames.size, 5)
    assert.equal(compareFresh(s, input, frames), 5)
  })
})

describe('what a draw saves', { concurrency: true }, () => {
  test('a draw with nothing new writes nothing but its frames', () => {
    const s = scratch()
    assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home: s.home, cwd: s.repo, session: 's1' }).code, 0)
    launch(s, baseInput(s), NOW - 1000)
    const snap = () => {
      const out = {}
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (p === `${s.home}/frames` || p.startsWith(`${s.home}/cache/git-`)) continue; if (e.isDirectory()) walk(p); else out[p] = [fs.statSync(p).mtimeMs, fs.readFileSync(p, 'utf8')] } }
      walk(s.home)
      return out
    }
    const before = snap()
    launch(s, baseInput(s), NOW, { at: NOW / 1000 })
    assert.deepEqual(snap(), before)
    assert.ok(fs.existsSync(`${s.home}/frames/s1/key`))
  })

  test('the key is written only for a whole strip, however far a draw got before it was stopped', () => {
    const s = scratch()
    const S = NOW / 1000
    launch(s, baseInput(s), NOW, { at: S })
    const steps = cutDraws(s, baseInput(s), NOW, S)
    assert.ok(steps > 10, `a draw makes ${steps} changes to its files`)
  })

  test('two draws of one session that overlap each leave a strip their key names', () => {
    const s = scratch()
    const S = NOW / 1000
    // the first draw is held just before it writes its key while a second one, for another model, runs to the end
    const held = `${s.t}/release`
    const slow = spawnSync('sh', ['-c', `${JSON.stringify(process.execPath)} --import ${JSON.stringify(holdBeforeKey(s.t, held))} ${JSON.stringify(`${s.home}/bin/statusline.mjs`)} ${S}+0000 < ${JSON.stringify(inputFile(s, 'a', {}))} > /dev/null &
      while [ ! -e ${JSON.stringify(`${s.t}/waiting`)} ]; do sleep 0.02; done
      LCW_NOW=${NOW} ${JSON.stringify(process.execPath)} ${JSON.stringify(`${s.home}/bin/statusline.mjs`)} ${S}+0000 < ${JSON.stringify(inputFile(s, 'b', { model: { display_name: 'Other' } }))} > /dev/null
      : > ${JSON.stringify(held)}; wait`], { env: { PATH: process.env.PATH, HOME: `${s.t}/h`, LCW_HOME: s.home, COLUMNS: '120', TZ: 'UTC', LCW_NOW: String(NOW) }, encoding: 'utf8' })
    assert.equal(slow.status, 0, slow.stderr)
    // the held draw wrote its key last: it names that draw's own strip, whole, of the first model
    const frames = saved(s.home)
    assert.equal(frames.size, 16)
    assert.match(frames.get(S + 3), /Opus 5/)
    assert.equal(compareFresh(s, baseInput(s), new Map([[S + 3, frames.get(S + 3)]])), 1)
  })

  test('the sweep clears git records not written for a day, and every old diff record', () => {
    const home = tmp('home')
    aged(`${home}/cache/git-00000001.json`, DAY + 1000)
    aged(`${home}/cache/git-00000002.json`, DAY - 1000)
    aged(`${home}/cache/diff-00000003.json`, 1000)
    aged(`${home}/cache/context-s1.json`, 2 * DAY)
    sweepTemp(home, NOW)
    assert.deepEqual(fs.readdirSync(`${home}/cache`).sort(), ['context-s1.json', 'git-00000002.json'])
  })

  test('the sweep clears records of once-only notes not written for a week', () => {
    const home = tmp('home')
    aged(`${home}/told/old.json`, 7 * DAY + 1000)
    aged(`${home}/told/live.json`, 7 * DAY - 1000)
    sweepTemp(home, NOW)
    assert.deepEqual(fs.readdirSync(`${home}/told`), ['live.json'])
  })

  test('the sweep clears a session\'s frames once they are a day old, and leaves a live session\'s', () => {
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
 * Draws ahead again and again, each time stopped dead at the next change it makes to the session's frames, and
 * checks after each that the key on disk, if any, names a strip whose every frame is a whole one of its own draw.
 * Returns how many changes a whole draw makes.
 */
function cutDraws(s, input, now, S) {
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
  const env = { PATH: process.env.PATH, HOME: `${s.t}/h`, LCW_HOME: s.home, TZ: 'UTC', LCW_NOW: String(now) }
  const other = { ...input, model: { display_name: 'Other' } }
  let step = 0
  for (; step < 60; step++) {
    // every other draw is for another model, so a key that named the wrong strip would show the wrong rows
    const inp = step % 2 ? other : input
    const r = spawnSync(process.execPath, ['--import', stop, `${s.home}/bin/statusline.mjs`, `${S}+0000`], { input: JSON.stringify(inp), env: { ...env, COLUMNS: '120', STOP_AT: String(step) }, encoding: 'utf8' })
    const dir = `${s.home}/frames/s1`
    if (fs.existsSync(`${dir}/key`)) {
      const key = fs.readFileSync(`${dir}/key`, 'utf8')
      const tag = key.split('\n')[2]
      const names = fs.readdirSync(`${dir}/${tag}`).filter((n) => /^\d+$/.test(n))
      assert.equal(names.length, 16, `after ${step} changes`)
      const model = key.includes('"Other"') ? 'Other' : 'Opus 5'
      for (const n of names) assert.match(fs.readFileSync(`${dir}/${tag}/${n}`, 'utf8'), new RegExp(model), `after ${step} changes`)
    }
    if (r.status === 0) break
  }
  return step
}

describe('the key a draw saves', () => {
  const head = ['120 dark +0000', '', 'tag']
  const input = '{"session_id":"s1","cost":{"total_cost_usd":0.5,"total_duration_ms":25365},"model":{"id":"m"}}'

  test('the input is cut at the values that may change, and the rest is kept as it is', () => {
    const key = keyText(input, { head, watched: ['/a', '!/b'], strict: ['total_duration_ms', 'total_cost_usd'] })
    assert.equal(key, ['120 dark +0000', '', 'tag', '@@', '/a', '!/b', '@@', '{"session_id":"s1","cost":{"total_cost_usd":', '@@', ',"total_duration_ms":', '@@', '},"model":{"id":"m"}}', '@@', ''].join('\n'))
  })

  test('no key for an input with a NUL or a CR in it', () => {
    assert.equal(keyText(input.replace('"m"', '"m\0"'), { head, watched: [] }), null)
    assert.equal(keyText(input + '\r', { head, watched: [] }), null)
  })

  test('no key when a value that may change is not a plain one; another field that is not is only compared', () => {
    const odd = input.replace('25365', '"25s"')
    assert.equal(keyText(odd, { head, watched: [], strict: ['total_duration_ms'] }), null)
    assert.ok(keyText(odd, { head, watched: [], lenient: ['total_duration_ms'] }).includes('"25s"'))
  })

  test('no key with a watched line the player cannot read', () => {
    for (const bad of ['relative/file', '-/x', '/a\nb', '!relative', '+0', '+x']) assert.equal(keyText(input, { head, watched: [bad] }), null, bad)
  })

  test('the line between the parts is none of the other lines', () => {
    const key = keyText('{"a":1,\n@@\n"total_duration_ms":2}', { head: ['@@@', '', 'tag'], watched: ['/x'], strict: ['total_duration_ms'] })
    assert.ok(key.split('\n').includes('@@@@'))
    assert.equal(key.split('\n').filter((l) => l === '@@@@').length, 4)
  })
})
