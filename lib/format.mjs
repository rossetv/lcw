// Plain text helpers shared by the status rows and the card. No Node APIs.

export function tokens(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 10000) return Math.round(n / 100) / 10 + 'k';
  if (n < 999500) return Math.round(n / 1000) + 'k';
  return Math.round(n / 1e5) / 10 + 'M';
}

/** A count of lines in five characters at most, so a figure keeps its width: 86, 940, 1.2k, 23.2k, 128k, 1.2M. */
export function lineCount(n) {
  n = Math.max(0, Math.round(Number(n) || 0));
  if (n < 1000) return String(n);
  if (n < 99950) return (n / 1000).toFixed(1) + 'k';
  if (n < 999500) return Math.round(n / 1000) + 'k';
  return (n / 1e6).toFixed(1) + 'M';
}

export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}

// "claude-sonnet-5-5" -> "Sonnet 5.5"; "claude-3-5-sonnet-20241022" -> "Sonnet 3.5"; a display name passes through.
export function modelName(model) {
  if (!model) return '';
  const id = String(model).replace(/\[.*\]$/, '').trim();
  if (!/^claude-/i.test(id)) return id.charAt(0).toUpperCase() + id.slice(1);
  const parts = id.slice(7).split('-').filter(p => !/^\d{8}$/.test(p));
  const fam = parts.find(p => /\D/.test(p));
  if (!fam) return id;
  const ver = parts.filter(p => /^\d+$/.test(p)).join('.');
  return fam.charAt(0).toUpperCase() + fam.slice(1) + (ver ? ' ' + ver : '');
}

// The family word of a model name or id, or null.
export function family(model) {
  const m = /fable|opus|sonnet|haiku/i.exec(String(model ?? ''));
  return m ? m[0].charAt(0).toUpperCase() + m[0].slice(1).toLowerCase() : null;
}

// Code points a terminal draws two cells wide: East Asian wide and fullwidth characters, and emoji drawn as emoji.
const WIDE = [[0x1100, 0x115F], [0x231A, 0x231B], [0x2329, 0x232A], [0x23E9, 0x23EC], [0x23F0, 0x23F0], [0x23F3, 0x23F3],
  [0x25FD, 0x25FE], [0x2614, 0x2615], [0x2648, 0x2653], [0x267F, 0x267F], [0x2693, 0x2693], [0x26A1, 0x26A1], [0x26AA, 0x26AB],
  [0x26BD, 0x26BE], [0x26C4, 0x26C5], [0x26CE, 0x26CE], [0x26D4, 0x26D4], [0x26EA, 0x26EA], [0x26F2, 0x26F3], [0x26F5, 0x26F5],
  [0x26FA, 0x26FA], [0x26FD, 0x26FD], [0x2705, 0x2705], [0x270A, 0x270B], [0x2728, 0x2728], [0x274C, 0x274C], [0x274E, 0x274E],
  [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27B0, 0x27B0], [0x27BF, 0x27BF], [0x2B1B, 0x2B1C], [0x2B50, 0x2B50],
  [0x2B55, 0x2B55], [0x2E80, 0x303E], [0x3041, 0x33FF], [0x3400, 0x4DBF], [0x4E00, 0x9FFF], [0xA000, 0xA4CF], [0xA960, 0xA97F],
  [0xAC00, 0xD7A3], [0xF900, 0xFAFF], [0xFE10, 0xFE19], [0xFE30, 0xFE6F], [0xFF00, 0xFF60], [0xFFE0, 0xFFE6],
  [0x1F004, 0x1F004], [0x1F0CF, 0x1F0CF], [0x1F18E, 0x1F18E], [0x1F191, 0x1F19A], [0x1F1E6, 0x1F202], [0x1F210, 0x1F23B],
  [0x1F240, 0x1F248], [0x1F250, 0x1F251], [0x1F260, 0x1F265], [0x1F300, 0x1F64F], [0x1F680, 0x1F6FF], [0x1F7E0, 0x1F7EB],
  [0x1F90C, 0x1F9FF], [0x1FA70, 0x1FAFF], [0x20000, 0x2FFFD], [0x30000, 0x3FFFD]];
// Code points drawn on the character before them: combining marks, joiners, variation selectors, skin tones, tags.
const ZERO = [[0x0300, 0x036F], [0x0483, 0x0489], [0x1160, 0x11FF], [0x1AB0, 0x1AFF], [0x1DC0, 0x1DFF], [0x200B, 0x200F],
  [0x20D0, 0x20FF], [0xFE00, 0xFE0F], [0xFE20, 0xFE2F], [0x1F3FB, 0x1F3FF], [0xE0000, 0xE007F], [0xE0100, 0xE01EF]];
const within = (ranges, p) => ranges.some(([a, b]) => p >= a && p <= b);
const isFlag = p => p >= 0x1F1E6 && p <= 0x1F1FF;

// The characters as a person sees them, each with the cells it takes: a mark, a joiner or what a joiner joins stays with
// the character before it, and so does the second of a pair of flag letters. One character is two cells at most.
function chars(s) {
  const out = [];
  let joined = false;
  for (const c of String(s)) {
    const p = c.codePointAt(0), last = out.at(-1);
    if (last && (joined || within(ZERO, p) || (isFlag(p) && last.flag))) {
      last.t += c;
      if (p === 0xFE0F) last.w = 2;
      if (isFlag(p)) last.flag = false;
    } else out.push({ t: c, w: within(ZERO, p) ? 0 : within(WIDE, p) ? 2 : 1, flag: isFlag(p) });
    joined = p === 0x200D;
  }
  return out;
}

// Text of one-cell characters only, as nearly every row is: measured by its length, which is quicker.
const PLAIN = /^[\u0000-˿‐-‧‰-⃏℀-⌙─-◼★⚑✓]*$/;

// Length in terminal cells.
export const len = s => (PLAIN.test(s = String(s)) ? s.length : chars(s).reduce((n, c) => n + c.w, 0));
export const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - len(s)));
export const padStart = (s, n) => ' '.repeat(Math.max(0, n - len(s))) + String(s);
// At most n cells, cut between whole characters and ended with "…"; where a wide character would not fit, a cell short.
export function clip(s, n) {
  s = String(s);
  if (len(s) <= n) return s;
  if (n < 1) return '';
  if (PLAIN.test(s)) return s.slice(0, n - 1) + '…';
  let t = '', w = 0;
  for (const c of chars(s)) { if (w + c.w > n - 1) break; t += c.t; w += c.w; }
  return t + '…';
}

// A clip of text ends its last word and the "…", with no separator or space between.
export const clipWord = (t, w) => clip(t, w).replace(/[\s·›…]+…$/, '…');

// Whole dollars with thousands separated: $1,260.
export const dollars = n => '$' + Math.round(n).toLocaleString('en-US');

// A word longer than the line, where it has wide characters, in pieces that fit: Chinese and Japanese put no spaces between words.
function pieces(word, width) {
  if (PLAIN.test(word) || len(word) <= width) return [word];
  const out = [''];
  for (const c of chars(word)) {
    if (out.at(-1) && len(out.at(-1)) + c.w > width) out.push('');
    out[out.length - 1] += c.t;
  }
  return out;
}

// Greedy word wrap.
export function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const w of String(text).split(/\s+/).filter(Boolean).flatMap(w => pieces(w, width))) {
    if (line && len(line) + 1 + len(w) > width) { lines.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines;
}

// "3d" from a day up, else "15h", else "40m".
export function resetsIn(hours) {
  if (!Number.isFinite(hours)) return '';
  if (hours >= 24) return Math.floor(hours / 24) + 'd';
  if (hours >= 1) return Math.floor(hours) + 'h';
  return Math.max(0, Math.floor(hours * 60)) + 'm';
}

// How old something is: "3 min" under an hour, "2h" under 48 hours, else "2d"; each rounded down.
export function ageText(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return Math.max(1, min) + ' min';
  const h = Math.floor(min / 60);
  return h < 48 ? h + 'h' : Math.floor(h / 24) + 'd';
}
