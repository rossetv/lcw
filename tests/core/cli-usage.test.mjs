import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fnv1a32hex } from '../../lib/key.mjs'
import { spawn } from 'node:child_process'
import { tmp, makeRepo, git, lcw, readJson, started, CLI } from './helpers.mjs'
import { wakeable } from '../../hooks/lcw-mod.mjs'

process.env.TZ = 'Europe/Dublin'
const NOW = new Date(2026, 5, 10, 10, 0).getTime() // June 10 2026, 10:00 local
const quarter = (ms) => Math.floor(ms / 900000)

/** Runs fn with the clock fixed at NOW, so "today" and 08:00 are the same on every machine. */
function atNow(fn) {
  process.env.LCW_NOW = String(NOW)
  try { return fn() } finally { delete process.env.LCW_NOW }
}

/** A session billed per token, with $1,175 spent three days ago and $85 since midnight: $1,260 over the week. */
function payg(home, id = 's1') {
  fs.mkdirSync(`${home}/sessions`, { recursive: true })
  fs.mkdirSync(`${home}/spend`, { recursive: true })
  const file = `${home}/sessions/${id}.json`
  fs.writeFileSync(file, JSON.stringify({ ...(fs.existsSync(file) ? readJson(file) : {}), billing: 'payg' }))
  fs.writeFileSync(`${home}/spend/${id}.json`, JSON.stringify({ v: 1, base: 0, max: 1260, q: { [quarter(NOW - 3 * 86400000)]: 1175, [quarter(NOW - 3600000)]: 1260 } }))
}
const sessionJson = (home, id = 's1') => readJson(`${home}/sessions/${id}.json`)

test('finish copies totals.json and works out the share of the week', () => {
  const u = started('two')
  const usage = (p) => fs.writeFileSync(`${u.home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: p, resetsAt: null }, source: 'statusline' }))
  u.cli('set', 'weekAtStart=10')
  fs.writeFileSync(`${u.dir}/totals.json`, JSON.stringify({ agents: 31, tokens: 6200000 }))
  usage(25)
  u.cli('finish')
  assert.deepEqual(u.state().totals, { agents: 31, tokens: 6200000, sharePercent: 15 })
  const w = started('three')
  fs.writeFileSync(`${w.home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: 5, resetsAt: null }, source: 'statusline' }))
  w.cli('set', 'weekAtStart=40')
  w.cli('finish')
  assert.deepEqual(w.state().totals, { agents: 0, tokens: 0, sharePercent: 0 })
})

test('the share of the week carries over a weekly reset', () => {
  const t = started('reset')
  const usage = (p, resetsAt) => fs.writeFileSync(`${t.home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: p, resetsAt }, source: 'statusline' }))
  const week1 = '2099-01-08T00:00:00.000Z', week2 = '2099-01-15T00:00:00.000Z'
  usage(40, week1)
  t.cli('set', 'weekAtStart=40', 'weekResetsAt="' + week1 + '"', 'weekUsed=40')
  t.cli('stage', 'Build')
  usage(70, week1)
  t.cli('pause', 'mark')
  assert.equal(t.state().weekUsed, 70)
  usage(12, week2)
  t.cli('resume')
  const s = t.state()
  assert.deepEqual([s.shareBefore, s.weekAtStart, s.weekResetsAt, s.weekUsed], [30, 0, week2, 12])
  usage(20, week2)
  t.cli('finish')
  assert.equal(t.state().totals.sharePercent, 50)
})

test('mark and gate, usage with and without a run', () => {
  const t = started()
  const future = new Date(Date.now() + 86400000).toISOString()
  const writeUsage = (p) => fs.writeFileSync(`${t.home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: p, resetsAt: future }, source: 'statusline' }))
  const noRun = { home: t.home, cwd: tmp('x'), session: 'nobody' }

  assert.match(lcw(['usage'], noRun).out, /week: unknown/)
  writeUsage(80)
  const bare = lcw(['usage'], noRun)
  assert.equal(bare.code, 0)
  assert.match(bare.out, /week: 80% used/)
  assert.match(bare.out, /mark: 75%\nat the mark/, 'a session with no run has a mark of its own')

  assert.match(t.cli('usage').out, /mark: 75%\nat the mark/)
  const gate = readJson(`${t.dir}/gate`)
  assert.equal(gate.reason, 'mark')
  assert.equal(gate.usedPercent, 80)
  assert.equal(gate.resetsAt, future)

  t.cli('mark', '90')
  assert.equal(t.state().markPercent, 90)
  assert.ok(!fs.existsSync(`${t.dir}/gate`))
  assert.match(t.cli('usage').out, /ok/)
  writeUsage(95)
  t.cli('usage')
  assert.ok(fs.existsSync(`${t.dir}/gate`))
  writeUsage(10)
  assert.match(t.cli('usage').out, /ok/)
  assert.ok(!fs.existsSync(`${t.dir}/gate`))
  assert.equal(t.cli('mark', '0').code, 1)
  assert.equal(t.cli('mark', '101').code, 1)
})

test('usage reports a reset and leaves the expired gate; resume and mark remove it', () => {
  const t = started('ex')
  const gate = () => fs.writeFileSync(`${t.dir}/gate`, JSON.stringify({ reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt: new Date(Date.now() - 1000).toISOString(), at: 1 }))
  gate()
  assert.match(t.cli('usage').out, /the limit has reset/)
  assert.ok(fs.existsSync(`${t.dir}/gate`))
  t.cli('resume')
  assert.ok(!fs.existsSync(`${t.dir}/gate`))
  gate()
  t.cli('mark', '90')
  assert.ok(!fs.existsSync(`${t.dir}/gate`))
})

test('usage with an expired gate on disk says at the mark when the new week is already there', () => {
  const t = started('again')
  fs.writeFileSync(`${t.dir}/gate`, JSON.stringify({ reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt: new Date(Date.now() - 1000).toISOString(), at: 1 }))
  fs.writeFileSync(`${t.home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: 90, resetsAt: new Date(Date.now() + 86400000).toISOString() }, source: 'statusline' }))
  const r = t.cli('usage')
  assert.match(r.out, /mark: 75%\nat the mark/)
  assert.doesNotMatch(r.out, /the limit has reset/)
})

test('no gate is written for a run the human paused; resume lets it be evaluated', () => {
  const t = started()
  fs.writeFileSync(`${t.home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: 90, resetsAt: new Date(Date.now() + 1e8).toISOString() }, source: 'statusline' }))
  t.cli('stage', 'Spec')
  t.cli('pause', 'human')
  const paused = fs.readFileSync(`${t.dir}/state.json`, 'utf8')
  const ledger = fs.readFileSync(`${t.dir}/ledger.md`, 'utf8')
  assert.match(t.cli('usage').out, /week: 90% used[\s\S]*mark: 75%\nat the mark/)
  assert.equal(fs.readFileSync(`${t.dir}/state.json`, 'utf8'), paused)
  assert.equal(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), ledger)
  assert.equal(t.state().status, 'paused')
  assert.equal(t.state().pausedReason, 'human')
  assert.equal(wakeable(t.state()), false)
  assert.ok(!fs.existsSync(`${t.dir}/gate`))
  t.cli('resume')
  t.cli('usage')
  assert.ok(fs.existsSync(`${t.dir}/gate`))
})

test('mark says at the mark for a run the human paused when the week is already over it', () => {
  const t = started()
  fs.writeFileSync(`${t.home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: 70, resetsAt: new Date(Date.now() + 1e8).toISOString() }, source: 'statusline' }))
  t.cli('stage', 'Spec')
  t.cli('pause', 'human')
  assert.match(t.cli('mark', '60').out, /at the mark/)
  assert.doesNotMatch(t.cli('mark', '80').out, /at the mark/)
})

test('a mark set with no run belongs to that session alone, and a run started there begins with it', () => {
  const home = tmp('home')
  const repo = makeRepo()
  const a = { home, cwd: repo, session: 'a' }
  const b = { home, cwd: repo, session: 'b' }
  assert.match(lcw(['mark', '85'], a).out, /mark 85%\nweek: unknown\nok/)
  assert.match(lcw(['usage'], a).out, /mark: 85%/)
  assert.match(lcw(['usage'], b).out, /mark: 75%/)
  const dirA = /^folder: (.+)$/m.exec(lcw(['start', 'in-a', '--title', 'A'], a).out)[1]
  assert.equal(readJson(`${dirA}/state.json`).markPercent, 85)
  assert.equal(readJson(`${home}/sessions/a.json`).markPercent, 85, 'binding the session to its run keeps its mark')
  const dirB = /^folder: (.+)$/m.exec(lcw(['start', 'in-b', '--title', 'B'], b).out)[1]
  assert.equal(readJson(`${dirB}/state.json`).markPercent, 75)
})

test('setting a mark says how much of the week is used, so a mark already passed shows at once', () => {
  const home = tmp('home')
  fs.writeFileSync(`${home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: 42, resetsAt: null } }))
  assert.match(lcw(['mark', '20'], { home, cwd: tmp('x'), session: 'solo' }).out, /mark 20%\nweek: 42% used\nat the mark/)
  assert.match(started().cli('mark', '90').out, /mark 90%\nweek: unknown\nok/, 'and the same with a run')
})

test("a mark is one session's: another session that takes the run over brings its own", () => {
  const t = started('grant')
  t.cli('mark', '90')
  const wt = t.cli('worktree').out.trim()
  const later = { home: t.home, cwd: wt, session: 'later' }
  assert.equal(lcw(['set', 'health=carrying on'], later).code, 0)
  assert.equal(t.state().markPercent, 75)
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /another session took over/)
  t.cli('set', 'health=back')
  assert.equal(t.state().markPercent, 90, 'the first session brings its 90 back with it')
})

test('lcw usage on pay-per-token billing prints the week, today with its pace, and the mark', () => {
  const home = tmp('home')
  payg(home)
  const o = { home, cwd: tmp('x'), session: 's1' }
  const [week, today, mark] = atNow(() => lcw(['usage'], o).out.trim().split('\n'))
  assert.equal(week, 'last 7 days: $1,260 spent on this machine (estimate) of a $4,000 cap (assumed)')
  assert.match(today, /^today: \$85 by 10:00, a rate of \$204 a day · rolling 7d \$[\d,]+ (spare|short)$/)
  assert.equal(mark, 'mark: $3,000 (75%) · ok')
  atNow(() => lcw(['cap', '5,000 USD'], o))
  assert.match(atNow(() => lcw(['usage'], o).out), /of a \$5,000 cap\n.*\nmark: \$3,750 \(75%\) · ok/, 'a stated cap is no longer assumed, and the share mark follows it')
  fs.writeFileSync(`${home}/spend/s1.json`, JSON.stringify({ v: 1, base: 0, max: 4000, q: { [quarter(NOW - 3600000)]: 4000 } }))
  assert.match(atNow(() => lcw(['usage'], o).out), /mark: \$3,750 \(75%\) · at the mark/)
})

test('lcw usage outside a session shows dollars once a cap is stated or spend is on record, else the week as before', () => {
  const none = { home: tmp('home'), cwd: tmp('x') }
  assert.match(atNow(() => lcw(['usage'], none).out), /^week: unknown/)
  atNow(() => lcw(['cap', '5000'], none))
  assert.match(atNow(() => lcw(['usage'], none).out.trim()), /^last 7 days: \$0 spent .* of a \$5,000 cap\n.*\nmark: \$3,750 \(75%\) · ok$/)
  const spent = { home: tmp('home'), cwd: tmp('x') }
  payg(spent.home, 'other')
  assert.match(atNow(() => lcw(['usage'], spent).out), /^last 7 days: \$1,260 spent .*\(assumed\)/)
})

test('the mark and the cap are said as the talk examples show, and a share follows the cap while dollars stay', () => {
  const home = tmp('home')
  payg(home)
  const o = { home, cwd: tmp('x'), session: 's1' }
  const say = (...a) => atNow(() => lcw(a, o).out.trim())
  assert.equal(say('cap', '5000'), "Weekly cap $5,000. This session's mark is now $3,750 (75%).")
  assert.equal(say('mark', '5500usd'), 'This session runs up to $5,500, past your $5,000 weekly cap.')
  assert.deepEqual([sessionJson(home).markUsd, sessionJson(home).markPercent], [5500, undefined], 'dollars clear the share')
  assert.equal(say('cap', '6000'), "Weekly cap $6,000. This session's mark stays $5,500.")
  assert.equal(say('mark', '80%'), 'This session runs up to $4,800 (80% of $6,000).')
  assert.deepEqual([sessionJson(home).markUsd, sessionJson(home).markPercent], [undefined, 80], 'a share clears the dollars')
  assert.equal(say('cap', '$5,000'), "Weekly cap $5,000. This session's mark is now $4,000 (80%).")
  assert.equal(say('mark', '100'), 'This session runs up to your full weekly cap, $5,000.')
  assert.equal(say('mark', '$3,200'), 'This session runs up to $3,200.')
})

test('a dollar mark is refused on a subscription, with the reason, and changes nothing', () => {
  const home = tmp('home')
  fs.mkdirSync(`${home}/sessions`, { recursive: true })
  fs.writeFileSync(`${home}/sessions/s1.json`, JSON.stringify({ billing: 'subscription', markPercent: 60 }))
  const r = lcw(['mark', '$3000'], { home, cwd: tmp('x'), session: 's1' })
  assert.equal(r.code, 1)
  assert.equal(r.out.trim(), 'This account is on a subscription, so the mark is a share of the week.\nSay a percentage, such as “run up to 80%”.')
  assert.deepEqual(sessionJson(home), { billing: 'subscription', markPercent: 60 })
  assert.match(lcw(['mark', '80%'], { home, cwd: tmp('x'), session: 's1' }).out.trim(), /^mark 80%\nweek: unknown\nok$/, 'a share still works, as before')
})

test('a dollar mark is refused while billing is unclear, and changes nothing', () => {
  const home = tmp('home')
  fs.mkdirSync(`${home}/sessions`, { recursive: true })
  fs.writeFileSync(`${home}/sessions/s1.json`, JSON.stringify({ markPercent: 60 }))
  const r = lcw(['mark', '3000usd'], { home, cwd: tmp('x'), session: 's1' })
  assert.equal(r.code, 1)
  assert.match(r.out, /billing isn't known yet, so the mark is still a share of the week/)
  assert.deepEqual(sessionJson(home), { markPercent: 60 })
})

test('lcw mark takes the forms the notes give and refuses anything else', () => {
  const home = tmp('home')
  payg(home)
  const o = { home, cwd: tmp('x'), session: 's1' }
  for (const [args, usd] of [[['5500usd'], 5500], [['$5500'], 5500], [['5,500', 'USD'], 5500], [['2500.50usd'], 2500.5]]) {
    assert.equal(atNow(() => lcw(['mark', ...args], o)).code, 0, args.join(' '))
    assert.equal(sessionJson(home).markUsd, usd)
  }
  for (const bad of ['0usd', '5500', '0%', '101%', 'lots', '$']) {
    assert.equal(atNow(() => lcw(['mark', bad], o)).code, 1, bad)
  }
  assert.equal(lcw(['cap', 'lots'], o).code, 1)
  assert.equal(lcw(['cap', '0'], o).code, 1)
  assert.ok(!fs.existsSync(`${home}/cap.json`), 'a bad cap writes nothing')
})

test('a run at its dollar mark is lifted by raising the mark over the spend, or by resume', () => {
  const t = started('usd')
  payg(t.home)
  t.cli('stage', 'Build')
  fs.writeFileSync(`${t.home}/spend/s1.json`, JSON.stringify({ v: 1, base: 0, max: 3020, q: { [quarter(NOW - 3600000)]: 3020 } }))
  const gate = `${t.dir}/gate`
  const say = (...a) => atNow(() => t.cli(...a).out.trim())
  assert.match(say('usage'), /mark: \$3,000 \(75%\) · at the mark/)
  const g = readJson(gate)
  assert.deepEqual([g.unit, g.markUsd, g.usedUsd, g.retryAt], ['usd', 3000, 3020, new Date(2026, 5, 11, 8, 0).getTime()])
  t.cli('pause', 'mark')
  assert.equal(say('mark', '3010usd'), 'This session runs up to $3,010.\nat the mark', 'still over the new mark: it stays gated')
  assert.ok(fs.existsSync(gate))
  assert.equal(say('mark', '3400usd'), 'This session runs up to $3,400.')
  assert.ok(!fs.existsSync(gate), 'a mark above the spend lifts the dollar gate at once')
  say('mark', '3010usd')
  assert.ok(fs.existsSync(gate))
  say('resume')
  assert.ok(!fs.existsSync(gate), 'resume lifts it too')
})

/** A spend command set for home, with the reading it last gave. */
function withCommand(home, reading = {}) {
  const command = 'echo 1240'
  fs.writeFileSync(`${home}/spend-command.json`, JSON.stringify({ v: 1, command, setAt: NOW - 86400000 }))
  fs.writeFileSync(`${home}/spend-reading.json`, JSON.stringify({ v: 1, command, usd: 1240, at: NOW - 3 * 60000, fails: 0, failingSince: null, lastError: null, ...reading }))
}

test('lcw usage takes the week from a working spend command and names it', () => {
  const home = tmp('home')
  payg(home)
  withCommand(home)
  const o = { home, cwd: tmp('x'), session: 's1' }
  atNow(() => lcw(['cap', '4000'], o))
  const [week, today, mark] = atNow(() => lcw(['usage'], o).out.trim().split('\n'))
  assert.equal(week, 'last 7 days: $1,240 spent (from your spend command, 3 min ago) of a $4,000 cap')
  assert.match(today, /^today: \$85 by 10:00, a rate of \$204 a day · rolling 7d \$[\d,]+ (spare|short)$/)
  assert.equal(mark, 'mark: $3,000 (75%) · ok')
  withCommand(home, { usd: 3100 })
  assert.match(atNow(() => lcw(['usage'], o).out), /mark: \$3,000 \(75%\) · at the mark/, 'the command\'s figure is what reaches the mark')
})

test('lcw usage shows a failing spend command with the three figures adding up, and drops the pace', () => {
  const home = tmp('home')
  payg(home)
  const o = { home, cwd: tmp('x'), session: 's1' }
  atNow(() => lcw(['cap', '4000'], o))
  // the reading is 2h old, so 2 of its 168 hours have dropped out: 1239.6 * 166/168 is 1224.8, and LCW counted $85
  // since; the sum 1309.8 rounds to $1,310, and the parts shown add up to it
  withCommand(home, { usd: 1239.6, at: NOW - 2 * 3600000, fails: 3, failingSince: NOW - 35 * 60000, lastError: 'printed "401 Unauthorized"' })
  assert.equal(atNow(() => lcw(['usage'], o).out), [
    'last 7 days: $1,310 spent ($1,225 of the $1,240 from your spend command 2h ago, plus $85 LCW counted since) of a $4,000 cap',
    'spend command: failing since 09:25, it printed "401 Unauthorized"',
    'today: $85 by 10:00, a rate of $204 a day',
    'mark: $3,000 (75%) · ok', ''].join('\n'))
  withCommand(home, { usd: 1240, at: NOW - 2 * 3600000, fails: 3, failingSince: NOW - 2 * 86400000, lastError: 'printed nothing' })
  assert.match(atNow(() => lcw(['usage'], o).out), /\nspend command: failing since 8 Jun 10:00, it printed nothing\n/)
  withCommand(home, { usd: 1240, at: NOW - 2 * 3600000, fails: 2, failingSince: NOW - 35 * 60000, lastError: 'printed nothing' })
  assert.match(atNow(() => lcw(['usage'], o).out), /spent \(from your spend command, 2h ago\)/, 'two failures in a row is not failing yet')
})

test('lcw usage on a subscription ignores a spend command, and never runs it', () => {
  const home = tmp('home')
  const marker = `${tmp('marker')}/ran`
  fs.mkdirSync(`${home}/sessions`, { recursive: true })
  fs.writeFileSync(`${home}/sessions/sub.json`, JSON.stringify({ billing: 'subscription' }))
  fs.writeFileSync(`${home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: 42, resetsAt: null }, source: 'statusline' }))
  const command = `touch ${marker}; echo 1240`
  fs.writeFileSync(`${home}/spend-command.json`, JSON.stringify({ v: 1, command, setAt: NOW }))
  fs.writeFileSync(`${home}/spend-reading.json`, JSON.stringify({ v: 1, command, usd: 1240, at: NOW - 60000, fails: 0, failingSince: null, lastError: null }))
  const sub = atNow(() => lcw(['usage'], { home, cwd: tmp('x'), session: 'sub' }).out)
  assert.equal(sub, 'week: 42% used\nresets: unknown\nmark: 75%\nok\n')
  const noSession = atNow(() => lcw(['usage'], { home, cwd: tmp('x') }).out)
  assert.match(noSession, /^week: 42% used\nresets: unknown/, 'a reading makes no dollar view where there was none')
  payg(home)
  const seen = atNow(() => lcw(['usage'], { home, cwd: tmp('x'), session: 's1' }).out)
  atNow(() => lcw(['usage'], { home, cwd: tmp('x') }))
  assert.match(seen, /^last 7 days: \$1,240 spent \(from your spend command, 1 min ago\)/)
  assert.equal(fs.existsSync(marker), false, 'usage only reads the reading')
})

test('lcw usage outside a session takes the week from the spend command too', () => {
  const home = tmp('home')
  payg(home, 'other')
  withCommand(home)
  const o = { home, cwd: tmp('x') }
  atNow(() => lcw(['cap', '4000'], o))
  const week = atNow(() => lcw(['usage'], o).out.trim().split('\n')[0])
  assert.equal(week, 'last 7 days: $1,240 spent (from your spend command, 3 min ago) of a $4,000 cap')
})

test('lcw usage with no spend command set reads as it always did', () => {
  const home = tmp('home')
  payg(home)
  fs.writeFileSync(`${home}/spend-reading.json`, JSON.stringify({ v: 1, command: 'echo 1240', usd: 1240, at: NOW - 60000, fails: 0 }))
  const first = atNow(() => lcw(['usage'], { home, cwd: tmp('x'), session: 's1' }).out.split('\n')[0])
  assert.equal(first, 'last 7 days: $1,260 spent on this machine (estimate) of a $4,000 cap (assumed)', 'a reading without its command set is not used')
})
