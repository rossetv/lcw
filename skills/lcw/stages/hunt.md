# Hunt

Each round of a sweep starts here: probes look for problems in the areas the charter names, and you sort what they find. Entering Hunt adds one to the round. A later round starts with `lcw stage Hunt` once the round before has sorted its fixes into waves, no wave is queued and every open wave is built: in Review, back in Build for its review's fixes, or holding in Ship. It does not wait for their reviews, final checks or merges, which go on alongside it (stages/review.md, stages/ship.md). A round that starts while a wave is short of Ship is an early one: it reads code that wave's review may still change, so it cannot end the sweep (Waves, below). `lcw stage Hunt` says so when it starts one, and `lcw status` shows it. You do not read code: probes do, and they report.

`lcw set health="hunting, area by area"` in round 1, `health="Hunting again for what is left. <what goes live next>"` in a later one, such as `health="Hunting again for what is left. The settings fixes go live once their checks pass."` (SKILL.md: what the card cannot show, never wave numbers or stages). Read charter.md and, in a later round, findings.md, both in the run folder.

## Which areas

In round 1, every area the charter names.

In a later round, only an area that had a finding sorted to Fix in the round before, or that a wave has changed since. An area that came up clean, or whose findings were all parked or dropped, and that no wave changed, is not hunted again. While a stop line that counts fixes is not met, a later round also hunts the charter's items or areas that no round has hunted yet. To see what the waves changed, take the commit the last round read (findings.md records it) and run `git -C <latest work> diff --name-only <that commit> HEAD`; an area whose files are in that list has changed.

Probes read the code where the sweep stands: the `latest work` path `lcw status` prints, which is the main checkout in round 1. With waves open, `lcw stage Hunt` makes it a worktree holding every open wave's work, and prints it as `latest work:`. If that line says it holds only the newest wave's tip, tell the probes which wave's later work it lacks. Start the round's heading in findings.md with the commit they read (`git -C <latest work> rev-parse HEAD`).

## Sending the probes

Split the round into parts: for a list such as a backlog, about eight items to a part; for an open hunt, one part for each area and angle (an area of the backend, hunted for wrong totals, say). One probe hunts each part. Pick its model by what a miss would cost: Haiku, low, to check a list's items; Sonnet, medium, for an open hunt; Opus, high, where a miss is costly or hard to see, such as security, money or data that could be lost.

Brief each probe with the charter's goals, non-goals, anti-goals, no-go zones and proof line, its part (the area and its files, and its items or its angle), and what to report. For each problem it finds, a recipe: where it is, what input or situation shows it, what goes wrong, who it hurts, and where else in its part it saw the same mistake. For a backlog item, whether it is still true. If it finds nothing, it says so. Its description on the status bar names its part: "Hunt Billing, items 1 to 8: still true? what would fix each?".

List the round's parts in findings.md, then launch the probes in batches of up to about ten, and the next as each finishes. Keep the bar current, counting parts:

```
lcw hunt --areas 36 --hunted 14 --running 6 --findings 23
```

Write each report into findings.md under its part as it arrives, so after a compaction you can see which parts have reported. A report with no recipe is not a finding: ask the probe for what is missing, and if it cannot say, leave it out. A finding already parked or dropped in an earlier round is not sorted again; one written in during a wave (what a partly fixed fix left, or a concern its review sent on because the wave had not changed it) is sorted with this round's, and so is each question answered and not yet used (`lcw question`), as plan.md's step 4 says.

## Sorting

When every part has reported, and in round 1 the baseline the charter launched too (charter.md, "Baseline"), sort each finding against the charter, and write the sort and its reason beside it in findings.md.

A check the baseline found failing is handled as the charter's PRs line says. Where the charter says to fix it, it is a finding like any other, its recipe taken from the baseline's report, and sorted to Fix, so it lands in the first wave. Where the charter says to wait for the human, `lcw ask` them now: only the merges wait on the answer, and the waves carry on. The same mistake in several places is one finding, with every place in its recipe. Give each finding an id that is new in this sweep (F1, F2, and on across rounds); a fix keeps its id when its wave's Plan records it.

- **Fix**: it goes into a wave.
- **Park**: a decision only the human can make (the finding names a problem but not what should happen instead, and the charter does not settle it), or what the charter's park line says to park. A fix that would need a no-go zone, or a kind of change the charter does not allow, is parked, not built. Say why.
- **Drop**: no longer true, or not a problem under the charter. Say why.

Never guess a decision that should be parked.

In an early round, a finding in a file a wave still in review has changed is sorted like any other, though that review may fix it first: its wave takes it up only once that file is free (stages/plan.md, step 2), and a worker who cannot make its test fail drops it.

### Security holes

charter.md says whether the repository is public; if it does not, check now (`gh repo view --json visibility`; only `PRIVATE` is private, and a remote not on GitHub is public). In a private repository a security finding is sorted like any other.

In a public repository, a proof of a hole (a test, or steps that show how to use it) is never committed or pushed. Unless the charter's changes line says such fixes may be published, park the finding whole, with its proof in parked.md for the human. Where the charter allows it, sort it to Fix and mark it "no proof in the repository" in findings.md, so its wave's Plan tells the worker to keep the test outside the repository; the proof stays in findings.md.

### The records

findings.md holds every finding with its recipe and its sort, round by round, and the areas that came up clean. parked.md is for the human: each parked item in plain words, where it is, why it was parked and what they would have to decide. Both live in the run folder, never in the repository. Then record the round's counts; park and drop add to the sweep's totals:

```
lcw hunt --fix 151 --park 14 --drop 21
```

Then `lcw set health="Sorted what the hunt found: <what the fixes are about, in a few words>. <what comes next>"`, a sentence or two as above.

Then put to the human, in LCW's box, each parked item that a short answer would settle and that would be small to fix once answered: a yes or no, or a choice between two or three ways. Not every parked item: one that needs a long discussion, a schema or a no-go zone stays in parked.md only. For each:

```
lcw question add Q82 --text "Row 82: registering another account's passkey answers 409. Keep the friendly 409, or answer a generic 422?" --why "A 409 tells the caller the key is registered somewhere else." --a "Answer 422: a small fix in the next wave" --b "Keep the 409: the row is closed as decided" --recommend b
```

Write the question as they would read it cold: the item, what goes wrong, the choice. Each option's text after the colon says what happens if they pick it. `--recommend` names the option you would pick, and the command refuses without it: the box draws that button in pink, so say why it is your pick in `--why` or in the option's own text. The box shows one at a time, adds "Leave it parked" and "Other…", and saves a press without waking you; nothing waits on the answers.

Show the sorted list in the conversation, short: what goes to Fix, area by area; what is parked and why; what is dropped and why; and where parked.md is. Do not wait for an answer: parked items never hold up the rest.

## Waves

If nothing was sorted to Fix, and the round was not an early one, the sweep is over: once every open wave has shipped (stages/ship.md), go to "Ending the sweep" below. An early round that finds nothing does not end it, and a round becomes early, too, when a wave is sent back from Ship while it runs (`lcw status` shows an early round). Record its counts all the same, and once every open wave holds in Ship run `lcw stage Hunt` again, which starts one more round (until then it says the round stands and changes nothing). That round hunts only what the waves changed since this one read the code (Which areas), so the fixes that brought a wave back are hunted, which can add a round. With nothing changed and no finding left to sort, it has nothing to do, and the sweep is over.

The sweep never ends while findings.md holds a finding not yet sorted: a wave's review may have written one in after the round's sorting. Sort it in the round that stands, record the round's counts again with it (`lcw hunt --fix <n> --park <n> --drop <n>`), and a Fix queues a wave like any other; where a wave is already queued, `lcw wave add` refuses: a fix whose files are free joins the front queued wave in findings.md, so that it can start, and the rest are queued once it has.

Otherwise group the fixes into waves of about the charter's size. Within a wave, group the fixes by area, and choose areas that touch different files, so they can be built at the same time. Order the waves so that each touches different files from the wave before it, where the fixes allow, such as a backend wave and then a UI wave: the next wave starts while this one is still being built or reviewed, and takes no fix that needs a file this one changes (stages/plan.md), so two waves in a row on the same files run one after the other. Where two waves must share files, put a wave that shares none between them. After an early round, the first wave takes the fixes that need no file a wave still in review has changed (`lcw wave files` lists them), so it can start at once. Write each wave in findings.md (its number, its fixes by id, its areas), and queue them, one count of fixes for each wave, in the order they will run; this works while earlier waves are still open:

```
lcw wave add 25 25 24 26 25 26
```

Say in a line how many waves are queued and what the first one holds. Then:

```
lcw checkpoint "wave <n>: Plan, read stages/plan.md and start it; <each open wave and where it stands>"
```

and do as it says (SKILL.md, Compaction).

## Ending the sweep

The sweep ends as the charter's stop line says: by default when a round's hunt finds nothing to fix, an early round's aside (Waves, above). A stop line that counts fixes counts what the charter's goals line calls done, which is `fixed` in `lcw status`: a partly fixed fix is not one, so the sweep goes on to find a replacement. It ends short of the count only when a round finds nothing more to fix, and says why. An earlier end the charter names, such as a number of waves or a share of the week (`lcw usage` shows it), is a normal finish, not a stop; Ship sends you here when a wave reaches it. The sweep ends with no wave open: a wave still open is taken through its Ship first, and no queued wave starts. A wave held at merging on the human's answer about its push, and each wave after it at merging, is recorded shipped with no pull request, in order (`lcw wave shipped --wave <n>`), and stays unpushed.

Before you report, settle the pull requests as the charter's PRs line says. Whichever it is, run `lcw status` just before `lcw finish` and keep what it prints, the totals and each wave's pull request: once the run is finished, the session is no longer bound to it.

- **merged as it goes**: this is the last pass, with no next one to try again on. Where the criteria name GitHub's checks, `lcw merge <wave> --wait <minutes>` waits for them, in the background as stages/ship.md says, never a loop of looks; the whole end pass waits at most an hour, not an hour for each wave, so give each wave's `--wait` what is left of the hour. Checks that did not pass, were all skipped, never showed or were still running when its wait ran out are not passed.

  Go through the shipped waves not yet merged, in order (a queued wave never ran and has no pull request), passing over a wave with no commits (`lcw status` shows it empty). For each:
  1. If its push or pull request still waits on the human's answer, it stays open.
  2. If it falls short of any criterion other than the checks, it stays open.
  3. Otherwise `lcw merge <wave>`, where the criteria name checks with `--wait` as above, and act on what it says. Checks that are not passed leave it open; otherwise:
     - **merged**: where the criteria name checks, `gh pr close <number>` and `gh pr reopen <number>` the next pull request, which is now against the default branch and has started none of its checks; then go on to the next wave.
     - **based on another branch**: run the `gh pr edit` command it prints, close and reopen the pull request where the criteria name checks, and go back to step 2 for this wave; if `lcw merge` says so again, it stays open.
     - **not merged yet** (a merge queue, or GitHub waiting on checks): where the criteria name GitHub's checks, wait, within the same hour, with the Monitor tool (loaded first with ToolSearch, `select:Monitor`), an until-loop on `gh pr view <number> -R <repo> --json state` in waits of up to 10 minutes that ends when it shows it merged or GitHub takes it out of the queue, then go back to step 2 for this wave; `lcw merge <wave>` records it once GitHub shows it merged. Otherwise, or if the hour runs out first, it stays open, queued, and the report says so.
     - **gh could not merge**: if the ledger shows it failed so in an earlier pass, it stays open; if not, `lcw ledger "wave <n>: gh could not merge: <gh's words>"` and go back to step 2 for this wave, once.
     - **gh could not read #N**: treat it as gh could not merge.
     - **wave <m> is not merged yet; waves merge in order**: merge wave <m> first; this pass goes in order, so it comes to it first anyway.
     - **merged into another branch**: its changes have not landed and it needs the human; it stays open.

  The first wave that stays open ends the pass: it and every wave after it are left open for the human, each with its reason (gh's words where gh could not merge) for the report. Then `lcw finish`.
- **one at the end**: if any wave shipped with commits (`git rev-list --count <default branch>..lcw/<name>` prints more than 0), push the sweep's branch (`git push -u origin lcw/<name>`), load the `lcw:pull-request` skill and write the one draft pull request for everything as it says, open it against the default branch (`gh pr create --draft --head lcw/<name> --base <default branch> --title "<title>" --body-file <file>`), and `lcw finish --pr <url>`. With no GitHub remote or no way to push, `lcw finish --branch lcw/<name>`, tell the human the work is on `lcw/<name>` and why there is no pull request, and put the text in the conversation, as stages/ship.md says. If none did, there is nothing to open: `lcw finish`, and the report says no pull request was opened because no wave changed anything.
- **stacked**: `lcw finish`.

In stacked or merged as it goes, a wave whose push still waits on the human's answer ends the sweep unpushed, with every wave after it: the report names each as unpushed, and clean-up's checks keep its branches and any worktree still there.

Then clean up as stages/ship.md says under "Afterwards: clean up", for the waves' worktrees still there and the sweep's local branches.

Tell the human, short, from what `lcw status` printed and findings.md (with each question still open in LCW's box, and each answered but never acted on, as `lcw question` lists them; both stay in parked.md, the answer beside it): what was fixed, area by area, not only how many; what was parked and what was dropped; at an earlier end with waves still queued, the fixes queued and not built; which pull requests exist and in what state (open as drafts, merged, or left open, and why); and where parked.md is.
