import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const { hooks } = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../hooks/hooks.json', import.meta.url)), 'utf8'))
const command = hooks.PostToolUse[0].hooks[0].command

// A plugin root whose hook-limit script records its stdin, and a home to run in.
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-tool-gate-'))
  const root = path.join(dir, 'root')
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  const ran = path.join(dir, 'ran')
  fs.writeFileSync(path.join(root, 'scripts/hook-limit.mjs'),
    `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(ran)}, fs.readFileSync(0, 'utf8'))\nprocess.stdout.write('stub-out')\n`)
  const home = path.join(dir, 'home')
  fs.mkdirSync(home)
  const env = { PATH: process.env.PATH, HOME: home, LCW_HOME: path.join(home, 'lcw'), CLAUDE_PLUGIN_ROOT: root }
  return { dir, home, env, ran, stubRan: () => (fs.existsSync(ran) ? fs.readFileSync(ran, 'utf8') : null) }
}
const sh = (env, input = '{"tool":"x"}') => spawnSync('/bin/sh', ['-c', command], { env, input, encoding: 'utf8' })
const silentSkip = (r) => { assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.equal(r.stderr, '') }

for (const [name, prepare] of [
  ['no after folder', () => {}],
  ['an empty after folder', (after) => fs.mkdirSync(after, { recursive: true })],
  ['only an empty marker (down)', (after) => { fs.mkdirSync(after, { recursive: true }); fs.writeFileSync(path.join(after, 's1'), '') }],
]) {
  test(`with ${name} the gate exits 0 silently and starts no Node`, () => {
    const t = setup()
    prepare(path.join(t.env.LCW_HOME, 'after'))
    silentSkip(sh(t.env))
    assert.equal(t.stubRan(), null)
  })
}

test('a marker that is not empty starts the check and passes stdin through', () => {
  const t = setup()
  const after = path.join(t.env.LCW_HOME, 'after')
  fs.mkdirSync(after, { recursive: true })
  fs.writeFileSync(path.join(after, 'a-empty'), '')
  fs.writeFileSync(path.join(after, 'b-up'), '1')
  const r = sh(t.env, '{"tool":"Bash"}')
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'stub-out')
  assert.equal(t.stubRan(), '{"tool":"Bash"}')
})

test('on Windows under bash the check always runs', () => {
  const t = setup()
  const r = sh({ ...t.env, OS: 'Windows_NT' }, 'in')
  assert.equal(r.status, 0)
  assert.equal(t.stubRan(), 'in')
})

test('with LCW_HOME unset the gate looks in $HOME/.lcw', () => {
  const t = setup()
  const env = { ...t.env }
  delete env.LCW_HOME
  fs.mkdirSync(path.join(t.home, '.lcw/after'), { recursive: true })
  silentSkip(sh(env))
  assert.equal(t.stubRan(), null)
  fs.writeFileSync(path.join(t.home, '.lcw/after/s1'), '1')
  sh(env, 'fallback')
  assert.equal(t.stubRan(), 'fallback')
})

const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).error ? null : 'pwsh'

test('PowerShell runs the stub once, prints only its output and exits 0', { skip: !pwsh && 'pwsh not installed' }, () => {
  const t = setup()
  // What Claude Code does to a hook command under PowerShell.
  const ps = command.replaceAll('${CLAUDE_PLUGIN_ROOT}', '${env:CLAUDE_PLUGIN_ROOT}') + '\n; if (-not $?) { if ($LASTEXITCODE -eq 2) { exit 2 } }'
  const r = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { env: t.env, input: 'ps-in', encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'stub-out')
  assert.equal(t.stubRan(), 'ps-in')
})
