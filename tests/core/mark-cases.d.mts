export interface MarkCase {
  name: string
  sessions?: Record<string, Record<string, unknown>>
  spend?: Record<string, number>
  week?: number
  cap?: number
  quota?: Record<string, 'ok' | 'blocked' | 'under' | 'missing'>
  run?: 'p1' | 'drv'
  expect: { prompt?: string | null; tool?: string | null; lcw?: string | null; agent?: string | null }
}
export const cases: MarkCase[]
