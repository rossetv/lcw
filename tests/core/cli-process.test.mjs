import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmp, makeRepo, git, lcw, cli } from './helpers.mjs'

// Each family's calls run twice in the same folders, once through the real program and once in-process through
// cli(), and must print the same, exit the same and leave the same files.

const okQuota = JSON.stringify({ v: 1, status: 'ok', accountKey: 'a'.repeat(64), weekly: { percentUsed: 42, resetsAt: '2027-01-02T12:00:00.000Z' }, blocked: false })
const quotaCmd = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`process.stdout.write(${JSON.stringify(okQuota)})`)}`
const GH = `#!/bin/sh
case "$1 $2" in
  "pr view") echo '{"state":"OPEN","isDraft":true,"baseRefName":"main","headRefOid":"abc123"}';;
  "repo view") echo '{"defaultBranchRef":{"name":"main"}}';;
  "pr list") echo '[]';;
esac
`

const runDir = (w) => {
  const repos = `${w.home}/repos`
  for (const r of fs.readdirSync(repos)) for (const id of fs.readdirSync(`${repos}/${r}/runs`)) return `${repos}/${r}/runs/${id}`
}
const editState = (w, fn) => {
  const file = `${runDir(w)}/state.json`
  const s = JSON.parse(fs.readFileSync(file, 'utf8'))
  fn(s)
  fs.writeFileSync(file, JSON.stringify(s))
}
// no session has shown the run for 20 minutes, so another may take it over or abandon it
const leftAlone = (w) => {
  const dir = runDir(w)
  const old = new Date(Date.now() - 20 * 60000)
  fs.writeFileSync(`${dir}/mod-alive`, String(old.getTime()))
  for (const f of ['state.json', 'ledger.md', 'mod-alive']) fs.utimesSync(`${dir}/${f}`, old, old)
}
const sweep = ['start', 'tidy', '--title', 'Tidy the backlog', '--shape', 'sweep']

// a call is its arguments, { args, session }, or a change to the files made between calls; ID stands for the run's id
const families = [
  ['help and argument errors', [[], ['help'], ['nonsense'], ['status', '--frob'], ['--session'], ['ledger', '-x'], ['status', '--bypass', ' '], ['status']]],
  ['run', [['start', 'demo', '--title', 'Demo run'], ['status'], ['stage', 'Spec'], ['task', 'add', 'T1', 'Build it'], ['task', 'T1', 'nope'], ['ledger', 'picked', 'it'],
    ['stage', 'Build', '--bypass', 'testing'], ['stage', 'Spec'], ['worktree'], ['where', '--json'], { args: ['start', 'two', '--title', 'Two'], session: 's2' }, ['runs']]],
  ['sweep', [sweep, ['approval'], ['stage', 'Hunt'], ['stage', 'Hunt', '--bypass', 'charter settled by hand'], ['worktree'], ['wave', 'add', '2', '1'], ['wave', 'start'],
    ['wave', 'start'], ['stage', 'Review'], ['stage', 'Review', '--wave', '1'], ['status']]],
  ['merge', [sweep, ['merge', '1'], ['set', 'sweep.prs=merged'],
    (w) => editState(w, (s) => { s.sweep.waves = [1, 2].map((n) => ({ n, fixes: 1, status: 'shipped', branch: `lcw/tidy-wave-${n}`, pr: 11 + n, merged: false, dropped: 0, fixed: 1 })) }),
    ['merge', '1'], ['merge', '1'], ['merge', '2', '--wait', '0'], ['status']]],
  ['usage and mark', [['mark', '60'], ['cap', '4000'], ['usage'], ['start', 'demo', '--title', 'Demo run'], ['mark', '3000usd'], ['mark', '101'], ['usage'], ['status']]],
  ['spend', [['spend-command'], ['spend-command', 'echo', '1240'], ['spend-command'], ['spend-command', 'true'], ['spend-command', 'off'], ['spend-command', 'off']]],
  ['quota', [['quota-command'], ['quota-command', 'http://localhost:8080/v1', 'printf secret'], ['quota-command', 'http://localhost:8080/v1', quotaCmd], ['quota-command'], ['quota-command', 'off']]],
  ['cleanup', [['start', 'demo', '--title', 'Demo run'], ['worktree'], { args: ['abandon', 'ID'], session: 's2' }, leftAlone,
    (w) => fs.writeFileSync(`${w.repo}/.claude/worktrees/demo/b.txt`, 'wip\n'), (w) => fs.rmSync(`${w.repo}/.claude/worktrees/demo/b.txt`),
    { args: ['abandon', 'ID'], session: 's2' }, ['runs']]],
]

function files(dir, base = dir) {
  return fs.readdirSync(dir).sort().flatMap((name) => {
    const p = `${dir}/${name}`
    if (name === '.git') return [path.relative(base, p)]
    return fs.lstatSync(p).isDirectory() ? [`${path.relative(base, p)}/`, ...files(p, base)] : [`${path.relative(base, p)}\n${fs.readFileSync(p, 'utf8')}`]
  })
}
// the two passes run a moment apart, so their clocks differ, and each new quota setting gets a random id
const timeless = (text) => text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<iso>').replace(/\b1[6-9]\d{11}\b/g, '<ms>')
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')

async function pass(pristine, world, door, calls) {
  fs.rmSync(world, { recursive: true, force: true })
  fs.cpSync(pristine, world, { recursive: true })
  const w = { home: `${world}/home`, repo: `${world}/repo` }
  const env = { PATH: `${world}/bin:${process.env.PATH}`, GIT_AUTHOR_DATE: '2026-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T12:00:00Z' }
  const seen = []
  for (const call of calls) {
    if (typeof call === 'function') { call(w); continue }
    const { args, session = 's1' } = Array.isArray(call) ? { args: call } : call
    const r = await door(args.map((a) => (a === 'ID' ? path.basename(runDir(w)) : a)), { home: w.home, cwd: w.repo, session, env })
    seen.push({ args, code: r.code, out: r.out })
  }
  const refs = git(w.repo, 'for-each-ref', '--format=%(refname) %(objectname)')
  return timeless([...seen.map((r) => `$ lcw ${JSON.stringify(r.args)}\nexit ${r.code}\n${r.out}`), ...files(world), refs].join('\n'))
}

for (const [family, calls] of families) {
  test(`${family}: the program and cli() print, exit and leave files the same`, async () => {
    const root = tmp('same')
    const pristine = `${root}/pristine`
    fs.mkdirSync(`${pristine}/bin`, { recursive: true })
    fs.writeFileSync(`${pristine}/bin/gh`, GH, { mode: 0o755 })
    fs.renameSync(makeRepo(), `${pristine}/repo`)
    git(`${pristine}/repo`, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
    fs.mkdirSync(`${pristine}/home`)
    const world = `${root}/world`
    const program = await pass(pristine, world, lcw, calls)
    const inProcess = await pass(pristine, world, cli, calls)
    assert.equal(inProcess, program)
  })
}
