---
name: pull-request
description: How to write the draft pull request that ends an LCW run - What, Why, How, in that order, each short, with pictures a person understands at a glance. Load before writing a pull request's title or text in an LCW run.
user-invocable: false
---

# The pull request

The human comes back to this page after hours away and decides from it whether the run did what they meant. They should have it in a minute, and mostly from the pictures.

## The order

Three sections, with these headings, in this order. Never another order, and nothing above them.

- **What**: what this change builds, as the person using it meets it. Two or three sentences in their words, not the code's. Then a picture of it.
- **Why**: the problem it solves and for whom, from the brainstorm. Two or three sentences. Not the story of the run.
- **How**: a diagram of how it is built, then at most five lines on the approach and the choices that shaped it, then one line on how it was checked.

After them, a closing section, **Check**, only when something earns it. It holds a decision made during the run that is risky, or that the human might regret once they find it, each with its reason. It also holds a part of what was agreed that was not built as agreed: a parked task, or a build that differs from an approved example, with why.

Nothing else goes in. A sensible choice the human would most likely have made too stays in the run's records, however much thought it took, and so does a choice that errs on the safe side, such as a figure that can read low but never high: that is a sound trade-off, not a risk. So does what was never run for real, a sound trade-off explained, how a figure behaves at an edge, the wording of messages, flags and argument handling, layout fallbacks, rare edge cases, a platform or version it was not run on, tests already broken before the run, nits, and how the agents worked. Write each line as a plain sentence, the way a colleague would mention it in review: what it is and why. No bold labels such as "Decided for you:" or "Not tried for real:", and nothing that makes the change sound as if no person had a hand in it. No `<details>` blocks, and no line pointing to the ledger. When nothing qualifies, which is the usual case, leave the section out.

## Short

What, Why and How together stay under 150 words; the pictures carry the rest. Keep a sentence only if the reader would decide something differently because of it. No greeting, no summary at the end, no list of files (the diff has it), no account of what the agents did, no AI attribution (no "Generated with Claude Code" line or anything like it), and nothing a reader cannot open: no local path (~/.lcw, the run folder, the ledger, a scratch file) and no pointer to what only this machine holds, such as "see the ledger". Write as the `lcw:docs` skill says.

## The pictures

What and How each have one. A reader should get the change from the two pictures alone.

- **What** shows the thing as the person meets it: the screen, the output or the message, as built. Where something changed, before and after, side by side. Start from the picture the human approved in the brainstorm. Where Review compared the build with an approved mock, the What picture is made from its captures in `artifacts/compare/`, not redrawn: the approved state and the built one, side by side or one above the other, whichever keeps them readable at 830 wide, each cropped to the part of the screen the change touches. They go inside the SVG as embedded images (data URIs), because GitHub shows the SVG as an image and loads nothing from outside it; the frame, labels and palettes follow the rules below. With several states, show the one that best shows the change. For a transcript or a table of answers, draw the approved text and the built text side by side, from the captures, with each difference marked.
- **How** shows the parts and what moves between them, with what this change adds or alters marked, and the path taken when a step fails. At most nine boxes, and every arrow says what moves along it.

You do not draw them: a worker does, from your brief. Write one brief for the two pictures. For each, say exactly what it must show, with the real names, values and wording of this change. For What, name the file in `artifacts/` of the picture the human approved in the brainstorm, to start from, and the captures in `artifacts/compare/` where there are any. For How, list the parts, what moves between them, and what this change adds or alters. Launch one worker for both (Opus, high: only a person's eye can check a picture) and tell it to load the `lcw:visuals` skill before it draws anything.

The worker saves each picture as one SVG file in the run folder's `artifacts/`, with a PNG of it rendered on a light page and on a dark page beside it:

- at most 830 wide, with no text under 12px at that width;
- its own background, a light and a dark palette inside the file (`prefers-color-scheme`), and the system's fonts, because GitHub shows it as an image that takes neither the page's colours nor its fonts;
- real content from this change, never placeholders.

Then look at the PNGs once yourself. A picture passes when it shows what your brief said and a person would get it at a glance. If one does not, send it back once and say what is wrong.

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

<two or three sentences>

<img src="..." width="830" alt="...">

## Why

<two or three sentences>

## How

<img src="..." width="830" alt="...">

- <the approach, at most five lines>

Checked by <the tests and the review, in one line>.

## Check

- <a risky decision, or one the human might regret, and its reason, in a plain sentence; the section only when there is one>
```

The title follows the run's commit convention: a repository that squashes its pull requests makes the title the commit message.

## Before you open it

Read it as the human, cold: after one minute, could they say what was built, why, and how? Would they want to know every line of Check before merging? Is every claim true today? Then open it.
