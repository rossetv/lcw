import type { Row } from './paint.mjs';
import type { RenderOpts, Money } from './status.mjs';

export interface AgentInput {
  id: string; description?: string; model?: string; effort?: string;
  tokens?: number | null;       // null or missing: shown as a dash (the card without the mod)
  startTime?: number; parentId?: string | null;
  status?: string;              // "waiting" (on its own background work, a plan's approval or an agent) is never quiet; completed, done, failed, killed, stopped, cancelled are not shown
  quietMs?: number;             // how long its token count has not moved
  heldMs?: number;              // how long it has stayed listed since its turn ended, with no live agent of its own
  spark?: number[];             // tokens gained in each of its last 20-second spans, oldest first (the mod keeps them)
  tokensWas?: number;           // the figure its tokens moved from, at movedAt: the card rolls up from it
  movedAt?: number | null;
  wave?: number | null;         // the wave of a sweep it works for, where known: it is listed under that wave's lane
  held?: boolean;               // its turn has ended and it is still listed: not at work
}
export interface AgentNode {
  id: string; desc: string; model: string; effort: string; tokens: number | null; spark: number[] | null; elapsed: string;
  /** quiet and stalled: at work with no tokens moving; held: reported fifteen minutes ago or more and not ended. */
  chip: 'quiet' | 'stalled' | 'held' | null; expanded: boolean; kids: AgentNode[]; wave: number | null;
  /** Why a worker is not at work, said in its sparkline's place: it has reported and not ended, or it waits. */
  rest: 'reported' | 'waiting' | null;
}
/** One open wave as its lane draws it: running, or shipped and waiting on its merge while the charter merges as it goes (then at Ship, step 'merging'). */
export interface OpenWave {
  n: number; stage: string;
  /** What the wave does past its stages: 'closures' (in Review), 'final checks' or 'merging' (in Ship), else ''. */
  step: string;
  /** True while the wave waits on the person's answer. */
  waiting: boolean; round: number;
  /** True while the person has folded the wave's agents away. */
  folded?: boolean;
  /** Why the wave has no agent at work, as the orchestrator recorded it, else ''; and whether none is at work for it now. */
  waits?: string; sits?: boolean;
  /** Its figure while at work: tasks in Build, fixes in Review, the plan in Plan; null otherwise. */
  d: { k: 'tasks' | 'reqs' | 'plan'; [key: string]: unknown } | null;
  /** How long it has stood at its stage. */
  since: string;
  /** Running tasks, passing fixes counted once at Ship (0 for a wave shipped already), and dropped fixes (0 likewise). */
  running: number; passing: number; dropped: number;
  /** Its pull request's number, else 0; and, while merging, the open wave before it that it lands after, else 0. */
  pr: number; after: number;
}
export interface SweepView {
  /** Waves that have merged, and waves still queued. */
  round: number; shipped: number; queued: number;
  /** True while the run hunts in an early round, one entered with a wave short of Ship, which cannot end the sweep. */
  early: boolean;
  /** The front queued wave, which starts next, and the fixes it holds; null with none queued. */
  next: { n: number; fixes: number } | null;
  /** The open waves, in wave order: each has a lane while there is one. */
  open: OpenWave[];
  /** How long the sweep's hunt has stood at Hunt, else ''. */
  huntAge: string;
  /** Totals so far: fixed counts each open wave's passing fixes once it is in Ship, dropped its dropped fixes at once. */
  fixed: number; parked: number; dropped: number;
  /** The waves' pull requests, oldest first, or the run's one pull request when no wave has its own. */
  prs: { number: number; merged: boolean }[];
}
export interface View {
  /** 'sweep' only when state.shape says so; a run with no shape is a build. */
  name: string; shape: 'build' | 'sweep'; stage: string;
  /** How long the run has run, a build or a sweep at whatever stage; once finished, how long it took. */
  titleRight: string;
  mode: 'running' | 'with-you' | 'paused' | 'finished' | 'stopped';
  /** The colour of the frame: 'needsYou' with open asks, 'caution' paused, 'ok' finished, else 'hairline'. */
  frame: 'needsYou' | 'caution' | 'ok' | 'hairline';
  /** share is a percent of the week, or on pay-per-token billing of the weekly cap (it colours the row); runUsd, when not null, is what the row says: "≈ $86 this run". */
  health: string; share: number | null; runUsd: number | null; mark: number | null;
  /** The week's figure, and how many times the run went past a rule of LCW's process with --bypass (state.bypasses). */
  used: number; bypasses: number;
  /** Pay-per-token billing, else null: the mark and the "run up to" figure as text, and when a paused run tries again ("08:00", or '' when unknown). */
  money: { mark: string; hint: string; retryAt: string; retried: boolean } | null;
  quota: import('./quota.mjs').QuotaView | null;
  pausedBy: 'mark' | 'human'; resumesIn: string;   // 'human': paused by the human, no countdown
  /** The open asks that hold the run; forYou counts those that hold nothing (lcw ask --no-wait). */
  asks: { n: number; text: string; age: string; wave: number }[];   // wave: the wave it is about, else 0
  forYou: number;
  stages: { name: string; st: 'done' | 'now' | 'next' }[];
  detail: { k: string; [key: string]: unknown } | null;
  /** A sweep's waves and totals; null for a build. */
  sweep: SweepView | null;
  closing: { pass: number; total: number; decisions: number; parked: number; pr: { number?: number; url?: string; branch?: string } | null; agents: number; tokens: number } | null;
  /** Running tasks: the open waves' added up in a sweep. */
  running: number;
  agents: AgentNode[]; agentCount: number; inFlight: number; moreOpen: boolean;
}
export interface BuildInput {
  state?: Record<string, any>;   // state.json
  agents?: AgentInput[];
  usage?: { sevenDay?: { percentUsed: number; resetsAt: string } | null } | null;
  gate?: Record<string, any> | null;
  /** The pay-per-token view; null on subscription or unclear billing, and then everything is as it was. */
  quota?: import('./quota.mjs').QuotaView | null;
  money?: Money | null;
  now?: number;
  /** folded: the waves whose agents the person folded away, by foldKey. */
  ui?: { expanded?: Record<string, boolean>; moreOpen?: boolean; folded?: Record<string, boolean> };
}

export function buildView(input?: BuildInput): View;
/** The name a folded wave is kept under in ui.folded. */
export function foldKey(runId: string | undefined, wave: number): string;
/** The name a folded hunt round's lane is kept under in ui.folded. */
export function roundFoldKey(runId: string | undefined, round: number): string;
export interface WeekFigures { shareBefore: number; weekAtStart: number | null; weekResetsAt: string | null; weekUsed: number | null }
/** The run's week figures for this reading: a week that has ended since weekResetsAt is folded into shareBefore. */
export function weekOf(state: Record<string, any>, week?: { percentUsed?: number; resetsAt?: string | null } | null): WeekFigures;
/** shareBefore + max(0, used - weekAtStart), or null when either figure is unknown. */
export function weekShare(state: Record<string, any>, week?: { percentUsed?: number; resetsAt?: string | null } | null): number | null;
/**
 * The card as rows. opts.frame draws the box (not below 44 columns); opts.maxRows drops agent rows first
 * and says "N more agents"; opts.tick (the time in 100 ms units, 0 on the card's first draw, which is when the bars fill)
 * moves the colours, and opts.beat (the time in seconds) pulses them slowly instead; without either everything
 * holds still. A row wider than the card loses the end of its left group.
 * A sweep with an open wave draws the waves row as the stage heading and one lane for each open wave (a hunt round
 * running beside them has its own); below about 60 columns the lanes are compact, and below 44 columns the narrow layout's.
 * Action ids on spans: toggle:<agentId> (the caret), view:<agentId> (the glyph and the description), more.
 */
export function renderCard(view: View, opts?: RenderOpts): Row[];
