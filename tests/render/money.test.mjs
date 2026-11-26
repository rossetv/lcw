import test from 'node:test';
import assert from 'node:assert/strict';
import { buildView, renderCard } from '../../lib/card.mjs';
import { renderStatusRows } from '../../lib/status.mjs';
import { moodOf } from '../../lib/mascot.mjs';
import { dollars } from '../../lib/format.mjs';
import { toPlain } from '../../lib/paint.mjs';
import { inputsOf, moneyOf, NOW } from './boards.mjs';

process.env.TZ = 'UTC';   // "08:00" is the local time of retryAt

const plain = rows => toPlain(rows).split('\n').map(r => r.trimEnd());
const bar = (money, width = 100) => renderStatusRows({ ...inputsOf('Main').status, model: 'Opus 5', effort: 'low', money }, { width });
const left = r => { const i = r.findIndex(s => s.r); return (i < 0 ? r : r.slice(0, i)).map(s => s.t).join(''); };
const right = r => r.slice(Math.max(0, r.findIndex(s => s.r))).map(s => s.t).join('');
const card = (money, more, opts = { width: 100 }) => plain(renderCard(buildView({ ...inputsOf('Paused'), gate: { reason: 'mark' }, money, now: NOW, ...more }), opts));

test('dollars read whole, with thousands separated', () => {
  assert.deepEqual([1260, 3000, 5500, 86.4, 999.5, 0].map(dollars), ['$1,260', '$3,000', '$5,500', '$86', '$1,000', '$0']);
});

test('row 2 shows the spend, a gauge with the mark as one line, and the mark in dollars', () => {
  const row = left(bar(moneyOf('Usual'))[1]);
  assert.match(row, /^\$1,260 ▰+▱+\|▱+ \$3,000$/);
  assert.equal([...row].filter(c => c === '|').length, 1);
});

test('the gauge scales to the cap, and to the mark when the mark is above the cap', () => {
  // the mark of 3000 on a 4000 scale is three quarters along, the mark of 5500 on a 5500 scale the last cell
  const cells = row => left(row).replace(/^\S+ /, '').replace(/ \S+$/, '');
  const a = cells(bar(moneyOf('Usual'))[1]), b = cells(bar(moneyOf('MarkAboveCap'))[1]);
  assert.equal(a.indexOf('|'), Math.floor([...a].length * 0.75));
  assert.equal(b.indexOf('|'), [...b].length - 1);
  // the full width is the mark (5500), so 4210 of it fills about three quarters, with empty cells before the mark
  const n = [...b].length, filled = [...b].filter(c => c === '▰').length;
  assert.ok(Math.abs(filled - n * 4210 / 5500) <= 1, `filled ${filled} of ${n}`);
  assert.match(b, /^▰+▱+\|$/);
});

test('the fill turns the caution colour at the mark, not before', () => {
  const colours = money => bar(money)[1].filter(s => s.t.includes('▰')).map(s => s.c.split('@')[0]);
  assert.ok(colours(moneyOf('NearMark')).every(c => c === 'resourceUsed'));
  assert.ok(colours(moneyOf('AtMark')).every(c => c === 'caution'));
  assert.equal(colours(moneyOf('Usual')).length > 0, true);
});

test('the pace reads "rolling 7d · $N spare" in the fine colour and "short" in the caution colour', () => {
  const spare = bar(moneyOf('Usual'))[1], short = bar(moneyOf('NearMark'))[1];
  assert.equal(right(spare), 'rolling 7d · $2,502 spare');
  assert.equal(spare.at(-1).c, 'ok');
  assert.equal(right(short), 'rolling 7d · $265 short');
  assert.equal(short.at(-1).c, 'caution');
});

test('while the cap is only assumed, the pace names it', () => {
  assert.equal(right(bar(moneyOf('CapAssumed'))[1]), '$4,000 cap assumed · $2,502 spare');
});

test('where row 2 is short the pace gives way first, then the cap, and no row is wider than the terminal', () => {
  const cells = r => left(r).length + (r.some(s => s.r) ? 2 + right(r).length : 0);
  for (const money of [moneyOf('CapAssumed'), moneyOf('Usual', { spentUsd: 12345, capUsd: 20000 }), moneyOf('CapAssumed', { spentUsd: 12345, capUsd: 20000 })]) {
    for (let width = 30; width <= 80; width++) {
      const rows = bar(money, width);
      rows.forEach((r, i) => assert.ok(cells(r) <= width, width + ', row ' + (i + 1) + ': ' + toPlain([r])));
      assert.match(rows[1].map(s => s.t).join(''), /▰/);
    }
  }
  const at = (money, width) => right(bar(money, width)[1]);
  assert.equal(at(moneyOf('CapAssumed'), 56), '$4,000 cap assumed · $2,502 spare');
  assert.equal(at(moneyOf('CapAssumed'), 50), '$4,000 cap assumed');
  assert.equal(at(moneyOf('Usual', { spentUsd: 12345, capUsd: 20000 }), 48), 'rolling 7d · $2,502 spare');
  assert.equal(at(moneyOf('Usual', { spentUsd: 12345, capUsd: 20000 }), 44), 'rolling 7d');
  assert.equal(bar(moneyOf('CapAssumed'), 30)[2].map(s => s.t).join(''), '$4,000 cap assumed');
});

test('in a narrow terminal the pace is the third row', () => {
  const rows = bar(moneyOf('Usual'), 42);
  assert.equal(rows.length, 3);
  assert.match(left(rows[1]), /^\$1,260 ▰+▱+\|▱+ \$3,000$/);
  assert.equal(rows[2].map(s => s.t).join(''), 'rolling 7d · $2,502 spare');
});

test('without a money view the rows are the share of the week, as before', () => {
  const rows = renderStatusRows(inputsOf('Main').status, { width: 100 });
  assert.match(left(rows[1]), /^31% /);
  assert.match(right(rows[1]), /^resets in /);
  assert.equal(JSON.stringify(rows), JSON.stringify(renderStatusRows({ ...inputsOf('Main').status, money: null }, { width: 100 })));
});

test('the mascot is worried within five points of the cap before the mark, and cries at the mark', () => {
  const luck = spentUsd => moodOf({ now: NOW, money: moneyOf('Usual', { capUsd: 2000, markUsd: 1500, spentUsd }) }).luck;
  assert.equal(luck(1390), 'fine');   // 5.5 points of 2000 left
  assert.equal(luck(1400), 'uneasy');  // exactly 5
  assert.equal(luck(1499), 'uneasy');
  assert.equal(luck(1500), 'bad');
});

test('the mascot is worried when the run spent 30% of the cap or more', () => {
  const luck = runUsd => moodOf({ now: NOW, money: moneyOf('Usual', { capUsd: 2000, markUsd: 1500, runUsd }) }).luck;
  assert.equal(luck(590), 'fine');   // 29.5 points
  assert.equal(luck(600), 'uneasy'); // 30 points
});

test('a run paused at a dollar mark says so, when it tries again, and offers the mark and a tenth of the cap', () => {
  const rows = card(moneyOf('AtMark'));
  assert.match(rows.find(r => r.includes('paused')), /^▮▮ paused at your \$3,000 mark\s+\|\|\s+resumes at 08:00$/);
  assert.ok(rows.some(r => r.startsWith('nothing new starts')));
  assert.ok(rows.includes('say “run up to $3,400” to carry on now'));
});

test('the dollar hint is above the spend, even when the spend has passed the mark and a tenth of the cap', () => {
  for (const [spentUsd, hint] of [[3020, '$3,400'], [3500, '$3,600'], [3700, '$4,000'], [4100, '$4,500']])
    assert.ok(card(moneyOf('AtMark', { spentUsd })).includes(`say “run up to ${hint}” to carry on now`), `${spentUsd} offers ${hint}`);
});

test('after a try that found the spend still over the mark, the card says it tries again', () => {
  const row = card(moneyOf('AtMark', { retried: true, retryAt: Date.UTC(2026, 10, 20, 8, 0) })).find(r => r.includes('paused'));
  assert.match(row, /still over · tries again at 08:00$/);
});

test('the hint is offered even when the mark is above the cap', () => {
  assert.ok(card(moneyOf('MarkAboveCap')).includes('say “run up to $5,900” to carry on now'));
});

test('a run paused by the human on pay-per-token billing still says carry on', () => {
  const i = inputsOf('Paused');
  const rows = plain(renderCard(buildView({ ...i, state: { ...i.state, status: 'paused', pausedReason: 'human' }, gate: null, money: moneyOf('AtMark') }), { width: 100 }));
  assert.ok(rows.some(r => r.includes('paused by you')) && rows.some(r => r.includes('“carry on”')));
  assert.ok(!rows.join('\n').includes('resumes'));
});

test('the running row and the finished totals show the run\'s spend, not a share of the week', () => {
  const i = inputsOf('RunningA');
  const running = plain(renderCard(buildView({ ...i, money: moneyOf('Usual', { runUsd: 86 }) }), { width: 100 })).join('\n');
  assert.match(running, /≈ \$86 this run/);
  assert.doesNotMatch(running, /of your week/);
  const done = { state: { ...inputsOf('Done').state, totals: { agents: 5, tokens: 9000, usd: 212, sharePercent: 4 } }, now: NOW };
  assert.match(plain(renderCard(buildView({ ...done, money: moneyOf('Usual') }), { width: 100 })).join('\n'), /≈ \$212 this run/);
  assert.match(plain(renderCard(buildView(done), { width: 100 })).join('\n'), /≈ 4% of your week/);
});

test('a run with no spend figure shows no share on pay-per-token billing', () => {
  const rows = plain(renderCard(buildView({ ...inputsOf('RunningA'), money: moneyOf('Usual') }), { width: 100 })).join('\n');
  assert.doesNotMatch(rows, /this run|of your week/);
});
