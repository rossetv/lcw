import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync, execFile } from 'node:child_process'
import { tmp, cli, makeRepo } from '../core/helpers.mjs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const NOW = Date.UTC(2026, 2, 10, 12)
// not on a quarter-hour, where a session billed per token starts a new spend bucket
const S = NOW / 1000 + 100
const SHELLS = ['sh', 'bash', 'zsh', 'dash'].filter((s) => spawnSync(s, ['-c', ':']).status === 0)

/**
 * On the PATH of every tick, written once: a `date` that prints LCW_FAKE_DATE, and a `node` that notes each start,
 * with the locale it was given, in the file LCW_NODE_LOG names. A script written fresh costs its first run dearly.
 */
const FAKE = tmp('player-fake')
fs.writeFileSync(`${FAKE}/date`, '#!/bin/sh\nprintf "%s\\n" "$LCW_FAKE_DATE"\n', { mode: 0o755 })
fs.writeFileSync(`${FAKE}/node`, `#!/bin/sh\necho "\${LC_ALL-unset}" >> "$LCW_NODE_LOG"\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 })

/** A program run with `input` on its stdin, without blocking: its status, stdout and stderr. */
const exec = (file, args, { input, env }) => new Promise((resolve) => {
  const p = execFile(file, args, { env, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ status: err ? (err.code ?? 1) : 0, stdout, stderr }))
  p.stdin.end(input)
})

/** A scratch home with the launcher and the player installed, and a session in a repository. */
function scratch(name = 'lcw') {
  const t = tmp('player')
  const home = `${t}/${name}`
  fs.mkdirSync(`${home}/bin`, { recursive: true }); fs.mkdirSync(`${t}/h`)
  for (const f of ['statusline.mjs', 'installed.mjs', 'statusline.sh']) fs.copyFileSync(`${ROOT}/scripts/bin/${f}`, `${home}/bin/${f}`)
  fs.writeFileSync(`${home}/plugin-root`, ROOT + '\n')
  return { t, home, repo: makeRepo(), shell: 'sh' }
}
const as1 = (s, args) => cli(args, { home: s.home, cwd: s.repo, session: 's1' })
/** Starts a run for session s1. */
const begun = async (s) => assert.equal((await as1(s, ['start', 'demo', '--title', 'Demo'])).code, 0)
const log = (s) => (fs.existsSync(`${s.t}/node.log`) ? fs.readFileSync(`${s.t}/node.log`, 'utf8').split('\n').filter(Boolean) : [])
const starts = (s) => log(s).length

/**
 * An input shaped as Claude Code's, field for field. `i` moves every figure that changes while the rows stay as they
 * are: how long the session has run, its token and prompt-cache counts, its cost, its lines added and removed and
 * the five-hour limit.
 */
const inputOf = (s, extra = {}, i = 0) => ({
  session_id: 's1', transcript_path: `${s.t}/s1.jsonl`, cwd: s.repo, scratchpad_dir: `${s.t}/scratch`, prompt_id: 'p-1',
  effort: { level: 'high' }, session_name: 'Demo', model: { id: 'claude-opus-5', display_name: 'Opus 5' },
  workspace: { current_dir: s.repo, project_dir: s.repo, added_dirs: [], git_worktree: 'w' }, version: '2.1.326', output_style: { name: 'default' },
  cost: { total_cost_usd: 0.5 + i, total_duration_ms: 1000 + i * 977, total_api_duration_ms: 500 + i, total_lines_added: 3 * i, total_lines_removed: i },
  context_window: { total_input_tokens: 100 + i, total_output_tokens: 10 + i, context_window_size: 1000000, current_usage: { input_tokens: 2 + i, output_tokens: 10 + i, cache_creation_input_tokens: 30 + i, cache_read_input_tokens: 68 + 2 * i }, used_percentage: 42, remaining_percentage: 58 },
  exceeds_200k_tokens: false,
  prompt_cache: { warm: i % 2 === 0, caching_observed: true, ttl: '1h', expires_at: S + 3600 + i, requests: 3 + i, misses: i, expected_rebuilds: i, hit_ratio: 0.87 - i / 100, cache_write_tokens: 10 + i, miss_recache_tokens: i, last_miss_at: i ? S + i : null, last_miss_cause: null, miss_causes: {}, recache_tokens_if_cold: 100 + i },
  fast_mode: false, thinking: { enabled: true },
  rate_limits: { five_hour: { used_percentage: 24 + i, resets_at: S + 3600 }, seven_day: { used_percentage: 31, resets_at: S + 3 * 86400 } }, ...extra,
})

const quoted = (p) => `'${p.replaceAll("'", "'\\''")}'`
/**
 * One tick of the status line command at the second given, in the session's shell; returns what it printed. With
 * `bin`, the command names the folder of the player and the launcher, as setup writes it.
 */
async function tick(s, input, second, { env = {}, zone = '+0000', shell = s.shell, bin } = {}) {
  const command = bin === undefined ? `. ${quoted(`${s.home}/bin/statusline.sh`)}`
    : bin === '' ? `lcw_bin=; . ${quoted(`${s.home}/bin/statusline.sh`)}` : `lcw_bin=${quoted(bin)}; . "$lcw_bin/statusline.sh"`
  const r = await exec(shell, ['-c', command], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { PATH: `${FAKE}:${process.env.PATH}`, HOME: `${s.t}/h`, LCW_HOME: s.home, COLUMNS: '120', TZ: 'UTC', LCW_FAKE_DATE: `${second}${zone}`, LCW_NODE_LOG: `${s.t}/node.log`, LCW_NOW: String(second * 1000), ...env },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.length > 0)
  return r.stdout
}

/** One fresh draw, saving no frames, then every record set back, so that what that draw wrote does not read as a change. */
async function settle(s, input, second = S - 1, home = s.home) {
  const r = await exec(process.execPath, [`${s.home}/bin/statusline.mjs`], { input: typeof input === 'string' ? input : JSON.stringify(input), env: { PATH: process.env.PATH, HOME: `${s.t}/h`, LCW_HOME: home, COLUMNS: '120', TZ: 'UTC', LCW_NOW: String(second * 1000) } })
  assert.equal(r.status, 0)
  const old = (Date.now() - 100_000) / 1000
  const back = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) back(`${d}/${e.name}`); fs.utimesSync(`${d}/${e.name}`, old, old) } }
  back(home)
  fs.rmSync(`${s.t}/node.log`, { force: true })
}
/** The strip the session's key names, or null with no key: a new one after a tick says that tick drew. */
const stripOf = (s) => { try { return fs.readFileSync(`${s.home}/frames/s1/key`, 'utf8').split('\n')[2] } catch { return null } }
/** One tick that must start Node and draw: a new strip, and the rows printed are its frame for that second. */
async function drawn(s, input, second, opts) {
  const was = stripOf(s), n = starts(s)
  const out = await tick(s, input, second, opts)
  assert.equal(starts(s), n + 1, 'Node started')
  const now = stripOf(s)
  assert.ok(now && now !== was, 'a new strip was drawn')
  assert.equal(out, fs.readFileSync(`${s.home}/frames/s1/${now}/${second}`, 'utf8'))
  return out
}
const runDir = (s) => JSON.parse(fs.readFileSync(`${s.home}/sessions/s1.json`, 'utf8')).runDir
const plain = (t) => t.replace(/\x1b\[[0-9;]*m/g, '')

describe('when Node starts', { concurrency: true }, () => {
  test('an idle minute starts Node four times', async () => {
    const s = scratch()
    await settle(s, inputOf(s))
    const strips = new Set()
    for (let x = S; x < S + 60; x++) { await tick(s, inputOf(s), x); strips.add(stripOf(s)) }
    assert.equal(starts(s), 4)
    assert.equal(strips.size, 4, 'each start drew, as the frames ran out')
  })

  test('the heartbeat, the session\'s age and a subscription\'s cost and cache figures start no Node', async () => {
    const s = scratch()
    await begun(s)
    fs.writeFileSync(`${runDir(s)}/mod-alive`, String(S * 1000 - 1437))
    await settle(s, inputOf(s))
    for (let i = 0; i < 15; i++) {
      if (i % 5 === 0) fs.writeFileSync(`${runDir(s)}/mod-alive`, String((S + i) * 1000 + 437))
      await tick(s, inputOf(s, {}, i), S + i)
    }
    assert.equal(starts(s), 1)
  })

  test('on pay-per-token billing a new cost starts Node', async () => {
    const s = scratch()
    const payg = (cost) => inputOf(s, { rate_limits: undefined, cost: { total_cost_usd: cost } })
    await settle(s, payg(2))
    await tick(s, payg(2), S); await tick(s, payg(2), S + 1)
    assert.equal(starts(s), 1)
    await drawn(s, payg(9), S + 2)
  })

  test('the clock jumping forward or back draws afresh', async () => {
    const s = scratch()
    await settle(s, inputOf(s))
    await tick(s, inputOf(s), S); await tick(s, inputOf(s), S + 1)
    assert.equal(starts(s), 1)
    await drawn(s, inputOf(s), S + 3600)
    await drawn(s, inputOf(s), S + 3600 - 30)
  })

  // Each change is made after one draw and one playback; the next tick must start Node.
  const changes = {
    'a prompt is sent': (s) => { fs.mkdirSync(`${s.home}/activity`, { recursive: true }); fs.writeFileSync(`${s.home}/activity/s1.json`, JSON.stringify({ state: 'working', at: NOW })) },
    'the session\'s mark is set': (s) => as1(s, ['mark', '50']),
    'another session reports a newer weekly figure': (s) => fs.writeFileSync(`${s.home}/usage.json`, JSON.stringify({ at: NOW, sevenDay: { percentUsed: 40, resetsAt: new Date((S + 3 * 86400) * 1000).toISOString() }, source: 'statusline' })),
    'another session\'s weekly figure is removed': (s) => fs.rmSync(`${s.home}/usage.json`),
    'an outside quota is set up': (s) => fs.writeFileSync(`${s.home}/quota-command.json`, JSON.stringify({ v: 1, enabled: true })),
    'the session starts a run': (s) => as1(s, ['start', 'demo', '--title', 'Demo']),
    'the model changes': () => ({ model: { display_name: 'Sonnet 5' } }),
    // one figure each, in an input that is otherwise the same: beside used_percentage fields the rows do not show
    'the context grows': (s) => ({ context_window: { ...inputOf(s).context_window, used_percentage: 43 } }),
    'the effort changes': () => ({ effort: { level: 'low' } }),
    'the context window changes': (s) => ({ context_window: { ...inputOf(s).context_window, context_window_size: 200000 } }),
    'the week\'s figure moves': (s) => ({ rate_limits: { ...inputOf(s).rate_limits, seven_day: { used_percentage: 32, resets_at: S + 3 * 86400 } } }),
    'the input gains text after its end': () => ({ after: '\n\n' }),
    'the window is resized': () => ({ env: { COLUMNS: '100' } }),
    'the theme changes': () => ({ env: { LCW_THEME: 'light' } }),
    'the time zone changes': () => ({ env: { TZ: 'Etc/GMT-1' }, zone: '+0100' }),
    'the saved frames are removed': (s) => fs.rmSync(`${s.home}/frames`, { recursive: true }),
    'the key is damaged': (s) => fs.writeFileSync(`${s.home}/frames/s1/key`, 'not a key\n'),
  }
  for (const [what, change] of Object.entries(changes)) {
    test(`${what} shows at the next tick`, async () => {
      const s = scratch()
      await settle(s, inputOf(s))
      await tick(s, inputOf(s), S); await tick(s, inputOf(s), S + 1)
      assert.equal(starts(s), 1)
      const was = stripOf(s)
      const { env, zone, after = '', ...input } = (await change(s)) ?? {}
      await tick(s, JSON.stringify(inputOf(s, input.model || input.context_window || input.rate_limits || input.effort ? input : {})) + after, S + 2, { env, zone })
      assert.equal(starts(s), 2)
      assert.ok(stripOf(s) && stripOf(s) !== was, 'a new strip was drawn')
    })
  }

  const runChanges = {
    'the run\'s state changes': (s) => as1(s, ['ask', 'Which database?']),
    'the mod counts a quiet agent': (s) => fs.writeFileSync(`${runDir(s)}/quiet-agents.json`, JSON.stringify({ quiet: 1, stalled: 0 })),
    'the session is held at its mark': (s) => fs.writeFileSync(`${runDir(s)}/gate`, JSON.stringify({ reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt: null, at: NOW })),
  }
  for (const [what, change] of Object.entries(runChanges)) {
    test(`${what} shows at the next tick`, async () => {
      const s = scratch()
      await begun(s)
      fs.writeFileSync(`${runDir(s)}/mod-alive`, String(S * 1000 + 437))
      await settle(s, inputOf(s))
      await tick(s, inputOf(s), S); await tick(s, inputOf(s), S + 1)
      assert.equal(starts(s), 1)
      await change(s)
      await drawn(s, inputOf(s), S + 2)
    })
  }

  test('the session\'s Claude Code ending shows at the next tick', async () => {
    const s = scratch()
    const claude = spawn('sleep', ['60'], { stdio: 'ignore' })
    try {
      fs.mkdirSync(`${s.home}/sessions`, { recursive: true })
      fs.writeFileSync(`${s.home}/sessions/s1.json`, JSON.stringify({ claudePid: claude.pid }))
      await settle(s, inputOf(s))
      await tick(s, inputOf(s), S); await tick(s, inputOf(s), S + 1)
      assert.equal(starts(s), 1)
    } finally {
      claude.kill()
      await new Promise((done) => (claude.exitCode !== null || claude.signalCode !== null ? done() : claude.on('exit', done)))
    }
    await drawn(s, inputOf(s), S + 2)
  })

  test('the run\'s worktree going shows at the next tick', async () => {
    const s = scratch()
    await begun(s)
    const tree = tmp('tree'), state = `${runDir(s)}/state.json`
    fs.writeFileSync(state, JSON.stringify({ ...JSON.parse(fs.readFileSync(state, 'utf8')), worktree: tree, branch: 'lcw/demo' }))
    await settle(s, inputOf(s))
    await tick(s, inputOf(s), S); await tick(s, inputOf(s), S + 1)
    assert.equal(starts(s), 1)
    fs.rmSync(tree, { recursive: true })
    await drawn(s, inputOf(s), S + 2)
  })

  test('a heartbeat where there was none takes the card away at the next tick', async () => {
    const s = scratch()
    await begun(s)
    await settle(s, inputOf(s))
    assert.match(plain(await tick(s, inputOf(s), S)), /LCW Build/)
    fs.writeFileSync(`${runDir(s)}/mod-alive`, String(S * 1000 + 1437))
    assert.doesNotMatch(plain(await drawn(s, inputOf(s), S + 1)), /LCW Build/)
  })

  test('the card comes back at the first tick past 15 seconds after the last heartbeat, by the millisecond', async () => {
    const s = scratch()
    await begun(s)
    // 15 s old at S + 4.563: whether the mod runs in the second S + 4 depends on the moment, so Node draws it
    fs.writeFileSync(`${runDir(s)}/mod-alive`, String(S * 1000 - 10_437))
    await settle(s, inputOf(s))
    for (let x = S; x <= S + 3; x++) assert.doesNotMatch(plain(await tick(s, inputOf(s), x)), /LCW Build/)
    assert.equal(starts(s), 1)
    assert.doesNotMatch(plain(await drawn(s, inputOf(s), S + 4, { env: { LCW_NOW: String((S + 4) * 1000 + 500) } })), /LCW Build/)
    assert.match(plain(await drawn(s, inputOf(s), S + 4, { env: { LCW_NOW: String((S + 4) * 1000 + 600) } })), /LCW Build/)
    assert.match(plain(await tick(s, inputOf(s), S + 5)), /LCW Build/)
    assert.equal(starts(s), 3, 'past the second where it turned, the frame is played')
  })

  test('the conversation written again while the session waits on the person ends the wait at the next tick', async () => {
    const s = scratch()
    fs.mkdirSync(`${s.home}/activity`, { recursive: true })
    fs.writeFileSync(`${s.home}/activity/s1.json`, JSON.stringify({ state: 'needs', at: NOW - 60_000 }))
    fs.writeFileSync(`${s.t}/s1.jsonl`, '{}\n')
    fs.utimesSync(`${s.t}/s1.jsonl`, (NOW - 61_000) / 1000, (NOW - 61_000) / 1000)
    await settle(s, inputOf(s))
    await tick(s, inputOf(s), S); await tick(s, inputOf(s), S + 1)
    assert.equal(starts(s), 1)
    fs.appendFileSync(`${s.t}/s1.jsonl`, '{}\n')
    await drawn(s, inputOf(s), S + 2)
  })

  test('a new spend record of another session starts Node on pay-per-token billing', async () => {
    const s = scratch()
    const payg = inputOf(s, { rate_limits: undefined, cost: { total_cost_usd: 2 } })
    await settle(s, payg)
    await tick(s, payg, S); await tick(s, payg, S + 1)
    assert.equal(starts(s), 1)
    fs.writeFileSync(`${s.home}/sessions/other.json`, JSON.stringify({ billing: 'payg' }))
    fs.writeFileSync(`${s.home}/spend/other.json`, JSON.stringify({ v: 1, base: 0, max: 50, q: { [Math.floor(NOW / 900_000)]: 50 } }))
    await drawn(s, payg, S + 2)
  })
})

describe('a record that reads as newer than the frames but holds the text they were drawn from', { concurrency: true }, () => {
  /**
   * A session with a run, drawn at S, and the run's state written again with the same text since the key's time;
   * `more` adds that many bytes of text to the state.
   */
  async function rewritten(more = 0) {
    const s = scratch()
    await begun(s)
    if (more) fs.writeFileSync(`${runDir(s)}/state.json`, JSON.stringify({ ...JSON.parse(fs.readFileSync(`${runDir(s)}/state.json`, 'utf8')), notes: 'n'.repeat(more) }))
    await settle(s, inputOf(s))
    await tick(s, inputOf(s), S)
    const dir = `${s.home}/frames/s1`, tag = fs.readFileSync(`${dir}/key`, 'utf8').split('\n')[2]
    const old = Date.now() / 1000 - 100
    fs.utimesSync(`${dir}/key`, old, old)
    const state = `${runDir(s)}/state.json`
    fs.writeFileSync(state, fs.readFileSync(state))
    fs.utimesSync(state, old + 50, old + 50)
    return { s, dir, tag, state }
  }
  const strip = ({ dir, tag }) => fs.readdirSync(`${dir}/${tag}`).map((n) => [n, fs.statSync(`${dir}/${tag}/${n}`).mtimeMs, fs.readFileSync(`${dir}/${tag}/${n}`, 'utf8')])

  test('starts Node, which prints the saved frame, leaves the frames as they are and moves the key on', async () => {
    const r = await rewritten(), { s, dir, tag } = r
    const before = strip(r)
    assert.equal(await tick(s, inputOf(s), S + 1), fs.readFileSync(`${dir}/${tag}/${S + 1}`, 'utf8'))
    assert.equal(starts(s), 2)
    assert.equal(fs.readFileSync(`${dir}/key`, 'utf8').split('\n')[2], tag)
    assert.deepEqual(strip(r), before)
    await tick(s, inputOf(s), S + 2)
    assert.equal(starts(s), 2, 'the next tick plays')
  })

  test('a state larger than 16 KB is kept out of what the frames were drawn from, and draws', async () => {
    const r = await rewritten(20_000), { s, dir, tag } = r
    assert.ok(fs.statSync(`${dir}/${tag}/seen`).size < 4096)
    await tick(s, inputOf(s), S + 1)
    assert.notEqual(fs.readFileSync(`${dir}/key`, 'utf8').split('\n')[2], tag)
  })

  const damaged = {
    missing: null, empty: '', 'cut short': (t) => t.slice(0, Math.floor(t.length / 2)), 'not JSON': 'not json',
    'of a wrong shape': (t, state) => JSON.stringify({ [state]: { text: JSON.parse(t)[state] } }), null: 'null',
  }
  for (const [how, damage] of Object.entries(damaged)) {
    test(`with what the frames were drawn from ${how}, it draws`, async () => {
      const r = await rewritten(), { s, dir, tag, state } = r
      const file = `${dir}/${tag}/seen`
      if (damage === null) fs.rmSync(file)
      else fs.writeFileSync(file, typeof damage === 'function' ? damage(fs.readFileSync(file, 'utf8'), state) : damage)
      const printed = await tick(s, inputOf(s), S + 1)
      const now = fs.readFileSync(`${dir}/key`, 'utf8').split('\n')[2]
      assert.notEqual(now, tag)
      assert.equal(printed, fs.readFileSync(`${dir}/${now}/${S + 1}`, 'utf8'))
      assert.equal(printed, fs.readFileSync(`${dir}/${tag}/${S + 1}`, 'utf8'), 'the same rows, as nothing they show has changed')
    })
  }

  test('a change written right after that start shows at the next tick', async () => {
    const { s, state } = await rewritten()
    await tick(s, inputOf(s), S + 1)
    fs.writeFileSync(state, JSON.stringify({ ...JSON.parse(fs.readFileSync(state, 'utf8')), name: 'renamed' }))
    const after = Date.now() / 1000
    fs.utimesSync(state, after, after)
    assert.match(plain(await tick(s, inputOf(s), S + 2)), /LCW Build · renamed/)
  })
})

describe('a change in the second of the draw before it', { concurrency: true }, () => {
  for (const shell of SHELLS) {
    test(`shows at the next tick, in ${shell}`, async () => {
      const s = { ...scratch(), shell }
      fs.mkdirSync(`${s.home}/activity`, { recursive: true })
      fs.writeFileSync(`${s.home}/activity/s1.json`, JSON.stringify({ state: 'working', at: S * 1000 - 5000 }))
      await settle(s, inputOf(s))
      // a draw that runs within one second, and the turn ending right after it in that same second
      let before, after
      for (let i = 0; i < 10; i++) {
        fs.rmSync(`${s.home}/frames`, { recursive: true, force: true })
        before = Date.now()
        await tick(s, inputOf(s), S)
        after = Date.now()
        if (Math.floor(before / 1000) === Math.floor(after / 1000)) break
      }
      assert.equal(Math.floor(before / 1000), Math.floor(after / 1000), 'a draw within one second')
      fs.writeFileSync(`${s.home}/activity/s1.json`, JSON.stringify({ state: 'done', at: S * 1000 }))
      fs.utimesSync(`${s.home}/activity/s1.json`, after / 1000, after / 1000)
      fs.rmSync(`${s.t}/node.log`)
      await tick(s, inputOf(s), S + 1)
      assert.equal(starts(s), 1)
    })
  }
})

describe('what is played', { concurrency: true }, () => {
  test('the frame printed is the one for the second the shell read, when Node\'s clock is already in the next', async () => {
    const s = scratch()
    await settle(s, inputOf(s))
    const printed = await tick(s, inputOf(s), S, { env: { LCW_NOW: String(S * 1000 + 1050) } })
    const key = fs.readFileSync(`${s.home}/frames/s1/key`, 'utf8').split('\n')
    assert.equal(printed, fs.readFileSync(`${s.home}/frames/s1/${key[2]}/${S}`, 'utf8'))
    assert.ok(fs.existsSync(`${s.home}/frames/s1/${key[2]}/${S + 1}`))
  })

  test('Node gets the locale the shell was given, and none when it had none', async () => {
    const s = scratch()
    await tick(s, inputOf(s), S, { env: { LC_ALL: 'en_US.UTF-8' } })
    await tick(s, inputOf(s, { model: { display_name: 'Other' } }), S + 1)
    assert.deepEqual(log(s), ['en_US.UTF-8', 'unset'])
  })

  // A folder whose name a shell would expand, an input over many lines, and a session id that is a path.
  const hostile = (s) => {
    const dir = `${s.t}/a $(touch pwned) \`touch pwned2\` * ? [x] %s %d \\n "q" 'q' é`
    fs.mkdirSync(dir)
    return dir
  }
  test('every shell plays the same bytes, and runs nothing from the input', async () => {
    const outs = await Promise.all(SHELLS.map(async (shell) => {
      const s = { ...scratch(), shell }
      const input = JSON.stringify(inputOf(s, { cwd: hostile(s), session_name: '$(touch pwned3) `id` ${HOME}' }), null, 2).replace(/": /g, '":')
      await settle(s, input)
      await tick(s, input, S)
      assert.equal(starts(s), 1)
      const played = (await tick(s, input, S + 1)).replace(s.t, '')
      assert.equal(starts(s), 1, `${shell} played the second frame`)
      for (const d of [s.t, `${s.t}/h`, s.repo, process.cwd()]) for (const p of ['pwned', 'pwned2', 'pwned3']) assert.ok(!fs.existsSync(`${d}/${p}`), `${shell} ran ${p}`)
      return played
    }))
    assert.equal(new Set(outs).size, 1)
  })

  const run = async (id) => {
    const s = scratch()
    assert.match(plain(await tick(s, inputOf(s, { session_id: id }), S)), /Opus 5/)
    assert.ok(!fs.existsSync(`${s.t}/h/pwned`) && !fs.existsSync(`${s.t}/pwned`), id)
    return s
  }
  const top = (s) => fs.readdirSync(s.home).sort()
  let plainRun
  const plainTop = () => (plainRun ??= run('plainid').then(top))
  for (const id of ['../escape', 'a/b', '$(touch pwned)', '..', '*', 'x\\y']) {
    test(`a session id of ${id} is never used in a path`, async () => {
      const s = await run(id)
      // the files the id would name, were it put in a path: the session's records, its context, its frames
      for (const file of [`sessions/${id}.json`, `activity/${id}.json`, `spend/${id}.json`, `cache/context-${id}.json`, `frames/${id}/key`, `frames/${id}/last`]) {
        assert.ok(!fs.existsSync(path.resolve(s.home, file)), `${id}: ${file}`)
      }
      const known = await plainTop()
      assert.ok(top(s).every((name) => known.includes(name)), `${id}: ${top(s)}`)
      assert.ok(!fs.existsSync(`${s.home}/frames`), id)
    })
  }

  test('frames planted outside the frames folder are not played for a session id that leads there', async () => {
    const s = scratch()
    await settle(s, inputOf(s, { session_id: 'xplantedx' }))
    await tick(s, inputOf(s, { session_id: 'xplantedx' }), S)
    fs.renameSync(`${s.home}/frames/xplantedx`, `${s.home}/planted`)
    const key = fs.readFileSync(`${s.home}/planted/key`, 'utf8')
    // the input's part of the key, after the watched files, made to fit the input with the hostile id
    const lines = key.split('\n'), input = lines.indexOf(lines[3], 4) + 1
    fs.writeFileSync(`${s.home}/planted/key`, [...lines.slice(0, input), ...lines.slice(input).map((l) => l.replaceAll('xplantedx', '../planted'))].join('\n'))
    fs.utimesSync(`${s.home}/planted/key`, (Date.now() - 50_000) / 1000, (Date.now() - 50_000) / 1000)
    fs.writeFileSync(`${s.home}/planted/${key.split('\n')[2]}/${S + 1}`, 'PLANTED\n')
    assert.notEqual(await tick(s, inputOf(s, { session_id: '../planted' }), S + 1), 'PLANTED\n')
  })

  test('an input far larger than any real one saves no frames, and reaches Node whole', async () => {
    const s = scratch()
    // a long field first, over many lines, and what the rows show after it
    const pad = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${i}`, 'v'.repeat(30)]))
    const input = JSON.stringify({ session_id: 's1', pad, ...inputOf(s), model: { display_name: 'Big 5' } }, null, 1).replace(/": /g, '":')
    for (const x of [S, S + 1]) assert.match(plain(await tick(s, input, x)), /Big 5/)
    assert.equal(starts(s), 2)
    assert.ok(!fs.existsSync(`${s.home}/frames/s1/key`))
  })

  test('an input that writes its session id otherwise gets a fresh draw at every tick', async () => {
    const s = scratch()
    const input = JSON.stringify(inputOf(s)).replace('"session_id":"s1"', '"session_id": "s1"')
    await settle(s, input)
    await tick(s, input, S); await tick(s, input, S + 1)
    assert.equal(starts(s), 2)
  })
})

describe('a session whose LCW home is not the one LCW was set up in', { concurrency: true }, () => {
  /** Home A holds the player and the launcher; the session's own LCW home, B, starts empty. */
  function other(name) {
    const s = scratch(name)
    const b = `${s.t}/b`
    fs.mkdirSync(b)
    return { s, b, opts: { bin: `${s.home}/bin`, env: { LCW_HOME: b } } }
  }

  test('draws its rows and keeps its frames in its own home, and plays them in every shell alike', async () => {
    const outs = await Promise.all(SHELLS.map(async (shell) => {
      const { s, b, opts } = other()
      s.shell = shell
      // a folder of the same name in each shell's scratch, so that the rows are the same
      fs.mkdirSync(`${s.t}/proj`)
      const input = inputOf(s, { cwd: `${s.t}/proj` })
      await settle(s, input, S - 1, b)
      const first = await tick(s, input, S, opts)
      assert.equal(plain(first).split('\n').filter(Boolean).length, 2, shell)
      assert.ok(fs.existsSync(`${b}/frames/s1/key`) && !fs.existsSync(`${s.home}/frames`), shell)
      const played = await tick(s, input, S + 1, opts)
      assert.equal(starts(s), 1, `${shell} played a frame from the session's home`)
      return played
    }))
    assert.equal(new Set(outs).size, 1)
  })

  test('finds its launcher through a folder whose name holds a space and a quote', async () => {
    const { s, b, opts } = other("it's a home")
    await settle(s, inputOf(s), S - 1, b)
    assert.match(plain(await tick(s, inputOf(s), S, opts)), /Opus 5/)
    assert.ok(fs.existsSync(`${b}/frames/s1/key`))
  })

  test('with lcw_bin empty, the launcher is the one in the LCW home', async () => {
    const s = scratch()
    await settle(s, inputOf(s))
    assert.match(plain(await tick(s, inputOf(s), S, { bin: '' })), /Opus 5/)
    fs.rmSync(`${s.home}/bin/statusline.mjs`)
    await tick(s, inputOf(s), S + 100, { bin: '' })
    assert.ok(fs.readFileSync(`${s.home}/statusline.log`, 'utf8').includes(`${s.home}/bin/statusline.mjs is missing`))
  })
})
