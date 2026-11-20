# Hunt

Each round of a sweep starts here: probes look for problems in the areas the charter names, and you sort what they find. Entering Hunt adds one to the round. You do not read code: probes do, and they report.

`lcw set health="hunting, area by area"`. Read charter.md and, in a later round, findings.md, both in the run folder.

## Which areas

In round 1, every area the charter names.

In a later round, only an area that had a finding sorted to Fix in the round before, or that a wave has changed since. An area that came up clean, or whose findings were all parked or dropped, and that no wave changed, is not hunted again. To see what the waves changed, take the commit the last round read (findings.md records it) and run `git diff --name-only <that commit> lcw/<name>`; an area whose files are in that list has changed.

Probes read the code where the sweep stands: the main checkout in round 1, before the sweep has a worktree; `lcw/<name>` in its worktree after that. Start the round's heading in findings.md with the commit they read (`git rev-parse HEAD` there).

## Sending the probes

Split the round into parts: for a list such as a backlog, about eight items to a part; for an open hunt, one part for each area and angle (an area of the backend, hunted for wrong totals, say). One probe hunts each part. Pick its model by what a miss would cost: Haiku, low, to check a list's items; Sonnet, medium, for an open hunt; Opus, high, where a miss is costly or hard to see, such as security, money or data that could be lost.

Brief each probe with the charter's goals, non-goals, anti-goals, no-go zones and proof line, its part (the area and its files, and its items or its angle), and what to report. For each problem it finds, a recipe: where it is, what input or situation shows it, what goes wrong, and who it hurts. For a backlog item, whether it is still true. If it finds nothing, it says so. Its description on the status bar names its part: "Hunt Billing, items 1 to 8: still true? what would fix each?".

List the round's parts in findings.md, then launch the probes in batches of up to about ten, and the next as each finishes. Keep the bar current, counting parts:

```
lcw hunt --areas 36 --hunted 14 --running 6 --findings 23
```

Write each report into findings.md under its part as it arrives, so after a compaction you can see which parts have reported. A report with no recipe is not a finding: ask the probe for what is missing, and if it cannot say, leave it out. A finding already parked or dropped in an earlier round is not sorted again.

## Sorting

When every part has reported, sort each finding against the charter, and write the sort and its reason beside it in findings.md. Give each finding an id that is new in this sweep (F1, F2, and on across rounds); a fix keeps its id when its wave's Plan records it.

- **Fix**: it goes into a wave.
- **Park**: a decision only the human can make (the finding names a problem but not what should happen instead, and the charter does not settle it), or what the charter's park line says to park. A fix that would need a no-go zone, or a kind of change the charter does not allow, is parked, not built. Say why.
- **Drop**: no longer true, or not a problem under the charter. Say why.

Never guess a decision that should be parked.

### Security holes

charter.md says whether the repository is public; if it does not, check now (`gh repo view --json visibility`; only `PRIVATE` is private, and a remote not on GitHub is public). In a private repository a security finding is sorted like any other.

In a public repository, a proof of a hole (a test, or steps that show how to use it) is never committed or pushed. Unless the charter's changes line says such fixes may be published, park the finding whole, with its proof in parked.md for the human. Where the charter allows it, sort it to Fix and mark it "no proof in the repository" in findings.md, so its wave's Plan tells the worker to keep the test outside the repository; the proof stays in findings.md.

### The records

findings.md holds every finding with its recipe and its sort, round by round, and the areas that came up clean. parked.md is for the human: each parked item in plain words, where it is, why it was parked and what they would have to decide. Both live in the run folder, never in the repository. Then record the round's counts; park and drop add to the sweep's totals:

```
lcw hunt --fix 151 --park 14 --drop 21
```

Show the sorted list in the conversation, short: what goes to Fix, area by area; what is parked and why; what is dropped and why; and where parked.md is. Do not wait for an answer: parked items never hold up the rest.

## Waves

If nothing was sorted to Fix, the sweep is over: go to "Ending the sweep" below.

Otherwise group the fixes into waves of about the charter's size. Within a wave, group the fixes by area, and choose areas that touch different files, so they can be built at the same time. Write each wave in findings.md (its number, its fixes by id, its areas), and queue them, one count of fixes for each wave, in the order they will run:

```
lcw wave add 25 25 24 26 25 26
```

Say in a line how many waves are queued and what the first one holds. Then:

```
lcw stage Plan
lcw checkpoint "Plan: read stages/plan.md and start wave <n>"
```

and end your turn.

## Ending the sweep

The sweep ends as the charter's stop line says: by default when a round's hunt finds nothing to fix. An earlier end the charter names, such as a number of waves or a share of the week (`lcw usage` shows it), is a normal finish, not a stop; Ship sends you here when a wave reaches it.

Before you report, settle the pull requests as the charter's PRs line says:

- **merged as it goes**: this is the last pass, with no next one to retry on, so it waits where Ship's passes stop. Go through the waves not yet merged, in order, and for each:
  1. If `lcw merge` refused it because its base is not the default branch, run the `gh pr edit` command it printed; where the criteria name GitHub's checks, `gh pr close <number>` and `gh pr reopen <number>` so they run. Close and reopen the same way after a merge moves the next pull request onto the default branch.
  2. Where the criteria name GitHub's checks, wait for those still running: `gh pr checks <number> -R <repo> --watch`. Right after a retarget or a close and reopen, GitHub may not have registered the new checks yet and the command exits with "no checks reported": that is not a failure, so wait until the checks appear, then watch them.
  3. If its merge is queued, wait until `gh pr view <number> -R <repo> --json state` shows it merged, or GitHub takes it out of the queue.
  4. If it meets the criteria, run `lcw merge <wave>` again. If that is refused for the first time in this pass because the base is not the default branch (it prints a `gh pr edit` command) or because the merge is queued ("is not merged yet ... queued or waiting on checks"), do step 1 or step 3 for that same wave, then step 4 once more.

  Only after that retry, the first wave that still falls short of the criteria, or that `lcw merge` says was merged into another branch, is left open, and so is every wave after it: `lcw ledger "wave <n> left open: <why>"` for each, and the report below names them with the reason. Then `lcw finish`.
- **one at the end**: if any wave shipped, push the sweep's branch (`git push -u origin lcw/<name>`), load the `lcw:pull-request` skill and write the one draft pull request for everything as it says, open it against the default branch (`gh pr create --draft --head lcw/<name> --base <default branch> --title "<title>" --body-file <file>`), and `lcw finish --pr <url>`. With no remote or no way to push, `lcw finish --branch lcw/<name>`, and put the text in the conversation, as stages/ship.md says. If no wave shipped, there is nothing to open: `lcw finish`.
- **stacked**: `lcw finish`.

Then clean up as stages/ship.md says under "Afterwards: clean up", for the sweep's worktree and its local branches.

Tell the human, short: how many fixes were made, parked and dropped; which pull requests exist and in what state (open as drafts, merged, or left open because they missed the criteria, and which); and where parked.md is.
