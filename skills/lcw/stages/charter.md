# Charter

The human has given you an open goal: work that has to be found before it can be done. Your job here is to agree with them the rules of the sweep, the charter. After their approval you hunt, sort and fix on your own, wave after wave, and the charter is all you have to tell you what is allowed. Its lines change from one repository and one sweep to the next, so ask about every one.

## First, check the repository

Before the first question, check what the pull request choice will depend on, and say what you found in one line:

- Is this a git repository (`git rev-parse --show-toplevel`)? A sweep needs git for its worktree; if it is not one, say so and offer to create one.
- Does it have a GitHub remote (`git remote -v`) that `gh` can push to (`gh auth status`)? Without one, the only choice is one at the end, left as a branch for the human.
- Is it public (`gh repo view --json visibility`)? Only `PRIVATE` counts as private; anything else, and a remote not on GitHub, is public. Write the answer in charter.md: Hunt needs it.

Then `lcw set health="agreeing the charter with you"`.

## What earlier runs decided

As in Brainstorm, the human should not have to say twice what they already decided. Before your first question, run `lcw runs`. If it lists any run besides this one, launch a probe (Sonnet, medium) with their folders. It reads each run's brainstorm.md, spec.md, charter.md, parked.md and ledger.md, whichever it has, and reports, in under forty lines: what the human asked for and why; what they decided and turned down, in their own words where the record has them; what they said must never happen; what they plainly care about, run after run; and anything parked, limited or left unfinished that this sweep touches. With many runs, give it the five most recent and any whose title bears on this sweep.

Tell the human in a line or two what you took from it. Play earlier decisions back as readings they can strike ("last time you kept the public API out of bounds; I am taking that to hold here") instead of asking again. If this sweep goes against one, say so and ask which stands. What the human says now wins. Write what you took under "From earlier runs" in charter.md, with each run's id.

## Sizing up the work

While you talk, launch probes to understand the work before you ask about it: Haiku, low, to count it (how many items a backlog holds and in which sections, which areas the code falls into and where each one's files are), and Sonnet, medium, one for each large section or area, to read it and report what kinds of change it would take and how big they are: plain code fixes, a change to a public interface or a schema, work in a part the human may want kept out, a new feature, or a decision only the human can make, each with a rough count and a few examples. They read and report; they sort nothing and fix nothing, and the hunt proper starts only once the charter is approved. On a repeat sweep, the earlier-runs probe already has what the last sweep parked, by reason.

Use what they report in two ways. Propose values instead of asking open questions: the areas the goals cover, a wave size, a stop line. Past runs used about 0.2 to 0.4% of the week for each fix; say what the count comes to, so the human can weigh the stop line. And when you ask a line that would keep work out (a non-goal, an anti-goal, a no-go zone, a kind of change), say what it would cost, in their terms: "this line keeps out about 20 items; several only need an added optional field. Allow additive changes to the public API?"

Ask now, too, the questions only the human can answer that the probes have already found: a product, policy or money call that decides whether an item can be fixed. Put them as one numbered list, each with your best reading and the choices, after the ten lines or alongside the line they bear on; whatever they answer goes in charter.md under "Answers", and Hunt sorts by it. What they leave open is parked as usual, and comes back to them in LCW's box after the sort (stages/hunt.md).

## The ten lines

Take the lines in this order, one at a time. While you ask a line, `lcw set health="asking you: <the question in a few words>"`. For each, give your best reading from their words, the probes and earlier runs, with the alternatives and what each costs, and let them choose. Be the partner SKILL.md describes: if a line would let the sweep do harm or turn it into a nitpick loop, say so and offer better.

| Line | What it settles |
|---|---|
| goals | what the sweep is for, the areas it covers (backlog sections or parts of the code, each with its files), and what "done" means |
| non-goals | what it does not attempt, such as new features or a rework |
| anti-goals | outcomes that must not happen, such as a public interface changing or a test getting weaker |
| no-go zones | parts of the repository it must not touch |
| changes | the kinds of change allowed and not allowed, such as a new dependency, a schema change or a deleted file; in a public repository, whether a fix for a security hole may be published |
| proof | what a finding needs before it counts; every finding needs a recipe (where it is, what input or situation shows it, what goes wrong, who it hurts), and the human may ask for more |
| park | what is left for the human instead of being done; a decision only they can make is always parked |
| stop | when the sweep ends; by default when a round's hunt finds nothing to fix; it may also name an earlier end, such as a number of waves or a share of the week |
| waves | about how many fixes go in one wave; propose it from the count |
| PRs | how the sweep's work reaches the default branch, whether Claude may merge, and what a check already failing on the default branch means |

For the PRs line, always ask: may Claude ever merge a pull request on its own, and if so, on what criteria? Then settle one of three:

- **stacked**: one draft pull request for each wave, each on top of the one before; the sweep merges none of them;
- **merged as it goes**: one pull request for each wave, merged by the sweep when the wave meets the human's criteria; a wave that does not stays open, with every wave after it, until it meets them;
- **one at the end**: nothing is opened until the sweep is over, then one draft pull request for everything.

Write their criteria in their own words. Where the criteria name checks run on this machine (a lint, a test suite), also ask what happens when one already fails on the default branch, before any fix: the sweep fixes it in its own commit in a wave, merges anyway and says so in the pull request, or waits for them. The baseline below shows whether one does, so settle it while they are here, with its report in hand if it has come. Where a check needs a shared service that has to be rebuilt from the code under test (a dev stack whose own check refuses another checkout, say), ask too whether the baseline may rebuild it from a throwaway copy before any fix, as Review does anyway; otherwise that check is first tried in Review. The sweep reads GitHub's checks only if the criteria name them. If they do, tell the human that the sweep's pull requests stay drafts until it merges them, so in a repository that skips its checks on draft pull requests such criteria are never met.

Stacked and merged as it goes need merge commits. For either, check the repository allows them: `gh repo view <owner>/<name> --json mergeCommitAllowed --jq .mergeCommitAllowed`. If it prints anything but `true`, tell the human. `false` means stacked pull requests could not be merged in order, and the sweep could not merge at all; anything else, such as an error, means you could not tell, and that is what you say. They can turn merge commits on in the repository's settings or pick one at the end.

## The baseline

As soon as the PRs line names checks run on this machine, launch one reviewer agent (Sonnet, high) to run them once on the default branch as it stands, before any fix. Its brief: the commit (`git rev-parse HEAD` in the main checkout), the checks and their commands, and this job. It runs them as the repository says, in a throwaway worktree at that commit (`git worktree add --detach <a scratch folder> <commit>`), made ready as the repository needs, and removes it at the end. A check that needs a shared service, such as a dev stack the repository runs from one checkout, is run as the charter's PRs line says: where the human allowed it, the reviewer rebuilds that service from its throwaway worktree first, as Review will; where they did not, it leaves the service alone and reports the check as not run, with why, and the check is first tried in Review. It reports, for each check, whether it passed, how long it took, and for each failing test whether the fault looks like the code's or this machine's (a stopped container, a missing tool). Write the report under "Baseline" in charter.md. The playback does not wait for it; Hunt's sorting does.

## Record as you go

Keep charter.md in the run folder current after each line, not at the end; a compaction can come at any time. Write each line as agreed, in the human's words where it matters, the options rejected and why, what the probes counted, and the repository facts above. Anything else you make to settle the charter goes in the run folder's `artifacts/` folder, never in the repository.

Keep the status bar current. `sweep.charter` is how many lines are settled, counted from the top, and `sweep.open` how many questions are open now:

```
lcw set sweep.charter=4 sweep.open=1
lcw set sweep.prs=stacked      # or merged, or end, once the PRs line is settled
```

## Ending the charter

When all ten lines are settled and no probe whose answer could change them is still running, play the whole charter back in one message. Open it with the question, in bold: is this the charter they want? Then the ten lines, one each, and how big the work looks. Tell them this is the one approval the sweep needs: from here you hunt, sort the findings against the charter, and fix them in waves on your own; you come back to them only if something they agreed cannot be done. Parked items wait for them in parked.md and hold up nothing. End with the same question and the three replies they can type:

1. **Go**: start the hunt.
2. **Yes, but**: with the change they want.
3. **Something else**: drop this and pick again.

Just before you send the playback, put the question in LCW's box above their prompt:

```
lcw approval
```

Once the box is shown, `lcw set health="waiting for your yes on the charter"`. After a "yes, but", `lcw set health="asking you: <what you are reworking, in a few words>"` while you rework the charter; the waiting words return once the box is shown again.

It takes Go labels and `--meaning` as in Brainstorm. Run it again whenever you send the playback again. The box can be hidden, so the message still ends with the question and the three replies.

A typed reply counts, a number or their own words, and so does one the box put in their prompt and they sent with Enter. A button never approves: never put the approval in a question dialog. Send nothing else until they answer. If something you learn meanwhile changes the playback, send the whole playback again with what changed marked.

If they correct something, fix it, play back what changed, and ask again. If they choose something else, this run is named for the wrong work: `lcw stop` it, then `lcw start` a new run for what they pick (with `--shape sweep` only if it is a sweep again).

When they approve, write their approval into charter.md, then:

```
lcw ledger "charter approved: <one line>"
lcw stage Hunt
lcw checkpoint "Hunt: read stages/hunt.md and launch round 1's probes"
```

and do as it says (SKILL.md, Compaction).
