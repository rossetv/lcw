import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const { hooks } = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../hooks/hooks.json', import.meta.url)), 'utf8'))
const scripts = (event, matcher) => hooks[event].filter((group) => group.matcher === matcher).flatMap((group) => group.hooks.map((h) => /scripts\/([\w-]+\.mjs)/.exec(h.command)[1]))

test('a prompt starts one LCW process', () => {
  assert.deepEqual(hooks.UserPromptSubmit.flatMap((group) => group.hooks.map((h) => h.command)), ['node "${CLAUDE_PLUGIN_ROOT}/scripts/hook-limit.mjs"'])
})

test('before a tool call the agent gate and the question hook stay', () => {
  assert.deepEqual(scripts('PreToolUse', 'Agent|Task'), ['hook-agent-gate.mjs'])
  assert.deepEqual(scripts('PreToolUse', 'AskUserQuestion'), ['hook-activity.mjs'])
})
