// What git says of the folder a session works in, for the status line: the lines added and removed for its diff
// column, the branch and the main checkout that gives the repository's name.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fnv1a32hex } from '../../lib/key.mjs'
import { readJson, writeJson, mainCheckout } from './store.mjs'

// The status line runs every second; git runs at most once in this long for a folder, whatever the sessions.
const FRESH_MS = 15000
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

// It runs beside the person's own git commands, so it never takes the index lock to refresh the index.
// Its messages in English, so "not a git repository" can be told from any other failure.
const run = (cwd, ...args) => execFileSync('git', ['--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 2000, maxBuffer: 64 << 20, env: { ...process.env, LC_ALL: 'C' } })
const tryRun = (cwd, ...args) => { try { return run(cwd, ...args).trim() } catch { return null } }
const OUTSIDE = Symbol('outside git')
/** git's answer; OUTSIDE when git says the folder is in no repository, null when it fails in any other way. */
const answer = (cwd, ...args) => { try { return run(cwd, ...args).trim() } catch (e) { return /not a git repository/.test(String(e.stderr ?? '')) ? OUTSIDE : null } }
const verify = (cwd, ref) => tryRun(cwd, 'rev-parse', '--verify', '-q', ref + '^{commit}') !== null

/** Where the count starts: where the branch left the default branch; on the default branch itself, its last commit. */
function baseOf(top) {
  if (!verify(top, 'HEAD')) return EMPTY_TREE
  const remote = tryRun(top, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  const name = remote ? remote.replace(/^origin\//, '') : ['main', 'master'].find((b) => verify(top, 'refs/heads/' + b))
  if (!name || tryRun(top, 'rev-parse', '--abbrev-ref', 'HEAD') === name) return 'HEAD'
  // The newer of the local and the remote default branch that the branch grew from.
  const refs = [name, 'origin/' + name].filter((r) => verify(top, r))
  return (refs.length && tryRun(top, 'merge-base', 'HEAD', ...refs)) || 'HEAD'
}

/** Lines in a new file git does not track yet, counted as git would; a binary or very large file counts none. */
function linesIn(file) {
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > 1 << 20) return 0
    const buf = fs.readFileSync(file)
    if (buf.subarray(0, 8000).includes(0)) return 0
    let n = 0
    for (const b of buf) if (b === 10) n++
    return n + (buf.length && buf[buf.length - 1] !== 10 ? 1 : 0)
  } catch {
    return 0
  }
}

function count(top) {
  let added = 0, removed = 0
  for (const line of run(top, 'diff', '--numstat', baseOf(top)).split('\n')) {
    const [a, d] = line.split('\t')
    if (/^\d+$/.test(a) && /^\d+$/.test(d)) { added += Number(a); removed += Number(d) }
  }
  const untracked = run(top, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
  for (const f of untracked.slice(0, 2000)) added += linesIn(path.join(top, f))
  return { added, removed }
}

const ask = {
  diff: (cwd) => {
    const top = answer(cwd, 'rev-parse', '--show-toplevel')
    if (!top || top === OUTSIDE) return top
    try { return count(top) } catch { return null }
  },
  main: (cwd) => {
    const common = answer(cwd, 'rev-parse', '--git-common-dir')
    return common === OUTSIDE ? OUTSIDE : common === null ? cwd : mainCheckout(cwd)
  },
  // a repository with no commit yet has no branch to name
  branch: (cwd) => answer(cwd, 'rev-parse', '--abbrev-ref', 'HEAD') || null,
}
/**
 * The git figures of a folder that `want` names, each asked of git at most once in FRESH_MS and kept in a record of
 * that folder alone: diff ({added, removed}, null outside git or when git fails), main (mainCheckout's answer) and
 * branch (null outside git).
 */
export function gitOf(cwd, home, now, want) {
  const file = `${home}/cache/git-${fnv1a32hex(cwd)}.json`
  const kept = readJson(file)
  const facts = kept?.cwd === cwd && now - kept.at >= 0 && now - kept.at < FRESH_MS ? kept : { cwd, at: now }
  const missing = want.filter((k) => !Object.hasOwn(facts, k))
  if (!missing.length) return facts
  // A failure is kept too, so a slow repository costs one try in each stretch and not one every second. A folder
  // outside git gets no record: one for every folder a session ever stood in would pile up.
  let outside = false
  for (const k of missing) {
    const v = outside ? OUTSIDE : ask[k](cwd)
    outside ||= v === OUTSIDE
    facts[k] = v !== OUTSIDE ? v : k === 'main' ? cwd : null
  }
  if (!outside) try { writeJson(file, facts) } catch {}
  return facts
}

/** {added, removed} for the checkout holding cwd, against the files as they are now; null outside git or when git fails. */
export const diffOf = (cwd, home, now = Date.now()) => gitOf(cwd, home, now, ['diff']).diff
