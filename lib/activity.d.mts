export type Activity = { state: string; at: number; fails?: number; failAt?: number }
export function next(input: { hook_event_name?: string; is_interrupt?: boolean; tool_name?: string; notification_type?: string }, was: Activity | null | undefined, now: number): Activity | null
