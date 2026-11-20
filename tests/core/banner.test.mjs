import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bannerFor, bannerRows } from '../../lib/banner.mjs'
import * as S from './banner-samples.mjs'

const kindOf = (facts) => bannerFor(facts)?.kind ?? null
const textOf = (b) => [b.title, ...b.bullets, ...b.lines, ...b.options.map((o) => o[1])].join('\n')
const ids = (b) => b.options.map((o) => o[0])
const cells = (row) => [...row.map((s) => s.t).join('')].length

// The boxes in the order they would show, dismissing each as it goes.
function chain(facts) {
  const dismissed = new Set(), kinds = []
  for (let b = bannerFor({ ...facts, dismissed }); b && kinds.length < 20; b = bannerFor({ ...facts, dismissed })) {
    kinds.push(b.kind)
    dismissed.add(b.kind + ':' + b.key).add(b.kind)
  }
  return kinds
}

test('the advisor, the cap and the spend check come in order, and nothing else for a subscriber who has the advisor', () => {
  assert.equal(kindOf({}), 'advisor')
  assert.equal(kindOf({ advisorModel: 'fable' }), null)
  assert.equal(kindOf({ advisorModel: 'fable', billing: 'payg' }), 'cap')
  assert.equal(kindOf({ advisorModel: 'fable', billing: 'payg', capSet: true }), 'spend')
  assert.equal(kindOf({ advisorModel: 'fable', billing: 'payg', capSet: true, spendCommandSet: true }), null)
})

test("Not now lasts the session, Don't ask again the machine, and --advisor counts as set", () => {
  assert.equal(kindOf({ dismissed: new Set(['advisor']) }), null)
  assert.equal(kindOf({ notices: { advisor: 'never' } }), null)
  assert.equal(kindOf({ advisorFlag: true }), null)
  assert.equal(kindOf({ advisorModel: 'fable', billing: 'payg', dismissed: new Set(['cap']) }), null, 'no spend check before a cap')
  assert.equal(kindOf({ advisorModel: 'fable', billing: 'payg', capSet: true, notices: { spend: 'never' } }), null)
})

test('the most urgent box shows first, and the next one when it goes', () => {
  const run = { ...S.D1.run, asks: [{ n: 1, text: 'q', waiting: 1 }] }
  const withRun = { ...S.D1, ...S.E, advisorModel: undefined, capSet: false, run, billing: 'payg', update: { running: '0.1.1', updated: { to: '0.1.4' } }, cleanup: S.N.cleanup, statusLine: S.M.statusLine }
  assert.deepEqual(chain(withRun), ['answer', 'mark', 'spendfail', 'restart', 'cleanup', 'statusline', 'advisor', 'cap'])
  const noRun = { ...S.K, ...S.E, ...S.F, ...S.A1, billing: 'payg', capSet: false, cleanup: S.N.cleanup, statusLine: S.M.statusLine }
  assert.deepEqual(chain(noRun), ['mark', 'spendfail', 'unfinished', 'update', 'cleanup', 'statusline', 'cap'])
  const running = { ...S.L, ...S.B, update: { ...S.B.update, available: S.A1.update.available }, cleanup: S.N.cleanup }
  assert.deepEqual(chain(running), ['awake', 'whatsnew', 'cleanup'])
  assert.deepEqual(chain({ ...S.H, ...S.N }), ['guide', 'cleanup'])
})

test('a box shows only where its conditions hold', () => {
  const has = { advisorModel: 'fable' }
  const no_ = (facts, what) => assert.equal(kindOf({ ...has, ...facts }), null, what)
  assert.equal(kindOf({ ...has, ...S.L }), 'awake')
  no_({ ...S.L, sleep: { canHold: false } }, 'where LCW cannot hold off sleep')
  no_({ ...S.L, sleep: { canHold: true, heldByOther: true } }, 'when something else holds it')
  no_({ ...S.L, run: { ...S.L.run, awake: true } }, 'when this run is already kept awake')
  no_({ ...S.L, run: { ...S.L.run, stage: 'Brainstorm' } }, 'in the Brainstorm')
  no_({ ...S.L, notices: { awake: 'never' } }, "after Don't ask again")
  no_({ ...S.L, run: { ...S.L.run, status: 'paused' } }, 'while paused')

  assert.equal(kindOf({ ...has, ...S.A1 }), 'update')
  no_({ ...S.A1, update: { ...S.A1.update, devCheckout: true } }, 'from a developer checkout')
  assert.notEqual(kindOf({ ...has, ...S.A1, update: { ...S.A1.update, running: '0.1.4' } }), 'update', 'when not newer')
  no_({ ...S.A1, update: { ...S.A1.update, running: '0.1.10' } }, '0.1.4 is older than 0.1.10')
  no_({ ...S.A1, run: S.L.run }, 'while driving a run')
  assert.equal(kindOf({ ...has, ...S.A2 }), 'restart')
  no_({ ...S.A2, update: { ...S.A2.update, running: '0.1.5' } }, 'running above what Update now installed: a manual update since')
  no_({ ...S.A2, update: { ...S.A2.update, running: '0.1.4' } }, 'restarted into it, with no bullets')
  const manual = bannerFor({ ...has, update: { running: '0.1.4', available: S.A1.update.available } })
  assert.deepEqual([manual?.kind, manual?.key, manual?.bullets], ['whatsnew', '0.1.4', S.A1.update.available.bullets], "what's new for a version installed some other way")
  no_({ update: { running: '0.1.4', available: S.A1.update.available }, notices: { 'whatsnew:0.1.4': 'never' } }, 'that what is new already seen')
  assert.equal(kindOf({ ...has, ...S.B }), 'whatsnew')
  no_({ ...S.B, update: { ...S.B.update, updated: { to: '0.1.4', bullets: [] } } }, 'no bullets, no what is new')
  no_({ ...S.B, notices: { 'whatsnew:0.1.4': 'seen' } }, 'already seen')
  assert.equal(kindOf({ ...has, ...S.H }), 'guide')
  no_({ ...S.H, notices: { guide: 'seen' } }, 'guide seen')
  no_({ ...S.H, run: { ...S.H.run, stage: 'Spec' } }, 'guide only in the Brainstorm')
  assert.equal(kindOf({ ...has, ...S.N }), 'cleanup')
  assert.equal(bannerFor({ ...has, ...S.N }).lines.at(-1), 'Clean Up removes them from this Mac only. Nothing on GitHub changes, and anything not merged stays.')
  assert.match(bannerFor({ ...has, ...S.N, mac: false }).lines.at(-1), /^Clean Up removes them from this computer only\./)
  const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => x + ' was merged')
  assert.deepEqual(bannerFor({ ...has, ...S.N, cleanup: { ...S.N.cleanup, bullets: many } }).bullets, many.slice(0, 4), 'a cleanup recorded before the limit draws four')
  no_({ ...S.N, notices: { 'cleanup:shop-1a2b3c4d': 'never' } }, 'never, in this repository')
  assert.equal(kindOf({ ...has, ...S.N, repoKey: 'other', notices: { 'cleanup:shop-1a2b3c4d': 'never' } }), 'cleanup', 'another repository still asks')
  assert.equal(kindOf({ ...has, ...S.M }), 'statusline')
  no_({ ...S.M, statusLine: { command: 'ccstatusline', mine: true } }, 'LCW already has it')
  no_({ ...S.M, notices: { statusline: 'keep' } }, 'Keep mine')
  no_({ ...S.M, notices: { auto: 'off' } }, 'automatic status rows are off')
  no_({ ...has, statusLine: null }, 'no status line at all')

  assert.equal(kindOf({ ...S.E }), 'spendfail')
  no_({ ...S.E, spendFailing: { fails: 2, since: S.E.spendFailing.since } }, 'fewer failures than the status bar needs')
  no_({ ...S.E, billing: 'subscription' }, 'a subscriber has no spend check')
  assert.notEqual(kindOf({ ...S.E, spendCommandSet: false }), 'spendfail', 'no spend command')
  assert.equal(kindOf({ ...has, ...S.F }), 'unfinished')
  no_({ ...S.F, run: S.L.run }, 'a session that drives a run')
  no_({ ...S.J, run: { ...S.J.run, asks: [] } }, 'no open question')
})

test('the answer box numbers several questions and says to type the answer when Answer now could not fill the prompt', () => {
  const one = bannerFor(S.J)
  assert.deepEqual(one.bullets, [S.J.run.asks[0].text])
  assert.match(one.lines.join(' '), /^2 tasks wait for this; the rest carry on\.$/)
  const asks = [{ n: 2, text: 'First?', waiting: 1, at: 2 }, { n: 3, text: 'Second?', waiting: 2, at: 3 }]
  const many = bannerFor({ ...S.J, run: { ...S.J.run, asks }, answerFill: 'failed' })
  assert.deepEqual(many.bullets, ['2: First?', '3: Second?'])
  assert.match(many.lines.join(' '), /3 tasks wait for this/)
  assert.match(many.lines.join(' '), /Type your answer there, starting with 2:/)
  assert.doesNotMatch(one.lines.join(' '), /Type your answer/)
})

test('a raise is offered only above what is used and above the mark; never a dollar to a subscriber', () => {
  assert.deepEqual(ids(bannerFor(S.K)), ['r90', 'r100', 'wait'])
  assert.deepEqual(ids(bannerFor(S.K92)), ['r100', 'wait'])
  assert.deepEqual(ids(bannerFor({ ...S.K, usage: { ...S.K.usage, usedPercent: 90 } })), ['r100', 'wait'], 'at 90% used, 90% is not above it')
  assert.deepEqual(ids(bannerFor({ ...S.K, usage: { ...S.K.usage, markPercent: 90 } })), ['r100', 'wait'], 'at a 90% mark')
  assert.deepEqual(ids(bannerFor({ ...S.K, usage: { ...S.K.usage, markPercent: 100, usedPercent: 100 } })), ['wait'], 'at a 100% mark')
  assert.deepEqual(ids(bannerFor(S.D1)), ['r90', 'r100', 'wait'])
  const usd = bannerFor(S.D1usd)
  assert.deepEqual(usd.options.map((o) => o[1]), ['Run up to $3,600', 'Run up to $4,000', 'Wait until 08:00'])
  assert.deepEqual(ids(bannerFor({ ...S.D1usd, usage: { ...S.D1usd.usage, spentUsd: 3700 } })), ['r100', 'wait'], 'only above the spend')
  assert.deepEqual(ids(bannerFor({ ...S.D1usd, usage: { ...S.D1usd.usage, markUsd: 3600 } })), ['r100', 'wait'], 'only above the mark')
  // A subscriber's facts may carry dollar figures; the box must not show them.
  for (const facts of [S.D1, S.K, S.K92]) {
    const b = bannerFor({ ...facts, usage: { ...facts.usage, spentUsd: 3000, capUsd: 4000, markUsd: 3000 } })
    assert.doesNotMatch(textOf(b), /\$/)
  }
  assert.match(textOf(usd), /export-csv paused at your \$3,000 mark \(75% of your \$4,000 weekly cap\)/)
  assert.match(textOf(usd), /tries again at 08:00 tomorrow if your 7-day spend is back under the mark/)
})

test('at the dollar mark with no run, the box promises no 08:00 try, since nothing is retried then', () => {
  const k = bannerFor({ advisorModel: 'fable', billing: 'payg', usage: { spentUsd: 3100, capUsd: 4000, markUsd: 3000, atMark: true, since: 1 } })
  assert.equal(k.kind, 'mark')
  assert.doesNotMatch(textOf(k) + k.options.map((o) => o[1]).join(), /08:00/)
  assert.equal(k.options.at(-1)[1], 'Wait')
})

test('the mark box with no run is the same occurrence whichever ISO form the reset time was stored in', () => {
  const at = (resetsAt) => bannerFor({ ...S.K, usage: { ...S.K.usage, resetsAt } }).key
  assert.equal(at('2024-11-22T14:00:00.000Z'), at('2024-11-22T14:00:00Z'))
})

test('times read in the machine\'s own clock: the reset, yesterday, and a bare time for today', () => {
  assert.match(textOf(bannerFor(S.D1)), /resumes by itself when the week resets on Fri 22 Nov at 14:00\./)
  assert.match(textOf(bannerFor(S.F)), /It stopped yesterday at 18:40 in Build, milestone 2 of 3: 14 tasks done, 6 left\. Next was "launch milestone 3/)
  assert.match(textOf(bannerFor(S.E)), /failed 3 times since 14:02\. Last time it printed "401 Unauthorized", not a dollar figure\. Until/)
  assert.match(textOf(bannerFor(S.K)), /80% of your week is used, so Claude starts no new agents until you raise the mark or the week resets on Fri 22 Nov at 14:00\./)
})

test('the unfinished run box says what it was building from its title, and falls back to its name', () => {
  const b = bannerFor(S.F)
  assert.equal(b.title, 'A run in this repository stopped halfway: export-csv.')
  assert.equal(b.lines[0], 'The change: Add a CSV export with date filters to the reports page.')
  const bare = bannerFor({ ...S.F, unfinished: { ...S.F.unfinished, name: undefined, title: 'export-csv' } })
  assert.equal(bare.title, b.title)
  assert.equal(bare.lines[0], 'It was building export-csv.')
})

test('the unfinished run box promises to remove a worktree and keep a branch only when the run has them', () => {
  const abandon = (has) => bannerFor({ ...S.F, unfinished: { ...S.F.unfinished, ...has } }).lines.at(-1)
  assert.equal(abandon({}), 'Abandon stops it for good and removes its worktree; its branch stays, so no work is lost.')
  assert.equal(abandon({ worktree: false }), 'Abandon stops it for good; its branch stays, so no work is lost.')
  assert.equal(abandon({ worktree: false, branch: false }), 'Abandon stops it for good.')
})

test('the spend check box says why it failed in the stored words, and calls only printed text not a dollar figure', () => {
  const said = (lastError) => bannerFor({ ...S.E, spendFailing: { ...S.E.spendFailing, lastError } }).lines.join(' ')
  assert.match(said('took longer than 30 s'), /Last time it took longer than 30 s\. Until/)
  assert.match(said('printed nothing and exited with code 1'), /Last time it printed nothing and exited with code 1\. Until/)
  assert.match(said('printed "12.50" and exited with code 2'), /Last time it printed "12\.50" and exited with code 2\. Until/)
})

test('a mark box without the figures it needs does not show', () => {
  const paused = { ...S.D1, advisorModel: undefined }
  for (const usage of [undefined, {}, { markPercent: 75 }, { usedPercent: 80 }]) {
    const b = bannerFor({ ...paused, usage })
    assert.equal(b?.kind, 'advisor', 'the next box shows, not a NaN one')
    assert.doesNotMatch(b ? textOf(b) : '', /NaN/)
  }
  assert.equal(kindOf({ ...S.K, usage: { atMark: true } }), null)
})

test('a dismissal hides that occurrence only; a new occurrence brings the box back', () => {
  const answered = bannerFor(S.J)
  const later = new Set(['answer:' + answered.key])
  assert.notEqual(kindOf({ ...S.J, dismissed: later }), 'answer')
  const second = { ...S.J, run: { ...S.J.run, asks: [...S.J.run.asks, { n: 2, text: 'More?', waiting: 0, at: S.J.run.asks[0].at + 60000 }] } }
  assert.equal(kindOf({ ...second, dismissed: later }), 'answer', 'a new question')
  const asks = (...list) => ({ ...S.J, run: { ...S.J.run, asks: list.map(([n, at]) => ({ n, text: 'q' + n, at })) } })
  const putOff = new Set(['answer:' + bannerFor(asks([1, 10], [2, 20])).key])
  assert.notEqual(kindOf({ ...asks([1, 10]), dismissed: putOff }), 'answer', 'one of two put off answered')
  assert.equal(kindOf({ ...asks([1, 10], [2, 30]), dismissed: putOff }), 'answer', 'a question asked after them, under a number used before')
  const one = new Set(['answer:' + bannerFor(asks([1, 10])).key])
  assert.equal(kindOf({ ...asks([1, 40]), dismissed: one }), 'answer', 'answered, then a new question numbered 1 again')
  assert.equal(kindOf({ ...asks([1, 5]), run: { ...asks([1, 5]).run, id: 'another-run' }, dismissed: one }), 'answer', 'another run driven by the same session')
  const paused = bannerFor(S.D1)
  assert.notEqual(kindOf({ ...S.D1, dismissed: new Set(['mark:' + paused.key]) }), 'mark')
  assert.equal(kindOf({ ...S.D1, run: { ...S.D1.run, pausedAt: S.D1.run.pausedAt + 1 }, dismissed: new Set(['mark:' + paused.key]) }), 'mark', 'a new pause')
  const money = { advisorModel: 'fable', billing: 'payg', usage: { spentUsd: 3100, capUsd: 4000, markUsd: 3000, atMark: true, since: 1 } }
  const atMark = bannerFor(money)
  assert.equal(kindOf({ ...money, dismissed: new Set(['mark:' + atMark.key]) }), 'cap', 'Wait until 08:00 hides this climb to the mark')
  assert.equal(kindOf({ ...money, usage: { ...money.usage, since: 2 }, dismissed: new Set(['mark:' + atMark.key]) }), 'mark', 'a new climb to the mark')
  const update = bannerFor(S.A1)
  assert.notEqual(kindOf({ ...S.A1, dismissed: new Set(['update:' + update.key]) }), 'update')
  assert.equal(kindOf({ ...S.A1, update: { ...S.A1.update, available: { ...S.A1.update.available, version: '0.1.5' } }, dismissed: new Set(['update:' + update.key]) }), 'update', 'a newer version')
})

test('a sample of each approved box has the buttons the plan names, the first filled', () => {
  const want = {
    A1: ['now', 'later'], A2: ['ok'], B: ['ok'], D1: ['r90', 'r100', 'wait'], D1usd: ['r90', 'r100', 'wait'], K: ['r90', 'r100', 'wait'],
    K92: ['r100', 'wait'], E: ['fix', 'off', 'later'], F: ['resume', 'abandon', 'later'], H: ['ok', 'learn'], J: ['now', 'later'],
    L: ['keep', 'later', 'never'], M: ['back', 'keep'], N: ['clean', 'discuss', 'later', 'never'],
  }
  assert.deepEqual(Object.keys(want).sort(), Object.keys(S).sort())
  for (const [name, options] of Object.entries(want)) {
    const b = bannerFor(S[name])
    const buttons = bannerRows(b, 96).flat().filter((s) => s.id)
    assert.deepEqual(buttons.map((s) => s.id), options.map((o) => 'banner:' + b.kind + ':' + o), name)
    assert.equal(buttons[0].bg, 'Fable', name)
    for (const s of buttons.slice(1)) assert.notEqual(s.bg, 'Fable', name)
  }
})

test('every row of every box is as wide as the others and at most 92, from a wide terminal to a narrow one', () => {
  for (const name of Object.keys(S)) {
    for (const cols of [140, 96, 92, 60, 30]) {
      const rows = bannerRows(bannerFor(S[name]), cols)
      assert.deepEqual([...new Set(rows.map(cells))], [Math.min(cols, 92)], name + ' at ' + cols)
    }
  }
})

test('over a card the box is as wide as the card, past 92', () => {
  for (const cols of [140, 60]) assert.deepEqual([...new Set(bannerRows(bannerFor(S.D1), cols, true).map(cells))], [cols], 'at ' + cols)
})

test('the hint gives way to the buttons, and four buttons that do not fit go one to a row', () => {
  const hint = (rows) => rows.flat().some((s) => /ctrl\+x/.test(s.t))
  const rowsWith = (rows) => rows.filter((r) => r.some((s) => s.id)).length
  const n = bannerFor(S.N)
  assert.equal(hint(bannerRows(n, 96)), false, 'four buttons leave no room for the hint')
  assert.equal(rowsWith(bannerRows(n, 96)), 1, 'but fit on one row')
  assert.equal(rowsWith(bannerRows(n, 60)), 4, 'at 60 columns one to a row')
  assert.equal(hint(bannerRows(bannerFor(S.A2), 96)), true)
})

test('a word longer than the box is cut rather than breaking the border', () => {
  const long = 'x'.repeat(200)
  const b = bannerFor({ ...S.N, cleanup: { ...S.N.cleanup, bullets: [long] } })
  assert.deepEqual([...new Set(bannerRows(b, 96).map(cells))], [92])
})
