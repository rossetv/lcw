import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, makeRepo, git, lcw, readJson } from './helpers.mjs'
import { buildView, renderCard } from '../../lib/card.mjs'
import { toAnsi } from '../../lib/paint.mjs'

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, '')
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0)

/** A sweep in Hunt with three waves queued (5, 4 and 1 fixes), driven only through the real lcw. */
function hunting() {
  const home = tmp('home')
  const repo = makeRepo()
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
  const o = { home, cwd: repo, session: 's1' }
  const dir = /^folder: (.+)$/m.exec(lcw(['start', 'tidy', '--title', 'Tidy the backlog', '--shape', 'sweep'], o).out)[1]
  fs.writeFileSync(`${dir}/charter.md`, 'goals: fix the backlog\n')
  const t = { o, dir, state: () => readJson(`${dir}/state.json`) }
  t.cli = (...a) => {
    const r = lcw(a, o)
    assert.equal(r.code, 0, `lcw ${a.join(' ')}: ${r.out}${r.err}`)
    return r
  }
  t.at = (n, ...a) => t.cli(...a, '--wave', String(n))
  t.start = () => /^worktree: (.+)$/m.exec(t.cli('wave', 'start').out)[1]
  t.cli('approval')
  t.cli('stage', 'Hunt')
  t.cli('worktree')
  t.cli('wave', 'add', '5', '4', '1')
  return t
}

/** What a person reads of the state as it stands: the card's rows at 115 columns, dark. */
function rows(t) {
  const card = renderCard(buildView({ state: t.state(), now: NOW }), { width: 115 })
  return strip(toAnsi(card, 'dark', 115)).split('\n').map((l) => l.trimEnd())
}
const lane = (r, n) => r.find((l) => l.startsWith(`wave ${n} `))
const heading = (r) => r.find((l) => l.startsWith('waves '))

test('the state the cli writes for two open waves is drawn as a lane for each, with the figure each wave is at', () => {
  const t = hunting()

  // wave 1 in Review, round 2, with its fixes recorded: three pass, one fails, one is still to go
  const wt1 = t.start()
  fs.writeFileSync(`${wt1}/b.txt`, 'one\n')
  git(wt1, 'add', 'b.txt')
  git(wt1, 'commit', '-q', '-m', 'change b')
  for (const [id, status] of [['R1', 'pass'], ['R2', 'pass'], ['R3', 'pass'], ['R4', 'failing'], ['R5', 'todo']]) {
    t.at(1, 'req', 'add', id, `fix ${id}`)
    if (status !== 'todo') t.at(1, 'req', id, status)
  }
  t.at(1, 'stage', 'Review')
  t.at(1, 'wave', 'round')

  // wave 2 builds on it: two tasks done, one running, one to do; wave 3 waits in the queue
  t.start()
  t.at(2, 'stage', 'Build')
  for (const [id, status] of [['T1', 'done'], ['T2', 'done'], ['T3', 'running'], ['T4', 'todo']]) {
    t.at(2, 'task', 'add', id, `task ${id}`)
    if (status !== 'todo') t.at(2, 'task', id, status)
  }

  let r = rows(t)
  assert.match(heading(r), /Ship {4}▰▰▱ {2}1 queued/)
  assert.match(heading(r), /Build.*Review/, 'both stages are marked')
  assert.equal(r.filter((l) => /^wave \d /.test(l)).length, 2, 'one lane for each open wave')
  assert.match(lane(r, 1), /3 of 5 fixes pass · 1 failing · round 2/)
  assert.match(lane(r, 2), /2 of 4 tasks done · 1 running/)
  assert.equal(r.length, 3 + 2, 'three rows and one for each open wave')

  // wave 1 in Ship at its final checks, wave 2 (having taken wave 1 in) in Review
  t.at(2, 'task', 'T3', 'done')
  t.at(2, 'wave', 'take')
  for (const [id, status] of [['R1', 'pass'], ['R2', 'todo']]) {
    t.at(2, 'req', 'add', id, `fix ${id}`)
    if (status !== 'todo') t.at(2, 'req', id, status)
  }
  t.at(2, 'stage', 'Review')
  for (const id of ['R4', 'R5']) t.at(1, 'req', id, 'pass')
  t.at(1, 'stage', 'Ship')
  t.at(1, 'wave', 'step', 'final checks')

  r = rows(t)
  assert.match(heading(r), /Ship {4}▰▰▱ {2}1 queued/)
  assert.match(heading(r), /Review.*Ship/, 'the heading marks Review and Ship')
  assert.match(lane(r, 1), /final checks/)
  assert.match(lane(r, 2), /1 of 2 fixes pass/)
  assert.equal(r.length, 3 + 2)
})
