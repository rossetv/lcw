import type { Row } from './paint.mjs';
import type { ThemeName } from './theme.mjs';

/** The pay-per-token view: dollars in place of the share of the week. null (or missing) on subscription or unclear billing. */
export interface Money {
  spentUsd: number; todayUsd: number; ratePerDay: number; capUsd: number; capAssumed: boolean;
  markUsd: number; markShare: number | null;
  /** The pace over the next seven days: how many dollars under (spare) or over (short) the cap. */
  pace: { usd: number; short: boolean };
  atMark: boolean;
  /** The run's own spend; the card's "≈ $86 this run". */
  runUsd?: number;
  /** When a paused run tries again (epoch ms), and whether a try has already found the spend still over the mark. */
  retryAt?: number; retried?: boolean;
  /** Present while the spend command's reading is the week's figure: the reading, when it was taken (epoch ms), what LCW counted since, and whether the command is failing (the right part then says so). */
  command?: { readingUsd: number; at: number; sinceUsd: number; failing: boolean; failingSince: number | null; lastError: string | null };
}

export interface StatusInput {
  model?: string;              // a display name ("Fable 5.2") or an id ("claude-sonnet-5-5")
  effort?: string;
  contextPercent?: number;
  contextWindow?: number | string;   // 1000000 or "1M"
  repo?: string;
  branch?: string;
  weekUsedPercent?: number | null;
  /** How much of the seven days has passed. "resets in" and the pace come from this. */
  weekElapsedPercent?: number | null;
  markPercent?: number | null;
  /** On pay-per-token billing: the row shows the spend, a gauge as wide as the larger of the cap and the mark, the mark and the pace in dollars; weekUsedPercent, weekElapsedPercent and markPercent are not used. */
  money?: Money | null;
  /** Lines added and removed in the checkout; a column at the right edge when either is above 0. */
  diff?: { added: number; removed: number } | null;
}
export interface RenderOpts { /** The clock, epoch ms; the failing spend command's age is counted to it. Defaults to the time now. */ now?: number; width?: number; theme?: ThemeName; frame?: boolean; tick?: number; maxRows?: number; /** Leave out the card's "say run up to ..." hint while a banner offers the same choice. */ hideMarkHint?: boolean }

/** Two rows: model and context; then the week gauge, with the used figure on its left, the usage mark as a line inside it and the mark's figure on its right. The gauge and its two figures are as wide as the model, effort and context group above. A third row, "resets in", when width is below 44. With a diff, added over removed in a column at the right edge, one space after a thin rule, which gives way before the repo and branch are shortened. */
export function renderStatusRows(input?: StatusInput, opts?: RenderOpts): Row[];
