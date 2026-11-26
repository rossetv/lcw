import test from 'node:test';
import assert from 'node:assert/strict';
import { buildView, foldKey, roundFoldKey, renderCard, weekOf, weekShare } from '../../lib/card.mjs';
import { renderStatusRows } from '../../lib/status.mjs';
import { toPlain, toAnsi } from '../../lib/paint.mjs';
import { glyphs as G, hex } from '../../lib/theme.mjs';
import { len } from '../../lib/format.mjs';
import { inputsOf, fixtures, NOW } from './boards.mjs';

// A sweep's card in each of its states, and a build's beside them, as approved: every row but the agents', the rules
// and the bottom border, each the text inside the frame. The last but one is drawn 40 cells wide, with no frame.
const SWEEP = {
  "01-charter-with-you": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────────────── 6m ─╮",
    "★ with you · asking you: how should the pull requests come, and may I merge them?                  ≈ 12% of your week",
    "› Charter  ○ Hunt  ○ Plan  ○ Build  ○ Review  ○ Ship",
    "Charter · agreeing the rules of the sweep with you; the one step that needs you",
    "charter  …  ✓ anti-goals  ✓ no-go zones  ✓ changes  ✓ proof  ✓ park  ✓ stop  ✓ waves  › PRs           1 question open",
  ],
  "03-hunt-round-1-probes-at-work": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────────────── 9m ─╮",
    "● hunting, area by area                                                                            ≈ 12% of your week",
    "waves none queued yet                                                                                         round 1",
    "✓ Charter  › Hunt  ○ Plan  ○ Build  ○ Review  ○ Ship",
    "areas ▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱  14 hunted · 6 running · 16 left                                    23 findings so far",
  ],
  "04-hunt-sorted-the-queue-is-filled": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 31m ─╮",
    "● sorted against the charter                                                                       ≈ 12% of your week",
    "waves ▱▱▱▱▱▱  6 queued · next: wave 1, 27 fixes                                      round 1 · 14 parked · 21 dropped",
    "✓ Charter  › Hunt  ○ Plan  ○ Build  ○ Review  ○ Ship",
    "findings  151 to fix · 14 parked · 21 dropped                                                          6 waves queued",
  ],
  "05-plan-for-wave-1": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────────────── 3m ─╮",
    "● planning wave 1: Billing, Panel, Sign-in                                                         ≈ 12% of your week",
    "  waves   › Plan  ○ Build  ○ Review  ○ Ship    ▰▱▱▱▱▱  5 queued                      round 1 · 14 parked · 21 dropped",
    "▾ wave 1  ▰▰▰▰▰▰  ▱▱▱▱▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    28 tasks · up to 12 at once                                         3m",
  ],
  "06-build-wave-2-fixes-in-parallel": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 22m ─╮",
    "● wave 2: Billing and Panel fixes building side by side                                            ≈ 12% of your week",
    "  waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▱▱▱▱  1 done · 4 queued  round 1 · 27 fixed · 14 parked · 22 dropped",
    "▾ wave 2  ▰▰▰▰▰▰  ▰▰▰▰▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    9 of 28 tasks done · 7 running                                     22m",
  ],
  "07-build-a-worker-has-stalled": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 22m ─╮",
    "● one worker stalled; asked what it needs                                                          ≈ 12% of your week",
    "  waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▱▱▱▱  1 done · 4 queued  round 1 · 27 fixed · 14 parked · 22 dropped",
    "▾ wave 2  ▰▰▰▰▰▰  ▰▰▰▰▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    9 of 28 tasks done · 7 running                                     22m",
  ],
  "08-build-a-very-large-wave": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 22m ─╮",
    "● wave 2: two areas, each under its own orchestrator                                               ≈ 12% of your week",
    "  waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▱▱▱▱  1 done · 4 queued  round 1 · 27 fixed · 14 parked · 22 dropped",
    "▾ wave 2  ▰▰▰▰▰▰  ▰▰▰▰▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    9 of 28 tasks done · 7 running                                     22m",
  ],
  "09-review-once-for-the-whole-wave": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 11m ─╮",
    "● reviewing wave 2’s 27 fixes                                                                      ≈ 12% of your week",
    "  waves   ✓ Plan  ✓ Build  › Review  ○ Ship    ▰▰▱▱▱▱  1 done · 4 queued  round 1 · 27 fixed · 14 parked · 22 dropped",
    "▾ wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▱  ▱▱▱▱▱▱    20 of 27 fixes pass · 1 failing                                    11m",
  ],
  "10-ship-wave-2": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────────────── 2m ─╮",
    "● writing wave 2’s pull request                                                                    ≈ 12% of your week",
    "  waves   ✓ Plan  ✓ Build  ✓ Review  › Ship    ▰▰▱▱▱▱  1 done · 4 queued  round 1 · 54 fixed · 14 parked · 22 dropped",
    "▾ wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    final checks next                                                   2m",
  ],
  "11-ship-when-your-charter-lets-claude-merge": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────────────── 6m ─╮",
    "● wave 2’s PR #42 merged: it met your charter’s rule                                               ≈ 12% of your week",
    "waves ▰▰▱▱▱▱  2 done · 4 queued · next: wave 3, 27 fixes                  round 1 · 54 fixed · 14 parked · 22 dropped",
    "✓ Charter  ✓ Hunt  ✓ Plan  ✓ Build  ✓ Review  › Ship",
    "tasks ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  27 done · 1 dropped",
  ],
  "12-hunt-round-2-the-queue-ran-dry": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────────────── 5m ─╮",
    "● hunting again, round 2                                                                           ≈ 29% of your week",
    "waves ▰▰▰▰▰▰  6 done                                                     round 2 · 148 fixed · 14 parked · 22 dropped",
    "✓ Charter  › Hunt  ○ Plan  ○ Build  ○ Review  ○ Ship",
    "areas ▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  9 hunted · 5 running · 22 left                                      4 findings so far",
  ],
  "13-needs-you-one-question": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────────────── 4m ─╮",
    "⚑ needs you · 12m",
    "Wave 3 cannot be pushed: GitHub refuses the branch, because this token",
    "has no write access to the repository. Give it access and say “carry",
    "on”, or name another remote.",
    "answer in plain words below",
    "● wave 3 waits on your answer; wave 4 is being planned                                             ≈ 12% of your week",
    "  waves   ✓ Plan  ✓ Build  ✓ Review  › Ship    ▰▰▰▱▱▱  2 done · 3 queued  round 1 · 81 fixed · 14 parked · 22 dropped",
    "▾ wave 3  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    final checks next                                                   4m",
  ],
  "14-needs-you-two-questions": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 38m ─╮",
    "⚑ needs you · 2",
    "1  The Fleet tests need Docker, and no Docker daemon is running here. Start it, or shall I park Fleet’s 10…       41m",
    "2  The Billing fixes need a Stripe test key, and none is set. Add one, or shall I park them?                       9m",
    "answer in plain words below, e.g. “1 yes, 2 UTC”",
    "● 2 areas wait on your answers; Panel carries on                                                   ≈ 12% of your week",
    "  waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▰▱▱▱  2 done · 3 queued  round 1 · 54 fixed · 14 parked · 22 dropped",
    "▾ wave 3  ▰▰▰▰▰▰  ▰▰▰▰▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    11 of 27 tasks done · 4 running                                    38m",
  ],
  "15-paused-at-your-usage-mark": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 52m ─╮",
    "▮▮ paused at your 75% mark                                                                              resumes in 2d",
    "nothing new starts · the 3 running tasks finish and merge first",
    "say “run up to 85%” to carry on now",
    "  waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▰▰▱▱  3 done · 2 queued  round 1 · 97 fixed · 14 parked · 22 dropped",
    "▾ wave 4  ▰▰▰▰▰▰  ▰▰▰▰▰▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    14 of 26 tasks done · 3 running                                    52m",
  ],
  "16-paused-by-you": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 52m ─╮",
    "▮▮ paused by you",
    "nothing new starts · no task is running",
    "say “carry on” to resume",
    "  waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▰▰▱▱  3 done · 2 queued  round 1 · 97 fixed · 14 parked · 22 dropped",
    "▾ wave 4  ▰▰▰▰▰▰  ▰▰▰▰▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    14 of 26 tasks done                                                52m",
  ],
  "17-finished-with-stacked-pull-requests": [
    "╭─ ◆ LCW Sweep · backlog-sweep ───────────────────────────────────────────────────────────────────────────────── 1d 7h ─╮",
    "✓ finished · PRs: #41 to #47",
    "153 fixed · 14 parked for you, in parked.md · 24 dropped",
    "✓ Charter  ✓ Hunt  ✓ Plan  ✓ Build  ✓ Review  ✓ Ship",
    "3 rounds · 7 waves · 212 agents · 48.3M tokens · ≈ 31% of your week",
  ],
  "18-finished-merged-as-it-went": [
    "╭─ ◆ LCW Sweep · backlog-sweep ───────────────────────────────────────────────────────────────────────────────── 1d 7h ─╮",
    "✓ finished · 7 PRs merged, #41 to #47, as your charter allows",
    "153 fixed · 14 parked for you, in parked.md · 24 dropped",
    "✓ Charter  ✓ Hunt  ✓ Plan  ✓ Build  ✓ Review  ✓ Ship",
    "3 rounds · 7 waves · 212 agents · 48.3M tokens · ≈ 31% of your week",
  ],
  "19-finished-some-waves-short-of-your-rule": [
    "╭─ ◆ LCW Sweep · backlog-sweep ───────────────────────────────────────────────────────────────────────────────── 1d 7h ─╮",
    "✓ finished · 4 PRs merged · PRs: #45 to #47",
    "153 fixed · 14 parked for you, in parked.md · 24 dropped",
    "✓ Charter  ✓ Hunt  ✓ Plan  ✓ Build  ✓ Review  ✓ Ship",
    "3 rounds · 7 waves · 212 agents · 48.3M tokens · ≈ 31% of your week",
  ],
  "20-finished-with-one-pull-request-at-the-end": [
    "╭─ ◆ LCW Sweep · backlog-sweep ───────────────────────────────────────────────────────────────────────────────── 1d 7h ─╮",
    "✓ finished · PR: #41",
    "153 fixed · 14 parked for you, in parked.md · 24 dropped",
    "✓ Charter  ✓ Hunt  ✓ Plan  ✓ Build  ✓ Review  ✓ Ship",
    "3 rounds · 7 waves · 212 agents · 48.3M tokens · ≈ 31% of your week",
  ],
  "21-stopped": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 12m ─╮",
    "■ stopped",
    "waves ▰▰▰▱▱▱  3 done · 3 queued · next: wave 4, 27 fixes                  round 1 · 81 fixed · 14 parked · 22 dropped",
    "✓ Charter  ✓ Hunt  ✓ Plan  › Build  ○ Review  ○ Ship",
    "tasks ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  6 done · 20 left",
  ],
  "22-in-a-narrow-window": [
    "◆ backlog-sweep             waves ▰▰▱▱▱▱",
    "● wave 2 building",
    "wave 2  ▰▰▰ ▰▰▱ ▱▱▱ ▱▱▱  Build",
  ],
  "23-a-build-for-comparison": [
    "╭─ ◆ LCW Build · shared-lists ──────────────────────────────────────────────────────────────────────────────────── 18m ─╮",
    "● on track                                                                                          ≈ 5% of your week",
    "✓ Brainstorm  ✓ Spec  ✓ Plan  › Build  ○ Review  ○ Ship",
    "tasks ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱  7 done · 4 running · 6 left",
  ],

};

// The six approved states of a sweep with waves open, as plain text: the card alone, 115 columns wide and 35.
const LANES = {
  "24-lanes-one-wave-open": {
    wide: [
      "◆ LCW Sweep · backlog-sweep                                                                                  1h 12m",
      "● wave 2 building                                                                                ≈ 12% of your week",
      "  waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▱  1 done · 1 queued · next: wave 3  round 1 · 12 fixed · 2 parked",
      "▾ wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    7 of 12 tasks done · 3 running                                   22m",
    ],
    narrow: [
      "◆ backlog-sweep           waves ▰▰▱",
      "● wave 2 building",
      "wave 2  ▰▰▰ ▰▰▰ ▱▱▱ ▱▱▱  Build",
    ],
  },
  "25-lanes-review-and-build": {
    wide: [
      "◆ LCW Sweep · backlog-sweep                                                                                  1h 31m",
      "● wave 1 in review, wave 2 building                                                              ≈ 12% of your week",
      "  waves   ✓ Plan  › Build  › Review  ○ Ship    ▰▰▱  1 queued · next: wave 3                      round 1 · 2 parked",
      "▾ wave 1  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▱  ▱▱▱▱▱▱    18 of 23 fixes pass · 1 failing · review 2                       34m",
      "▾ wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱     7 of 12 tasks done · 3 running                                  22m",
    ],
    narrow: [
      "◆ backlog-sweep           waves ▰▰▱",
      "● wave 1 in review, wave 2 building",
      "wave 1  ▰▰▰ ▰▰▰ ▰▰▰ ▱▱▱  Review",
      "wave 2  ▰▰▰ ▰▰▰ ▱▱▱ ▱▱▱  Build",
    ],
  },
  "26-lanes-three-open": {
    wide: [
      "◆ LCW Sweep · backlog-sweep                                                                                  2h 48m",
      "● wave 1 in its final checks, wave 2 in review, wave 3 building                                  ≈ 12% of your week",
      "  waves   ✓ Plan  › Build  › Review  › Ship    ▰▰▰                                    round 1 · 23 fixed · 2 parked",
      "▾ wave 1  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    final checks                                                     14m",
      "▾ wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▱▱▱  ▱▱▱▱▱▱    7 of 12 fixes pass                                               19m",
      "▾ wave 3  ▰▰▰▰▰▰  ▰▰▰▰▰▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    3 of  9 tasks done · 4 running                                   12m",
    ],
    narrow: [
      "◆ backlog-sweep           waves ▰▰▰",
      "● wave 1 in its final checks, wave…",
      "wave 1  ▰▰▰ ▰▰▰ ▰▰▰ ▰▰▰  checks",
      "wave 2  ▰▰▰ ▰▰▰ ▰▰▱ ▱▱▱  Review",
      "wave 3  ▰▰▰ ▰▰▱ ▱▱▱ ▱▱▱  Build",
    ],
  },
  "27-lanes-one-waits-on-you": {
    wide: [
      "◆ LCW Sweep · backlog-sweep                                                                                  3h 20m",
      "⚑ needs you · 12m",
      "Wave 1 cannot be pushed: GitHub refuses the branch, because this token",
      "has no write access to the repository. Give it access and say “carry",
      "on”, or name another remote.",
      "answer in plain words below",
      "● wave 1 waits on your answer; wave 2 carries on                                                 ≈ 12% of your week",
      "  waves   ✓ Plan  › Build  ○ Review  › Ship    ▰▰▱  1 queued · next: wave 3           round 1 · 23 fixed · 2 parked",
      "▾ wave 1  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    ⚑ waits on your answer                                           12m",
      "▾ wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    7 of 12 tasks done · 3 running                                   31m",
    ],
    narrow: [
      "◆ backlog-sweep           waves ▰▰▱",
      "⚑ needs you · 12m",
      "Wave 1 cannot be pushed: GitHub…",
      "● wave 1 waits on your answer…",
      "wave 1  ▰▰▰ ▰▰▰ ▰▰▰ ▰▰▰  ⚑ waiting",
      "wave 2  ▰▰▰ ▰▰▰ ▱▱▱ ▱▱▱  Build",
    ],
  },
  "28-lanes-a-long-sweep": {
    wide: [
      "◆ LCW Sweep · backlog-sweep                                                                                   1d 2h",
      "● wave 6 in its final checks, wave 7 building                                                    ≈ 23% of your week",
      "  waves   ✓ Plan  › Build  ○ Review  › Ship    ▰▰▰▰▰▰▰▱▱  5 done · 2 queued       round 3 · 61 fixed · 170 parked …",
      "▾ wave 6  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    final checks                                                     18m",
      "▾ wave 7  ▰▰▰▰▰▰  ▰▰▰▰▰▰▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    4 of 11 tasks done · 4 running                                    9m",
    ],
    narrow: [
      "◆ backlog-sweep     waves ▰▰▰▰▰▰▰▱▱",
      "● wave 6 in its final checks, wave…",
      "wave 6  ▰▰▰ ▰▰▰ ▰▰▰ ▰▰▰  checks",
      "wave 7  ▰▰▰ ▰▰▱ ▱▱▱ ▱▱▱  Build",
    ],
  },
  "29-lanes-hunt-and-final-checks": {
    wide: [
      "◆ LCW Sweep · backlog-sweep                                                                                  4h 35m",
      "● hunting again, round 2; wave 3 in its final checks                                             ≈ 18% of your week",
      "  waves    ✓ Plan  ✓ Build  ✓ Review  › Ship    ▰▰▰  2 done               round 2 · 43 fixed · 2 parked · 3 dropped",
      "▾ wave 3   ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    final checks                                                    11m",
      "  round 2  › Hunt  ▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱    9 of 36 areas hunted · 5 running · 4 findings so far             5m",
    ],
    narrow: [
      "◆ backlog-sweep           waves ▰▰▰",
      "● hunting again, round 2; wave 3…",
      "wave 3   ▰▰▰ ▰▰▰ ▰▰▰ ▰▰▰  checks",
      "round 2  ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱  Hunt",
    ],
  },
};

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, '');
const card = (board, opts) => renderCard(buildView(inputsOf(board)), opts);
const cols = s => [...s].length;

test('the frame has the title in the top border and a rule between sections', () => {
  const lines = strip(toAnsi(card('RunningA', { width: 100, frame: true }), 'dark', 100)).split('\n');
  assert.match(lines[0], /^╭─ ◆ LCW Build · export-csv ─+ 2h 14m ─╮$/);
  assert.equal(lines.filter(l => l.startsWith('├')).length, 2);
  assert.match(lines.at(-1), /^╰─+╯$/);
  assert.ok(lines.every(l => cols(l) === 100));
  assert.ok(lines.slice(1, -1).every(l => /^[│├]/.test(l) && /[│┤]$/.test(l)));
  // the title moves into the border; the frame adds a rule for each gap between sections and the bottom border
  assert.equal(lines.length, card('RunningA', { width: 100 }).length + 3);
});

test('the frame is coloured by state', () => {
  const border = (board, view) => renderCard(view ?? buildView(inputsOf(board)), { width: 100, frame: true })[0][0].c;
  assert.equal(border('RunningA'), 'hairline');
  assert.equal(border('NeedsYou'), 'needsYou');
  assert.equal(border('Paused'), 'caution');
  assert.equal(border('Done'), 'ok');
});

test('below 44 columns there is no frame', () => {
  const rows = card('Narrow', { width: 40, frame: true });
  assert.ok(!toPlain(rows).includes('╭'));
});

test('the right group sits against the right edge at 126 and 80 columns', () => {
  for (const width of [126, 80]) {
    const framed = strip(toAnsi(card('Stalled', { width, frame: true }), 'dark', width)).split('\n');
    assert.ok(framed.every(l => cols(l) === width), 'framed rows are ' + width + ' wide at ' + width);
    const status = strip(toAnsi(renderStatusRows(inputsOf('Stalled').status, { width }), 'dark', width)).split('\n');
    assert.equal(cols(status[0]), width);
    assert.ok(status[0].endsWith('acme-api · lcw/export-csv'));
    assert.ok(status[1].endsWith('resets in 3d · 15% over pace'));
    const plain = renderCard(buildView(inputsOf('Stalled')), { width });
    const text = strip(toAnsi(plain, 'dark', width)).split('\n');
    assert.ok(text[0].endsWith('≈ 12% of your week') || text[0].endsWith('3h 02m'));
  }
});

test('long descriptions are cut and keep a gap before the model', () => {
  const rows = card('RunningA', { width: 80 });
  const line = toPlain(rows).split('\n').find(l => l.includes('date filters'));
  assert.match(line, /…\s+Sonnet 5.5/);
});

test('maxRows drops agent rows first and says how many are left', () => {
  const full = card('ManyAgents', { width: 126 });
  for (const frame of [false, true]) {
    const rows = card('ManyAgents', { width: 126, frame, maxRows: full.length + (frame ? 2 + 3 : 0) - 3 });
    const text = toPlain(rows).split('\n');
    assert.ok(rows.length <= full.length + (frame ? 5 : 0) - 3);
    assert.match(text.filter(l => /more agents/.test(l)).join(), /▸ 1[0-9] more agents/);
    assert.ok(text.some(l => l.includes('✓ Brainstorm')), 'the stage row stays');
    assert.ok(text.some(l => l.includes('tasks ▰')), 'the task bar stays');
  }
  const tight = card('ManyAgents', { width: 126, maxRows: 8 });
  assert.equal(tight.length, 8);
  assert.match(toPlain(tight), /▸ 10 more agents/);
});

test("an agent's sparkline: its spans against the most any agent shown gained in one, the unsampled ones dim", () => {
  const i = inputsOf('RunningA'), now = Date.parse('2026-11-18T12:00:00Z');
  const a = (id, spark, more = {}) => ({ id, description: id, model: 'claude-sonnet-5-5', tokens: 9000, startTime: now, status: 'running', quietMs: 0, spark, ...more });
  const agents = [a('busy', [100, 200, 700, 0, 350, 700, 700, 700]), a('new', [700, 350]), a('gone', [0, 0, 0, 0, 0, 0, 0, 0], { quietMs: 20 * 60e3 })];
  const rows = renderCard(buildView({ ...i, agents, now }), { width: 126 });
  const line = id => rows.find(r => r.some(s => s.t.startsWith(id + ' ')));
  const spark = id => line(id).filter(s => /^[▁-█]+$/.test(s.t)).map(s => [s.t, s.c]);
  assert.deepEqual(spark('busy'), [['▄▅█▁▆███', 'accent']], 'a square-root scale');
  assert.deepEqual(spark('new'), [['▁▁▁▁▁▁', 'dim'], ['█▆', 'accent']]);
  assert.deepEqual(spark('gone'), [['▁▁▁▁▁▁▁▁', 'needsYou']]);
});

test('a figure that moved rolls up to its new value over half a second', () => {
  const i = inputsOf('RunningA'), at = Date.parse('2026-11-18T12:00:00Z');
  const agents = [{ id: 'x', description: 'x', model: 'claude-sonnet-5-5', tokens: 240000, tokensWas: 200000, movedAt: at, startTime: at, status: 'running', quietMs: 0 }];
  const shown = ms => buildView({ ...i, agents, now: at + ms }).agents[0].tokens;
  assert.deepEqual([0, 250, 499, 500, 5000].map(shown), [200000, 230000, 240000, 240000, 240000]);
  assert.equal(buildView({ ...i, agents, now: at + 250 }).inFlight, 230000);
});

test('toAnsi writes truecolor from the theme', () => {
  const rows = card('Stalled', { width: 126 });
  const dark = toAnsi(rows, 'dark', 126), light = toAnsi(rows, 'light', 126);
  assert.ok(dark.includes('\x1b[38;2;233;230;223m'), 'text colour #e9e6df');
  assert.ok(dark.includes('\x1b[38;2;143;206;139m'), 'ok green');
  assert.ok(dark.includes('\x1b[1;38;2;20;19;18;48;2;240;128;122m'), 'the stalled chip: bold, background on red');
  assert.ok(light.includes('\x1b[38;2;35;34;31m'), 'light text colour #23221f');
  assert.ok(!light.includes('38;2;233;230;223'));
  assert.equal(strip(dark), strip(light));
  assert.equal(hex('dark', 'ok'), '#8fce8b');
  assert.equal(hex('light', 'Sonnet'), '#2f5fb8');
  assert.equal(hex('dark', 'ok@50'), '#52714f');
});

test('the context bar is drawn as cells and printed as [bar N%]', () => {
  const rows = renderStatusRows(inputsOf('Main').status, { width: 126 });
  assert.ok(toPlain(rows).includes('xhigh  [bar 38%] 38% of 1M'));
  const bg = rows[0].filter(s => s.bg);
  // 38% of twenty cells: seven, and a cell 60% of the way from the track's colour to the fill's
  assert.deepEqual(bg.map(s => [s.t.length, s.bg]), [[7, 'resourceUsed'], [1, 'resourceUsed@60/contextTrack'], [12, 'contextTrack']]);
  assert.equal(hex('dark', 'resourceUsed@60/contextTrack'), '#938f87');
  const one = renderStatusRows({ ...inputsOf('Main').status, contextPercent: 1 }, { width: 126 })[0].filter(s => s.bg);
  assert.deepEqual(one.map(s => [s.t.length, s.bg]), [[0, 'resourceUsed'], [1, 'resourceUsed@25/contextTrack'], [19, 'contextTrack']], '1% still shows');
  assert.equal(renderStatusRows({ ...inputsOf('Main').status, contextPercent: 91 }, { width: 126 })[0].find(s => s.plain).bg, 'needsYou');
  const over = renderStatusRows({ ...inputsOf('Main').status, contextPercent: 140 }, { width: 126 })[0].filter(s => s.plain !== undefined);
  assert.deepEqual(over.map(s => s.t.length), [20, 0]);
});

test('the context bar is twenty cells where there is room, narrows with the terminal to ten, and is six in the narrow layout', () => {
  // Fable 5.2 · xhigh and 38% of 1M take 29 cells; "resets in 3d · 42% spare" on the right takes 24, and two apart
  const input = { model: 'Fable 5.2', effort: 'xhigh', contextPercent: 38, contextWindow: '1M', repo: 'lcw', branch: 'main', weekUsedPercent: 29, weekElapsedPercent: 50, markPercent: 75 };
  const bar = width => renderStatusRows(input, { width })[0].filter(s => s.plain !== undefined).reduce((n, s) => n + s.t.length, 0);
  assert.deepEqual([126, 76, 71, 66, 60, 44, 40].map(bar), [20, 20, 16, 11, 10, 10, 6]);
  for (const width of [126, 76, 71, 66]) {
    const lines = strip(toAnsi(renderStatusRows(input, { width }), 'dark', width)).split('\n');
    assert.ok(lines.every(l => cols(l) === width), 'both rows are ' + width + ' wide: ' + lines.map(cols));
  }
});

test('the week gauge: used figure, cells with the usage mark as a line, the mark\'s figure', () => {
  const main = inputsOf('Main').status;   // Fable 5.2 · xhigh, 38% of 1M: the group above is 49 wide
  const row = (input, width = 126) => renderStatusRows({ ...main, weekElapsedPercent: 50, ...input }, { width });
  const left = r => { const i = r.findIndex(s => s.r); return (i < 0 ? r : r.slice(0, i)).map(s => s.t).join(''); };
  const on = n => '▰'.repeat(n), off = n => '▱'.repeat(n);
  const week = (input, width) => left(row(input, width)[1]);
  assert.equal(week({ weekUsedPercent: 29, markPercent: 75 }), '29% ' + on(12) + off(18) + '|' + off(10) + ' 75%');
  assert.equal(week({ weekUsedPercent: 74, markPercent: 75 }), '74% ' + on(30) + '|' + off(10) + ' 75%');
  assert.equal(week({ weekUsedPercent: 82, markPercent: 75 }), '82% ' + on(30) + '|' + on(3) + off(7) + ' 75%');
  assert.equal(week({ weekUsedPercent: 100, markPercent: 100 }), '100% ' + on(38) + '| 100%');
  assert.equal(week({ weekUsedPercent: 0, markPercent: 0 }), '0% |' + off(42) + ' 0%');
  assert.equal(week({ weekUsedPercent: 29, markPercent: null }), '29% ' + on(14) + off(31));
  assert.equal(week({ weekUsedPercent: null, markPercent: 75 }), '--% ' + off(30) + '|' + off(10) + ' 75%');
  assert.equal(week({ weekUsedPercent: 52, markPercent: 75 }, 40), '52% ' + on(11) + off(4) + '|' + off(4) + ' 75%');
  // the last cell is part-filled: 29% of 41 cells is 11.89, so the twelfth is 89% of the way from dim to the fill
  assert.deepEqual(row({ weekUsedPercent: 29, markPercent: 75 })[1].filter(s => s.t.includes('▰')).map(s => [s.t.length, s.c]), [[11, 'resourceUsed'], [1, 'resourceUsed@89/dim']]);
  assert.equal(row({ weekUsedPercent: 29, markPercent: 75 }).length, 2);
  assert.equal(row({ weekUsedPercent: 52, markPercent: 75 }, 40).length, 3);
  const past = row({ weekUsedPercent: 82, markPercent: 75 })[1];
  assert.equal(past.find(s => s.t === '|').c, 'text');
  assert.ok(past.filter(s => s.t.includes('▰')).every(s => s.c.split('@')[0] === 'caution'));
  assert.ok(row({ weekUsedPercent: 74, markPercent: 75 })[1].filter(s => s.t.includes('▰')).every(s => s.c === 'resourceUsed'));
});

test('the week gauge and its figures are as wide as the group above, whatever the model, effort and figures', () => {
  const left = r => { const i = r.findIndex(s => s.r); return (i < 0 ? r : r.slice(0, i)).map(s => s.t).join(''); };
  let n = 0;
  for (const model of ['Fable 5.2', 'claude-sonnet-5-5', 'Haiku 5.5', 'Opus 5.5'])
    for (const effort of ['xhigh', 'medium', 'low', undefined])
      for (const contextPercent of [0, 9, 38, 100])
        for (const contextWindow of ['1M', '200k', undefined])
          for (const weekUsedPercent of [null, 0, 9, 29, 100])
            for (const markPercent of [null, 0, 75, 100])
              for (const width of [126, 80, 40]) {
                const rows = renderStatusRows({ model, effort, contextPercent, contextWindow, repo: 'acme-api', branch: 'main', weekUsedPercent, weekElapsedPercent: 46, markPercent }, { width });
                assert.equal(cols(left(rows[1])), cols(left(rows[0])), JSON.stringify({ model, effort, contextPercent, contextWindow, weekUsedPercent, markPercent, width }));
                assert.equal((left(rows[1]).match(/\|/g) ?? []).length, markPercent === null ? 0 : 1);
                n++;
              }
  assert.ok(n > 1000);
  // where the terminal is too narrow for that, the row still fits it
  for (const width of [44, 50, 60]) {
    const line = strip(toAnsi(renderStatusRows({ model: 'claude-sonnet-5-5', effort: 'medium', contextPercent: 100, contextWindow: '200k', weekUsedPercent: 100, weekElapsedPercent: 50, markPercent: 100 }, { width }), 'dark', width)).split('\n')[1];
    assert.equal(cols(line), width, 'the gauge row is ' + width + ' wide');
  }
});

test('a finished build links its PR without claiming an unknown draft or merge state', () => {
  const input = inputsOf('Done');
  const rows = renderCard(buildView(input), { width: 126 });
  assert.match(toPlain(rows), /PR: #482/);
  assert.doesNotMatch(toPlain(rows), /draft|open for your review|merged/);
  assert.equal(rows.flat().find(s => s.t === '#482')?.href, input.state.pr.url);
});

test('finished sweeps name PRs neutrally unless a recorded merge supports more', () => {
  for (const board of ['17-finished-with-stacked-pull-requests', '19-finished-some-waves-short-of-your-rule', '20-finished-with-one-pull-request-at-the-end']) {
    const text = toPlain(card(board, { width: 126 }));
    assert.match(text, /PRs?: #/);
    assert.doesNotMatch(text, /draft|open for your review/);
    if (board.startsWith('19-')) assert.match(text, /4 PRs merged/);
  }
});

test('status rows survive missing input', () => {
  assert.doesNotThrow(() => toPlain(renderStatusRows({}, { width: 100 })));
  assert.doesNotThrow(() => toPlain(renderStatusRows(undefined, {})));
  assert.ok(toPlain(renderStatusRows({ model: 'claude-sonnet-5-5', weekUsedPercent: 10, weekElapsedPercent: 0 }, { width: 100 })).includes('Sonnet 5.5'));
});

test('motion: without a tick nothing fades; with one it only changes colours and fills', () => {
  const colours = rows => rows.flat().map(s => s.c ?? '').concat(rows.flat().map(s => s.bg ?? ''));
  const still = card('Stalled', { width: 126, frame: true });
  assert.ok(!colours(still).some(c => c.includes('@')));
  const a = card('Stalled', { width: 126, frame: true, tick: 40 });
  const b = card('Stalled', { width: 126, frame: true, tick: 47 });
  assert.equal(toPlain(a), toPlain(still));
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
  const faded = colours(a).concat(colours(b)).filter(c => c.includes('@'));
  assert.ok(faded.some(c => c.startsWith('ok@')), 'heartbeat on the state mark');
  assert.ok(faded.some(c => c.startsWith('accent@')), 'shimmer and breathing arrows');
  assert.ok(faded.some(c => c.startsWith('needsYou@')), 'pulse on the stalled chip');
  // the two working agents are out of step
  const arrows = rows => rows.map(r => r.find(s => s.t === '→')).filter(Boolean).map(s => s.c);
  assert.ok(new Set(arrows(card('RunningA', { width: 126, tick: 10 }))).size > 1);
});

test('motion: bars fill cell by cell on first draw', () => {
  const taskBar = tick => toPlain(card('RunningA', { width: 126, tick })).split('\n').find(l => l.startsWith('tasks')).match(/▰/g)?.length ?? 0;
  assert.equal(taskBar(0), 0);
  assert.ok(taskBar(2) < taskBar(4));
  assert.equal(taskBar(100), 17);
});

test('needs-you frame pulses', () => {
  const view = buildView(inputsOf('NeedsYou'));
  const c = tick => renderCard(view, { width: 100, frame: true, tick })[0][0].c;
  assert.notEqual(c(0), c(14));
});

test('a card that waits on the person pulses evenly, one step a second over a four-second beat, in its own colours', () => {
  const withYou = buildView(inputsOf('StageBrainstorm'));
  assert.equal(withYou.mode, 'with-you');
  const glyph = beat => renderCard(withYou, { width: 100, frame: true, beat }).flat().find(s => s.t === G.withYou).c;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(glyph), ['accent', 'accent@80', 'accent@60', 'accent@80', 'accent', 'accent@80', 'accent@60', 'accent@80']);
  // Each fade keeps its own depth: the frame goes down to @50, as it does when it moves fast, and half way is @75.
  const frame = beat => renderCard(buildView(inputsOf('NeedsYou')), { width: 100, frame: true, beat })[0][0].c;
  assert.deepEqual([0, 1, 2, 3].map(frame), ['needsYou', 'needsYou@75', 'needsYou@50', 'needsYou@75']);
  assert.ok([...Array(28).keys()].some(tick => renderCard(buildView(inputsOf('NeedsYou')), { width: 100, frame: true, tick })[0][0].c === 'needsYou@50'));
});

test('the slow pulse changes colours only: its bars are full and its text is the still card\'s', () => {
  const still = card('RunningA', { width: 126, frame: true });
  for (const beat of [0, 2]) assert.equal(toPlain(card('RunningA', { width: 126, frame: true, beat })), toPlain(still));
});

test('buildView: quiet, stalled and waiting agents', () => {
  const i = inputsOf('RunningA');
  const mk = (status, quietMs) => buildView({ ...i, agents: [{ id: 'x', description: 'd', model: 'm', startTime: NOW, tokens: 1, status, quietMs }] }).agents[0].chip;
  assert.equal(mk('running', 4 * 6e4), null);
  assert.equal(mk('running', 5 * 6e4), 'quiet');
  assert.equal(mk('running', 15 * 6e4), 'stalled');
  assert.equal(mk('waiting', 40 * 6e4), null);
  assert.equal(buildView({ ...i, agents: [{ id: 'x', status: 'completed' }] }).agents.length, 0);
});

test('buildView: an agent held after its report is marked held at fifteen minutes, and not before', () => {
  const i = inputsOf('RunningA');
  const mk = (heldMs) => buildView({ ...i, agents: [{ id: 'x', description: 'd', model: 'm', startTime: NOW, tokens: 1, status: 'waiting', quietMs: 0, heldMs }] }).agents[0].chip;
  assert.equal(mk(14 * 6e4), null);
  assert.equal(mk(15 * 6e4), 'held');
});

test('buildView: states', () => {
  const i = inputsOf('RunningA');
  assert.equal(buildView(i).mode, 'running');
  assert.equal(buildView({ ...i, gate: { reason: 'mark' } }).mode, 'paused');
  assert.equal(buildView({ ...i, state: { ...i.state, status: 'paused', pausedReason: 'human' } }).pausedBy, 'human');
  assert.equal(buildView({ ...i, state: { ...i.state, asks: [{ n: 1, text: 'q', at: NOW - 6e4 }] } }).frame, 'needsYou');
  assert.equal(buildView({ state: {}, now: NOW }).mode, 'running');
  assert.equal(buildView({ ...i, usage: null }).share, null);
  const paused = toPlain(card('RunningA', { width: 100 }));
  assert.ok(paused.includes('≈ 9% of your week'));
});

test('a run the human paused says so and promises no reset', () => {
  const i = inputsOf('Paused');
  const human = { ...i, state: { ...i.state, status: 'paused', pausedReason: 'human' } };
  for (const gate of [null, { reason: 'mark', markPercent: 75, resetsAt: i.usage.sevenDay.resetsAt }]) {
    const v = buildView({ ...human, gate });
    assert.equal(v.pausedBy, 'human');
    assert.equal(v.resumesIn, '');
    const text = toPlain(renderCard(v, { width: 100 }));
    assert.ok(text.includes('paused by you') && text.includes('“carry on”'));
    assert.ok(!text.includes('resumes in') && !text.includes('mark') && !text.includes('run up to'));
  }
  const mark = buildView(inputsOf('Paused'));
  assert.ok(mark.pausedBy === 'mark' && mark.resumesIn !== '');
});

test('the share of the week survives a weekly reset', () => {
  const i = inputsOf('RunningA');
  const { usage } = i;
  const after = usage.sevenDay.resetsAt, before = new Date(Date.parse(after) - 7 * 24 * 3600 * 1000).toISOString();
  const view = (state, used) => buildView({ ...i, state: { ...i.state, ...state }, usage: { sevenDay: { percentUsed: used, resetsAt: after } } }).share;
  const started = { weekAtStart: 40, weekUsed: 70, weekResetsAt: before };
  assert.equal(view(started, 12), 42, 'what the run used of the old week (30) plus the new week (12)');
  assert.equal(view({ ...started, shareBefore: 5 }, 12), 47);
  assert.equal(view({ ...started, weekResetsAt: after }, 72), 32, 'same week: used minus weekAtStart');
  assert.equal(view({ weekAtStart: 40 }, 72), 32, 'no stored reset time: nothing to fold');
  assert.equal(view({ weekAtStart: null, weekResetsAt: before }, 12), 12, 'start unknown: the new week is the run\'s');
  assert.deepEqual(weekOf(started, { percentUsed: 12, resetsAt: after }),
    { shareBefore: 30, weekAtStart: 0, weekResetsAt: after, weekUsed: 12 });
  assert.equal(weekShare({ ...started, weekResetsAt: after }, { percentUsed: 30, resetsAt: before }), 0, 'an older reading is ignored for the fold');
});

test('a week of another account starts where its first reading stands: what that account had used is not the run\'s', () => {
  const i = inputsOf('RunningA');
  const after = i.usage.sevenDay.resetsAt, other = new Date(Date.parse(after) - 3 * 24 * 3600 * 1000).toISOString();
  const started = { weekAtStart: 80, weekUsed: 97, weekResetsAt: other };
  assert.deepEqual(weekOf(started, { percentUsed: 30, resetsAt: after }), { shareBefore: 17, weekAtStart: 30, weekResetsAt: after, weekUsed: 30 });
  assert.equal(weekShare(started, { percentUsed: 30, resetsAt: after }), 17);
  // once that is kept, what the run goes on to use in the new account is added
  const kept = { ...started, ...weekOf(started, { percentUsed: 30, resetsAt: after }) };
  assert.equal(weekShare(kept, { percentUsed: 42, resetsAt: after }), 29);
});

test('a limit reset inside the week keeps what the run had used before it', () => {
  const i = inputsOf('RunningA');
  const week = i.usage.sevenDay.resetsAt;
  const run = { shareBefore: 17, weekAtStart: 0, weekUsed: 99, weekResetsAt: week };
  assert.deepEqual(weekOf(run, { percentUsed: 21, resetsAt: week }), { shareBefore: 116, weekAtStart: 0, weekResetsAt: week, weekUsed: 21 });
  assert.equal(weekShare(run, { percentUsed: 21, resetsAt: week }), 137);
  // a point or two lower is another session's slightly older figure, not a reset
  assert.equal(weekOf(run, { percentUsed: 96, resetsAt: week }).shareBefore, 17);
  assert.equal(weekShare(run, { percentUsed: 96, resetsAt: week }), 113);
  // kept, it counts on from the reset and folds nothing twice
  const kept = { ...run, ...weekOf(run, { percentUsed: 21, resetsAt: week }) };
  assert.equal(weekShare(kept, { percentUsed: 25, resetsAt: week }), 141);
});

test('a share past a whole week is still said as a share of the week', () => {
  const i = inputsOf('RunningA');
  const week = i.usage.sevenDay.resetsAt;
  const said = (state, used) => strip(toAnsi(renderCard(buildView({ ...i, state: { ...i.state, ...state }, usage: { sevenDay: { percentUsed: used, resetsAt: week } } }), { width: 126 }), 'dark', 126));
  assert.match(said({ shareBefore: 116, weekAtStart: 0, weekUsed: 21, weekResetsAt: week }, 21), /≈ 137% of your week/);
  assert.match(said({ shareBefore: 80, weekAtStart: 0, weekUsed: 20, weekResetsAt: week }, 20), /≈ 100% of your week/);
  assert.match(said({ shareBefore: 81, weekAtStart: 0, weekUsed: 20, weekResetsAt: week }, 20), /≈ 101% of your week/);
  assert.match(said({ shareBefore: 0, weekAtStart: 0, weekUsed: 38, weekResetsAt: week }, 38), /≈ 38% of your week/);
});

test('an orchestrator opens, and the more row opens everything', () => {
  const i = inputsOf('ManyAgents');
  const o1 = i.agents[0].id;
  const open = toPlain(renderCard(buildView({ ...i, ui: { expanded: { [o1]: true } } }), { width: 126 }));
  assert.ok(open.includes('▾ ◈ Own the billing workstream'));
  assert.ok(open.includes('▸ 3 more workers'));
  const all = toPlain(renderCard(buildView({ ...i, ui: { moreOpen: true } }), { width: 126 }));
  assert.ok(!all.includes('more workers'));
  assert.ok(all.includes('▾ fewer agents'));
  const ids = renderCard(buildView(i), { width: 126 }).flat().map(s => s.id).filter(Boolean);
  assert.ok(ids.includes('toggle:' + o1) && ids.includes('more') && ids.some(x => x.startsWith('view:')));
});

test('one more worker is singular', () => {
  const i = inputsOf('AgentsOpen');
  const boss = i.agents.find(a => !a.parentId && i.agents.some(k => k.parentId === a.id));
  const agents = [boss, ...i.agents.filter(a => a.parentId === boss.id).slice(0, 4)];
  const text = toPlain(renderCard(buildView({ ...i, agents, ui: { expanded: { [boss.id]: true } } }), { width: 126 }));
  assert.ok(text.includes('▸ 1 more worker'), text);
  assert.ok(!text.includes('1 more workers'));
});

test('every board fits the frame at 126, 100 and 80 columns', () => {
  for (const board of ['Brainstorm', 'Spec', 'Plan', 'Review'].map(s => 'Stage' + s).concat(['RunningA', 'NeedsYou', 'SeveralAsks', 'Paused', 'Done', 'ManyAgents', 'AgentsOpen', 'Stalled', 'NoMod'], Object.keys(SWEEP), Object.keys(LANES))) {
    for (const width of [126, 100, 80]) {
      const lines = strip(toAnsi(card(board, { width, frame: true }), 'dark', width)).split('\n');
      lines.forEach((l, i) => assert.equal(cols(l), width, board + ' at ' + width + ', line ' + i + ': ' + l));
    }
  }
});

test('sparse state prints no undefined, null or NaN', () => {
  const sub = { plan: {}, spec: {}, intent: {}, blindReview: {}, closing: {}, totals: {}, tasks: [], requirements: [], asks: [], pr: null };
  const states = [];
  for (const stage of ['', 'Brainstorm', 'Spec', 'Plan', 'Build', 'Review', 'Ship']) for (const status of ['with-you', 'running', 'paused', 'finished', 'stopped']) {
    states.push({ name: 'x', stage, status }, { name: 'x', stage, status, ...sub });
  }
  for (const state of states) for (const gate of [null, { reason: 'mark' }]) for (const usage of [null, {}, { sevenDay: {} }]) {
    for (const width of [126, 80, 40]) for (const frame of [false, true]) {
      const view = buildView({ state, agents: [{ id: 'a' }, { id: 'b', parentId: 'a', tokens: 5 }], usage, gate, now: NOW });
      const text = toPlain(renderCard(view, { width, frame, tick: 3 }));
      assert.ok(!/undefined|null|NaN/.test(text), JSON.stringify(state) + ' -> ' + text);
    }
  }
  const rows = renderStatusRows({ contextPercent: 37.6, weekUsedPercent: 30.4, markPercent: 75.2 }, { width: 100 });
  assert.ok(toPlain(rows).includes('38%') && toPlain(rows).includes('30%') && !/\d\.\d/.test(toPlain(rows)));
});

test('the paused card says what still runs, singular and plural', () => {
  const i = inputsOf('Paused');
  const line = n => toPlain(renderCard(buildView({ ...i, state: { ...i.state, tasks: Array.from({ length: n }, (_, k) => ({ id: 't' + k, status: 'running' })) } }), { width: 100 }))
    .split('\n').find(l => l.startsWith('nothing new starts'));
  assert.equal(line(1), 'nothing new starts · the running task finishes and merges first');
  assert.equal(line(3), 'nothing new starts · the 3 running tasks finish and merge first');
  assert.equal(line(0), 'nothing new starts · no task is running');
});

test('a share that rounds to zero reads "<1% of your week"', () => {
  const i = inputsOf('RunningA');
  const week = (state, usage = i.usage) => toPlain(renderCard(buildView({ ...i, state: { ...i.state, ...state }, usage }), { width: 126 }));
  const used = i.usage.sevenDay.percentUsed;
  assert.ok(week({ weekAtStart: used - 0.4 }).includes('<1% of your week'));
  assert.ok(week({ weekAtStart: used }).includes('<1% of your week'));
  assert.ok(week({ weekAtStart: used - 1 }).includes('≈ 1% of your week'));
  const done = inputsOf('Done');
  const finished = sharePercent => toPlain(renderCard(buildView({ ...done, state: { ...done.state, totals: { ...done.state.totals, sharePercent } } }), { width: 126 }));
  assert.ok(finished(0).includes('<1% of your week') && !finished(0).includes('≈'));
  assert.ok(finished(0.4).includes('<1% of your week'));
  assert.ok(finished(6.6).includes('≈ 7% of your week'));
});

test('a right group too long for the card is cut too', () => {
  const i = inputsOf('StageReview');
  const state = { ...i.state, requirements: i.state.requirements.map(r => (r.status === 'failing' ? { ...r, name: 'x'.repeat(60) } : r)) };
  for (const width of [44, 60, 80]) {
    const lines = strip(toAnsi(renderCard(buildView({ ...i, state }), { width, frame: true }), 'dark', width)).split('\n');
    lines.forEach(l => assert.equal(cols(l), width, l));
  }
});

test('every framed row is exactly the width, from 44 columns up', () => {
  const boards = ['Brainstorm', 'Spec', 'Plan', 'Review'].map(s => 'Stage' + s)
    .concat(['RunningA', 'NeedsYou', 'SeveralAsks', 'Paused', 'Done', 'ManyAgents', 'AgentsOpen', 'Stalled', 'NoMod']);
  for (const board of boards) for (let width = 44; width <= 130; width++) {
    const lines = strip(toAnsi(card(board, { width, frame: true }), 'dark', width)).split('\n');
    lines.forEach((l, i) => assert.equal(cols(l), width, board + ' at ' + width + ', line ' + i + ': ' + l));
  }
});

test('the Plan card says how many tasks, how many at once, and the models chosen', () => {
  const text = toPlain(card('StagePlan', { width: 126 }));
  assert.match(text, /\d+ tasks · up to \d+ at once/);
  assert.match(text, /models .*\d/);
});

// ---------------------------------------------------------------- defects found in review, 2026-11-19

const plain = rows => rows.map(r => r.map(s => s.t).join(''));
const at = { now: NOW };

test('a long failing requirement gives way, so the bar and the counts stay whole', () => {
  const requirements = Array.from({ length: 10 }, (_, i) => ({ id: 'R' + (i + 1), name: 'x', status: i < 6 ? 'pass' : 'todo' }));
  requirements[6] = { id: 'R7', name: 'Retries back off exponentially and give up after five attempts with a clear error', status: 'failing' };
  for (const width of [100, 120]) {
    const row = plain(renderCard(buildView({ state: { stage: 'Review', status: 'running', requirements, name: 'd' }, ...at }), { width, frame: true })).find(t => t.includes('requirements'));
    assert.match(row, /▱  6 pass · 1 failing · 3 to go/);
    assert.match(row, /failing: R7 Retries/);
  }
});

test('values lcw set stores as they come do not break the card', () => {
  const state = { stage: 'Brainstorm', status: 'with-you', health: 42, intent: { settled: 'why', now: 7, next: 'edge cases' }, name: 'd' };
  for (const width of [40, 120]) assert.ok(renderCard(buildView({ state, ...at }), { width, frame: true }).length);
  assert.match(plain(renderCard(buildView({ state, ...at }), { width: 120, frame: true })).join('\n'), /why/);
  assert.ok(renderCard(buildView({ state: { stage: 'Spec', status: 'running', blindReview: { done: 5 }, name: 'd' }, ...at }), { width: 100, frame: true }).length);
});

test('parked tasks count in the tasks bar while work is left, which reads finished once nothing is running or left', () => {
  const row = (statuses) => plain(renderCard(buildView({ state: { stage: 'Build', status: 'running', name: 'd', tasks: statuses.map((status, i) => ({ id: 'T' + i, title: 't', status })) }, ...at }), { width: 100, frame: true })).find(t => t.includes('tasks'));
  assert.match(row(['done', 'done', 'running', 'parked']), /▰{12}▰{6}▱{6}  2 done · 1 running · 1 parked/);
  assert.match(row(['done', 'done', 'parked']), /▰{24}  2 done · 1 parked/);
  assert.match(row(['done', 'done', 'done', 'parked', 'parked', 'dropped']), /▰{24}  3 done · 2 parked · 1 dropped/);
  assert.match(row(['parked', 'parked']), /▱{24}  2 parked/);
});

test('a collapsed orchestrator counts every agent under it', () => {
  const a = (id, parentId) => ({ id, parentId, description: id, status: 'running', startTime: NOW, tokenCount: 1 });
  const rows = plain(renderCard(buildView({ state: { stage: 'Build', status: 'running', name: 'd' }, agents: [a('o'), a('s', 'o'), a('w1', 's'), a('w2', 's')], ...at }), { width: 120, frame: true }));
  assert.ok(rows.some(t => /3 more agents/.test(t)));
});

test('paused at a mark the week has already passed, the hint offers a step above what is used', () => {
  const hint = (markPercent, percentUsed) => plain(renderCard(buildView({ state: { stage: 'Build', status: 'paused', pausedReason: 'mark', markPercent, name: 'd' },
    usage: { sevenDay: { percentUsed, resetsAt: new Date(NOW + 36e5).toISOString() } }, ...at }), { width: 100, frame: true })).join('\n').match(/run up to (\d+)%/)?.[1];
  assert.equal(hint(75, 40), '85');
  assert.equal(hint(70, 85), '90');
  assert.equal(hint(75, 92), '100');
  assert.equal(hint(95, 20), '100');
  assert.equal(hint(75, 100), undefined);
});

test('paused at a mark with an outside quota reading, the hint offers a step above the quota\'s figure', () => {
  const hint = (markPercent, percentUsed) => plain(renderCard(buildView({ state: { stage: 'Build', status: 'paused', pausedReason: 'mark', markPercent, name: 'd' },
    quota: { status: 'ok', hold: true, percentUsed }, ...at }), { width: 100, frame: true })).join('\n').match(/run up to (\d+)%/)?.[1];
  assert.equal(hint(70, 85), '90');
  assert.equal(hint(75, 92), '100');
  assert.equal(hint(75, 40), '85');
});

test('the placeholder zeros a spec and a plan start with are not drawn as figures', () => {
  const drawn = (stage, more) => plain(renderCard(buildView({ state: { stage, status: 'running', name: 'd', ...more }, ...at }), { width: 100, frame: true })).join('\n');
  assert.doesNotMatch(drawn('Spec', { spec: { requirements: 0, scenarios: 0 } }), /requirements|scenarios/);
  assert.match(drawn('Spec', { spec: { requirements: 4, scenarios: 9 } }), /4 requirements.*9 scenarios/);
  assert.doesNotMatch(drawn('Plan', { plan: { tasks: 0, atOnce: 0, models: {} } }), /0 tasks/);
  assert.match(drawn('Plan', { plan: { tasks: 12, atOnce: 4, models: {} } }), /12 tasks.*up to 4 at once/);
  const wave = tasks => ({ stage: 'Plan', shape: 'sweep', sweep: { waves: [{ n: 1, status: 'running', stage: 'Plan', plan: { tasks, atOnce: 0 } }] } });
  assert.doesNotMatch(drawn('Plan', wave(0)), /0 tasks/);
  assert.match(drawn('Plan', wave(7)), /7 tasks/);
});

test('paused at a 100% mark, the card offers no higher mark', () => {
  const rows = (markPercent) => plain(renderCard(buildView({ state: { stage: 'Build', status: 'paused', pausedReason: 'mark', markPercent, name: 'd' }, ...at }), { width: 100, frame: true })).join('\n');
  assert.doesNotMatch(rows(100), /run up to/);
  assert.match(rows(75), /run up to 85%/);
});


test('a long intent row keeps the newest in view: the oldest settled points give way after a "…"', () => {
  const v = buildView({ ...inputsOf('StageBrainstorm'), state: { ...inputsOf('StageBrainstorm').state,
    intent: { settled: ['why', 'what the cap counts', 'who for', 'the proxy', 'default cap', 'the first ask', 'finish regardless'], now: 'the reset', next: ['wording'], questionsOpen: 2 } } });
  const row = width => strip(toAnsi(renderCard(v, { width, frame: true }), 'dark', width)).split('\n').find(l => l.includes('intent'));
  const wide = row(200), tight = row(100);
  assert.ok(wide.includes('✓ why') && !wide.includes('…'), wide);
  assert.match(tight, /intent  …  ✓ /, tight);
  assert.ok(!tight.includes('✓ why') && tight.includes('› the reset  ○ wording') && tight.includes('2 questions open'), tight);
});

const withGuide = (board, guide = true) => { const i = inputsOf(board); i.state.guide = guide; return buildView(i); };
const guided = (v, opts) => strip(toAnsi(renderCard(v, opts), 'dark', opts.width)).split('\n');

test('the stage line shows only with guide true, dim, under the stages and lined up with them', () => {
  const lines = guided(withGuide('RunningA'), { width: 96, frame: true });
  const i = lines.findIndex(l => l.includes('Brainstorm'));
  assert.match(lines[i + 1], /^│ Build · workers write the code, milestone by milestone; a reviewer checks each one +│$/);
  assert.ok(lines.every(l => cols(l) === 96));
  const dim = renderCard(withGuide('RunningA'), { width: 96 }).flat().find(s => s.t.startsWith('Build · '));
  assert.equal(dim.c, 'dim');
  for (const off of [false, null, 'true']) assert.ok(!guided(withGuide('RunningA', off), { width: 96, frame: true }).join('').includes('workers write'));
  assert.equal(card('RunningA', { width: 96 }).length + 1, renderCard(withGuide('RunningA'), { width: 96 }).length);
});

test('a finished card has no stage line', () => {
  assert.ok(!guided(withGuide('Done'), { width: 96, frame: true }).join('').includes('Ship · '));
});

test('the stage line is cut short on a narrow card and never wraps', () => {
  const lines = guided(withGuide('RunningA'), { width: 60, frame: true });
  const l = lines.find(x => x.includes('Build · workers'));
  assert.equal(cols(l), 60);
  assert.ok(!l.includes('checks each one'));
  assert.ok(lines.every(x => cols(x) === 60));
});

test('the stage line is the first row to go when maxRows is short', () => {
  const v = withGuide('ManyAgents');
  const full = renderCard(v, { width: 126 });
  const noGuide = renderCard(withGuide('ManyAgents', false), { width: 126 });
  assert.equal(full.length, noGuide.length + 1);
  // room for the card without the line: the line goes, no agent row does
  const rows = renderCard(v, { width: 126, maxRows: noGuide.length });
  assert.equal(toPlain(rows), toPlain(noGuide));
  assert.equal(renderCard(v, { width: 126, maxRows: full.length }).length, full.length);
});

test('hideMarkHint drops only the say-run-up-to row of a paused card', () => {
  const v = buildView(inputsOf('Paused'));
  const shown = toPlain(renderCard(v, { width: 100 })), hidden = toPlain(renderCard(v, { width: 100, hideMarkHint: true }));
  assert.match(shown, /run up to/);
  assert.doesNotMatch(hidden, /run up to/);
  assert.equal(hidden.split('\n').length, shown.split('\n').length - 1);
  assert.match(hidden, /nothing new starts/);
});

test('asksInBox leaves the asks the answer box shows to it: the card keeps only its needs-you head', () => {
  for (const board of ['13-needs-you-one-question', '14-needs-you-two-questions']) {
    const v = buildView(inputsOf(board));
    for (const width of [100, 40]) {
      const shown = toPlain(renderCard(v, { width })), boxed = toPlain(renderCard(v, { width, asksInBox: v.asks.map(a => a.n) }));
      assert.ok(shown.includes(v.asks[0].text.slice(0, 12)), board + ' keeps the text without it');
      assert.doesNotMatch(boxed, /GitHub|Docker|Stripe|answer in plain words/, board);
      assert.match(boxed, board.startsWith('13') ? /⚑ needs you · 12m/ : /⚑ needs you · 2/, board);
      assert.equal(boxed.split('\n').length, shown.split('\n').length - (width < 44 ? 1 : board.startsWith('13') ? 4 : 3), board + ' drops the text rows');
    }
  }
});

test('an ask the answer box does not show stays on the card, and the one it shows does not', () => {
  const v = buildView(inputsOf('14-needs-you-two-questions'));
  for (const width of [100, 40]) {
    const boxed = toPlain(renderCard(v, { width, asksInBox: [v.asks[0].n] }));
    assert.ok(!boxed.includes(v.asks[0].text.slice(0, 12)), 'the boxed ask');
    assert.ok(boxed.includes(v.asks[1].text.slice(0, 12)), 'the other ask');
    assert.match(boxed, /⚑ needs you · 2/);
  }
});

// ---------------------------------------------------------------- a sweep

test("each sweep state, and a build's, is drawn row for row as approved", () => {
  for (const [board, want] of Object.entries(SWEEP)) {
    const width = board.startsWith('22-') ? 40 : 121;
    const got = strip(toAnsi(card(board, { width, frame: true }), 'dark', width)).split('\n')
      .filter(l => !/^│ +(→|[▾▸] (◈|\d+ more|fewer))/.test(l) && !/^[├╰]/.test(l) && !/^ *(→|Sonnet ·)/.test(l))
      .map(l => (l.startsWith('│ ') ? l.slice(2, -2).trimEnd() : l));
    assert.deepEqual(got, want, board);
  }
});

const laneRows = (i, width = 115) => strip(toAnsi(renderCard(buildView(i), { width }), 'dark', width)).split('\n').map(l => l.trimEnd());
// A wave's lane starts with its arrow; the lanes' heading stands in by the arrow's two cells.
const laneOf = (rows, n) => rows.find(l => new RegExp('^[▾▸] wave ' + n + ' ').test(l));
const headOf = rows => rows.find(l => /^(  )?waves /.test(l));
// The review-and-build board with wave 1's record changed.
const withWave1 = (patch, sweep) => {
  const i = inputsOf('25-lanes-review-and-build');
  i.state.sweep = { ...i.state.sweep, ...sweep, waves: [{ ...i.state.sweep.waves[0], ...patch }, ...i.state.sweep.waves.slice(1)] };
  return i;
};

test('the six approved lane states are drawn row for row, wide and narrow', () => {
  for (const [board, { wide, narrow }] of Object.entries(LANES)) {
    assert.deepEqual(laneRows(inputsOf(board), 115), wide, board);
    assert.deepEqual(laneRows(inputsOf(board), 35), narrow, board);
  }
});

test('a wave closing its review says closures, with its track still in Review', () => {
  const lane = laneOf(laneRows(withWave1({ step: 'closures' })), 1);
  assert.match(lane, / {2}▰{8} {2}▱{6} {4}closures +34m$/);
});

test('a wave at Ship says merging once its checks passed, and that its final checks are next before they start', () => {
  assert.match(laneOf(laneRows(withWave1({ stage: 'Ship', step: 'merging' })), 1), /▰{6} {4}merging +34m$/);
  assert.match(laneOf(laneRows(withWave1({ stage: 'Ship', step: null })), 1), /▰{6} {4}final checks next +34m$/);
});

test('a wave with every task done and still in Build says its review is next', () => {
  const done = (ids) => ids.map((id) => ({ id, title: id, status: 'done' }));
  const built = { stage: 'Build', round: 0, tasks: done(['T1', 'T2', 'T3']) };
  assert.match(laneOf(laneRows(withWave1(built)), 1), / 3 of  3 tasks done · review next +34m$/);
  // A task still to start is work left in Build, so nothing is said of the review yet.
  const left = { ...built, tasks: [...built.tasks, { id: 'T4', title: 'T4', status: 'todo' }] };
  assert.match(laneOf(laneRows(withWave1(left)), 1), / 3 of  4 tasks done +34m$/);
});

test('a built wave with parked and dropped tasks reads finished and still names the parked ones', () => {
  const tasks = (statuses) => statuses.map((status, k) => ({ id: 'T' + k, title: 't', status }));
  const built = { stage: 'Build', round: 0, tasks: tasks(['done', 'done', 'done', 'parked', 'parked', 'dropped']) };
  assert.match(laneOf(laneRows(withWave1(built)), 1), /^▾ wave 1  ▰{6}  ▰{7}  ▱{8}  ▱{6} {4}3 of  3 tasks done · 2 parked · review next +34m$/);
  // While work is left the parked ones still count, and are named.
  const going = { ...built, tasks: tasks(['done', 'done', 'done', 'running', 'parked', 'parked']) };
  assert.match(laneOf(laneRows(withWave1(going)), 1), / 3 of  6 tasks done · 1 running · 2 parked +34m$/);
  // With nothing built there is no figure: the parked ones alone.
  const none = { ...built, tasks: tasks(['parked', 'parked', 'dropped']) };
  assert.match(laneOf(laneRows(withWave1(none)), 1), /^▾ wave 1  ▰{6}  ▱{7}  ▱{8}  ▱{6} {4}2 parked +34m$/);
});

test('a wave shipped and waiting on its merge keeps its lane at Ship while the charter merges as it goes', () => {
  const held = { status: 'shipped', merged: false, pr: 41, stage: 'Review', step: null };
  const rows = laneRows(withWave1(held, { prs: 'merged' }));
  assert.match(laneOf(rows, 1), /▰{6} {4}merging/);
  assert.match(headOf(rows), /Ship {4}▰▰▱ {2}1 queued/);
  // With stacked pull requests it has merged, and no lane stands for it.
  const stacked = laneRows(withWave1(held, { prs: 'stacked' }));
  assert.equal(laneOf(stacked, 1), undefined);
  assert.match(headOf(stacked), /Ship {4}▰▰▱ {2}1 done · 1 queued/);
  // A run that is over holds no wave open.
  const over = withWave1(held, { prs: 'merged' });
  over.state.status = 'finished';
  assert.ok(!laneOf(laneRows(over), 1));
});

test('a shipped wave that was left empty has no pull request to merge, so it holds no lane', () => {
  const held = { status: 'shipped', merged: false, pr: 41, stage: 'Review', step: null };
  assert.ok(laneOf(laneRows(withWave1(held, { prs: 'merged' })), 1));
  assert.ok(!laneOf(laneRows(withWave1({ ...held, pr: undefined, empty: true }, { prs: 'merged' })), 1));
});

test('the paused row counts the running tasks of every open wave', () => {
  assert.equal(buildView(inputsOf('26-lanes-three-open')).running, 4);
});

test('at 100 columns nothing is lost, at 80 the longer words go first, and below 60 the lanes are the narrow ones', () => {
  const at = (w) => laneRows(inputsOf('25-lanes-review-and-build'), w);
  const full = at(100);
  assert.match(laneOf(full, 1), /18 of 23 fixes pass · 1 failing · review 2 +34m$/);
  assert.match(headOf(full), /▰▰▱ {2}1 queued · next: wave 3 +round 1 · 2 parked$/);
  const eighty = at(80);
  // The later review round goes before the failing fix, the last to lose.
  assert.match(laneOf(eighty, 1), /18 of 23 pass · 1 failing … +34m$/);
  // A lane with room for more than the form every lane fits says it.
  assert.match(laneOf(eighty, 2), /7 of 12 done · 3 running +22m$/);
  const fifty = at(50);
  assert.match(headOf(fifty), /^waves {3}▰▰▱ {2}2 in progress · 1 queued/);
  assert.equal(fifty.find(l => l.startsWith('wave 1 ')), 'wave 1  ▰▰▰ ▰▰▰ ▰▰▰ ▱▱▱  Review', 'a narrow lane has no arrow');
  // Where the heading is short the sweep's totals give way before the wave counts, and the counts before the cells.
  const long = (w) => headOf(laneRows(inputsOf('28-lanes-a-long-sweep'), w));
  assert.match(long(115), /Ship {4}▰{7}▱{2} {2}5 done · 2 queued +round 3 · 61 fixed · 170 parked …$/);
  assert.match(long(80), /Ship {4}▰{7}▱{2} {2}5 done · 2 queued +…$/);
  // Too short for the counts beside the stages: the stages go and the counts stay.
  assert.match(long(71), /^ {2}waves {3}▰{7}▱{2} {2}5 done · 2 queued +61 fixed · 170 parked …$/);
  for (const board of Object.keys(LANES)) for (const w of [140, 100, 80, 70, 60, 50, 44, 43, 36, 30]) {
    laneRows(inputsOf(board), w).forEach(l => assert.ok(cols(l) <= w, board + ' at ' + w + ': ' + l));
  }
});

test('framed at 100 columns the heading keeps its wave counts and as many totals as fit', () => {
  const heading = board => strip(toAnsi(card(board, { width: 100, frame: true }), 'dark', 100)).split('\n').find(l => l.startsWith('│   waves '));
  assert.match(heading('29-lanes-hunt-and-final-checks'), /Ship {4}▰▰▰ {2}2 done +round 2 · 43 fixed · 2 parked … │$/);
  // The long sweep has no room for all: the dropped, the round and the parked go.
  assert.match(heading('28-lanes-a-long-sweep'), /Ship {4}▰{7}▱{2} {2}5 done · 2 queued +61 fixed … │$/);
});

test('a narrow waves row drops whole counts and never cuts a word or leaves a dangling dot', () => {
  let seen = 0;
  for (let w = 36; w <= 60; w++) {
    const rows = strip(toAnsi(card('28-lanes-a-long-sweep', { width: w, frame: true }), 'dark', w)).split('\n').filter(l => l.startsWith('│ waves '));
    for (const row of rows) {
      seen++;
      const after = row.slice(2, -2).trim().replace(/^waves\s+/, '').replace(/[▰▱]+|[✓›○] (Plan|Build|Review|Ship)/gu, '').replace(/ *…/g, "").trim();
      if (!after) continue;
      for (const part of after.split(/ {2,}/).join(' · ').split(' · ')) {
        assert.match(part, /^(\d+ (done|in progress|queued|fixed|parked|dropped)|round \d+)$/, w + ': ' + row);
      }
    }
  }
  assert.ok(seen > 0);
});

test('a lane with nothing to count keeps its shape and draws its stage empty, with no figure', () => {
  const parked = [{ id: 'F1', name: 'a', status: 'parked' }, { id: 'F2', name: 'b', status: 'dropped' }];
  assert.match(laneOf(laneRows(withWave1({ requirements: parked })), 1), /^▾ wave 1  ▰{6}  ▰{7}  ▱{8}  ▱{6} +34m$/);
  assert.match(laneOf(laneRows(withWave1({ stage: 'Build', tasks: [] })), 1), /^▾ wave 1  ▰{6}  ▱{7}  ▱{8}  ▱{6} +34m$/);
});

test('a hunt round beside open waves has its lane before any area is recorded', () => {
  const i = inputsOf('29-lanes-hunt-and-final-checks');
  i.state.sweep.hunt = { areas: 0, hunted: 0, running: 0, findings: 0 };
  assert.match(laneRows(i).find(l => l.startsWith('  round 2 ')), /^  round 2  › Hunt  ▱{25} {4}starting +5m$/);
});

test('a wave whose stage has no start time draws no clock', () => {
  const held = { status: 'shipped', merged: false, pr: 41, stage: 'Review', step: null, stageSince: undefined };
  assert.match(laneOf(laneRows(withWave1(held, { prs: 'merged' })), 1), /▰{6} {4}merging #41$/);
});

test("a sweep's waves row keeps to 24 cells however many waves are queued", () => {
  const i = inputsOf('06-build-wave-2-fixes-in-parallel');
  const waves = Array.from({ length: 40 }, (_, k) => ({ n: k + 1, status: k < 10 ? 'shipped' : 'queued' }));
  const v = buildView({ ...i, state: { ...i.state, sweep: { ...i.state.sweep, waves } } });
  const row = strip(toAnsi(renderCard(v, { width: 121, frame: true }), 'dark', 121)).split('\n').find(l => l.includes('waves'));
  assert.equal(row.match(/[▰▱]/g).length, 24);
  assert.match(row, /waves ▰{6}▱{18}  10 done · 30 queued/);
});

test('a sweep with sparse or odd state prints no undefined, null or NaN', () => {
  const sweeps = [undefined, {}, { charter: 'x', open: null, hunt: { areas: 3, hunted: 'many' }, waves: [{ status: 'running', pr: 'x' }, {}] },
    { charter: 12, round: 2, hunt: { fix: 1 }, waves: [{ status: 'shipped', pr: 7, merged: true }, { status: 'shipped', pr: 8 }] },
    { prs: 'merged', round: 1, waves: [{ n: 1, status: 'running', stage: 'Review', step: 7, round: 'x', stageSince: 'soon', tasks: null, requirements: 'x' },
      { n: 2, status: 'running', stage: 'Plan', plan: { tasks: null }, waiting: 1 }, { n: 3, status: 'shipped', merged: false }] }];
  for (const stage of ['', 'Charter', 'Hunt', 'Plan', 'Build', 'Review', 'Ship']) for (const status of ['with-you', 'running', 'paused', 'finished', 'stopped']) {
    for (const sweep of sweeps) for (const width of [121, 40]) {
      const state = { name: 'x', shape: 'sweep', stage, status, sweep, tasks: [{ id: 'T1', status: 'dropped' }], requirements: [{ id: 'F1', status: 'pass' }] };
      const text = toPlain(renderCard(buildView({ state, usage: null, now: NOW }), { width, frame: true, tick: 3 }));
      assert.ok(!/undefined|null|NaN/.test(text), JSON.stringify(state) + ' -> ' + text);
    }
  }
});

test("a sweep's Ship guide line does not say it writes a pull request, and a build's still does", () => {
  const i = inputsOf('10-ship-wave-2');
  i.state.guide = true;
  assert.equal(buildView(i).guide, "Ship · landing the wave on the sweep's branch");
  const b = inputsOf('RunningA');
  b.state.guide = true;
  b.state.stage = 'Ship';
  assert.match(buildView(b).guide, /writing the draft pull request/);
});

test("a parked fix is neither to go nor dropped on the wave's fixes lane, and the wave's totals count only what passed", () => {
  const i = inputsOf('09-review-once-for-the-whole-wave');
  i.state.requirements = [{ id: 'F1', name: 'a', status: 'pass' }, { id: 'F2', name: 'b', status: 'parked' }, { id: 'F3', name: 'c', status: 'todo' }];
  const row = strip(toAnsi(renderCard(buildView(i), { width: 121, frame: true }), 'dark', 121)).split('\n').find(l => l.startsWith('│ ▾ wave 2 '));
  assert.match(row, /^│ ▾ wave 2 .*  1 of 2 fixes pass +\d+m │$/);
  const j = inputsOf('10-ship-wave-2');
  j.state.requirements = i.state.requirements;
  const s = buildView(j).sweep;
  assert.deepEqual([s.fixed, s.parked, s.dropped], [j.state.sweep.fixed + 1, j.state.sweep.parked, j.state.sweep.dropped + j.state.sweep.waves[1].dropped]);
});

test('in a wave\'s review a partly fixed fix counts as reviewed, not as one to go', () => {
  const requirements = [{ id: 'F1', name: 'a', status: 'pass' }, { id: 'F2', name: 'b', status: 'partial' }, { id: 'F3', name: 'c', status: 'todo' }];
  const view = buildView({ state: { shape: 'sweep', stage: 'Review', status: 'running', requirements, sweep: { waves: [] } }, now: NOW });
  assert.deepEqual([view.detail.pass, view.detail.toGo, view.detail.total], [2, 1, 3]);
});

// Cells as a terminal draws them: Chinese, Japanese and Korean characters and emoji take two.
const cellsOf = t => [...t].reduce((n, c) => n + (/[　-鿿＀-｠\u{1F300}-\u{1FAFF}]/u.test(c) ? 2 : 1), 0);
const joined = spans => spans.map(s => s.t).join('');
const rowCells = r => { const k = r.findIndex(s => s.r); return k < 0 ? cellsOf(joined(r)) : cellsOf(joined(r.slice(0, k))) + 2 + cellsOf(joined(r.slice(k))); };

test('wide characters take two cells, so every row keeps to the width and the frame', () => {
  const state = { name: 'アップロード再試行の修正', stage: 'Build', status: 'running', stageSince: NOW - 6e5, createdAt: NOW - 6e5, health: '作業者がテストを書いています',
    asks: [{ n: 1, text: 'アップロードの再試行は何回までにしますか？指数バックオフを使いますか？', at: NOW }], tasks: [{ id: 'T1', status: 'running' }] };
  const agents = [{ id: 'a', description: '再試行ポリシーのテストを書く 🧪', model: 'claude-sonnet-4-5', effort: 'high', tokens: 1000, startTime: NOW, status: 'running' }];
  for (const [width, frame] of [[60, true], [100, true], [40, false]]) {
    for (const r of renderCard(buildView({ state, agents, now: NOW }), { width, frame })) {
      const n = rowCells(r);
      assert.ok(n <= width, width + ': ' + n + ' cells: ' + joined(r));
      if (frame && !r.some(s => s.r)) assert.equal(n, width, joined(r));
    }
  }
});

test('outside the lanes the waves row keeps its label and cells, and its counts and totals give way whole', () => {
  const waves = [1, 2, 3].map(n => ({ n, status: 'shipped', pr: n })).concat([4, 5].map(n => ({ n, status: 'queued' })));
  const state = { name: 'sweep-x', shape: 'sweep', stage: 'Hunt', status: 'running', createdAt: NOW - 864e5, stageSince: NOW - 6e5,
    sweep: { round: 2, fixed: 14, parked: 3, dropped: 2, prs: 'stacked', hunt: { fix: 6, park: 1, drop: 2 }, waves } };
  const row = (width, s = state) => laneRows({ state: s, now: NOW }, width).find(l => l.startsWith('waves'));
  for (let w = 44; w <= 90; w++) assert.match(row(w), /^waves ▰▰▰▱▱(  3 done( · 2 queued( · next: wave 4)?)?)?( {2,}(round 2|\d+ (fixed|parked|dropped))( · [^·…]+)*)?( …)?$/, w + ': ' + row(w));
  assert.match(row(80), /^waves ▰▰▰▱▱  3 done · 2 queued +round 2 · 14 fixed · 3 parked · 2 dropped$/);
  // With no wave queued yet the totals give way too.
  const none = { ...state, sweep: { ...state.sweep, waves: [] } };
  for (let w = 44; w <= 90; w++) assert.match(row(w, none), /^waves none queued yet( {2,}(round 2|\d+ (fixed|parked|dropped))( · [^·…]+)*)?( +…)?$/, w + ': ' + row(w, none));
});

test('the requirements bar stays twenty cells when one failing of many rounds to a cell of its own', () => {
  const requirements = [...Array.from({ length: 39 }, (_, k) => ({ id: 'R' + k, name: 'x', status: 'pass' })), { id: 'R39', name: 'retry policy', status: 'failing' }];
  const row = plain(renderCard(buildView({ state: { name: 'd', stage: 'Review', status: 'running', requirements }, ...at }), { width: 120 })).find(t => t.startsWith('requirements'));
  assert.match(row, /^requirements ▰{20}  39 pass · 1 failing/);
  // The failing one keeps a cell of its own in the bar, here and in a wave's lane.
  const cellsOf = (rows, colour) => rows.flat().filter(s => /^▰+$/.test(s.t) && String(s.c).startsWith(colour)).reduce((n, s) => n + [...s.t].length, 0);
  const card = renderCard(buildView({ state: { name: 'd', stage: 'Review', status: 'running', requirements }, ...at }), { width: 120 });
  assert.deepEqual([cellsOf(card, 'ok'), cellsOf(card, 'caution')], [19, 1]);
  const lane = renderCard(buildView(withWave1({ requirements })), { width: 115 }).filter(r => r.some(s => s.t === 'wave ')).slice(0, 1);
  assert.equal(cellsOf(lane, 'caution'), 1);
});

test('a long model name is shortened so row 1 keeps to the width', () => {
  const input = { ...inputsOf('Main').status, model: 'Sonnet 4.5 (1M context)', effort: 'medium' };
  for (let width = 30; width <= 80; width++) {
    const rows = renderStatusRows(input, { width });
    rows.forEach((r, i) => assert.ok(rowCells(r) <= width, width + ', row ' + (i + 1) + ': ' + toPlain([r])));
  }
  assert.match(joined(renderStatusRows(input, { width: 44 })[0]), /^Sonnet 4\.5 \(1M contex… +38% of 1M$/);
  assert.match(joined(renderStatusRows(input, { width: 80 })[0]), /^Sonnet 4\.5 \(1M context\) · medium/);
});

test('just after the weekly reset the week row gives no pace, until enough of the week has passed for it to mean something', () => {
  const right = (weekElapsedPercent, weekUsedPercent) => {
    const r = renderStatusRows({ ...inputsOf('Main').status, weekElapsedPercent, weekUsedPercent }, { width: 126 })[1];
    return joined(r.slice(r.findIndex(s => s.r)));
  };
  assert.equal(right(20 / 60 / 168 * 100, 1), 'resets in 6d');
  assert.equal(right(4.9, 1), 'resets in 6d');
  assert.equal(right(5, 1), 'resets in 6d · 80% spare');
  assert.equal(right(50, 60), 'resets in 3d · 20% over pace');
});

test("the lanes' heading keeps its wave cells to the room left, so none is cut while the lanes fit", () => {
  const queued = Array.from({ length: 20 }, (_, k) => ({ n: 10 + k, status: 'queued' }));
  const state = { name: 'sweep-x', shape: 'sweep', stage: 'Ship', status: 'running', createdAt: NOW - 3e6, stageSince: NOW - 1e6,
    sweep: { round: 1, fixed: 3, parked: 1, dropped: 2, prs: 'stacked', waves: [{ n: 1, status: 'shipped', pr: 5 },
      { n: 2, status: 'running', stage: 'Ship', step: 'merging', stageSince: NOW - 6e5, requirements: [], tasks: [] }, ...queued] } };
  for (const width of [74, 76, 78, 80]) {
    const rows = laneRows({ state, now: NOW }, width);
    assert.match(headOf(rows), /^ {2}waves {3}✓ Plan {2}✓ Build {2}✓ Review {2}› Ship {4}▰+▱+ {2}1 done · 20 queued(?: +…)?$/, width + ': ' + rows.join('\n'));
    assert.equal(headOf(rows).length, width);
    assert.match(laneOf(rows, 2), / {4}merging +10m$/);
  }
});

test("an agent's effort stays whole and in its column, with no token figure or with a chip of an hour or more", () => {
  const efforts = (i, width) => strip(toAnsi(renderCard(buildView(i), { width }), 'dark', width)).split('\n')
    .filter(l => /^ *→/.test(l)).map(l => [l.indexOf(/(medium|low|high|xhigh)\b/.exec(l)?.[0]), /(medium|low|high|xhigh) /.exec(l)?.[1]]);
  for (const width of [100, 120]) {
    const noMod = efforts(inputsOf('NoMod'), width);
    assert.ok(noMod.length && noMod.every(([at, e]) => e && at === noMod[0][0]), width + ': ' + JSON.stringify(noMod));
    // The dash stands where the token figure would.
    const row = strip(toAnsi(renderCard(buildView(inputsOf('NoMod')), { width }), 'dark', width)).split('\n').find(l => l.includes('—'));
    assert.match(row, / {12}— {5}12m$/);
    const i = inputsOf('RunningA');
    i.agents = [...i.agents.slice(0, 2), { ...i.agents[0], id: 'old', effort: 'medium', startTime: NOW - 65 * 6e4, quietMs: 20 * 6e4 }];
    const chip = efforts(i, width);
    assert.ok(chip.length === 3 && chip.every(([at, e]) => e && at === chip[0][0]), width + ': ' + JSON.stringify(chip));
  }
});

const framedRows = (i, width) => strip(toAnsi(renderCard(buildView(i), { width, frame: true }), 'dark', width)).split('\n');

test('the charter row keeps the line being asked at any width, and cuts the lines not reached yet after a "…"', () => {
  for (const charter of [0, 1, 2]) {
    const i = inputsOf('01-charter-with-you');
    i.state.sweep = { ...i.state.sweep, charter };
    const asked = ['goals', 'non-goals', 'anti-goals'][charter];
    for (const width of [80, 100, 120]) {
      const row = framedRows(i, width).find(l => l.includes('charter  '));
      assert.ok(row.includes('› ' + asked) && row.includes('1 question open'), width + ': ' + row);
    }
  }
  const i = inputsOf('01-charter-with-you');
  i.state.sweep = { ...i.state.sweep, charter: 1 };
  const row = framedRows(i, 80).find(l => l.includes('charter  '));
  assert.match(row, /› non-goals.*…\s+1 question open/, row);
});

test("an agent row's effort is whole or absent when the card is narrow", () => {
  for (const width of [60, 64, 68]) {
    const rows = framedRows(inputsOf('03-hunt-round-1-probes-at-work'), width).filter(l => l.includes('→'));
    assert.ok(rows.length);
    for (const l of rows) {
      // What stands left of the sparkline ends in a whole model or a whole effort, never a word cut short.
      const before = l.slice(0, l.search(/[▁-█]/)).trimEnd();
      assert.match(before, /(?:\d\.\d|low|medium|high|xhigh|max)$/, width + ': ' + l);
    }
  }
});

test('a cut on the edge of a span leaves no dangling dot and says it cut', () => {
  const row = framedRows(inputsOf('03-hunt-round-1-probes-at-work'), 65).find(l => l.includes('areas '));
  assert.ok(row.includes('…') && !/·\s+23 findings/.test(row), row);
  assert.match(row, /…\s+23 findings so far/, row);
});

test('a cut that drops whole spans always shows "…", even where what is left ends on a word', () => {
  for (const width of [61, 65]) {
    const row = framedRows(inputsOf('03-hunt-round-1-probes-at-work'), width).find(l => l.includes('areas '));
    assert.match(row, /(▱ |14 hunted |6 running )…\s+23 findings so far/, width + ': ' + row);
    assert.ok(!row.includes('16 left'), row);
  }
  const plain = strip(toAnsi(card('03-hunt-round-1-probes-at-work', { width: 61 }), 'dark', 61)).split('\n').find(l => l.startsWith('areas '));
  assert.match(plain, /…\s+23 findings so far/, plain);
});

test('a cut leaves no dangling "›" before its "…"', () => {
  for (const [width, frame] of [[81, true], [77, false]]) {
    const row = strip(toAnsi(card('StageSpec', { width, frame }), 'dark', width)).split('\n').find(l => l.includes('blind review  '));
    assert.ok(row.includes('…') && !/[›·]\s*…/.test(row), row);
  }
});

test('no row of any board is wider than the card, at any width from 20 to 200', () => {
  for (const name of Object.keys(fixtures)) {
    for (let width = 20; width <= 200; width++) {
      for (const frame of [false, true]) {
        for (const l of strip(toAnsi(card(name, { width, frame }), 'dark', width)).split('\n')) {
          assert.ok(cols(l) <= width, name + ' at ' + width + (frame ? ' framed' : '') + ': ' + l);
        }
      }
    }
  }
});

test('a lane or heading that drops what it said ends in "…", and a row that fits whole has none', () => {
  const rows = (board, width, frame) => strip(toAnsi(card(board, { width, frame }), 'dark', width)).split('\n');
  for (const width of [72, 74]) {
    assert.match(laneOf(rows('06-build-wave-2-fixes-in-parallel', width, false), 2), /9 of 28( done)? … +22m$/, String(width));
  }
  assert.ok(!laneOf(rows('06-build-wave-2-fixes-in-parallel', 80, false), 2).includes('…'));
  for (const width of [60, 70]) {
    assert.match(headOf(rows('28-lanes-a-long-sweep', width, false)), /queued( …)? +61 fixed( · 170 parked)? …$/, String(width));
  }
  assert.match(headOf(rows('28-lanes-a-long-sweep', 80, false)), /2 queued +…$/);
  assert.match(rows('28-lanes-a-long-sweep', 44, true).find(l => l.startsWith('│ waves ')), /2 queued …/);
});

test('a totals group that drops a part ends in "…", and one that fits whole has none', () => {
  const rows = (board, width, start) => strip(toAnsi(card(board, { width, frame: false }), 'dark', width)).split('\n').find(l => l.trimStart().startsWith(start));
  const wave = '06-build-wave-2-fixes-in-parallel', long = '28-lanes-a-long-sweep';
  // A shorter strip makes room for the first total and its "…" before a lone "…" stands for them all.
  assert.match(rows(wave, 82, 'waves'), /▰▰▱ {2}1 done · 4 queued +27 fixed …$/);
  // Nothing of the totals fits: a "…" stands where they were.
  assert.match(rows(long, 80, 'waves'), /5 done · 2 queued +…$/);
  // Some of them fit: the "…" follows them, even where the counts end in one too.
  assert.match(rows(wave, 50, 'waves'), /4 queued … +27 fixed …$/);
  assert.match(rows(long, 50, 'waves'), /2 queued … +61 fixed …$/);
  assert.match(rows(long, 115, 'waves'), /2 queued +round 3 · 61 fixed · 170 parked …$/);
  assert.match(rows('29-lanes-hunt-and-final-checks', 115, 'waves'), /2 done +round 2 · 43 fixed · 2 parked · 3 dropped$/);
  for (const w of [44, 50, 60, 70, 80, 100]) for (const b of [wave, long]) assert.ok(cols(rows(b, w, 'waves')) <= w, b + ' at ' + w);
});

test('a cut never leaves a separator before its "…"', () => {
  const at = (board, width, start) => strip(toAnsi(card(board, { width, frame: false }), 'dark', width)).split('\n').find(l => l.startsWith(start));
  assert.match(at('RunningA', 44, 'tasks'), /▱  11 done · 3 running · 6 left$/);
  assert.match(toPlain(card('RunningA', { width: 44, frame: true })).split('\n').find(l => l.startsWith('│ tasks')), /3 running … +│$/);
  assert.match(at('StageSpec', 77, 'blind review'), /reviewer 1 · row…/);
});

test('a cut inside a span ahead of a separator drops the separator too', () => {
  for (const [board, width] of [['RunningA', 46], ['19-finished-some-waves-short-of-your-rule', 28], ['NeedsYou', 62], ['ManyAgents', 77], ['ManyAgents', 31], ['StageSpec', 56], ['NeedsYou', 23], ['NeedsYou', 31], ['NeedsYou', 40], ['Done', 46]]) {
    for (const w of [width, width + 1]) for (const frame of [true, false]) {
      const lines = strip(toAnsi(card(board, { width: w, frame }), 'dark', w)).split('\n');
      for (const l of lines) {
        // A dim " …" after the lanes, waves or totals marks parts dropped, and keeps its space; a clipped word does not.
        assert.ok(!/[·›] ?…/.test(l), board + ' at ' + w + ': ' + l);
        assert.ok(!/\S\s+…/.test(l.replace(/^│ /, '').replace(/(\d+ \w+|queued|fixed|done|waves?) …/g, '$1…')), board + ' at ' + w + ': ' + l);
        assert.ok(cols(l) <= w, board + ' at ' + w + ': ' + l);
      }
    }
  }
  const l = strip(toAnsi(card('RunningA', { width: 46, frame: true }), 'dark', 46)).split('\n')[1];
  assert.equal(cols(l), 46);
  // An agent description clipped and padded already ends in "…": the cut keeps one.
  const views = [['StageBrainstorm', buildView(inputsOf('StageBrainstorm'))], ['08-build-a-very-large-wave', buildView(inputsOf('08-build-a-very-large-wave'))]];
  for (const [name, view] of views) for (const w of [45, 46, 47, 48]) for (const frame of [true, false]) {
    for (const r of strip(toAnsi(renderCard(view, { width: w, frame }), 'dark', w)).split('\n')) {
      assert.ok(!/……|… …/.test(r), name + ' at ' + w + ': ' + r);
      assert.ok(cols(r) <= w, name + ' at ' + w + ': ' + r);
    }
  }
});

// Three waves open, and agents that say which wave they work for: each is listed under its own wave's lane.
const underLanes = (agents, opts = {}) => {
  const i = inputsOf('26-lanes-three-open');
  i.agents = agents.map(([id, description, wave, more = {}]) => ({ id, description, model: 'claude-opus-5-5', effort: 'high', tokens: 1000, startTime: i.now - 60000, status: 'running', ...(wave == null ? {} : { wave }), ...more }));
  // folded: the waves the person folded, each by the run it was folded in (this one unless named)
  if (opts.folded) i.ui = { folded: Object.fromEntries(opts.folded.map(f => [foldKey(f.run ?? i.state.id, f.wave ?? f), true])) };
  // waits: why a wave has no agent at work, by its number; edit: any other change to the sweep's state
  for (const [n, why] of Object.entries(opts.waits ?? {})) i.state.sweep.waves.find(w => w.n === Number(n)).waits = why;
  // sat: since when each wave has had no agent at work, by its number, as the mod keeps it for this run
  if (opts.sat) i.sat = { run: i.state.id, waves: Object.fromEntries(Object.entries(opts.sat).map(([n, since]) => [n, { since }])) };
  opts.edit?.(i.state);
  if (opts.spans) return renderCard(buildView(i), { width: opts.width ?? 115 });
  const width = opts.width ?? 115;
  return strip(toAnsi(renderCard(buildView(i), { width, ...opts }), 'dark', width)).split('\n').map(l => l.trimEnd());
};
// Each row below the title and the state, by how it starts: a lane's name, or an agent's mark and words.
const startsOf = rows => rows.slice(2).map(l => (/^([▾▸] wave|  waves)\b/.test(l) ? l.match(/^(?:[▾▸] |  )(waves?(?: \d+)?)/)[1] : l.match(/^( *\S.*?)(?: {2,}|$)/)[1]));

test('each wave\'s agents are listed under its lane, in the lanes\' order, stood in by two', () => {
  const rows = underLanes([['a', 'Build the importer', 3], ['b', 'Review the export fix', 2], ['c', 'Build the settings page', 3], ['d', 'Run the final checks', 1]]);
  assert.deepEqual(startsOf(rows), ['waves', 'wave 1', '  → Run the final checks', 'wave 2', '  → Review the export fix', 'wave 3', '  → Build the importer', '  → Build the settings page']);
  // each stands in by two, and every agent's figures stand in the same columns
  const under = rows.filter(l => l.startsWith('  → '));
  assert.equal(new Set(under.map(l => l.indexOf('Opus'))).size, 1);
  assert.equal(new Set(under.map(cols)).size, 1);
});

test('an agent with no wave, or of a wave that is not open, stays in the list beneath the lanes, lined up with the rest', () => {
  const rows = underLanes([['a', 'Build the importer', 3], ['h', 'Hunt the settings pages', null], ['z', 'Deploy the last wave', 9]]);
  assert.deepEqual(startsOf(rows), ['waves', 'wave 1', 'wave 2', 'wave 3', '  → Build the importer', '→ Hunt the settings pages', '→ Deploy the last wave']);
  const agents = rows.filter(l => /^ *→ /.test(l));
  assert.equal(new Set(agents.map(l => l.indexOf('Opus'))).size, 1);
  const framed = underLanes([['a', 'Build the importer', 3], ['h', 'Hunt the settings pages', null]], { frame: true });
  assert.equal(framed.filter(l => l.startsWith('├')).length, 2, 'the list beneath keeps its own section');
});

test('with no agent that names an open wave the card is as it was', () => {
  const plain = [['a', 'Build the importer', null], ['b', 'Review the export fix', null]];
  assert.deepEqual(startsOf(underLanes(plain)), ['waves', 'wave 1', 'wave 2', 'wave 3', '→ Build the importer', '→ Review the export fix']);
});

test('where the rows run out, the wave with the most agents gives one up first, and the row beneath says how many are out of sight', () => {
  const many = [['a', 'One', 3], ['b', 'Two', 3], ['c', 'Three', 3], ['d', 'Four', 3], ['e', 'Review it', 2], ['f', 'Check it', 1]];
  // title, state, heading and three lanes are six rows: four more hold three agents and the row that counts the rest
  const rows = underLanes(many, { maxRows: 10 });
  assert.equal(rows.length, 10);
  assert.deepEqual(startsOf(rows), ['waves', 'wave 1', '  → Check it', 'wave 2', '  → Review it', 'wave 3', '  → One', '▸ 3 more agents']);
});

test('an orchestrator under a lane keeps its caret, and its workers stand in under it', () => {
  const rows = underLanes([['o', 'Drive the backend work', 3], ['k', 'Build the queue', null, { parentId: 'o' }]], { });
  const open = (() => { const i = inputsOf('26-lanes-three-open'); i.agents = [{ id: 'o', description: 'Drive the backend work', model: 'claude-opus-5-5', effort: 'high', tokens: 10, startTime: i.now, status: 'running', wave: 3 }, { id: 'k', description: 'Build the queue', model: 'claude-sonnet-5-5', effort: 'medium', tokens: 10, startTime: i.now, status: 'running', parentId: 'o' }]; i.ui = { expanded: { o: true } }; return strip(toAnsi(renderCard(buildView(i), { width: 115 }), 'dark', 115)).split('\n').map(l => l.trimEnd()); })();
  assert.match(rows.find(l => l.includes('Drive the backend work')), /^ {2}▸ ◈ Drive the backend work/);
  assert.match(open.find(l => l.includes('Drive the backend work')), /^ {2}▾ ◈ Drive the backend work/);
  assert.match(open.find(l => l.includes('Build the queue')), /^ {6}→ Build the queue/);
});

test('the narrow card keeps its one agent and its count beneath the lanes', () => {
  const rows = underLanes([['a', 'Build the importer', 3], ['b', 'Review the export fix', 2]], { width: 35 });
  assert.deepEqual(rows.slice(2, 5).map(l => l.slice(0, 6)), ['wave 1', 'wave 2', 'wave 3']);
  assert.match(rows[5], /^→ Build the importer/);
  assert.match(rows.at(-1), /1 more/);
});

// ---------------------------------------------------------------- folding a wave, and what waits on the person

test('a folded wave lists none of its agents and its lane says how many it holds, their workers too; the other waves keep theirs', () => {
  const agents = [['o', 'Drive the backend work', 3], ['k', 'Build the queue', null, { parentId: 'o' }], ['c', 'Build the settings page', 3], ['b', 'Review the export fix', 2]];
  const rows = underLanes(agents, { folded: [3] });
  assert.deepEqual(startsOf(rows), ['waves', 'wave 1', 'wave 2', '  → Review the export fix', 'wave 3']);
  assert.match(rows.at(-1), /^▸ wave 3 .* 3 agents +\S+$/);
  assert.doesNotMatch(rows.join('\n'), /more agent/, 'folded agents are not counted as out of sight');
});

test('a wave with no agent at work says why under its lane, where its agents would stand, whether or not any other wave has agents', () => {
  const waits = { 2: "the TV parts need casting's screens", 3: 'its screens need the player files' };
  const rows = underLanes([['a', 'Build the importer', 3]], { waits });
  assert.deepEqual(startsOf(rows), ['waves', 'wave 1', 'wave 2', "  waits: the TV parts need casting's screens", 'wave 3', '  → Build the importer']);
  assert.deepEqual(startsOf(underLanes([], { waits })), ['waves', 'wave 1', 'wave 2', "  waits: the TV parts need casting's screens", 'wave 3', '  waits: its screens need the player files']);
  // an agent that has given its report is listed, and is not at work: the reason stays beneath it
  const held = underLanes([['a', 'Build the importer', 3, { held: true }]], { waits });
  assert.deepEqual(startsOf(held).slice(4), ['wave 3', '  → Build the importer', '  waits: its screens need the player files']);
});

test('the reason is not drawn for a folded wave or one that waits on the person, nor on the narrow lanes, and a long one is cut to the card', () => {
  const waits = { 2: 'the TV parts need the screens', 3: 'its screens need the player files that the casting work is still changing, and then the thumbs' };
  const quiet = underLanes([], { waits, folded: [2], edit: s => { s.sweep.waves.find(w => w.n === 3).waiting = true; } });
  assert.doesNotMatch(quiet.join('\n'), /waits:/);
  assert.doesNotMatch(underLanes([], { waits, width: 58 }).join('\n'), /waits:/);
  for (const frame of [true, false]) {
    const cut = underLanes([], { waits, width: 80, frame });
    assert.ok(cut.some(l => /waits: its screens need.*…/.test(l)), cut.join('\n'));
    assert.ok(cut.every(l => cols(l) <= 80), cut.join('\n'));
  }
});

test('the rows that say why a wave waits come out of the rows the agents may take, so the card keeps to its height', () => {
  const waits = { 2: 'the TV parts need the screens' };
  const agents = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => [id, 'Build part ' + id, 3]);
  const free = underLanes(agents, {}), kept = underLanes(agents, { maxRows: free.length });
  assert.equal(kept.length, free.length);
  const tight = underLanes(agents, { waits, maxRows: free.length });
  assert.equal(tight.length, free.length);
  assert.ok(tight.some(l => /waits: the TV parts/.test(l)));
  // one row went to the reason and one to the row that says agents are out of sight
  assert.match(tight.join('\n'), /2 more agents/);
});

test('a framed card that fits its height keeps the agents under its lanes', () => {
  const two = [['a', 'Build the importer', 3], ['b', 'Review the export fix', 2]];
  for (const agents of [two.slice(0, 1), two]) {
    for (const frame of [true, false]) {
      const free = underLanes(agents, { frame });
      assert.deepEqual(underLanes(agents, { frame, maxRows: free.length }), free, `${agents.length} agents, frame ${frame}`);
    }
  }
});

test('a card with agents gives up its words\' second row, then the rule above the lanes, then the rule above the count, to say how many agents it holds', () => {
  const words = 'Hunting again over what the fixes changed. Live next: the card and mod fixes, once their final test run passes, and then the last round of hunting over the merged waves before the pull request.';
  const agents = [['a', 'Build the importer', 3], ['b', 'Review the export fix', 2]];
  const edit = s => { s.health = words; };
  const base = underLanes([], { frame: true, edit }).length, free = underLanes(agents, { frame: true, edit }).length;
  // two rows of words, two rules and the count: the card keeps to its room from the base height down to one less
  for (let maxRows = base - 1; maxRows <= free; maxRows++) {
    const rows = underLanes(agents, { frame: true, edit, maxRows });
    assert.ok(rows.length <= maxRows, `${maxRows} rows allowed, ${rows.length} drawn`);
    assert.ok(rows.some(l => /more agents|→ /.test(l)), `at ${maxRows} rows no agent is listed and none is counted\n${rows.join('\n')}`);
  }
  const at = n => underLanes(agents, { frame: true, edit, maxRows: n });
  assert.equal(at(base).filter(l => l.startsWith('├')).length, 1, 'the rule above the count goes first');
  assert.equal(at(base - 1).filter(l => l.startsWith('├')).length, 0, 'then the one above the lanes');
  assert.match(at(base).join('\n'), /…/, 'the words are cut to one row');
  // one row less and there is no room to say: the card is as short as it can be, with no count
  assert.doesNotMatch(at(base - 2).join('\n'), /more agents/);
  assert.ok(at(base - 2).length <= at(base - 1).length);
});

test('every board with agents says how many it holds at each height that has a row for it, and the card never gets shorter as its room grows', () => {
  const lists = rows => rows.some(r => r.some(s => /^(view|toggle|more)/.test(s.id ?? '')));
  let boards = 0;
  for (const name of Object.keys(fixtures)) {
    const i = inputsOf(name), view = buildView(i);
    if (!view.agents.length || view.closing) continue;
    boards++;
    const bare = buildView({ ...i, agents: [] });
    for (const width of [100, 126, 160]) {
      for (const frame of [true, false]) {
        const base = renderCard(bare, { width, frame }).length, free = renderCard(view, { width, frame }).length;
        let before = 0;
        for (let maxRows = 1; maxRows <= free + 2; maxRows++) {
          const rows = renderCard(view, { width, frame, maxRows });
          const where = `${name}, width ${width}, frame ${frame}, ${maxRows} of ${free} rows`;
          assert.ok(rows.length >= before, 'shorter than at one row less: ' + where);
          before = rows.length;
          // a framed card gives up the rule above the count, an unframed one has none to give up
          if (maxRows >= base + (frame ? 0 : 1) && maxRows <= free) {
            assert.ok(rows.length <= maxRows, 'taller than its room: ' + where);
            assert.ok(lists(rows), 'no agent and no count: ' + where);
          }
        }
      }
    }
  }
  assert.ok(boards > 10);
});

test("every wave's lane starts with an arrow that is a button: down while its agents are listed, to the side once folded", () => {
  const lane = (rows, n) => rows.find(r => r.some(s => s.t === 'wave ') && r.some(s => s.t.trim() === String(n)));
  const open = underLanes([['a', 'Build the importer', 3]], { spans: true });
  for (const n of [1, 3]) assert.deepEqual([lane(open, n)[0].t, lane(open, n)[0].id], ['▾ ', 'wave:' + n], 'wave ' + n);
  const folded = underLanes([['a', 'Build the importer', 3]], { spans: true, folded: [3] });
  assert.deepEqual([lane(folded, 3)[0].t, lane(folded, 1)[0].t], ['▸ ', '▾ ']);
  assert.ok(lane(folded, 3).some(s => s.id === 'wave:3' && /1 agent$/.test(s.t)), 'the count of a folded wave opens it again');
});

test("a fold belongs to its run: another run's wave of the same number stays open", () => {
  const rows = underLanes([['a', 'Build the importer', 3]], { folded: [{ run: 'an-earlier-run', wave: 3 }] });
  assert.deepEqual(startsOf(rows), ['waves', 'wave 1', 'wave 2', 'wave 3', '  → Build the importer']);
});

test("the run's own words after its state are drawn in the insight colour, which both themes have", () => {
  const i = inputsOf('RunningA');
  const row = renderCard(buildView(i), { width: 100 }).find(r => r.some(s => s.c === 'insight'));
  assert.deepEqual(row.filter(s => s.c === 'insight').map(s => s.t), [i.state.health]);
  for (const theme of ['dark', 'light']) assert.match(hex(theme, 'insight'), /^#[0-9a-f]{6}$/);
});

test('an ask that holds nothing leaves the frame alone and marks the state row; one that holds the run still turns it red', () => {
  const i = inputsOf('RunningA');
  const look = n => ({ n, text: 'Look at the mock', at: NOW - 6e4, nowait: true });
  const one = buildView({ ...i, state: { ...i.state, asks: [look(1)] } });
  assert.deepEqual([one.frame, one.asks.length, one.forYou], ['hairline', 0, 1]);
  const drawn = toPlain(renderCard(one, { width: 100 }));
  assert.match(drawn, /● ⚑ 1 thing for you · /);
  assert.doesNotMatch(drawn, /needs you/);
  const both = buildView({ ...i, state: { ...i.state, asks: [look(1), look(2), { n: 3, text: 'Which format?', at: NOW - 6e4 }] } });
  assert.deepEqual([both.frame, both.asks.map(a => a.n), both.forYou], ['needsYou', [3], 2]);
  assert.match(toPlain(renderCard(both, { width: 100 })), /⚑ 2 things for you/);
  const p = inputsOf('Paused');
  assert.match(toPlain(renderCard(buildView({ ...p, state: { ...p.state, asks: [look(1)] } }), { width: 100 })), /paused at your .* mark · ⚑ 1 thing for you/);
});

test("the run's words take a second row where the first cannot hold them, under where they begin, and are cut only past that", () => {
  const i = inputsOf('RunningA');
  const words = 'The importer is built, but its review found the progress bar wrong on nine points, which are being fixed. Live next: the importer, then exports by email.';
  const rows = health => toPlain(renderCard(buildView({ ...i, state: { ...i.state, health } }), { width: 100 })).split('\n').map(l => l.split('   ||   ')[0]);
  const two = rows(words);
  assert.match(two[1], /^● The importer is built/);
  assert.match(two[2], /^ {2}\S/, 'the second row begins under the first');
  assert.equal(two[1].slice(2) + ' ' + two[2].trim(), words, 'nothing is lost over two rows');
  const three = rows(words + ' ' + words);
  assert.equal(three.length, two.length, 'never a third row');
  assert.match(three[2], /…$/);
  assert.ok(cols(three[2]) <= 100);
  assert.equal(rows('on track').length, two.length - 1, 'words that fit stay on one row');
  // where the first row has no room for a word beside the mark for the person, the words start on the second
  const marked = toPlain(renderCard(buildView({ ...i, state: { ...i.state, health: 'Internationalisation is being fixed', asks: [{ n: 1, text: 'Look', at: NOW, nowait: true }] } }), { width: 50 })).split('\n').map(l => l.split('   ||   ')[0]);
  assert.deepEqual(marked.slice(1, 3), ['● ⚑ 1 thing for you', '  Internationalisation is being fixed']);
});

test('a running run with words of its own is the dot and the words; with none it says running', () => {
  const i = inputsOf('RunningA');
  const row = health => toPlain(renderCard(buildView({ ...i, state: { ...i.state, health } }), { width: 100 })).split('\n')[1].split('   ||   ')[0];
  assert.equal(row('on track'), '● on track');
  assert.equal(row(''), '● running');
});

// ---------------------------------------------------------------- an agent's row: its words, its chip

// A card of the agents given, each [description, minutes it has run, its chip: 'stalled', 'quiet' or none].
const agentCard = (list, opts = {}) => {
  const i = inputsOf('RunningA');
  i.agents = list.map(([description, minutes, chip], k) => ({ id: 'a' + k, description, model: 'claude-opus-5-5', effort: 'high', tokens: 1200,
    startTime: NOW - minutes * 6e4, status: 'running', quietMs: chip === 'stalled' ? 20 * 6e4 : chip === 'quiet' ? 6 * 6e4 : 0, spark: [1, 2] }));
  return renderCard(buildView(i), { width: 126, ...opts });
};
const agentRows = rows => rows.filter(r => r.some(s => /^view:/.test(s.id ?? '')));

test("a newline or a tab in an agent's description stays on the agent's one row", () => {
  const split = toPlain(agentCard([['Fix the importer\nand\tthe export', 5]]));
  assert.equal(split, toPlain(agentCard([['Fix the importer and the export', 5]])));
});

test("a stalled agent's chip of an hour or a day keeps the figures of every agent in the same columns", () => {
  const rows = agentRows(agentCard([['Build the importer', 75, 'stalled'], ['Review the export', 5], ['Check the mail', 26 * 60, 'quiet']]));
  const ends = rows.map(r => len(r.slice(0, r.findIndex(s => s.c === 'text' && /\dk?$/.test(s.t) && s.t.trim().length <= 6) + 1).map(s => s.t).join('')));
  assert.equal(new Set(ends).size, 1, toPlain(rows));
  assert.equal(new Set(rows.map(r => len(r.map(s => s.t).join('')))).size, 1, toPlain(rows));
});

test("the stalled chip's words keep their contrast through its pulse", () => {
  const chip = opts => agentCard([['Build the importer', 75, 'stalled']], opts).flat().find(s => s.bg).bg;
  for (const opts of [...Array(28).keys()].map(tick => ({ tick }))) {
    const at = Number(chip(opts).split('@')[1] ?? 100);
    assert.ok(at >= 70, JSON.stringify(opts) + ': ' + chip(opts));
  }
});

test('the slow pulse starts at the level nearest where the fade gave way, and steps evenly from there', () => {
  const view = buildView(inputsOf('NeedsYou'));
  const at = c => Number(c.split('@')[1] ?? 100);
  const frame = opts => at(renderCard(view, { width: 100, frame: true, ...opts })[0][0].c);
  for (let from = 0; from < 56; from += 2) {
    const b = Math.floor(from / 10), was = frame({ tick: from });
    const pulse = [0, 1, 2, 3, 4].map(k => frame({ beat: b + k, beatFrom: from }));
    assert.ok(Math.abs(pulse[0] - was) <= 15, `from tick ${from}: the fade was at ${was}, the pulse starts at ${pulse[0]}`);
    // four steps a second apart and back where it began: bright, half way, dim, half way
    assert.equal(pulse[4], pulse[0]);
    for (let k = 0; k < 4; k++) assert.equal(Math.abs(pulse[k + 1] - pulse[k]), 25, `from tick ${from}: ${pulse}`);
  }
});

// ---------------------------------------------------------------- what a row gives up where it is short

test('a stage strip too wide for the card keeps the stage the run is at, and gives up the stages done first', () => {
  for (const board of ['StageReview', 'RunningA', 'StageSpec']) {
    const v = buildView(inputsOf(board));
    for (let width = 44; width <= 80; width++) for (const frame of [false, true]) {
      const row = toPlain(renderCard(v, { width, frame })).split('\n').find(l => l.includes(G.stageNow + ' ' + v.stage) || /[✓○] (Brainstorm|Spec|Plan|Build)/.test(l));
      assert.ok(row.includes(G.stageNow + ' ' + v.stage), `${board} at ${width}: ${row}`);
    }
  }
});

const NARROWER = ['in', 'progress', 'waiting'];
test('a short row shows only words of the card, cut inside one only at its "…"', () => {
  // Every word on a card that is cut to its width is a word of the same card drawn with room for everything, or the
  // start of one, ended by a "…".
  const words = rows => new Set(rows.filter(r => !r.some(s => /^more/.test(s.id ?? '')))
    .flatMap(r => r.map(s => (s.r ? ' ' : '') + s.t).join('').split(/[\s·│╭╮╰╯├┤─]+/)).map(w => w.replace(/^…|[,;:.]?(…?)$/g, '$1')).filter(w => w && !/^([▰▱]+|\d+)…?$/.test(w)));
  for (const name of Object.keys(fixtures)) {
    const v = buildView(inputsOf(name));
    for (const frame of [false, true]) {
      // and the words only a narrower layout uses
      const all = [...words(renderCard(v, { width: 400, frame })), ...NARROWER], whole = new Set(all.map(w => w.replace(/…$/, '')));
      const ofCard = w => whole.has(w.replace(/…$/, '')) || (w.endsWith('…') && all.some(a => a.startsWith(w.slice(0, -1))));
      for (let width = 44; width <= 130; width += 2) {
        const lost = [...words(renderCard(v, { width, frame }))].filter(w => !ofCard(w));
        assert.deepEqual(lost, [], `${name} at ${width}${frame ? ', framed' : ''}`);
      }
    }
  }
});

test('the hint under several questions keeps its example whole, or leaves it out', () => {
  for (let width = 44; width <= 70; width++) for (const frame of [false, true]) {
    const hint = toPlain(card('SeveralAsks', { width, frame })).split('\n').find(l => l.includes('answer in plain words below'));
    assert.match(hint, /below(, e\.g\. “1 yes, 2 UTC”)? *│?$/, width + ': ' + hint);
  }
});

// ---------------------------------------------------------------- what a tight card gives up

test("a folded wave's agents, listed beneath lanes too narrow for rows of their own, are listed or counted wherever the card has room to", () => {
  const i = inputsOf('05-plan-for-wave-1');
  i.agents = [{ id: 'a', description: 'Plan the billing wave', model: 'claude-opus-5-5', effort: 'high', tokens: 1000, startTime: NOW - 6e4, status: 'running', wave: 1 }];
  i.state.health = 'Planning wave 1 over the billing, panel and sign-in fixes, with the importer last since it touches the most files.';
  i.ui = { folded: { [foldKey(i.state.id, 1)]: true } };
  const v = buildView(i), lists = rows => rows.some(r => r.some(s => /^(view|more)/.test(s.id ?? '')));
  const free = renderCard(v, { width: 50, frame: true }).length;
  assert.ok(lists(renderCard(v, { width: 50, frame: true })));
  let before = 0;
  for (let maxRows = 7; maxRows <= free; maxRows++) {
    const rows = renderCard(v, { width: 50, frame: true, maxRows });
    assert.ok(rows.length <= maxRows && lists(rows), `${maxRows} rows: ${rows.length} drawn\n${toPlain(rows)}`);
    assert.ok(rows.length >= before);
    before = rows.length;
  }
});

test('a tight card gives up the rule above the lanes before the one under a question', () => {
  const i = inputsOf('27-lanes-one-waits-on-you');
  i.agents = ['Build the importer', 'Review the export fix', 'Check the mail'].map((description, k) => ({ id: 'a' + k, description, model: 'claude-opus-5-5', effort: 'high', tokens: 1000, startTime: NOW - 6e4, status: 'running', wave: 2 }));
  let one = 0;
  for (let maxRows = 8; maxRows <= 16; maxRows++) {
    const rows = strip(toAnsi(renderCard(buildView(i), { width: 100, frame: true, maxRows }), 'dark', 100)).split('\n');
    const hint = rows.findIndex(l => l.includes('answer in plain words below')), heading = rows.findIndex(l => l.includes(' waves '));
    const underHint = rows[hint + 1].startsWith('├'), aboveLanes = rows[heading - 1].startsWith('├');
    assert.ok(underHint || !aboveLanes, `${maxRows} rows\n${rows.join('\n')}`);
    if (underHint && !aboveLanes) one++;
  }
  assert.ok(one > 0, 'at some height only the rule above the lanes is given up');
});

// ---------------------------------------------------------------- a hunt round's probes, under the round's lane

// A hunt of round 2 beside wave 3 in its final checks; agents are [id, description, wave, more], a probe with { hunt: true }.
const huntCard = (agents, opts = {}) => {
  const i = inputsOf('29-lanes-hunt-and-final-checks');
  i.agents = agents.map(([id, description, wave, more = {}]) => ({ id, description, model: 'claude-haiku-5-5', effort: 'low', tokens: 1000, startTime: i.now - 60000, status: 'running', ...(wave == null ? {} : { wave }), ...more }));
  if (opts.folded) i.ui = { folded: { [roundFoldKey(i.state.id, 2)]: true } };
  const rows = renderCard(buildView(i), { width: 115, ...opts });
  return opts.spans ? rows : strip(toAnsi(rows, 'dark', 115)).split('\n').map(l => l.trimEnd());
};
const probe = { hunt: true };
const startsOfHunt = rows => rows.slice(2).map(l => l.match(/^( *\S.*?)(?: {2,}|$)/)[1].replace(/^([▾▸] |  )(waves|wave \d+|round \d+).*/, '$2'));

test("a hunt round's probes are listed under the round's lane, and the agents of no wave and no round beneath", () => {
  const rows = huntCard([['p', 'Hunt the card', null, probe], ['w', 'Run the final checks', 3], ['q', 'Hunt the boxes', null, probe], ['d', 'Deploy the docs', null]]);
  assert.deepEqual(startsOfHunt(rows), ['waves', 'wave 3', '  → Run the final checks', 'round 2', '  → Hunt the card', '  → Hunt the boxes', '→ Deploy the docs']);
  assert.ok(rows.some(l => /^▾ round 2 /.test(l)), rows.join('\n'));
});

test("the round's lane folds like a wave's: its probes are not listed and its lane says how many it holds", () => {
  const agents = [['p', 'Hunt the card', null, probe], ['q', 'Hunt the boxes', null, probe], ['w', 'Run the final checks', 3]];
  const rows = huntCard(agents, { folded: true });
  assert.deepEqual(startsOfHunt(rows), ['waves', 'wave 3', '  → Run the final checks', 'round 2']);
  assert.match(rows.at(-1), /^▸ round 2 .* 2 agents +\S+$/);
  assert.doesNotMatch(rows.join('\n'), /more agent/);
  const lane = huntCard(agents, { folded: true, spans: true }).find(r => r.some(s => s.t === 'round '));
  assert.deepEqual([lane[0].t, lane[0].id], ['▸ ', 'round:2']);
  assert.ok(lane.some(s => s.id === 'round:2' && s.t === '2 agents'), 'the count opens it again');
});

test("a probe is listed beneath when the card has no round's lane", () => {
  const i = inputsOf('26-lanes-three-open');
  i.agents = [{ id: 'p', description: 'Hunt the card', model: 'claude-haiku-5-5', tokens: 10, startTime: i.now, status: 'running', hunt: true }];
  const rows = strip(toAnsi(renderCard(buildView(i), { width: 115 }), 'dark', 115)).split('\n');
  assert.match(rows.at(-1), /^→ Hunt the card/);
});

test("a tight card with the round's probes keeps to its room and never gets shorter as its room grows", () => {
  const agents = ['a', 'b', 'c', 'd'].map(id => [id, 'Hunt part ' + id, null, probe]);
  for (const frame of [true, false]) for (const folded of [false, true]) {
    const free = huntCard(agents, { frame, folded }).length;
    let before = 0;
    for (let maxRows = 1; maxRows <= free + 1; maxRows++) {
      const rows = huntCard(agents, { frame, folded, maxRows });
      assert.ok(rows.length >= before, `${maxRows}, frame ${frame}, folded ${folded}`);
      if (maxRows >= 8) assert.ok(rows.length <= maxRows, `${maxRows} allowed, ${rows.length} drawn, frame ${frame}, folded ${folded}\n${rows.join('\n')}`);
      before = rows.length;
    }
  }
});

// ---------------------------------------------------------------- a short row keeps what it can

test('agent rows on a framed card 44 to 47 columns wide keep a word of their description', () => {
  for (const name of Object.keys(fixtures)) for (let width = 44; width <= 47; width++) {
    const rows = card(name, { width, frame: true }).filter(r => r.some(s => (s.id ?? '').startsWith('view:')));
    for (const r of rows) {
      const desc = r.filter(s => (s.id ?? '').startsWith('view:')).map(s => s.t).join('');
      assert.match(desc, /\p{L}{2,}/u, `${name} at ${width}: ${toPlain([r])}`);
    }
  }
});

test('a short blind review row keeps its label and both reviewers, giving up their words before them', () => {
  for (let width = 44; width <= 130; width++) for (const frame of [false, true]) {
    const row = toPlain(card('StageSpec', { width, frame })).split('\n').find(l => l.includes('requirements'));
    assert.match(row, /^(│ )?blind review  ✓ (reviewer )?1\b.*› (reviewer )?2\b.*9 requirements/, `${width}${frame ? ', framed' : ''}: ${row}`);
  }
  // "reviewing" goes before what a reviewer caught.
  assert.match(toPlain(card('StageSpec', { width: 87 })), /reviewer 1 · row cap fixed  › reviewer 2 /);
});

test("a finished sweep's short row keeps how many are parked for the person", () => {
  for (let width = 44; width <= 130; width++) for (const frame of [false, true]) {
    const row = toPlain(card('17-finished-with-stacked-pull-requests', { width, frame })).split('\n').find(l => l.includes(' fixed'));
    assert.match(row, /153 fixed · 14 parked/, `${width}${frame ? ', framed' : ''}: ${row}`);
  }
});

test('a bar gives up cells before its counts go, and a failing requirement is the last count to go', () => {
  const rowOf = (board, width, frame, start) => toPlain(card(board, { width, frame })).split('\n').find(l => l.replace(/^│ /, '').startsWith(start));
  for (let width = 44; width <= 130; width++) for (const frame of [false, true]) {
    const at = `${width}${frame ? ', framed' : ''}`;
    assert.match(rowOf('StageReview', width, frame, 'requirements'), /▱  (7 pass · )?1 failing/, at);
    assert.match(rowOf('RunningA', width, frame, 'tasks'), /[▰▱]  \d+ done/, at);
    if (width >= 52) assert.match(rowOf('03-hunt-round-1-probes-at-work', width, frame, 'areas'), /[▰▱]  14 hunted/, at);
  }
});

test('a row cut short leaves no comma or full stop before its "…"', () => {
  for (const name of Object.keys(fixtures)) {
    const v = buildView(inputsOf(name));
    for (let width = 36; width <= 130; width++) for (const frame of [false, true]) {
      const hit = toPlain(renderCard(v, { width, frame })).split('\n').find(l => /[,;:.]…/.test(l));
      assert.equal(hit, undefined, `${name} at ${width}${frame ? ', framed' : ''}`);
    }
  }
});

test('a short row keeps a word of what the person must act on: the pause, the decisions to check, the line being asked', () => {
  const rowOf = (board, width, frame, has) => toPlain(card(board, { width, frame })).split('\n').find(l => l.includes(has));
  for (let width = 44; width <= 130; width++) for (const frame of [false, true]) {
    const at = `${width}${frame ? ', framed' : ''}`;
    for (const board of ['Paused', '15-paused-at-your-usage-mark', '16-paused-by-you']) {
      assert.match(rowOf(board, width, frame, G.paused), /▮▮ paused/, `${board} at ${at}`);
      assert.match(rowOf(board, width, frame, 'nothing new starts'), /starts · \S/, `${board} at ${at}`);
    }
    assert.match(rowOf('Done', width, frame, 'requirements pass'), /pass · 2 decisions/, at);
    assert.match(rowOf('StageBrainstorm', width, frame, 'questions open'), /intent .*› edge cases/, at);
    assert.match(rowOf('01-charter-with-you', width, frame, 'question open'), /charter .*› PRs/, at);
  }
});

test("an agent's description cut short gives up a few cells at most to end on a whole word", () => {
  for (const name of Object.keys(fixtures)) {
    const v = buildView(inputsOf(name));
    for (let width = 44; width <= 130; width++) for (const frame of [false, true]) {
      // The description is the agent's text padded to its column; two cells more go where they spare a word cut one or two letters short.
      for (const s of renderCard(v, { width, frame }).flat().filter(s => /^view:/.test(s.id ?? '') && len(s.t) > 2)) {
        const kept = s.t.trimEnd();
        if (kept.endsWith('…')) assert.ok(len(kept) >= len(s.t) - 8, `${name} at ${width}${frame ? ', framed' : ''}: "${kept}" in ${len(s.t)} cells`);
      }
    }
  }
});

test('the bar of a progress row never grows as the card gets narrower', () => {
  for (const name of Object.keys(fixtures)) {
    const v = buildView(inputsOf(name));
    for (const frame of [false, true]) {
      const wider = {};
      for (let width = 130; width >= 44; width--) {
        for (const row of toPlain(renderCard(v, { width, frame })).split('\n')) {
          const m = /^(.*?)([▰▱]+)/.exec(row);
          if (!m) continue;
          const label = m[1].replace(/[│\s]+/g, ' ').trim(), was = wider[label];
          if (!/^\w+$/.test(label)) continue;
          assert.ok(!was || m[2].length <= was.cells, `${name}${frame ? ', framed' : ''}, "${label}": ${was?.cells} cells at ${was?.width}, ${m[2].length} at ${width}`);
          wider[label] = { cells: m[2].length, width };
        }
      }
    }
  }
});

test('a merging wave names its pull request, or the earlier wave it lands after', () => {
  const i = inputsOf('25-lanes-review-and-build');
  const [w1, w2, w3] = i.state.sweep.waves;
  i.state.sweep.waves = [{ ...w1, status: 'shipped', merged: false, pr: 41 }, { ...w2, stage: 'Ship', step: 'merging' }, w3];
  const rows = laneRows(i);
  assert.match(laneOf(rows, 1), /▰{6} {4}merging #41 +34m$/);
  assert.match(laneOf(rows, 2), /▰{6} {4}merging after wave 1 +22m$/);
  // With wave 1 merged, wave 2 is next to land, and has no pull request yet.
  i.state.sweep.waves[0].merged = true;
  assert.match(laneOf(laneRows(i), 2), /▰{6} {4}merging +22m$/);
});

test("an early hunt round says so beside its name at every width the lanes are drawn, and why where there is room", () => {
  const early = board => { const i = inputsOf(board); i.state.sweep = { ...i.state.sweep, early: [3] }; return i; };
  const round = rows => rows.find(l => /^ {2}round 2 /.test(l));
  assert.match(round(laneRows(early('29-lanes-hunt-and-final-checks'), 140)), /› Hunt · early  ▰.* 4 findings so far · can't end the sweep +5m$/);
  // Short of room the why goes; the lane keeps "early" and every word it had.
  for (const width of [115, 90]) {
    const plain = round(laneRows(inputsOf('29-lanes-hunt-and-final-checks'), width));
    assert.match(round(laneRows(early('29-lanes-hunt-and-final-checks'), width)), /› Hunt · early  ▰/);
    assert.equal(round(laneRows(early('29-lanes-hunt-and-final-checks'), width)).replace(/ · early  [▰▱]+/, ''), plain.replace(/  [▰▱]+/, ''));
  }
  assert.match(laneRows(early('29-lanes-hunt-and-final-checks'), 56).find(l => /^round 2 /.test(l)), /▱ {2}Hunt · early$/);
  // With no lanes it stands beside Hunt in the stage row, and why on the right where there is room.
  assert.match(laneRows(early('03-hunt-round-1-probes-at-work'), 115).find(l => l.startsWith('✓ Charter')), /› Hunt · early  ○ Plan .*○ Ship +can't end the sweep$/);
  assert.match(laneRows(early('03-hunt-round-1-probes-at-work'), 70).find(l => l.startsWith('✓ Charter')), /› Hunt · early  ○ Plan .*○ Ship$/);
  // Once the run has left Hunt the round is over.
  const built = early('25-lanes-review-and-build');
  assert.doesNotMatch(laneRows(built, 140).join('\n'), /early/);
});

test('the waves row says which wave is next and how many fixes it holds, giving way before the totals', () => {
  const rows = (board, width) => strip(toAnsi(card(board, { width }), 'dark', width)).split('\n').map(l => l.trimEnd());
  assert.match(headOf(rows('04-hunt-sorted-the-queue-is-filled', 115)), /^waves ▱{6} {2}6 queued · next: wave 1, 27 fixes +round 1 · 14 parked · 21 dropped$/);
  assert.match(headOf(rows('06-build-wave-2-fixes-in-parallel', 150)), /1 done · 4 queued · next: wave 3, 27 fixes +round 1 · 27 fixed · 14 parked · 22 dropped$/);
  // Short of room it goes first, and the totals stay whole.
  assert.match(headOf(rows('06-build-wave-2-fixes-in-parallel', 117)), /1 done · 4 queued +round 1 · 27 fixed · 14 parked · 22 dropped$/);
  const one = inputsOf('04-hunt-sorted-the-queue-is-filled');
  one.state.sweep.waves = [{ n: 7, fixes: 1, status: 'queued' }];
  assert.match(headOf(laneRows(one)), /1 queued · next: wave 7, 1 fix /);
});

test('an ask names the wave it is about, where its row has room', () => {
  const asked = (board, ...waves) => { const i = inputsOf(board); i.state.asks = i.state.asks.map((a, k) => ({ ...a, wave: waves[k] })); return i; };
  assert.equal(laneRows(asked('27-lanes-one-waits-on-you', 1))[1], '⚑ needs you · 12m · wave 1');
  const two = laneRows(asked('14-needs-you-two-questions', 2, 3), 140).filter(l => /^[12]  /.test(l));
  assert.match(two[0], /^1  .* wave 2 · \d+m$/);
  assert.match(two[1], /^2  .* wave 3 · \d+m$/);
  // Every row names its wave or none does: a long question is cut a little more for it, and only where the
  // questions would keep too few words do the waves go.
  const long = asked('14-needs-you-two-questions', 2, 3);
  long.state.asks[0].text = 'Merge wave 8 before wave 7 is reviewed, or hold it back until review ends?';
  for (const width of [60, 90]) {
    const rows = laneRows(long, width).filter(l => /^[12]  /.test(l));
    assert.match(rows[0], /…\s+wave 2 · \d+m$/, width);
    assert.match(rows[1], / wave 3 · \d+m$/, width);
  }
  const old = asked('14-needs-you-two-questions', 12, 13);
  old.state.asks = old.state.asks.map(a => ({ ...a, at: NOW - 170 * 6e4 }));
  const tight = laneRows(old, 44).filter(l => /^[12]  /.test(l));
  assert.equal(tight.length, 2);
  assert.ok(tight.every(l => !/wave 1\d/.test(l)), tight.join('\n'));
});

// The first row of a running card, with its week's figure and the run's state changed.
const stateRow = (used, state = {}, width = 100) => {
  const i = inputsOf('RunningA');
  i.usage.sevenDay.percentUsed = used;
  Object.assign(i.state, { weekAtStart: used - 9, ...state });
  return laneRows(i, width)[1];
};

test('the state row shows the usage mark once the week comes within ten points of it', () => {
  assert.match(stateRow(65), /on track · last commit 3m ago +week 65% · 75% mark · ≈ 9% of your week$/);
  assert.doesNotMatch(stateRow(64), /mark/);
  // Short of room the mark goes, and the run's own words keep their one row.
  assert.equal(stateRow(65, {}, 55), stateRow(50, {}, 55));
});

test('the state row counts the bypasses of standard LCW, giving way before the mark', () => {
  assert.match(stateRow(50, { bypasses: 1 }), / {2}1 bypass · ≈ 9% of your week$/);
  assert.match(stateRow(65, { bypasses: 3 }), / {2}3 bypasses · week 65% · 75% mark · ≈ 9% of your week$/);
  assert.match(stateRow(65, { bypasses: 3 }, 80), /last commit 3m ago +week 65% · 75% mark · ≈ 9% of your week$/);
  assert.equal(stateRow(50, { bypasses: 3 }, 55), stateRow(50, {}, 55));
});

test('an agent that waits, or has reported and not ended, says so and holds still; one long reported is not called stalled', () => {
  const i = inputsOf('RunningA');
  const mk = (id, over) => ({ id, description: 'agent ' + id, model: 'Sonnet 5.5', effort: 'low', tokens: 9000, startTime: NOW - 30 * 6e4, status: 'running', quietMs: 0, spark: [1, 2, 3], ...over });
  i.agents = [mk('work'), mk('wait', { status: 'waiting' }), mk('done', { status: 'waiting', held: true, heldMs: 20 * 6e4 })];
  const v = buildView(i);
  const rowOf = (rows, id) => rows.find(r => r.some(s => s.id === 'view:' + id));
  const looks = id => [0, 3, 7, 11].map(tick => JSON.stringify(rowOf(renderCard(v, { width: 126, tick }), id).map(s => [s.c, s.bg])));
  assert.notEqual(looks('work')[0], looks('work')[2], 'an agent at work pulses');
  for (const id of ['wait', 'done']) assert.equal(new Set(looks(id)).size, 1, id + ' holds still');
  const text = r => r.map(s => s.t).join('');
  const words = id => text(rowOf(renderCard(v, { width: 126 }), id));
  assert.match(words('wait'), /agent wait .* waiting +9k +30m$/);
  assert.match(words('done'), new RegExp('agent done .* reported +9k +' + G.warn + ' 30m $'));
  // Its chip is not the red one of an agent stalled at work.
  assert.ok(!rowOf(renderCard(v, { width: 126 }), 'done').some(s => String(s.bg ?? '').startsWith('needsYou')));
  // The narrow card says it too.
  const first = id => renderCard(buildView({ ...i, agents: i.agents.filter(a => a.id === id) }), { width: 40 }).map(text).join('\n');
  assert.match(first('wait'), /low · 9k · waiting · 30m/);
  assert.match(first('done'), new RegExp('low · 9k · reported · ' + G.warn + ' 30m'));
});

test('a wave with no agent at work for ten minutes says so under its lane, until a reason is recorded', () => {
  const sat = { 2: NOW - 10 * 6e4, 3: NOW - 9 * 6e4 };
  assert.deepEqual(startsOf(underLanes([['a', 'Build the importer', 1]], { sat })), ['waves', 'wave 1', '  → Build the importer', 'wave 2', '  no agent at work', 'wave 3']);
  assert.deepEqual(startsOf(underLanes([], { sat, waits: { 2: 'the TV parts need the screens' } })).slice(2, 4), ['wave 2', '  waits: the TV parts need the screens']);
  // Not for a wave an agent is at work for, one folded or waiting on the person, nor from another run's record.
  assert.doesNotMatch(underLanes([['a', 'Build the importer', 2]], { sat }).join('\n'), /no agent/);
  assert.doesNotMatch(underLanes([], { sat, folded: [2] }).join('\n'), /no agent/);
  assert.doesNotMatch(underLanes([], { sat, edit: s => { s.sweep.waves.find(w => w.n === 2).waiting = true; } }).join('\n'), /no agent/);
  assert.doesNotMatch(underLanes([], { sat, edit: s => { s.id = 'another-run'; } }).join('\n'), /no agent/);
  // It comes out of the rows the agents may take, and the card never gets shorter as its room grows.
  const agents = ['a', 'b', 'c', 'd'].map(id => [id, 'Build part ' + id, 3]);
  let was = 0;
  for (let maxRows = 4; maxRows <= 16; maxRows++) {
    const rows = underLanes(agents, { sat, maxRows, frame: true });
    assert.ok(rows.length >= was, maxRows + ': ' + rows.length);
    if (rows.length <= maxRows) assert.ok(rows.some(l => /no agent at work/.test(l)), maxRows + ': ' + rows.join('\n'));
    was = rows.length;
  }
});

test("the run's sentence keeps to one row where it fits alone, and the share takes the second", () => {
  for (const width of [64, 68, 70, 74]) {
    const rows = laneRows(inputsOf('06-build-wave-2-fixes-in-parallel'), width);
    assert.match(rows[1], /building side by side$/, width + '\n' + rows.join('\n'));
    assert.match(rows[2], /^ +≈ 12% of your week$/, width + '\n' + rows.join('\n'));
  }
});

test('with no lanes an early round says so beside Hunt in the stage row at every width, framed or not', () => {
  const i = inputsOf('03-hunt-round-1-probes-at-work');
  i.state.sweep = { ...i.state.sweep, early: [3] };
  const v = buildView(i);
  for (let width = 44; width <= 130; width++) for (const frame of [false, true]) {
    const rows = strip(toAnsi(renderCard(v, { width, frame }), 'dark', width)).split('\n');
    const stages = rows.find(l => /› Hunt/.test(l)) ?? '';
    assert.match(stages, /› Hunt · early/, width + ' ' + frame + ': ' + stages);
    assert.ok(cols(stages) <= width, width + ' ' + frame + ': ' + stages);
  }
});

test('a cut never ends a word one or two letters short of its end', () => {
  const i = inputsOf('26-lanes-three-open');
  i.state.asks = [{ n: 1, text: 'Should the sweep stop after round 3 or keep hunting until a reviewer finds nothing in the charter?', at: NOW - 61 * 6e4 }];
  i.agents = i.agents.map((a, k) => ({ ...a, description: ['review the building against its charter and recipes', 'card visibility fixes for the narrow layout', 'fix a test that still says round 2'][k % 3] }));
  const v = buildView(i), words = JSON.stringify(i).match(/[A-Za-z']+/g), whole = new Set(words);
  for (let width = 44; width <= 130; width++) for (const frame of [false, true]) {
    const card = strip(toAnsi(renderCard(v, { width, frame }), 'dark', width));
    for (const [, x] of card.matchAll(/([A-Za-z']+)…/g)) {
      if (whole.has(x)) continue;
      const short = words.find(w => w.startsWith(x) && w.length - x.length <= 2);
      assert.equal(short, undefined, width + ' ' + frame + ': "' + x + '…" of ' + short);
    }
  }
});

test("the run's sentence alone on its row leaves the share whole on the second, however tight", () => {
  const i = inputsOf('05-plan-for-wave-1');
  i.state.bypasses = 3;
  i.usage = { ...i.usage, sevenDay: { ...i.usage.sevenDay, percentUsed: 93 } };
  const v = buildView(i);
  for (let width = 44; width <= 60; width++) for (const frame of [false, true]) {
    const rows = strip(toAnsi(renderCard(v, { width, frame }), 'dark', width)).split('\n');
    assert.ok(rows.some(l => /% of your week/.test(l)), width + ' ' + frame + '\n' + rows.join('\n'));
    assert.ok(rows.every(l => cols(l) <= width), width + ' ' + frame + '\n' + rows.join('\n'));
  }
});

test("lanes too tight for the heading's stages keep their own rows and the heading its counts, its strip never all full while waves are queued", () => {
  for (const [board, counts] of [['28-lanes-a-long-sweep', '5 done · 2 queued'], ['06-build-wave-2-fixes-in-parallel', '1 done · 4 queued']]) {
    for (let width = 66; width <= 80; width++) for (const frame of [false, true]) {
      const rows = strip(toAnsi(renderCard(buildView(inputsOf(board)), { width, frame }), 'dark', width)).split('\n').map(l => l.replace(/^│ | │$/g, '').trimEnd());
      const at = board + ' ' + width + ' ' + frame + '\n' + rows.join('\n');
      assert.ok(rows.some(l => /^▾ wave \d/.test(l)), at);
      assert.ok(headOf(rows).includes(counts), at);
      assert.match(headOf(rows), /▱/, at);
    }
  }
});

test('the lanes say their figures in one form, so their words stand in one column', () => {
  const i = inputsOf('26-lanes-three-open');
  i.state.sweep.waves[1] = { ...i.state.sweep.waves[1], round: 2, requirements: [...i.state.sweep.waves[1].requirements.slice(0, 6), { id: 'F9', name: 'the mark', status: 'failing' }] };
  for (let width = 60; width <= 130; width++) {
    const said = [2, 3].map(n => laneOf(laneRows(i, width), n)).filter(Boolean).map(l => l.replace(/^.*[▰▱] {4}/, '').replace(/ +\d+m$/, ''));
    if (said.length < 2) continue;
    assert.equal(new Set(said.map(s => /^\d+ of +\d+ [a-z]/.test(s))).size, 1, width + ': ' + said.join(' | '));
  }
  assert.equal(laneOf(laneRows(i, 80), 3).replace(/^.*[▰▱] {4}/, '').replace(/ +\d+m$/, ''), '3 of 9 done · 4 running');
});

test('a long sweep with a wave queued keeps its counts and totals beside the strip, and an empty cell in it', () => {
  const i = inputsOf('24-lanes-one-wave-open');
  i.state.sweep.waves = [...Array.from({ length: 29 }, (_, k) => ({ n: 100 + k, status: 'shipped', merged: true, pr: 200 + k })), ...i.state.sweep.waves];
  const head = width => headOf(laneRows(i, width));
  assert.match(head(80), /▰▱ {2}30 done · 1 queued +…$/);
  assert.match(head(130), /▰▱ {2}30 done · 1 queued +round 1 · 12 fixed · 2 parked$/);
});

test('lanes short of room for what follows their figures keep the verb after it', () => {
  const i = inputsOf('26-lanes-three-open');
  i.state.sweep.waves[1] = { ...i.state.sweep.waves[1], round: 2, requirements: [...i.state.sweep.waves[1].requirements.slice(0, 6), { id: 'F9', name: 'the mark', status: 'failing' }] };
  const said = (width, n) => laneOf(laneRows(i, width), n).replace(/^.*[▰▱] {4}/, '').replace(/ +\d+m$/, '');
  for (const width of [66, 72]) {
    assert.equal(said(width, 2), '6 of 7 pass …', String(width));
    assert.equal(said(width, 3), '3 of 9 done …', String(width));
  }
});

test('lanes too tight for the heading to keep its stages keep its counts and totals', () => {
  for (const width of [61, 66, 71]) {
    const rows = laneRows(inputsOf('06-build-wave-2-fixes-in-parallel'), width);
    assert.match(headOf(rows), /1 done · (1 in progress · )?4 queued .*27 fixed/, width + '\n' + rows.join('\n'));
    assert.ok(rows.every(l => cols(l) <= width), width + '\n' + rows.join('\n'));
  }
});
