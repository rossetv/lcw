# Models and effort

You choose the model and the effort for every agent you launch, at the moment you launch it, and you are free to choose any. The Agent tool takes both on each call: `model` is fable, opus, sonnet or haiku, and `effort` is low, medium, high, xhigh or max. This skill asks you to name the level every time; the relative values "higher" and "lower" are refused. Each LCW agent has the default shown below, and what you pass at launch overrides it.

This table is guidance, not a rule.

| Job | Model | Effort |
|---|---|---|
| Brainstorm and the pictures it shows, spec, plan, top orchestrator (which never writes or reviews code), final judgment against the intent, the pull request's text | the human's own session (Fable recommended) | the human's (high recommended) |
| Probe that finds, lists and reports | Haiku | low |
| Probe that needs a judgment, such as reading earlier runs for what the human decided, or that runs a small real test | Sonnet | medium |
| Blind reviewer | Opus | high |
| Feasibility review | Opus | high |
| Extra orchestrators | Opus | high |
| Worker on a mechanical task | Haiku | low |
| Worker on a clear task that tests can check | Sonnet | medium |
| Worker on a hard task, or one nothing can check | Opus | high |
| A task stuck twice, a dispute, a hard call the plan left open | one tier up, ending at Fable | high; xhigh at Fable |
| Milestone check: the blind correctness review of a milestone's code | Opus or Sonnet, as plan.md gives each milestone | high |
| Code review against the spec | Opus or Sonnet, as plan.md gives each group | high |
| Comparing the built thing with the approved examples | Opus | high |
| Ledger entries, summaries, routine git work | Haiku | low |

The tiers, from the bottom: Haiku, Sonnet, Opus, Fable.

- Work that a test or a second reader can check runs as cheap as its difficulty allows. The last independent check stays senior.
- A stuck task moves up a tier. It is not simply retried.
- Senior agents hand simple work down. Tell every agent you launch on an expensive model, such as Fable or Opus, that it may launch probes on cheaper models (the probe agent, Haiku at low effort), and that reading code, searching and similar simple work should go to them. The LCW agents that default to Opus or Fable already say this; say it in the brief when you move any other agent up.
- The model and effort of the human's own session stay the human's choice.
