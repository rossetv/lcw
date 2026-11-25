# Ship

The draft pull request is what the human comes back to, so you write its text yourself.

`lcw set health="opening the draft pull request"`, or `health="leaving the branch for your review"` when there is no GitHub remote. The review has run the tests. Check with `git -C <worktree> status` that everything is committed and the worktree is clean; if it is not, launch a worker to sort it out.

## The text

Load the `lcw:pull-request` skill with the Skill tool and write the pull request as it says, from the brainstorm, the spec and the ledger: What, Why, How, in that order, each short and each with its picture, then Check, only when a decision is risky or one they might regret, as the skill says.

Save it in a temporary file for `--body-file`, and record the counts for the status bar:

```
lcw set closing.decisionsToCheck=<n> closing.parked=<n>
```

`decisionsToCheck` counts the lines in Check that are choices made during the run, not every decision in the ledger.

## With a GitHub remote

```
git push -u origin lcw/<name>
gh pr create --draft --head lcw/<name> --base <default branch> --title "<title>" --body-file <file>
lcw finish --pr <url>
```

Write the title in the run's commit convention too: a repository that squashes its pull requests makes the title the commit message.

The run is finished when the draft pull request is open. Tell the human in the conversation: the link, and the lines of Check in a sentence or two.

## With no remote, or no way to push

Leave the branch, `lcw finish --branch lcw/<name>`, and tell the human the branch and that you could not open a pull request and why. Put the pull request text in the conversation so they have it, and show its pictures as the `lcw:visuals` skill says, since there is no pull request to hold them.

## Afterwards: clean up

Once the pull request is open, this machine holds nothing it needs: the branch is on GitHub. Clean up what the run left behind, and keep the run folder under ~/.lcw, since later runs read it.

In a sweep this part runs once, when the sweep ends, never after a wave. The session stayed in the main checkout, so step 1 is not needed, and steps 2 and 3 run for each wave's worktree still there (`lcw status` names them). A wave's worktree is the sweep's own, where only its agents wrote, so step 2 leaves out its check for ignored files there: an environment or a cache made in it can be made again. Step 2 compares its HEAD with the remote branch it was pushed to: `lcw/<name>` only in one at the end, and in stacked or merged as it goes, where `lcw/<name>` is never pushed, the branch of the last wave that was pushed, `lcw/<name>-wave-<n>`, and its remote, since an empty wave has no remote branch. Where no wave was pushed, since none had commits (in every pull request choice), `git -C <worktree> rev-list --count <default branch>..HEAD` must print 0 instead. Step 3 removes every local wave branch too, and where waves were merged it ends with `git fetch --prune origin`: GitHub has deleted their branches, and this drops the local record of each, which step 2 needed until now.

1. If this session is working in the worktree (a run carried on from a version of LCW that entered it), leave it: call ExitWorktree with action "keep".
2. Check that nothing would be lost. `git -C <worktree> status --porcelain --untracked-files=all` must print nothing, `git -C <worktree> ls-files --others --ignored --exclude-standard --directory` must print nothing (`git worktree remove` deletes ignored files, such as a `.env`, without asking), and `git -C <worktree> rev-parse HEAD` must equal `git rev-parse origin/lcw/<name>`. If any check fails, remove nothing, and tell the human what is left in the worktree.
3. Remove the worktree with `git worktree remove <worktree>`, then the local branch with `git branch -D lcw/<name>` (in a sweep, and each `lcw/<name>-wave-<n>`). The `-D` is needed because the branch is not in the local default branch yet; the pushed copy is the one that counts.
4. Delete the temporary files the run made outside the repository, such as its scratchpad files and the pull request's body file.

Tell the human it is cleaned up, and that `gh pr checkout <number>` brings the branch back if they want to look at it locally.

With no remote, the branch is the only copy of the change. Check only that the worktree has nothing uncommitted, then remove the worktree and the temporary files, and keep the branch.

If the human then has you merge the pull request, delete its branch on GitHub as well (`gh pr merge --delete-branch`), then run `git fetch --prune` and bring the main checkout up to date: when it is on the default branch and `git status --porcelain --untracked-files=no` prints nothing, `git pull --ff-only`. If it is on another branch, has uncommitted changes or cannot fast-forward, leave it as it is and tell the human why. A merge the human makes on GitHub needs nothing here: `lcw worktree` brings the main checkout up to date when the next run starts.

What the human asks for next is a new request: a large one is a new run, and a small one is made only on their go-ahead, as SKILL.md says.

## In a sweep

A wave in Ship holds: its review has passed and its closures are checked, and it waits only on its final checks, its merge or the person's answer. While it holds or waits, the other open waves carry on with everything that does not depend on it; SKILL.md says how health names each. While several waves are open, or a hunt round runs beside the wave, name the wave in every wave command and in every ledger line and ask about it: `--wave <n>`. A wave does none of "Afterwards: clean up" and records no closing counts: `lcw wave shipped` keeps the sweep's totals, and every branch stays until the sweep ends.

**Final checks.** They run for one wave at a time, in wave order, on everything beneath the wave:

1. Wait until every earlier open wave's final checks have passed (it is at merging, or has shipped) and no worker is committing to this wave: every worker of the wave has reported, and its head is settled. `lcw wave step "final checks"` refuses while an earlier wave's have not passed.
2. Take in the wave before again, `lcw wave take --wave <n>` (when it refuses, naming `lcw wave take --wave <m>`, run that first, once every worker of wave m has reported; it also refuses while one of that wave's tasks runs), resolving a conflict as stages/review.md says, its resolution checked by a reviewer as it says there before step 3 (after a compaction, the ledger line `lcw wave take` wrote for the conflict says it waits for one); a wrong one goes back to a worker, and the reviewer checks again. Check with `git -C <its worktree> status` that everything is committed; if it is not, launch a worker to sort it out.
3. `lcw wave step "final checks" --wave <n>`. It records the head the checks run on and prints it.
4. Launch one reviewer agent (Sonnet, high) with that commit, briefed as the reviewer who runs the suites in stages/review.md: the test suites and the repository's own checks, the checks tied to a shared service included, in a throwaway worktree at that commit, against charter.md's baseline.
5. When they pass, `lcw wave step merging --wave <n>`. If it refuses because the head moved, that run does not count: wait until the head settles, and run them again from step 2.

**When they fail**, the wave goes back: `lcw ledger --wave <n> "final checks failed: <what>"`, then `lcw stage Build --wave <n>` and fix tasks as stages/review.md says under Judging, or `lcw stage Review --wave <n>` when a reviewer must find the cause first. It is fixed and reviewed again, and when that review passes, the closures reviewer checks its closures again, after a worker corrects any the fixes made wrong.

Sending a wave back, or running its final checks again, clears the final checks of every later wave. Stop any later wave's final-check agent still running (TaskStop with its id), and start that wave's checks again from step 1 once it is its turn.

**Merges, in order.** Waves merge, or land on the sweep's branch, in wave order: `lcw wave shipped` refuses until every earlier wave has shipped, so a later wave whose checks passed holds at merging until the one before it has. With the wave at merging, `lcw set health="writing wave <n>'s pull request"`, or `health="landing wave <n>"` where the choice is one at the end or the wave opens none, and ship it in the way charter.md picks for its pull requests (`lcw status` prints the choice):

**A wave with no commits** of its own (every fix dropped or parked, and nothing to close) has no final checks and nothing to push, whatever the choice. Once every earlier open wave's final checks have passed, `lcw wave take --wave <n>` (the wave before, after it has taken in its own; run the take-in it names if it refuses, once every worker of that wave has reported; it also refuses while one of that wave's tasks runs), then `lcw wave step merging --wave <n>`, and at its turn `lcw wave shipped --wave <n>`, with no push and no pull request. Once every earlier wave has shipped, and only then, `git rev-list --count lcw/<name>..lcw/<name>-wave-<n>` printing 0 shows a wave has no commits; before that it counts the earlier waves' commits too.

**Stacked, or merged as it goes.** The wave pushes its own branch, never `lcw/<name>`, which these two never push, and pushes it and opens its pull request only once every earlier wave has shipped. Write the text as above, from charter.md, the wave's fixes in findings.md and the ledger, then:

```
git push -u origin lcw/<name>-wave-<n>
gh pr create --draft --head lcw/<name>-wave-<n> --base <base> --title "<title>" --body-file <file>
lcw wave shipped --wave <n> --pr <number>
```

Between the push and the pull request, check (here and anywhere else this file compares a wave with its remote branch, in a sweep) that `git rev-parse lcw/<name>-wave-<n>` equals `git rev-parse origin/lcw/<name>-wave-<n>`. The base is the branch of the last earlier wave that has an unmerged pull request (`gh pr view <number> --json state`), else the default branch.

If the push or the pull request needs something only the human can give (the token has no write access, say), the wave holds at merging and waits: `lcw ask --wave <n> "<question>"` as SKILL.md says. The other waves carry on with their builds, reviews and final checks; only their landing waits, since waves land in order. Once the human answers, push and open the pull requests in order, each against the base above, and run `lcw wave shipped --wave <n> --pr <number>` for each.

**Merged as it goes**, then: go through the shipped waves not yet merged, in order, passing over a wave with no commits (`lcw status` shows it empty). The first wave that falls short stops the pass: it stays open, with every wave after it, until a pass finds it meets the charter's criteria. Each pass looks at every one of them again, from the first; only a second "gh could not merge" and "merged into another branch" below leave a wave open for good. A wave whose pull request waits on the human's answer falls short.

Where the criteria name GitHub's checks, never watch them yourself, with looks or a loop: each look is a turn of yours, which reads the whole session again. Let `lcw merge` wait instead. For the first wave of the pass that meets every other criterion, run `lcw merge <wave> --wait 60` in the background (the Bash tool's `run_in_background`) and carry on with the other waves' work: it waits up to an hour for the pull request's checks and merges only once they have passed. You are told when it ends; act on what it says, as below, and the pass goes on from there. It ends at the first failed check, and what it says when the checks did not pass, were all skipped, never showed, could not be read or were still running after the hour is a wave that falls short. Its start and its end are in the ledger ("waiting up to ... for the checks of", then the merge, or "ended with no merge" and why): after a compaction, a wave whose wait began and has not ended needs no second one, and one whose wait ended with no merge is looked at again as above. Anything else the criteria have you wait for at GitHub, such as the default branch's run after a merge, is one background command too, `gh run watch <id> -R <repo> --exit-status`, never a loop of looks.

A wave that misses any criterion falls short. One that meets them all: `lcw merge <wave>`, with `--wait 60` in the background where the criteria name checks, and act on what it says.

- **Merged.** `lcw set health="wave <n>'s PR #<number> merged: it met your charter's rule; <each open wave and what it does>"`. The next pull request is now against the default branch, which starts none of its checks: where the criteria name checks, `gh pr close <number>` and `gh pr reopen <number>` it so they run. Go on to the next wave.
- **Based on another branch** (an earlier wave's branch was not deleted, so GitHub did not retarget it; it prints a `gh pr edit` command): run that command, close and reopen the pull request where the criteria name checks, and look at the wave again from its checks, not straight at the merge; if `lcw merge` says so again, the wave stays open.
- **Not merged yet** (a merge queue, or GitHub waiting on checks): it is still waiting, and the pass stops there. The next pass and the end look at it again; `lcw merge <wave>` records it once GitHub shows it merged.
- **gh could not merge** (a conflict, a required review, required checks still running): `lcw ledger "wave <n>: gh could not merge: <gh's words>"`, and the pass stops there. The next pass, or the end, tries it once more; if that fails too (the ledger shows whether it failed so in an earlier pass), it stays open, with every wave after it, and the end report gives gh's words.
- **gh could not read #N**: the pass stops there; the next pass tries it again, and the end counts it as gh could not merge.
- **Wave <m> is not merged yet; waves merge in order**: merge wave <m> first; the pass goes in order, so it comes to it first anyway.
- **Merged into another branch** than the default one: its changes have not landed and it needs the human. It stays open, with every wave after it, and the end report says why.

In every other case LCW does not read or act on CI.

**One at the end**, or no GitHub remote: no push and no pull request, and no wave branch is pushed until the sweep ends; `lcw wave shipped --wave <n>`. With no remote, note it in the ledger; the end of the sweep tells the human.

Then, if the charter's earlier end is reached (a number of waves, a share of the week from `lcw usage`, a number of fixes counted as `fixed` in `lcw status`, where a partly fixed one does not count), go to stages/hunt.md and do "Ending the sweep"; it ends with "Afterwards: clean up" above. Otherwise the next wave may already be under way: carry each open wave on from its stage. If a wave is queued and not started, start it as stages/plan.md says once `lcw wave start` allows it; if none is queued, look at the last round of Hunt. If it sorted fixes and every open wave is built, a new round starts as stages/hunt.md says, unless one is already under way. If it sorted nothing to fix, no new round starts: the sweep ends once every open wave has shipped (stages/hunt.md, "Ending the sweep"), after the one follow-up round where that round was an early one. A `lcw stage Hunt` that starts no round says so; it never means a new round began. Checkpoint with a next step that names every open wave, and do as it says (SKILL.md, Compaction).
