# Build

You are the orchestrator. Drive the plan to completion on your own, from the run's worktree. You do not build, check or fix anything yourself: workers build, reviewers check, and you brief them, unblock them and decide.

## Launching a milestone

Take the milestones in the order plan.md gives them, one at a time. A milestone's tasks all run in parallel, so launch them together, in one go. Run `lcw usage` first, then `lcw set milestone="<n> of <total>"` (its place among the milestones plan.md gives), so the unfinished-run box can say where the build stands. Then, for each task of the milestone:

1. `lcw task <task> running`.
2. Launch the worker agent with the model and effort chosen for the task (you may change them now), a plain description of the task, and no name. Do not pass `isolation` to the Agent tool. The worker works in the run's worktree, which is its working directory, so it needs no path to change into.

Workers share the run's worktree, and a milestone's tasks own separate files; that is what lets them run together. Start nothing from the next milestone until this one is checked (see Milestones).

A worker never saw the brainstorm, so its brief is all it knows of the intent. Give it:

- what to build and why, in the words of the requirements it serves and anything from the brainstorm that bears on it;
- what done means and how to test it with the tests of its own part;
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

After every report ask: is anything stuck? Is this going well? How can we speed this up: more in parallel, a task split, a cheaper model where a test can check the work? How can we improve this? Act on the answers, and keep health current (`lcw set health="on track, T7 done"`).

A task that has failed twice, or is going round in circles, moves up a tier with what was learned (see models.md); it is not simply retried. A task that cannot be done is parked, `lcw task <task> parked`, with the reason in the ledger; it goes in the pull request.

Unblock workers and settle conflicts between them from the intent: not by asking the human, and not by doing their work for them. Where the intent is silent, earlier runs in this repository show what this human cares about (see "Asking the human" in SKILL.md). Write each decision in the ledger with its reason, and mark the ones the human should check with "check:" so the pull request can list them.

Ask the human only as SKILL.md allows. Only the tasks that depend on the answer wait; the rest carry on. If an answer changes WHAT, update spec.md and tell the workers it affects.

## Milestones

When a milestone's tasks are all done or parked, launch the milestone-reviewer agent, the blind correctness review of the milestone's code, on the model plan.md gives that milestone (effort high). Give it the milestone's tasks with the files each one owns, and how the tests are run, from plan.md, and nothing about the spec or the run's decisions. It reads the code for what would go wrong, runs the tests the milestone touched, checks that each task kept to its own files, and looks for what will not last and for anything over-built. You do not repeat its work.

It has not seen the run's decisions, so it may challenge one. Make the call on each problem, as stages/review.md says under Judging: accept it as it is, with the reason in the ledger, or make it a task for a worker (`lcw task add F1 "<fix>" --model sonnet --effort medium`). Launch the fixes together, and once they are done a fresh milestone-reviewer, on the same model, checks the fixes only: give it the fix tasks with their commits and the files each owns, and how their tests are run. It runs those tests and checks those changes, not the rest of the milestone again. When a check comes back clean: `lcw ledger "milestone <n>: <what works now>"`, then, unless it was the last milestone (see Done), `lcw checkpoint "<the next milestone and its tasks>"` and end your turn. The next milestone starts on a fresh context.

## At the usage mark

When `lcw usage` says `at the mark`, or the launch hook refuses an agent: launch nothing, let the running workers finish, record each task's state, `lcw pause mark`, and end your turn. You are woken when the limit resets: `lcw resume`, `lcw status`, carry on.

## Done

When every task is done or parked and the last milestone's check is clean:

```
lcw stage Review
lcw checkpoint "Review: read stages/review.md and launch the round's reviewers, one for each group of at most four requirements"
```

and end your turn. The review starts on a fresh context.
