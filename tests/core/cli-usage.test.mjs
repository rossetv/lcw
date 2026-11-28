import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, cli, readJson, begin } from './helpers.mjs'
import { wakeable } from '../../hooks/lcw-mod.mjs'

process.env.TZ = 'Europe/Dublin'
const NOW = new Date(2026, 5, 10, 10, 0).getTime() // June 10 2026, 10:00 local
const quarter = (ms) => Math.floor(ms / 900000)

/** One in-process call with the clock fixed at NOW, so "today" and 08:00 are the same on every machine. */
const at = (args, o) => cli(args, { ...o, env: { ...o.env, LCW_NOW: String(NOW) } })

/** A session billed per token, with $1,175 spent three days ago and $85 since midnight: $1,260 over the week. */
function payg(home, id = 's1') {
  fs.mkdirSync(`${home}/sessions`, { recursive: true })
  fs.mkdirSync(`${home}/spend`, { recursive: true })
  const file = `${home}/sessions/${id}.json`
  fs.writeFileSync(file, JSON.stringify({ ...(fs.existsSync(file) ? readJson(file) : {}), billing: 'payg' }))
  fs.writeFileSync(`${home}/spend/${id}.json`, JSON.stringify({ v: 1, base: 0, max: 1260, q: { [quarter(NOW - 3 * 86400000)]: 1175, [quarter(NOW - 3600000)]: 1260 } }))
}
const sessionJson = (home, id = 's1') => readJson(`${home}/sessions/${id}.json`)

const usageAt = (home, p, resetsAt = null) => fs.writeFileSync(`${home}/usage.json`, JSON.stringify({ at: 1, sevenDay: { percentUsed: p, resetsAt }, source: 'statusline' }))
const gateAt = (t, resetsAt) => fs.writeFileSync(`${t.dir}/gate`, JSON.stringify({ reason: 'mark', markPercent: 75, usedPercent: 80, resetsAt, at: 1 }))

test('finish copies totals.json and works out the share of the week', async () => {
  const u = await begin('two')
  await u.cli('set', 'weekAtStart=10')
  fs.writeFileSync(`${u.dir}/totals.json`, JSON.stringify({ agents: 31, tokens: 6200000 }))
  usageAt(u.home, 25)
  await u.cli('finish')
  assert.deepEqual(u.state().totals, { agents: 31, tokens: 6200000, sharePercent: 15 })
  const w = await begin('three')
  usageAt(w.home, 5)
  await w.cli('set', 'weekAtStart=40')
  await w.cli('finish')
  assert.deepEqual(w.state().totals, { agents: 0, tokens: 0, sharePercent: 0 })
})

test('the share of the week carries over a weekly reset', async () => {
  const t = await begin('reset')
  const week1 = '2099-01-08T00:00:00.000Z', week2 = '2099-01-15T00:00:00.000Z'
  usageAt(t.home, 40, week1)
  await t.cli('set', 'weekAtStart=40', 'weekResetsAt="' + week1 + '"', 'weekUsed=40')
  await t.cli('stage', 'Build')
  usageAt(t.home, 70, week1)
  await t.cli('pause', 'mark')
  assert.equal(t.state().weekUsed, 70)
  usageAt(t.home, 12, week2)
  await t.cli('resume')
  const s = t.state()
  assert.deepEqual([s.shareBefore, s.weekAtStart, s.weekResetsAt, s.weekUsed], [30, 0, week2, 12])
  usageAt(t.home, 20, week2)
  await t.cli('finish')
  assert.equal(t.state().totals.sharePercent, 50)
})

test('mark and gate, usage with and without a run', async () => {
  const t = await begin()
  const future = new Date(Date.now() + 86400000).toISOString()
  const noRun = { home: t.home, cwd: tmp('x'), session: 'nobody' }

  assert.match((await cli(['usage'], noRun)).out, /week: unknown/)
  usageAt(t.home, 80, future)
  const bare = await cli(['usage'], noRun)
  assert.equal(bare.code, 0)
  assert.match(bare.out, /week: 80% used/)
  assert.match(bare.out, /mark: 75%\nat the mark/, 'a session with no run has a mark of its own')

  assert.match((await t.cli('usage')).out, /mark: 75%\nat the mark/)
  const gate = readJson(`${t.dir}/gate`)
  assert.equal(gate.reason, 'mark')
  assert.equal(gate.usedPercent, 80)
  assert.equal(gate.resetsAt, future)

  await t.cli('mark', '90')
  assert.equal(t.state().markPercent, 90)
  assert.ok(!fs.existsSync(`${t.dir}/gate`))
  assert.match((await t.cli('usage')).out, /ok/)
  usageAt(t.home, 95, future)
  await t.cli('usage')
  assert.ok(fs.existsSync(`${t.dir}/gate`))
  usageAt(t.home, 10, future)
  assert.match((await t.cli('usage')).out, /ok/)
  assert.ok(!fs.existsSync(`${t.dir}/gate`))
  assert.equal((await t.cli('mark', '0')).code, 1)
  assert.equal((await t.cli('mark', '101')).code, 1)
})

test('usage reports a reset and leaves the expired gate; resume and mark remove it', async () => {
  const t = await begin('ex')
  const expire = () => gateAt(t, new Date(Date.now() - 1000).toISOString())
  expire()
  assert.match((await t.cli('usage')).out, /the limit has reset/)
  assert.ok(fs.existsSync(`${t.dir}/gate`))
  await t.cli('resume')
  assert.ok(!fs.existsSync(`${t.dir}/gate`))
  expire()
  await t.cli('mark', '90')
  assert.ok(!fs.existsSync(`${t.dir}/gate`))
})

test('usage with an expired gate on disk says at the mark when the new week is already there', async () => {
  const t = await begin('again')
  gateAt(t, new Date(Date.now() - 1000).toISOString())
  usageAt(t.home, 90, new Date(Date.now() + 86400000).toISOString())
  const r = await t.cli('usage')
  assert.match(r.out, /mark: 75%\nat the mark/)
  assert.doesNotMatch(r.out, /the limit has reset/)
})

test('no gate is written for a run the human paused; resume lets it be evaluated', async () => {
  const t = await begin()
  usageAt(t.home, 90, new Date(Date.now() + 1e8).toISOString())
  await t.cli('stage', 'Spec')
  await t.cli('pause', 'human')
  const paused = fs.readFileSync(`${t.dir}/state.json`, 'utf8')
  const ledger = fs.readFileSync(`${t.dir}/ledger.md`, 'utf8')
  assert.match((await t.cli('usage')).out, /week: 90% used[\s\S]*mark: 75%\nat the mark/)
  assert.equal(fs.readFileSync(`${t.dir}/state.json`, 'utf8'), paused)
  assert.equal(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), ledger)
  assert.equal(t.state().status, 'paused')
  assert.equal(t.state().pausedReason, 'human')
  assert.equal(wakeable(t.state()), false)
  assert.ok(!fs.existsSync(`${t.dir}/gate`))
  await t.cli('resume')
  await t.cli('usage')
  assert.ok(fs.existsSync(`${t.dir}/gate`))
})

test('a mark set with no run belongs to that session alone, and a run started there begins with it', async () => {
  const home = tmp('home')
  const repo = makeRepo()
  const a = { home, cwd: repo, session: 'a' }
  const b = { home, cwd: repo, session: 'b' }
  assert.match((await cli(['mark', '85'], a)).out, /mark 85%\nweek: unknown\nok/)
  assert.match((await cli(['usage'], a)).out, /mark: 85%/)
  assert.match((await cli(['usage'], b)).out, /mark: 75%/)
  const dirA = /^folder: (.+)$/m.exec((await cli(['start', 'in-a', '--title', 'A'], a)).out)[1]
  assert.equal(readJson(`${dirA}/state.json`).markPercent, 85)
  assert.equal(readJson(`${home}/sessions/a.json`).markPercent, 85, 'binding the session to its run keeps its mark')
  const dirB = /^folder: (.+)$/m.exec((await cli(['start', 'in-b', '--title', 'B'], b)).out)[1]
  assert.equal(readJson(`${dirB}/state.json`).markPercent, 75)
})

test('setting a mark says how much of the week is used, so a mark already passed shows at once', async () => {
  const home = tmp('home')
  usageAt(home, 42)
  assert.match((await cli(['mark', '20'], { home, cwd: tmp('x'), session: 'solo' })).out, /mark 20%\nweek: 42% used\nat the mark/)
  assert.match((await (await begin()).cli('mark', '90')).out, /mark 90%\nweek: unknown\nok/, 'and the same with a run')
})

test('mark says at the mark for a run the human paused when the week is already over it', async () => {
  const t = await begin()
  usageAt(t.home, 70, new Date(Date.now() + 1e8).toISOString())
  await t.cli('stage', 'Spec')
  await t.cli('pause', 'human')
  assert.match((await t.cli('mark', '60')).out, /at the mark/)
  assert.doesNotMatch((await t.cli('mark', '80')).out, /at the mark/)
})

test("a mark is one session's: another session that takes the run over brings its own", async () => {
  const t = await begin('grant')
  await t.cli('mark', '90')
  const wt = (await t.cli('worktree')).out.trim()
  const later = { home: t.home, cwd: wt, session: 'later' }
  assert.equal((await cli(['set', 'health=carrying on'], later)).code, 0)
  assert.equal(t.state().markPercent, 75)
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /another session took over/)
  await t.cli('set', 'health=back')
  assert.equal(t.state().markPercent, 90, 'the first session brings its 90 back with it')
})

test('lcw usage on pay-per-token billing prints the week, today with its pace, and the mark', async () => {
  const home = tmp('home')
  payg(home)
  const o = { home, cwd: tmp('x'), session: 's1' }
  const [week, today, mark] = (await at(['usage'], o)).out.trim().split('\n')
  assert.match(week, /\$1,260.*estimate.*\$4,000.*assumed/)
  assert.match(today, /^today: \$85 by 10:00, a rate of \$204 a day · rolling 7d \$[\d,]+ (spare|short)$/)
  assert.match(mark, /\$3,000.*75%.*\bok\b/)
  await at(['cap', '5,000 USD'], o)
  assert.match((await at(['usage'], o)).out, /of a \$5,000 cap\n.*\nmark: \$3,750 \(75%\) · ok/, 'a stated cap is no longer assumed, and the share mark follows it')
  fs.writeFileSync(`${home}/spend/s1.json`, JSON.stringify({ v: 1, base: 0, max: 4000, q: { [quarter(NOW - 3600000)]: 4000 } }))
  assert.match((await at(['usage'], o)).out, /mark: \$3,750 \(75%\) · at the mark/)
})

test('lcw usage outside a session shows dollars once a cap is stated or spend is on record, else the week as before', async () => {
  const none = { home: tmp('home'), cwd: tmp('x') }
  assert.match((await at(['usage'], none)).out, /^week: unknown/)
  await at(['cap', '5000'], none)
  assert.match((await at(['usage'], none)).out.trim(), /^last 7 days: \$0 spent .* of a \$5,000 cap\n.*\nmark: \$3,750 \(75%\) · ok$/)
  const spent = { home: tmp('home'), cwd: tmp('x') }
  payg(spent.home, 'other')
  assert.match((await at(['usage'], spent)).out, /^last 7 days: \$1,260 spent .*\(assumed\)/)
})

test('a cap and a mark move together: a share follows the cap, dollars stay, and each clears the other', async () => {
  const home = tmp('home')
  payg(home)
  const o = { home, cwd: tmp('x'), session: 's1' }
  const say = async (...a) => (await at(a, o)).out
  const marks = () => [sessionJson(home).markUsd, sessionJson(home).markPercent]
  assert.match(await say('cap', '5000'), /\$5,000.*\$3,750 \(75%\)/s)
  assert.match(await say('mark', '5500usd'), /\$5,500.*past your \$5,000/s)
  assert.deepEqual(marks(), [5500, undefined], 'dollars clear the share')
  assert.match(await say('cap', '6000'), /\$6,000.*stays \$5,500/s)
  assert.match(await say('mark', '80%'), /\$4,800 \(80% of \$6,000\)/)
  assert.deepEqual(marks(), [undefined, 80], 'a share clears the dollars')
  assert.match(await say('cap', '$5,000'), /\$5,000.*\$4,000 \(80%\)/s)
  assert.match(await say('mark', '100'), /full weekly cap, \$5,000/)
  assert.match(await say('mark', '$3,200'), /runs up to \$3,200\./)
  assert.deepEqual(marks(), [3200, undefined])
})

test('a dollar mark is refused unless billing is per token, with the reason, and changes nothing', async () => {
  for (const [session, reason] of [[{ billing: 'subscription', markPercent: 60 }, /subscription/], [{ markPercent: 60 }, /isn't known yet/]]) {
    const home = tmp('home')
    fs.mkdirSync(`${home}/sessions`, { recursive: true })
    fs.writeFileSync(`${home}/sessions/s1.json`, JSON.stringify(session))
    const o = { home, cwd: tmp('x'), session: 's1' }
    for (const form of ['$3000', '3000usd']) {
      const r = await cli(['mark', form], o)
      assert.equal(r.code, 1, form)
      assert.match(r.out, reason, form)
      assert.match(r.out, /percentage|share of the week/, form)
      assert.deepEqual(sessionJson(home), session, `${form} changes nothing`)
    }
    assert.match((await cli(['mark', '80%'], o)).out.trim(), /^mark 80%\nweek: unknown\nok$/, 'a share still works')
  }
})

test('lcw mark takes the forms the notes give and refuses anything else', async () => {
  const home = tmp('home')
  payg(home)
  const o = { home, cwd: tmp('x'), session: 's1' }
  for (const [args, usd] of [[['5500usd'], 5500], [['$5500'], 5500], [['5,500', 'USD'], 5500], [['2500.50usd'], 2500.5]]) {
    assert.equal((await at(['mark', ...args], o)).code, 0, args.join(' '))
    assert.equal(sessionJson(home).markUsd, usd)
  }
  for (const bad of ['0usd', '5500', '0%', '101%', 'lots', '$']) {
    assert.equal((await at(['mark', bad], o)).code, 1, bad)
  }
  assert.equal((await cli(['cap', 'lots'], o)).code, 1)
  assert.equal((await cli(['cap', '0'], o)).code, 1)
  assert.ok(!fs.existsSync(`${home}/cap.json`), 'a bad cap writes nothing')
})

test('a run at its dollar mark is lifted by raising the mark over the spend, or by resume', async () => {
  const t = await begin('usd')
  payg(t.home)
  await t.cli('stage', 'Build')
  fs.writeFileSync(`${t.home}/spend/s1.json`, JSON.stringify({ v: 1, base: 0, max: 3020, q: { [quarter(NOW - 3600000)]: 3020 } }))
  const gate = `${t.dir}/gate`
  const say = async (...a) => (await cli(a, { ...t.o, env: { LCW_NOW: String(NOW) } })).out.trim()
  assert.match(await say('usage'), /mark: \$3,000 \(75%\) · at the mark/)
  const g = readJson(gate)
  assert.deepEqual([g.unit, g.markUsd, g.usedUsd, g.retryAt], ['usd', 3000, 3020, new Date(2026, 5, 11, 8, 0).getTime()])
  await t.cli('pause', 'mark')
  assert.match(await say('mark', '3010usd'), /\$3,010\.\nat the mark/, 'still over the new mark: it stays gated')
  assert.ok(fs.existsSync(gate))
  const lifted = await cli(['mark', '3400usd'], { ...t.o, env: { LCW_NOW: String(NOW) } })
  assert.equal(lifted.code, 0)
  assert.match(lifted.out, /\$3,400/)
  assert.doesNotMatch(lifted.out, /at the mark/)
  assert.ok(!fs.existsSync(gate), 'a mark above the spend lifts the dollar gate at once')
  await say('mark', '3010usd')
  assert.ok(fs.existsSync(gate))
  await say('resume')
  assert.ok(!fs.existsSync(gate), 'resume lifts it too')
})

/** A spend command set for home, with the reading it last gave. */
function withCommand(home, reading = {}) {
  const command = 'echo 1240'
  fs.writeFileSync(`${home}/spend-command.json`, JSON.stringify({ v: 1, command, setAt: NOW - 86400000 }))
  fs.writeFileSync(`${home}/spend-reading.json`, JSON.stringify({ v: 1, command, usd: 1240, at: NOW - 3 * 60000, fails: 0, failingSince: null, lastError: null, ...reading }))
}

test('lcw usage takes the week from a working spend command and names it', async () => {
  const home = tmp('home')
  payg(home)
  withCommand(home)
  const o = { home, cwd: tmp('x'), session: 's1' }
  await at(['cap', '4000'], o)
  const [, today, mark] = (await at(['usage'], o)).out.trim().split('\n')
  assert.match(today, /^today: \$85 by 10:00, a rate of \$204 a day · rolling 7d \$[\d,]+ (spare|short)$/)
  assert.match(mark, /\$3,000.*75%.*\bok\b/)
  withCommand(home, { usd: 3100 })
  assert.match((await at(['usage'], o)).out, /mark: \$3,000 \(75%\) · at the mark/, 'the command\'s figure is what reaches the mark')
})

test('lcw usage shows a failing spend command with the three figures adding up, and drops the pace', async () => {
  const home = tmp('home')
  payg(home)
  const o = { home, cwd: tmp('x'), session: 's1' }
  await at(['cap', '4000'], o)
  // the reading is 2h old, so 2 of its 168 hours have dropped out: 1239.6 * 166/168 is 1224.8, and LCW counted $85
  // since; the sum 1309.8 rounds to $1,310, and the parts shown add up to it
  withCommand(home, { usd: 1239.6, at: NOW - 2 * 3600000, fails: 3, failingSince: NOW - 35 * 60000, lastError: 'printed "401 Unauthorized"' })
  const [week, failing, today, mark, ...rest] = (await at(['usage'], o)).out.trim().split('\n')
  assert.match(week, /^last 7 days: \$1,310 spent .*\$1,225 of the \$1,240 .* 2h ago.*\$85 LCW counted since.* \$4,000 cap$/)
  assert.match(failing, /^spend command: failing since 09:25, .*401 Unauthorized/)
  assert.match(today, /^today: \$85 by 10:00, a rate of \$204 a day$/, 'no rolling pace while the command fails')
  assert.match(mark, /\$3,000.*75%.*\bok\b/)
  assert.deepEqual(rest, [])
  withCommand(home, { usd: 1240, at: NOW - 2 * 3600000, fails: 3, failingSince: NOW - 2 * 86400000, lastError: 'printed nothing' })
  assert.match((await at(['usage'], o)).out, /\nspend command: failing since 8 Jun 10:00, it printed nothing\n/)
  withCommand(home, { usd: 1240, at: NOW - 2 * 3600000, fails: 2, failingSince: NOW - 35 * 60000, lastError: 'printed nothing' })
  assert.match((await at(['usage'], o)).out, /spent \(from your spend command, 2h ago\)/, 'two failures in a row is not failing yet')
})

test('lcw usage on a subscription ignores a spend command, and never runs it', async () => {
  const home = tmp('home')
  const marker = `${tmp('marker')}/ran`
  fs.mkdirSync(`${home}/sessions`, { recursive: true })
  fs.writeFileSync(`${home}/sessions/sub.json`, JSON.stringify({ billing: 'subscription' }))
  usageAt(home, 42)
  const command = `touch ${marker}; echo 1240`
  fs.writeFileSync(`${home}/spend-command.json`, JSON.stringify({ v: 1, command, setAt: NOW }))
  fs.writeFileSync(`${home}/spend-reading.json`, JSON.stringify({ v: 1, command, usd: 1240, at: NOW - 60000, fails: 0, failingSince: null, lastError: null }))
  const sub = (await at(['usage'], { home, cwd: tmp('x'), session: 'sub' })).out
  assert.match(sub, /^week: 42% used\n/)
  assert.match(sub, /\nmark: 75%\nok\n$/)
  assert.doesNotMatch(sub, /\$/, 'no dollars on a subscription')
  const noSession = (await at(['usage'], { home, cwd: tmp('x') })).out
  assert.match(noSession, /^week: 42% used\nresets: unknown/, 'a reading makes no dollar view where there was none')
  payg(home)
  const seen = (await at(['usage'], { home, cwd: tmp('x'), session: 's1' })).out
  await at(['usage'], { home, cwd: tmp('x') })
  assert.match(seen, /^last 7 days: \$1,240 spent \(from your spend command, 1 min ago\)/)
  assert.equal(fs.existsSync(marker), false, 'usage only reads the reading')
})

test("the week's first line takes its figure from the spend command when one is set, in a session or not, and not when only a reading is left", async () => {
  for (const [name, session, withCmd, cap, line] of [
    ['a session', 's1', true, '4000', /^last 7 days: \$1,240 spent \(from your spend command, 3 min ago\) of a \$4,000 cap$/],
    ['no session', undefined, true, '4000', /^last 7 days: \$1,240 spent \(from your spend command, 3 min ago\) of a \$4,000 cap$/],
    ['a reading without its command', 's1', false, undefined, /\$1,260.*estimate.*\$4,000.*assumed/],
  ]) {
    const home = tmp('home')
    payg(home, session || 'other')
    if (withCmd) withCommand(home)
    else fs.writeFileSync(`${home}/spend-reading.json`, JSON.stringify({ v: 1, command: 'echo 1240', usd: 1240, at: NOW - 60000, fails: 0 }))
    const o = { home, cwd: tmp('x'), session }
    if (cap) await at(['cap', cap], o)
    assert.match((await at(['usage'], o)).out.split('\n')[0], line, name)
  }
})
