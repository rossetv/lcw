# LCW: Large Change Workflow

A Claude Code plugin that takes any large change from what you intend to build, to a draft pull request.

<p align="center">
  <img src="overview.svg" width="830" alt="How an LCW run goes. You say what you want. Brainstorm, with you: Claude clarifies what you mean, tests your assumptions against the code, asks the hard questions as a senior partner would, and uses mocks and diagrams to make sure you both understand the same thing; you approve once. Then, autonomously: Spec, written by AI for AI and checked by a blind reviewer; Plan; Build, where Claude orchestrates workers and, for very large work, an extra orchestrator for each area, and a blind reviewer checks each milestone's code without the spec; Review, where reviewers check the work against the spec, raise every concern, and Claude decides what to change; and Ship, a draft pull request that you review. A Fable advisor reviews the work at every stage. Each stage saves its records in ~/.lcw, outside your repository: the brainstorm, the spec, the plan, a ledger of every decision and why, and mocks. Ship writes the draft pull request from them and lists what you really need to know before merging.">
</p>

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
