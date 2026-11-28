import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, git, lcw, readJson } from './helpers.mjs'

/** A repo with a GitHub origin, a home and a started sweep. */
export function sweep(name = 'tidy') {
  const home = tmp('home')
  const repo = makeRepo()
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
  const o = { home, cwd: repo, session: 's1' }
  const started = lcw(['start', name, '--title', 'Tidy the backlog', '--shape', 'sweep'], o)
  const dir = /^folder: (.+)$/m.exec(started.out)[1]
  const state = () => readJson(`${dir}/state.json`)
  const edit = (fn) => { const s = state(); fn(s); fs.writeFileSync(`${dir}/state.json`, JSON.stringify(s)) }
  return { home, repo, o, dir, started, state, edit, cli: (...a) => lcw(a, o) }
}

/** A sweep past its charter, in Hunt, with its branch; start() starts the front queued wave and sets wt to its worktree. */
export function hunting(name) {
  const t = sweep(name)
  fs.writeFileSync(`${t.dir}/charter.md`, 'goals: fix the backlog\n')
  t.cli('approval')
  t.cli('stage', 'Hunt')
  t.cli('worktree')
  t.start = (...a) => {
    const r = t.cli('wave', 'start', ...a)
    if (r.code === 0) t.wt = /^worktree: (.+)$/m.exec(r.out)[1]
    return r
  }
  // the only open wave's final checks pass on its head as it is, and it ships
  t.ship = (...a) => {
    t.cli('wave', 'step', 'final checks')
    t.cli('wave', 'step', 'merging')
    return t.cli('wave', 'shipped', ...a)
  }
  return t
}

/** A sweep in Ship with wave 1 (of the given size) running and its worktree. */
export function shipping(fixes = 3, name) {
  const t = hunting(name)
  t.cli('wave', 'add', String(fixes))
  t.start()
  t.cli('stage', 'Ship')
  return t
}

export function commit(wt, file, text) {
  fs.writeFileSync(`${wt}/${file}`, text)
  git(wt, 'add', file)
  git(wt, 'commit', '-q', '-m', `change ${file}`)
  return git(wt, 'rev-parse', 'HEAD')
}

export function fakeGh(more = {}) {
  const bin = tmp('bin')
  const log = `${bin}/calls`
  fs.writeFileSync(`${bin}/gh`, `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in *--delete-branch*) echo "gh must not delete the branch" >&2; exit 1;; esac
if [ -n "$GH_UNDO_FAIL" ] && echo "$*" | grep -q -- --undo; then echo "cannot undo" >&2; exit 1; fi
if [ "$1 $2" = "$GH_FAIL" ]; then echo "GraphQL: not mergeable" >&2; exit 1; fi
if [ "$1 $2" = "pr merge" ] && [ -n "$GH_SLEEP" ]; then sleep "$GH_SLEEP"; fi
if [ "$1 $2" = "pr view" ]; then
  states="\${GH_STATE:-OPEN,MERGED}"
  state=$(echo "$states" | cut -d, -f"$(grep -c '^pr view.*state' "${log}")")
  [ -n "$state" ] || state=$(echo "$states" | awk -F, '{print $NF}')
  echo "{\\"state\\":\\"$state\\",\\"isDraft\\":\${GH_DRAFT:-true},\\"baseRefName\\":\\"\${GH_BASE:-main}\\",\\"headRefOid\\":\\"\${GH_HEAD:-abc123}\\"}"
fi
if [ "$1 $2" = "pr checks" ]; then
  out=$(printf '%s' "$GH_CHECKS" | cut -d'|' -f"$(grep -c '^pr checks' "${log}")")
  [ -n "$out" ] || out=$(printf '%s' "$GH_CHECKS" | awk -F'|' '{print $NF}')
  case "$out" in
    NONE) echo "no checks reported on the 'lcw/tidy-wave-1' branch" >&2; exit 1;;
    ERR) echo "connection reset by peer" >&2; exit 1;;
  esac
  echo "$out"
  case "$out" in *pending*) exit 8;; *fail*) exit 1;; esac
fi
if [ "$1 $2" = "pr list" ]; then echo "\${GH_LIST:-[]}"; fi
if [ "$1 $2" = "repo view" ]; then echo '{"defaultBranchRef":{"name":"main"}}'; fi
if [ "$1" = "api" ] && [ -n "$GH_API_ERROR" ]; then echo "$GH_API_ERROR" >&2; exit 1; fi
exit 0
`, { mode: 0o755 })
  return { env: { PATH: `${bin}:${process.env.PATH}`, ...more }, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) }
}

/** Waves 1 and 2 started: wave 1 with a commit, in Review; wave 2 cut from it, in Build. at(n, ...) runs a command for wave n. */
export function overlapping(prs) {
  const t = hunting()
  if (prs) t.cli('set', `sweep.prs=${prs}`)
  t.cli('wave', 'add', '1', '1')
  t.start()
  const wt1 = t.wt
  commit(wt1, 'b.txt', 'one\n')
  t.cli('stage', 'Review')
  t.start()
  const at = (n, ...a) => t.cli(...a, '--wave', String(n))
  at(2, 'stage', 'Build')
  return { ...t, wt1, wt2: t.wt, at, w: (n) => t.state().sweep.waves[n - 1] }
}

/** overlapping(), with both waves in Ship and wave 1's final checks passed: it is merging. */
export function bothShipping() {
  const t = overlapping()
  t.at(2, 'stage', 'Review')
  t.at(1, 'stage', 'Ship')
  t.at(2, 'stage', 'Ship')
  commit(t.wt1, 'd.txt', 'closure\n')
  return t
}

/** A sweep with wave 1 and 2 shipped with pull requests 12 and 13, pull requests merged as it goes unless prs says otherwise. */
export function shippedWaves(prs = 'merged') {
  const t = sweep()
  t.cli('set', `sweep.prs=${prs}`)
  t.edit((s) => {
    s.sweep.waves = [1, 2].map((n) => ({ n, fixes: 1, status: 'shipped', branch: `lcw/tidy-wave-${n}`, pr: 11 + n, merged: false, dropped: 0, fixed: 1 }))
  })
  return t
}

export const checks = (...buckets) => JSON.stringify(buckets.map((bucket, i) => ({ name: `job${i}`, bucket })))
/** A fake gh whose pull request shows these checks, one entry for each look; a wait's minute lasts 40 ms, and it looks twice a minute. */
export const waiting = (list, more = {}) => fakeGh({ GH_CHECKS: list, GH_STATE: 'OPEN,OPEN,MERGED', LCW_CHECKS_MINUTE_MS: '40', ...more })

/** A sweep with waves 1 and 2 open, each with its own folder as its worktree, written straight into the state. */
export function twoOpen() {
  const t = hunting()
  const wts = [1, 2].map(() => tmp('wave'))
  t.edit((s) => {
    s.stage = 'Build'
    s.sweep.waves = [1, 2].map((n) => ({
      n, fixes: 2, status: 'running', branch: `lcw/tidy-wave-${n}`, pr: null, merged: false, dropped: 0, stage: n === 1 ? 'Review' : 'Build',
      stageSince: 0, step: null, round: n === 1 ? 1 : 0, waiting: false, tasks: [], requirements: [], plan: { tasks: 0, atOnce: 0, models: {} },
      milestone: null, worktree: wts[n - 1], after: n === 1 ? 'lcw/tidy' : 'lcw/tidy-wave-1', base: null, checked: null,
    }))
  })
  const wave = (n) => t.state().sweep.waves[n - 1]
  return { ...t, wts, wave, at: (where, ...a) => lcw(a, { ...t.o, cwd: where }) }
}

/** Waves 1 to 3 queued, wave 1 started with a commit and in Review; ok runs a command that must pass, wt is the newest started wave's worktree. */
export function three() {
  const t = hunting()
  t.cli('wave', 'add', '1', '1', '1')
  t.start()
  const wt1 = t.wt
  commit(wt1, 'b.txt', 'one\n')
  t.cli('stage', 'Review')
  const ok = (...a) => { const r = t.cli(...a); assert.equal(r.code, 0, `${a.join(' ')}\n${r.out}`); return r }
  return { ...t, wt1, ok, w: (n) => t.state().sweep.waves[n - 1], get wt() { return t.wt } }
}

/** Waves 1 and 2 both holding in Ship, each with a commit, and wave 1 with a closure wave 2 has not taken in. */
export function holdingWithClosure(closure = ['d.txt', 'closure\n']) {
  const t = overlapping()
  commit(t.wt2, 'e.txt', 'wave 2 fix\n')
  t.at(2, 'stage', 'Review')
  t.at(1, 'stage', 'Ship')
  t.at(2, 'stage', 'Ship')
  commit(t.wt1, ...closure)
  return t
}
