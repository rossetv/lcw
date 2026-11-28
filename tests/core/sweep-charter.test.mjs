import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, cli, readJson } from './helpers.mjs'
import { sweep, hunting } from './sweep-kit.mjs'

test('a sweep starts in Charter with the person, with its own records and no brainstorm or spec', async () => {
  const t = await sweep()
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

test('start refuses a shape that is neither build nor sweep, and a run with no shape is a build', async () => {
  const home = tmp('home')
  const o = { home, cwd: makeRepo(), session: 's1' }
  assert.equal((await cli(['start', 'x', '--title', 'X', '--shape', 'sprint'], o)).code, 1)
  assert.equal((await cli(['runs'], o)).out.trim(), 'no runs')
  const dir = /^folder: (.+)$/m.exec((await cli(['start', 'x', '--title', 'X'], o)).out)[1]
  const s = readJson(`${dir}/state.json`)
  assert.deepEqual([s.shape, s.sweep, s.stage], [undefined, undefined, 'Brainstorm'])
})

test('each shape takes only its own stages', async () => {
  const t = await sweep()
  for (const stage of ['Brainstorm', 'Spec']) assert.equal((await t.cli('stage', stage)).code, 1, stage)
  assert.equal((await t.cli('stage', 'Plan')).code, 0)
  const b = { home: t.home, cwd: makeRepo(), session: 'b1' }
  await cli(['start', 'b', '--title', 'B'], b)
  for (const stage of ['Charter', 'Hunt']) assert.equal((await cli(['stage', stage], b)).code, 1, stage)
})

test('Hunt is refused until the charter was put to the person in Charter and written down', async () => {
  const t = await sweep()
  assert.equal((await t.cli('approval')).code, 0)
  assert.ok(Number.isFinite(t.state().sweep.approvedAt))
  assert.equal((await t.cli('stage', 'Hunt')).code, 1, 'charter.md is still empty')
  assert.equal(t.state().stage, 'Charter')

  const u = await sweep('other')
  fs.writeFileSync(`${u.dir}/charter.md`, 'goals: fix the backlog\n')
  assert.equal((await u.cli('stage', 'Hunt')).code, 1, 'no approval asked')
  assert.equal(u.state().stage, 'Charter')
  await u.cli('approval')
  assert.equal((await u.cli('stage', 'Hunt')).code, 0)
  assert.deepEqual([u.state().stage, u.state().status], ['Hunt', 'running'])
})

test('approval is the Charter\'s question in a sweep and is refused in its other stages', async () => {
  const t = await hunting()
  assert.equal((await t.cli('approval')).code, 1)
  assert.equal((await t.cli('stage', 'Charter')).code, 0)
  assert.equal(t.state().status, 'with-you')
  await t.cli('pause')
  await t.cli('resume')
  assert.equal(t.state().status, 'with-you', 'resumed in Charter, the sweep is back with the person')
})

test('entering Hunt starts a new round with fresh counts, and a repeat in Hunt changes nothing', async () => {
  const t = await hunting()
  await t.cli('hunt', '--areas', '4', '--hunted', '2')
  assert.equal((await t.cli('stage', 'Hunt')).code, 0)
  assert.equal(t.state().sweep.round, 1)
  assert.equal(t.state().sweep.hunt.areas, 4, 'the repeat did not reset the round')
  await t.cli('stage', 'Ship')
  await t.cli('stage', 'Hunt')
  assert.equal(t.state().sweep.round, 2)
  assert.equal(t.state().sweep.hunt.areas, 0)
})

test('set takes the charter\'s settings within their ranges and nothing else of the sweep', async () => {
  const t = await sweep()
  assert.equal((await t.cli('set', 'sweep.charter=4', 'sweep.open=1', 'sweep.prs=merged')).code, 0)
  assert.deepEqual([t.state().sweep.charter, t.state().sweep.open, t.state().sweep.prs], [4, 1, 'merged'])
  for (const pair of ['sweep.prs=squash', 'sweep.charter=11', 'sweep.charter=-1', 'sweep.open=two', 'sweep.round=5', 'sweep.waves=[]', 'sweep={}', 'shape=build']) {
    assert.equal((await t.cli('set', pair)).code, 1, pair)
  }
  assert.deepEqual([t.state().sweep.charter, t.state().sweep.prs, t.state().sweep.round, t.state().shape], [4, 'merged', 0, 'sweep'])
  const b = { home: t.home, cwd: makeRepo(), session: 'b1' }
  const dir = /^folder: (.+)$/m.exec((await cli(['start', 'b', '--title', 'B'], b)).out)[1]
  assert.equal((await cli(['set', 'sweep.prs=merged'], b)).code, 1)
  assert.equal(readJson(`${dir}/state.json`).sweep, undefined)
})

test('hunt records progress and sorting; park and drop add to the totals once, however often they are repeated', async () => {
  const t = await hunting()
  assert.equal((await t.cli('hunt', '--areas', '5', '--hunted', '1', '--running', '3', '--findings', '2')).code, 0)
  await t.cli('hunt', '--fix', '6', '--park', '2', '--drop', '1')
  await t.cli('hunt', '--fix', '6', '--park', '2', '--drop', '1')
  await t.cli('hunt', '--park', '3')
  const s = t.state().sweep
  assert.deepEqual(s.hunt, { areas: 5, hunted: 1, running: 3, findings: 2, fix: 6, park: 3, drop: 1 })
  assert.deepEqual([s.parked, s.dropped], [3, 1])
  const ledger = fs.readFileSync(`${t.dir}/ledger.md`, 'utf8')
  assert.match(ledger, /hunt, round 1: fix 6, park 2, drop 1/)
  await t.cli('stage', 'Ship')
  await t.cli('stage', 'Hunt')
  await t.cli('hunt', '--park', '1')
  assert.deepEqual([t.state().sweep.parked, t.state().sweep.dropped], [4, 1], 'a new round adds to what the last one parked')
  assert.equal((await t.cli('hunt', '--fix', 'many')).code, 1)
})

test('hunt records a round\'s park and drop after a wave has started and moved the sweep on, and nothing before the first round', async () => {
  const fresh = await sweep()
  await fresh.cli('stage', 'Plan')
  assert.equal((await fresh.cli('hunt', '--park', '1')).code, 1, 'no round has begun')
  assert.equal(fresh.state().sweep.parked, 0)
  const t = await hunting()
  await t.cli('wave', 'add', '1')
  await t.start()
  assert.equal(t.state().stage, 'Plan')
  const r = await t.cli('hunt', '--park', '2', '--drop', '1')
  assert.equal(r.code, 0, r.out)
  assert.deepEqual([t.state().sweep.parked, t.state().sweep.dropped], [2, 1])
  assert.deepEqual([t.state().sweep.hunt.park, t.state().sweep.hunt.drop], [2, 1])
  assert.match(fs.readFileSync(`${t.dir}/ledger.md`, 'utf8'), /hunt, round 1.*park 2.*drop 1/, 'the round\'s line carries both counts')
})

test('sweep-only commands are refused in a build', async () => {
  const o = { home: tmp('home'), cwd: makeRepo(), session: 'b1' }
  const started = await cli(['start', 'b', '--title', 'B'], o)
  const state = `${/^folder: (.+)$/m.exec(started.out)[1]}/state.json`
  for (const a of [['task', 'add', 'T1', 'x'], ['req', 'add', 'R1', 'one']]) await cli(a, o)
  const before = fs.readFileSync(state, 'utf8')
  for (const a of [['hunt', '--fix', '1'], ['wave', 'add', '2'], ['merge', '1'], ['task', 'T1', 'dropped'], ['req', 'R1', 'partial'], ['stop', '--pr', 'https://github.com/a/b/pull/1']]) {
    assert.equal((await cli(a, o)).code, 1, a.join(' '))
  }
  assert.equal(fs.readFileSync(state, 'utf8'), before, 'the refusals changed nothing')
})

test('wave add queues a wave for each number, and a repeat while they wait is refused', async () => {
  const t = await hunting()
  assert.equal((await t.cli('wave', 'add', '3', '2')).code, 0)
  assert.equal((await t.cli('wave', 'add', '3', '2')).code, 1)
  assert.equal((await t.cli('wave', 'add', '0')).code, 1)
  assert.deepEqual(t.state().sweep.waves, [
    { n: 1, fixes: 3, status: 'queued', branch: null, pr: null, merged: false, dropped: 0 },
    { n: 2, fixes: 2, status: 'queued', branch: null, pr: null, merged: false, dropped: 0 },
  ])
})

test('a fix found while a wave is queued joins it: more waves are refused, and once the wave has started the rest are queued and its own fix that waits joins them', async () => {
  const t = await hunting()
  await t.cli('wave', 'add', '1')
  const refused = await t.cli('wave', 'add', '2')
  assert.equal(refused.code, 1)
  assert.equal(t.state().sweep.waves.length, 1)
  await t.start()
  for (const id of ['F2', 'F3']) await t.cli('req', 'add', id, `fix ${id}`)
  assert.equal((await t.cli('wave', 'add', '4')).code, 0)
  assert.equal((await t.cli('wave', 'defer', '1', '--wave', '1')).code, 0)
  const out = (await t.cli('status')).out
  assert.match(out, /^ {2}1 \[running\] 2 fixes /m)
  assert.match(out, /^ {2}2 \[queued\] 5 fixes /m)
})

test('wave add given the number of the wave it makes, from wave 10 on, queues it with 1 fix', async () => {
  const t = await hunting()
  t.edit((s) => { s.sweep.waves = Array.from({ length: 11 }, (_, i) => ({ n: i + 1, fixes: 1, status: 'shipped', branch: null, pr: null, merged: false, dropped: 0 })) })
  const r = await t.cli('wave', 'add', '12')
  assert.equal(r.code, 0, r.out)
  assert.equal(t.state().sweep.waves[11].fixes, 1)
  assert.match(r.out, /wave 12 is queued with 1 fix/)
  t.edit((s) => { s.sweep.waves[11].status = 'shipped' })
  const seven = await t.cli('wave', 'add', '7')
  assert.equal(seven.code, 0)
  assert.doesNotMatch(seven.out, /queued with 1 fix/)
  assert.equal(t.state().sweep.waves[12].fixes, 7, 'any other count stands')
})
