import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { testRuns, busyLine } from '../../scripts/lib/busy.mjs'
import { begin, cli } from './helpers.mjs'

const PS = [
  '  100     1 /bin/zsh -c timeout 1500 .venv/bin/python -m pytest -n auto tests',
  '  101   100 timeout 1500 .venv/bin/python -m pytest -n auto tests',
  '  102   101 .venv/bin/python -m pytest -n auto tests',
  '  103   102 .venv/bin/python -u -c import sys;exec(eval(sys.stdin.readline()))',
  '  200     1 /usr/bin/python3 -m pytest tests/unit',
  '  300    50 node node_modules/.bin/vitest run',
  '  400    50 go test ./...',
  '  500    50 vim tests/test_pytest_names.py',
].join('\n')

test('counts each test run once, not its wrappers or workers, and marks the ones left behind', () => {
  assert.deepEqual(testRuns(PS), [
    { pid: 102, orphan: false },
    { pid: 200, orphan: true },
    { pid: 300, orphan: false },
    { pid: 400, orphan: false },
  ])
})

test('says nothing until the load passes one and a half times the cores', () => {
  assert.equal(busyLine({ load: 21, cores: 14, runs: [] }), '')
  const line = busyLine({ load: 185.4, cores: 14, runs: testRuns(PS) })
  assert.match(line, /^machine busy: load 185 on 14 cores, 4 test runs going.*1 left behind.*pid 200/)
})

test('lcw status warns the orchestrator when the machine is busy, and only then', async () => {
  const t = await begin()
  assert.doesNotMatch((await t.cli('status')).out, /machine busy/)
  const load = String(os.cpus().length * 10)
  assert.match((await cli(['status'], { ...t.o, env: { LCW_LOAD: load } })).out, /machine busy: load/)
})

test('adding a whole-suite task prints a note where the whole suites run instead, and a plain task prints none', async () => {
  const t = await begin()
  assert.match((await t.cli('task', 'add', 'M3', 'Full suite, lint, types')).out, /M3 added\nnote: /)
  assert.doesNotMatch((await t.cli('task', 'add', 'T1', 'Disk cache')).out, /note:/)
})
