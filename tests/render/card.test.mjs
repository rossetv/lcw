import test from 'node:test';
import assert from 'node:assert/strict';
import { buildView, renderCard, weekOf, weekShare } from '../../lib/card.mjs';
import { renderStatusRows } from '../../lib/status.mjs';
import { toPlain, toAnsi } from '../../lib/paint.mjs';
import { hex } from '../../lib/theme.mjs';
import { inputsOf, NOW } from './boards.mjs';

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, '');
const card = (board, opts) => renderCard(buildView(inputsOf(board)), opts);
const cols = s => [...s].length;

test('the frame has the title in the top border and a rule between sections', () => {
  const lines = strip(toAnsi(card('RunningA', { width: 100, frame: true }), 'dark', 100)).split('\n');
  assert.match(lines[0], /^╭─ ◆ LCW · export-csv ─+ 2h 14m in Build ─╮$/);
  assert.equal(lines.filter(l => l.startsWith('├')).length, 2);
  assert.match(lines.at(-1), /^╰─+╯$/);
  assert.ok(lines.every(l => cols(l) === 100));
  assert.ok(lines.slice(1, -1).every(l => /^[│├]/.test(l) && /[│┤]$/.test(l)));
  // the title moves into the border; the frame adds a rule for each gap between sections and the bottom border
  assert.equal(lines.length, card('RunningA', { width: 100 }).length + 3);
});

test('the frame is coloured by state', () => {
  const border = (board, view) => renderCard(view ?? buildView(inputsOf(board)), { width: 100, frame: true })[0][0].c;
  assert.equal(border('RunningA'), 'hairline');
  assert.equal(border('NeedsYou'), 'needsYou');
  assert.equal(border('Paused'), 'caution');
  assert.equal(border('Done'), 'ok');
});

test('below 44 columns there is no frame', () => {
  const rows = card('Narrow', { width: 40, frame: true });
  assert.ok(!toPlain(rows).includes('╭'));
});

test('the right group sits against the right edge at 126 and 80 columns', () => {
  for (const width of [126, 80]) {
    const framed = strip(toAnsi(card('Stalled', { width, frame: true }), 'dark', width)).split('\n');
    assert.ok(framed.every(l => cols(l) === width), 'framed rows are ' + width + ' wide at ' + width);
    const status = strip(toAnsi(renderStatusRows(inputsOf('Stalled').status, { width }), 'dark', width)).split('\n');
    assert.equal(cols(status[0]), width);
    assert.ok(status[0].endsWith('acme-api · lcw/export-csv'));
    assert.ok(status[1].endsWith('resets in 3d · -15% short'));
    const plain = renderCard(buildView(inputsOf('Stalled')), { width });
    const text = strip(toAnsi(plain, 'dark', width)).split('\n');
    assert.ok(text[0].endsWith('≈ 12% of your week') || text[0].endsWith('3h 02m in Build'));
  }
});

test('long descriptions are cut and keep a gap before the model', () => {
  const rows = card('RunningA', { width: 80 });
  const line = toPlain(rows).split('\n').find(l => l.includes('date filters'));
  assert.match(line, /…\s+Sonnet 5.5/);
});

test('maxRows drops agent rows first and says how many are left', () => {
  const full = card('ManyAgents', { width: 126 });
  for (const frame of [false, true]) {
    const rows = card('ManyAgents', { width: 126, frame, maxRows: full.length + (frame ? 2 + 3 : 0) - 3 });
    const text = toPlain(rows).split('\n');
    assert.ok(rows.length <= full.length + (frame ? 5 : 0) - 3);
    assert.match(text.filter(l => /more agents/.test(l)).join(), /▸ 1[0-9] more agents/);
    assert.ok(text.some(l => l.includes('✓ Brainstorm')), 'the stage row stays');
    assert.ok(text.some(l => l.includes('tasks ▰')), 'the task bar stays');
  }
  const tight = card('ManyAgents', { width: 126, maxRows: 8 });
  assert.equal(tight.length, 8);
  assert.match(toPlain(tight), /▸ 10 more agents/);
});

test("an agent's sparkline: its spans against the most any agent shown gained in one, the unsampled ones dim", () => {
  const i = inputsOf('RunningA'), now = Date.parse('2026-11-18T12:00:00Z');
  const a = (id, spark, more = {}) => ({ id, description: id, model: 'claude-sonnet-5-5', tokens: 9000, startTime: now, status: 'running', quietMs: 0, spark, ...more });
  const agents = [a('busy', [100, 200, 700, 0, 350, 700, 700, 700]), a('new', [700, 350]), a('gone', [0, 0, 0, 0, 0, 0, 0, 0], { quietMs: 20 * 60e3 })];
  const rows = renderCard(buildView({ ...i, agents, now }), { width: 126 });
  const line = id => rows.find(r => r.some(s => s.t.startsWith(id + ' ')));
  const spark = id => line(id).filter(s => /^[▁-█]+$/.test(s.t)).map(s => [s.t, s.c]);
  assert.deepEqual(spark('busy'), [['▄▅█▁▆███', 'accent']], 'a square-root scale');
  assert.deepEqual(spark('new'), [['▁▁▁▁▁▁', 'dim'], ['█▆', 'accent']]);
  assert.deepEqual(spark('gone'), [['▁▁▁▁▁▁▁▁', 'needsYou']]);
});

test('a figure that moved rolls up to its new value over half a second', () => {
  const i = inputsOf('RunningA'), at = Date.parse('2026-11-18T12:00:00Z');
  const agents = [{ id: 'x', description: 'x', model: 'claude-sonnet-5-5', tokens: 240000, tokensWas: 200000, movedAt: at, startTime: at, status: 'running', quietMs: 0 }];
  const shown = ms => buildView({ ...i, agents, now: at + ms }).agents[0].tokens;
  assert.deepEqual([0, 250, 499, 500, 5000].map(shown), [200000, 230000, 240000, 240000, 240000]);
  assert.equal(buildView({ ...i, agents, now: at + 250 }).inFlight, 230000);
});

test('toAnsi writes truecolor from the theme', () => {
  const rows = card('Stalled', { width: 126 });
  const dark = toAnsi(rows, 'dark', 126), light = toAnsi(rows, 'light', 126);
  assert.ok(dark.includes('\x1b[38;2;233;230;223m'), 'text colour #e9e6df');
  assert.ok(dark.includes('\x1b[38;2;143;206;139m'), 'ok green');
  assert.ok(dark.includes('\x1b[1;38;2;20;19;18;48;2;240;128;122m'), 'the stalled chip: bold, background on red');
  assert.ok(light.includes('\x1b[38;2;35;34;31m'), 'light text colour #23221f');
  assert.ok(!light.includes('38;2;233;230;223'));
  assert.equal(strip(dark), strip(light));
  assert.equal(hex('dark', 'ok'), '#8fce8b');
  assert.equal(hex('light', 'Sonnet'), '#2f5fb8');
  assert.equal(hex('dark', 'ok@50'), '#52714f');
});

test('the context bar is drawn as cells and printed as [bar N%]', () => {
  const rows = renderStatusRows(inputsOf('Main').status, { width: 126 });
  assert.ok(toPlain(rows).includes('xhigh  [bar 38%] 38% of 1M'));
  const bg = rows[0].filter(s => s.bg);
  // 38% of twenty cells: seven, and a cell 60% of the way from the track's colour to the fill's
  assert.deepEqual(bg.map(s => [s.t.length, s.bg]), [[7, 'resourceUsed'], [1, 'resourceUsed@60/contextTrack'], [12, 'contextTrack']]);
  assert.equal(hex('dark', 'resourceUsed@60/contextTrack'), '#938f87');
  const one = renderStatusRows({ ...inputsOf('Main').status, contextPercent: 1 }, { width: 126 })[0].filter(s => s.bg);
  assert.deepEqual(one.map(s => [s.t.length, s.bg]), [[0, 'resourceUsed'], [1, 'resourceUsed@25/contextTrack'], [19, 'contextTrack']], '1% still shows');
  assert.equal(renderStatusRows({ ...inputsOf('Main').status, contextPercent: 91 }, { width: 126 })[0].find(s => s.plain).bg, 'needsYou');
  const over = renderStatusRows({ ...inputsOf('Main').status, contextPercent: 140 }, { width: 126 })[0].filter(s => s.plain !== undefined);
  assert.deepEqual(over.map(s => s.t.length), [20, 0]);
});

test('the context bar is twenty cells where there is room, narrows with the terminal to ten, and is six in the narrow layout', () => {
  // Fable 5.2 · xhigh and 38% of 1M take 29 cells; "resets in 3d · +42% spare" on the right takes 25, and two apart
  const input = { model: 'Fable 5.2', effort: 'xhigh', contextPercent: 38, contextWindow: '1M', repo: 'lcw', branch: 'main', weekUsedPercent: 29, weekElapsedPercent: 50, markPercent: 75 };
  const bar = width => renderStatusRows(input, { width })[0].filter(s => s.plain !== undefined).reduce((n, s) => n + s.t.length, 0);
  assert.deepEqual([126, 76, 71, 66, 60, 44, 40].map(bar), [20, 20, 15, 10, 10, 10, 6]);
  for (const width of [126, 76, 71, 66]) {
    const lines = strip(toAnsi(renderStatusRows(input, { width }), 'dark', width)).split('\n');
    assert.ok(lines.every(l => cols(l) === width), 'both rows are ' + width + ' wide: ' + lines.map(cols));
  }
});

test('the week gauge: used figure, cells with the usage mark as a line, the mark\'s figure', () => {
  const main = inputsOf('Main').status;   // Fable 5.2 · xhigh, 38% of 1M: the group above is 49 wide
  const row = (input, width = 126) => renderStatusRows({ ...main, weekElapsedPercent: 50, ...input }, { width });
  const left = r => { const i = r.findIndex(s => s.r); return (i < 0 ? r : r.slice(0, i)).map(s => s.t).join(''); };
  const on = n => '▰'.repeat(n), off = n => '▱'.repeat(n);
  const week = (input, width) => left(row(input, width)[1]);
  assert.equal(week({ weekUsedPercent: 29, markPercent: 75 }), '29% ' + on(12) + off(18) + '|' + off(10) + ' 75%');
  assert.equal(week({ weekUsedPercent: 74, markPercent: 75 }), '74% ' + on(30) + '|' + off(10) + ' 75%');
  assert.equal(week({ weekUsedPercent: 82, markPercent: 75 }), '82% ' + on(30) + '|' + on(3) + off(7) + ' 75%');
  assert.equal(week({ weekUsedPercent: 100, markPercent: 100 }), '100% ' + on(38) + '| 100%');
  assert.equal(week({ weekUsedPercent: 0, markPercent: 0 }), '0% |' + off(42) + ' 0%');
  assert.equal(week({ weekUsedPercent: 29, markPercent: null }), '29% ' + on(14) + off(31));
  assert.equal(week({ weekUsedPercent: null, markPercent: 75 }), '--% ' + off(30) + '|' + off(10) + ' 75%');
  assert.equal(week({ weekUsedPercent: 52, markPercent: 75 }, 40), '52% ' + on(11) + off(4) + '|' + off(4) + ' 75%');
  // the last cell is part-filled: 29% of 41 cells is 11.89, so the twelfth is 89% of the way from dim to the fill
  assert.deepEqual(row({ weekUsedPercent: 29, markPercent: 75 })[1].filter(s => s.t.includes('▰')).map(s => [s.t.length, s.c]), [[11, 'resourceUsed'], [1, 'resourceUsed@89/dim']]);
  assert.equal(row({ weekUsedPercent: 29, markPercent: 75 }).length, 2);
  assert.equal(row({ weekUsedPercent: 52, markPercent: 75 }, 40).length, 3);
  const past = row({ weekUsedPercent: 82, markPercent: 75 })[1];
  assert.equal(past.find(s => s.t === '|').c, 'text');
  assert.ok(past.filter(s => s.t.includes('▰')).every(s => s.c.split('@')[0] === 'caution'));
  assert.ok(row({ weekUsedPercent: 74, markPercent: 75 })[1].filter(s => s.t.includes('▰')).every(s => s.c === 'resourceUsed'));
});

test('the week gauge and its figures are as wide as the group above, whatever the model, effort and figures', () => {
  const left = r => { const i = r.findIndex(s => s.r); return (i < 0 ? r : r.slice(0, i)).map(s => s.t).join(''); };
  let n = 0;
  for (const model of ['Fable 5.2', 'claude-sonnet-5-5', 'Haiku 5.5', 'Opus 5.5'])
    for (const effort of ['xhigh', 'medium', 'low', undefined])
      for (const contextPercent of [0, 9, 38, 100])
        for (const contextWindow of ['1M', '200k', undefined])
          for (const weekUsedPercent of [null, 0, 9, 29, 100])
            for (const markPercent of [null, 0, 75, 100])
              for (const width of [126, 80, 40]) {
                const rows = renderStatusRows({ model, effort, contextPercent, contextWindow, repo: 'acme-api', branch: 'main', weekUsedPercent, weekElapsedPercent: 46, markPercent }, { width });
                assert.equal(cols(left(rows[1])), cols(left(rows[0])), JSON.stringify({ model, effort, contextPercent, contextWindow, weekUsedPercent, markPercent, width }));
                assert.equal((left(rows[1]).match(/\|/g) ?? []).length, markPercent === null ? 0 : 1);
                n++;
              }
  assert.ok(n > 1000);
  // where the terminal is too narrow for that, the row still fits it
  for (const width of [44, 50, 60]) {
    const line = strip(toAnsi(renderStatusRows({ model: 'claude-sonnet-5-5', effort: 'medium', contextPercent: 100, contextWindow: '200k', weekUsedPercent: 100, weekElapsedPercent: 50, markPercent: 100 }, { width }), 'dark', width)).split('\n')[1];
    assert.equal(cols(line), width, 'the gauge row is ' + width + ' wide');
  }
});

test('the card shows the PR number, never its link', () => {
  const ansi = toAnsi(card('Done', { width: 126 }), 'dark', 126);
  assert.ok(strip(ansi).includes('draft PR #482 is open'));
  assert.ok(!ansi.includes('github.com'));
});

test('status rows survive missing input', () => {
  assert.doesNotThrow(() => toPlain(renderStatusRows({}, { width: 100 })));
  assert.doesNotThrow(() => toPlain(renderStatusRows(undefined, {})));
  assert.ok(toPlain(renderStatusRows({ model: 'claude-sonnet-5-5', weekUsedPercent: 10, weekElapsedPercent: 0 }, { width: 100 })).includes('Sonnet 5.5'));
});

test('motion: without a tick nothing fades; with one it only changes colours and fills', () => {
  const colours = rows => rows.flat().map(s => s.c ?? '').concat(rows.flat().map(s => s.bg ?? ''));
  const still = card('Stalled', { width: 126, frame: true });
  assert.ok(!colours(still).some(c => c.includes('@')));
  const a = card('Stalled', { width: 126, frame: true, tick: 40 });
  const b = card('Stalled', { width: 126, frame: true, tick: 47 });
  assert.equal(toPlain(a), toPlain(still));
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
  const faded = colours(a).concat(colours(b)).filter(c => c.includes('@'));
  assert.ok(faded.some(c => c.startsWith('ok@')), 'heartbeat on the state mark');
  assert.ok(faded.some(c => c.startsWith('accent@')), 'shimmer and breathing arrows');
  assert.ok(faded.some(c => c.startsWith('needsYou@')), 'pulse on the stalled chip');
  // the two working agents are out of step
  const arrows = rows => rows.map(r => r.find(s => s.t === '→')).filter(Boolean).map(s => s.c);
  assert.ok(new Set(arrows(card('RunningA', { width: 126, tick: 10 }))).size > 1);
});

test('motion: bars fill cell by cell on first draw', () => {
  const taskBar = tick => toPlain(card('RunningA', { width: 126, tick })).split('\n').find(l => l.startsWith('tasks')).match(/▰/g)?.length ?? 0;
  assert.equal(taskBar(0), 0);
  assert.ok(taskBar(2) < taskBar(4));
  assert.equal(taskBar(100), 17);
});

test('needs-you frame pulses', () => {
  const view = buildView(inputsOf('NeedsYou'));
  const c = tick => renderCard(view, { width: 100, frame: true, tick })[0][0].c;
  assert.notEqual(c(0), c(14));
});

test('buildView: quiet, stalled and waiting agents', () => {
  const i = inputsOf('RunningA');
  const mk = (status, quietMs) => buildView({ ...i, agents: [{ id: 'x', description: 'd', model: 'm', startTime: NOW, tokens: 1, status, quietMs }] }).agents[0].chip;
  assert.equal(mk('running', 4 * 6e4), null);
  assert.equal(mk('running', 5 * 6e4), 'quiet');
  assert.equal(mk('running', 15 * 6e4), 'stalled');
  assert.equal(mk('waiting', 40 * 6e4), null);
  assert.equal(buildView({ ...i, agents: [{ id: 'x', status: 'completed' }] }).agents.length, 0);
});

test('buildView: states', () => {
  const i = inputsOf('RunningA');
  assert.equal(buildView(i).mode, 'running');
  assert.equal(buildView({ ...i, gate: { reason: 'mark' } }).mode, 'paused');
  assert.equal(buildView({ ...i, state: { ...i.state, status: 'paused', pausedReason: 'human' } }).pausedBy, 'human');
  assert.equal(buildView({ ...i, state: { ...i.state, asks: [{ n: 1, text: 'q', at: NOW - 6e4 }] } }).frame, 'needsYou');
  assert.equal(buildView({ state: {}, now: NOW }).mode, 'running');
  assert.equal(buildView({ ...i, usage: null }).share, null);
  const paused = toPlain(card('RunningA', { width: 100 }));
  assert.ok(paused.includes('≈ 9% of your week'));
});

test('a run the human paused says so and promises no reset', () => {
  const i = inputsOf('Paused');
  const human = { ...i, state: { ...i.state, status: 'paused', pausedReason: 'human' } };
  for (const gate of [null, { reason: 'mark', markPercent: 75, resetsAt: i.usage.sevenDay.resetsAt }]) {
    const v = buildView({ ...human, gate });
    assert.equal(v.pausedBy, 'human');
    assert.equal(v.resumesIn, '');
    const text = toPlain(renderCard(v, { width: 100 }));
    assert.ok(text.includes('paused by you') && text.includes('“carry on”'));
    assert.ok(!text.includes('resumes in') && !text.includes('mark') && !text.includes('run up to'));
  }
  const mark = buildView(inputsOf('Paused'));
  assert.ok(mark.pausedBy === 'mark' && mark.resumesIn !== '');
});

test('the share of the week survives a weekly reset', () => {
  const i = inputsOf('RunningA');
  const { usage } = i;
  const before = '2026-11-15T14:00:00.000Z', after = usage.sevenDay.resetsAt;
  const view = (state, used) => buildView({ ...i, state: { ...i.state, ...state }, usage: { sevenDay: { percentUsed: used, resetsAt: after } } }).share;
  const started = { weekAtStart: 40, weekUsed: 70, weekResetsAt: before };
  assert.equal(view(started, 12), 42, 'what the run used of the old week (30) plus the new week (12)');
  assert.equal(view({ ...started, shareBefore: 5 }, 12), 47);
  assert.equal(view({ ...started, weekResetsAt: after }, 72), 32, 'same week: used minus weekAtStart');
  assert.equal(view({ weekAtStart: 40 }, 72), 32, 'no stored reset time: nothing to fold');
  assert.equal(view({ weekAtStart: null, weekResetsAt: before }, 12), 12, 'start unknown: the new week is the run\'s');
  assert.deepEqual(weekOf(started, { percentUsed: 12, resetsAt: after }),
    { shareBefore: 30, weekAtStart: 0, weekResetsAt: after, weekUsed: 12 });
  assert.equal(weekShare({ ...started, weekResetsAt: after }, { percentUsed: 30, resetsAt: before }), 0, 'an older reading is ignored for the fold');
});

test('an orchestrator opens, and the more row opens everything', () => {
  const i = inputsOf('ManyAgents');
  const o1 = i.agents[0].id;
  const open = toPlain(renderCard(buildView({ ...i, ui: { expanded: { [o1]: true } } }), { width: 126 }));
  assert.ok(open.includes('▾ ◈ Own the billing workstream'));
  assert.ok(open.includes('▸ 3 more workers'));
  const all = toPlain(renderCard(buildView({ ...i, ui: { moreOpen: true } }), { width: 126 }));
  assert.ok(!all.includes('more workers'));
  assert.ok(all.includes('▾ fewer agents'));
  const ids = renderCard(buildView(i), { width: 126 }).flat().map(s => s.id).filter(Boolean);
  assert.ok(ids.includes('toggle:' + o1) && ids.includes('more') && ids.some(x => x.startsWith('view:')));
});

test('one more worker is singular', () => {
  const i = inputsOf('AgentsOpen');
  const boss = i.agents.find(a => !a.parentId && i.agents.some(k => k.parentId === a.id));
  const agents = [boss, ...i.agents.filter(a => a.parentId === boss.id).slice(0, 4)];
  const text = toPlain(renderCard(buildView({ ...i, agents, ui: { expanded: { [boss.id]: true } } }), { width: 126 }));
  assert.ok(text.includes('▸ 1 more worker'), text);
  assert.ok(!text.includes('1 more workers'));
});

test('every board fits the frame at 126, 100 and 80 columns', () => {
  for (const board of ['Brainstorm', 'Spec', 'Plan', 'Review'].map(s => 'Stage' + s).concat(['RunningA', 'NeedsYou', 'SeveralAsks', 'Paused', 'Done', 'ManyAgents', 'AgentsOpen', 'Stalled', 'NoMod'])) {
    for (const width of [126, 100, 80]) {
      const lines = strip(toAnsi(card(board, { width, frame: true }), 'dark', width)).split('\n');
      lines.forEach((l, i) => assert.equal(cols(l), width, board + ' at ' + width + ', line ' + i + ': ' + l));
    }
  }
});

test('sparse state prints no undefined, null or NaN', () => {
  const sub = { plan: {}, spec: {}, intent: {}, blindReview: {}, closing: {}, totals: {}, tasks: [], requirements: [], asks: [], pr: null };
  const states = [];
  for (const stage of ['', 'Brainstorm', 'Spec', 'Plan', 'Build', 'Review', 'Ship']) for (const status of ['with-you', 'running', 'paused', 'finished', 'stopped']) {
    states.push({ name: 'x', stage, status }, { name: 'x', stage, status, ...sub });
  }
  for (const state of states) for (const gate of [null, { reason: 'mark' }]) for (const usage of [null, {}, { sevenDay: {} }]) {
    for (const width of [126, 80, 40]) for (const frame of [false, true]) {
      const view = buildView({ state, agents: [{ id: 'a' }, { id: 'b', parentId: 'a', tokens: 5 }], usage, gate, now: NOW });
      const text = toPlain(renderCard(view, { width, frame, tick: 3 }));
      assert.ok(!/undefined|null|NaN/.test(text), JSON.stringify(state) + ' -> ' + text);
    }
  }
  const rows = renderStatusRows({ contextPercent: 37.6, weekUsedPercent: 30.4, markPercent: 75.2 }, { width: 100 });
  assert.ok(toPlain(rows).includes('38%') && toPlain(rows).includes('30%') && !/\d\.\d/.test(toPlain(rows)));
});

test('the paused card says what still runs, singular and plural', () => {
  const i = inputsOf('Paused');
  const line = n => toPlain(renderCard(buildView({ ...i, state: { ...i.state, tasks: Array.from({ length: n }, (_, k) => ({ id: 't' + k, status: 'running' })) } }), { width: 100 }))
    .split('\n').find(l => l.startsWith('nothing new starts'));
  assert.equal(line(1), 'nothing new starts · the running task finishes and merges first');
  assert.equal(line(3), 'nothing new starts · the 3 running tasks finish and merge first');
  assert.equal(line(0), 'nothing new starts · no task is running');
});

test('a share that rounds to zero reads "<1% of your week"', () => {
  const i = inputsOf('RunningA');
  const week = (state, usage = i.usage) => toPlain(renderCard(buildView({ ...i, state: { ...i.state, ...state }, usage }), { width: 126 }));
  const used = i.usage.sevenDay.percentUsed;
  assert.ok(week({ weekAtStart: used - 0.4 }).includes('<1% of your week'));
  assert.ok(week({ weekAtStart: used }).includes('<1% of your week'));
  assert.ok(week({ weekAtStart: used - 1 }).includes('≈ 1% of your week'));
  const done = inputsOf('Done');
  const finished = sharePercent => toPlain(renderCard(buildView({ ...done, state: { ...done.state, totals: { ...done.state.totals, sharePercent } } }), { width: 126 }));
  assert.ok(finished(0).includes('<1% of your week') && !finished(0).includes('≈'));
  assert.ok(finished(0.4).includes('<1% of your week'));
  assert.ok(finished(6.6).includes('≈ 7% of your week'));
});

test('a right group too long for the card is cut too', () => {
  const i = inputsOf('StageReview');
  const state = { ...i.state, requirements: i.state.requirements.map(r => (r.status === 'failing' ? { ...r, name: 'x'.repeat(60) } : r)) };
  for (const width of [44, 60, 80]) {
    const lines = strip(toAnsi(renderCard(buildView({ ...i, state }), { width, frame: true }), 'dark', width)).split('\n');
    lines.forEach(l => assert.equal(cols(l), width, l));
  }
});

test('every framed row is exactly the width, from 44 columns up', () => {
  const boards = ['Brainstorm', 'Spec', 'Plan', 'Review'].map(s => 'Stage' + s)
    .concat(['RunningA', 'NeedsYou', 'SeveralAsks', 'Paused', 'Done', 'ManyAgents', 'AgentsOpen', 'Stalled', 'NoMod']);
  for (const board of boards) for (let width = 44; width <= 130; width++) {
    const lines = strip(toAnsi(card(board, { width, frame: true }), 'dark', width)).split('\n');
    lines.forEach((l, i) => assert.equal(cols(l), width, board + ' at ' + width + ', line ' + i + ': ' + l));
  }
});

test('the Plan card says how many tasks, how many at once, and the models chosen', () => {
  const text = toPlain(card('StagePlan', { width: 126 }));
  assert.match(text, /\d+ tasks · up to \d+ at once/);
  assert.match(text, /models .*\d/);
});

// ---------------------------------------------------------------- defects found in review, 2026-11-19

const plain = rows => rows.map(r => r.map(s => s.t).join(''));
const at = { now: NOW };

test('a long failing requirement gives way, so the bar and the counts stay whole', () => {
  const requirements = Array.from({ length: 10 }, (_, i) => ({ id: 'R' + (i + 1), name: 'x', status: i < 6 ? 'pass' : 'todo' }));
  requirements[6] = { id: 'R7', name: 'Retries back off exponentially and give up after five attempts with a clear error', status: 'failing' };
  for (const width of [100, 120]) {
    const row = plain(renderCard(buildView({ state: { stage: 'Review', status: 'running', requirements, name: 'd' }, ...at }), { width, frame: true })).find(t => t.includes('requirements'));
    assert.match(row, /▱  6 pass · 1 failing · 3 to go/);
    assert.match(row, /failing: R7 Retries/);
  }
});

test('values lcw set stores as they come do not break the card', () => {
  const state = { stage: 'Brainstorm', status: 'with-you', health: 42, intent: { settled: 'why', now: 7, next: 'edge cases' }, name: 'd' };
  for (const width of [40, 120]) assert.ok(renderCard(buildView({ state, ...at }), { width, frame: true }).length);
  assert.match(plain(renderCard(buildView({ state, ...at }), { width: 120, frame: true })).join('\n'), /why/);
  assert.ok(renderCard(buildView({ state: { stage: 'Spec', status: 'running', blindReview: { done: 5 }, name: 'd' }, ...at }), { width: 100, frame: true }).length);
});

test('parked tasks count in the tasks bar', () => {
  const row = (statuses) => plain(renderCard(buildView({ state: { stage: 'Build', status: 'running', name: 'd', tasks: statuses.map((status, i) => ({ id: 'T' + i, title: 't', status })) }, ...at }), { width: 100, frame: true })).find(t => t.includes('tasks'));
  assert.match(row(['done', 'done', 'parked']), /▰{16}▱{8}  2 done · 1 parked/);
  assert.match(row(['parked', 'parked']), /▱{24}  2 parked/);
});

test('a collapsed orchestrator counts every agent under it', () => {
  const a = (id, parentId) => ({ id, parentId, description: id, status: 'running', startTime: NOW, tokenCount: 1 });
  const rows = plain(renderCard(buildView({ state: { stage: 'Build', status: 'running', name: 'd' }, agents: [a('o'), a('s', 'o'), a('w1', 's'), a('w2', 's')], ...at }), { width: 120, frame: true }));
  assert.ok(rows.some(t => /3 more agents/.test(t)));
});

test('paused at a 100% mark, the card offers no higher mark', () => {
  const rows = (markPercent) => plain(renderCard(buildView({ state: { stage: 'Build', status: 'paused', pausedReason: 'mark', markPercent, name: 'd' }, ...at }), { width: 100, frame: true })).join('\n');
  assert.doesNotMatch(rows(100), /run up to/);
  assert.match(rows(75), /run up to 85%/);
});


test('a long intent row keeps the newest in view: the oldest settled points give way after a "…"', () => {
  const v = buildView({ ...inputsOf('StageBrainstorm'), state: { ...inputsOf('StageBrainstorm').state,
    intent: { settled: ['why', 'what the cap counts', 'who for', 'the proxy', 'default cap', 'the first ask', 'finish regardless'], now: 'the reset', next: ['wording'], questionsOpen: 2 } } });
  const row = width => strip(toAnsi(renderCard(v, { width, frame: true }), 'dark', width)).split('\n').find(l => l.includes('intent'));
  const wide = row(200), tight = row(100);
  assert.ok(wide.includes('✓ why') && !wide.includes('…'), wide);
  assert.match(tight, /intent  …  ✓ /, tight);
  assert.ok(!tight.includes('✓ why') && tight.includes('› the reset  ○ wording') && tight.includes('2 questions open'), tight);
});

const withGuide = (board, guide = true) => { const i = inputsOf(board); i.state.guide = guide; return buildView(i); };
const guided = (v, opts) => strip(toAnsi(renderCard(v, opts), 'dark', opts.width)).split('\n');

test('the stage line shows only with guide true, dim, under the stages and lined up with them', () => {
  const lines = guided(withGuide('RunningA'), { width: 96, frame: true });
  const i = lines.findIndex(l => l.includes('Brainstorm'));
  assert.match(lines[i + 1], /^│ Build · workers write the code, milestone by milestone; a reviewer checks each one +│$/);
  assert.ok(lines.every(l => cols(l) === 96));
  const dim = renderCard(withGuide('RunningA'), { width: 96 }).flat().find(s => s.t.startsWith('Build · '));
  assert.equal(dim.c, 'dim');
  for (const off of [false, null, 'true']) assert.ok(!guided(withGuide('RunningA', off), { width: 96, frame: true }).join('').includes('workers write'));
  assert.equal(card('RunningA', { width: 96 }).length + 1, renderCard(withGuide('RunningA'), { width: 96 }).length);
});

test('a finished card has no stage line', () => {
  assert.ok(!guided(withGuide('Done'), { width: 96, frame: true }).join('').includes('Ship · '));
});

test('the stage line is cut short on a narrow card and never wraps', () => {
  const lines = guided(withGuide('RunningA'), { width: 60, frame: true });
  const l = lines.find(x => x.includes('Build · workers'));
  assert.equal(cols(l), 60);
  assert.ok(!l.includes('checks each one'));
  assert.ok(lines.every(x => cols(x) === 60));
});

test('the stage line is the first row to go when maxRows is short', () => {
  const v = withGuide('ManyAgents');
  const full = renderCard(v, { width: 126 });
  const noGuide = renderCard(withGuide('ManyAgents', false), { width: 126 });
  assert.equal(full.length, noGuide.length + 1);
  // room for the card without the line: the line goes, no agent row does
  const rows = renderCard(v, { width: 126, maxRows: noGuide.length });
  assert.equal(toPlain(rows), toPlain(noGuide));
  assert.equal(renderCard(v, { width: 126, maxRows: full.length }).length, full.length);
});

test('hideMarkHint drops only the say-run-up-to row of a paused card', () => {
  const v = buildView(inputsOf('Paused'));
  const shown = toPlain(renderCard(v, { width: 100 })), hidden = toPlain(renderCard(v, { width: 100, hideMarkHint: true }));
  assert.match(shown, /run up to/);
  assert.doesNotMatch(hidden, /run up to/);
  assert.equal(hidden.split('\n').length, shown.split('\n').length - 1);
  assert.match(hidden, /nothing new starts/);
});
