<p align="center">
  <img src=".claude-plugin/icon.png" width="112" alt="LCW's icon: a small block mushroom with a face">
</p>

<h1 align="center">LCW: Large Change Workflow</h1>

<p align="center">Tell Claude what you want built. Come back to a pull request. A Claude Code plugin.</p>

<p align="center">
  <img src="hero.svg" width="830" alt="One LCW run in a terminal: you ask Claude to add shared lists to a to-do app, Claude plays back what it understood and you approve once, agents build it while a card above the prompt shows the stage, the tasks and each agent with its model and tokens and two rows below show the mascot, the model, the context and the week's usage against the mark, and then a draft pull request opens and the card shows the run finished.">
</p>

The card above the prompt shows the stage, the tasks, each agent with its model and tokens, and anything waiting on you; the two rows under it show the model, context and week's usage against the mark. Talk to an agent by clicking it, or ctrl+x, Tab, Tab, Enter.

## Install

```
/plugin marketplace add rossetv/lcw
/plugin install lcw@lcw
```

The rows turn on by themselves, unless you already have a status line; then say "set up LCW". If the rows ever go missing, `~/.lcw/statusline.log` says why; if it has nothing, say "set up LCW". Needs macOS or Linux, Node 18 or later, and git.

## Then just ask

"Add shared lists to the to-do app" is a large change: a Build.

"Find and fix the bugs in the API" is an open goal: a Sweep.

A small change is just made when you say yes, with no run.

## How it works

<p align="center">
  <img src="how.svg" width="830" alt="How LCW works. You say what you want. For one change, a Build: in Brainstorm Claude plays your intent back and you approve once, then a reviewer that saw nothing else reads the Spec cold and explains it back. For an open goal, a Sweep: you approve a Charter once, then probes hunt for problems, and nothing is fixed until a recipe shows it is real. Both then go on their own through Plan, Build, Review and Ship. Each task owns its files, each milestone is checked blind, and fresh reviewers check every requirement while the full suites run. It ends at a draft pull request for you to review. A Sweep goes back to Hunt until a round finds nothing. It stops at your usage mark, 75% of the week unless you raise it.">
</p>

<details>
<summary><b>The full architecture</b></summary>
<br>
<p align="center">
  <img src="architecture.svg" width="830" alt="LCW's full architecture: around your session, the mod draws the run's card and the pink box, the status line shows the mascot, model, context and usage against the mark, the hooks tell Claude the run at start and stop it at the mark, and the main session records everything in a run folder outside the repository; then each stage with its agents, their models and the records it keeps, ending at a draft pull request.">
</p>
Every stage, its agents and their models, and the records each keeps in a run folder outside your repository.
</details>

[An example pull request](https://github.com/rossetv/lcw/pull/11) · [Billing and external quota](docs/quota-command.md) · [License](LICENSE)
