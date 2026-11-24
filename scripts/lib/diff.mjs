// What git says of the folder a session works in, for the status line: the lines added and removed for its diff
// column, the branch and the main checkout that gives the repository's name.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fnv1a32hex } from '../../lib/key.mjs'
import { readJson, writeJson } from './store.mjs'

// The status line runs every second; git runs at most once in this long for a folder, whatever the sessions, unless
// a caller asks for figures fresher than that.
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
function baseOf(top, branch) {
  if (!verify(top, 'HEAD')) return EMPTY_TREE
  const remote = tryRun(top, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  const name = remote ? remote.replace(/^origin\//, '') : ['main', 'master'].find((b) => verify(top, 'refs/heads/' + b))
  if (!name || branch() === name) return 'HEAD'
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

function count(top, branch) {
  let added = 0, removed = 0
  for (const line of run(top, 'diff', '--numstat', baseOf(top, branch)).split('\n')) {
    const [a, d] = line.split('\t')
    if (/^\d+$/.test(a) && /^\d+$/.test(d)) { added += Number(a); removed += Number(d) }
  }
  const untracked = run(top, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
  for (const f of untracked.slice(0, 2000)) added += linesIn(path.join(top, f))
  return { added, removed }
}

// Each question is asked of git once in a refresh, whoever needs the answer.
const ask = {
  diff: (cwd, said) => {
    const top = said.toplevel()
    if (!top || top === OUTSIDE) return top
    try { return count(top, said.branch) } catch { return null }
  },
  main: (cwd, said) => {
    const common = said.common()
    if (common === OUTSIDE) return OUTSIDE
    if (common === null) return cwd
    try {
      // Not --path-format=absolute, which git before 2.31 prints back as output: git's answer can be relative to the real cwd.
      const real = fs.realpathSync(path.resolve(fs.realpathSync(cwd), common))
      if (path.basename(real) === '.git') return path.dirname(real)
      const top = said.toplevel()
      return typeof top === 'string' && top ? top : cwd
    } catch {
      return cwd
    }
  },
  // a repository with no commit yet has no branch to name
  branch: (cwd, said) => said.branch() || null,
}
const asking = (cwd) => {
  const once = (...args) => { let v, done = false; return () => (done ? v : (done = true, v = answer(cwd, ...args))) }
  return { toplevel: once('rev-parse', '--show-toplevel'), common: once('rev-parse', '--git-common-dir'), branch: once('rev-parse', '--abbrev-ref', 'HEAD') }
}
/**
 * The git figures of a folder that `want` names, kept in a record of that folder alone and asked of git again once
 * the record is `fresh` ms old (FRESH_MS at most): diff ({added, removed}, null outside git or when git fails), main
 * (mainCheckout's answer) and branch (null outside git).
 */
export function gitOf(cwd, home, now, want, fresh = FRESH_MS) {
  const file = `${home}/cache/git-${fnv1a32hex(cwd)}.json`
  const kept = readJson(file)
  const facts = kept?.cwd === cwd && now - kept.at >= 0 && now - kept.at < Math.min(fresh, FRESH_MS) ? kept : { cwd, at: now }
  const missing = want.filter((k) => !Object.hasOwn(facts, k))
  if (!missing.length) return facts
  // A failure is kept too, so a slow repository costs one try in each stretch and not one every second. A folder
  // outside git gets no record: one for every folder a session ever stood in would pile up.
  let outside = false
  const said = asking(cwd)
  for (const k of missing) {
    const v = outside ? OUTSIDE : ask[k](cwd, said)
    outside ||= v === OUTSIDE
    facts[k] = v !== OUTSIDE ? v : k === 'main' ? cwd : null
  }
  if (!outside) try { writeJson(file, facts) } catch {}
  return facts
}
