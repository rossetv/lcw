type Row = Record<string, any>
type Read = (name: string) => Row | null | undefined
type Alive = (pid: unknown) => boolean
export function anchorName(session: Row | null | undefined): string | null
export function sessionAnchor<T extends string | null | undefined>(id: T, row: Read, alive: Alive, pid: number): T | string
export function aliasRows(ids: string | readonly (string | null | undefined)[] | null | undefined, row: Read, alive: Alive, pid: number): Record<string, Row>
export function sessionPick(ids: string | readonly (string | null | undefined)[] | null | undefined, row: Read, alive: Alive, pid: number): {
  names: string[]; rows: Row[]; mark: number; money: Row | null; quotaSelection: unknown
}
export function runMark(state: { driver?: string | null; markPercent?: number | null }, row: Read, alive: Alive, pid: number): number
export function rowBilling(session: Row | null | undefined, off: boolean): string | undefined
export function rowsBilling(rows: readonly Row[], off: boolean): string | undefined
