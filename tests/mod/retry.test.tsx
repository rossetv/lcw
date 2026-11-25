import { expect } from 'claude-code/testing'
import { test } from './kit'

declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown

const NOW = Date.parse('2026-11-21T11:29:42Z')
const MIN = 60 * 1000
const RUN = '/lcw/repos/r/runs/x'
// The activity record, under the transcript's name as the hooks keep it, and under the session's id.
const RECORD = '/lcw/activity/t9.json'
const BY_ID = '/lcw/activity/s1.json'

// The world beneath the mod: files in memory, the prompt box, the prompts it submits, and a clock that jumps.
// Each timer fires once per jump, so a wait of many minutes costs one step.
function engine(on: any, opts: { run?: string; shape?: string; reason?: string | null; drop?: string; kept?: Record<string, any> } = {}) {
  const kept = opts.kept ?? {}
  const files: Record<string, string> = {}
  if (opts.run) {
    files['/lcw/sessions/s1.json'] = JSON.stringify({ runDir: RUN })
    files[RUN + '/state.json'] = JSON.stringify({
      id: '20261121-x', name: 'x', status: opts.run, pausedReason: opts.run === 'paused' ? (opts.reason === undefined ? 'human' : opts.reason) : null, shape: opts.shape, stage: 'Build', stageSince: NOW, createdAt: NOW,
    })
    files[RUN + '/mod-alive'] = String(NOW)
  }
  const box = { draft: '' }
  const prompts: string[] = []
  let now = NOW
  let held: (() => void)[] = []
  const hold = () => new Promise((resolve) => held.push(() => resolve({ value: undefined })))
  on('clock.now', () => ({ value: now }))
  on('clock.every', hold)
  on('clock.after', hold)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.info', () => ({ value: { transcriptPath: '/p/t9.jsonl', platform: 'linux' } }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('prompt.submit', (_: any, e: any) => { prompts.push(String(e.text)); return opts.drop ? { drop: opts.drop } : { text: e.text } })
  on('prompt.read', () => ({ value: { text: box.draft, cursor: 0 } }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer ?? '' }))
  on('session.stop', (_: any, e: any) => ({ isTurnRunning: e.isTurnRunning }))
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  // $.state as a reload of the mod's code finds it: what the test put there, and what the mod writes.
  on('state.get', (_: any, e: any) => ({ value: { value: kept[e.key], version: e.key in kept ? 1 : 0 } }))
  on('state.set', (_: any, e: any) => { kept[e.key] = e.value; return { value: { isSet: true, version: 2 } } })
  const pass = async (minutes: number) => {
    now += minutes * MIN
    for (let i = 0; i < 2; i++) {
      const due = held
      held = []
      due.forEach((fire) => fire())
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  return { pass, prompts, box, kept, files, now: () => now }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const turn = async ($: any, reason: string, more: object = {}) => {
  await $.turn.start({ text: '', turnId: 't', ...more } as any)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, reason, turnId: 't', ...more } as any)
}
// What the StopFailure hook writes when a turn ends on an API error of this kind.
const failed = (w: any, error = 'server_error', file = RECORD, at = w.now()) => { w.files[file] = JSON.stringify({ state: 'failed', at, fails: 0, error }) }
// A main turn that ends on an API error, the hook's record written while it ran.
const fail = async ($: any, w: any, error = 'server_error', more: object = {}) => {
  await $.turn.start({ text: '', turnId: 't', ...more } as any)
  failed(w, error)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, reason: 'error', turnId: 't', ...more } as any)
}

test('a lost connection is carried on after a minute, then after 5 and 15 minutes as each try fails too', async ($, on) => {
  const w = engine(on)
  await start($)
  await fail($, w)
  await w.pass(0.9)
  expect(w.prompts.length).toBe(0)
  await w.pass(0.2)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/connection was lost/)
  expect(w.prompts[0]).toMatch(/try 1\b/)
  await fail($, w)
  await w.pass(4.9)
  expect(w.prompts.length).toBe(1)
  await w.pass(0.2)
  expect(w.prompts.length).toBe(2)
  expect(w.prompts[1]).toMatch(/try 2\b/)
  await fail($, w)
  await w.pass(14.9)
  expect(w.prompts.length).toBe(2)
  await w.pass(0.2)
  expect(w.prompts.length).toBe(3)
})

test('the wait stays at 30 minutes after the third failed try, each measured from that failed try', async ($, on) => {
  const w = engine(on)
  await start($)
  await fail($, w)
  await w.pass(1.1)
  await fail($, w)
  await w.pass(5.1)
  await fail($, w)
  await w.pass(15.1)
  expect(w.prompts).toHaveLength(3)
  await fail($, w)
  await w.pass(29.8)
  expect(w.prompts).toHaveLength(3)
  await w.pass(0.4)
  expect(w.prompts).toHaveLength(4)
  await fail($, w)
  await w.pass(29.8)
  expect(w.prompts).toHaveLength(4)
  await w.pass(0.4)
  expect(w.prompts).toHaveLength(5)
})

for (const error of ['authentication_failed', 'billing_error', 'invalid_request', 'model_not_found', 'rate_limit', 'unknown']) {
  test(`an error of kind ${error} is not carried on`, async ($, on) => {
    const w = engine(on)
    await start($)
    await fail($, w, error)
    await w.pass(30)
    expect(w.prompts.length).toBe(0)
  })
}

for (const shape of ['build', 'sweep']) {
  test(`a running ${shape} is carried on`, async ($, on) => {
    const w = engine(on, { run: 'running', shape })
    await start($)
    await fail($, w)
    await w.pass(1.1)
    expect(w.prompts).toHaveLength(1)
    expect(w.prompts[0]).toMatch(/try 1\b/)
  })
}

test("a subagent's API error is not carried on", async ($, on) => {
  const w = engine(on)
  await start($)
  await fail($, w, 'server_error', { agentId: 'a1' })
  await w.pass(30)
  expect(w.prompts.length).toBe(0)
})

test('a try that falls due while the person has typed is skipped, and the next one follows 5 minutes later', async ($, on) => {
  const w = engine(on)
  await start($)
  await fail($, w)
  w.box.draft = 'wait'
  await w.pass(1.1)
  expect(w.prompts.length).toBe(0)
  w.box.draft = ''
  await w.pass(4.8)
  expect(w.prompts.length).toBe(0)
  await w.pass(0.2)
  expect(w.prompts).toHaveLength(1)
  expect(w.prompts[0]).toMatch(/try 2\b/)
})

test("a prompt the person sends takes over: no try follows it", async ($, on) => {
  const w = engine(on)
  await start($)
  await fail($, w)
  await $.prompt.submit({ text: 'retry' } as any)
  await w.pass(60)
  expect(w.prompts).toEqual(['retry'])
})

test('a turn that ends well, such as one an agent notification started, ends the carry-on', async ($, on) => {
  const w = engine(on)
  await start($)
  await fail($, w)
  await turn($, 'answer')
  await w.pass(60)
  expect(w.prompts.length).toBe(0)
})

test('a turn that ends well resets the count: the next error starts again at try 1', async ($, on) => {
  const w = engine(on)
  await start($)
  await fail($, w)
  await w.pass(1.1)
  await turn($, 'answer')
  await fail($, w, 'overloaded')
  await w.pass(1.1)
  expect(w.prompts).toHaveLength(2)
  expect(w.prompts[1]).toMatch(/overloaded/)
  expect(w.prompts[1]).toMatch(/try 1\b/)
})

test('nothing is carried on while the session drives a run the person paused', async ($, on) => {
  const w = engine(on, { run: 'paused' })
  await start($)
  await fail($, w)
  await w.pass(60)
  expect(w.prompts.length).toBe(0)
})

test('a try that falls due while a turn is running is not sent into it', async ($, on) => {
  const w = engine(on)
  await start($)
  await fail($, w)
  await $.turn.start({ text: '', turnId: 't2' } as any)
  await w.pass(1.1)
  expect(w.prompts.length).toBe(0)
})

test('no try is sent more than 3 hours after the first error', async ($, on) => {
  const w = engine(on)
  await start($)
  await fail($, w)
  await w.pass(1.1)
  await fail($, w)
  await w.pass(185)
  expect(w.prompts.length).toBe(1)
})

test('nothing is carried on while a run is paused at its usage mark', async ($, on) => {
  const w = engine(on, { run: 'paused', reason: 'mark' })
  await start($)
  await fail($, w)
  await w.pass(60)
  expect(w.prompts.length).toBe(0)
})

test('a slash command from the person takes over: no try follows it', async ($, on) => {
  const w = engine(on)
  await start($)
  await fail($, w)
  await $.prompt.submit({ text: '/model', command: { name: 'model' } } as any)
  await w.pass(60)
  expect(w.prompts).toEqual(['/model'])
})

test('a built-in command the person runs, raising only command.run, takes over: no try follows it', async ($, on) => {
  const w = engine(on)
  on('command.run', () => ({ text: '' }))
  await start($)
  await fail($, w)
  await $.command.run({ command: 'model', args: '', origin: { kind: 'composer' } } as any)
  await w.pass(60)
  expect(w.prompts).toEqual([])
})

test('a command a plugin runs does not take over from the carry-on', async ($, on) => {
  const w = engine(on)
  on('command.run', () => ({ text: '' }))
  await start($)
  await fail($, w)
  await $.command.run({ command: 'model' } as any)
  await w.pass(1.1)
  expect(w.prompts).toHaveLength(1)
})

test('a try the engine drops is not counted as sent: the next follows 5 minutes later', async ($, on) => {
  const w = engine(on, { drop: 'refused' })
  await start($)
  await fail($, w)
  await w.pass(1.1)
  expect(w.prompts).toHaveLength(1)
  await w.pass(4.8)
  expect(w.prompts).toHaveLength(1)
  await w.pass(0.4)
  expect(w.prompts).toHaveLength(2)
  expect(w.prompts[1]).toMatch(/try 2\b/)
})

test('the engine order of events, turn start, then the error, then the turn ending in error, still sends the first try after a minute', async ($, on) => {
  const w = engine(on)
  await start($)
  await $.turn.start({ text: '', turnId: 't' } as any)
  failed(w)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, reason: 'error', turnId: 't' } as any)
  await w.pass(1.1)
  expect(w.prompts).toHaveLength(1)
  expect(w.prompts[0]).toMatch(/try 1\b/)
})

test('a record the hook writes seconds after the turn ended is found, and the first try is timed from it', async ($, on) => {
  const w = engine(on)
  await start($)
  await turn($, 'error')
  await w.pass(5 / 60)
  failed(w, 'server_error', RECORD, NOW + 2000)
  await w.pass(1 / 60)
  await w.pass(0.8)
  expect(w.prompts).toHaveLength(0)
  await w.pass(0.15)
  expect(w.prompts).toHaveLength(1)
  expect(w.prompts[0]).toMatch(/try 1\b/)
})

test('a failed record from an earlier turn does not carry on a turn that ended on an error', async ($, on) => {
  const w = engine(on)
  await start($)
  failed(w, 'server_error', RECORD, NOW - 1000)
  await turn($, 'error')
  await w.pass(1.1)
  expect(w.prompts).toHaveLength(0)
})

test('a record kept under the session id is found', async ($, on) => {
  const w = engine(on)
  await start($)
  await $.turn.start({ text: '', turnId: 't' } as any)
  failed(w, 'overloaded', BY_ID)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, reason: 'error', turnId: 't' } as any)
  await w.pass(1.1)
  expect(w.prompts).toHaveLength(1)
  expect(w.prompts[0]).toMatch(/overloaded/)
})

test('a record that has not come about 10 seconds after the turn ended is no longer looked for', async ($, on) => {
  const w = engine(on)
  await start($)
  await turn($, 'error')
  await w.pass(11 / 60)
  failed(w, 'server_error', RECORD, NOW + 1000)
  await w.pass(1 / 60)
  expect(w.kept.carry?.value ?? null).toBe(null)
})

test('a turn that starts before the record comes ends the look for it', async ($, on) => {
  const w = engine(on)
  await start($)
  await turn($, 'error')
  await $.turn.start({ text: '', turnId: 't2' } as any)
  failed(w, 'server_error', RECORD, NOW)
  await w.pass(1 / 60)
  expect(w.kept.carry?.value ?? null).toBe(null)
})

test('Stop pressed as a turn ends on an API error leaves the failed record for the carry-on', async ($, on) => {
  const w = engine(on)
  await start($)
  await $.turn.start({ text: '', turnId: 't' } as any)
  failed(w, 'server_error', BY_ID)
  await $.session.stop({ isTurnRunning: true } as any)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, reason: 'error', turnId: 't' } as any)
  await w.pass(1.1)
  expect(w.prompts).toHaveLength(1)
})

test('a carry-on is kept where a reload of the mod finds it', async ($, on) => {
  const w = engine(on)
  await start($)
  await fail($, w)
  await w.pass(0)
  expect(w.kept.carry?.value?.carry?.kind).toBe('server_error')
  expect(w.kept.carry?.value?.session).toBe('s1')
})

test('a carry-on pending before a reload of the mod is still made after it', async ($, on) => {
  const carry = { firstAt: NOW, kind: 'server_error', tries: 0, dueAt: NOW + MIN }
  const w = engine(on, { kept: { carry: { shape: 'kept-1', value: { session: 's1', carry } } } })
  await start($)
  await w.pass(2)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toMatch(/try 1/)
})

test("another session's carry-on is not made", async ($, on) => {
  const carry = { firstAt: NOW, kind: 'server_error', tries: 0, dueAt: NOW + MIN }
  const w = engine(on, { kept: { carry: { shape: 'kept-1', value: { session: 's0', carry } } } })
  await start($)
  await w.pass(2)
  expect(w.prompts.length).toBe(0)
})
