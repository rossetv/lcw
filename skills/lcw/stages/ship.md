# Ship

The draft pull request is what the human comes back to, so you write its text yourself.

`lcw set health="opening the draft pull request"`, or `health="leaving the branch for your review"` when there is no GitHub remote. The review has run the tests. Check with `git status` that everything is committed and the worktree is clean; if it is not, launch a worker to sort it out.

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

In a sweep this part runs once, when the sweep ends, never after a wave. Step 2 compares HEAD with the remote branch it was pushed to: `lcw/<name>` only in one at the end, and in stacked or merged as it goes, where `lcw/<name>` is never pushed, the last wave's branch `lcw/<name>-wave-<n>` and its remote. Step 3 removes every local wave branch too.

1. Leave the worktree: call ExitWorktree with action "keep". The session is back in the main checkout, where a new run can start.
2. Check that nothing would be lost. `git -C <worktree> status --porcelain --untracked-files=all` must print nothing, `git -C <worktree> ls-files --others --ignored --exclude-standard --directory` must print nothing (`git worktree remove` deletes ignored files, such as a `.env`, without asking), and `git -C <worktree> rev-parse HEAD` must equal `git rev-parse origin/lcw/<name>`. If any check fails, remove nothing, and tell the human what is left in the worktree.
3. Remove the worktree with `git worktree remove <worktree>`, then the local branch with `git branch -D lcw/<name>` (in a sweep, and each `lcw/<name>-wave-<n>`). The `-D` is needed because the branch is not in the local default branch yet; the pushed copy is the one that counts.
4. Delete the temporary files the run made outside the repository, such as its scratchpad files and the pull request's body file.

Tell the human it is cleaned up, and that `gh pr checkout <number>` brings the branch back if they want to look at it locally.

With no remote, the branch is the only copy of the change. Check only that the worktree has nothing uncommitted, then remove the worktree and the temporary files, and keep the branch.

If the human then has you merge the pull request, delete its branch on GitHub as well (`gh pr merge --delete-branch`), then run `git fetch --prune` and bring the main checkout up to date: when it is on the default branch and `git status --porcelain --untracked-files=no` prints nothing, `git pull --ff-only`. If it is on another branch, has uncommitted changes or cannot fast-forward, leave it as it is and tell the human why. A merge the human makes on GitHub needs nothing here: `lcw worktree` brings the main checkout up to date when the next run starts.

What the human asks for next is a new request: a large one is a new run, and a small one is made only on their go-ahead, as SKILL.md says.

## In a sweep

A wave ships to the sweep's branch, in the way charter.md picks for its pull requests (`lcw status` prints the choice). The worktree and every branch stay until the sweep ends: a wave does none of "Afterwards: clean up", and records no closing counts, since `lcw wave shipped` keeps the sweep's totals. With the worktree clean, as above:

**A wave with no commits** (every fix dropped or parked: `git rev-list --count lcw/<name>..HEAD` prints 0) has nothing to push, whatever the choice: `lcw wave shipped`, with no push and no pull request.

**Stacked, or merged as it goes.** The wave pushes its own branch, never `lcw/<name>`, which these two never push. Write the text as above, from charter.md, the wave's fixes in findings.md and the ledger, then:

```
git push -u origin lcw/<name>-wave-<n>
gh pr create --draft --head lcw/<name>-wave-<n> --base <base> --title "<title>" --body-file <file>
lcw wave shipped --pr <number>
```

Between the push and the pull request, check (here and anywhere else this file compares HEAD with a remote branch, in a sweep) that `git rev-parse HEAD` equals `git rev-parse origin/lcw/<name>-wave-<n>`. The base is the branch of the last earlier wave that has an unmerged pull request (`gh pr view <number> --json state`), else the default branch.

If the push or the pull request needs something only the human can give (the token has no write access, say), run `lcw wave shipped` with no `--pr`, `lcw ask` it as SKILL.md says, and carry on with the next wave's Plan, Build and Review. Its push and pull request wait for the answer, and so do those of every later wave, since each is stacked on it: each of those ships with `lcw wave shipped` alone. Once the human answers, push them and open their pull requests in order, each against the base above, and record each with `lcw wave pr <n> <url>`.

**Merged as it goes**, then: go through the shipped waves not yet merged, in order, passing over a wave with no commits (`lcw status` shows it empty). The first wave that falls short stops the pass: it stays open, with every wave after it, until a pass finds it meets the charter's criteria. Each pass looks at every one of them again, from the first; only the last two cases below leave a wave open for good. A wave whose pull request waits on the human's answer falls short.

Where the criteria name GitHub's checks, a pass after a wave ships only looks (`gh pr checks <number> -R <repo>`, never `--watch`) and never waits; at the end, watch them (`gh pr checks <number> -R <repo> --watch`) in Bash calls of up to 10 minutes each, at most an hour in all; checks not reported 10 minutes after the pull request was opened or reopened count as none, and none run, or all skipped, is not passed.

A wave whose checks have not passed, or that misses any other criterion, falls short. One that meets them all: `lcw merge <wave>`, and act on what it says.

- **Merged.** The next pull request is now against the default branch, which starts none of its checks: where the criteria name checks, `gh pr close <number>` and `gh pr reopen <number>` it so they run. Go on to the next wave.
- **Based on another branch** (an earlier wave's branch was not deleted, so GitHub did not retarget it; it prints a `gh pr edit` command): run that command, close and reopen the pull request where the criteria name checks, and look at the wave again from its checks, not straight at the merge.
- **Not merged yet** (a merge queue, or GitHub waiting on checks): it is still waiting, and the pass stops there. The next pass and the end look at it again; `lcw merge <wave>` records it once GitHub shows it merged.
- **gh could not merge** (a conflict, a required review, required checks still running): `lcw ledger "wave <n>: gh could not merge: <gh's words>"`, and the pass stops there. The next pass, or the end, tries it once more; if that fails too, it stays open, with every wave after it, and the end report gives gh's words.
- **Merged into another branch** than the default one: its changes have not landed and it needs the human. It stays open, with every wave after it, and the end report says why.

In every other case LCW does not read or act on CI.

**One at the end**, or no GitHub remote: no push and no pull request, and no wave branch is pushed until the sweep ends; `lcw wave shipped`. With no remote, note it in the ledger; the end of the sweep tells the human.

Then, if the charter's earlier end is reached (a number of waves, a share of the week from `lcw usage`), go to stages/hunt.md and do "Ending the sweep"; it ends with "Afterwards: clean up" below. Otherwise, if `lcw status` shows another wave queued, `lcw stage Plan` and `lcw checkpoint "Plan: read stages/plan.md and plan wave <n+1>"`; if none, `lcw stage Hunt` and `lcw checkpoint "Hunt: read stages/hunt.md and start round <r+1>"`. End your turn.
