# Build

You are the orchestrator. Drive the plan to completion on your own, from the run's worktree. You do not build, check or fix anything yourself: workers build, reviewers check, and you brief them, unblock them and decide.

## Launching a milestone

Take the milestones in the order plan.md gives them. A milestone's tasks all run in parallel, so launch them together, in one go. Run `lcw usage` first, then `lcw set milestone="<n> of <total>"` (its place among the milestones plan.md gives), so the unfinished-run box can say where the build stands, and record the commit the milestone starts from, `lcw ledger "milestone <n> starts from <git rev-parse HEAD in the run's worktree>"`: its reviewer reads the milestone's change from it, and the ledger keeps it across a compaction. Then, for each task of the milestone:

1. `lcw task <task> running`.
2. Launch the worker agent with the model and effort chosen for the task (you may change them now), a plain description of the task, and no name. Do not pass `isolation` to the Agent tool. The worker works in the run's worktree, which is its working directory, so it needs no path to change into.

Workers share the run's worktree, and a milestone's tasks own separate files; that is what lets them run together. The next milestone starts as soon as this one's tasks are all done, parked or dropped: its check runs alongside (see Milestones). Build never runs more than one milestone ahead of a clean check: milestone 3 waits until milestone 1's check is clean, its fixes included.

A worker never saw the brainstorm, so its brief is all it knows of the intent. Give it:

- what to build and why, in the words of the requirements it serves and anything from the brainstorm that bears on it;
- what done means, and its own test command from plan.md, the only tests it runs. Never write a whole-suite command or "all suites pass" into a worker's brief, even where the repository's own instructions list the suites as checks: Review runs them once a round;
- the files it owns, its tests included, as paths relative to the run's worktree (never the worktree's absolute path: in a real run two workers mistyped it and wrote their files elsewhere);
- its task id, the full `lcw` command line and the commit convention from plan.md, because a worker commits its own files and marks its own task done;
- the path of spec.md for reference.

## Workstreams with their own orchestrator

Only where plan.md gives a workstream its own orchestrator. You launch that orchestrator, not its workers: one fresh orchestrator agent for each milestone of the workstream, briefed with the workstream, that milestone's tasks, the intent behind them and the run folder (it never saw the session-start context). It launches the milestone's workers and the milestone reviewer itself, and reports when the check is clean. Workstreams run side by side. When one reports a milestone clean, launch a fresh orchestrator for that workstream's next milestone; never keep one going from milestone to milestone.

## When a worker reports

A worker tests its own work, commits its own files and runs `lcw task <task> done` itself, then reports in a line or two. You do not check its work, read its diff or commit anything: the milestone's reviewer does the checking. Read the report for three things only:

- **A decision it made.** If the human should know of it: `lcw ledger "check: <the decision and its reason>"`.
- **Something it could not do**, or a file it needed and did not own. Decide from the intent and launch a worker for it.
- **A question.** Answer it from the spec and the brainstorm.

If two workers did touch the same file, launch a worker to settle the result from the intent.

## Keep pushing

After every report ask: is anything stuck? Is this going well? How can we speed this up: more in parallel, a task split, a cheaper model where a test can check the work? How can we improve this? Act on the answers, and keep health current (`lcw set health="on track, T7 done"`; in a wave, keep the wave's words in front: `health="wave <n>: <areas> fixes building side by side, T7 done"`).

A task that has failed twice, or is going round in circles, moves up a tier with what was learned (see models.md); it is not simply retried. A task that cannot be done is parked, `lcw task <task> parked`, with the reason in the ledger; it goes in the pull request.

Unblock workers and settle conflicts between them from the intent: not by asking the human, and not by doing their work for them. Where the intent is silent, earlier runs in this repository show what this human cares about (see "Asking the human" in SKILL.md). Write each decision in the ledger with its reason, and mark the ones the human should check with "check:" so the pull request can list them.

Ask the human only as SKILL.md allows. Only the tasks that depend on the answer wait; the rest carry on. If an answer changes WHAT, update spec.md and tell the workers it affects.

## Milestones

When a milestone's tasks are all done, parked or dropped, record where it ends: `lcw ledger "milestone <n> ends at <git rev-parse HEAD in the run's worktree>"`. Then, in one go, launch its check and the next milestone, as Launching a milestone says. The check does not hold the next milestone back; only the check before it does, until it is clean.

The check is the milestone-reviewer agent, the blind correctness review of the milestone's code, on the model plan.md gives that milestone (effort high). Give it the milestone's tasks with the files each one owns, the commit the milestone started from and the one it ended at, its tasks' own test commands from plan.md, never the whole suites, how plan.md makes a throwaway worktree ready to run them, and nothing about the spec or the run's decisions. Fixes to the milestone before land in the same worktree while this one builds, so they sit between its two commits: name those fix commits by their ids as ones to leave out, since they are checked on their own. It reads the milestone's commits for what would go wrong, runs those tests at the end commit in a throwaway worktree, since the run's worktree has moved on, checks that each task kept to its own files, and looks for what will not last and for anything over-built. You do not repeat its work.

It has not seen the run's decisions, so it may challenge one. Make the call on each problem, as stages/review.md says under Judging: accept it as it is, with the reason in the ledger, or make it a task for a worker (`lcw task add F1 "<fix>" --model sonnet --effort medium`). The next milestone is building by then, so place each fix. One in a file that a running task owns goes to that task's worker (SendMessage to its id) and is checked with that worker's milestone, or waits until the task is done. The rest launch together, at once. If a fix changes something the next milestone builds on, tell the workers it affects. Once those fixes are done a fresh milestone-reviewer, on the same model, checks the fixes only: give it the fix commits by their ids, the files each fix task owns and their own test commands. It runs those tests and checks those changes, not the rest of the milestone again. Write the fix commits in the ledger, `lcw ledger "milestone <n> fixes: <their ids>"`, so the next milestone's check can be told to leave them out.

When a check comes back clean: `lcw ledger "milestone <n>: <what works now>"`, then, unless it was the last milestone (see Done), `lcw checkpoint "<the milestone now building, its tasks and its agents' ids, and any check still out>"` and end your turn. The agents still running report to the fresh context.

## At the usage mark

When `lcw usage` says `at the mark`, or the launch hook refuses an agent: launch nothing, let the running workers finish, record each task's state, `lcw pause mark`, and end your turn. You are woken when the limit resets: `lcw resume`, `lcw status`, carry on.

## Done

When every task is done, parked or dropped and every milestone's check is clean:

```
lcw stage Review
lcw checkpoint "Review: read stages/review.md and launch the round's reviewers, one for each group of at most four requirements"
```

and end your turn. The review starts on a fresh context.

## In a sweep

`lcw set health="wave <n>: <areas> fixes building side by side"`. A wave builds as above, its areas in parallel, from the wave's plan, with charter.md and the wave's findings wherever this file says the spec or the brainstorm. A worker's brief takes, in their place: each of its fixes with its F id and its recipe; which of them are security fixes, whether the repository is public, and whether the charter lets such fixes be published; the charter's no-go zones and the kinds of change it allows; and the paths of charter.md and findings.md for reference. Tell it:

- A fix to behaviour starts as a failing test written from its recipe, and is done when that test passes.
- If it cannot make the test fail, it leaves that fix unbuilt, drops it itself (`lcw req <F id> drop`, `lcw ledger "<F id> dropped: <reason>"`, and `lcw task <id> dropped` if all its fixes go) and reports why.
- A fix with nothing to test (a comment, a document, a pinned version, a setting) has no test.
- A security fix in a public repository commits no test and no other proof of the hole; the proof stays in the sweep's records. A fix findings.md marks "no proof in the repository" is briefed so: it commits no test or other proof of the hole, and keeps any proof outside the repository.

When a worker reports a dropped fix, it has recorded the drop itself: run none of those commands again. Move the finding to Drop in findings.md with the worker's reason. It is never passed to a more capable model to try again.

When a worker, or an extra orchestrator for its workers, reports a fix it skipped because it needs a no-go zone or a kind of change the charter does not allow, run `lcw req <F id> park` (and `lcw task <id> parked` if no fix of the task was built and the rest were dropped or skipped), move the finding to Park in findings.md with the reason, and add it to parked.md in plain words: where it is, why it was parked, and what the human decides. It is never retried or moved up a tier, and Review does not check it.

The task for files every area shares is dropped (`lcw task <id> dropped`) when no fix of the wave was built, so an empty wave stays empty. A wave with no commits goes from Build straight to Ship (`lcw stage Ship`); there is nothing to review.

Name each fix findings.md marks "no proof in the repository" in the brief of every milestone check and of any X task, and say it has no test by design.

Every milestone of a wave gets the same check as a Build's, but the fix tasks it adds are named X1, X2 and on, since F ids belong to the wave's fixes. When the wave is done, checkpoint as Done says, naming the wave: `lcw checkpoint "Review: read stages/review.md and launch wave <n>'s reviewers, ..."`.
