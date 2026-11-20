<p align="center">
  <img src=".claude-plugin/icon.png" width="112" alt="LCW's icon: a small block mushroom with a face">
</p>

<h1 align="center">LCW: Large Change Workflow</h1>

<p align="center">A Claude Code plugin that takes any large change, or an open goal such as a whole backlog, from what you intend to a draft pull request.</p>

<p align="center">
  <img src="overview.svg" width="830" alt="How LCW works, in two shapes. You say what you want, and the main orchestrator, advised by Fable, picks the shape; a small change gets no run. A Build is for a defined change: Brainstorm with you, your one approval, then Spec. A Sweep is for an open goal: a Charter with you, your one approval, then a Hunt where probes find what to fix and the fixes queue up in waves. Both share Plan, Build, Review and Ship: once in a Build, once for each wave in a Sweep, which goes back to Hunt for the next wave or a new round until none is left. You review the pull request.">
</p>

<p align="center"><a href="lcw-shapes.svg">The full picture: every agent, and the records each stage keeps</a></p>

## Two shapes

A Build takes a defined change, such as "add shared lists to the to-do app", to one draft pull request.
A Sweep takes an open goal, such as "fix all the backlog items" or "find and fix the bugs in the API": it hunts for what to fix, then plans, builds, reviews and ships the fixes in waves, until a round finds nothing left.

Claude picks the shape from what you ask; if you name one, that wins.
A Sweep's one approval is its charter, where you agree its goals, its limits and how its pull requests land: stacked, one for each wave, which you merge in order with merge commits; merged by Claude as it goes, when a wave meets the rules you gave; or one at the end.

## The status bar

<p align="center">
  <img src="statusbar.svg" width="783" alt="The LCW status bar in a terminal, followed through one run that builds a to-do app for web and mobile: you ask, then brainstorm, spec, a build with three orchestrators and their workers, a question for you, a pause at the usage mark, and the finished run. A card above the prompt shows the run, its stage, its tasks and its agents; two rows under the prompt show a small mascot, a different creature in each scene with the face that scene calls for, and beside it the model, the context and the week's usage against the mark.">
</p>

The card above the prompt follows the run: its stage, its tasks, each agent with its model and tokens, and anything waiting on you.
The two rows under the prompt are always there: the model, the context, and your week's usage against the mark.

Click an agent on the card to talk to it, or press ctrl+x then Tab to reach the card, Tab to the agent, and Enter.

## Install

```
/plugin install lcw --marketplace rossetv/lcw
```

It runs on macOS and Linux, and needs Node 18 or later and git.
