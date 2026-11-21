import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmp, lcw, readJson, makeRepo, git } from '../core/helpers.mjs'
import { mapInput } from '../../scripts/statusline.mjs'
import { renderStatusRows } from '../../lib/status.mjs'
import { toAnsi } from '../../lib/paint.mjs'
import { diffOf } from '../../scripts/lib/diff.mjs'

const ROOT = new URL('../..', import.meta.url).pathname
const LINE = ROOT + 'scripts/statusline.mjs'
const RIG = new URL('./samples/', import.meta.url).pathname
const sample = (n) => fs.existsSync(RIG + n) ? JSON.parse(fs.readFileSync(RIG + n, 'utf8')) : null
const sampleP4 = sample('statusline-stdin-p4.json')
const fixture = sampleP4 && { ...sampleP4, cwd: tmp('cwd') }

function line(input, { home = tmp('home'), env = {} } = {}) {
  const all = { ...process.env, LCW_HOME: home, COLUMNS: '120', ...env }
  for (const k of Object.keys(all)) if (all[k] === undefined) delete all[k]
  const r = spawnSync('node', [LINE], { input, encoding: 'utf8', env: all })
  return { code: r.status, out: r.stdout, home }
}

test('maps the real worktree sample', () => {
  // The sample was recorded in a session inside the worktree .claude/worktrees/probe of a repository called "repo".
  // Rebuild that place so the repository name and the branch come from git, as they did then.
  const repo = tmp('sl') + '/repo'
  fs.mkdirSync(repo, { recursive: true })
  const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' })
  g('init', '-q', '-b', 'main'); fs.writeFileSync(repo + '/README.md', 'x\n'); g('add', '-A')
  g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init')
  g('worktree', 'add', '-q', '-b', 'lcw/probe', '.claude/worktrees/probe')
  const here = JSON.parse(JSON.stringify(sampleP4).split('/tmp/rig/repo').join(repo))
  const now = (here.rate_limits.seven_day.resets_at - 84 * 3600) * 1000
  const { input, usage } = mapInput(here, now, 60)
  assert.equal(input.model, 'Haiku 5.5')
  assert.equal(input.effort, 'low')
  assert.equal(input.contextPercent, 3)
  assert.equal(input.contextWindow, '1M')
  assert.equal(input.repo, 'repo')
  assert.equal(input.branch, 'lcw/probe')
  assert.equal(input.weekUsedPercent, 22)
  assert.equal(input.weekElapsedPercent, 50)
  assert.equal(input.markPercent, 60)
  assert.equal(usage.sevenDay.percentUsed, 22)
  assert.equal(usage.sevenDay.resetsAt, new Date(1795356000 * 1000).toISOString())
})

test('maps empty and odd input without throwing', () => {
  for (const x of [null, {}, 'x', { model: 5, rate_limits: {} }]) {
    const { input, usage } = mapInput(x)
    assert.equal(input.markPercent, 75)
    assert.equal(usage, null)
  }
})

test('prints something and exits 0 on bad input', () => {
  for (const input of ['', '{not json', '{}', '[]', 'null']) {
    const r = line(input, { home: '/nonexistent/lcw-home' })
    assert.equal(r.code, 0)
    assert.ok(r.out.trim().length > 0, JSON.stringify(input))
  }
})

test('writes usage.json', { skip: !fixture }, () => {
  const r = line(JSON.stringify(fixture))
  assert.equal(r.code, 0)
  const u = readJson(r.home + '/usage.json')
  assert.equal(u.sevenDay.percentUsed, 22)
  assert.equal(u.source, 'statusline')
})

test('the right-hand group ends five cells short of COLUMNS, where Claude Code cuts the line', () => {
  const input = JSON.stringify({ model: { display_name: 'Opus 5' }, cwd: tmp('cwd'), rate_limits: { seven_day: { used_percentage: 20, resets_at: Math.floor(Date.now() / 1000) + 3 * 86400 } } })
  for (const [columns, width] of [['100', 95], ['126', 121], ['90', 85], [undefined, 121]]) {
    const r = line(input, { env: { COLUMNS: columns } })
    const rows = r.out.replace(/\x1b\][^\x1b]*\x1b\\/g, '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean)
    assert.ok(rows.some((x) => [...x].length === width), columns + ': ' + rows.map((x) => [...x].length).join(','))
    assert.ok(rows.every((x) => [...x].length <= width), columns + ': ' + rows.map((x) => [...x].length).join(','))
  }
})

function startRun(percent) {
  const repo = makeRepo()
  const home = tmp('home')
  assert.equal(lcw(['start', 'demo', '--title', 'Demo'], { home, cwd: repo, session: 's1' }).code, 0)
  const dir = readJson(home + '/sessions/s1.json').runDir
  const input = JSON.stringify({ session_id: 's1', cwd: repo, model: { display_name: 'Opus 5' },
    rate_limits: { seven_day: { used_percentage: percent, resets_at: Math.floor(Date.now() / 1000) + 3 * 86400 } } })
  return { home, dir, input }
}

test('gate is written at the mark and removed below it', () => {
  const { home, dir, input } = startRun(75)
  assert.equal(line(input, { home }).code, 0)
  assert.equal(readJson(dir + '/gate').reason, 'mark')
  // a figure below the mark counts only in a new reset window; within one window the stored figure never drops
  const next = JSON.parse(input)
  next.rate_limits.seven_day.used_percentage = 40
  next.rate_limits.seven_day.resets_at += 7 * 86400
  line(JSON.stringify(next), { home })
  assert.equal(fs.existsSync(dir + '/gate'), false)
})

test('card shows under the rows when mod-alive is stale, not when fresh', () => {
  const { home, dir, input } = startRun(10)
  const rows = (o) => o.trim().split('\n').length
  // one clock for every tick: the card counts the stage's time in seconds, so two ticks a moment apart could differ
  const now = Date.now() + 5000
  const env = { LCW_NOW: String(now) }
  const none = line(input, { home, env })
  const stale = line(input, { home, env })
  fs.writeFileSync(dir + '/mod-alive', String(now))
  const fresh = line(input, { home, env })
  fs.writeFileSync(dir + '/mod-alive', String(now - 60000))
  const old = line(input, { home, env })
  assert.ok(rows(none.out) > rows(fresh.out))
  assert.equal(rows(old.out), rows(none.out))
  // The creature left of the two rows moves with the clock, so two runs a moment apart may draw it differently.
  // Everything beside it must be the same.
  const beside = (o) => o.out.split('\n').map((row, i) => (i < 2 ? row.replace(/\x1b\[[0-9;]*m/g, '').replace(/^.*?(?=Opus|\d+% )/, '') : row)).join('\n')
  assert.equal(beside(stale), beside(none))
})

test('an idle session with a lower, older figure does not lower the stored one or lift the gate', () => {
  const { home, dir, input } = startRun(80)
  line(input, { home })
  assert.equal(readJson(dir + '/gate').reason, 'mark')
  const lower = JSON.parse(input)
  lower.session_id = 's2'
  lower.rate_limits.seven_day.used_percentage = 40
  line(JSON.stringify(lower), { home })
  assert.equal(readJson(home + '/usage.json').sevenDay.percentUsed, 80)
  assert.equal(lcw(['usage'], { home, cwd: lower.cwd, session: 's1' }).out.includes('at the mark'), true)
  assert.ok(fs.existsSync(dir + '/gate'))
})

test('the status line leaves a gate whose reset time has passed', () => {
  const { home, dir, input } = startRun(10)
  fs.writeFileSync(dir + '/gate', JSON.stringify({ reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt: new Date(Date.now() - 1000).toISOString(), at: 1 }))
  line(input, { home })
  assert.ok(fs.existsSync(dir + '/gate'))
})

test('the bar shows the mark of the session it is drawn for, run or no run', { skip: !fixture }, () => {
  const home = tmp('home')
  const input = JSON.stringify({ ...fixture, session_id: 'bar-1', transcript_path: undefined })
  const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
  assert.ok(!/ 85%/.test(plain(line(input, { home }).out)))
  lcw(['mark', '85'], { home, cwd: fixture.cwd, session: 'bar-1' })
  assert.match(plain(line(input, { home }).out), / 85%/)
})

const bare = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const week = { seven_day: { used_percentage: 20, resets_at: Math.floor(Date.now() / 1000) + 3 * 86400 } }

test('every bar shows the newest figure any session has reported, and none once that week is over', () => {
  const home = tmp('home')
  const reset = Math.floor(Date.now() / 1000) + 3 * 86400
  const stored = (percentUsed, resetsAt) => fs.writeFileSync(home + '/usage.json', JSON.stringify({ at: 1, sevenDay: { percentUsed, resetsAt } }))
  const shown = (rate_limits) => bare(line(JSON.stringify({ session_id: 'idle', cwd: tmp('cwd'), model: { display_name: 'Opus 5' }, rate_limits }), { home }).out)
  stored(44, new Date(reset * 1000).toISOString())
  const own = shown({ seven_day: { used_percentage: 42, resets_at: reset } })
  assert.ok(/44% /.test(own) && !/42%/.test(own), 'this session last saw 42%: ' + own)
  assert.match(shown(undefined), /44% /, 'a session with no reading of its own')
  stored(44, new Date(Date.now() - 1000).toISOString())
  assert.ok(!/44%/.test(shown(undefined)), "last week's figure is not shown")
})

test('the mascot stands left of both rows, which open with an escape code so that their leading spaces survive', () => {
  const input = JSON.stringify({ session_id: 'pet-1', model: { display_name: 'Opus 5' }, cwd: tmp('cwd'), rate_limits: week })
  const rows = line(input, { env: { COLUMNS: '100' } }).out.split('\n').filter(Boolean)
  assert.equal(rows.length, 2)
  for (const row of rows) assert.ok(row.startsWith('\x1b[0m'), JSON.stringify(row.slice(0, 12)))
  const at = rows.map((r) => bare(r).search(/Opus|20%/))
  assert.equal(at[0], at[1])
  assert.ok(at[0] >= 5 && at[0] <= 7, 'the creature, the cell for its mark, and one of gap: ' + at[0])
  // too narrow for the creature and two full rows: the rows stay as they were
  const tight = line(input, { env: { COLUMNS: '50' } }).out.split('\n').filter(Boolean)
  assert.deepEqual(tight.map((r) => bare(r).search(/Opus|20%/)), [0, 0])
})

test('the mascot shows what the hooks recorded for this session, and not for another', () => {
  const home = tmp('home')
  fs.mkdirSync(home + '/activity')
  fs.writeFileSync(home + '/activity/pet-2.json', JSON.stringify({ state: 'needs', at: Date.now() }))
  const shown = (id) => bare(line(JSON.stringify({ session_id: id, cwd: tmp('cwd') }), { home }).out)
  assert.equal((shown('pet-2').match(/●/g) ?? []).length, 2, 'the wide eyes of waiting for the person')
  assert.ok(!shown('pet-3').includes('●'))
})

test('the mascot looks at the person while its run has an open question', () => {
  const { home, input } = startRun(10)
  const cwd = JSON.parse(input).cwd
  const eyes = () => (bare(line(input, { home }).out).match(/●/g) ?? []).length
  assert.equal(eyes(), 0)
  assert.equal(lcw(['ask', 'Which database?'], { home, cwd, session: 's1' }).code, 0)
  assert.equal(eyes(), 2)
})

test('of two records for one session, the mascot goes by the later one', () => {
  // A resumed session: its hooks write under the transcript's name, the mod under the session's id.
  const home = tmp('home')
  fs.mkdirSync(home + '/activity')
  const at = Date.now()
  fs.writeFileSync(home + '/activity/old-name.json', JSON.stringify({ state: 'needs', at: at - 5000 }))
  fs.writeFileSync(home + '/activity/new-id.json', JSON.stringify({ state: 'rest', at }))
  const out = bare(line(JSON.stringify({ session_id: 'new-id', transcript_path: '/nowhere/old-name.jsonl', cwd: tmp('cwd') }), { home }).out)
  assert.ok(!out.includes('●'), 'the interrupt came after the question: ' + out)
})

test('the mascot worries within five points of the usage mark and cries once the mark is reached', () => {
  // The clock picks the creature's frame, and a blink hides the eyes, so the test stands at one moment.
  const now = Date.UTC(2026, 10, 19, 12)
  const face = (used) => {
    const input = JSON.stringify({ session_id: 'pet-' + used, cwd: tmp('cwd'), rate_limits: { seven_day: { used_percentage: used, resets_at: now / 1000 + 3 * 86400 } } })
    // Only the creature's cells at the start of each row: the folder name further along can hold a T too.
    const out = bare(line(input, { env: { LCW_NOW: String(now), TZ: 'UTC' } }).out) // the creature yawns at night, local time.split('\n').map((row) => [...row].slice(0, 6).join('')).join('\n')
    return (out.match(/T/g) ?? []).length === 2 ? 'crying' : /ó/.test(out) && /ò/.test(out) ? 'worried' : 'neither'
  }
  assert.equal(face(60), 'neither') // the mark is 75 unless the person moves it
  assert.equal(face(71), 'worried')
  assert.equal(face(75), 'crying')
})

test('the mascot is angry while its run has a stalled agent, as long as the mod that counts them is alive', () => {
  const { home, dir, input } = startRun(10)
  // noon UTC today, in UTC: no night-time yawn and the same frame as the test above, whenever and wherever it runs
  const now = Math.floor(Date.now() / 86400000) * 86400000 + 12 * 3600000
  const env = { LCW_NOW: String(now), TZ: 'UTC' }
  const angry = () => { const out = bare(line(input, { home, env }).out).split('\n').slice(0, 2).join('\n'); return /ò/.test(out) && /ó/.test(out) }
  fs.writeFileSync(dir + '/quiet-agents.json', JSON.stringify({ quiet: 0, stalled: 1, at: now }))
  fs.writeFileSync(dir + '/mod-alive', String(now))
  assert.equal(angry(), true)
  fs.writeFileSync(dir + '/mod-alive', String(now - 60000))
  assert.equal(angry(), false, 'a count nobody keeps is not believed')
})

test('the reset countdown is to the minute, not to a whole percent of the week', () => {
  const now = Date.UTC(2026, 10, 19, 12)
  const shown = (hours) => {
    const { input } = mapInput({ rate_limits: { seven_day: { used_percentage: 40, resets_at: (now + hours * 36e5) / 1000 } } }, now)
    return renderStatusRows(input, { width: 100 })[1].map((s) => s.t).join('').match(/resets in \S+/)[0]
  }
  assert.equal(shown(50 / 60), 'resets in 50m')
  assert.equal(shown(2.5), 'resets in 2h')
})

test('a long repo and branch are shortened to fit the first row', () => {
  const input = { model: 'Opus 4.5', effort: 'high', contextPercent: 45, contextWindow: '200k', repo: 'lcw', branch: 'feature/add-retry-policy-for-uploads', weekUsedPercent: 40, weekElapsedPercent: 50, markPercent: 75 }
  for (const width of [44, 55, 70, 90]) {
    const rows = renderStatusRows(input, { width })
    for (const row of rows) assert.ok([...row.map((s) => s.t).join('')].length <= width - 2, width + ' columns')
  }
  assert.match(renderStatusRows(input, { width: 70 })[0].map((s) => s.t).join(''), /lcw · feature\/add.*…$/)
})


test('the diff counts a branch from where it left main, with uncommitted edits and new files; on main only what is not committed', () => {
  const repo = makeRepo()                     // main: a.txt with one line
  const home = tmp('home')
  git(repo, 'checkout', '-q', '-b', 'feature')
  fs.writeFileSync(repo + '/a.txt', 'one\ntwo\nthree\n'); git(repo, 'commit', '-qam', 'more')   // +2
  fs.writeFileSync(repo + '/a.txt', 'two\nthree\n')                                               // -1, not committed
  fs.writeFileSync(repo + '/new.txt', 'x\ny\nz')                                                  // +3, not tracked
  fs.writeFileSync(repo + '/blob.bin', Buffer.from([1, 0, 2, 10]))                                // binary: none
  let now = 1e12
  assert.deepEqual(diffOf(repo, home, now), { added: 5, removed: 1 })
  fs.writeFileSync(repo + '/more.txt', '1\n')
  assert.deepEqual(diffOf(repo, home, now + 1000), { added: 5, removed: 1 }, 'kept for a few seconds')
  assert.deepEqual(diffOf(repo, home, now + 6000), { added: 6, removed: 1 })
  const onMain = makeRepo()
  fs.writeFileSync(onMain + '/a.txt', 'uno\n'); fs.writeFileSync(onMain + '/b.txt', 'b\n')
  assert.deepEqual(diffOf(onMain, home, now), { added: 2, removed: 1 })
  assert.equal(diffOf(tmp('plain'), home, now), null)
})

test('the diff column stands at the right edge of both rows, and gives way before the branch is shortened', () => {
  const input = { model: 'Opus 5.5', effort: 'xhigh', contextPercent: 41, contextWindow: '1M', repo: 'lcw', branch: 'lcw/status-line-diff', weekUsedPercent: 22, weekElapsedPercent: 52, markPercent: 75 }
  const plain = (i, width) => toAnsi(renderStatusRows(i, { width }), 'dark', width).replace(/\x1b\[[0-9;]*m/g, '').split('\n')
  const rows = plain({ ...input, diff: { added: 23232, removed: 3231 } }, 112)
  assert.ok(rows[0].endsWith('lcw · lcw/status-line-diff │ +23.2k'), rows[0])
  assert.ok(rows[1].endsWith('+58% spare │  −3.2k'), rows[1])
  assert.ok(rows.every((r) => [...r].length === 112))
  assert.deepEqual(plain({ ...input, diff: { added: 0, removed: 0 } }, 112), plain(input, 112), 'no change, no column')
  const long = { ...input, branch: 'feature/add-retry-policy-for-uploads', diff: { added: 86, removed: 12 } }
  assert.deepEqual(plain(long, 70), plain({ ...long, diff: null }, 70))
  // with no "resets in" on the second row the figure still goes to the right edge
  assert.ok(plain({ ...input, weekElapsedPercent: null, diff: { added: 86, removed: 12 } }, 112)[1].endsWith('│ −12'))
})


test("during a run with a worktree, the bar names the run's branch and counts the run's changes", () => {
  const { home, input } = startRun(10)
  const repo = JSON.parse(input).cwd
  const plain = () => line(input, { home }).out.replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0]
  assert.match(plain(), /· main$/, 'no worktree yet: the session\'s own checkout, which has no changes')
  const tree = lcw(['worktree'], { home, cwd: repo, session: 's1' }).out.trim()
  fs.writeFileSync(tree + '/new.txt', 'a\nb\n')
  assert.match(plain(), /· lcw\/demo\s+│\s+\+2$/)
})


test('two runs in one repository: each session counts and names only its own run', () => {
  const repo = makeRepo()
  const home = tmp('home')
  const bar = (session) => line(JSON.stringify({ session_id: session, cwd: repo, model: { display_name: 'Opus 5' },
    rate_limits: { seven_day: { used_percentage: 10, resets_at: Math.floor(Date.now() / 1000) + 3 * 86400 } } }), { home }).out.replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0]
  const tree = {}
  for (const [session, name, lines] of [['s1', 'alpha', 'a\n'], ['s2', 'beta', 'a\nb\nc\n']]) {
    assert.equal(lcw(['start', name, '--title', name], { home, cwd: repo, session }).code, 0)
    tree[session] = lcw(['worktree'], { home, cwd: repo, session }).out.trim()
    fs.writeFileSync(tree[session] + '/new.txt', lines)
  }
  assert.match(bar('s1'), /· lcw\/alpha\s+│\s+\+1$/)
  assert.match(bar('s2'), /· lcw\/beta\s+│\s+\+3$/)
  assert.match(bar('s3'), /· main$/, 'a session with no run of its own sees neither')
})

test('the status line saves its session\'s context size for lcw checkpoint', () => {
  const input = JSON.stringify({ session_id: 'ctx1', cwd: tmp('cwd'), context_window: { used_percentage: 31, context_window_size: 1_000_000 } })
  const { home } = line(input)
  const saved = readJson(`${home}/cache/context-ctx1.json`)
  assert.equal(saved.tokens, 310_000)
  assert.equal(saved.window, 1_000_000)
})

test('the mascot counts the open waves of a sweep, not the empty run-level lists', () => {
  const { home, dir, input } = startRun(10)
  const state = readJson(dir + '/state.json')
  const face = () => (bare(line(input, { home }).out).match(/T/g) ?? []).length
  const baseline = face()
  const sweep = { ...state, shape: 'sweep', stage: 'Build', tasks: [], requirements: [], sweep: { prs: 'stacked', waves: [
    { n: 1, status: 'shipped', merged: false, requirements: [{ id: 'R1', status: 'failing' }], tasks: [] },
    { n: 2, status: 'running', stage: 'Build', tasks: [{ id: 'T1', status: 'todo' }], requirements: [{ id: 'R1', status: 'pass' }] }] } }
  fs.writeFileSync(dir + '/state.json', JSON.stringify(sweep))
  assert.equal(face(), baseline, 'a failing requirement of a wave that is not open does not count')
  sweep.sweep.waves[1].requirements.push({ id: 'R2', status: 'failing' })
  fs.writeFileSync(dir + '/state.json', JSON.stringify(sweep))
  assert.ok(face() > baseline, 'a failing requirement of an open wave makes it cry')
})
