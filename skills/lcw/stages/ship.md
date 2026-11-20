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

1. Leave the worktree: call ExitWorktree with action "keep". The session is back in the main checkout, where a new run can start.
2. Check that nothing would be lost. `git -C <worktree> status --porcelain` must print nothing, and `git -C <worktree> rev-parse HEAD` must equal `git rev-parse origin/lcw/<name>`. If either check fails, remove nothing, and tell the human what is left in the worktree.
3. Remove the worktree with `git worktree remove <worktree>`, then the local branch with `git branch -D lcw/<name>`. The `-D` is needed because the branch is not in the local default branch yet; the pushed copy is the one that counts.
4. Delete the temporary files the run made outside the repository, such as its scratchpad files and the pull request's body file.

Tell the human it is cleaned up, and that `gh pr checkout <number>` brings the branch back if they want to look at it locally.

With no remote, the branch is the only copy of the change. Check only that the worktree has nothing uncommitted, then remove the worktree and the temporary files, and keep the branch.

If the human then has you merge the pull request, delete its branch on GitHub as well (`gh pr merge --delete-branch`), then run `git fetch --prune` and bring the main checkout up to date: when it is on the default branch and `git status --porcelain --untracked-files=no` prints nothing, `git pull --ff-only`. If it is on another branch, has uncommitted changes or cannot fast-forward, leave it as it is and tell the human why. A merge the human makes on GitHub needs nothing here: `lcw worktree` brings the main checkout up to date when the next run starts.

What the human asks for next is a new request: a large one is a new run, and a small one is made only on their go-ahead, as SKILL.md says.
