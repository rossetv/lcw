// The always-on rows: two, or three when narrow. No Node APIs.
import { modelName, family, tokens, resetsIn, len, clip, lineCount, dollars, ageText } from './format.mjs';
import { glyphs as G, thresholds as TH } from './theme.mjs';

const sp = (t, c, o) => ({ t, ...(c ? { c } : {}), ...o });
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const whole = v => (num(v) === null ? null : Math.round(v));
const WEEK_HOURS = 168;

function contextColour(pct) {
  return pct >= TH.contextRedFrom ? 'needsYou' : pct >= TH.contextYellowFrom ? 'caution' : null;
}

// "resets in 3d" and the pace, from how much of the week has passed. The planned segment is not drawn.
function weekRight(elapsed, used) {
  if (elapsed === null) return [];
  const out = [sp('resets in ' + resetsIn((100 - elapsed) / 100 * WEEK_HOURS), 'dim')];
  if (used !== null && elapsed > 0) {
    const pace = Math.round(100 - used / (elapsed / 100));
    out.push(sp(' · ', 'dim'), pace >= 0 ? sp('+' + pace + '% spare', 'ok') : sp(pace + '% short', 'caution'));
  }
  return out;
}

// Pay-per-token billing: "rolling 7d · $2,502 spare", or the assumed cap in its place while the human has not stated one.
// While the spend command is failing, that is all the right part says, in place of the pace and the assumed cap.
// Where the row has no room for that, "failing · 12m old", and where it has none for that, nothing.
function moneyRight({ capUsd, capAssumed, pace, command }, now, room) {
  if (command?.failing) {
    const age = ageText(now - command.at) + ' old';
    const form = ['spend command failing · ' + age, 'failing · ' + age].find(t => len(t) <= room);
    return form ? [sp(form, 'caution')] : [];
  }
  return [sp(capAssumed ? dollars(capUsd) + ' cap assumed' : 'rolling 7d', 'dim'),
    ...(pace ? [sp(' · ', 'dim'), pace.short ? sp(dollars(pace.usd) + ' short', 'caution') : sp(dollars(pace.usd) + ' spare', 'ok')] : [])];
}

// Repo and branch cut to the cells left of row 1: the branch first, then the repo alone, then nothing.
function fitWhere(where, room) {
  const w = spans => len(spans.map(s => s.t).join(''));
  if (w(where) <= room) return where;
  const last = where.length - 1, before = w(where.slice(0, last));
  if (last > 0 && room - before >= 4) return [...where.slice(0, last), { ...where[last], t: clip(where[last].t, room - before) }];
  return room >= 4 ? [{ ...where[0], t: clip(where[0].t, room) }] : [];
}

// A bar's fill as whole cells and the share of one more: 38% of 20 cells is 7 cells and 0.6 of the eighth, which
// is drawn in a colour between the fill's and the track's. Anything over 0% shows at least a quarter of a cell.
function edgeOf(cells, pct) {
  const x = Math.max(0, Math.min(cells, cells * pct / 100)), whole = Math.floor(x);
  const part = whole < cells ? (pct > 0 && whole === 0 ? Math.max(0.25, x) : x - whole) : 0;
  return { whole, part: Math.round(part * 100) };   // part in percent, 0 when there is no part-filled cell
}

// The week gauge, exactly `cells` wide. The usage mark is a line in the cell it falls in, not a row of its own.
function weekGauge(cells, used, mark) {
  const { whole, part: soft } = edgeOf(cells, used ?? 0);
  const on = whole + (soft ? 1 : 0);
  const at = mark === null ? -1 : Math.max(0, Math.min(cells - 1, Math.floor(cells * mark / 100)));
  const colour = mark !== null && used !== null && used >= mark ? 'caution' : 'resourceUsed';
  const part = (from, to) => [
    sp(G.barOn.repeat(Math.max(0, Math.min(to, whole) - from)), colour),
    ...(soft && whole >= from && whole < to ? [sp(G.barOn, colour + '@' + soft + '/dim')] : []),
    sp(G.barOff.repeat(Math.max(0, to - Math.max(from, on))), 'dim'),
  ];
  const spans = at < 0 ? part(0, cells) : [...part(0, at), sp(G.markLine, 'text'), ...part(at + 1, cells)];
  return spans.filter(s => s.t);
}

// Lines added over lines removed, in a column of its own at the right edge of the two rows: a thin rule with one
// space on each side, then the two figures with their signs, right-aligned to the wider of them.
const diffCells = ({ added, removed }) => 4 + Math.max(len(lineCount(added)), len(lineCount(removed)));
function diffColumn({ added, removed }) {
  const wide = Math.max(len(lineCount(added)), len(lineCount(removed)));
  const figure = (sign, colour, n) => {
    const t = lineCount(n);
    return [sp(' '.repeat(wide - len(t)) + sign, colour), sp(t, 'text')];
  };
  const rule = [sp(' '), sp(G.rule, 'hairline'), sp(' ')];
  return [[...rule, ...figure('+', 'ok', added)], [...rule, ...figure(G.minus, 'needsYou', removed)]];
}

export function renderStatusRows(input = {}, opts = {}) {
  input = input ?? {};
  const width = opts.width ?? 100;
  const now = opts.now ?? Date.now();
  const diff = input.diff;
  if (!diff || !(num(diff.added) > 0 || num(diff.removed) > 0) || width - diffCells(diff) < TH.narrowBelowColumns) return statusRows(input, width, now);
  // The column gives way before the repo and branch are shortened to make room for it.
  const rows = statusRows(input, width - diffCells(diff), now);
  const where = input.repo ? input.repo + (input.branch ? ' · ' + input.branch : '') : input.branch ?? '';
  const right = rows[0].slice(Math.max(0, rows[0].findIndex(s => s.r))).map(s => s.t).join('');
  if (where && (rows[0].findIndex(s => s.r) < 0 || right !== where)) return statusRows(input, width, now);
  return rows.map((row, i) => {
    const col = diffColumn(diff)[i];
    if (!col) return row;
    return [...row, ...(row.some(s => s.r) ? col : [{ ...col[0], r: true }, ...col.slice(1)])];
  });
}

function statusRows(input, width, now) {
  const narrow = width < TH.narrowBelowColumns;
  const ctx = whole(input.contextPercent) ?? 0;
  // On pay-per-token billing the gauge's full width is the larger of the cap and the mark, in dollars.
  const money = input.money;
  const full = money ? Math.max(money.capUsd, money.markUsd) : 1;
  const used = money ? money.spentUsd / full * 100 : whole(input.weekUsedPercent);
  const elapsed = num(input.weekElapsedPercent);
  const mark = money ? money.markUsd / full * 100 : whole(input.markPercent);

  const name = modelName(input.model);
  const cc = contextColour(ctx);
  const win = typeof input.contextWindow === 'number' ? tokens(input.contextWindow) : input.contextWindow;
  const text = spans => len(spans.map(s => s.t).join(''));
  const head = [];
  if (name) head.push(sp(name, family(name) ?? 'text', { b: true }));
  if (input.effort) head.push(sp(' · ', 'dim'), sp(input.effort, 'mid'));
  head.push(sp(narrow ? ' ' : '  ', 'dim'));
  const tail = [sp(' ' + ctx + '%', cc ?? 'text')];
  if (win && !narrow) tail.push(sp(' of ' + win, 'dim'));
  const where = input.repo
    ? [sp(input.repo, 'text'), ...(input.branch ? [sp(' · ', 'dim'), sp(input.branch, 'mid')] : [])]
    : input.branch ? [sp(input.branch, 'mid')] : [];
  if (where.length && !narrow) where[0] = { ...where[0], r: true };

  // What the second row must hold besides its right part: the two figures and four cells of gauge.
  const moneyRoom = money ? width - 2 - 4 - len(dollars(money.spentUsd) + ' ') - len(' ' + dollars(money.markUsd)) : 0;
  // In the narrow layout the right part has a row of its own, as wide as the terminal.
  const right = money ? moneyRight(money, now, narrow ? width : moneyRoom) : weekRight(elapsed, used);
  const rightLen = text(right);
  // The context bar takes the room there is: twenty cells, one for every five percent, where both rows still fit
  // beside what stands on their right; fewer as the terminal narrows, never under ten; six in the narrow layout.
  const barCells = narrow ? 6 : Math.max(10, Math.min(20, width - 2 - Math.max(text(where), rightLen) - text(head) - text(tail)));
  const { whole: fill, part } = edgeOf(barCells, ctx);
  const row1 = [...head,
    sp(' '.repeat(fill), undefined, { bg: cc ?? 'resourceUsed', plain: '[bar ' + ctx + '%]' }),
    ...(part ? [sp(' ', undefined, { bg: (cc ?? 'resourceUsed') + '@' + part + '/contextTrack', plain: '' })] : []),
    sp(' '.repeat(barCells - fill - (part ? 1 : 0)), undefined, { bg: 'contextTrack', plain: '' }),
    ...tail];
  // The used figure sits left of the gauge and the mark's figure right of it: "29% ▰▰▰▱▱|▱▱ 75%".
  // The three together are as wide as the model, effort and context group above, whatever the model's name;
  // narrower only where the row would not fit the terminal.
  const usedLabel = money ? dollars(money.spentUsd) + ' ' : (used === null ? '--' : used) + '% ';
  const markLabel = money ? ' ' + dollars(money.markUsd) : mark === null ? '' : ' ' + mark + '%';
  const labels = len(usedLabel) + len(markLabel);
  const above = text(row1);
  const room = narrow ? width : width - 2 - rightLen;
  const cells = Math.max(4, Math.min(above, room) - labels);
  const gauge = [sp(usedLabel, 'text', { b: true }), ...weekGauge(cells, used, mark), ...(markLabel ? [sp(markLabel, 'mid')] : [])];
  const row2 = narrow || !right.length ? gauge : [...gauge, { ...right[0], r: true }, ...right.slice(1)];

  const rows = [narrow ? row1 : [...row1, ...fitWhere(where, width - 2 - text(row1))], row2];
  if (narrow && right.length) rows.push(right);
  return rows;
}
