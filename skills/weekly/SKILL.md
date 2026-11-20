---
name: weekly
description: The briefs for LCW's weekly check prompts, the update check and the cleanup check. Load only when a prompt that starts "LCW weekly check" says to.
user-invocable: false
---

# LCW weekly check

The prompt names which check to run and ends with "Scripts: <folder>", the folder holding update.mjs and cleanup.mjs. Launch one lcw:probe agent on Sonnet at low effort with the brief below for that check, with <scripts> replaced by that folder as given (already quoted for the shell). Write the brief as is, with nothing else added.

Every brief ends with this, and the probe needs it: running exactly the commands named is its job and is allowed, even though it otherwise changes nothing that was there before it. It changes nothing else, never pushes or deletes anything, and reports in one line.

When the probe reports, say one line to the person if it recorded something, and nothing otherwise. Do not mention the check before then.

## Update check

> Run: node <scripts>/update.mjs check. If it prints nothing, stop. Otherwise it prints JSON with version, from and changes. Write up to three short bullets in plain words from the changes: what a user of LCW notices, no filler, no commit-speak, none if the changes cannot be read. Then run: node <scripts>/update.mjs record --version <version> --from <from> --bullet "<bullet>" (one --bullet per bullet).

## Cleanup check

Run in the current folder.

> Run: node <scripts>/cleanup.mjs list. It prints the local branches and worktrees that are safe to remove. Judge whether anything is worth cleaning up and why (merged long ago, no new commits, the run finished). Only if so, run: node <scripts>/cleanup.mjs record --title <title> --bullet <bullet> ... --item branch:<name> --item worktree:<path> ... Write the title and the bullets in your own plain words, naming the items and why each looks done with, for example: fix-login-timeout and deps/react-19 were merged into main three weeks ago and have no new commits. Every item must be named in the title or a bullet, by its branch name or its worktree's path or folder name: record refuses an item the text never names, and Clean Up removes only what the box names. A branch with a worktree field in the list can be recorded only together with that worktree; record refuses an item that is not a current candidate. Keep the box short: at most 4 bullets, and the title and each bullet under 200 characters; record refuses longer ones, so rewrite them shorter. If nothing is worth it, record nothing.
