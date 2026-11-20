# Spec

The spec is the agreed intent translated into a document that agents who were never in the brainstorm can build from. It says WHAT, never HOW: no code, and no file names, functions or schemas unless the human made them part of the intent.

## Write it

`lcw set health="writing the spec"`. Write spec.md in the run folder from brainstorm.md. A shape that works: what this is and why; what matters most; numbered requirements (R1, R2, ...), each one something a reviewer can check; scenarios that show it working; what must never happen; known limits; and the readings the human approved in the playback. The details brainstorm.md leaves to Claude are not requirements: leave them out, since Plan decides them. Where an approved mock or diagram carries part of the intent, say in words what it shows and name its file in the `artifacts/` folder: the blind reviewer gets only this text, so a spec that leans on a picture it cannot see has said it badly. For each approved example (a mock, a terminal transcript, a table of answers), list its states by name (for example "empty", "three uploads", "disk full"), each with its file in `artifacts/`: Review compares the built thing with each one. Then `lcw set spec.requirements=<n> spec.scenarios=<n>`.

## Blind review

Launch the probes stages/plan.md asks for to map the code at the same time as the blind reviewer: they need only the brainstorm, not the spec's final wording, and Plan then starts with its map ready. As each reports, add its answer, with its sources, to map.md in the run folder.

Launch the blind-reviewer agent with the full text of spec.md in its prompt and nothing else: no brainstorm, no summary, no hint of what you hope it finds. Describe it as "Read the spec cold and explain it back". Record it: `lcw set health="a blind reviewer is explaining the spec back" 'blindReview.now={"reviewer":1}'`.

Then judge, holding the whole brainstorm: does its explanation match what the human meant? The review passes when it does. Judge by the explanation, not by the doubts. A fresh reviewer always lists doubts, and treating them as the test becomes an endless nitpick loop. The doubts are advice: act only on one whose two readings would make a builder build different things, where the spec does not decide between them.

If the explanation misses or misstates the intent, the spec said it badly: fix the spec there, and give the new text to a new blind reviewer, never one that has read an earlier version. Record each round; `lcw set` replaces the whole list:

```
lcw set 'blindReview.done=[{"reviewer":1,"caught":"row cap fixed"}]' 'blindReview.now={"reviewer":2}'
```

When a review passes: `lcw set blindReview.passed=true blindReview.now=null`.

## Feasibility review

Launch a fresh feasibility-reviewer agent; it must not be the one that wrote the spec. Give it the path of spec.md and of the repository, and the facts the brainstorm's probes established, copied from brainstorm.md with their sources, as evidence it may take as given so it does not prove them again. Ask for a verdict on every requirement. `lcw set feasibility.status=running health="checking it can be built"`.

Each requirement gets one of four verdicts:

- **can**: nothing to do.
- **can with a limit**, or **could not test**: write it into the spec's known limits, in plain words.
- **cannot**: if the spec asks for more than the intent does, the spec said it badly; fix it and review again. If the intent itself cannot be built, only the human can change it: `lcw set feasibility.status=cannot` and go back to stages/brainstorm.md, "When the brainstorm reopens".

Judge its reasons as you judged the blind review: a reason counts only if it is real. A limit written in does not need another blind review, unless it changes what is being built.

When it passes: `lcw set feasibility.status=passed feasibility.limits=<n>`. The status bar has no place for this, so tell the human in the conversation: it passed, with one line per limit.

## Approved

Both checks passed, so the spec is approved; the human does not sign it off. Record the requirements for Review, one per requirement:

```
lcw req add R1 "<short name>"
```

Then:

```
lcw ledger "spec approved: blind review passed on round <n>, feasibility passed with <n> limits"
lcw stage Plan
lcw checkpoint "Plan: read stages/plan.md and split spec.md into tasks"
```

and end your turn.
