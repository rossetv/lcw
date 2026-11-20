import type { Row } from './paint.mjs';
import type { RenderOpts, Money } from './status.mjs';

export interface AgentInput {
  id: string; description?: string; model?: string; effort?: string;
  tokens?: number | null;       // null or missing: shown as a dash (the card without the mod)
  startTime?: number; parentId?: string | null;
  status?: string;              // "waiting" is never quiet or stalled; completed, done, failed, killed, stopped, cancelled are not shown
  quietMs?: number;             // how long its token count has not moved
  spark?: number[];             // tokens gained in each of its last 20-second spans, oldest first (the mod keeps them)
  tokensWas?: number;           // the figure its tokens moved from, at movedAt: the card rolls up from it
  movedAt?: number | null;
}
export interface AgentNode {
  id: string; desc: string; model: string; effort: string; tokens: number | null; spark: number[] | null; elapsed: string;
  chip: 'quiet' | 'stalled' | null; expanded: boolean; kids: AgentNode[];
}
export interface View {
  name: string; stage: string; titleRight: string;
  mode: 'running' | 'with-you' | 'paused' | 'finished' | 'stopped';
  /** The colour of the frame: 'needsYou' with open asks, 'caution' paused, 'ok' finished, else 'hairline'. */
  frame: 'needsYou' | 'caution' | 'ok' | 'hairline';
  /** share is a percent of the week, or on pay-per-token billing of the weekly cap (it colours the row); runUsd, when not null, is what the row says: "≈ $86 this run". */
  health: string; share: number | null; runUsd: number | null; mark: number | null;
  /** Pay-per-token billing, else null: the mark and the "run up to" figure as text, and when a paused run tries again ("08:00", or '' when unknown). */
  money: { mark: string; hint: string; retryAt: string; retried: boolean } | null;
  pausedBy: 'mark' | 'human'; resumesIn: string;   // 'human': paused by the human, no countdown
  asks: { n: number; text: string; age: string }[];
  stages: { name: string; st: 'done' | 'now' | 'next' }[];
  detail: { k: string; [key: string]: unknown } | null;
  closing: { pass: number; total: number; decisions: number; parked: number; pr: { number?: number; url?: string; branch?: string } | null; agents: number; tokens: number } | null;
  running: number;
  agents: AgentNode[]; agentCount: number; inFlight: number; moreOpen: boolean;
}
export interface BuildInput {
  state?: Record<string, any>;   // state.json
  agents?: AgentInput[];
  usage?: { sevenDay?: { percentUsed: number; resetsAt: string } | null } | null;
  gate?: Record<string, any> | null;
  /** The pay-per-token view; null on subscription or unclear billing, and then everything is as it was. */
  money?: Money | null;
  now?: number;
  ui?: { expanded?: Record<string, boolean>; moreOpen?: boolean };
}

export function buildView(input?: BuildInput): View;
export interface WeekFigures { shareBefore: number; weekAtStart: number | null; weekResetsAt: string | null; weekUsed: number | null }
/** The run's week figures for this reading: a week that has ended since weekResetsAt is folded into shareBefore. */
export function weekOf(state: Record<string, any>, week?: { percentUsed?: number; resetsAt?: string | null } | null): WeekFigures;
/** shareBefore + max(0, used - weekAtStart), or null when either figure is unknown. */
export function weekShare(state: Record<string, any>, week?: { percentUsed?: number; resetsAt?: string | null } | null): number | null;
/**
 * The card as rows. opts.frame draws the box (not below 44 columns); opts.maxRows drops agent rows first
 * and says "N more agents"; opts.tick (ten a second, 0 on the card's first draw, which is when the bars fill)
 * moves the colours; without it everything holds still. A row wider than the card loses the end of its left group.
 * Action ids on spans: toggle:<agentId> (the caret), view:<agentId> (the glyph and the description), more.
 */
export function renderCard(view: View, opts?: RenderOpts): Row[];
