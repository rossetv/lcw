import test from 'node:test';
import assert from 'node:assert/strict';
import { buildView, renderCard, weekOf, weekShare } from '../../lib/card.mjs';
import { renderStatusRows } from '../../lib/status.mjs';
import { toPlain, toAnsi } from '../../lib/paint.mjs';
import { hex } from '../../lib/theme.mjs';
import { inputsOf, NOW } from './boards.mjs';

// A sweep's card in each of its states, and a build's beside them, as approved: every row but the agents', the rules
// and the bottom border, each the text inside the frame. The last but one is drawn 40 cells wide, with no frame.
const SWEEP = {
  "01-charter-with-you": [
    "╭─ ◆ LCW Sweep · backlog-sweep ───────────────────────────────────────────────────────────────────────── 6m in Charter ─╮",
    "★ with you · asking you: how should the pull requests come, and may I merge them?                  ≈ 12% of your week",
    "› Charter  ○ Hunt  ○ Plan  ○ Build  ○ Review  ○ Ship",
    "Charter · agreeing the rules of the sweep with you; the one step that needs you",
    "charter  …  ✓ anti-goals  ✓ no-go zones  ✓ changes  ✓ proof  ✓ park  ✓ stop  ✓ waves  › PRs           1 question open",
  ],
  "03-hunt-round-1-probes-at-work": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────── 9m in Hunt ─╮",
    "● running · hunting, area by area                                                                  ≈ 12% of your week",
    "waves none queued yet                                                                                         round 1",
    "✓ Charter  › Hunt  ○ Plan  ○ Build  ○ Review  ○ Ship",
    "areas ▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱  14 hunted · 6 running · 16 left                                    23 findings so far",
  ],
  "04-hunt-sorted-the-queue-is-filled": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────── 31m in Hunt ─╮",
    "● running · sorted against the charter                                                             ≈ 12% of your week",
    "waves ▱▱▱▱▱▱  6 queued                                                               round 1 · 14 parked · 21 dropped",
    "✓ Charter  › Hunt  ○ Plan  ○ Build  ○ Review  ○ Ship",
    "findings  151 to fix · 14 parked · 21 dropped                                                          6 waves queued",
  ],
  "05-plan-for-wave-1": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────────────── 3m ─╮",
    "● running · planning wave 1: Billing, Panel, Sign-in                                               ≈ 12% of your week",
    "waves   › Plan  ○ Build  ○ Review  ○ Ship    ▰▱▱▱▱▱  5 queued                        round 1 · 14 parked · 21 dropped",
    "wave 1  ▰▰▰▰▰▰  ▱▱▱▱▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    28 tasks · up to 12 at once                                           3m",
  ],
  "06-build-wave-2-fixes-in-parallel": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 22m ─╮",
    "● running · wave 2: Billing and Panel fixes building side by side                                  ≈ 12% of your week",
    "waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▱▱▱▱  1 done · 4 queued    round 1 · 27 fixed · 14 parked · 22 dropped",
    "wave 2  ▰▰▰▰▰▰  ▰▰▰▰▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    9 of 28 tasks done · 7 running                                       22m",
  ],
  "07-build-a-worker-has-stalled": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 22m ─╮",
    "● running · one worker stalled; asked what it needs                                                ≈ 12% of your week",
    "waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▱▱▱▱  1 done · 4 queued    round 1 · 27 fixed · 14 parked · 22 dropped",
    "wave 2  ▰▰▰▰▰▰  ▰▰▰▰▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    9 of 28 tasks done · 7 running                                       22m",
  ],
  "08-build-a-very-large-wave": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 22m ─╮",
    "● running · wave 2: two areas, each under its own orchestrator                                     ≈ 12% of your week",
    "waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▱▱▱▱  1 done · 4 queued    round 1 · 27 fixed · 14 parked · 22 dropped",
    "wave 2  ▰▰▰▰▰▰  ▰▰▰▰▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    9 of 28 tasks done · 7 running                                       22m",
  ],
  "09-review-once-for-the-whole-wave": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 11m ─╮",
    "● running · reviewing wave 2’s 27 fixes                                                            ≈ 12% of your week",
    "waves   ✓ Plan  ✓ Build  › Review  ○ Ship    ▰▰▱▱▱▱  1 done · 4 queued    round 1 · 27 fixed · 14 parked · 22 dropped",
    "wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▱  ▱▱▱▱▱▱    20 of 27 fixes pass · 1 failing                                      11m",
  ],
  "10-ship-wave-2": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────────────── 2m ─╮",
    "● running · writing wave 2’s pull request                                                          ≈ 12% of your week",
    "waves   ✓ Plan  ✓ Build  ✓ Review  › Ship    ▰▰▱▱▱▱  1 done · 4 queued    round 1 · 54 fixed · 14 parked · 22 dropped",
    "wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    final checks next                                                     2m",
  ],
  "11-ship-when-your-charter-lets-claude-merge": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────── 6m in Ship ─╮",
    "● running · wave 2’s PR #42 merged: it met your charter’s rule                                     ≈ 12% of your week",
    "waves ▰▰▱▱▱▱  2 done · 4 queued                                           round 1 · 54 fixed · 14 parked · 22 dropped",
    "✓ Charter  ✓ Hunt  ✓ Plan  ✓ Build  ✓ Review  › Ship",
    "tasks ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  27 done · 1 dropped",
  ],
  "12-hunt-round-2-the-queue-ran-dry": [
    "╭─ ◆ LCW Sweep · backlog-sweep ──────────────────────────────────────────────────────────────────────────── 5m in Hunt ─╮",
    "● running · hunting again, round 2                                                                 ≈ 29% of your week",
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
    "● running · wave 3 waits on your answer; wave 4 is being planned                                   ≈ 12% of your week",
    "waves   ✓ Plan  ✓ Build  ✓ Review  › Ship    ▰▰▰▱▱▱  2 done · 3 queued    round 1 · 81 fixed · 14 parked · 22 dropped",
    "wave 3  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    final checks next                                                     4m",
  ],
  "14-needs-you-two-questions": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 38m ─╮",
    "⚑ needs you · 2",
    "1  The Fleet tests need Docker, and no Docker daemon is running here. Start it, or shall I park Fleet’s 10 fix…   41m",
    "2  The Billing fixes need a Stripe test key, and none is set. Add one, or shall I park them?                       9m",
    "answer in plain words below, e.g. “1 yes, 2 UTC”",
    "● running · 2 areas wait on your answers; Panel carries on                                         ≈ 12% of your week",
    "waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▰▱▱▱  2 done · 3 queued    round 1 · 54 fixed · 14 parked · 22 dropped",
    "wave 3  ▰▰▰▰▰▰  ▰▰▰▰▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    11 of 27 tasks done · 4 running                                      38m",
  ],
  "15-paused-at-your-usage-mark": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 52m ─╮",
    "▮▮ paused at your 75% mark                                                                              resumes in 2d",
    "nothing new starts · the 3 running tasks finish and merge first",
    "say “run up to 85%” to carry on now",
    "waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▰▰▱▱  3 done · 2 queued    round 1 · 97 fixed · 14 parked · 22 dropped",
    "wave 4  ▰▰▰▰▰▰  ▰▰▰▰▰▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    14 of 26 tasks done · 3 running                                      52m",
  ],
  "16-paused-by-you": [
    "╭─ ◆ LCW Sweep · backlog-sweep ─────────────────────────────────────────────────────────────────────────────────── 52m ─╮",
    "▮▮ paused by you",
    "nothing new starts · no task is running",
    "say “carry on” to resume",
    "waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▰▰▱▱  3 done · 2 queued    round 1 · 97 fixed · 14 parked · 22 dropped",
    "wave 4  ▰▰▰▰▰▰  ▰▰▰▰▱▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    14 of 26 tasks done                                                  52m",
  ],
  "17-finished-with-stacked-pull-requests": [
    "╭─ ◆ LCW Sweep · backlog-sweep ───────────────────────────────────────────────────────────────────────────────── 1d 7h ─╮",
    "✓ finished · 7 draft PRs, #41 to #47, are open for your review",
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
    "✓ finished · 4 PRs merged · #45 to #47 are open for your review",
    "153 fixed · 14 parked for you, in parked.md · 24 dropped",
    "✓ Charter  ✓ Hunt  ✓ Plan  ✓ Build  ✓ Review  ✓ Ship",
    "3 rounds · 7 waves · 212 agents · 48.3M tokens · ≈ 31% of your week",
  ],
  "20-finished-with-one-pull-request-at-the-end": [
    "╭─ ◆ LCW Sweep · backlog-sweep ───────────────────────────────────────────────────────────────────────────────── 1d 7h ─╮",
    "✓ finished · 1 draft PR, #41, is open for your review",
    "153 fixed · 14 parked for you, in parked.md · 24 dropped",
    "✓ Charter  ✓ Hunt  ✓ Plan  ✓ Build  ✓ Review  ✓ Ship",
    "3 rounds · 7 waves · 212 agents · 48.3M tokens · ≈ 31% of your week",
  ],
  "21-stopped": [
    "╭─ ◆ LCW Sweep · backlog-sweep ────────────────────────────────────────────────────────────────────────── 12m in Build ─╮",
    "■ stopped",
    "waves ▰▰▰▱▱▱  3 done · 3 queued                                           round 1 · 81 fixed · 14 parked · 22 dropped",
    "✓ Charter  ✓ Hunt  ✓ Plan  › Build  ○ Review  ○ Ship",
    "tasks ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  6 done · 20 left",
  ],
  "22-in-a-narrow-window": [
    "◆ backlog-sweep             waves ▰▰▱▱▱▱",
    "● running · wave 2 building",
    "wave 2  ▰▰▰ ▰▰▱ ▱▱▱ ▱▱▱  Build",
  ],
  "23-a-build-for-comparison": [
    "╭─ ◆ LCW Build · shared-lists ─────────────────────────────────────────────────────────────────────────── 18m in Build ─╮",
    "● running · on track                                                                                ≈ 5% of your week",
    "✓ Brainstorm  ✓ Spec  ✓ Plan  › Build  ○ Review  ○ Ship",
    "tasks ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱  7 done · 4 running · 6 left",
  ],

};

// The six approved states of a sweep with waves open, as plain text: the card alone, 115 columns wide and 35.
const LANES = {
  "24-lanes-one-wave-open": {
    wide: [
      "◆ LCW Sweep · backlog-sweep                                                                                  1h 12m",
      "● running · wave 2 building                                                                      ≈ 12% of your week",
      "waves   ✓ Plan  › Build  ○ Review  ○ Ship    ▰▰▱  1 done · 1 queued                   round 1 · 12 fixed · 2 parked",
      "wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    7 of 12 tasks done · 3 running                                     22m",
    ],
    narrow: [
      "◆ backlog-sweep           waves ▰▰▱",
      "● running · wave 2 building",
      "wave 2  ▰▰▰ ▰▰▰ ▱▱▱ ▱▱▱  Build",
    ],
  },
  "25-lanes-review-and-build": {
    wide: [
      "◆ LCW Sweep · backlog-sweep                                                                                  1h 31m",
      "● running · wave 1 in review, wave 2 building                                                    ≈ 12% of your week",
      "waves   ✓ Plan  › Build  › Review  ○ Ship    ▰▰▱  1 queued                                       round 1 · 2 parked",
      "wave 1  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▱  ▱▱▱▱▱▱    18 of 23 fixes pass · 1 failing · round 2                          34m",
      "wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱     7 of 12 tasks done · 3 running                                    22m",
    ],
    narrow: [
      "◆ backlog-sweep           waves ▰▰▱",
      "● running · wave 1 in review, wave…",
      "wave 1  ▰▰▰ ▰▰▰ ▰▰▰ ▱▱▱  Review",
      "wave 2  ▰▰▰ ▰▰▰ ▱▱▱ ▱▱▱  Build",
    ],
  },
  "26-lanes-three-open": {
    wide: [
      "◆ LCW Sweep · backlog-sweep                                                                                  2h 48m",
      "● running · wave 1 in its final checks, wave 2 in review, wave 3 building                        ≈ 12% of your week",
      "waves   ✓ Plan  › Build  › Review  › Ship    ▰▰▰                                      round 1 · 23 fixed · 2 parked",
      "wave 1  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    final checks                                                       14m",
      "wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▱▱▱  ▱▱▱▱▱▱    7 of 12 fixes pass                                                 19m",
      "wave 3  ▰▰▰▰▰▰  ▰▰▰▰▰▱▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    3 of  9 tasks done · 4 running                                     12m",
    ],
    narrow: [
      "◆ backlog-sweep           waves ▰▰▰",
      "● running · wave 1 in its final ch…",
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
      "● running · wave 1 waits on your answer; wave 2 carries on                                       ≈ 12% of your week",
      "waves   ✓ Plan  › Build  ○ Review  › Ship    ▰▰▱  1 queued                            round 1 · 23 fixed · 2 parked",
      "wave 1  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    ⚑ waits on your answer                                             12m",
      "wave 2  ▰▰▰▰▰▰  ▰▰▰▰▰▰▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    7 of 12 tasks done · 3 running                                     31m",
    ],
    narrow: [
      "◆ backlog-sweep           waves ▰▰▱",
      "⚑ needs you · 12m",
      "Wave 1 cannot be pushed: GitHub re…",
      "● running · wave 1 waits on your a…",
      "wave 1  ▰▰▰ ▰▰▰ ▰▰▰ ▰▰▰  ⚑ waiting",
      "wave 2  ▰▰▰ ▰▰▰ ▱▱▱ ▱▱▱  Build",
    ],
  },
  "28-lanes-a-long-sweep": {
    wide: [
      "◆ LCW Sweep · backlog-sweep                                                                                   1d 2h",
      "● running · wave 6 in its final checks, wave 7 building                                          ≈ 23% of your week",
      "waves   ✓ Plan  › Build  ○ Review  › Ship    ▰▰▰▰▰▰▰▱▱  5 done · 2 queued           round 3 · 61 fixed · 170 parked",
      "wave 6  ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    final checks                                                       18m",
      "wave 7  ▰▰▰▰▰▰  ▰▰▰▰▰▰▱  ▱▱▱▱▱▱▱▱  ▱▱▱▱▱▱    4 of 11 tasks done · 4 running                                      9m",
    ],
    narrow: [
      "◆ backlog-sweep     waves ▰▰▰▰▰▰▰▱▱",
      "● running · wave 6 in its final ch…",
      "wave 6  ▰▰▰ ▰▰▰ ▰▰▰ ▰▰▰  checks",
      "wave 7  ▰▰▰ ▰▰▱ ▱▱▱ ▱▱▱  Build",
    ],
  },
  "29-lanes-hunt-and-final-checks": {
    wide: [
      "◆ LCW Sweep · backlog-sweep                                                                                  4h 35m",
      "● running · hunting again, round 2; wave 3 in its final checks                                   ≈ 18% of your week",
      "waves    ✓ Plan  ✓ Build  ✓ Review  › Ship    ▰▰▰  2 done                 round 2 · 43 fixed · 2 parked · 3 dropped",
      "wave 3   ▰▰▰▰▰▰  ▰▰▰▰▰▰▰  ▰▰▰▰▰▰▰▰  ▰▰▰▰▰▰    final checks                                                      11m",
      "round 2  › Hunt  ▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱    9 of 36 areas hunted · 5 running · 4 findings so far               5m",
    ],
    narrow: [
      "◆ backlog-sweep           waves ▰▰▰",
      "● running · hunting again, round 2…",
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
  assert.match(lines[0], /^╭─ ◆ LCW Build · export-csv ─+ 2h 14m in Build ─╮$/);
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
    assert.ok(status[1].endsWith('resets in 3d · -15% short'));
    const plain = renderCard(buildView(inputsOf('Stalled')), { width });
    const text = strip(toAnsi(plain, 'dark', width)).split('\n');
    assert.ok(text[0].endsWith('≈ 12% of your week') || text[0].endsWith('3h 02m in Build'));
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
  // Fable 5.2 · xhigh and 38% of 1M take 29 cells; "resets in 3d · +42% spare" on the right takes 25, and two apart
  const input = { model: 'Fable 5.2', effort: 'xhigh', contextPercent: 38, contextWindow: '1M', repo: 'lcw', branch: 'main', weekUsedPercent: 29, weekElapsedPercent: 50, markPercent: 75 };
  const bar = width => renderStatusRows(input, { width })[0].filter(s => s.plain !== undefined).reduce((n, s) => n + s.t.length, 0);
  assert.deepEqual([126, 76, 71, 66, 60, 44, 40].map(bar), [20, 20, 15, 10, 10, 10, 6]);
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

test('the card shows the PR number, never its link', () => {
  const ansi = toAnsi(card('Done', { width: 126 }), 'dark', 126);
  assert.ok(strip(ansi).includes('draft PR #482 is open'));
  assert.ok(!ansi.includes('github.com'));
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

test('buildView: quiet, stalled and waiting agents', () => {
  const i = inputsOf('RunningA');
  const mk = (status, quietMs) => buildView({ ...i, agents: [{ id: 'x', description: 'd', model: 'm', startTime: NOW, tokens: 1, status, quietMs }] }).agents[0].chip;
  assert.equal(mk('running', 4 * 6e4), null);
  assert.equal(mk('running', 5 * 6e4), 'quiet');
  assert.equal(mk('running', 15 * 6e4), 'stalled');
  assert.equal(mk('waiting', 40 * 6e4), null);
  assert.equal(buildView({ ...i, agents: [{ id: 'x', status: 'completed' }] }).agents.length, 0);
});

test('buildView: an agent held after its report is marked stalled at fifteen minutes, and not before', () => {
  const i = inputsOf('RunningA');
  const mk = (heldMs) => buildView({ ...i, agents: [{ id: 'x', description: 'd', model: 'm', startTime: NOW, tokens: 1, status: 'waiting', quietMs: 0, heldMs }] }).agents[0].chip;
  assert.equal(mk(14 * 6e4), null);
  assert.equal(mk(15 * 6e4), 'stalled');
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
  const before = '2026-11-15T14:00:00.000Z', after = usage.sevenDay.resetsAt;
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

// ---------------------------------------------------------------- a sweep

test("each sweep state, and a build's, is drawn row for row as approved", () => {
  for (const [board, want] of Object.entries(SWEEP)) {
    const width = board.startsWith('22-') ? 40 : 121;
    const got = strip(toAnsi(card(board, { width, frame: true }), 'dark', width)).split('\n')
      .filter(l => !/^│ +[→▾▸]/.test(l) && !/^[├╰]/.test(l) && !/^ *(→|Sonnet ·)/.test(l))
      .map(l => (l.startsWith('│ ') ? l.slice(2, -2).trimEnd() : l));
    assert.deepEqual(got, want, board);
  }
});

const laneRows = (i, width = 115) => strip(toAnsi(renderCard(buildView(i), { width }), 'dark', width)).split('\n').map(l => l.trimEnd());
const laneOf = (rows, n) => rows.find(l => l.startsWith('wave ' + n + ' '));
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
  assert.match(laneOf(laneRows(withWave1(built)), 1), /^wave 1  ▰{6}  ▰{7}  ▱{8}  ▱{6} {4}3 of  3 tasks done · 2 parked · review next +34m$/);
  // While work is left the parked ones still count, and are named.
  const going = { ...built, tasks: tasks(['done', 'done', 'done', 'running', 'parked', 'parked']) };
  assert.match(laneOf(laneRows(withWave1(going)), 1), / 3 of  6 tasks done · 1 running · 2 parked +34m$/);
  // With nothing built there is no figure: the parked ones alone.
  const none = { ...built, tasks: tasks(['parked', 'parked', 'dropped']) };
  assert.match(laneOf(laneRows(withWave1(none)), 1), /^wave 1  ▰{6}  ▱{7}  ▱{8}  ▱{6} {4}2 parked +34m$/);
});

test('a wave shipped and waiting on its merge keeps its lane at Ship while the charter merges as it goes', () => {
  const held = { status: 'shipped', merged: false, pr: 41, stage: 'Review', step: null };
  const rows = laneRows(withWave1(held, { prs: 'merged' }));
  assert.match(laneOf(rows, 1), /▰{6} {4}merging/);
  assert.match(rows.find(l => l.startsWith('waves ')), /Ship {4}▰▰▱ {2}1 queued/);
  // With stacked pull requests it has merged, and no lane stands for it.
  const stacked = laneRows(withWave1(held, { prs: 'stacked' }));
  assert.equal(laneOf(stacked, 1), undefined);
  assert.match(stacked.find(l => l.startsWith('waves ')), /Ship {4}▰▰▱ {2}1 done · 1 queued/);
  // A run that is over holds no wave open.
  const over = withWave1(held, { prs: 'merged' });
  over.state.status = 'finished';
  assert.ok(!laneRows(over).some(l => l.startsWith('wave 1 ')));
});

test('a shipped wave that was left empty has no pull request to merge, so it holds no lane', () => {
  const held = { status: 'shipped', merged: false, pr: 41, stage: 'Review', step: null };
  assert.ok(laneRows(withWave1(held, { prs: 'merged' })).some(l => l.startsWith('wave 1 ')));
  assert.ok(!laneRows(withWave1({ ...held, pr: undefined, empty: true }, { prs: 'merged' })).some(l => l.startsWith('wave 1 ')));
});

test('the paused row counts the running tasks of every open wave', () => {
  assert.equal(buildView(inputsOf('26-lanes-three-open')).running, 4);
});

test('at 100 columns nothing is lost, at 80 the longer words go first, and below 60 the lanes are the narrow ones', () => {
  const at = (w) => laneRows(inputsOf('25-lanes-review-and-build'), w);
  const full = at(100);
  assert.match(laneOf(full, 1), /18 of 23 fixes pass · 1 failing · round 2 +34m$/);
  assert.match(full.find(l => l.startsWith('waves ')), /▰▰▱ {2}1 queued +round 1 · 2 parked$/);
  const eighty = at(80);
  // The later review round goes before the failing fix, the last to lose.
  assert.match(laneOf(eighty, 1), /18 of 23 pass · 1 failing +34m$/);
  assert.match(laneOf(eighty, 2), /7 of 12 done +22m$/);
  const fifty = at(50);
  assert.match(fifty.find(l => l.startsWith('waves ')), /^waves {3}▰▰▱ {2}2 in progress · 1 queued/);
  assert.equal(laneOf(fifty, 1), 'wave 1  ▰▰▰ ▰▰▰ ▰▰▰ ▱▱▱  Review');
  // Where the heading is short the sweep's totals give way before the wave counts, and the counts before the cells.
  const long = (w) => laneRows(inputsOf('28-lanes-a-long-sweep'), w).find(l => l.startsWith('waves '));
  assert.match(long(115), /Ship {4}▰{7}▱{2} {2}5 done · 2 queued +round 3 · 61 fixed · 170 parked$/);
  assert.match(long(80), /Ship {4}▰{7}▱{2} {2}5 done · 2 queued$/);
  assert.match(long(70), /Ship {4}▰{7}▱{2} +61 fixed$/);
  for (const board of Object.keys(LANES)) for (const w of [140, 100, 80, 70, 60, 50, 44, 43, 36, 30]) {
    laneRows(inputsOf(board), w).forEach(l => assert.ok(cols(l) <= w, board + ' at ' + w + ': ' + l));
  }
});

test('framed at 100 columns the heading keeps its wave counts and as many totals as fit', () => {
  const heading = board => strip(toAnsi(card(board, { width: 100, frame: true }), 'dark', 100)).split('\n').find(l => l.startsWith('│ waves '));
  assert.match(heading('29-lanes-hunt-and-final-checks'), /Ship {4}▰▰▰ {2}2 done +round 2 · 43 fixed · 2 parked │$/);
  // The long sweep has no room for all: the dropped and the round go.
  assert.match(heading('28-lanes-a-long-sweep'), /Ship {4}▰{7}▱{2} {2}5 done · 2 queued +61 fixed · 170 parked │$/);
});

test('a narrow waves row drops whole counts and never cuts a word or leaves a dangling dot', () => {
  let seen = 0;
  for (let w = 36; w <= 60; w++) {
    const rows = strip(toAnsi(card('28-lanes-a-long-sweep', { width: w, frame: true }), 'dark', w)).split('\n').filter(l => l.startsWith('│ waves '));
    for (const row of rows) {
      seen++;
      const after = row.slice(2, -2).trim().replace(/^waves\s+/, '').replace(/[▰▱]+|[✓›○] (Plan|Build|Review|Ship)/gu, '').trim();
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
  assert.match(laneOf(laneRows(withWave1({ requirements: parked })), 1), /^wave 1  ▰{6}  ▰{7}  ▱{8}  ▱{6} +34m$/);
  assert.match(laneOf(laneRows(withWave1({ stage: 'Build', tasks: [] })), 1), /^wave 1  ▰{6}  ▱{7}  ▱{8}  ▱{6} +34m$/);
});

test('a hunt round beside open waves has its lane before any area is recorded', () => {
  const i = inputsOf('29-lanes-hunt-and-final-checks');
  i.state.sweep.hunt = { areas: 0, hunted: 0, running: 0, findings: 0 };
  assert.match(laneRows(i).find(l => l.startsWith('round 2 ')), /^round 2  › Hunt  ▱{25} {4}starting +5m$/);
});

test('a wave whose stage has no start time draws no clock', () => {
  const held = { status: 'shipped', merged: false, pr: 41, stage: 'Review', step: null, stageSince: undefined };
  assert.match(laneOf(laneRows(withWave1(held, { prs: 'merged' })), 1), /▰{6} {4}merging$/);
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
  const row = strip(toAnsi(renderCard(buildView(i), { width: 121, frame: true }), 'dark', 121)).split('\n').find(l => l.startsWith('│ wave 2 '));
  assert.match(row, /^│ wave 2 .*  1 of 2 fixes pass +\d+m │$/);
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
  for (let w = 44; w <= 90; w++) assert.match(row(w), /^waves ▰▰▰▱▱(  3 done( · 2 queued)?)?( {2,}(round 2|\d+ (fixed|parked|dropped))( · [^·…]+)*)?$/, w + ': ' + row(w));
  assert.match(row(80), /^waves ▰▰▰▱▱  3 done · 2 queued +round 2 · 14 fixed · 3 parked · 2 dropped$/);
  // With no wave queued yet the totals give way too.
  const none = { ...state, sweep: { ...state.sweep, waves: [] } };
  for (let w = 44; w <= 90; w++) assert.match(row(w, none), /^waves none queued yet( {2,}(round 2|\d+ (fixed|parked|dropped))( · [^·…]+)*)?$/, w + ': ' + row(w, none));
});

test('the requirements bar stays twenty cells when one failing of many rounds to a cell of its own', () => {
  const requirements = [...Array.from({ length: 39 }, (_, k) => ({ id: 'R' + k, name: 'x', status: 'pass' })), { id: 'R39', name: 'retry policy', status: 'failing' }];
  const row = plain(renderCard(buildView({ state: { name: 'd', stage: 'Review', status: 'running', requirements }, ...at }), { width: 120 })).find(t => t.startsWith('requirements'));
  assert.match(row, /^requirements ▰{20}  39 pass · 1 failing/);
});

test('just after the weekly reset the week row gives no pace, until enough of the week has passed for it to mean something', () => {
  const right = (weekElapsedPercent, weekUsedPercent) => {
    const r = renderStatusRows({ ...inputsOf('Main').status, weekElapsedPercent, weekUsedPercent }, { width: 126 })[1];
    return joined(r.slice(r.findIndex(s => s.r)));
  };
  assert.equal(right(20 / 60 / 168 * 100, 1), 'resets in 6d');
  assert.equal(right(4.9, 1), 'resets in 6d');
  assert.equal(right(5, 1), 'resets in 6d · +80% spare');
  assert.equal(right(50, 60), 'resets in 3d · -20% short');
});

test("the lanes' heading keeps its wave cells to the room left, so none is cut while the lanes fit", () => {
  const queued = Array.from({ length: 20 }, (_, k) => ({ n: 10 + k, status: 'queued' }));
  const state = { name: 'sweep-x', shape: 'sweep', stage: 'Ship', status: 'running', createdAt: NOW - 3e6, stageSince: NOW - 1e6,
    sweep: { round: 1, fixed: 3, parked: 1, dropped: 2, prs: 'stacked', waves: [{ n: 1, status: 'shipped', pr: 5 },
      { n: 2, status: 'running', stage: 'Ship', step: 'merging', stageSince: NOW - 6e5, requirements: [], tasks: [] }, ...queued] } };
  for (const width of [60, 62, 64, 66]) {
    const rows = laneRows({ state, now: NOW }, width);
    assert.match(rows.find(l => l.startsWith('waves ')), /^waves {3}✓ Plan {2}✓ Build {2}✓ Review {2}› Ship {4}▰+▱+$/, width + ': ' + rows.join('\n'));
    assert.equal(rows.find(l => l.startsWith('waves ')).length, width);
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
