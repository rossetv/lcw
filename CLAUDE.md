# Working on LCW

- Every change merged to main raises the version in `.claude-plugin/plugin.json`, its last number unless the change is large. Claude Code delivers an update to installed copies only when the version goes up: `claude plugin update` ignores new commits while the version is unchanged.
- Before running any test, point HOME and LCW_HOME at a scratch folder: `S=$(mktemp -d); export HOME=$S LCW_HOME=$S/.lcw`. The suites and the code under test write to the home folder, and a broken change once ran against a real one.
- Checks:
  - `node --test "tests/*/*.test.mjs"` runs the core, render and status suites.
  - `claude plugin test <plugin folder>` runs the mod's suite.
  - `claude plugin validate <plugin folder>` checks the manifest, the hooks and the types of the mod. It needs `.claude-plugin/types`, which the engine writes into a loaded plugin's folder and git ignores: a fresh worktree needs a copy from a checkout the engine has loaded.
- The mod (`hooks/register.tsx`) runs with no Node: it may import only pure code from `lib/`, nothing that uses a Node built-in.
- Commits: `type(scope): lowercase descriptive present tense, no full stop`, with type feat, fix, docs or test.