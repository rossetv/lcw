# Hunt

Each round of a sweep starts here: probes look for problems in the areas the charter names, and you sort what they find. Entering Hunt adds one to the round. You do not read code: probes do, and they report.

`lcw set health="hunting, area by area"` in round 1, `health="hunting again, round <n>"` in a later one. Read charter.md and, in a later round, findings.md, both in the run folder.

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

Then `lcw set health="sorted against the charter"`.

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

Before you report, settle the pull requests as the charter's PRs line says. Whichever it is, run `lcw status` just before `lcw finish` and keep what it prints, the totals and each wave's pull request: once the run is finished, the session is no longer bound to it.

- **merged as it goes**: this is the last pass, with no next one to try again on, so it waits where Ship's passes stop. Where the criteria name GitHub's checks, a pass after a wave ships only looks (`gh pr checks <number> -R <repo>`, never `--watch`) and never waits; at the end, wait for them with the Monitor tool (a plain foreground sleep is refused), an until-loop on `gh pr checks <number> -R <repo>` that ends when none is pending, in waits of up to 10 minutes each, at most an hour for the whole end pass, not an hour for each wave; "no checks reported" within 10 minutes of the pull request being opened or reopened means look again, after that the checks count as none, and none run, all skipped, or still running when the hour runs out is not passed.

  Go through the shipped waves not yet merged, in order (a queued wave never ran and has no pull request), passing over a wave with no commits (`lcw status` shows it empty). For each:
  1. If its push or pull request still waits on the human's answer, it stays open.
  2. Where the criteria name checks, wait for them as above.
  3. If it falls short of the criteria, failed checks included, it stays open. Otherwise `lcw merge <wave>`, and act on what it says:
     - **merged**: where the criteria name checks, `gh pr close <number>` and `gh pr reopen <number>` the next pull request, which is now against the default branch and has started none of its checks; then go on to the next wave.
     - **based on another branch**: run the `gh pr edit` command it prints, close and reopen the pull request where the criteria name checks, and go back to step 2 for this wave; if `lcw merge` says so again, it stays open.
     - **not merged yet** (a merge queue, or GitHub waiting on checks): where the criteria name GitHub's checks, wait, within the same hour, with the Monitor until-loop on `gh pr view <number> -R <repo> --json state` that ends when it shows it merged or GitHub takes it out of the queue, then go back to step 2 for this wave; `lcw merge <wave>` records it once GitHub shows it merged. Otherwise, or if the hour runs out first, it stays open, queued, and the report says so.
     - **gh could not merge**: if the ledger shows it failed so in an earlier pass, it stays open; if not, `lcw ledger "wave <n>: gh could not merge: <gh's words>"` and go back to step 2 for this wave, once.
     - **gh could not read #N**: treat it as gh could not merge.
     - **wave <m> is not merged yet; waves merge in order**: merge wave <m> first; this pass goes in order, so it comes to it first anyway.
     - **merged into another branch**: its changes have not landed and it needs the human; it stays open.

  The first wave that stays open ends the pass: it and every wave after it are left open for the human, each with its reason (gh's words where gh could not merge) for the report. Then `lcw finish`.
- **one at the end**: if any wave shipped with commits (`git rev-list --count <default branch>..lcw/<name>` prints more than 0), push the sweep's branch (`git push -u origin lcw/<name>`), load the `lcw:pull-request` skill and write the one draft pull request for everything as it says, open it against the default branch (`gh pr create --draft --head lcw/<name> --base <default branch> --title "<title>" --body-file <file>`), and `lcw finish --pr <url>`. With no GitHub remote or no way to push, `lcw finish --branch lcw/<name>`, tell the human the work is on `lcw/<name>` and why there is no pull request, and put the text in the conversation, as stages/ship.md says. If none did, there is nothing to open: `lcw finish`, and the report says no pull request was opened because no wave changed anything.
- **stacked**: `lcw finish`.

In stacked or merged as it goes, a wave whose push still waits on the human's answer ends the sweep unpushed, with every wave after it: the report says so, and clean-up's checks keep the worktree and its branches.

Then clean up as stages/ship.md says under "Afterwards: clean up", for the sweep's worktree and its local branches.

Tell the human, short, from what `lcw status` printed and findings.md: what was fixed, area by area, not only how many; what was parked and what was dropped; at an earlier end with waves still queued, the fixes queued and not built; which pull requests exist and in what state (open as drafts, merged, or left open, and why); and where parked.md is.
