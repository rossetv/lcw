// One facts object per approved box, with the values of the mock it was approved from. Times are built from the
// machine's own clock, so the boxes read the same in any time zone. To compare one with its approved picture:
//   bannerRows(bannerFor(A1), 96)
import { DEFAULT_CAP_USD } from '../../lib/spend.mjs'

const at = (day, h, m = 0) => new Date(2024, 10, day, h, m).getTime()
// Thursday 21 Nov 2024, 16:00; the week resets on Fri 22 Nov at 14:00.
const now = at(21, 16)
const resetsAt = new Date(at(22, 14)).toISOString()
const base = { now, advisorModel: 'fable', billing: 'subscription', repoKey: 'shop-1a2b3c4d', mac: true }
const run = { id: '20241120-export-csv', title: 'export-csv', stage: 'Build', status: 'running', done: 14, left: 6, asks: [], runningSince: at(21, 9) }
const sub = { usedPercent: 80, resetsAt, markPercent: 75 }
const payg = { billing: 'payg', capSet: true, spendCommandSet: true }

export const A1 = { ...base, update: { running: '0.1.1', devCheckout: false, available: { version: '0.1.4', from: '0.1.1', at: now, bullets: [
  'Pinned boxes now ask before cleaning up stale branches and worktrees.',
  'A run paused at your mark takes the answer from a button.',
  'Fixed: the spend check no longer counts a failed reading as zero.',
] } } }
export const A2 = { ...base, update: { running: '0.1.1', updated: { to: '0.1.4', from: '0.1.1', at: now, bullets: [] } } }
export const B = { ...base, update: { running: '0.1.4', updated: { to: '0.1.4', from: '0.1.1', at: now, bullets: [
  'Banners ask to turn on the advisor and, on API billing, for your weekly cap and a spend check.',
  'Commits and pull requests never say an AI made them.',
  "A pull request's Check only shows a decision you might regret.",
] } } }
export const D1 = { ...base, run: { ...run, status: 'paused', pausedReason: 'mark', pausedAt: at(21, 12) }, usage: { ...sub, usedPercent: 75, atMark: true } }
export const D1usd = {
  ...base, ...payg, run: D1.run,
  usage: { spentUsd: 3000, capUsd: 4000, markUsd: 3000, markPercent: 75, atMark: true, resetsAt },
}
export const K = { ...base, usage: { ...sub, atMark: true } }
export const K92 = { ...base, usage: { ...sub, usedPercent: 92, atMark: true } }
export const E = { ...base, ...payg, spendFailing: { fails: 3, since: at(21, 14, 2), lastError: 'printed "401 Unauthorized"' } }
export const F = { ...base, unfinished: {
  id: '20241120-export-csv', name: 'export-csv', title: 'Add a CSV export with date filters to the reports page', stage: 'Build', milestone: '2 of 3', done: 14, left: 6,
  nextStep: 'launch milestone 3: the CSV header order and the download button', stoppedAt: at(20, 18, 40), worktree: true, branch: true,
} }
export const H = { ...base, run: { ...run, stage: 'Brainstorm', done: 0, left: 0, firstOnMachine: true } }
export const J = { ...base, run: { ...run, asks: [{
  n: 1, waiting: 2, at: at(21, 15, 48), text: 'The spec says exports include archived rows, but the API hides them from this role. Include them anyway, or leave them out?',
}] } }
export const L = { ...base, run, sleep: { canHold: true, heldByOther: false } }
export const M = { ...base, statusLine: { command: 'ccstatusline', mine: false } }
export const N = { ...base, cleanup: {
  at: at(21, 15), title: 'A few branches here look done with.',
  bullets: [
    'fix-login-timeout and deps/react-19 were merged into main three weeks ago and have no new commits.',
    'The worktree ../shop-react is a clean copy of deps/react-19.',
  ],
} }
// A sweep's Charter, waiting for the one approval.
export const P = { ...base, run: { id: '20241121-backlog-sweep', title: 'backlog-sweep', stage: 'Charter', status: 'with-you', shape: 'sweep', asks: [],
  approval: { go: ['Go'], meaning: 'starts the hunt', at: at(21, 15, 50) } } }
