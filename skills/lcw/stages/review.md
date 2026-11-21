# Review

The finished work is checked against the intent in the spec: first by independent reviewers, then by you, because you hold the intent.

`lcw set health="checking the result against the spec"` (a sweep sets its own words instead, below). On a second or later round, set back only the groups that had a failing requirement, and any requirement the fixes touched (`lcw req <id> todo`), and review only those. The test suites, run in every round, guard the rest.

## The independent review

Launch fresh reviewer agents each round, all at once: one for each review group plan.md gives, on the model it gives that group (Opus or Sonnet, effort high). A reviewer with few requirements checks each one properly, and no reviewer holds the whole of a large build. Give each one the path of spec.md, the run worktree, the commit the run branched from (`lcw status` prints it as base; it lets the reviewer see the whole change) and its own requirement ids. In a later round, give the commit the round's fixes started from, from the ledger, in place of base: the reviewer reads only what the fixes changed. Give one reviewer of the round, and only one, the job of running the test suites and the repository's own checks before a pull request, as plan.md says. It runs each suite that covers code the run changed, directly or through an import or an API, and may skip one that covers nothing the run touched; when unsure, it runs it. A failing test is a real issue only if the run caused it: the reviewer reruns it at base, in a throwaway copy, and a test that fails there too was already broken. An already-broken test does not hold the run: write it in the ledger (`lcw ledger "already broken: <test>"`). Reviewers hand their plain reading and searching to probes.

If the spec lists approved examples, the first round has one more reviewer, with no requirements: its job is the approved examples. Give it the paths of spec.md and plan.md (how each state is reached), the file of each approved state, the run worktree and the run folder. In a later round, launch it again only if a fix touched something an example shows. When it reports: `lcw ledger "examples: <n> match, <n> differ, <n> not compared"`.

Record each verdict as it comes:

```
lcw req R3 pass
lcw req R8 failing
```

## Judging

Reviewers never see the ledger, so they challenge decisions made earlier in the run. You hold those decisions and the intent, and every concern gets your call: change the work, or accept it as it is. Weigh a challenge on its merits, not on the fact that a decision was already made: a decision is overturned when the reviewer's point is right. Record each call: `lcw ledger "accepted: <the concern>, because <why>"` for one you keep as it is (the pull request lists those the human would act on), or a fix task for one you change. Something that grows without limit or breaks within months is accepted only for a reason you would defend to the human. An approved example that differs is fixed in the build, never in the example, unless the ledger says why the two cannot match.

If you decided to change anything: `lcw ledger "round <n> fixes start from <git rev-parse HEAD in the run's worktree>"`, `lcw stage Build`, add a task for each fix (`lcw task add F1 "<fix>" --model sonnet --effort medium`), have them built as stages/build.md says, then `lcw stage Review` and run a new round with fresh reviewers. Your own check waits until a round is clean.

## Your final check

Only when a round leaves nothing to change: judge the whole against the intent in brainstorm.md. Does it do what the human meant? You do not read the diff or run it yourself. Have a reviewer, or a worker, run the thing as the human would use it and report what it does for each thing they asked for; then compare that report with the brainstorm. This is not a second pass for small things. A real issue you find here goes back to Build like any other, and the next round checks it.

The review ends when you have made the call on every concern of a round and none needs a change, and your final check finds nothing either. Then:

```
lcw ledger "review passed on round <n>"
lcw stage Ship
lcw checkpoint "Ship: read stages/ship.md and write the draft pull request from brainstorm.md, spec.md and the ledger"
```

and end your turn. Ship starts on a fresh context.

## In a sweep

`lcw set health="reviewing wave <n>'s <count> fixes"`. A wave is reviewed once, as a whole, as above. Each reviewer gets charter.md, its fixes with their F ids and recipes in place of spec.md and requirement names, and the commit the wave started from in place of the run's (`lcw status` prints the wave's base as base): it reads only this wave's changes, never an earlier wave's. Leave parked fixes out of the groups: they were never built. In a later round it gets the commit the round's fixes started from, as above. Each reviewer checks each of its fixes against the recipe: its test shows what the recipe describes and now passes, and for a fix with no test, the item is no longer true. A fix the ledger shows as partly fixed is checked for what it built; when that passes, record it `lcw req <F id> partial`, never pass, so it is not counted as fixed. Name each fix findings.md marks "no proof in the repository" to the reviewers, as a fix with no test by design. Give the reviewer who runs the suites the baseline in charter.md: a test that failed there is already broken and needs no rerun at base. The reviewer who runs the suites also reads the wave's whole change against charter.md: nothing in a no-go zone, no kind of change it does not allow, no anti-goal.

The fix tasks you add to a wave are named X1, X2 and on (`lcw task add X1 "<fix>" ...`), never F ids, which belong to the wave's fixes.

Your final check judges the wave against charter.md and the wave's findings in place of brainstorm.md. When the review passes, checkpoint as above, naming the wave: `lcw checkpoint "Ship: read stages/ship.md and ship wave <n>"`.
