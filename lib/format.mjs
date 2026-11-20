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

// Length in characters, counting a code point as one.
export const len = s => [...String(s)].length;
export const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - len(s)));
export const padStart = (s, n) => ' '.repeat(Math.max(0, n - len(s))) + String(s);
export function clip(s, n) {
  const a = [...String(s)];
  return a.length <= n ? a.join('') : n < 1 ? '' : a.slice(0, n - 1).join('') + '…';
}

// Whole dollars with thousands separated: $1,260.
export const dollars = n => '$' + Math.round(n).toLocaleString('en-US');

// Greedy word wrap.
export function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
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
