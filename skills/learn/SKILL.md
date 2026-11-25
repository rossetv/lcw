---
name: learn
description: Teaches the person how LCW works, as a conversation in the terminal with diagrams drawn as text, one step at a time, stopping for their questions. Load when the person asks to learn or understand how LCW works, or sends "Learn more about how LCW works".
user-invocable: false
---

# Teaching LCW

The person wants to understand LCW. Talk them through it: a short step, a diagram drawn in the terminal, then stop and let them ask or go on. It is a conversation, not a document. Never open a browser, a web page or a file viewer, and never show the README's picture; draw in your reply instead.

## Facts, not guesses

Teach LCW as it really works. From this skill's base directory, read `../lcw/SKILL.md` before your first reply, and read a stage's file in `../lcw/stages/` (`brainstorm.md`, `spec.md`, `plan.md`, `build.md`, `review.md`, `ship.md` for a Build; `charter.md` and `hunt.md` for a Sweep) before you explain that stage or answer a question about it. The README beside the plugin (`../../README.md`) says what the card and the status rows show; the description of its picture sums up a run. If those do not answer a question, say you are not sure rather than guess. Do not read the files out to the person: pick what they need.

## The steps, in order

1. **The two shapes.** LCW has two: a Build for a defined large change, a Sweep for an open goal such as "fix all the backlog items". Claude picks from what the person asks; naming a shape wins. Draw both flows, with the part done with the person and the part LCW does on its own.
2. **The card and the status rows.** What each shows and what the person can do with them, such as clicking an agent to talk to it.
3. **Build.** Workers, milestones and reviewers: draw who does what.
4. **Review and Ship.** How the work is checked against what was agreed, and what the draft pull request holds.
5. **Charter (a Sweep).** The rules agreed line by line with the person, and the one approval, typed as a reply: goals, non-goals, anti-goals, no-go zones, kinds of change, proof, what to park, when to stop, wave size, pull requests.
6. **Hunt and waves (a Sweep).** Probes go to every area and bring back a recipe for each problem; each is sorted to Fix, Park (only the person can decide) or Drop (with the reason); fixes become waves, each run through Build's Plan, Build, Review and Ship in its own worktree, the next starting as soon as its fixes need no file an open wave is changing, with no limit on how many are open, merging in order; a new round hunts again only where there were changes, until one finds nothing to fix. Say how the pull requests go as the charter chose: stacked, merged as it goes, or one at the end.
7. **Pause, carry on, stop.** What the person can say at any time, and how a question for them shows.
8. **The usage mark.** Where a run stops starting agents, how the person raises it, and when it carries on by itself.

The first reply is step 1. After that go where the person leads: if they ask about Build or Sweep, explain that shape, then offer the next step. Leave out a step they have already understood.

## One step per turn

- Replies are this long: two lines, one small diagram (three rows here), two lines, then the offer. No bullet lists, no second diagram. Detail (stuck workers, limits, edge cases) only when asked. Plain words; no filler, no selling, no summary.

```
Build runs in milestones. In each one, workers build their tasks side by side. Then a
reviewer who never saw the plan checks the code, while the next milestone starts.

  Claude (plans, decides, never codes)
    ├─▶ worker  T1  date filters      ┐  ┌─▶ milestone reviewer ─▶ fixes?
    ├─▶ worker  T2  CSV header order  ├──┤
    └─▶ worker  T3  download button   ┘  └─▶ next milestone

Each worker is an agent on the card above the prompt; click one to talk to it. If one is
stuck for 15 minutes, Claude asks it what is wrong and, if needed, hands its task on.

Next is Review, or ask me anything about Build.
```
- End each reply by offering both ways on, in one line: the next step by name, or a question. "Next is Review, or ask me anything about Build."
- Teaching launches no agent and does no work on a run, so it goes on at the usage mark: never ask the person to raise the mark to teach.
- Then stop and wait. Never go on to the next step in the same reply.
- Answer a question from the facts above, with a diagram when it helps, then offer to carry on where you were.
- The person can leave at any point. When they move on to something else, follow them without a closing summary.
- If this session is driving a run, use it as the example (its name, its stage, its tasks). The run carries on as usual meanwhile: act on agents' reports as they come. Nothing the person says while learning counts as an answer to the run's questions or as an approval; when they are done, ask the run's open question again if one was waiting.

## Drawing

- Each diagram in a fenced code block, so its columns stay lined up, at most 76 characters wide so the reply fits 80 columns.
- Draw with box-drawing characters and plain arrows only: `─ │ ┌ ┐ └ ┘ ├ ┤ ╭ ╮ ╰ ╯ ─▶`. No emoji, no Powerline or Nerd Font glyphs, no colour codes: not every terminal draws them.
- Real names in the boxes: Brainstorm, worker, milestone reviewer, draft PR. A made-up example only where the run gives none, and short.

The look to aim for, for steps 1, 3 and 6:

```
Build  you ─▶ Brainstorm ─▶ Spec ─▶ Plan ─▶ Build ─▶ Review ─▶ Ship ─▶ draft PR
              ╰ with you ╯  ╰──────────────── on its own ─────────────╯

Sweep  you ─▶ Charter ─▶ Hunt ─▶ Plan ─▶ Build ─▶ Review ─▶ Ship ─▶ draft PRs
              ╰ you ╯     ▲       ▲                 │        │
                          │       └─── next wave ───┘        │
                          └─────────── hunt again ───────────┘
```

```
Claude (plans, decides, never codes)
  ├─▶ worker  T1  date filters   ┐
  ├─▶ worker  T2  CSV order      ├─▶ milestone reviewer ─▶ fixes? ─▶ next
  └─▶ worker  T3  download       ┘
```

```
areas ─▶ probes ─▶ findings ─┬─▶ Fix  ─▶ waves
                             ├─▶ Park ─▶ for you
                             └─▶ Drop ─▶ with a reason
```
