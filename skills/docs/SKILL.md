---
name: docs
description: How to write a document people will read - a README, a guide, a changelog - so that it is short, shows before it tells and carries no filler. Load before writing or changing any document for people in an LCW run.
user-invocable: false
---

# Writing for people

A person reads a document to do something: decide, install, use, fix. Write what gets them there and stop.

## When

Write or change a document for people only when the intent asks for it, or when the change makes an existing one false. A document that lies is a defect; a document nobody asked for is clutter. Match the voice and layout of the project's other documents.

## How

- **Name the reader and what they will do.** A README's reader is a stranger who decides whether to install the thing, installs it, then uses it for the first time. What serves none of those three belongs somewhere else, or nowhere.
- **Follow the shape of the thing.** A workflow is told stage by stage, with each stage's facts under that stage; a tool, task by task. Do not sort the facts into piles of your own, such as a list of features.
- **Say what it is in two sentences, then show it.** A picture of how it works replaces the paragraphs or the list that would describe it; do not keep both. A command the reader can copy replaces a description of the command.
- **Keep a line only if the reader does something differently because of it.** Not how it works inside, not what they will see for themselves once it runs, not every limit: only the ones that would surprise them.
- **Every command has been run, every path exists, every claim is true today.** Where you could not run something, tell the human so in your report.
- **Short.** A README reads in a minute. Two lines need no heading of their own. Count the words before and after, and report both.

## Filler to delete on sight

- An opening that sells, or that announces what the document is about to say.
- A list where every item begins with a bold word.
- The same thing said in the introduction and again in a section.
- Words that add nothing: simply, just, easily, powerful, seamless, robust, comprehensive.
- A closing summary.
- A table or a list for what is one sentence.

## Pictures

Draw them as the `lcw:visuals` skill says. For a workflow, let the picture do the explaining: one card per step, top to bottom, each holding its two to four facts in plain words, with the human's part marked. The text under it then says only what the picture cannot, such as how to install and use. A picture in a document is part of the change, so its file lives in the repository beside the document; that is the one exception to that skill's rule about the repository. On GitHub it is an SVG file shown as an image, which takes neither the page's colours nor its fonts: give it its own background, a light and a dark palette (`prefers-color-scheme`, inside the file) and the system's fonts, with slack around the text. Render it on a light page and a dark one, and look, before you hand it over.

## Before you say done

Read it as that stranger: could they install it and use it from this page alone, in two minutes? Then check each command and each link once more.
