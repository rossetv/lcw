import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmp, lcw, readJson } from './helpers.mjs'

process.env.TZ = 'Europe/Dublin'
const NOW = new Date(2026, 5, 10, 10, 0).getTime() // June 10 2026, 10:00 local
const MIN = 60000

/** Runs the CLI with the clock fixed at NOW. */
function at(args, opts) {
  process.env.LCW_NOW = String(NOW)
  try { return lcw(args, opts) } finally { delete process.env.LCW_NOW }
}

/** A home, and a stub command in a folder of its own that prints a 401 and exits 1. */
function setup() {
  const home = tmp('home')
  const stub = `${tmp('stub')}/denied.sh`
  fs.writeFileSync(stub, 'printf "401 Unauthorized\\n"\nexit 1\n')
  return { home, o: { home, cwd: tmp('x') }, denied: ['sh', stub] }
}

const settingFile = (home) => `${home}/spend-command.json`
const readingFile = (home) => `${home}/spend-reading.json`

/** A spend command already set, with the reading it last gave. */
function preset(home, command, reading = {}) {
  fs.writeFileSync(settingFile(home), JSON.stringify({ v: 1, command, setAt: NOW - 86400000 }))
  fs.writeFileSync(readingFile(home), JSON.stringify({ v: 1, command, usd: 1240, at: NOW - 3 * MIN, fails: 0, failingSince: null, lastError: null, triedAt: NOW - 3 * MIN, ...reading }))
}

/** A session that spent $1,260 over the week, so "off" has a figure of LCW's own to give. */
function spent(home, id, billing = 'payg') {
  fs.mkdirSync(`${home}/sessions`, { recursive: true })
  fs.mkdirSync(`${home}/spend`, { recursive: true })
  fs.writeFileSync(`${home}/sessions/${id}.json`, JSON.stringify({ billing }))
  fs.writeFileSync(`${home}/spend/${id}.json`, JSON.stringify({ v: 1, base: 0, max: 1260, q: { [Math.floor((NOW - 3600000) / 900000)]: 1260 } }))
}

test('setting a command that prints a figure saves it, takes its reading and says so', () => {
  const { home, o } = setup()
  const r = at(['spend-command', 'echo', '1240'], o)
  assert.equal(r.code, 0)
  assert.equal(r.out, 'Spend command set. It says $1,240 for the last 7 days; LCW now takes the figure from it.\n')
  assert.equal(readJson(settingFile(home)).command, 'echo 1240')
  const reading = readJson(readingFile(home))
  assert.deepEqual([reading.command, reading.usd, reading.at, reading.fails], ['echo 1240', 1240, NOW, 0])
  assert.ok(fs.existsSync(`${home}/cache/spend-try-${Math.floor(NOW / 300000)}`), 'the first reading counts as this window\'s run')
})

test('a command that gives no figure is refused and nothing is saved', () => {
  const { home, o, denied } = setup()
  const r = at(['spend-command', ...denied], o)
  assert.equal(r.code, 1)
  assert.equal(r.out, 'Not set: the command printed "401 Unauthorized", not a dollar figure. LCW keeps its own count.\n')
  assert.deepEqual(fs.readdirSync(home), [])
  const none = at(['spend-command', 'true'], o)
  assert.equal(none.code, 1)
  assert.equal(none.out, 'Not set: the command printed nothing. LCW keeps its own count.\n')
})

test('a refusal says what the command printed: a figure with a bad exit, every line, or its error output', () => {
  const { home, o } = setup()
  const said = (line) => at(['spend-command', line], o).out
  assert.equal(said('echo 5; exit 2'), 'Not set: the command printed "5" and exited with code 2. LCW keeps its own count.\n')
  assert.equal(said('printf "12\\n34\\n"'), 'Not set: the command printed "12 34", not a dollar figure. LCW keeps its own count.\n')
  assert.equal(said('echo no such key >&2; exit 1'), 'Not set: the command printed "no such key", not a dollar figure. LCW keeps its own count.\n')
  assert.deepEqual(fs.readdirSync(home), [])
})

test('a refused command leaves a command already set, and its reading, exactly as they were', () => {
  const { home, o, denied } = setup()
  preset(home, 'echo 1240', { fails: 2, failingSince: NOW - 20 * MIN, lastError: 'printed nothing' })
  const before = [settingFile(home), readingFile(home)].map((f) => fs.readFileSync(f, 'utf8'))
  const r = at(['spend-command', ...denied], o)
  assert.equal(r.code, 1)
  assert.equal(r.out, 'Not set: the command printed "401 Unauthorized", not a dollar figure. Your spend command stays as it was.\n')
  assert.deepEqual([settingFile(home), readingFile(home)].map((f) => fs.readFileSync(f, 'utf8')), before)
})

test('off removes the command and its reading and gives LCW\'s own figure; with nothing set it says so', () => {
  const { home, o } = setup()
  spent(home, 's1')
  assert.equal(at(['spend-command', 'off'], o).out, 'No spend command was set. LCW counts the spend itself: $1,260 in the last 7 days.\n')
  preset(home, 'echo 1240')
  const r = at(['spend-command', 'off'], o)
  assert.equal(r.code, 0)
  assert.equal(r.out, 'Spend command off. LCW counts the spend itself again: $1,260 in the last 7 days.\n')
  assert.deepEqual([fs.existsSync(settingFile(home)), fs.existsSync(readingFile(home))], [false, false])
})

test('with no words it says what is set, how it last read and whether it is failing', () => {
  const { home, o } = setup()
  assert.equal(at(['spend-command'], o).out, 'No spend command set.\n')
  preset(home, 'echo 1240')
  assert.equal(at(['spend-command'], o).out, 'Spend command: echo 1240. Last reading: $1,240, 3 min ago.\n')
  preset(home, 'echo 1240', { at: NOW - 120 * MIN, fails: 3, failingSince: NOW - 35 * MIN, lastError: 'printed "401 Unauthorized"' })
  assert.equal(at(['spend-command'], o).out, 'Spend command: echo 1240. Last reading: $1,240, 2h ago. Failing since 09:25, it printed "401 Unauthorized".\n')
  preset(home, 'echo 1240', { at: NOW - 120 * MIN, fails: 3, failingSince: NOW - 35 * MIN, lastError: 'printed "5" and exited with code 2' })
  assert.match(at(['spend-command'], o).out, /Failing since 09:25, it printed "5" and exited with code 2\.\n$/)
})

test('everything after spend-command is the command line, even a word that starts with "-"', () => {
  const { home, o } = setup()
  assert.equal(at(['spend-command', 'echo', '1240', '|', 'cat', '-u'], o).code, 0)
  assert.equal(readJson(settingFile(home)).command, 'echo 1240 | cat -u')
})

test('a final --session pair is not part of the command line', () => {
  const { home, o } = setup()
  assert.equal(at(['spend-command', 'echo', '1240', '--session', 's9'], o).code, 0)
  assert.equal(readJson(settingFile(home)).command, 'echo 1240')
})

test('a flag before spend-command is read as for any command, so the command is not first and nothing is set', () => {
  const { home, o } = setup()
  const r = at(['--session', 's9', 'spend-command', 'echo', '1240'], o)
  assert.equal(r.code, 1)
  assert.match(r.out, /The command must come first/)
  assert.equal(fs.existsSync(settingFile(home)), false)
  assert.equal(at(['-x', 'spend-command', 'echo', '1240'], o).code, 1)
})

test('the command is set and turned off from a subscription session, whatever its billing', () => {
  const { home } = setup()
  spent(home, 'sub', 'subscription')
  const o = { home, cwd: tmp('x'), session: 'sub' }
  assert.equal(at(['spend-command', 'echo', '1240'], o).code, 0)
  assert.equal(readJson(settingFile(home)).command, 'echo 1240')
  assert.match(at(['spend-command', 'off'], o).out, /^Spend command off\./)
  assert.equal(fs.existsSync(settingFile(home)), false)
})

test('a lone -h or --help after spend-command prints the help and sets nothing', () => {
  const { home, o } = setup()
  for (const words of [['-h'], ['--help'], ['--help', '--session', 'x']]) {
    const r = at(['spend-command', ...words], o)
    assert.equal(r.code, 0)
    assert.match(r.out, /^lcw commands:/)
  }
  assert.equal(fs.existsSync(settingFile(home)), false)
})
