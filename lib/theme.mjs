// Colours, glyphs and thresholds. No Node APIs.
// They began as the tokens of the approved status bar mock, which is kept in the first build's records.
// The look has changed since at the user's word, so this file is the reference now.

const families = {
  dark: { Fable: '#ee9bd6', Opus: '#b6a0f2', Sonnet: '#8db4f5', Haiku: '#7fd3e0' },
  light: { Fable: '#a8388c', Opus: '#6a48c0', Sonnet: '#2f5fb8', Haiku: '#0f6f82' },
};

// The mascot: each creature's body, and the marks drawn on it.
const mascot = {
  dark: {
    cap: '#f0807a', spot: '#f2efe8', stem: '#ead9b8', slime: '#8fce8b', chick: '#f2d16b', beak: '#e0906f',
    bunny: '#f2efe8', frog: '#8fce8b', eye: '#f2efe8', cat: '#e0906f', bear: '#c9a27a', penguin: '#f4a3cc',
    ink: '#141312', sweat: '#9fd0f5',
  },
  light: {
    cap: '#d9534c', spot: '#ffffff', stem: '#e3d2ad', slime: '#5fb46a', chick: '#e8bd3a', beak: '#d07434',
    bunny: '#cdc5b6', frog: '#5fb46a', eye: '#ffffff', cat: '#d98455', bear: '#b08659', penguin: '#e884b6',
    ink: '#23221f', sweat: '#3f8fc4',
  },
};

const themes = {
  dark: {
    bg: '#141312', text: '#e9e6df', mid: '#b3aea4', dim: '#8c8880', hairline: '#3a3732',
    ok: '#8fce8b', caution: '#e6c173', needsYou: '#f0807a', accent: '#e0906f',
    resourceUsed: '#cfcabf', contextTrack: '#3a3732',
    ...families.dark, ...mascot.dark,
  },
  light: {
    bg: '#f6f3ec', text: '#23221f', mid: '#55524c', dim: '#6f6b63', hairline: '#d6cfc2',
    ok: '#2f7d45', caution: '#8a5a12', needsYou: '#b9382f', accent: '#b5532f',
    resourceUsed: '#55524c', contextTrack: '#d6cfc2',
    ...families.light, ...mascot.light,
  },
};

export const glyphs = {
  mark: '◆', running: '●', needsYou: '⚑', paused: '▮▮', finished: '✓',
  stageDone: '✓', stageNow: '›', stageNext: '○', barOn: '▰', barOff: '▱',
  worker: '→', orchestrator: '◈', collapsed: '▸', expanded: '▾', markLine: '|',
  warn: '▲', withYou: '★', rule: '│', minus: '−',
};

export const stages = ['Brainstorm', 'Spec', 'Plan', 'Build', 'Review', 'Ship'];

export const thresholds = {
  usageMarkPercent: 75,
  contextYellowFrom: 70, contextRedFrom: 85,
  runShareYellowFrom: 15, runShareRedFrom: 30,
  agentQuietAfterMinutes: 5, agentStalledAfterMinutes: 15,
  narrowBelowColumns: 44,
};

// Motion fades a colour towards the background: "accent@60" is 60% accent over the background, and
// "resourceUsed@60/contextTrack" 60% of it over another colour (a bar's last, part-filled cell).
export function hex(theme, name) {
  const t = themes[theme] ?? themes.dark;
  const [base, mix] = String(name).split('@');
  const c = t[base];
  if (!c || mix === undefined) return c;
  const [level, over] = mix.split('/');
  const under = t[over] ?? t.bg;
  const a = Number(level) / 100;
  const ch = i => Math.round(parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16) * a + parseInt(under.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - a));
  return '#' + [0, 1, 2].map(i => ch(i).toString(16).padStart(2, '0')).join('');
}
