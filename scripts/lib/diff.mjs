// Lines added and removed in the checkout a session works in, for the status line's diff column.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fnv1a32hex } from '../../lib/key.mjs'
import { readJson, writeJson } from './store.mjs'

// The status line runs every second; git runs at most once in this long for a checkout, whatever the sessions.
const FRESH_MS = 5000
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

// It runs beside the person's own git commands, so it never takes the index lock to refresh the index.
const run = (cwd, ...args) => execFileSync('git', ['--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, maxBuffer: 64 << 20 })
const tryRun = (cwd, ...args) => { try { return run(cwd, ...args).trim() } catch { return null } }
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

/** {added, removed} for the checkout holding cwd, against the files as they are now; null outside git or when git fails. */
export function diffOf(cwd, home, now = Date.now()) {
  const top = tryRun(cwd, 'rev-parse', '--show-toplevel')
  if (!top) return null
  const file = `${home}/cache/diff-${fnv1a32hex(top)}.json`
  const kept = readJson(file)
  if (kept && now - kept.at >= 0 && now - kept.at < FRESH_MS) return kept.failed ? null : { added: kept.added, removed: kept.removed }
  let found = null
  try { found = count(top) } catch {}
  // A failure is kept too, so a slow repository costs one try in each stretch and not one every second.
  try { writeJson(file, found ? { at: now, top, ...found } : { at: now, top, failed: true }) } catch {}
  return found
}
