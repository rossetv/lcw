import type { Row } from '../hooks/lcw-mod.mjs'

export type BannerKind =
  | 'answer' | 'approve' | 'mark' | 'spendfail' | 'unfinished' | 'awake' | 'restart' | 'update' | 'whatsnew' | 'guide' | 'cleanup' | 'statusline'
  | 'advisor' | 'cap' | 'spend' | 'question'

/** One box: its kind, the occurrence key (a dismissal is "kind:key"), the title, plain lines, bullets, and [id, label] options. */
export interface Banner {
  kind: BannerKind
  key: string | number
  title: string
  lines: string[]
  bullets: string[]
  options: [string, string][]
  /** The approval box: its own tag, its replies in a column (ids of options, and what each means), and a note at the foot. */
  tag?: string
  choices?: { ids: string[]; meaning: string }[]
  note?: string
  /** The question box: the question it puts. */
  questionId?: string
  /** The option drawn filled as the one recommended: its id, or null for none. Absent on a box whose first option is the one filled. */
  recommended?: string | null
}

/** A time as milliseconds, or an ISO string. */
type Time = number | string

export interface BannerRun {
  id: string; title: string; stage?: string; status?: string; pausedReason?: string; pausedAt?: Time; runningSince?: Time
  /** at: when the question was asked; numbers come back once their question is answered, times do not. */
  done?: number; left?: number; asks?: { n: number; text: string; waiting?: number; at?: Time }[]
  awake?: boolean; guide?: boolean; firstOnMachine?: boolean
  /** 'sweep' asks for the charter's approval; anything else is a build. */
  shape?: 'build' | 'sweep'
  /** The Brainstorm's playback (a sweep's Charter) waits for approval: Go's labels (one, or one per variant), what Go builds, and when it asked. */
  approval?: { go: string[]; meaning: string; at: number }
  /** A sweep's short questions still open, in the order asked, and how many it has asked and had answered. */
  questions?: { open: { id: string; text: string; why: string; options: { key: string; label: string; meaning: string }[] }[]; asked: number; answered: number }
}

/** Every fact is optional; a missing one means the box it feeds does not apply. */
export interface BannerFacts {
  now?: number
  billing?: 'subscription' | 'payg' | string
  advisorModel?: unknown; advisorFlag?: boolean; capSet?: boolean; spendCommandSet?: boolean
  notices?: Record<string, string | boolean> | null
  /** 'kind:key' of each box dismissed this session; 'kind' alone for the advisor, cap and spend boxes. */
  dismissed?: Set<string>
  repoKey?: string
  /** The machine is a Mac: the cleanup box says "this Mac", else "this computer". */
  mac?: boolean
  run?: BannerRun | null
  /** since: when this session saw the week reach the mark, cleared once it has been below it for a minute. */
  usage?: { usedPercent?: number; resetsAt?: Time; markPercent?: number; atMark?: boolean; spentUsd?: number; capUsd?: number; markUsd?: number; since?: number }
  /** lastError: the stored phrase for what went wrong ('printed "401 Unauthorized"', 'took longer than 30 s'). */
  spendFailing?: { fails: number; since?: Time; lastError?: string | null } | null
  /** name is the run's name; title the one line it was started with ("Add a CSV export ..."); milestone as Build records it ("2 of 3"). Without name, title is the name. */
  unfinished?: { id: string; name?: string; title: string; stage?: string; milestone?: string | number; wave?: number; waves?: { n: number; stage?: string; step?: string | null; waiting?: boolean }[]; done?: number; left?: number; nextStep?: string; stoppedAt?: Time; worktree?: boolean; branch?: boolean } | null
  sleep?: { canHold?: boolean; heldByOther?: boolean } | null
  update?: {
    running?: string
    available?: { version: string; from?: string; bullets?: string[]; at?: Time } | null
    updated?: { to: string; from?: string; bullets?: string[]; at?: Time } | null
    devCheckout?: boolean
  } | null
  statusLine?: { command?: string; mine?: boolean } | null
  cleanup?: { at: Time; title: string; bullets?: string[]; items?: unknown } | null
  /** When the person last sent a prompt in this session: one sent after the approval asked ends that box. */
  repliedAt?: number
  /** 'failed' after Answer now could not fill the prompt. */
  answerFill?: 'failed'
}

export const BANNERS: Record<'advisor' | 'cap' | 'spend', { title: string; body: string; options: [string, string][] }>
export function bannerFor(facts?: BannerFacts): Banner | null
/** The answer box's key for a run with open questions: the run and when its newest open question was asked. */
export function answerKey(run: BannerRun): string
/** The approval box's key: the run and when the playback asked. */
export function approveKey(run: BannerRun & { approval: NonNullable<BannerRun['approval']> }): string
/** overCard: a run's card is drawn under it, at the full cols, so the box is as wide. */
/** tight: the approval box without its plain line, for where the full one does not fit. */
export function bannerRows(banner: Banner | null, cols: number, overCard?: boolean, tight?: boolean): Row[]

export type OpenWave = { n: number; stage: string; step: string | null; waiting: boolean; worktree?: string; tasks: any[]; requirements: any[] }
/** Whether a wave of a sweep's state is open: running, or shipped and unmerged while the charter merges as it goes, never an empty one. */
export function isOpenWave(state: any, wave: any): boolean
/** The open waves of a sweep (running, or shipped and awaiting its merge), each with its own lists; none for a build. */
export function openWaves(state: any): OpenWave[]
/** The tasks and requirements a run stands on: the open waves' added up in a sweep, else the run's own. */
export function workOf(state: any): { tasks: any[]; requirements: any[] }
