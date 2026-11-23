// Which way a session is billed: "subscription", "payg" or "unclear". Pure; only the kind leaves the sign-in report.

const set = (v) => typeof v === 'string' && v !== ''

/** The kind from `claude auth status` (parsed JSON or null) and the environment. */
export function signInKind(auth, env = {}) {
  switch (auth?.authMethod) {
    case 'claude.ai': return 'subscription'
    case 'api_key': case 'api_key_helper': case 'third_party': return 'payg'
    case 'oauth_token':
      if (set(env.ANTHROPIC_AUTH_TOKEN)) return 'payg'
      if (set(env.CLAUDE_CODE_OAUTH_TOKEN) && !set(env.ANTHROPIC_BASE_URL)) return 'subscription'
      return 'unclear'
    default: return 'unclear'
  }
}

/**
 * Whether a reading shows a reply. A session the session-start hook left unclear over its stored billing is a resume,
 * whose first tick shows the cost from before it again: there only a cost above its spend record's first reading
 * counts. stored is the stored billing (undefined when none), rec the session's spend record (null when none).
 */
export function replied(stored, rec, cost) {
  if (!(typeof cost === 'number' && cost > 0)) return false
  return stored !== 'unclear' || (typeof rec?.base === 'number' && cost > rec.base)
}

/** A weekly figure makes a subscription; a reply without one settles an unclear session as payg. */
export function settle(kind, { weekly, replied, quotaSelected = false } = {}) {
  if (quotaSelected || weekly != null) return 'subscription'
  if (kind === 'unclear' && replied) return 'payg'
  return kind
}
