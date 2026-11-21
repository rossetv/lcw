// What a checkpoint does with the context it finds. Pure: the CLI decides with it, from the size the status line saved.
export const KEEP_UNDER = 200_000
// Past this share of the window the engine would soon compact on its own, at whatever point it reached.
export const ALWAYS_AT = 0.8

/** 'keep' (nothing compacts), 'ask' (the orchestrator chooses) or 'compact', for a context of { tokens, window }. */
export function compactChoice(context) {
  const tokens = Number(context?.tokens)
  if (!(tokens > 0)) return 'compact'
  const window = Number(context?.window)
  if (window > 0 && tokens >= window * ALWAYS_AT) return 'compact'
  return tokens < KEEP_UNDER ? 'keep' : 'ask'
}

/** "112K" */
export const tokensText = (tokens) => Math.round(Number(tokens) / 1000) + 'K'
