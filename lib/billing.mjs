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

/** A weekly figure makes a subscription; a reply without one settles an unclear session as payg. */
export function settle(kind, { weekly, replied, quotaSelected = false } = {}) {
  if (quotaSelected || weekly != null) return 'subscription'
  if (kind === 'unclear' && replied) return 'payg'
  return kind
}
