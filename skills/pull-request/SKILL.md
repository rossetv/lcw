---
name: pull-request
description: How to write the draft pull request that ends an LCW run - What, Why, How and Scope, in that order, each short, with pictures that mark what is new and play how it works. Load before writing a pull request's title or text in an LCW run.
user-invocable: false
---

# The pull request

The human comes back to this page after hours away. It has to convince them of four things:

| They ask | What answers it |
|---|---|
| Did Claude understand what I asked for? | Scope, which shows what they approved |
| Is this the right thing to build? | What and Why |
| Does it look the way I wanted? | the What picture |
| Does it behave correctly? | the How picture |

Nobody reviews the code from this page: Review has done that. And a noisy page is not read at all. So keep a line, or a part of a picture, only if it helps them answer one of the four. They should have their answers in a minute, and mostly from the pictures.

## The title

One clause that names the main change, in the run's commit convention, short enough for a commit's first line (72 characters). When the change does several things, the title names the one that matters most to the human, the first of its goals, and the text carries the rest. A repository that squashes its pull requests makes the title the commit message.

## The order

Four sections, with these headings, in this order. Never another order, nothing above them, and nothing after them but Check.

- **What**: what the person gets, as they meet it: what they will see and what it now does. Two or three sentences in their words, not the code's. How it works is not said here. Then a picture of it.
- **Why**: the problem it solves and for whom, from the brainstorm. Two or three sentences. Not the story of the run.
- **How**: a diagram of how it works, then at most three lines the human would act on: a choice that shaped it, a limit, something that now behaves differently. Then one line on how it was checked.
- **Scope**: what was agreed before anything was built, as one brief table.

After them, a closing section, **Check**, only when something earns it. It holds a decision made during the run that is risky, or that the human might regret once they find it, each with its reason. It also holds a part of what was agreed that was not built as agreed: a parked task, or a build that differs from an approved example, with why.

Nothing else goes in. A sensible choice the human would most likely have made too stays in the run's records, however much thought it took, and so does a choice that errs on the safe side, such as a figure that can read low but never high: that is a sound trade-off, not a risk. So does what was never run for real, a sound trade-off explained, how a figure behaves at an edge, the wording of messages, flags and argument handling, layout fallbacks, rare edge cases, a platform or version it was not run on, tests already broken before the run, nits, and how the agents worked. Write each line as a plain sentence, the way a colleague would mention it in review: what it is and why, in as few words as that takes. No bold labels such as "Decided for you:" or "Not tried for real:", and nothing that makes the change sound as if no person had a hand in it. No `<details>` blocks, and no line pointing to the ledger. When nothing qualifies, which is the usual case, leave the section out.

## Scope

One table, three columns, copied from what the human approved:

```
| Goals | Non-goals | Anti-goals |
|---|---|---|
| <what it is for> | <what it does not attempt> | <what must never happen> |
```

In a Build they are the spec's "What matters most", "What it does not attempt" and "What must never happen"; in a sweep, the charter's goals, non-goals and anti-goals. A few words in each cell, in the words they approved, and at most four rows: where more were agreed, keep the ones they would most want to see kept. Each column is its own list, so a row pairs nothing. Where an anti-goal only says a goal the other way round, keep the goal and leave it out. Never a line they did not approve, never a result, a proof or a record of the work. A column with nothing agreed stays empty.

## Short

What, Why and How together, with How's lines and its "Checked by", stay under 150 words, and the table under 70; the pictures carry the rest. No greeting, no summary at the end, no list of files (the diff has it), no account of what the agents did, no AI attribution (no "Generated with Claude Code" line or anything like it), and nothing a reader cannot open: no local path (~/.lcw, the run folder, the ledger, a scratch file) and no pointer to what only this machine holds, such as "see the ledger". The product's own words are not this: a message it shows that names a path is drawn as it is. No requirement, task or fix id (R3, T7, F1) either. And nothing only a code reviewer would want: no name of a file, a function, a hook or a test in the text. Write as the `lcw:docs` skill says.

The pull request holds no record of the run's work: no list or table of each thing removed, renamed or measured, as a section or in a `<details>` block, even where the spec says the pull request lists it. Say what the record shows in one line of How, such as "41 settings are removed, each one read by nothing". Review checked the record itself, so the pull request neither repeats it nor points to it.

## In a sweep

A sweep's pull request covers fixes, not one change, so its What is the list of what it fixes, and that list is the one exception to the rule above. Under What, one sentence on what this pull request's fixes are about, then its picture where it has one, then a `### <area>` heading for each area, and under it one line for each fix: what was wrong, as the person it hurt meets it, and what it does now. No line says how it is proven and none names a test. One sentence under How says it for all of them, such as "Every fix has its own test, seen failing before the fix", with the count of any proven another way. In a public repository a security fix's line names the fix, never how to use the hole. The list does not count toward the 150 words, but GitHub refuses a pull request's text over 65,536 characters: if the list would pass it, shorten each line to what was fixed. Why says what the sweep was for, from the charter. How has its diagram only where a fix changes how the parts fit together, and What has no picture unless a fix changes what a person sees.

What the pull request covers follows the charter's choice:

- **Stacked:** one for each wave, holding that wave's fixes only. Its first line, the one thing above What, says it is to be merged in order, after the wave before it, with a merge commit, and its branch deleted once merged so the next one retargets to the default branch.
- **Merged as it goes:** one for each wave, holding that wave's fixes only.
- **One at the end:** one for every wave that shipped.

Where each wave has its own pull request, only the first carries Scope: the same table on every one of them is noise.

## The pictures

What and How each have one. A reader should get the change from the two pictures alone, so they are not thinned out: a picture may hold whole sentences and every state that matters. It is the text that has to be short.

- **What** shows the thing as the person meets it: the screen, the output or the message, as built, in one copy: never a before beside it. Start from the picture the human approved in the brainstorm. Where Review compared the build with an approved mock, the What picture is made from its built captures in `artifacts/compare/`, not redrawn: the built state alone, cropped to the part of the screen the change touches, never the approved one beside it. A capture goes inside the SVG as an embedded image (data URI), because GitHub shows the SVG as an image and loads nothing from outside it. With several states, show each one that matters under its own short heading, the usual one first and what they see when it goes wrong after it. Where the change shows the person nothing new, draw what they get instead: the screen as it still is, the gain beside it as a timeline or a figure, and what they see when it fails. For a transcript or a table of answers, draw the built text, from the captures. Where the build differs from what was approved, Check says so in words.
- **How** shows the parts and what moves between them, and the path taken when a step fails. Each box names who acts and says in a sentence or two what it does, in plain words. At most nine boxes, and every arrow says what moves along it.

Three things hold for both, and the `lcw:visuals` skill says how to do each:

- **They mark what is new.** The human must not be left judging what was already there. What this change adds is filled blue and labelled "new", what it alters is outlined blue and labelled "changed", and what already existed is grey with no label.
- **They play.** Wherever something moves or happens over time, the picture is animated: the How picture plays its flow as a few named stories (the usual case, the case this change is about, the failure), and the What picture plays what the person would watch happen.
- **Nothing is out of place.** No text touches or crosses its box, no two labels overlap, no arrow starts in the air. Looking does not catch these: the check does.

You do not draw them: a worker does, from your brief. Write one brief for the two pictures. For each, say exactly what it must show, with the real names, values and wording of this change. For What, name the file in `artifacts/` of the picture the human approved in the brainstorm, to start from, and the captures in `artifacts/compare/` where there are any. For How, list the parts, say of each whether it is new, changed or was already there, say what moves between them, and name the stories its animation tells. Check every fact in the brief against the spec before you send it: the worker draws what the brief says, and nothing later compares the picture with the spec. Put the list below in the brief too, since the worker loads the visuals skill and not this one. Launch one worker for both (Opus, high: only a person's eye can check a picture) and tell it to load the `lcw:visuals` skill before it draws anything.

The worker saves each picture as one SVG file in the run folder's `artifacts/`, with PNGs of it beside it, light and dark, and for an animated one stopped at a moment inside each story:

- at most 830 wide, with no text under 12px at that width;
- its own background, GitHub's greys and one blue in a light and a dark palette inside the file (`prefers-color-scheme`), and the system's fonts, because GitHub shows it as an image that takes neither the page's colours nor its fonts;
- real content from this change, never placeholders;
- passing the visuals skill's check, which from this skill's folder is `node ../visuals/picture.mjs check <file.svg>`.

Then look at the PNGs once yourself, and run that check yourself. A picture passes when the check finds nothing to fix, it shows what your brief said, and a person would get it at a glance. If one does not, send it back once and say what is wrong. A picture that fails the check never goes in the pull request.

## Putting them in the pull request

```
lcw pictures <run folder>/artifacts/what.svg <run folder>/artifacts/how.svg
```

It pushes the files to the repository on a ref outside every branch, so they are not part of the change and are as private as the repository, and prints a URL for each. Put each in the text as an image, with words for someone who cannot see it:

```
<img src="<url>" width="830" alt="<what the picture shows, in a sentence>">
```

A picture goes nowhere else: not a gist, not an artifact, not an image host. If `lcw pictures` fails, draw the How diagram as a `mermaid` block, which GitHub draws itself, say in words what the What picture would have shown, and tell the human in the conversation, not in the pull request, where the files are.

## The shape

```
## What

<two or three sentences: what the person gets>

<img src="..." width="830" alt="...">

## Why

<two or three sentences>

## How

<img src="..." width="830" alt="...">

- <what the human would act on, at most three lines>

Checked by <the tests and the review, in one line>.

## Scope

| Goals | Non-goals | Anti-goals |
|---|---|---|
| <a few words> | <a few words> | <a few words> |

## Check

- <a risky decision, or one the human might regret, and its reason, in a plain sentence; the section only when there is one>
```

## Before you open it

Read it as the human, cold: after one minute, could they answer the four questions? Is there a line only a code reviewer would want? Would they want to know every line of Check before merging? Is every claim true today? Then open it.
