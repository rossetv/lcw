import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { begin } from './helpers.mjs'
import { compactChoice } from '../../lib/checkpoint.mjs'

/** A run whose session's status line last saw a context of this many tokens in a 1M window. */
async function at(tokens, { window = 1_000_000, age = 0 } = {}) {
  const t = await begin()
  fs.mkdirSync(`${t.home}/cache`, { recursive: true })
  fs.writeFileSync(`${t.home}/cache/context-s1.json`, JSON.stringify({ tokens, window, at: Date.now() - age }))
  const ledger = () => fs.readFileSync(`${t.dir}/ledger.md`, 'utf8')
  const file = () => (fs.existsSync(`${t.dir}/checkpoint`) ? fs.readFileSync(`${t.dir}/checkpoint`, 'utf8') : '')
  return { ...t, ledger, file }
}

test('under 200K a checkpoint records the step and compacts nothing, and the orchestrator carries on', async () => {
  const t = await at(150_000)
  const r = await t.cli('checkpoint', 'launch milestone 2')
  assert.equal(r.code, 0)
  assert.match(r.out, /context 150K, under 200K: nothing compacts.*end your turn only to wait for agents/)
  assert.equal(t.file(), '')
  assert.match(t.ledger(), /checkpoint: launch milestone 2/)
  assert.match((await t.cli('status')).out, /next step: launch milestone 2/)
})

test('from 200K a checkpoint compacts nothing until the orchestrator chooses, and either choice is recorded', async () => {
  const t = await at(320_000)
  const r = await t.cli('checkpoint', 'start the review')
  assert.match(r.out, /context 320K: yours to decide/)
  assert.equal(t.file(), '')
  assert.equal((await t.cli('checkpoint', '--compact')).code, 0)
  assert.equal(t.file(), 'start the review', 'the step comes from the ledger')

  const k = await at(320_000)
  await k.cli('checkpoint', 'start the review')
  const kept = await k.cli('checkpoint', '--keep', 'the fix round needs these findings')
  assert.equal(kept.code, 0)
  assert.equal(k.file(), '')
  assert.match(k.ledger(), /context 320K kept: the fix round needs these findings/)
})

test('--keep takes the next step too and records it as the plain form does', async () => {
  const t = await at(320_000)
  const r = await t.cli('checkpoint', '--keep', 'the fix round needs these findings', 'start the review')
  assert.equal(r.code, 0, r.out)
  assert.equal(t.file(), '')
  assert.match(t.ledger(), /context 320K kept: the fix round needs these findings/)
  assert.match((await t.cli('status')).out, /next step: start the review/)
  assert.equal((await t.cli('checkpoint', '--keep', 'why', '--compact')).code, 1, '--keep and --compact together are still refused')
})

test('--keep with an unquoted reason is refused and records nothing, so its words are not split into a reason and a step', async () => {
  const t = await at(320_000)
  const r = await t.cli('checkpoint', '--keep', 'the', 'fix', 'round', 'needs', 'these', 'findings')
  assert.equal(r.code, 1)
  assert.match(r.out, /--keep "<why>" "<next step>"/)
  assert.doesNotMatch(t.ledger(), /kept|checkpoint:/)
})

test('near the end of the window, or with no fresh reading, a checkpoint compacts and cannot be kept', async () => {
  for (const t of [await at(850_000), await at(150_000, { age: 11 * 60000 })]) {
    assert.match((await t.cli('checkpoint', 'go on')).out, /compaction happens when this turn ends/)
    assert.equal(t.file(), 'go on')
    const r = await t.cli('checkpoint', '--keep', 'still need it')
    assert.equal(r.code, 1)
    assert.match(r.out, /run lcw checkpoint --compact/)
  }
})

test('--compact with a step compacts at any size', async () => {
  const t = await at(90_000)
  await t.cli('checkpoint', '--compact', 'plan wave 2')
  assert.equal(t.file(), 'plan wave 2')
})

test('above 200K, stage, set and status remind the orchestrator of the size; below it they say nothing', async () => {
  const big = await at(260_000)
  assert.match((await big.cli('set', 'health=on track')).out, /context 260K: compact at your next checkpoint/)
  const small = await at(120_000)
  assert.doesNotMatch((await small.cli('set', 'health=on track')).out, /context/)
})

test('a smaller window compacts at 80% of it, before 200K', async () => {
  assert.equal(compactChoice({ tokens: 170_000, window: 200_000 }), 'compact')
  assert.equal(compactChoice({ tokens: 150_000, window: 200_000 }), 'keep')
})

test('--keep refused for no context reading still records the step, so --compact finds it', async () => {
  const t = await begin()
  const r = await t.cli('checkpoint', '--keep', 'why', 'start the review')
  assert.equal(r.code, 1)
  assert.match(r.out, /run lcw checkpoint --compact/)
  assert.equal((await t.cli('checkpoint', '--compact')).code, 0)
  assert.equal(fs.readFileSync(`${t.dir}/checkpoint`, 'utf8'), 'start the review')
})
