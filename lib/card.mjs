// The LCW card: buildView turns run state into a view, renderCard turns a view into rows. No Node APIs.
import { duration, modelName, family, tokens, pad, padStart, len, clip, wrap, resetsIn, dollars } from './format.mjs';
import { isOpenWave } from './banner.mjs';
import { glyphs as G, stages as STAGES, thresholds as TH } from './theme.mjs';

const sp = (t, c, o) => ({ t, ...(c ? { c } : {}), ...o });
const DOT = () => sp(' · ', 'dim');
// What each stage does, for a person's first runs.
const GUIDE = { Brainstorm: 'agreeing with you what to build; the one step that needs you', Spec: 'writing down what you agreed; two reviewers check it cold',
  Plan: 'splitting the work into tasks that can run side by side', Build: 'workers write the code, milestone by milestone; a reviewer checks each one',
  Review: 'fresh reviewers check the work against what you agreed', Ship: 'writing the draft pull request for you',
  Charter: 'agreeing the rules of the sweep with you; the one step that needs you', Hunt: 'probes look for what to fix, area by area; nothing is changed yet' };
// A sweep has its own Ship line: under one pull request at the end a wave opens none.
const SWEEP_GUIDE = { Ship: "landing the wave on the sweep's branch" };
// A sweep's charter, line by line, in the order it is agreed.
const CHARTER = ['goals', 'non-goals', 'anti-goals', 'no-go zones', 'changes', 'proof', 'park', 'stop', 'waves', 'PRs'];
// A count from state, where lcw set may have stored anything: not a count is none.
const num = x => Math.max(0, Math.floor(Number(x) || 0));
const HIDDEN = ['completed', 'done', 'failed', 'killed', 'stopped', 'cancelled'];
const SHARE_COLOUR = n => (n >= TH.runShareRedFrom ? 'needsYou' : n >= TH.runShareYellowFrom ? 'caution' : 'mid');
const shareText = n => (Math.round(n) < 1 ? '<1%' : '≈ ' + Math.round(n) + '%') + ' of your week';
// On pay-per-token billing the run's share is its own spend.
const runText = usd => (Math.round(usd) < 1 ? '<$1' : '≈ ' + dollars(usd)) + ' this run';
const clock = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

// ---------------------------------------------------------------- view

// A figure that moved rolls from the old value to the new one over half a second, fast at first, then settling.
const ROLL_MS = 500;
function rolled(a, now) {
  const x = (now - (a.movedAt ?? -Infinity)) / ROLL_MS;
  if (!Number.isFinite(a.tokens) || !Number.isFinite(a.tokensWas) || !(x >= 0 && x < 1)) return a.tokens;
  return Math.round(a.tokensWas + (a.tokens - a.tokensWas) * (1 - (1 - x) * (1 - x)));
}

function agentTree(agents, now, ui) {
  const live = agents.filter(a => !HIDDEN.includes(a.status));
  const ids = new Set(live.map(a => a.id));
  const nodes = new Map(live.map(a => {
    const quiet = a.status === 'waiting' ? 0 : (a.quietMs ?? 0);
    return [a.id, {
      id: a.id, desc: a.description ?? '', model: modelName(a.model), effort: a.effort ?? '',
      tokens: Number.isFinite(a.tokens) ? rolled(a, now) : null,
      spark: Array.isArray(a.spark) ? a.spark : null,
      elapsed: duration(now - (a.startTime ?? now)),
      chip: quiet >= TH.agentStalledAfterMinutes * 6e4 ? 'stalled' : quiet >= TH.agentQuietAfterMinutes * 6e4 ? 'quiet' : null,
      expanded: !!ui.expanded?.[a.id], kids: [],
    }];
  }));
  const tops = [];
  for (const a of live) {
    const n = nodes.get(a.id);
    (ids.has(a.parentId) ? nodes.get(a.parentId).kids : tops).push(n);
  }
  return { tops, count: live.length, inFlight: [...nodes.values()].reduce((s, n) => s + (n.tokens ?? 0), 0) };
}

const count = (list, s) => list.filter(x => x.status === s).length;

function detail(state, stage, sweep) {
  const tasks = state.tasks ?? [];
  const reqs = state.requirements ?? [];
  const sw = state.sweep ?? {};
  if (stage === 'Brainstorm' && state.intent) return { k: 'intent', ...state.intent };
  if (stage === 'Charter') {
    const n = Math.min(CHARTER.length, num(sw.charter));
    return { k: 'intent', label: 'charter', settled: CHARTER.slice(0, n), now: CHARTER[n] ?? '', next: CHARTER.slice(n + 1), questionsOpen: num(sw.open) };
  }
  if (stage === 'Hunt') {
    const h = sw.hunt ?? {};
    const fix = num(h.fix), park = num(h.park), drop = num(h.drop);
    if (fix + park + drop) return { k: 'sorted', fix, park, drop, waves: sweep.queued };
    const done = num(h.hunted), running = num(h.running), left = Math.max(0, num(h.areas) - done - running);
    return done + running + left ? { k: 'hunt', done, running, left, total: done + running + left, findings: num(h.findings) } : null;
  }
  if (stage === 'Spec') return { k: 'blind', ...state.blindReview, spec: state.spec };
  if (stage === 'Plan' && state.plan) return { k: 'plan', ...state.plan };
  if (stage === 'Review' && reqs.length) {
    const failing = reqs.find(r => r.status === 'failing');
    // A partly fixed fix has been reviewed, so it is not to go; only the sweep's fixed count leaves it out.
    const pass = count(reqs, 'pass') + count(reqs, 'partial'), fail = count(reqs, 'failing'), toGo = count(reqs, 'todo');
    return pass + fail + toGo ? { k: 'reqs', label: sweep ? 'fixes' : 'requirements', pass, failing: fail, toGo, total: pass + fail + toGo,
      failingName: failing ? failing.id + ' ' + failing.name : '' } : null;
  }
  if ((stage === 'Build' || stage === 'Ship') && tasks.length) {
    const done = count(tasks, 'done'), running = count(tasks, 'running'), left = count(tasks, 'todo'), parked = count(tasks, 'parked'), dropped = count(tasks, 'dropped');
    return { k: 'tasks', done, running, left, parked, dropped, total: done + running + left + parked + dropped };
  }
  return null;
}

// The stages a wave goes through, which the lanes' tracks stand under.
const WAVE_STAGES = STAGES.sweep.slice(2);

// One open wave as its lane draws it. A wave with a stage of its own carries its own tasks, fixes and plan; a running
// wave with none, as an older run left it, takes the run's. A held wave (shipped, its pull request not yet merged)
// stays at Ship, merging, and its fixes and dropped are already in the sweep's totals.
function waveView(w, i, state, now, held) {
  const own = held || (typeof w.stage === 'string' && w.stage !== '');
  const stage = held ? 'Ship' : own ? w.stage : state.stage ?? '';
  const tasks = (own ? w.tasks : state.tasks) ?? [], reqs = (own ? w.requirements : state.requirements) ?? [], plan = own ? w.plan : state.plan;
  // step: what the wave does once past its stages ("closures", "final checks", "merging"). waiting: it waits on the person.
  const waiting = !!w.waiting, step = held ? 'merging' : w.step ? String(w.step) : '';
  let d = null;
  if (!waiting && !step) {
    if (stage === 'Build') {
      const done = count(tasks, 'done'), running = count(tasks, 'running'), left = count(tasks, 'todo'), parked = count(tasks, 'parked'), dropped = count(tasks, 'dropped');
      d = { k: 'tasks', done, running, left, parked, dropped, total: done + running + left + parked + dropped };
    } else if (stage === 'Review') {
      const pass = count(reqs, 'pass') + count(reqs, 'partial'), failing = count(reqs, 'failing'), toGo = count(reqs, 'todo');
      d = { k: 'reqs', pass, failing, toGo, total: pass + failing + toGo };
    } else if (stage === 'Plan' && plan?.tasks != null) d = { k: 'plan', tasks: plan.tasks, atOnce: plan.atOnce };
  }
  const since = Number(own ? w.stageSince : state.stageSince);
  return { n: num(w.n) || i + 1, stage, step, waiting, round: num(w.round), d, since: Number.isFinite(since) ? duration(now - since) : '',
    running: count(tasks, 'running'), passing: held || stage !== 'Ship' ? 0 : count(reqs, 'pass'), dropped: held ? 0 : num(w.dropped) };
}

// What a sweep has come to so far, and its open waves: running, or shipped but not yet merged while the charter merges
// as it goes. An open wave counts once it is far enough along: its passing fixes once in Ship, its dropped fixes at once.
function sweepOf(state, now) {
  const s = state.sweep ?? {};
  const waves = Array.isArray(s.waves) ? s.waves : [];
  // A finished run holds no wave open: one whose pull request was left for the person is just a pull request.
  const isOpen = w => state.status !== 'finished' && isOpenWave(state, w);
  const open = waves.flatMap((w, i) => (isOpen(w) ? [waveView(w, i, state, now, w.status !== 'running')] : []));
  return {
    open, huntAge: state.stage === 'Hunt' ? duration(now - (state.stageSince ?? now)) : '',
    round: num(s.round), shipped: waves.filter(w => w.status === 'shipped' && !isOpen(w)).length, queued: count(waves, 'queued'),
    fixed: num(s.fixed) + open.reduce((n, w) => n + w.passing, 0),
    parked: num(s.parked), dropped: num(s.dropped) + open.reduce((n, w) => n + w.dropped, 0),
    // One pull request at the end is the run's own, not a wave's.
    prs: waves.some(w => num(w.pr)) ? waves.filter(w => num(w.pr)).map(w => ({ number: num(w.pr), merged: !!w.merged }))
      : num(state.pr?.number) ? [{ number: num(state.pr.number), merged: false }] : [],
  };
}

// The run's week figures as of this reading. A week that has ended since weekResetsAt was stored is folded
// into shareBefore (what the run used of it, from the last figure seen), and the new week starts at 0.
export function weekOf(state, week) {
  const w = { shareBefore: state.shareBefore ?? 0, weekAtStart: state.weekAtStart ?? null, weekResetsAt: state.weekResetsAt ?? null, weekUsed: state.weekUsed ?? null };
  const next = Date.parse(week?.resetsAt), was = Date.parse(w.weekResetsAt);
  if (!Number.isFinite(next) || next < was) return w;
  if (next > was) {
    const last = w.weekUsed ?? w.weekAtStart;
    if (Number.isFinite(last) && Number.isFinite(w.weekAtStart)) w.shareBefore += Math.max(0, last - w.weekAtStart);
    w.weekAtStart = 0;
    w.weekUsed = null;
  }
  w.weekResetsAt = week.resetsAt;
  if (Number.isFinite(week.percentUsed)) w.weekUsed = Math.max(w.weekUsed ?? 0, week.percentUsed);
  return w;
}

// The run's share of the week in percent, or null when the start figure or the reading is unknown.
export function weekShare(state, week) {
  const w = weekOf(state, week);
  return Number.isFinite(week?.percentUsed) && Number.isFinite(w.weekAtStart) ? w.shareBefore + Math.max(0, week.percentUsed - w.weekAtStart) : null;
}

export function buildView({ state = {}, agents = [], usage = null, gate = null, money = null, now = Date.now(), ui = {} } = {}) {
  const status = state.status ?? 'running';
  const finished = status === 'finished';
  const paused = !finished && (!!gate || status === 'paused');
  const asks = finished ? [] : (state.asks ?? []).map(a => ({ n: a.n, text: a.text, age: duration(now - (a.at ?? now)) }));
  const week = usage?.sevenDay ?? null;
  const resetAt = Date.parse(week?.resetsAt ?? gate?.resetsAt ?? '');
  const stage = state.stage ?? '';
  const shape = state.shape === 'sweep' ? 'sweep' : 'build';
  const sweep = shape === 'sweep' ? sweepOf(state, now) : null;
  const cur = STAGES[shape].indexOf(stage);
  const guideOf = (sweep && SWEEP_GUIDE[stage]) || GUIDE[stage];
  const reqs = state.requirements ?? [];
  const totals = state.totals ?? {};
  const tree = agentTree(agents, now, ui);
  const share = money ? null : weekShare(state, week);
  // The run's own spend: the finished totals once it is over, else the live figure.
  const runUsd = !money ? null : [finished ? totals.usd : money.runUsd].find(Number.isFinite) ?? null;
  const pausedBy = state.pausedReason !== 'human' && (gate || state.pausedReason === 'mark') ? 'mark' : 'human';
  return {
    name: state.name ?? state.id ?? '',
    shape,
    stage,
    // While waves are open each lane says how long it has stood at its stage, so the title says how long the sweep has run.
    titleRight: finished ? duration((state.finishedAt ?? now) - (state.createdAt ?? now)) : sweep?.open.length ? duration(now - (state.createdAt ?? now))
      : stage ? duration(now - (state.stageSince ?? now)) + ' in ' + stage : '',
    mode: finished ? 'finished' : paused ? 'paused' : status === 'with-you' ? 'with-you' : status === 'stopped' ? 'stopped' : 'running',
    frame: asks.length ? 'needsYou' : paused ? 'caution' : finished ? 'ok' : 'hairline',
    health: state.health == null ? '' : String(state.health),
    // On pay-per-token billing the share is of the cap, which colours it; runUsd is what the row says.
    share: money ? (runUsd === null ? null : Math.round(runUsd / money.capUsd * 100))
      : finished && Number.isFinite(totals.sharePercent) ? totals.sharePercent
      : share === null ? null : Math.round(share),
    runUsd,
    mark: Math.round(state.markPercent ?? gate?.markPercent ?? TH.usageMarkPercent),
    pausedBy,
    resumesIn: !money && pausedBy === 'mark' && Number.isFinite(resetAt) ? resetsIn((resetAt - now) / 36e5) : '',
    // The pause at a dollar mark: the mark, the figure the hint offers (the mark and a tenth of the cap), and the next try.
    money: money ? { mark: dollars(money.markUsd), hint: dollars(money.markUsd + money.capUsd / 10),
      retryAt: Number.isFinite(money.retryAt) ? clock(money.retryAt) : '', retried: !!money.retried } : null,
    asks,
    stages: STAGES[shape].map((name, i) => ({ name, st: finished || i < cur ? 'done' : i === cur ? 'now' : 'next' })),
    // A finished sweep's last wave says nothing of the whole sweep.
    detail: finished && sweep ? null : detail(state, stage, sweep),
    sweep,
    // A finished card says what came of the run, not what the stage is doing.
    guide: !finished && state.guide === true && guideOf ? stage + ' · ' + guideOf : '',
    closing: finished ? {
      pass: reqs.filter(r => r.status === 'pass').length, total: reqs.length,
      decisions: state.closing?.decisionsToCheck ?? 0, parked: state.closing?.parked ?? 0, pr: state.pr ?? null,
      agents: totals.agents ?? 0, tokens: totals.tokens ?? 0,
    } : null,
    running: sweep?.open.length ? sweep.open.reduce((n, w) => n + w.running, 0) : count(state.tasks ?? [], 'running'),
    agents: finished ? [] : tree.tops,
    agentCount: finished ? 0 : tree.count,
    inFlight: tree.inFlight,
    moreOpen: !!ui.moreOpen,
  };
}

// ---------------------------------------------------------------- motion (all of it a colour fading, or cells filling)

const level = (c, op) => { const l = Math.round(op * 10) * 10; return l >= 100 ? c : c + '@' + l; };
// 1 at the start of each period, min half way through, back to 1.
const wave = (tick, period, phase, min) => {
  if (tick == null) return 1;
  const x = (((tick + phase) / period) % 1 + 1) % 1;
  return min + (1 - min) * Math.abs(1 - 2 * x);
};
const shimmer = (tick, i) => {
  const t = (((tick - i * 1.4) / 18) % 1 + 1) % 1;
  return t < 0.55 ? 0.6 + 0.4 * Math.max(0, 1 - Math.abs(t - 0.28) / 0.28) : 0.6;
};

// Segments [count, glyph, colour, kind]; on first draw (small tick) cells appear three to a tick.
function bar(segs, tick) {
  let revealed = tick == null ? Infinity : tick * 3;
  const out = [];
  for (const [n, ch, c, kind] of segs) {
    if (n <= 0) continue;
    const shown = Math.max(0, Math.min(n, Math.floor(revealed)));
    revealed -= n;
    if (tick != null && kind === 'shimmer') {
      for (let i = 0; i < n; i++) out.push(sp(i < shown ? ch : ' ', level(c, shimmer(tick, i))));
    } else if (tick != null && kind === 'pulse') {
      out.push(sp(ch.repeat(shown) + ' '.repeat(n - shown), level(c, wave(tick, 14, 0, 0.35))));
    } else out.push(sp(ch.repeat(shown) + ' '.repeat(n - shown), c));
  }
  return out;
}

// ---------------------------------------------------------------- rows

const text = spans => spans.map(s => s.t).join('');
// lcw set stores what it is given, so a list may arrive as one value: one value is a list of one.
const list = x => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]);

const groups = (l, r = []) => [...l, ...r.map((s, i) => (i ? s : { ...s, r: true }))];
const stageMark = (name, st) => (st === 'done' ? [sp(G.stageDone + ' ', 'ok'), sp(name, 'mid')]
  : st === 'now' ? [sp(G.stageNow + ' ', 'accent', { b: true }), sp(name, 'text', { b: true })] : [sp(G.stageNext + ' ' + name, 'dim')]);
const stageRow = v => v.stages.flatMap((s, i) => [...(i ? [sp('  ', 'dim')] : []), ...stageMark(s.name, s.st)]);

function counts(d) {
  const out = [];
  const add = (t, c) => { if (out.length) out.push(DOT()); out.push(sp(t, c)); };
  if (d.done) add(d.done + ' done', 'text');
  if (d.running) add(d.running + ' running', 'accent');
  if (d.left) add(d.left + ' left', 'mid');
  if (d.parked) add(d.parked + ' parked', 'caution');
  if (d.dropped) add(d.dropped + ' dropped', 'mid');
  return out;
}
// Spans joined by dim dots.
const dotted = parts => parts.flatMap((p, i) => (i ? [DOT(), p] : [p]));
function share3(d, cells) {
  const done = Math.round(cells * d.done / d.total);
  const run = d.running ? Math.max(1, Math.round(cells * d.running / d.total)) : 0;
  return [done, Math.min(run, cells - done)];
}

function detailRows(v, tick, narrow, width = Infinity) {
  const d = v.detail;
  if (!d) return [];
  if (d.k === 'tasks') {
    const cells = narrow ? 16 : 24;
    const [done, run] = share3(d, cells);
    const b = bar([[done, G.barOn, 'ok'], [run, G.barOn, 'accent', 'shimmer'], [cells - done - run, G.barOff, 'dim']], tick);
    return narrow ? [b, counts(d)] : [[sp('tasks ', 'dim'), ...b, sp('  ', 'dim'), ...counts(d)]];
  }
  if (narrow) return [];
  if (d.k === 'reqs') {
    const [pass, fail] = [Math.round(20 * d.pass / d.total), d.failing ? Math.max(1, Math.round(20 * d.failing / d.total)) : 0];
    const b = bar([[pass, G.barOn, 'ok'], [fail, G.barOn, 'caution', 'pulse'], [20 - pass - fail, G.barOff, 'dim']], tick);
    const c = [];
    const add = (t, col) => { if (c.length) c.push(DOT()); c.push(sp(t, col)); };
    if (d.pass) add(d.pass + ' pass', 'text');
    if (d.failing) add(d.failing + ' failing', 'caution');
    if (d.toGo) add(d.toGo + ' to go', 'mid');
    const left = [sp(d.label + ' ', 'dim'), ...b, sp('  ', 'dim'), ...c];
    // The failing requirement's name gives way, so the bar and the counts beside it stay whole.
    const room = width - len(text(left)) - 2 - len('failing: ');
    return [groups(left, d.failingName && room >= 6 ? [sp('failing: ', 'dim'), sp(clip(d.failingName, room), 'text')] : [])];
  }
  if (d.k === 'intent') {
    const items = [
      ...list(d.settled).map(t => [sp(G.stageDone + ' ', 'ok'), sp(String(t), 'mid')]),
      ...(d.now ? [[sp(G.stageNow + ' ', 'accent', { b: true }), sp(String(d.now), 'text', { b: true })]] : []),
      ...list(d.next).map(t => [sp(G.stageNext + ' ' + t, 'dim')]),
    ];
    const q = d.questionsOpen;
    const right = q ? [sp(q + (q === 1 ? ' question open' : ' questions open'), 'text')] : [];
    // The newest stay in view: where the row is too wide the oldest give way, and a "…" after the label says so.
    const row = (from) => [sp((d.label ?? 'intent') + '  ', 'dim'), ...(from ? [sp('…  ', 'dim')] : []),
      ...items.slice(from).flatMap((it, i) => (i ? [sp('  ', 'dim'), ...it] : it))];
    const room = width - (right.length ? len(text(right)) + 2 : 0);
    let from = 0;
    while (from < items.length - 1 && len(text(row(from))) > room) from++;
    return items.length || q ? [groups(row(from), right)] : [];
  }
  if (d.k === 'hunt') {
    const [done, run] = share3(d, 24);
    const b = bar([[done, G.barOn, 'ok'], [run, G.barOn, 'accent', 'shimmer'], [24 - done - run, G.barOff, 'dim']], tick);
    const c = [d.done && sp(d.done + ' hunted', 'text'), d.running && sp(d.running + ' running', 'accent'), d.left && sp(d.left + ' left', 'mid')].filter(Boolean);
    return [groups([sp('areas ', 'dim'), ...b, sp('  ', 'dim'), ...dotted(c)], [sp(d.findings + (d.findings === 1 ? ' finding' : ' findings') + ' so far', 'text')])];
  }
  if (d.k === 'sorted') {
    const c = [d.fix && sp(d.fix + ' to fix', 'text'), d.park && sp(d.park + ' parked', 'caution'), d.drop && sp(d.drop + ' dropped', 'mid')].filter(Boolean);
    return [groups([sp('findings  ', 'dim'), ...dotted(c)], d.waves ? [sp(d.waves + (d.waves === 1 ? ' wave' : ' waves') + ' queued', 'text')] : [])];
  }
  if (d.k === 'blind') {
    const l = [sp('blind review  ', 'dim')];
    for (const r of list(d.done)) {
      l.push(sp(G.stageDone + ' ', 'ok'), sp('reviewer ' + r.reviewer, 'mid'));
      if (r.caught) l.push(sp(' · ' + r.caught, 'dim'));
      l.push(sp('  ', 'dim'));
    }
    if (d.now) l.push(sp(G.stageNow, level('accent', wave(tick, 26, 0, 0.55)), { b: true }), sp(' ', 'accent', { b: true }),
      sp('reviewer ' + d.now.reviewer, 'text', { b: true }), sp(' reviewing', 'dim'));
    else if (l.length > 1) l.pop();
    const s = d.spec ?? {};
    const nums = [s.requirements != null && sp(s.requirements + ' requirements', 'text'), s.scenarios != null && sp(s.scenarios + ' scenarios', 'text')].filter(Boolean);
    return l.length > 1 || nums.length ? [groups(l, nums.flatMap((p, i) => (i ? [DOT(), p] : [p])))] : [];
  }
  if (d.k === 'plan') {
    const first = [...(d.tasks != null ? [sp(d.tasks + ' tasks', 'text')] : []), ...(d.atOnce ? [sp('up to ' + d.atOnce + ' at once', 'text')] : [])];
    const out = first.length ? [first.flatMap((p, i) => (i ? [DOT(), p] : [p]))] : [];
    const models = Object.entries(d.models ?? {});
    if (models.length) out.push([sp('models ', 'dim'), ...models.flatMap(([m, n], i) => [...(i ? [DOT()] : []), sp(m + ' ' + n, family(m) ?? 'mid')])]);
    return out;
  }
  return [];
}

function askRows(v, width, narrow, tick) {
  if (!v.asks.length) return [];
  const one = v.asks.length === 1;
  const head = [sp(G.needsYou, level('needsYou', wave(tick, 14, 0, 0.35)), { b: true }),
    sp(' needs you' + (one ? '' : ' · ' + v.asks.length), 'needsYou', { b: true }), ...(one ? [sp(' · ' + v.asks[0].age, 'dim')] : [])];
  if (narrow) return [head, [sp(clip(v.asks[0].text, width), 'text')]];
  if (one) return [head, ...wrap(v.asks[0].text, Math.min(70, width)).map(t => [sp(t, 'text')]),
    [sp('answer in plain words below', 'dim')]];
  return [head, ...v.asks.map(a => groups([sp(String(a.n), 'text', { b: true }), sp('  ' + clip(a.text, width - len(a.n) - 2 - len(a.age) - 3), 'text')], [sp(a.age, 'dim')])),
    [sp('answer in plain words below, e.g. ', 'dim'), sp('“1 yes, 2 UTC”', 'text')]];
}

// What came of a sweep's pull requests: all open, all merged, or merged up to the first wave that was left open.
function sweepPrs(prs) {
  const span = l => '#' + l[0].number + (l.length > 1 ? ' to #' + l.at(-1).number : '');
  const open = prs.filter(p => !p.merged), merged = prs.length - open.length;
  const one = prs.length === 1;
  if (!merged) return [sp(' · ' + prs.length + (one ? ' draft PR, ' : ' draft PRs, '), 'text'), sp(span(prs), 'text', { b: true }),
    sp(one ? ', is open for your review' : ', are open for your review', 'text')];
  if (!open.length) return [sp(' · ' + merged + (one ? ' PR merged, ' : ' PRs merged, '), 'text'), sp(span(prs), 'text', { b: true }), sp(', as your charter allows', 'text')];
  return [sp(' · ' + merged + (merged === 1 ? ' PR merged · ' : ' PRs merged · '), 'text'), sp(span(open), 'text', { b: true }),
    sp(open.length === 1 ? ' is open for your review' : ' are open for your review', 'text')];
}

function stateRows(v, narrow, tick, hideMarkHint) {
  const shareR = v.share === null ? [] : [sp(v.runUsd === null ? shareText(v.share) : runText(v.runUsd), SHARE_COLOUR(v.share))];
  const health = narrow ? v.health.split(' · ')[0] : v.health;
  const why = health ? [sp(' · ' + health, 'dim')] : [];
  const mk = (g, c, period, min) => sp(g, level(c, wave(tick, period, 0, min)), { b: true });
  if (v.mode === 'finished') {
    const c = v.closing, pr = c.pr, s = v.sweep;
    const l = [sp(G.finished, 'ok', { b: true }), sp(' finished', 'ok', { b: true })];
    if (s?.prs.length) l.push(...sweepPrs(s.prs));
    else if (pr?.number) l.push(sp(' · draft PR ', 'text'), sp('#' + pr.number, 'text', { b: true }), sp(' is open for your review', 'text'));
    else if (pr?.branch) l.push(sp(' · branch ' + pr.branch + ' is ready for your review', 'text'));
    if (narrow) return [l];
    if (s) return [l, dotted([sp(s.fixed + ' fixed', 'mid'), s.parked ? sp(s.parked + ' parked for you, in parked.md', 'text') : sp('nothing parked', 'mid'),
      ...(s.dropped ? [sp(s.dropped + ' dropped', 'mid')] : [])])];
    const parts = [];
    if (c.total) parts.push(sp(c.pass + ' of ' + c.total + ' requirements pass', 'mid'));
    parts.push(c.decisions ? sp(c.decisions + (c.decisions === 1 ? ' decision' : ' decisions') + ' for you to check', 'text') : sp('no decisions to check', 'mid'));
    parts.push(c.parked ? sp(c.parked + ' parked', 'caution') : sp('nothing parked', 'mid'));
    return [l, parts.flatMap((p, i) => (i ? [DOT(), p] : [p]))];
  }
  if (v.mode === 'paused') {
    const byMark = v.pausedBy === 'mark';
    const l = [mk(G.paused, 'caution', 28, 0.35), sp(byMark ? ' paused at your ' + (v.money?.mark ?? v.mark + '%') + ' mark' : ' paused by you', 'caution', { b: true })];
    if (narrow) return [l];
    // At a 100% mark there is no higher mark to offer.
    // A dollar mark can go past the cap, so its hint is always offered.
    const hint = hideMarkHint && byMark ? []
      : byMark && !v.money && (v.mark ?? TH.usageMarkPercent) >= 100 ? []
      : byMark
      ? [sp('say ', 'dim'), sp('“run up to ' + (v.money?.hint ?? Math.min(100, (v.mark ?? TH.usageMarkPercent) + 10) + '%') + '”', 'text'), sp(' to carry on now', 'dim')]
      : [sp('say ', 'dim'), sp('“carry on”', 'text'), sp(' to resume', 'dim')];
    const back = !byMark || !v.money?.retryAt ? [] : [sp((v.money.retried ? 'still over · tries again at ' : 'resumes at ') + v.money.retryAt, 'text')];
    return [groups(l, v.money ? back : v.resumesIn ? [sp('resumes in ' + v.resumesIn, 'text')] : []),
      [sp('nothing new starts · ' + (v.running === 1 ? 'the running task finishes and merges first'
        : v.running ? 'the ' + v.running + ' running tasks finish and merge first' : 'no task is running'), 'dim')], ...(hint.length ? [hint] : [])];
  }
  if (v.mode === 'stopped') return [[sp('■ stopped', 'dim')]];
  const l = v.mode === 'with-you'
    ? [mk(G.withYou, 'accent', 32, 0.55), sp(' with you', 'accent', { b: true }), ...why]
    : [sp(G.running, level('ok', wave(tick, 14, 0, 0.35))), sp(' ', 'ok'), sp('running', 'text'), ...why];
  return [narrow ? l : groups(l, shareR)];
}

// ---- agents

const NAME_W = 10, EFFORT_W = 8;

// What an agent did over its last eight 20-second spans, oldest on the left: a bar as tall as the tokens it
// gained in that span, against the most any agent shown gained in one. A span with nothing is the lowest bar, and
// spans not yet sampled are dim. Without samples (the card drawn by the status line) the cells stay dim.
const SPARK = '▁▂▃▄▅▆▇█', SPARK_W = 8;
function sparkline(n, most) {
  const s = (n.spark ?? []).slice(-SPARK_W), c = n.chip === 'stalled' ? 'needsYou' : n.chip === 'quiet' ? 'caution' : 'accent';
  // On a square-root scale, so one large read does not flatten every other span to the floor.
  const cells = s.map(v => (v > 0 ? SPARK[Math.max(1, Math.min(7, Math.round(7 * Math.sqrt(v / most))))] : SPARK[0]));
  return [sp(SPARK[0].repeat(SPARK_W - s.length), 'dim'), sp(cells.join(''), c)].filter(x => x.t);
}

function agentRow(n, depth, base, idx, tick, maxTok, descCol) {
  const orch = n.kids.length > 0;
  const view = { id: 'view:' + n.id };
  const caret = sp((n.expanded ? G.expanded : G.collapsed) + ' ', 'accent', { id: 'toggle:' + n.id });
  const before = orch ? [sp(' '.repeat(2 * depth)), caret] : [sp(' '.repeat(base + 2 * depth))];
  const glyph = orch
    ? sp(G.orchestrator, level('accent', wave(tick, 26, idx * 4.2, 0.55)), { b: true, ...view })
    : sp(G.worker, n.chip === 'stalled' ? 'needsYou' : n.chip === 'quiet' ? 'caution' : level('accent', wave(tick, 26, idx * 4.2, 0.55)), view);
  const button = [glyph, sp(' ', 'accent', view)];
  const w = descCol - len(text(before)) - len(text(button));
  const left = [...before, ...button, sp(pad(clip(n.desc, w - 1), w), 'text', { b: orch, ...view }),
    sp(pad(n.model, NAME_W) + ' ', family(n.model) ?? 'mid'), sp(pad(n.effort, EFFORT_W), 'dim')];
  let right;
  if (n.tokens === null) right = [sp(padStart('—', 16), 'dim'), sp(padStart(n.elapsed, 8), 'dim')];
  else {
    right = [...sparkline(n, maxTok), sp(padStart(tokens(n.tokens), 6), 'text')];
    if (n.chip) {
      const t = ' ' + G.warn + ' ' + n.elapsed + ' ';
      right.push(sp(' '.repeat(Math.max(0, 8 - len(t)))),
        sp(t, 'bg', { b: true, bg: n.chip === 'stalled' ? level('needsYou', wave(tick, 14, 0, 0.35)) : 'caution' }));
    } else right.push(sp(padStart(n.elapsed, 8), 'dim'));
  }
  return groups(left, right);
}

function narrowAgent(n, width, tick) {
  const view = { id: 'view:' + n.id };
  const meta = [n.effort, ...(n.tokens === null ? [] : [tokens(n.tokens)]), n.chip ? G.warn + ' ' + n.elapsed : n.elapsed].filter(Boolean);
  return [
    [sp(G.worker, n.chip === 'stalled' ? 'needsYou' : n.chip === 'quiet' ? 'caution' : level('accent', wave(tick, 26, 0, 0.55)), view), sp(' ', 'accent', view),
      sp(clip(n.desc, width - 2), 'text', view)],
    [sp('  '), sp(family(n.model) ?? n.model, family(n.model) ?? 'mid'), sp(' · ' + meta.join(' · '), n.chip ? (n.chip === 'stalled' ? 'needsYou' : 'caution') : 'dim')],
  ];
}

// Entries are {rows, weight}: weight is how many agents the entry stands for if it is dropped.
function agentEntries(v) {
  const entries = [];
  let hidden = 0;
  const any = (list) => list.some(n => n.kids.length || any(n.kids));
  const below = (n) => n.kids.reduce((s, k) => s + 1 + below(k), 0);
  const base = any(v.agents) ? 2 : 0;
  const walk = (n, depth) => {
    entries.push({ n, depth, weight: 1 });
    if (!n.kids.length) return;
    if (!(n.expanded || v.moreOpen)) { hidden += below(n); return; }
    const shown = v.moreOpen ? n.kids : n.kids.slice(0, 3);
    shown.forEach(k => walk(k, depth + 1));
    if (shown.length < n.kids.length) entries.push({ more: n.kids.length - shown.length, depth: depth + 1, weight: n.kids.length - shown.length });
  };
  v.agents.forEach(n => walk(n, 0));
  return { entries, hidden, base };
}

function agentSection(v, opts, narrow, budget) {
  if (!v.agents.length) return [];
  const more = { id: 'more' };
  if (narrow) {
    const rest = v.agentCount - 1;
    return [...narrowAgent(v.agents[0], opts.width, opts.tick), ...(rest > 0 ? [[sp(G.collapsed + ' ', 'accent'), sp(rest + ' more', 'mid', more)]] : [])];
  }
  let { entries, hidden, base } = agentEntries(v);
  const moreRow = () => hidden > 0 || v.moreOpen;
  while (entries.length + (moreRow() ? 1 : 0) > budget && entries.length) {
    const e = entries.pop();
    hidden += e.weight;
  }
  const maxTok = Math.max(1, ...entries.flatMap(e => e.n?.spark ?? []));
  // The description takes all the room there is, so the model and effort stand just left of the sparkline.
  const descCol = Math.max(20, opts.width - (opts.frame ? 4 : 0) - NAME_W - 1 - EFFORT_W - 22 - 2);
  const workersRow = e => {
    const label = [sp(G.collapsed + ' ', 'accent', more), sp(e.more + (e.more === 1 ? ' more worker' : ' more workers'), 'mid', more)];
    return [sp(' '.repeat(base + 2 * e.depth)), ...label];
  };
  const rows = entries.map((e, i) => e.more ? workersRow(e) : agentRow(e.n, e.depth, base, i, opts.tick, maxTok, descCol));
  if (moreRow() && budget >= 1) {
    const flight = v.inFlight > 0 ? [sp(tokens(v.inFlight) + ' tokens in flight', 'dim')] : [];
    rows.push(groups(v.moreOpen
      ? [sp(G.expanded + ' ', 'accent'), sp('fewer agents', 'mid', more)]
      : [sp(G.collapsed + ' ', 'accent'), sp(hidden + (hidden === 1 ? ' more agent' : ' more agents'), 'mid', more)], flight));
  }
  return rows;
}

function totalsRow(v) {
  const c = v.closing, s = v.sweep;
  const parts = [...(s ? [sp(s.round + (s.round === 1 ? ' round' : ' rounds'), 'mid'), sp(s.shipped + (s.shipped === 1 ? ' wave' : ' waves'), 'mid')] : []),
    sp(c.agents + ' agents', 'mid'), sp(tokens(c.tokens) + ' tokens', 'mid')];
  if (v.share !== null) parts.push(sp(v.runUsd === null ? shareText(v.share) : runText(v.runUsd), 'mid'));
  return [dotted(parts)];
}

// ---- a sweep's waves

const most = (list, of) => Math.max(0, ...list.map(of));
// The sweep's waves as cells, one for each, at most so many: merged, open, queued.
function waveCells(s, tick, atMost) {
  const n = s.shipped + s.open.length + s.queued, cells = Math.min(n, atMost);
  const [done, run] = share3({ done: s.shipped, running: s.open.length, total: n }, cells);
  return bar([[done, G.barOn, 'ok'], [run, G.barOn, 'accent', 'shimmer'], [cells - done - run, G.barOff, 'dim']], tick);
}
// "open", not "running": a wave that waits on its final checks or on the person is open and not running.
const waveCounts = (s, open = true) => [s.shipped && [s.shipped, 'merged', 'text'], open && s.open.length && [s.open.length, 'open', 'accent'],
  s.queued && [s.queued, 'queued', 'mid']].filter(Boolean);
// What the sweep has come to, each only when not zero; `less` names the ones to leave out.
const totalsOf = (s, less = []) => dotted([!less.includes('round') && s.round && sp('round ' + s.round, 'text'), !less.includes('fixed') && s.fixed && sp(s.fixed + ' fixed', 'text'),
  !less.includes('parked') && s.parked && sp(s.parked + ' parked', 'caution'), !less.includes('dropped') && s.dropped && sp(s.dropped + ' dropped', 'mid')].filter(Boolean));
// Where the row is short the totals give way: the dropped first, then the round, then the parked.
function totalsFor(s, room) {
  const go = ['dropped', 'round', 'parked', 'fixed'];
  for (let k = 0; k <= go.length; k++) { const t = totalsOf(s, go.slice(0, k)); if (len(text(t)) <= room) return t; }
  return [];
}

// The waves row: its label, the waves as cells, how many are merged, open and queued, and on the right what the sweep
// has come to. With open waves it is also the lanes' heading (laneRows), and gives way to the room it is given.
function wavesRow(v, tick, label = 6, inner = Infinity) {
  const s = v.sweep, n = s.shipped + s.open.length + s.queued, name = sp(pad('waves', label), 'dim');
  if (!n) return groups([name, sp('none queued yet', 'dim')], totalsOf(s));
  // Where the counts do not fit, whole ones go and never a word is cut: the open count first, then the queued, then the merged.
  const head = [name, ...waveCells(s, tick, 24)];
  const lefts = [[], ['open'], ['open', 'queued'], ['open', 'queued', 'merged']].map(less => {
    const counts = waveCounts(s).filter(c => !less.includes(c[1]));
    return counts.length || !less.length ? [...head, sp('  ', 'dim'), ...dotted(counts.map(([k, t, c]) => sp(k + ' ' + t, c)))] : head;
  });
  const left = lefts.find(l => len(text(l)) <= inner) ?? head;
  return groups(left, totalsFor(s, inner - len(text(left)) - 2));
}

// The hunt of a new round can start while the last waves are still open: it gets a lane of its own.
// Before any area is recorded it is a hunt of none: an empty track, starting.
const huntOf = v => (v.stage !== 'Hunt' ? null : v.detail && (v.detail.k === 'hunt' || v.detail.k === 'sorted') ? v.detail
  : { k: 'hunt', done: 0, running: 0, left: 0, total: 0, findings: 0 });
// A count of nothing draws its cells empty, never as finished.
const emptyBar = cells => [sp(G.barOff.repeat(cells), 'dim')];
function huntBar(d, cells, tick) {
  if (d.k !== 'hunt') return bar([[cells, G.barOn, 'ok']], tick);
  if (!d.total) return emptyBar(cells);
  const [done, run] = share3(d, cells);
  return bar([[done, G.barOn, 'ok'], [run, G.barOn, 'accent', 'shimmer'], [cells - done - run, G.barOff, 'dim']], tick);
}

// A wave's progress as cells: tasks done and running, or fixes passing and failing.
function waveBar(d, cells, tick) {
  if (!d.total) return emptyBar(cells);
  if (d.k === 'tasks') {
    const [done, run] = share3(d, cells);
    return bar([[done, G.barOn, 'ok'], [run, G.barOn, 'accent', 'shimmer'], [cells - done - run, G.barOff, 'dim']], tick);
  }
  const pass = Math.round(cells * d.pass / d.total), fail = Math.min(cells - pass, d.failing ? Math.max(1, Math.round(cells * d.failing / d.total)) : 0);
  return bar([[pass, G.barOn, 'ok'], [fail, G.barOn, 'caution', 'pulse'], [cells - pass - fail, G.barOff, 'dim']], tick);
}

// ---- the lanes: under the heading, a track for each open wave

const waveName = w => 'wave ' + w.n;
const roundName = v => 'round ' + v.sweep.round;
// The label column: "waves", "wave 1", "round 2", each two cells clear of what follows. The number is what the eye looks for, so it is lit.
const labelCells = v => Math.max(len('waves'), most(v.sweep.open, w => len(waveName(w))), huntOf(v) ? len(roundName(v)) : 0) + 2;
const nameLabel = (kind, n, L) => [sp(kind + ' ', 'dim'), sp(pad(String(n), L - kind.length - 1), 'text')];

// What a lane says after its track. A wave at work has a figure, n of m, with its noun and verb, then what else is
// worth a word: tasks running, a fix failing, a later review round. A lane not at work says what it waits for.
function sayOf(v, w) {
  if (!w) {
    const d = huntOf(v);
    if (d.k === 'hunt' && !d.total) return { words: [sp('starting', 'text')], brief: [sp('starting', 'text')] };
    return d.k !== 'hunt' ? { words: dotted([d.fix && sp(d.fix + ' to fix', 'text'), d.park && sp(d.park + ' parked', 'caution'), d.drop && sp(d.drop + ' dropped', 'mid')].filter(Boolean)),
      brief: [sp(d.fix + ' to fix', 'text')] }
      : { n: d.done, m: d.total, noun: 'areas', verb: 'hunted',
        more: [...(d.running ? [[d.running, 'running', 'accent']] : []), [d.findings, (d.findings === 1 ? 'finding' : 'findings') + ' so far', 'text']] };
  }
  if (w.waiting) return { waiting: true };
  if (w.step) return { words: [sp(w.step, 'text')], brief: [sp(w.step.replace('final ', ''), 'text')] };
  if (w.stage === 'Ship') return { words: [sp('final checks next', 'dim')], brief: [sp('checks next', 'dim')] };
  const d = w.d;
  if (!d || (d.k !== 'plan' && !d.total)) return { words: [], brief: [] };
  if (d.k === 'tasks') return { n: d.done, m: d.total, noun: 'tasks', verb: 'done', more: d.running ? [[d.running, 'running', 'accent']] : [] };
  if (d.k === 'reqs') return { n: d.pass, m: d.total, noun: 'fixes', verb: 'pass',
    more: [...(d.failing ? [[d.failing, 'failing', 'caution', true]] : []), ...(w.round > 1 ? [[null, 'round ' + w.round, 'mid']] : [])] };
  return { words: dotted([sp(d.tasks + ' tasks', 'text'), ...(d.atOnce ? [sp('up to ' + d.atOnce + ' at once', 'text')] : [])]), brief: [sp(d.tasks + ' tasks', 'text')] };
}
// The figures stand in columns down the lanes: every number right-aligned, the words under one another.
// form 0: "18 of 23 fixes pass · 1 failing · round 2". 1: without the noun. 2: without what follows but a failing fix,
// the last to go. 3: the figure alone.
const moreOf = (s, form) => (form < 2 ? s.more : form === 2 ? s.more.filter(m => m[3]) : []);
function sayColumns(says, form) {
  const figs = says.filter(s => s.m != null), words = s => (form === 0 ? s.noun + ' ' + s.verb : s.verb);
  const more = figs.map(s => moreOf(s, form));
  return { words, n: most(figs, s => len(s.n)), m: most(figs, s => len(s.m)),
    w: most(figs.filter((s, i) => more[i].length), s => len(words(s))), x: most(more.filter(m => m[0]?.[0] != null), m => len(m[0][0])) };
}
function saySpans(s, form, col) {
  if (s.waiting) return [sp(G.needsYou + ' ', 'needsYou', { b: true }), sp(form < 2 ? 'waits on your answer' : 'waits on you', 'needsYou')];
  if (s.m == null) return form < 3 ? s.words : s.brief;
  const fig = [sp(padStart(s.n, col.n) + ' of ' + padStart(s.m, col.m), 'text')];
  if (form === 3) return fig;
  const more = moreOf(s, form), w = col.words(s);
  return [...fig, sp(' ' + (more.length ? pad(w, col.w) : w), 'mid'),
    ...more.flatMap(([n, t, c], i) => [DOT(), sp((n == null ? '' : (i ? String(n) : padStart(n, col.x)) + ' ') + t, c)])];
}

// A wave's track: a segment under each stage's name in the heading, as wide as the name with its mark. Full and
// green where the wave is past the stage, filled as far as its tasks or fixes have come where it stands, empty ahead.
function laneTrack(w, tick, cellsOf) {
  const cur = WAVE_STAGES.indexOf(w.stage);
  return WAVE_STAGES.flatMap((name, i) => {
    const cells = cellsOf(name);
    const seg = i < cur ? bar([[cells, G.barOn, 'ok']], tick) : i > cur ? emptyBar(cells)
      : w.waiting ? [sp(G.barOn.repeat(cells), 'needsYou')] : !w.step && w.d && w.d.k !== 'plan' ? waveBar(w.d, cells, tick)
      : bar([[cells, G.barOn, 'accent', 'pulse']], tick);
    return [...(i ? [sp(cellsOf.gap, 'dim')] : []), ...seg];
  });
}
// Between the tracks and what the lanes say: four cells, so the heading's counts do not read as one more stage.
const GUTTER = '    ';
function laneRows(v, tick, inner) {
  const s = v.sweep, open = s.open, hunt = huntOf(v), L = labelCells(v);
  // The heading: the wave's four stages, marked as the stage row marks them. A stage every open wave is past is done.
  const first = Math.min(...open.map(w => WAVE_STAGES.indexOf(w.stage)));
  const heads = WAVE_STAGES.flatMap((name, i) => [...(i ? [sp('  ', 'dim')] : []), ...stageMark(name, open.some(w => w.stage === name) ? 'now' : i < first ? 'done' : 'next')]);
  const cellsOf = Object.assign(name => len(name) + 2, { gap: '  ' }), across = len(text(heads));
  const lanes = [...open.map(w => ({ label: nameLabel('wave', w.n, L), track: laneTrack(w, tick, cellsOf), say: sayOf(v, w), since: w.since })),
    // The hunt's lane: its name where a wave's first segment stands, and one bar across the rest.
    ...(hunt ? [{ label: nameLabel('round', s.round, L), say: sayOf(v, null), since: s.huntAge,
      track: [sp(G.stageNow + ' ', 'accent', { b: true }), sp('Hunt', 'text', { b: true }), sp('  ', 'dim'), ...huntBar(hunt, across - len('Hunt') - 4, tick)] }] : [])];
  const row = (l, form) => {
    const said = saySpans(l.say, form, sayColumns(lanes.map(x => x.say), form));
    return groups([...l.label, ...l.track, ...(said.length ? [sp(GUTTER, 'dim'), ...said] : [])], l.since ? [sp(l.since, 'dim')] : []);
  };
  const form = [0, 1, 2, 3].find(f => lanes.every(l => len(text(row(l, f))) + 2 <= inner));
  // Too narrow for the heading and its tracks, at about 60 columns: the waves row, and the lanes of the narrow layout.
  if (form === undefined) return [wavesRow(v, tick, L, inner), ...narrowLanes(v, tick)];
  // The heading is the waves row too: how many are merged, open and queued stand in the figures' column, the first
  // number under the figures' own, and the sweep's totals on the right. Where the row is short the open count goes
  // first (the lanes show it); after that the counts move closer, out of the figures' column, before anything else
  // goes: the dropped and the round from the totals, and last the counts.
  const col = sayColumns(lanes.map(l => l.say), form);
  const counted = open => dotted(waveCounts(s, open).map(([n, t, k], i) => sp((i ? n : padStart(n, col.n)) + ' ' + t, k)));
  const label = [sp(pad('waves', L), 'dim'), ...heads];
  const head = (counts, totals, gap = GUTTER) => groups([...label, ...(counts.length ? [sp(gap, 'dim'), ...counts] : [])], totals);
  const fits = r => len(text(r)) + (r.some(x => x.r) ? 2 : 0) <= inner;
  const tries = [[true, []], [false, []], [true, ['dropped']], [false, ['dropped']], [false, ['dropped', 'round']]]
    .flatMap(([o, less], k) => [head(counted(o), totalsOf(s, less)),
      ...(k ? [head(counted(o).map((x, i) => (i ? x : { ...x, t: x.t.trimStart() })), totalsOf(s, less), '  ')] : [])])
    .concat([head([], totalsOf(s))]);
  return [tries.find(fits) ?? head([], totalsFor(s, inner - len(text(label)) - 2)), ...lanes.map(l => row(l, form))];
}
// Narrow: no room for the heading, so each lane ends in the name of the stage it stands at. Three cells a stage.
function narrowLanes(v, tick) {
  const s = v.sweep, hunt = huntOf(v), L = labelCells(v), cellsOf = Object.assign(() => 3, { gap: ' ' });
  return [...s.open.map(w => [...nameLabel('wave', w.n, L), ...laneTrack(w, tick, cellsOf), sp('  ', 'dim'),
    ...(w.waiting ? [sp(G.needsYou + ' ', 'needsYou', { b: true }), sp('waiting', 'needsYou')] : w.step ? [sp(w.step.replace('final ', ''), 'text')] : [sp(w.stage, 'text', { b: true })])]),
  ...(hunt ? [[...nameLabel('round', s.round, L), ...huntBar(hunt, 4 * 3 + 3, tick), sp('  ', 'dim'), sp('Hunt', 'text', { b: true })]] : [])];
}

// ---------------------------------------------------------------- card


// Spans less n cells from their end.
function cut(spans, n) {
  const out = [...spans];
  while (n > 0 && out.length) {
    const s = out.pop(), k = len(s.t);
    if (k > n) out.push({ ...s, t: clip(s.t, k - n) });
    n -= k;
  }
  return out;
}

// A row wider than the card loses the end of its left group; the right group stays, cut only if it alone is too wide.
function fit(row, inner) {
  const k = row.findIndex(s => s.r);
  const l = k < 0 ? row : row.slice(0, k), r = k < 0 ? [] : row.slice(k);
  const w = spans => len(text(spans));
  const right = w(r) > inner - 2 ? cut(r, w(r) - (inner - 2)) : r;
  const over = w(l) - (inner - (right.length ? w(right) + 2 : 0));
  return over > 0 ? [...cut(l, over), ...right] : [...l, ...right];
}

const kind = v => (v.shape === 'sweep' ? 'LCW Sweep · ' : 'LCW Build · ');
const titleSpans = v => [sp(G.mark + ' ', 'accent'), sp(kind(v), 'dim'), sp(v.name, 'text', { b: true })];

export function renderCard(v, opts = {}) {
  const width = opts.width ?? 100;
  const narrow = width < TH.narrowBelowColumns;
  const framed = !!opts.frame && !narrow;
  const tick = opts.tick;
  const inner = framed ? width - 4 : width;
  const o = { ...opts, width, frame: framed };

  // While a wave is open the waves row is the stage heading and each open wave has a lane in place of the stage and detail rows.
  const lanes = v.sweep?.open.length > 0 && v.mode !== 'finished';
  const title = narrow
    ? [groups([sp(G.mark + ' ', 'accent'), sp(v.name, 'text', { b: true }), ...(lanes ? [] : [sp(' ' + G.stageNow + ' ', 'accent', { b: true }), sp(v.stage, 'text')])],
      lanes ? [sp('waves ', 'dim'), ...waveCells(v.sweep, tick, 12)] : [])]
    : framed ? [] : [groups(titleSpans(v), v.titleRight ? [sp(v.titleRight, 'dim')] : [])];
  // Otherwise a sweep's waves stand above its stages once the charter is agreed, until it is finished.
  const waves = v.sweep && v.mode !== 'finished' && v.stage !== 'Charter' ? [wavesRow(v, tick)] : [];
  const stageSection = guide => (lanes ? laneRows(v, tick, inner)
    : [...waves, stageRow(v), ...(guide && v.guide ? [[sp(v.guide, 'dim')]] : []), ...detailRows(v, tick, false, inner)]);
  const build = guide => narrow
    ? [[...title, ...askRows(v, inner, true, tick), ...stateRows(v, true, tick, opts.hideMarkHint),
      ...(lanes ? narrowLanes(v, tick) : detailRows(v, tick, true, inner))]]
    : [
      [...title, ...(v.asks.length ? askRows(v, inner, false, tick) : stateRows(v, false, tick, opts.hideMarkHint))],
      ...(v.asks.length ? [stateRows(v, false, tick, opts.hideMarkHint)] : []),
      stageSection(guide),
    ];
  const layout = guide => {
    const sections = build(guide);
    if (!narrow && v.closing) sections.push(totalsRow(v));
    sections.forEach((s, i) => { sections[i] = s.map(r => fit(r, inner)); });
    const fixed = sections.reduce((n, s) => n + s.length, 0) + (framed ? sections.length + 2 : 0);
    return { sections, fixed };
  };
  // The stage line is the first row to go: it stays only when the whole card fits with it.
  const fits = opts.maxRows == null || !v.guide || narrow || (() => {
    const l = layout(true);
    return l.fixed + (v.closing ? 0 : agentSection(v, o, narrow, Infinity).length) <= opts.maxRows;
  })();
  const { sections, fixed } = layout(fits);
  const budget = opts.maxRows == null ? Infinity : opts.maxRows - fixed;
  const agents = v.closing ? [] : agentSection(v, o, narrow, budget);
  if (agents.length) sections.push(agents.map(r => fit(r, inner)));
  if (!framed) return sections.flat();

  const b = v.frame === 'needsYou' ? level('needsYou', wave(tick, 28, 0, 0.45)) : v.frame;
  const edge = (l, r) => [sp(l + '─'.repeat(width - 2) + r, b)];
  const rule = edge('├', '┤');
  const rows = [];
  const t = titleSpans({ ...v, name: clip(v.name, width - 9 - len(G.mark + ' ' + kind(v)) - len(v.titleRight)) });
  const fill = Math.max(1, width - 8 - len(text(t)) - len(v.titleRight));
  rows.push([sp('╭─ ', b), ...t, sp(' ' + '─'.repeat(fill) + ' ', b), sp(v.titleRight, 'dim'), sp(' ─╮', b)]);
  sections.forEach((sec, i) => {
    if (i) rows.push(rule);
    // A row with a right group keeps it, the border joining it; any other row is padded to the border here.
    for (const r of sec) {
      rows.push(r.some(s => s.r) ? [sp('│ ', b), ...r, sp(' │', b)]
        : [sp('│ ', b), ...r, sp(' '.repeat(Math.max(0, inner - len(text(r)))) + ' │', b)]);
    }
  });
  rows.push(edge('╰', '╯'));
  return rows;
}
