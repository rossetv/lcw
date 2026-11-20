import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mascotRows, moodOf, creatureFor, creatureNames, acts, lucks } from '../../lib/mascot.mjs'

const seedFor = (name) => {
  for (let i = 0; i < 10000; i++) if (creatureFor('s' + i) === name) return 's' + i
  throw new Error('no session gets the ' + name)
}
const now = 1_000_000_000
const mood = (o) => moodOf({ now, ...o })
const ago = (state, ms, more) => ({ state, at: now - ms, ...more })
const look = (m, s, seed = 'one-session') => JSON.stringify(mascotRows({ now: s * 1000, seed, mood: m }))
const day = Array.from({ length: 24 }, (_, s) => s)

test('a creature is two rows of one-cell characters, as wide in every mood and every second, so the bar never shifts', () => {
  for (const name of creatureNames) {
    const seed = seedFor(name)
    const width = mascotRows({ now: 0, seed })[0].length
    for (const act of acts) for (const luck of lucks) for (const hot of [false, true]) for (const extra of [{}, { party: true }, { yawn: 1 }, { late: true }]) for (const s of day) {
      const rows = mascotRows({ now: s * 1000, seed, mood: { act, luck, hot, ...extra } })
      assert.equal(rows.length, 2)
      for (const row of rows) {
        assert.equal(row.length, width, `${name} ${act} ${luck} ${s}`)
        for (const cell of row) assert.equal([...cell.t].length, 1, `${name} ${act} ${luck} ${s}: ${JSON.stringify(cell.t)}`)
      }
    }
  }
})

test('a session keeps its creature, and new sessions get every creature between them', () => {
  assert.equal(creatureFor('one-session'), creatureFor('one-session'))
  const seen = new Set(Array.from({ length: 300 }, (_, i) => creatureFor('session-' + i)))
  assert.deepEqual([...seen].sort(), [...creatureNames].sort())
})

test('what it is doing, how it is going and a full context each change the look, and every look moves', () => {
  const rest = { act: 'idle', luck: 'fine', hot: false }
  const others = [...acts.slice(1).map((act) => ({ ...rest, act })), ...lucks.slice(1).map((luck) => ({ ...rest, luck })), { ...rest, hot: true }]
  const seen = new Set([look(rest, 0)])
  for (const m of others) {
    assert.ok(!seen.has(look(m, 0)), JSON.stringify(m) + ' looks like another mood')
    seen.add(look(m, 0))
  }
  for (const m of [rest, ...others]) assert.ok(new Set(day.map((s) => look(m, s))).size > 1, JSON.stringify(m) + ' never moves')
})

test('what it is doing follows the turn: working, done for a minute after it, asleep after five quiet minutes', () => {
  assert.equal(mood({}).act, 'idle', 'a session with no record rests')
  assert.equal(mood({ activity: ago('working', 5000) }).act, 'working')
  assert.equal(mood({ activity: ago('done', 5000) }).act, 'done')
  assert.equal(mood({ activity: ago('done', 2 * 60_000) }).act, 'idle')
  assert.equal(mood({ activity: ago('done', 6 * 60_000) }).act, 'asleep')
  assert.equal(mood({ activity: ago('start', 6 * 60_000) }).act, 'asleep', 'opened and left alone')
  assert.equal(mood({ run: { paused: true } }).act, 'asleep', 'a paused run')
  assert.equal(mood({ activity: ago('working', 5000), run: { asks: 1 } }).act, 'needs', 'a run with an open question')
  assert.equal(mood({ activity: ago('working', 5000), contextPercent: 90 }).hot, true)
  assert.equal(mood({ activity: ago('working', 5000), contextPercent: 84 }).hot, false, 'below the red line')
})

test('a finished run: confetti beside it for a minute, starry eyes for five', () => {
  const party = mood({ run: { finishedAgo: 30_000 } })
  assert.equal(party.party, true)
  assert.equal(mood({ run: { finishedAgo: 61_000 } }).party, false)
  assert.equal(mood({ run: { finishedAgo: 61_000 } }).luck, 'great')
  const marks = (s) => mascotRows({ now: s * 1000, seed: 'one-session', mood: party }).map((r) => r[r.length - 1].t).join('')
  assert.ok(day.every((s) => /^[*'+.]{2}$/.test(marks(s))), 'both cells hold confetti every second')
  assert.ok(new Set(day.map(marks)).size > 1, 'and it falls')
})

test('it yawns in the four seconds before it falls asleep, every creature with its mouth open', () => {
  const at = (ms) => mood({ activity: ago('done', ms) })
  assert.deepEqual([4 * 60_000 + 55_000, 4 * 60_000 + 56_000, 4 * 60_000 + 59_500, 5 * 60_000].map((ms) => at(ms).yawn), [null, 0, 3, null])
  for (const name of creatureNames) {
    // frames 2 and 3 have the same shut eyes: only the mouth differs
    const wide = JSON.stringify(mascotRows({ now, seed: seedFor(name), mood: { act: 'idle', luck: 'fine', yawn: 2 } }))
    const shut = JSON.stringify(mascotRows({ now, seed: seedFor(name), mood: { act: 'idle', luck: 'fine', yawn: 3 } }))
    assert.notEqual(wide, shut, name + ' opens its mouth')
  }
  assert.equal(mood({ hour: 2 }).late, true)
  assert.equal(mood({ hour: 7 }).late, false)
})

test('a question is over once the conversation has moved on past it', () => {
  const asked = ago('needs', 60_000)
  assert.equal(mood({ activity: asked, transcriptAt: now - 61_000 }).act, 'needs', 'nothing written since the question')
  assert.equal(mood({ activity: asked, transcriptAt: now - 59_000 }).act, 'needs', 'only what the question itself wrote')
  assert.equal(mood({ activity: asked, transcriptAt: now - 30_000 }).act, 'working', 'answered')
})

test('how it is going: pleased when a turn ends, worried by a failure, crying at three, angry at five', () => {
  const failing = (fails, ms = 5000) => ago('working', 60_000, { fails, failAt: now - ms })
  assert.equal(mood({ activity: ago('working', 5000) }).luck, 'fine')
  assert.equal(mood({ activity: ago('done', 5000, { fails: 0 }) }).luck, 'good')
  assert.equal(mood({ activity: ago('done', 2 * 60_000, { fails: 0 }) }).luck, 'fine', 'the pleasure passes')
  assert.equal(mood({ activity: failing(1) }).luck, 'uneasy')
  assert.equal(mood({ activity: failing(1, 40_000) }).luck, 'fine', 'one failure is forgotten in half a minute')
  assert.equal(mood({ activity: failing(3) }).luck, 'bad')
  assert.equal(mood({ activity: failing(5) }).luck, 'awful')
  assert.equal(mood({ activity: failing(5, 3 * 60_000) }).luck, 'fine', 'old failures are over')
  assert.equal(mood({ activity: ago('failed', 5000) }).luck, 'bad', 'the turn died of an error')
})

test('how a run is going: crying while a requirement fails, starry when all pass or it has just finished', () => {
  const working = ago('working', 5000)
  assert.equal(mood({ activity: working, run: { total: 4, passing: 3, failing: 1 } }).luck, 'bad')
  assert.equal(mood({ activity: working, run: { total: 4, passing: 2, failing: 0 } }).luck, 'fine')
  assert.equal(mood({ activity: working, run: { total: 4, passing: 4, failing: 0 } }).luck, 'great')
  assert.equal(mood({ activity: working, run: { total: 4, passing: 2, failing: 0, parked: 1 } }).luck, 'uneasy')
  assert.equal(mood({ run: { finishedAgo: 60_000 } }).luck, 'great')
  assert.equal(mood({ run: { finishedAgo: 10 * 60_000 } }).luck, 'fine')
})

test('a run in trouble: angry at a stalled agent, worried by a quiet one or by a large share of the week', () => {
  const working = ago('working', 5000)
  assert.equal(mood({ activity: working, run: { stalled: 1, quiet: 2 } }).luck, 'awful')
  assert.equal(mood({ activity: working, run: { quiet: 1 } }).luck, 'uneasy')
  assert.equal(mood({ activity: working, run: { share: 31 } }).luck, 'uneasy')
  assert.equal(mood({ activity: working, run: { share: 29, quiet: 0, stalled: 0 } }).luck, 'fine')
  assert.equal(mood({ activity: working, run: { stalled: 1, total: 3, passing: 3 } }).luck, 'awful', 'trouble counts before good news')
})

test('the usage mark: worried within five points of it, crying once it is reached', () => {
  const working = ago('working', 5000)
  assert.equal(mood({ activity: working, markLeft: 15 }).luck, 'fine')
  assert.equal(mood({ activity: working, markLeft: 5 }).luck, 'uneasy')
  assert.equal(mood({ activity: working, markLeft: 0 }).luck, 'bad')
  assert.equal(mood({ activity: working, markLeft: -3 }).luck, 'bad')
  assert.equal(mood({ activity: working, markLeft: null }).luck, 'fine', 'no reading of the week')
  assert.equal(mood({ activity: ago('done', 5000), markLeft: 0, run: { paused: false } }).act, 'done', 'at its mark it cries; it does not fall asleep at once')
})
