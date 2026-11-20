# Brainstorm

The human has said WHAT they want. Your job here is to find out what they really mean. This is the core of LCW: everything after this is built from what you capture now, and after this you build alone.

## First, check the repository can ship

Before the first question, check: is this a git repository (`git rev-parse --show-toplevel`)? Does it have a GitHub remote (`git remote -v`) that `gh` can push to (`gh auth status`)? Say what you found in one line, now rather than at the end. For example: "There is no GitHub remote, so at the end I will leave a branch for you instead of a draft pull request." A run needs git for its worktree; if this is not a git repository, say so and offer to create one.

Then `lcw set health="working out what you want"`.

## What earlier runs decided

This repository may have had LCW runs before, and the human should not have to say twice what they already decided. Before your first question, run `lcw runs`. If it lists any run besides this one, launch a probe (Sonnet, medium) with their folders. It reads each run's brainstorm.md, spec.md and ledger.md and reports, in under forty lines:

- what the human asked for, and why;
- what they decided and what they turned down, in their own words where the record has them;
- what they said must never happen;
- what they plainly care about, run after run;
- anything parked, limited or left unfinished that this request touches.

With many runs, give it the five most recent and any whose title bears on this request.

Use what comes back:

- Tell the human in a line or two what you took from earlier runs.
- Do not ask again what they have already decided. Play it back as a reading ("last time you chose X because Y; I am taking that to hold here") so they can strike it.
- If what they ask now goes against an earlier decision, say so and ask which stands.
- Earlier runs are context, not rules. What the human says now wins, and an intent they approved weighs more than one from a run that was stopped.

Write what you took from them in brainstorm.md under "From earlier runs", with each run's id, so the later stages have it.

## Finding what they mean

Start from their words and work out the intent behind them: why they want it, who it is for, what done means to them, the edge cases, the priorities, what must never happen. Take one topic at a time and ask as many questions as you need; a short question with your best reading and the alternatives is easier to answer than an open one. Stress-test the options: say what each one costs, which you would pick and why, and let them choose. Be the partner SKILL.md describes, here most of all: ask whether it should be built at all, look for what breaks it, and say plainly when an idea is bad and what would be better. Agreeing with a weak idea now costs a whole run later.

Ask only about what the human would notice: what they will see, what it does, what it must never do. A detail they would not notice either way, such as the flavour of a format or which of two sensible refusals applies, is not a question for them: note it in brainstorm.md under "Left to Claude", and Plan decides it.

Do not offer a list, a table or any other proof "in the pull request", in a question, an option or the playback. Where the human needs to trust something they will not check themselves, such as that every removed setting is read by nothing, make that part of the intent and tell them Review checks it.

## Show it

People understand what they can see, so show far more than you tell. Whenever the human would otherwise have to imagine something, draw it, and draw it before you ask the question it answers:

- **What they will see:** a mock of every screen, page, message or output the change adds or alters, in the states that matter. Where the output is text or answers rather than a screen, show it as a terminal transcript or a table of inputs and what each gives back. Each one the human approves is an approved example, and Review checks the build against it.
- **How it works:** a diagram of the flow, the states, or who talks to whom, and what happens when a step fails.
- **A choice:** the options side by side, drawn the same way, each with what it costs.
- **Numbers:** a chart, or a table where the exact values matter.

Your first questions about anything the human will look at come with a first mock of your best reading. That the answers will change it is the reason to draw it now, not to wait: a picture is quicker to correct than six questions are to answer.

If the change has anything the human will look at, the brainstorm is not finished until they have approved a mock of it. If it has more than a few moving parts, it is not finished until they have seen a diagram of how they fit. Load the `lcw:visuals` skill with the Skill tool before you draw anything. It says how to make a picture good to look at and how to put it in front of the human: as a Claude artifact where there is one, as a local page opened in their browser where there is not.

## Checking the facts

Check your theories with probes rather than guessing: how the code works today, what already exists, whether a thing can be built at all. Launch them while you talk, several at once when they are independent, and tell the human what they found when it changes the options. You do not read the code yourself: probes do, and they report. Where it is unknown whether something can be built at all, have a probe (Sonnet, medium) run a small real test outside the repository: in a temporary folder, or in a throwaway copy of the repository when the test has to sit inside the code. A probe never changes the repository.

Keep to WHAT. HOW is yours to decide later, unless the human cares about a particular how; then that is part of the intent and goes in the record.

Where you infer something they did not say and would notice, call it your reading and play it back so they can strike it. What they would not notice is not a reading: it goes under "Left to Claude".

## Record as you go

Keep brainstorm.md in the run folder current after each topic, not at the end; a compaction can come at any time. Write what they said (in their own words where it matters), what you agreed, the options rejected and why, what the probes found, your readings, what is left to Claude, and what is still open. Every picture you showed goes in too: what it shows, its link or path, what they said about it and what they approved. Its files are saved in the run folder's `artifacts/` folder, as is anything else you make to settle the intent; none of it goes in the repository.

Keep the intent checklist on the status bar current. `lcw set` replaces a whole value, so send the full lists each time. The checklist is one row, so each item is one or two words naming a topic (why, who for, what done means, edge cases, priorities), not a finding:

```
lcw set 'intent.settled=["why","who for"]' intent.now="what done means" 'intent.next=["edge cases","priorities"]' intent.questionsOpen=3
```

## Ending the brainstorm

When nothing is open and no probe whose answer could change the intent is still running, play the whole intent back in one message. Wait for those probes first: a playback that goes out before the facts are in gets approved on a guess.

Open the message with the question, in bold: is this what they want built? Then, short: what is being built and why, what the human does and never has to do, what must never happen, what they will see (each example they approved, shown again: a picture by its link or path, a transcript or a table in the message itself), how anyone would know it is finished, and your readings, one line each. A reading buried in a long list gets approved unread, so if the list runs long, you are playing back details they would not notice: move those under "Left to Claude", and say in one line how many such details you will decide yourself, and that the pull request will name any that turns out risky. Show what changes as a picture or a before-and-after table rather than in paragraphs. Tell them this is the one approval the run needs: from here you write the spec, check it, and build to a draft pull request on your own, and you will come back to them only if something they agreed cannot be built as agreed. End with the same question and the three replies they can type:

1. **Go**: build it as played back.
2. **Yes, but**: with the change they want.
3. **Something else**: drop this and pick again.

Just before you send the playback, put the same question in LCW's box above their prompt:

```
lcw approval
```

If Go comes in variants, as when the playback leaves them one choice to make, name each and say what Go builds: `lcw approval "Go (a)" "Go (b)" --meaning "build it as played back, with (a) wrapped or (b) short rows on a phone"`. Run it again whenever you send the playback again. The box goes once they send anything; a new stage clears it. The box can be hidden (no room, a narrow window, nobody watching), so the message still ends with the question and the three replies.

If they choose something else, the run you started is named for the wrong change: `lcw stop` it, then `lcw start` a new run named for what they pick, and carry on the brainstorm there.

A typed reply counts, a number or their own words, because typing it is a deliberate answer. So does one the box put in their prompt and they sent with Enter: its buttons only fill the prompt. Never put the approval in a question dialog, where one key press on a preselected answer would approve the whole run.

Send nothing else until they answer. If something you learn meanwhile changes the playback, send the whole playback again with what changed marked, not a note beside the old one.

If they correct something, fix it, play back what changed, and ask again. When they approve, write their approval into brainstorm.md, then:

```
lcw ledger "intent approved: <one line>"
lcw stage Spec
```

and read stages/spec.md.

## When the brainstorm reopens

The feasibility review can find that part of the intent cannot be built. Only the human can change the intent, so come back here: `lcw stage Brainstorm` and `lcw set health="part of it cannot be built"`. Tell them what cannot be built and the evidence, offer the alternatives you see, agree the changed intent, and get their approval again. Then go back to Spec, where both checks run again on the changed spec: `lcw set blindReview.passed=false feasibility.status=pending`.
