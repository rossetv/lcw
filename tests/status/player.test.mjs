import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmp, lcw, makeRepo } from '../core/helpers.mjs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const NOW = Date.UTC(2026, 2, 10, 12)
// not on a quarter-hour, where a session billed per token starts a new spend bucket
const S = NOW / 1000 + 100
const SHELLS = ['sh', 'bash', 'zsh', 'dash'].filter((s) => spawnSync(s, ['-c', ':']).status === 0)

/**
 * A scratch home with the launcher and the player installed, a session in a repository, and on the PATH a fake
 * `date` (prints LCW_FAKE_DATE) and a `node` that notes each start, with the locale it was given, in node.log.
 */
function scratch(name = 'lcw') {
  const t = tmp('player')
  const home = `${t}/${name}`
  fs.mkdirSync(`${home}/bin`, { recursive: true }); fs.mkdirSync(`${t}/h`); fs.mkdirSync(`${t}/fake`)
  for (const f of ['statusline.mjs', 'installed.mjs', 'statusline.sh']) fs.copyFileSync(`${ROOT}/scripts/bin/${f}`, `${home}/bin/${f}`)
  fs.writeFileSync(`${home}/plugin-root`, ROOT + '\n')
  fs.writeFileSync(`${t}/fake/date`, '#!/bin/sh\nprintf "%s\\n" "$LCW_FAKE_DATE"\n', { mode: 0o755 })
  fs.writeFileSync(`${t}/fake/node`, `#!/bin/sh\necho "\${LC_ALL-unset}" >> '${t}/node.log'\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 })
  return { t, home, repo: makeRepo(), shell: 'sh' }
}
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
function tick(s, input, second, { env = {}, zone = '+0000', shell = s.shell, bin } = {}) {
  const command = bin === undefined ? `. ${quoted(`${s.home}/bin/statusline.sh`)}`
    : bin === '' ? `lcw_bin=; . ${quoted(`${s.home}/bin/statusline.sh`)}` : `lcw_bin=${quoted(bin)}; . "$lcw_bin/statusline.sh"`
  const r = spawnSync(shell, ['-c', command], {
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
    env: { PATH: `${s.t}/fake:${process.env.PATH}`, HOME: `${s.t}/h`, LCW_HOME: s.home, COLUMNS: '120', TZ: 'UTC', LCW_FAKE_DATE: `${second}${zone}`, LCW_NOW: String(second * 1000), ...env },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.length > 0)
  return r.stdout
}

/** One fresh draw, saving no frames, then every record set back, so that what that draw wrote does not read as a change. */
function settle(s, input, second = S - 1, home = s.home) {
  const r = spawnSync(process.execPath, [`${s.home}/bin/statusline.mjs`], { input: typeof input === 'string' ? input : JSON.stringify(input), env: { PATH: process.env.PATH, HOME: `${s.t}/h`, LCW_HOME: home, COLUMNS: '120', TZ: 'UTC', LCW_NOW: String(second * 1000) } })
  assert.equal(r.status, 0)
  const old = (Date.now() - 100_000) / 1000
  const back = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) back(`${d}/${e.name}`); fs.utimesSync(`${d}/${e.name}`, old, old) } }
  back(home)
  fs.rmSync(`${s.t}/node.log`, { force: true })
}
const runDir = (s) => JSON.parse(fs.readFileSync(`${s.home}/sessions/s1.json`, 'utf8')).runDir
const plain = (t) => t.replace(/\x1b\[[0-9;]*m/g, '')

describe('when Node starts', { concurrency: true }, () => {
  test('an idle minute starts Node four times', () => {
    const s = scratch()
    settle(s, inputOf(s))
    for (let x = S; x < S + 60; x++) tick(s, inputOf(s), x)
    assert.equal(starts(s), 4)
  })

  test('the heartbeat, the session\'s age and a subscription\'s cost and cache figures start no Node', () => {
    const s = scratch()
    assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home: s.home, cwd: s.repo, session: 's1' }).code, 0)
    fs.writeFileSync(`${runDir(s)}/mod-alive`, String(S * 1000 - 1437))
    settle(s, inputOf(s))
    for (let i = 0; i < 15; i++) {
      if (i % 5 === 0) fs.writeFileSync(`${runDir(s)}/mod-alive`, String((S + i) * 1000 + 437))
      tick(s, inputOf(s, {}, i), S + i)
    }
    assert.equal(starts(s), 1)
  })

  test('on pay-per-token billing a new cost starts Node', () => {
    const s = scratch()
    const payg = (cost) => inputOf(s, { rate_limits: undefined, cost: { total_cost_usd: cost } })
    settle(s, payg(2))
    tick(s, payg(2), S); tick(s, payg(2), S + 1)
    assert.equal(starts(s), 1)
    assert.notEqual(plain(tick(s, payg(9), S + 2)), '')
    assert.equal(starts(s), 2)
  })

  test('the clock jumping forward or back draws afresh', () => {
    const s = scratch()
    settle(s, inputOf(s))
    tick(s, inputOf(s), S); tick(s, inputOf(s), S + 1)
    assert.equal(starts(s), 1)
    tick(s, inputOf(s), S + 3600)
    tick(s, inputOf(s), S + 3600 - 30)
    assert.equal(starts(s), 3)
  })

  // Each change is made after one draw and one playback; the next tick must start Node.
  const changes = {
    'a prompt is sent': (s) => { fs.mkdirSync(`${s.home}/activity`, { recursive: true }); fs.writeFileSync(`${s.home}/activity/s1.json`, JSON.stringify({ state: 'working', at: NOW })) },
    'the session\'s mark is set': (s) => lcw(['mark', '50'], { home: s.home, cwd: s.repo, session: 's1' }),
    'another session reports a newer weekly figure': (s) => fs.writeFileSync(`${s.home}/usage.json`, JSON.stringify({ at: NOW, sevenDay: { percentUsed: 40, resetsAt: new Date((S + 3 * 86400) * 1000).toISOString() }, source: 'statusline' })),
    'an outside quota is set up': (s) => fs.writeFileSync(`${s.home}/quota-command.json`, JSON.stringify({ v: 1, enabled: true })),
    'the session starts a run': (s) => lcw(['start', 'demo', '--title', 'Demo'], { home: s.home, cwd: s.repo, session: 's1' }),
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
    test(`${what} shows at the next tick`, () => {
      const s = scratch()
      settle(s, inputOf(s))
      tick(s, inputOf(s), S); tick(s, inputOf(s), S + 1)
      assert.equal(starts(s), 1)
      const { env, zone, after = '', ...input } = change(s) ?? {}
      tick(s, JSON.stringify(inputOf(s, input.model || input.context_window || input.rate_limits || input.effort ? input : {})) + after, S + 2, { env, zone })
      assert.equal(starts(s), 2)
    })
  }

  const runChanges = {
    'the run\'s state changes': (s) => lcw(['ask', 'Which database?'], { home: s.home, cwd: s.repo, session: 's1' }),
    'the mod counts a quiet agent': (s) => fs.writeFileSync(`${runDir(s)}/quiet-agents.json`, JSON.stringify({ quiet: 1, stalled: 0 })),
    'the session is held at its mark': (s) => fs.writeFileSync(`${runDir(s)}/gate`, JSON.stringify({ reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt: null, at: NOW })),
  }
  for (const [what, change] of Object.entries(runChanges)) {
    test(`${what} shows at the next tick`, () => {
      const s = scratch()
      assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home: s.home, cwd: s.repo, session: 's1' }).code, 0)
      fs.writeFileSync(`${runDir(s)}/mod-alive`, String(S * 1000))
      settle(s, inputOf(s))
      tick(s, inputOf(s), S); tick(s, inputOf(s), S + 1)
      assert.equal(starts(s), 1)
      change(s)
      tick(s, inputOf(s), S + 2)
      assert.equal(starts(s), 2)
    })
  }

  test('a heartbeat where there was none takes the card away at the next tick', () => {
    const s = scratch()
    assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home: s.home, cwd: s.repo, session: 's1' }).code, 0)
    settle(s, inputOf(s))
    assert.match(plain(tick(s, inputOf(s), S)), /LCW Build/)
    fs.writeFileSync(`${runDir(s)}/mod-alive`, String(S * 1000 + 1000))
    assert.doesNotMatch(plain(tick(s, inputOf(s), S + 1)), /LCW Build/)
    assert.equal(starts(s), 2)
  })

  test('the card comes back at the first tick past 15 seconds after the last heartbeat', () => {
    const s = scratch()
    assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home: s.home, cwd: s.repo, session: 's1' }).code, 0)
    fs.writeFileSync(`${runDir(s)}/mod-alive`, String(S * 1000 - 10_000))
    settle(s, inputOf(s))
    for (let x = S; x <= S + 5; x++) assert.doesNotMatch(plain(tick(s, inputOf(s), x)), /LCW Build/)
    assert.equal(starts(s), 1)
    assert.match(plain(tick(s, inputOf(s), S + 6)), /LCW Build/)
    assert.equal(starts(s), 2)
  })

  test('the conversation written again while the session waits on the person ends the wait at the next tick', () => {
    const s = scratch()
    fs.mkdirSync(`${s.home}/activity`, { recursive: true })
    fs.writeFileSync(`${s.home}/activity/s1.json`, JSON.stringify({ state: 'needs', at: NOW - 60_000 }))
    fs.writeFileSync(`${s.t}/s1.jsonl`, '{}\n')
    fs.utimesSync(`${s.t}/s1.jsonl`, (NOW - 61_000) / 1000, (NOW - 61_000) / 1000)
    settle(s, inputOf(s))
    tick(s, inputOf(s), S); tick(s, inputOf(s), S + 1)
    assert.equal(starts(s), 1)
    fs.appendFileSync(`${s.t}/s1.jsonl`, '{}\n')
    tick(s, inputOf(s), S + 2)
    assert.equal(starts(s), 2)
  })

  test('a new spend record of another session starts Node on pay-per-token billing', () => {
    const s = scratch()
    const payg = inputOf(s, { rate_limits: undefined, cost: { total_cost_usd: 2 } })
    settle(s, payg)
    tick(s, payg, S); tick(s, payg, S + 1)
    assert.equal(starts(s), 1)
    fs.writeFileSync(`${s.home}/sessions/other.json`, JSON.stringify({ billing: 'payg' }))
    fs.writeFileSync(`${s.home}/spend/other.json`, JSON.stringify({ v: 1, base: 0, max: 50, q: { [Math.floor(NOW / 900_000)]: 50 } }))
    tick(s, payg, S + 2)
    assert.equal(starts(s), 2)
  })
})

describe('a change in the second of the draw before it', { concurrency: true }, () => {
  for (const shell of SHELLS) {
    test(`shows at the next tick, in ${shell}`, () => {
      const s = { ...scratch(), shell }
      fs.mkdirSync(`${s.home}/activity`, { recursive: true })
      fs.writeFileSync(`${s.home}/activity/s1.json`, JSON.stringify({ state: 'working', at: S * 1000 - 5000 }))
      settle(s, inputOf(s))
      // a draw that runs within one second, and the turn ending right after it in that same second
      let before, after
      for (let i = 0; i < 5; i++) {
        fs.rmSync(`${s.home}/frames`, { recursive: true, force: true })
        before = Date.now()
        tick(s, inputOf(s), S)
        after = Date.now()
        if (Math.floor(before / 1000) === Math.floor(after / 1000)) break
      }
      assert.equal(Math.floor(before / 1000), Math.floor(after / 1000), 'a draw within one second')
      fs.writeFileSync(`${s.home}/activity/s1.json`, JSON.stringify({ state: 'done', at: S * 1000 }))
      fs.utimesSync(`${s.home}/activity/s1.json`, after / 1000, after / 1000)
      fs.rmSync(`${s.t}/node.log`)
      tick(s, inputOf(s), S + 1)
      assert.equal(starts(s), 1)
    })
  }
})

describe('what is played', { concurrency: true }, () => {
  test('the frame printed is the one for the second the shell read, when Node\'s clock is already in the next', () => {
    const s = scratch()
    settle(s, inputOf(s))
    const printed = tick(s, inputOf(s), S, { env: { LCW_NOW: String(S * 1000 + 1050) } })
    const key = fs.readFileSync(`${s.home}/frames/s1/key`, 'utf8').split('\n')
    assert.equal(printed, fs.readFileSync(`${s.home}/frames/s1/${key[2]}/${S}`, 'utf8'))
    assert.ok(fs.existsSync(`${s.home}/frames/s1/${key[2]}/${S + 1}`))
  })

  test('Node gets the locale the shell was given, and none when it had none', () => {
    const s = scratch()
    tick(s, inputOf(s), S, { env: { LC_ALL: 'en_US.UTF-8' } })
    tick(s, inputOf(s, { model: { display_name: 'Other' } }), S + 1)
    assert.deepEqual(log(s), ['en_US.UTF-8', 'unset'])
  })

  // A folder whose name a shell would expand, an input over many lines, and a session id that is a path.
  const hostile = (s) => {
    const dir = `${s.t}/a $(touch pwned) \`touch pwned2\` * ? [x] %s %d \\n "q" 'q' é`
    fs.mkdirSync(dir)
    return dir
  }
  test('every shell plays the same bytes, and runs nothing from the input', () => {
    const outs = []
    for (const shell of SHELLS) {
      const s = { ...scratch(), shell }
      const input = JSON.stringify(inputOf(s, { cwd: hostile(s), session_name: '$(touch pwned3) `id` ${HOME}' }), null, 2).replace(/": /g, '":')
      settle(s, input)
      tick(s, input, S)
      assert.equal(starts(s), 1)
      outs.push(tick(s, input, S + 1).replace(s.t, ''))
      assert.equal(starts(s), 1, `${shell} played the second frame`)
      for (const d of [s.t, `${s.t}/h`, s.repo, process.cwd()]) for (const p of ['pwned', 'pwned2', 'pwned3']) assert.ok(!fs.existsSync(`${d}/${p}`), `${shell} ran ${p}`)
    }
    assert.equal(new Set(outs).size, 1)
  })

  test('a session id that is not a plain name is never used in a path', () => {
    for (const id of ['../escape', 'a/b', '$(touch pwned)', '..', '*']) {
      const s = scratch()
      const out = tick(s, inputOf(s, { session_id: id }), S)
      assert.match(plain(out), /Opus 5/)
      assert.deepEqual(fs.existsSync(`${s.home}/frames`) ? fs.readdirSync(`${s.home}/frames`) : [], [], id)
      assert.ok(!fs.existsSync(`${s.home}/escape`) && !fs.existsSync(`${s.t}/h/pwned`), id)
    }
  })

  test('frames planted outside the frames folder are not played for a session id that leads there', () => {
    const s = scratch()
    settle(s, inputOf(s, { session_id: 'xplantedx' }))
    tick(s, inputOf(s, { session_id: 'xplantedx' }), S)
    fs.renameSync(`${s.home}/frames/xplantedx`, `${s.home}/planted`)
    const key = fs.readFileSync(`${s.home}/planted/key`, 'utf8')
    // the input's part of the key, after the watched files, made to fit the input with the hostile id
    const lines = key.split('\n'), input = lines.indexOf(lines[3], 4) + 1
    fs.writeFileSync(`${s.home}/planted/key`, [...lines.slice(0, input), ...lines.slice(input).map((l) => l.replaceAll('xplantedx', '../planted'))].join('\n'))
    fs.utimesSync(`${s.home}/planted/key`, (Date.now() - 50_000) / 1000, (Date.now() - 50_000) / 1000)
    fs.writeFileSync(`${s.home}/planted/${key.split('\n')[2]}/${S + 1}`, 'PLANTED\n')
    assert.notEqual(tick(s, inputOf(s, { session_id: '../planted' }), S + 1), 'PLANTED\n')
  })

  test('an input that writes its session id otherwise gets a fresh draw at every tick', () => {
    const s = scratch()
    const input = JSON.stringify(inputOf(s)).replace('"session_id":"s1"', '"session_id": "s1"')
    settle(s, input)
    tick(s, input, S); tick(s, input, S + 1)
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

  test('draws its rows and keeps its frames in its own home, and plays them in every shell alike', () => {
    const outs = []
    for (const shell of SHELLS) {
      const { s, b, opts } = other()
      s.shell = shell
      // a folder of the same name in each shell's scratch, so that the rows are the same
      fs.mkdirSync(`${s.t}/proj`)
      const input = inputOf(s, { cwd: `${s.t}/proj` })
      settle(s, input, S - 1, b)
      const first = tick(s, input, S, opts)
      assert.equal(plain(first).split('\n').filter(Boolean).length, 2, shell)
      assert.ok(fs.existsSync(`${b}/frames/s1/key`) && !fs.existsSync(`${s.home}/frames`), shell)
      const played = tick(s, input, S + 1, opts)
      assert.equal(starts(s), 1, `${shell} played a frame from the session's home`)
      outs.push(played)
    }
    assert.equal(new Set(outs).size, 1)
  })

  test('finds its launcher through a folder whose name holds a space and a quote', () => {
    const { s, b, opts } = other("it's a home")
    settle(s, inputOf(s), S - 1, b)
    assert.match(plain(tick(s, inputOf(s), S, opts)), /Opus 5/)
    assert.ok(fs.existsSync(`${b}/frames/s1/key`))
  })

  test('with lcw_bin empty, the launcher is the one in the LCW home', () => {
    const s = scratch()
    settle(s, inputOf(s))
    assert.match(plain(tick(s, inputOf(s), S, { bin: '' })), /Opus 5/)
    fs.rmSync(`${s.home}/bin/statusline.mjs`)
    tick(s, inputOf(s), S + 100, { bin: '' })
    assert.ok(fs.readFileSync(`${s.home}/statusline.log`, 'utf8').includes(`${s.home}/bin/statusline.mjs is missing`))
  })
})
