export type Billing = 'subscription' | 'payg' | 'unclear';
/** The billing kind from the parsed `claude auth status` (null when unreadable) and the environment. Returns only the kind. */
export function signInKind(auth: { authMethod?: string } | null | undefined, env?: Record<string, string | undefined>): Billing;
/** A weekly figure always means subscription; unclear with a reply and no weekly figure means payg; otherwise unchanged. */
export function settle(kind: Billing, seen: { weekly?: unknown; replied?: boolean; quotaSelected?: boolean }): Billing;
/** Whether a reading shows a reply: any cost above 0, or above the spend record's first reading in a session left unclear at a resume. */
export function replied(stored: string | undefined, rec: { base?: number } | null | undefined, cost: number | null | undefined): boolean;
