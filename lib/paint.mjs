// Rows to text. A row is a list of spans; the span with r: true starts the right-aligned group. No Node APIs.
import { hex } from './theme.mjs';
import { len } from './format.mjs';

const split = row => {
  const i = row.findIndex(s => s.r);
  return i < 0 ? [row, []] : [row.slice(0, i), row.slice(i)];
};
const plainOf = spans => spans.map(s => s.plain ?? s.t).join('');
const width = spans => len(spans.map(s => s.t).join(''));

// Plain text, for tests and logs: a row's two groups joined by "   ||   ".
export function toPlain(rows) {
  return rows.map(row => {
    const [l, r] = split(row);
    const right = plainOf(r);
    return (right.trim() ? plainOf(l) + '   ||   ' + right : plainOf(l)).trimEnd();
  }).join('\n');
}

const rgb = (code, h) => code + ';2;' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(';');

function ansi(spans, theme) {
  return spans.map(s => {
    const codes = [];
    if (s.b) codes.push('1');
    if (s.href) codes.push('4');
    const fg = s.c && hex(theme, s.c);
    const bg = s.bg && hex(theme, s.bg);
    if (fg) codes.push(rgb(38, fg));
    if (bg) codes.push(rgb(48, bg));
    let out = codes.length ? '\x1b[' + codes.join(';') + 'm' + s.t + '\x1b[0m' : s.t;
    if (s.href) out = '\x1b]8;;' + s.href + '\x1b\\' + out + '\x1b]8;;\x1b\\';
    return out;
  }).join('');
}

// Truecolor. With a width the right group is pushed to the right edge; without one the groups sit three spaces apart.
export function toAnsi(rows, theme = 'dark', cols) {
  return rows.map(row => {
    const [l, r] = split(row);
    if (!r.length) return ansi(l, theme);
    const gap = cols ? Math.max(2, cols - width(l) - width(r)) : 3;
    return ansi(l, theme) + ' '.repeat(gap) + ansi(r, theme);
  }).join('\n');
}
