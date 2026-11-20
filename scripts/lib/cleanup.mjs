// What is safe to clean up in a repository, the cleanup box a check recorded, and removing what is still safe
// at the click. Only local branches and worktrees are ever touched: nothing is pushed and no remote ref changes.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { repoKey, runsDir, cleanupFile } from '../../lib/key.mjs'
import { git, mainCheckout, readJson, writeJson } from './store.mjs'
import { listRuns } from './runs.mjs'

const real = (p) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
const within = (p, dir) => p === dir || p.startsWith(dir + '/')
const tryGit = (cwd, ...args) => { try { return git(cwd, ...args) } catch { return null } }
const lines = (text) => (text ? text.split('\n').filter(Boolean) : [])
const ended = (state) => state.status === 'finished' || state.status === 'stopped'
const gitError = (e) => (String(e.stderr || e.message).trim().split('\n')[0] || 'git refused').replace(/^(error|fatal): /, '')

/** origin/HEAD when it is set, else main, else master; null when there is none. */
export function defaultBranch(main) {
  const head = tryGit(main, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD')
  if (head) return head.replace(/^origin\//, '')
  return ['main', 'master'].find((b) => tryGit(main, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`) !== null
    || tryGit(main, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${b}`) !== null) || null
}

function worktreeList(main) {
  return git(main, 'worktree', 'list', '--porcelain').split('\n\n').filter(Boolean).map((block) => {
    const w = { branch: null }
    for (const line of block.split('\n')) {
      const at = line.indexOf(' ')
      const [k, v] = at < 0 ? [line, ''] : [line.slice(0, at), line.slice(at + 1)]
      if (k === 'worktree') w.path = real(v)
      else if (k === 'HEAD') w.head = v
      else if (k === 'branch') w.branch = v.replace(/^refs\/heads\//, '')
      else if (k === 'bare' || k === 'locked' || k === 'prunable') w[k] = true
    }
    return w
  })
}

/** Merged pull requests as gh sees them; [] when gh is missing, signed out, has no GitHub remote or says anything odd. */
function mergedPulls(main) {
  try {
    const out = execFileSync('gh', ['pr', 'list', '--state', 'merged', '--json', 'number,baseRefName,headRefName,headRefOid', '--limit', '300'], {
      cwd: main, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    })
    const list = JSON.parse(out)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** Live Claude Code sessions' folders (real paths), from Claude Code's own session files (pid and cwd). */
export function sessionFolders() {
  const dir = `${process.env.CLAUDE_CONFIG_DIR || `${process.env.HOME}/.claude`}/sessions`
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')) } catch {}
  const alive = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
  }
  return names.map((n) => readJson(`${dir}/${n}`)).filter((s) => s && typeof s.cwd === 'string' && alive(s.pid)).map((s) => real(s.cwd))
}

/**
 * Every local branch but the default one and every worktree but the main checkout, each with why it counts as done
 * with (why) or why it is not safe to remove (not). A branch checked out only in worktrees that are themselves safe
 * carries those worktrees: it becomes safe once they are removed.
 */
function survey(cwd, lcwHome) {
  if (tryGit(cwd, 'rev-parse', '--git-dir') === null) return { main: cwd, key: null, items: [] } // not a git repository
  const main = mainCheckout(cwd)
  const here = real(cwd)
  const key = repoKey(main)
  const base = defaultBranch(main)
  const refs = base ? [`refs/heads/${base}`, `refs/remotes/origin/${base}`].filter((r) => tryGit(main, 'rev-parse', '--verify', '--quiet', r) !== null) : []
  const inBase = new Set(refs.flatMap((r) => lines(git(main, 'for-each-ref', `--merged=${r}`, '--format=%(refname)', 'refs/heads'))))
  const commitInBase = (sha) => refs.some((r) => tryGit(main, 'merge-base', '--is-ancestor', sha, r) !== null)

  const branches = lines(git(main, 'for-each-ref', '--format=%(refname)%09%(objectname)%09%(committerdate:iso-strict)', 'refs/heads'))
    .map((l) => l.split('\t')).map(([ref, head, date]) => ({ ref, name: ref.replace(/^refs\/heads\//, ''), head, lastCommit: date }))
    .filter((b) => b.name !== base)
  let pulls = null
  // a pull request counts only when it went into the default branch and the branch has nothing after what it merged
  const mergedWhy = (b) => {
    if (inBase.has(b.ref)) return `in ${base}`
    pulls ??= mergedPulls(main)
    const pr = pulls.find((p) => p && p.baseRefName === base && p.headRefName === b.name && p.headRefOid === b.head)
    return pr ? `PR #${pr.number} merged` : null
  }
  const branchWhy = new Map(branches.map((b) => [b.name, mergedWhy(b)]))

  const runs = listRuns(runsDir(lcwHome, key)).map((r) => r.state)
  const live = runs.filter((s) => !ended(s))
  const sessions = sessionFolders()

  const trees = worktreeList(main).filter((w) => w.path && w.path !== real(main) && !w.bare).map((w) => {
    const t = { type: 'worktree', path: w.path, branch: w.branch, head: w.head }
    const liveRun = live.find((s) => s.worktree && real(s.worktree) === w.path)
    const endedRun = runs.find((s) => ended(s) && s.worktree && real(s.worktree) === w.path)
    // The folder was deleted by hand: only git's record of it is left. A branch keeps its commits when that record
    // goes; a detached commit that is nowhere else would be lost with it, so that worktree stays.
    const gone = !!w.prunable && !w.locked
    if (w.locked) t.not = 'it is locked'
    else if (gone && liveRun) t.not = `LCW run ${liveRun.id} is ${liveRun.status} in it`
    else if (gone && !w.branch && !commitInBase(w.head)) t.not = `its detached commit is not in ${base || 'the default branch'}`
    else if (gone) {}
    else if (within(here, w.path)) t.not = 'this session is in it'
    else if (liveRun) t.not = `LCW run ${liveRun.id} is ${liveRun.status} in it`
    else if (sessions.some((s) => within(s, w.path))) t.not = 'an open session is in it'
    else if (!w.branch && !commitInBase(w.head)) t.not = `its detached commit is not in ${base || 'the default branch'}`
    else {
      const status = tryGit(w.path, 'status', '--porcelain', '--untracked-files=all')
      if (status === null) t.not = 'git cannot read it'
      else if (status) t.not = 'it has uncommitted or untracked changes'
      // git worktree remove deletes ignored files too (.env, node_modules), so a worktree holding any is not safe
      else if (tryGit(w.path, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory') !== '') t.not = 'it holds ignored files'
    }
    const merged = w.branch ? branchWhy.get(w.branch) : (commitInBase(w.head) ? `in ${base}` : null)
    if (gone && !t.not) t.why = 'its folder is gone'
    else if (endedRun) t.why = `LCW run ${endedRun.id} ${endedRun.status}`
    else if (merged) t.why = `branch ${merged}`
    else t.not ??= 'its branch is not merged'
    return t
  })
  const safeTrees = new Set(trees.filter((t) => !t.not).map((t) => t.path))
  const all = worktreeList(main)

  const items = branches.map((b) => {
    const item = { type: 'branch', name: b.name, head: b.head, why: branchWhy.get(b.name), lastCommit: b.lastCommit }
    const run = live.find((s) => s.branch === b.name)
    const out = all.filter((w) => w.branch === b.name).map((w) => w.path)
    if (run) item.not = `it is the branch of LCW run ${run.id}, which is ${run.status}`
    else if (!item.why) item.not = 'it is not merged'
    else if (out.some((p) => !safeTrees.has(p))) item.not = `it is checked out in ${out.find((p) => !safeTrees.has(p))}`
    else if (out.length) item.worktree = out[0]
    return item
  })
  return { main, key, items: [...trees, ...items] }
}

const clean = ({ not, ...item }) => item

/** What is safe to clean up here, with the facts a person judges from. [] when nothing is. */
export function candidates(cwd, lcwHome) {
  return survey(cwd, lcwHome).items.filter((i) => !i.not).map(clean)
}

export const boxFile = (cwd, lcwHome) => cleanupFile(lcwHome, repoKey(mainCheckout(cwd)))

export const recorded = (cwd, lcwHome) => readJson(boxFile(cwd, lcwHome))

const same = (spec) => (i) => i.type === spec.type && (spec.type === 'branch' ? i.name === spec.name : i.path === spec.path)
const label = (i) => `${i.type} ${i.type === 'branch' ? i.name : i.path}`

// A whole name: not inside a longer branch name or path, so "fix" is not named by "fix-login-timeout". A full stop ends
// a sentence only when no name character follows it.
const mentions = (text, name) => new RegExp(`(?<![\\w/.-])${name.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')}(?![\\w/-]|\\.[\\w/-])`).test(text)

const MAX_BULLETS = 4
const MAX_TEXT = 200

/** Records the box: its title, bullets and items, each item with its head now. Refuses an item that is not safe now. */
export function record(cwd, lcwHome, { title, bullets = [], items = [] }) {
  if (!title) throw new Error('record needs --title')
  if (!items.length) throw new Error('record needs at least one --item')
  if (bullets.length > MAX_BULLETS) throw new Error(`record takes at most ${MAX_BULLETS} bullets, not ${bullets.length}; keep the most important. Nothing was recorded.`)
  if ([title, ...bullets].some((t) => t.length > MAX_TEXT)) throw new Error(`the title and each bullet must be under ${MAX_TEXT} characters; write them shorter. Nothing was recorded.`)
  const { items: now } = survey(cwd, lcwHome)
  const specs = []
  for (const text of items) {
    const m = /^(branch|worktree):(.+)$/.exec(text)
    if (!m) throw new Error(`--item must be branch:<name> or worktree:<path>, not "${text}"`)
    const spec = m[1] === 'branch' ? { type: 'branch', name: m[2] } : { type: 'worktree', path: real(path.resolve(cwd, m[2])) }
    if (!specs.some(same(spec))) specs.push(spec)
  }
  const picked = specs.map((spec) => {
    const cur = now.find(same(spec))
    if (!cur) throw new Error(`${label(spec)} does not exist. Nothing was recorded.`)
    if (cur.not) throw new Error(`${label(spec)} is not safe to clean up: ${cur.not}. Nothing was recorded.`)
    const text = [title, ...bullets].join('\n')
    const named = spec.type === 'branch' ? mentions(text, spec.name) : mentions(text, spec.path) || mentions(text, path.basename(spec.path))
    if (!named) throw new Error(`the title and bullets never name ${label(spec)}; name every item in them. Nothing was recorded.`)
    if (cur.worktree && !specs.some(same({ type: 'worktree', path: cur.worktree }))) {
      throw new Error(`${label(spec)} is checked out in ${cur.worktree}; name that worktree too. Nothing was recorded.`)
    }
    return cur.type === 'branch' ? { type: 'branch', name: cur.name, head: cur.head } : { type: 'worktree', path: cur.path, head: cur.head }
  })
  const box = { at: Date.now(), title, bullets, items: picked }
  writeJson(boxFile(cwd, lcwHome), box)
  return box
}

/** True when every item of a recorded box is still a candidate at its recorded head, so the box can still be clicked. */
export function boxCurrent(cwd, lcwHome, box) {
  const now = candidates(cwd, lcwHome)
  return (Array.isArray(box.items) ? box.items : []).every((item) => now.some((c) => same(item)(c) && c.head === item.head))
}

/**
 * Removes the recorded items that are still safe and unchanged, worktrees first, then branches, and forgets the box.
 * Returns { removed, skipped: [{ item, reason }] }, or null when no box is recorded.
 */
export function apply(cwd, lcwHome) {
  const file = boxFile(cwd, lcwHome)
  const box = readJson(file)
  if (!box) return null
  const items = Array.isArray(box.items) ? box.items : []
  const removed = []
  const skipped = []
  const check = (now, item) => {
    const cur = now.find(same(item))
    if (!cur) return 'it no longer exists'
    if (cur.head !== item.head) return 'it changed since the box was drawn'
    if (cur.not) return cur.not
    if (cur.worktree) return `it is still checked out in ${cur.worktree}`
    return null
  }
  const pass = (type, remove) => {
    const { main, items: now } = survey(cwd, lcwHome)
    for (const item of items.filter((i) => i.type === type)) {
      const reason = check(now, item)
      if (reason) { skipped.push({ item, reason }); continue }
      try { remove(main, now.find(same(item))); removed.push(item) } catch (e) { skipped.push({ item, reason: gitError(e) }) }
    }
  }
  pass('worktree', (main, cur) => git(main, 'worktree', 'remove', cur.path))
  // check() has confirmed it is still merged (into the default branch or its origin, or by a pull request) at the recorded head;
  // -d would refuse a branch that only origin/<default> holds while the local one is behind
  pass('branch', (main, cur) => git(main, 'branch', '-D', '--', cur.name))
  for (const item of items.filter((i) => i.type !== 'worktree' && i.type !== 'branch')) skipped.push({ item, reason: 'unknown kind of item' })
  fs.rmSync(file, { force: true })
  return { removed, skipped }
}
