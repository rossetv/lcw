// Builds render inputs for the sample states of fixtures.json, beside this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const all = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures.json', import.meta.url)), 'utf8'));
export const fixtures = all.boards;
/** A pay-per-token money view of the sample states, with changes. */
export const moneyOf = (name, more) => ({ ...all.money[name], ...more });
export const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);

const MS = { d: 864e5, h: 36e5, m: 6e4, s: 1e3 };
const ms = (text = '') => [...text.matchAll(/(\d+)([dhms])/g)].reduce((n, m) => n + m[1] * MS[m[2]], 0);
const count = text => { const m = /^([\d.]+)([kM]?)$/.exec(text); return m ? m[1] * (m[2] === 'k' ? 1e3 : m[2] === 'M' ? 1e6 : 1) : null; };
const list = (n, status, mk) => Array.from({ length: n }, (_, i) => ({ id: 'T' + i, status, ...mk?.(i) }));

function agentsOf(f, board) {
  const out = [];
  const add = (a, extra) => out.push({
    id: 'a' + out.length, description: a.reason, model: a.model, effort: a.effort,
    tokens: board === 'NoMod' ? null : count(a.tokens), startTime: NOW - ms(a.elapsed),
    status: 'running', quietMs: a.state === 'quiet' ? 6 * MS.m : a.state === 'stalled' ? 20 * MS.m : 0, spark: a.spark, ...extra,
  });
  for (const a of f.agents ?? []) {
    add(a);
    if (a.role !== 'orchestrator') continue;
    const parentId = out[out.length - 1].id;
    // The orchestrators' workers are not on the Many agents board, so both boards share the data of the open one.
    for (const w of a.workers ?? fixtures.AgentsOpen.agents.find(x => x.reason === a.reason)?.workers ?? []) add(w, { parentId });
    const hidden = a.moreWorkers ?? (a.reason.includes('billing') ? fixtures.AgentsOpen.agents[0].moreWorkers : fixtures.AgentsOpen.more.agents);
    for (let i = 0; i < hidden; i++) out.push({ id: 'h' + out.length, description: 'hidden', model: 'Haiku 5.5', effort: 'low', tokens: 5000, startTime: NOW - 6e4, status: 'running', parentId });
  }
  return out;
}

export function inputsOf(board) {
  const f = fixtures[board];
  const s = f.status;
  const finished = f.state === 'finished';
  const paused = (f.state ?? '').startsWith('paused');
  const byHuman = f.state === 'paused by you';
  const state = {
    id: f.run, name: f.run, stage: finished ? 'Ship' : f.stage,
    stageSince: NOW - ms(f.titleRight), createdAt: NOW - ms(f.titleRight), finishedAt: finished ? NOW : null,
    status: finished ? 'finished' : paused ? 'paused' : f.state === 'with you' ? 'with-you' : f.state === 'stopped' ? 'stopped' : 'running',
    pausedReason: byHuman ? 'human' : paused ? 'mark' : null, guide: f.guide, shape: f.shape, sweep: f.sweep, health: f.health ?? '', markPercent: s.markPercent,
    weekAtStart: s.weekUsedPercent - (f.sharePercent ?? 0),
    intent: f.intent, blindReview: f.blindReview, spec: f.spec,
    plan: f.plan && { tasks: f.plan.tasks, atOnce: f.plan.atOnce, models: f.plan.models },
    tasks: f.tasks ? [...list(f.tasks.done, 'done'), ...list(f.tasks.running, 'running'), ...list(f.tasks.left, 'todo'), ...list(f.tasks.dropped ?? 0, 'dropped')] : [],
    asks: (f.asks ?? []).map((a, i) => ({ n: i + 1, text: a.text, at: NOW - ms(a.age) })),
    pr: f.pr, closing: f.closing && { decisionsToCheck: f.closing.decisionsToCheck, parked: f.closing.parked },
    totals: f.totals && { agents: f.totals.agents, tokens: count(f.totals.tokens), sharePercent: f.totals.sharePercent },
  };
  if (f.requirements) {
    const r = f.requirements, [id, ...name] = (r.failingName ?? '').split(' ');
    state.requirements = [...list(r.pass, 'pass', i => ({ id: 'R' + i, name: 'x' })), ...(id ? [{ id, name: name.join(' '), status: 'failing' }] : []), ...list(r.toGo ?? 0, 'todo')];
  }
  if (f.closing) state.requirements = list(Number(f.closing.requirementsPass.split(' ')[0]), 'pass', i => ({ id: 'R' + i, name: 'x' }));
  const hours = (100 - s.weekElapsedPercent) / 100 * 168;
  const usage = { sevenDay: { percentUsed: s.weekUsedPercent, resetsAt: new Date(NOW + hours * MS.h).toISOString() } };
  const ui = { expanded: Object.fromEntries(agentsOf(f, board).filter((a, i) => (f.agents ?? []).some(x => x.expanded && x.reason === a.description)).map(a => [a.id, true])) };
  const status = { model: s.model, effort: s.effort, contextPercent: s.contextPercent, contextWindow: s.contextWindow, repo: s.repo,
    branch: s.branch, weekUsedPercent: s.weekUsedPercent, weekElapsedPercent: s.weekElapsedPercent, markPercent: s.markPercent };
  return { state, agents: agentsOf(f, board), usage, gate: paused && !byHuman ? { reason: 'mark', resetsAt: usage.sevenDay.resetsAt } : null, now: NOW, ui, status };
}
