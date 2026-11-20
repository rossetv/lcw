# Plan

You decide HOW. Do not ask the human: they care that what they asked for gets built, not how. Plan the simplest build that meets the spec: no layer, abstraction, option or dependency that the spec does not need today.

`lcw set health="planning the build"`. Read map.md in the run folder: the probes launched during Spec mapped the code there. Launch more only for what it leaves open. The map covers the code the change touches, how it is built and tested, where the seams are, how the repository writes its commits, and which checks it asks for before a pull request (lint, type checks, formatting, or a list in a contributing guide, CLAUDE.md or a gates file).

## Tasks

Split the spec into tasks. A good task is something one worker can build and test on its own, with a clear edge: the files it owns, its tests included.

Group the tasks into milestones. A milestone is a set of tasks that all run in parallel: none of them needs another's result, and each owns its own files, because workers share the run's worktree. A task that needs another task's result, or a file another task owns, goes in a later milestone. Milestones run one after another: when a milestone's tasks are done a milestone reviewer checks it and you checkpoint, and only then does the next one start. So lay the work out in as few milestones as its dependencies allow, each as wide as it can be, up to about ten tasks; split a wider one in two.

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

In the run folder: the shape and the reason for it; the milestones in order, each with its tasks (id, title, the files it owns, which requirements it serves, model, effort) and the model of its milestone check; the commit convention, with one example message; and how the whole will be tested on the run branch: each test suite on its own (for example backend and frontend), with its command and the code it covers; the repository's own checks before a pull request, each with its command; the review groups, each with its requirements and its reviewer's model; and, if the spec lists approved examples, how each state is reached. Then record it:

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

and end your turn.
