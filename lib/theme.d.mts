export type ThemeName = 'dark' | 'light';
export const glyphs: Record<string, string>;
export const stages: string[];
export const thresholds: {
  usageMarkPercent: number;
  contextYellowFrom: number; contextRedFrom: number;
  runShareYellowFrom: number; runShareRedFrom: number;
  agentQuietAfterMinutes: number; agentStalledAfterMinutes: number;
  narrowBelowColumns: number;
};
/**
 * The hex colour of a colour name. A name may carry a fade: "accent@60" is 60% accent over the
 * background (motion). Returns undefined for an unknown name.
 */
export function hex(theme: ThemeName, name: string): string | undefined;
