import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, lcw, readJson } from './helpers.mjs'
import { sweep, hunting } from './sweep-kit.mjs'

test('a sweep starts in Charter with the person, with its own records and no brainstorm or spec', () => {
  const t = sweep()
  const s = t.state()
  assert.equal(t.started.code, 0, t.started.out)
  assert.deepEqual([s.shape, s.stage, s.status], ['sweep', 'Charter', 'with-you'])
  assert.deepEqual(s.sweep, { prs: null, charter: 0, open: 0, approvedAt: null, round: 0, hunt: { areas: 0, hunted: 0, running: 0, findings: 0, fix: 0, park: 0, drop: 0 }, fixed: 0, parked: 0, dropped: 0, waves: [] })
  for (const f of ['charter.md', 'findings.md', 'parked.md', 'ledger.md', 'artifacts']) {
    assert.ok(fs.existsSync(`${t.dir}/${f}`), f)
    assert.ok(t.started.out.includes(`${t.dir}/${f}`), f)
  }
  for (const f of ['brainstorm.md', 'spec.md']) assert.ok(!fs.existsSync(`${t.dir}/${f}`), f)
})

test('start refuses a shape that is neither build nor sweep, and a run with no shape is a build', () => {
  const home = tmp('home')
  const o = { home, cwd: makeRepo(), session: 's1' }
  assert.equal(lcw(['start', 'x', '--title', 'X', '--shape', 'sprint'], o).code, 1)
  assert.equal(lcw(['runs'], o).out.trim(), 'no runs')
  const dir = /^folder: (.+)$/m.exec(lcw(['start', 'x', '--title', 'X'], o).out)[1]
  const s = readJson(`${dir}/state.json`)
  assert.deepEqual([s.shape, s.sweep, s.stage], [undefined, undefined, 'Brainstorm'])
})

test('each shape takes only its own stages', () => {
  const t = sweep()
  for (const stage of ['Brainstorm', 'Spec']) assert.equal(t.cli('stage', stage).code, 1, stage)
  assert.equal(t.cli('stage', 'Plan').code, 0)
  const b = { home: t.home, cwd: makeRepo(), session: 'b1' }
  lcw(['start', 'b', '--title', 'B'], b)
  for (const stage of ['Charter', 'Hunt']) assert.equal(lcw(['stage', stage], b).code, 1, stage)
})

test('Hunt is refused until the charter was put to the person in Charter and written down', () => {
  const t = sweep()
  assert.equal(t.cli('approval').code, 0)
  assert.ok(Number.isFinite(t.state().sweep.approvedAt))
  assert.equal(t.cli('stage', 'Hunt').code, 1, 'charter.md is still empty')
  assert.equal(t.state().stage, 'Charter')

  const u = sweep('other')
  fs.writeFileSync(`${u.dir}/charter.md`, 'goals: fix the backlog\n')
  assert.equal(u.cli('stage', 'Hunt').code, 1, 'no approval asked')
  assert.equal(u.state().stage, 'Charter')
  u.cli('approval')
  assert.equal(u.cli('stage', 'Hunt').code, 0)
  assert.deepEqual([u.state().stage, u.state().status], ['Hunt', 'running'])
})

test('approval is the Charter\'s question in a sweep and is refused in its other stages', () => {
  const t = hunting()
  assert.equal(t.cli('approval').code, 1)
  assert.equal(t.cli('stage', 'Charter').code, 0)
  assert.equal(t.state().status, 'with-you')
  t.cli('pause')
  t.cli('resume')
  assert.equal(t.state().status, 'with-you', 'resumed in Charter, the sweep is back with the person')
})

test('entering Hunt starts a new round with fresh counts, and a repeat in Hunt changes nothing', () => {
  const t = hunting()
  t.cli('hunt', '--areas', '4', '--hunted', '2')
  assert.equal(t.cli('stage', 'Hunt').code, 0)
  assert.equal(t.state().sweep.round, 1)
  assert.equal(t.state().sweep.hunt.areas, 4, 'the repeat did not reset the round')
  t.cli('stage', 'Ship')
  t.cli('stage', 'Hunt')
  assert.equal(t.state().sweep.round, 2)
  assert.equal(t.state().sweep.hunt.areas, 0)
})

test('set takes the charter\'s settings within their ranges and nothing else of the sweep', () => {
  const t = sweep()
  assert.equal(t.cli('set', 'sweep.charter=4', 'sweep.open=1', 'sweep.prs=merged').code, 0)
  assert.deepEqual([t.state().sweep.charter, t.state().sweep.open, t.state().sweep.prs], [4, 1, 'merged'])
  for (const pair of ['sweep.prs=squash', 'sweep.charter=11', 'sweep.charter=-1', 'sweep.open=two', 'sweep.round=5', 'sweep.waves=[]', 'sweep={}', 'shape=build']) {
    assert.equal(t.cli('set', pair).code, 1, pair)
  }
  assert.deepEqual([t.state().sweep.charter, t.state().sweep.prs, t.state().sweep.round, t.state().shape], [4, 'merged', 0, 'sweep'])
  const b = { home: t.home, cwd: makeRepo(), session: 'b1' }
  const dir = /^folder: (.+)$/m.exec(lcw(['start', 'b', '--title', 'B'], b).out)[1]
  assert.equal(lcw(['set', 'sweep.prs=merged'], b).code, 1)
  assert.equal(readJson(`${dir}/state.json`).sweep, undefined)
})

test('hunt records progress and sorting; park and drop add to the totals once, however often they are repeated', () => {
  const t = hunting()
  assert.equal(t.cli('hunt', '--areas', '5', '--hunted', '1', '--running', '3', '--findings', '2').code, 0)
  t.cli('hunt', '--fix', '6', '--park', '2', '--drop', '1')
  t.cli('hunt', '--fix', '6', '--park', '2', '--drop', '1')
  t.cli('hunt', '--park', '3')
  const s = t.state().sweep
  assert.deepEqual(s.hunt, { areas: 5, hunted: 1, running: 3, findings: 2, fix: 6, park: 3, drop: 1 })
  assert.deepEqual([s.parked, s.dropped], [3, 1])
  t.cli('stage', 'Ship')
  t.cli('stage', 'Hunt')
  t.cli('hunt', '--park', '1')
  assert.deepEqual([t.state().sweep.parked, t.state().sweep.dropped], [4, 1], 'a new round adds to what the last one parked')
  assert.equal(t.cli('hunt', '--fix', 'many').code, 1)
})

test('hunt records a round\'s park and drop after a wave has started and moved the sweep on, and nothing before the first round', () => {
  const fresh = sweep()
  fresh.cli('stage', 'Plan')
  assert.equal(fresh.cli('hunt', '--park', '1').code, 1, 'no round has begun')
  assert.equal(fresh.state().sweep.parked, 0)
  const t = hunting()
  t.cli('wave', 'add', '1')
  t.start()
  assert.equal(t.state().stage, 'Plan')
  const r = t.cli('hunt', '--park', '2', '--drop', '1')
  assert.equal(r.code, 0, r.out)
  assert.deepEqual([t.state().sweep.parked, t.state().sweep.dropped], [2, 1])
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /hunt, round 1: park 2, drop 1/)
})

test('hunt, wave and merge are refused in a build', () => {
  const o = { home: tmp('home'), cwd: makeRepo(), session: 'b1' }
  lcw(['start', 'b', '--title', 'B'], o)
  for (const a of [['hunt', '--fix', '1'], ['wave', 'add', '2'], ['merge', '1'], ['task', 'add', 'T1', 'x']]) lcw(a, o)
  for (const a of [['hunt', '--fix', '1'], ['wave', 'add', '2'], ['merge', '1'], ['task', 'T1', 'dropped'], ['stop', '--pr', 'https://github.com/a/b/pull/1']]) {
    assert.equal(lcw(a, o).code, 1, a.join(' '))
  }
})

test('wave add queues a wave for each number, and a repeat while they wait is refused', () => {
  const t = hunting()
  assert.equal(t.cli('wave', 'add', '3', '2').code, 0)
  assert.equal(t.cli('wave', 'add', '3', '2').code, 1)
  assert.equal(t.cli('wave', 'add', '0').code, 1)
  assert.deepEqual(t.state().sweep.waves, [
    { n: 1, fixes: 3, status: 'queued', branch: null, pr: null, merged: false, dropped: 0 },
    { n: 2, fixes: 2, status: 'queued', branch: null, pr: null, merged: false, dropped: 0 },
  ])
})

test('a fix found while a wave is queued joins it: the refusal says so, and once the wave has started the rest are queued and its own fix that waits joins them', () => {
  const t = hunting()
  t.cli('wave', 'add', '1')
  const refused = t.cli('wave', 'add', '2')
  assert.equal(refused.code, 1)
  assert.match(refused.out + refused.err, /Wave 1 is already queued.*joins wave 1 in findings\.md.*lcw wave start.*lcw wave add queues the rest/s)
  t.start()
  for (const id of ['F2', 'F3']) t.cli('req', 'add', id, `fix ${id}`)
  assert.equal(t.cli('wave', 'add', '4').code, 0)
  assert.equal(t.cli('wave', 'defer', '1', '--wave', '1').code, 0)
  const out = t.cli('status').out
  assert.match(out, /^ {2}1 \[running\] 2 fixes /m)
  assert.match(out, /^ {2}2 \[queued\] 5 fixes /m)
})

test('wave add queues more waves while waves are open, as long as none is queued', () => {
  const t = hunting()
  t.cli('wave', 'add', '1')
  t.start()
  assert.equal(t.cli('wave', 'add', '2').code, 0)
  assert.deepEqual(t.state().sweep.waves.map((w) => w.status), ['running', 'queued'])
})

test('wave add given the number of the wave it makes, from wave 10 on, queues it with 1 fix and says why', () => {
  const t = hunting()
  t.edit((s) => { s.sweep.waves = Array.from({ length: 11 }, (_, i) => ({ n: i + 1, fixes: 1, status: 'shipped', branch: null, pr: null, merged: false, dropped: 0 })) })
  const r = t.cli('wave', 'add', '12')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /takes how many fixes each wave holds, not its number, so wave 12 is queued with 1 fix/)
  assert.equal(t.state().sweep.waves[11].fixes, 1)
  t.edit((s) => { s.sweep.waves[11].status = 'shipped' })
  assert.equal(t.cli('wave', 'add', '7').code, 0)
  assert.equal(t.state().sweep.waves[12].fixes, 7, 'any other count stands')
})
