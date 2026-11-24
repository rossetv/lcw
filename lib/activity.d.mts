export type Activity = { state: string; at: number; fails?: number; failAt?: number; failIds?: string[] }
export function next(input: { hook_event_name?: string; is_interrupt?: boolean; tool_name?: string; tool_use_id?: string; notification_type?: string }, was: Activity | null | undefined, now: number): Activity | null
