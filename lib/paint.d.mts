import type { ThemeName } from './theme.mjs';

/**
 * One piece of a row. c and bg are colour names of the theme (fades such as "ok@60" included).
 * Beyond the contract's {t, c, bg, b, id}:
 *   r      starts the row's right-aligned group: this span and every span after it.
 *   plain  what toPlain prints in place of t (the context bar is "[bar 38%]" there, drawn as coloured cells).
 *   href   a link; toAnsi writes an OSC 8 hyperlink and underlines it.
 */
export interface Span { t: string; c?: string; bg?: string; b?: boolean; id?: string; r?: boolean; plain?: string; href?: string }
/** A row is a list of spans. The span with r: true starts the right-aligned group. */
export type Row = Span[];

/** Plain text, for tests and logs: one row per line, the two groups joined by "   ||   ", trailing spaces dropped. */
export function toPlain(rows: Row[]): string;
/** Truecolor text. With cols the right group of each row sits against column cols; without, three spaces after the left group. */
export function toAnsi(rows: Row[], theme?: ThemeName, cols?: number): string;
