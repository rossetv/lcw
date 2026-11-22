# Plan

You decide HOW. Do not ask the human: they care that what they asked for gets built, not how. Plan the simplest build that meets the spec: no layer, abstraction, option or dependency that the spec does not need today.

`lcw set health="planning the build"` (a sweep sets its own words instead, below). Read map.md in the run folder: the probes launched during Spec mapped the code there. Launch more only for what it leaves open. The map covers the code the change touches, how it is built and tested, where the seams are, how the repository writes its commits, and which checks it asks for before a pull request (lint, type checks, formatting, or a list in a contributing guide, CLAUDE.md or a gates file).

## Tasks

Split the spec into tasks. A good task is something one worker can build and test on its own, with a clear edge: the files it owns, its tests included. Give each task its own test command: the one that runs the test files it owns, by name, and nothing wider. Where the repository's runner cannot run less than a whole suite, that suite is the task's command. A task with nothing to test, such as a document or a skill's text, has no test command: write "none". It does not run the suites instead.

Give each milestone a check command as well: the existing unit tests of the packages or folders its tasks change, the fast ones the repository can run one package at a time, never integration or end-to-end tests or the whole repository's suites, and, where the repository has a linter, that linter on the same packages or folders. The milestone's check runs it once, so a unit test the change breaks elsewhere in a package it touched shows up in Build, not in Review's full run.

Group the tasks into milestones. A milestone is a set of tasks that all run in parallel: none of them needs another's result, and each owns its own files, because workers share the run's worktree. A task that needs another task's result, or a file another task owns, goes in a later milestone. Milestones start one after another: when a milestone's tasks are done its milestone reviewer checks it, and the next milestone starts at once, while that check runs. A workstream under its own orchestrator does not overlap: each of its milestones is checked before the next starts. So lay the work out in as few milestones as its dependencies allow, each as wide as it can be, up to about ten tasks; split a wider one in two.

For each task choose a model and an effort from models.md: as cheap as its difficulty allows when a test can check it, senior when nothing can.

Each milestone ends with its milestone check, the blind correctness review of its code. Choose its model too: Opus where the milestone's code is risky or hard to judge (money, data that could be lost, security, two things at once, anything that stops, wakes or runs on its own, little that a test pins down), Sonnet where it is plain and well tested. When unsure, Opus.

## Shape

One orchestrator, you, with its workers, unless there is a stated reason for more: for example workstreams so large and separate that one context cannot hold them. Then each workstream gets the orchestrator agent, with its own workers, under you: a fresh one for each of the workstream's milestones, so that each starts on a clean context, as you do after a checkpoint. Use as many layers as the work needs, no more. No orchestrator writes or reviews code, you included. Agents can be three levels deep below this session by default: orchestrator, workers, their probes.

## Commit convention

Decide how this run's commits will be written, from the repository's history (`git log`) and any contributing guide. Where the repository has a consistent convention, follow it exactly: its format, tense, capitals, scopes and language. Where it has none (a new repository, or mixed styles), use Conventional Commits: `<type>(<scope>): <description>`, the description in the imperative, lower case, with no full stop; the types are feat, fix, refactor, perf, style, test, docs, build, ops and chore; a breaking change adds `!` after the type and a `BREAKING CHANGE:` footer. Either way, one logical change per commit, and the message says what changed, not which task or agent produced it. No message carries AI attribution (no `Co-Authored-By` trailer and no "Generated with Claude Code" line) or names anything local: no local path (~/.lcw, the run folder, the ledger, a scratch file) and no pointer to what only this machine holds, such as "see the ledger".

## Details left to Claude

Decide each detail brainstorm.md leaves to Claude, choosing what serves the intent, and record each: `lcw ledger "check: <the decision and why>"`. Put each in the brief of the task it touches.

## Review groups

Split the requirements into the groups Review will check, by area, three or four to a group and never more than four. Give each group a model for its reviewer: Opus where a miss would be costly or hard to see (money, data that could be lost, security, anything that stops, wakes or runs on its own, behaviour no test covers); Sonnet where tests cover it and checking it is plain reading (a message, a document, a rule a test pins). When unsure, Opus.

## Approved examples

If the spec lists approved examples, decide how Review will reach each of their states in the real thing: the repository's own way of running it with sample data where it has one (an end-to-end harness, a mock server, fixtures, a command with sample input), the window size a mock shows, and the steps that reach the state. Where a state needs sample data that does not exist yet, adding it is part of a task. A state that cannot be reached on this machine, because it needs a live service, a real account or a real failure, is marked "not compared", with why; the pull request will say so.

## Write plan.md

In the run folder: the shape and the reason for it; the milestones in order, each with its tasks (id, title, the files it owns, its own test command, which requirements it serves, model, effort), the model of its milestone check and its check command; the commit convention, with one example message; and how the whole will be tested on the run branch, which Review does once a round and nobody else does: each test suite on its own (for example backend and frontend), with its command and the code it covers; the repository's own checks before a pull request, each with its command; how a throwaway worktree is made ready to run tests (an install step, files git ignores that the tests need); the review groups, each with its requirements and its reviewer's model; and, if the spec lists approved examples, how each state is reached. Then record it:

```
lcw task add T1 "<title>" --model sonnet --effort medium
lcw set plan.tasks=20 plan.atOnce=6 'plan.models={"Sonnet":14,"Opus":4,"Haiku":2}'
lcw ledger "shape: one orchestrator, <reason>"
```

## Enter the run's worktree

`lcw worktree` creates the branch `lcw/<name>` and its worktree, and prints the path. This skill is your instruction to work in a worktree: call EnterWorktree with `path` set to that path. All build work happens there, so the main checkout and any other run stay untouched.

Then:

```
lcw stage Build
lcw checkpoint "Build: read stages/build.md and launch milestone 1, all its tasks together: T1, T2, ..."
```

and do as it says (SKILL.md, Compaction).

## In a sweep

A wave has no brainstorm, spec or map.md: its Fix items in findings.md stand in for the spec, and each recipe is a requirement. The rest of this file holds, but in this order:

1. See whether the next queued wave may start. It starts once the wave before it is built (in Review, or further) and fewer than two waves are in Plan, Build or Review; a wave holding in Ship does not count. Until both hold it waits, and `lcw wave start` refuses. Before the first wave, `lcw worktree`: in a sweep it makes only the sweep's branch `lcw/<name>`. The session stays in the main checkout, and never calls EnterWorktree in a sweep.
2. `lcw wave files` lists the files the open waves have changed. The new wave takes no fix that needs one of them (the files its recipe names). If none of the front queued wave's fixes is free of them, it waits until one is, and you start nothing. The backlog file every wave's closures edit is not covered by this rule: a later wave settles it when it takes in the wave before (stages/review.md).
3. `lcw wave start`. It puts the wave and the run in Plan, cuts the wave's branch `lcw/<name>-wave-<n>` from the open wave before it (or from `lcw/<name>`), so the wave builds on every earlier one, makes the wave's own worktree, and prints the worktree, the path of the wave's plan, waves/<n>/plan.md, and the files list again. Move each of the wave's fixes that needs a listed file to the next wave in findings.md, then `lcw wave defer <k> --wave <n>` for the k of them.
4. Read the answers to the sweep's questions (`lcw question`). One that makes an item fixable is a finding sorted to Fix, in findings.md, and joins this wave like the others; one that keeps things as they are closes the item as decided, with their answer, with the wave's closures; either way, take it out of parked.md, so they do not read again what they settled. "Leave it parked" leaves it there. When the human typed their own answer instead ("Other…", which reaches you as their prompt "Your call on Q82: ..."), record it first with `lcw question Q82 answer "<their words>"`. Then `lcw question <id> used` for each one acted on.
5. `lcw set health="planning wave <n>: <its areas>"`, with the other open waves' words, as SKILL.md says. Make each of the wave's fixes a requirement under the id findings.md gave it, which is new across the whole sweep, so a wave's ids do not start at F1: `lcw req add F<id> "<recipe in a line>" --wave <n>`. Launch probes only for what the recipes leave open, and name the wave's worktree in their briefs.
6. Write the wave's plan as "Write plan.md" says, with the F id beside each finding, and, beside a fix findings.md marks "no proof in the repository", the order to commit no test or other proof of the hole and to keep it outside the repository. One task for each area, the areas touching different files, all in the first milestone; generated files every area changes are changed by one task in a milestone after the fixes. The backlog's closures are no task of the plan: they are written once the wave's review has passed (stages/review.md). A charter's lines settle what a brainstorm would have; the first wave's plan sets the commit convention and later waves keep it. There are no approved examples.
7. Record the tasks as above, with `--wave <n>` on each command, then:

```
lcw stage Build --wave <n>
lcw checkpoint "wave <n>: Build, read stages/build.md and launch its milestone 1, all its tasks together: T1, T2, ...; <each other open wave and where it stands>"
```

and do as it says (SKILL.md, Compaction). In the stages that follow, plan.md means the wave's plan, and the run's worktree means the wave's.
