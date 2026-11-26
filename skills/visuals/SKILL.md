---
name: visuals
description: How to draw a diagram or any other picture a person understands at a glance - mocks, diagrams, charts and options side by side - for the brainstorm, for a document such as a README, and for the pull request. Load before drawing anything for a person in an LCW run.
user-invocable: false
---

# Showing it

A picture settles in a minute what a page of text leaves open. In the brainstorm the human approves the intent from what they see; in a README or a pull request they understand the change from it. So a picture has to be true, clear and good to look at. A rough picture gets a rough answer. Every picture is finished work: beautiful, exact, and with nothing off when the human looks closely. They judge the run by it.

## When to show

Whenever the human would otherwise have to imagine it. Draw it before you ask the question it answers.

| The human is asking, or should be | Show |
|---|---|
| What will I see? A screen, a page, a message, a report, a status bar, terminal output | A mock, with real content, in every state that matters |
| How does it work? Steps, states, who talks to whom, what happens when a step fails | A diagram |
| Which way should it go? | The options side by side, drawn the same way, each with what it costs |
| How much, how fast, how does it change? | A chart, or a table where the exact values matter |

One picture per question. Keep it and update it as the intent moves, so the human has one link and not five. A picture has to earn its place: do not draw what one sentence says as well.

Who draws: in the brainstorm, the session that is talking with the human. For a document or the pull request, a worker draws from a brief that says exactly what the picture must show. A picture drawn with no such brief shows the wrong thing well. Probes can fetch the facts a picture needs.

## Where it goes

That depends on what the picture is for:

| The picture is for | It goes |
|---|---|
| the brainstorm | a Claude artifact, or a local page when there is no Artifact tool: the rest of this section |
| a document in the repository | an SVG file beside the document, as the `lcw:docs` skill says |
| the pull request | SVG files pushed with `lcw pictures`, as the `lcw:pull-request` skill says |

For the brainstorm, first find out whether you have the Artifact tool. It may be a tool you call directly, one listed among the tools to load first (load it with ToolSearch, `select:Artifact`), or one you reach from inside a script; there, list the tools you have and look for it. If it exists, the picture is published as an artifact. That is the rule: a local page being quicker to make is not a reason to break it.

Before you write either kind, load the skills your client lists for designing artifacts, for diagrams and for charts, where it lists any. They are the reference for how a picture should look, for a local page as much as for an artifact; where they and this file differ, they win. Only their rules about publishing do not apply to a local page.

**1. A Claude artifact, when the tool exists.**

- Ask the tool what this account can make (its quickstart, with what you are making) and follow what it returns. For screens, layouts and their states use the Design type when the account has it: a canvas with one artboard per state, so the human can compare them and comment on each. For figures use the type for data when there is one. For a diagram or anything else, a page.
- Publish, give the human the link, and say in a line or two what to look at and what you need from them. Republish to the same artifact as things change.
- The human can comment on the artifact itself. Tell them once that a comment thread has to be sent to Claude before you can answer on it. When they say they have commented, read the comments: they are the human's word, the same as what they type. Answer each one and resolve it.

**2. A local page, only when there is no Artifact tool, or a publish has failed or been refused.**

- One HTML file with everything inside it: styles, scripts and pictures, nothing fetched from the network, so it opens anywhere.
- Open it in the human's browser with the system's opener (`open` on macOS, `xdg-open` on Linux, `wslview` or `explorer.exe` on WSL, `start` on Windows) and give them the full path. Where nothing can open it, such as a remote session, give the path and say so.
- Say why it is a local page, in a few words.

**Either way, keep the source.** Save a copy of every picture's files in the run folder's `artifacts/` folder (`lcw start` printed it; `lcw where` prints the run folder). With no run, use a temporary folder outside the repository. Never save one in the repository; the one exception is a picture that belongs to a document the change itself adds or alters (see the `lcw:docs` skill). Write in brainstorm.md what each picture shows, its link or path, what the human said about it and what they approved.

A published artifact leaves this machine. Use made-up content that looks real; never a secret, a credential or a real person's data.

## Draw only what can be built

A mock is a promise. Draw it within the limits of the place it will live:

- **A terminal:** a grid of characters, and only the glyphs and colours the human's terminal and font can draw.
- **A web page or an app with its own look:** the project's own colours, type and components. Look for them first, and use them.
- **Anything else:** its real controls and its real sizes.

If you are not sure something can be built as drawn, check with a probe or a small real test before you show it, or mark it on the picture as not checked. One run's mock showed a bar with rounded ends that the terminal could not draw, and the human found out only after the build.

## A diagram people get at a glance

Most pictures in a run are diagrams. These are what makes one easy to read:

- **Follow the shape of the thing.** A workflow is a column of cards, one for each step, top to bottom. Inside a card, a small flow of boxes shows who does what, in order. Do not sort the facts into a list beside the drawing.
- **Name who acts.** Each box carries the actor's name and, under it in a few words, what it does. A reader should be able to follow one box to the next and say what happens.
- **One meaning for each mark.** A solid box is a thing that is always there, a dashed one a thing that is there only sometimes. An arrow is one thing moving one way. A colour means one kind of thing everywhere, and a thing with no kind gets no colour.
- **Say it where it happens.** Put the word on the line or beside the icon it explains. No legend, unless a mark appears many times and cannot be labelled in place.
- **Show the way back.** Where a step can fail, draw both outcomes, with "yes" and "no" on the lines, and draw the loop to where the work returns.
- **Few words.** A caption is one short line. Under a flow, two or three lines at most, and none that says again what the flow shows. A pull request's pictures hold more: see "A pull request's pictures".
- **Quiet emphasis.** Mark the special thing with a small label set into its border, or a light tint. A loud filled badge is too much.
- **Even and aligned.** Equal gaps; boxes on shared centre lines and edges; an arrow centred in the gap it crosses; a box only as wide as what it holds. Lines never cross where moving one end avoids it.
- **Light lines.** Lines of one to one and a half pixels, open arrowheads, rounded corners where a line turns.
- **Names of files and folders** in a monospaced face, each with a small file or folder icon; a folder's contents as a real tree.
- **Text you can read** at the size it will be shown: nothing under 12px.

Then render it and look, the whole picture and each part enlarged, on a light page and a dark one. Fix what you see and look again, until nothing is off. Expect several rounds: a diagram is rarely right the first time.

As an SVG file shown as an image (a README or a pull request on GitHub): at most 830 wide, its own background, a light and a dark palette inside the file (`prefers-color-scheme`), and the system's fonts.

Render the file itself, with the tool in this skill's folder. It draws the file light and dark with a Chromium-family browser run headless (Chrome, Chromium or Edge; `LCW_BROWSER` names one it cannot find) and prints where the PNGs are:

```
node <this skill's folder>/picture.mjs render <file.svg> <folder>
```

`rsvg-convert` draws the light palette only, so it cannot show you the dark one; never stand in for the dark render by recolouring a copy, since then the file you ship was never drawn.

## Nothing out of place

A line of text that touches or crosses its box, two labels drawn over each other, an arrow that starts in the air: the human sees these first, and stops trusting the picture. Looking does not catch them reliably. One run's picture reached a pull request with a line 11 px past its box's border, after the agent that drew it and the one that approved it had both looked.

In a page, an artifact or a local one, text wraps inside its box by itself: let it, give no box a fixed size that its text can outgrow, and look at a narrow window and a wide one. In an SVG file nothing wraps and nothing grows, so there:

- **Measure, never estimate.** Lay the picture out from the browser's own measure of each line, not from a guess at so many pixels a letter. Write a small page whose script measures each line with a canvas's `measureText` in the picture's fonts, wraps and sizes from that, and leaves the finished SVG as the text of an element with the id `picture`. Then `node <this skill's folder>/picture.mjs build <page.html> <file.svg>` runs the page and saves the file.
- **Leave room.** A line fills at most nine tenths of the room between its box's paddings, since other systems draw the same letters wider. No line ends on a word or a figure left alone.
- **Fix every line's length.** Give each line a `textLength` of its measured width, so it is as wide on every system as it was on yours.
- **A box reaches what it joins.** An arrow starts on one box's border and ends on another's. A box that several arrows leave is tall enough for all of them.
- **Run the check.** `node <this skill's folder>/picture.mjs check <file.svg>` measures every text against the box it sits in, the picture's edge and the other texts, as drawn and again with wider letters, and lists what to fix. Fix and run it again until it says "Nothing to fix". An SVG file that fails it is shown to nobody.

The check judges text, and knows a box only as a `rect`, so draw every box as one. It also says when the file is one a browser cannot read, which GitHub would show as a broken image. A terminal mock's grid of characters, and everything that is not text (an arrow through a label, uneven gaps, a box off its centre line, a box left mostly empty), you still find by looking, so passing the check is where looking starts.

## Make it play

Animate a picture wherever something in it moves or happens over time: a flow, a sequence, a change of state, a timeline. Nearly every diagram of how something works has one. Motion that shows nothing is decoration, and it is what makes a picture look generated.

- **One story at a time, and say which.** A flow plays as three or four short stories in one loop: the usual case, the case the change is about, the failure. A line under the title names the story that is playing. A loop of 10 to 20 seconds, slow enough to follow.
- **Show what moves.** A dot travels each arrow in turn, and the box it reaches lights up while it works. A timeline fills as a line crosses it. A mock of a screen moves only as the product moves, at the product's own pace.
- **Complete at rest.** Stopped, the picture still says everything: motion is added to a finished picture and never holds part of it back. A reader who has asked for less motion (`prefers-reduced-motion`) gets that still picture.
- **Made of CSS inside the file.** Keyframes in the SVG's own style block play wherever the file is shown as an image, on GitHub too; a script does not run there. Move things with `transform` and `opacity`. Give every animation the same loop length and no delay of its own, and put each part's timing in its keyframes' percentages.
- **Look at it stopped.** That last rule is what lets the tool stop the whole picture at any second: `node <this skill's folder>/picture.mjs render <file.svg> <folder> 1 8 13.5` draws it at those seconds, light and dark. Look at a moment inside each story before anyone else sees it.

## A pull request's pictures

They sit on a GitHub page and a human judges the change from them, so they differ from a diagram elsewhere in three ways.

**They wear GitHub's colours**: white or near-black, greys, and one blue.

| | Light | Dark |
|---|---|---|
| the page | `#ffffff` | `#0d1117` |
| a box, and a box that holds others | `#ffffff`, `#f6f8fa` | `#0d1117`, `#151b23` |
| a box's border | `#d1d9e0` | `#3d444d` |
| text, and quiet text | `#1f2328`, `#59636e` | `#f0f6fc`, `#9198a1` |
| lines and arrows | `#6e7781` | `#7d8590` |
| blue, and its tint | `#0969da`, `#ddf4ff` | `#4493f8`, `#121d2f` |
| a failure | `#cf222e` | `#f85149` |

**Blue means this change touched it**, and nothing else. What the change adds has the tint as its fill, a blue border and a small "new" label set into that border. What it alters has a blue border, the plain fill and a "changed" label. What was already there is grey with no label, so the human sees at once what there is to judge. In a mock of a screen, the product's own colours stay as they are.

**They hold more.** A box may say in a sentence or two what its part does, and the picture shows every state that matters. "Few words" above is for the other pictures: in a pull request the text is short and the pictures carry it.

## Making it good

These hold for every picture. For a local page they are all you have, so follow each one.

- **Real content.** The project's real names, the words the product would really use, numbers that could be true. Never "Lorem ipsum" or "Item 1".
- **Every state that matters.** Empty, usual, full, gone wrong, and the awkward one: the very long name, the narrow window.
- **Frame it.** A mock of a screen sits in a frame of its real shape and size (a browser window, a phone, a terminal, a sheet of paper), with a caption, on a quiet page. The human must see at a glance what is the product and what is your note about it.
- **One idea per picture.** A title that says what it is, one line on what to look at, and nothing that does not serve the question. Label parts in the human's words, not the code's.
- **Type.** One typeface for text, at most one more for headings, and a monospaced one only for code and terminals. A clear scale of a few sizes. Lines of text about 65 characters wide. For a local page use the system's fonts, which need no network.
- **Colour.** A small palette: one family of neutrals, one accent, and colours with a meaning (fine, caution, problem) used only for that meaning. Text must be easy to read against what is behind it. Never rely on colour alone: add a label or a shape.
- **Space.** Generous and even, from one small scale of gaps. Line things up. White space is not waste.
- **Light and dark.** Define every colour once as a named value, give each a light and a dark value, and follow the reader's setting (`prefers-color-scheme`).
- **Diagrams.** Drawn as SVG, with real text, as the section above says. They read one way, left to right or top to bottom. More than about nine boxes in one flow is two flows.
- **Charts.** Choose the form from the question: a line for change over time, bars for comparing, a table for exact values. Name the axes and their units, label the lines directly, start bars at zero, and no 3D.
- **Motion.** Wherever something moves or happens over time, as "Make it play" says, and a still picture for a reader who has asked for less motion.
- **Any width.** It works on a narrow window and a wide one, and the page never scrolls sideways.
- **Look before they do.** Render what you made and look at the picture (a browser run headless can take a screenshot of a page, where one is installed): clipped text, things overlapping, a colour unreadable in the dark. Fix what you see before you send the link. If you could not look, say so.

## After they approve

An approved picture is part of the intent. Write the approval in brainstorm.md, and keep the approved version unchanged in `artifacts/`; if it changes later, say so there. An approved mock, terminal transcript or table of answers is an approved example, and Review compares the build with it, so also save each approved state on its own, named after it: a PNG rendered as the section above says for a mock (`<example>-<state>.png`), a text file for a transcript, a Markdown table for a table of answers. Each must show exactly what was approved. The spec then says in words what the picture shows and names its file, because the blind reviewer sees only the spec's text.
