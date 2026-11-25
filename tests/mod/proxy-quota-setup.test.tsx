import { expect, mock } from 'claude-code/testing'
import { test } from './kit'
import type { PromptChangeInput, PromptChangeResult, PromptEditInput, PromptEditResult } from 'claude-code'
import { proxyQuotaNoticeFile } from '../../lib/key.mjs'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const ENDPOINT = 'https://proxy.example/private/team'
const HOST = 'proxy.example'
const OTHER = 'https://other.example/private/team'
const RUN = '/lcw/repos/repo-1/runs/r1'
const TITLE = /Using a subscription-backed proxy\?/
const BAND = {
  plugin: 'lcw', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 50, bodyColumns: 100, scroll: { offset: 0, bodyRows: 49 }, view: {} },
} as const
const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
const initial = () => ({ '/lcw/sessions/s1.json': JSON.stringify({ billing: 'payg', markUsd: 75 }), '/lcw/cap.json': '{"usd":100}' })

// With no run the mod looks at its files, and at the address, every five seconds: each step below waits for one look.
function engine(on: any, files: Record<string, string> = initial()) {
  const clock = mock.clock(on, { now: NOW })
  const control = { endpoint: ENDPOINT as string | undefined, id: 's1', draft: '', fill: 'ok', writeFails: false, beforeDraft: undefined as undefined | (() => Promise<void>), beforeFile: undefined as undefined | (() => Promise<void>) }
  const fills: string[] = [], prompts: string[] = [], toasts: string[] = [], reads: string[] = [], runs: string[][] = []
  const kept: Record<string, any> = {}
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: control.id }))
  on('session.info', () => ({ value: { transcriptPath: '', platform: 'linux' } }))
  on('env.get', (_: any, e: any) => {
    expect(['LCW_HOME', 'HOME', 'ANTHROPIC_BASE_URL'].includes(e.name)).toBe(true)
    return { value: e.name === 'LCW_HOME' ? '/lcw' : e.name === 'ANTHROPIC_BASE_URL' ? control.endpoint : undefined }
  })
  on('settings.read', () => ({ value: { advisorModel: 'fable' } }))
  on('fs.read', async (_: any, e: any) => {
    reads.push(e.path)
    const before = control.beforeFile; control.beforeFile = undefined
    await before?.()
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => {
    if (e.path.includes('/notices/proxy-quota/') && control.writeFails) throw new Error('EACCES')
    files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.list', (_: any, e: any) => {
    if (e.path !== '/lcw/spend') throw new Error('only the spend folder is listed here')
    return { value: Object.keys(files).filter((p) => p.startsWith('/lcw/spend/')).map((p) => ({ name: p.split('/').pop(), kind: 'file', mtimeMs: NOW, size: files[p]!.length, isLink: false })) }
  })
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('process.run', (_: any, e: any) => {
    runs.push(e.argv)
    return { value: { exitCode: 0, stdout: e.argv.includes('where') ? '{"key":"repo-1"}' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.read', async () => {
    const before = control.beforeDraft; control.beforeDraft = undefined
    await before?.()
    if (control.draft === 'unreadable') throw new Error('unreadable')
    return { value: { text: control.draft, cursor: 0 } }
  })
  on('prompt.edit', (_: any, e: PromptEditInput) => {
    control.draft = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text: control.draft, cursor: e.start + e.inputText.length }
  })
  on('prompt.change', (_: any, e: PromptChangeInput) => {
    control.draft = e.text
    return { text: e.text }
  })
  on('prompt.fill', (_: any, e: any) => {
    if (control.fill === 'throw') throw new Error('unavailable')
    if (control.fill === 'refuse') return { isFilled: false }
    fills.push(e.text)
    control.draft = e.text
    return { isFilled: true }
  })
  on('prompt.submit', (_: any, e: any) => { prompts.push(e.text); return { text: e.text } })
  on('ui.toast', (_: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('state.get', (_: any, e: any) => ({ value: { value: kept[e.key], version: e.key in kept ? 1 : 0 } }))
  on('state.set', (_: any, e: any) => { kept[e.key] = e.value; return { value: { isSet: true, version: 2 } } })
  return { clock, control, files, fills, prompts, toasts, reads, runs, kept }
}

for (const choice of ['setup', 'keep', 'dismiss']) {
  test(`${choice} is remembered for this host, whatever its port or path, and never changes accounting or launches work`, async ($, on) => {
    const w = engine(on)
    const before = JSON.stringify(w.files)
    await start($)
    const band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: TITLE })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /Set up a quota check to track percentages instead of estimated dollars\./ })).toBeDefined()
    for (const label of ['Set up quota check', 'Keep dollar tracking', 'Dismiss']) expect(await band.find({ type: 'Text', text: label })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /proxy\.example|private|team/ })).toBeUndefined()
    await band.press({ key: 'banner:proxyquota:' + choice })
    expect(w.prompts).toEqual([])
    expect(w.fills.length).toBe(choice === 'setup' ? 1 : 0)
    if (choice === 'setup') {
      expect(w.fills[0]).toMatch(/authorization/i)
      expect(w.fills[0]).not.toMatch(/proxy\.example|private|team/)
    }
    const file = await proxyQuotaNoticeFile('/lcw', HOST)
    const saved = w.files[file]
    if (saved === undefined) throw new Error('The quota setup choice was not saved')
    expect(JSON.parse(saved).choice).toBe(choice)
    expect(JSON.stringify(w.kept)).not.toMatch(/proxy\.example|private|team/)
    const withoutChoice = { ...w.files }; delete withoutChoice[file]
    // The marker that has the hook after a tool call give the pay-per-token note is no accounting.
    for (const path of Object.keys(withoutChoice)) if (path.startsWith('/lcw/after/')) delete withoutChoice[path]
    expect(JSON.stringify(withoutChoice)).toBe(before)
    expect(w.runs.filter((a) => a[1]?.split('/').pop()?.startsWith('quota') || a.slice(2).some((v) => /^(quota-command|billing|mark|resume)$/.test(v)))).toEqual([])
    expect(w.reads.filter((p) => /(?:^|\/)(?:\.credentials\.json|auth\.json|settings(?:\.local)?\.json)$/.test(p))).toEqual([])
    await w.clock.advance(5000)
    expect(await band.find({ type: 'Text', text: TITLE })).toBeUndefined()
    w.control.id = 's2'
    w.files['/lcw/sessions/s2.json'] = '{"billing":"payg"}'
    for (const key of Object.keys(w.kept)) delete w.kept[key]
    await start($)
    await w.clock.advance(5000)
    expect(await band.find({ type: 'Text', text: TITLE })).toBeUndefined()
    for (const sameHost of [ENDPOINT + '/other', 'https://proxy.example:8443/private/team', 'http://proxy.example:3456']) {
      w.control.endpoint = sameHost
      await w.clock.advance(5000)
      expect(await band.find({ type: 'Text', text: TITLE })).toBeUndefined()
    }
    w.control.endpoint = OTHER
    await w.clock.advance(5000)
    expect(await band.find({ type: 'Text', text: TITLE })).toBeDefined()
    await band.unmount()
  })

  test(`a fresh module honors the persisted ${choice} choice however the address is written`, async ($, on) => {
    const files: Record<string, string> = initial()
    files[await proxyQuotaNoticeFile('/lcw', HOST)] = JSON.stringify({ host: HOST, choice })
    const w = engine(on, files)
    w.control.endpoint = 'https://PROXY.example:443/private/team///'
    await start($)
    const band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: TITLE })).toBeUndefined()
    w.control.endpoint = OTHER
    await w.clock.advance(5000)
    expect(await band.find({ type: 'Text', text: TITLE })).toBeDefined()
    await band.unmount()
  })
}

for (const record of ['wrong-host', 'invalid-choice', 'corrupt']) {
  test(`a ${record} notice cannot suppress setup for this host`, async ($, on) => {
    const w = engine(on)
    w.files[await proxyQuotaNoticeFile('/lcw', HOST)] = record === 'corrupt' ? '{' : JSON.stringify({ host: record === 'wrong-host' ? 'other.example' : HOST, choice: record === 'invalid-choice' ? 'unknown' : 'keep' })
    await start($)
    const band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: TITLE })).toBeDefined()
    await band.press({ key: 'banner:proxyquota:dismiss' })
    const saved = w.files[await proxyQuotaNoticeFile('/lcw', HOST)]
    if (saved === undefined) throw new Error('The quota setup dismissal was not saved')
    expect(JSON.parse(saved)).toEqual({ host: HOST, choice: 'dismiss' })
    await band.unmount()
  })
}

test('a long endpoint persists under one bounded filename without appearing in the conversation', async ($, on) => {
  const w = engine(on)
  w.control.endpoint = ENDPOINT + '/' + 'x'.repeat(10000)
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: TITLE })).toBeDefined()
  await band.press({ key: 'banner:proxyquota:setup' })
  const records = Object.keys(w.files).filter((p) => p.includes('/notices/proxy-quota/'))
  expect(records.length).toBe(1)
  const file = records[0]
  if (file === undefined) throw new Error('No quota setup notice was saved')
  expect(file).toMatch(/^\/lcw\/notices\/proxy-quota\/[a-f0-9]{64}\.json$/)
  const saved = w.files[file]
  if (saved === undefined) throw new Error('The quota setup notice is missing')
  expect(JSON.parse(saved)).toEqual({ host: HOST, choice: 'setup' })
  expect(w.fills[0]).not.toMatch(/proxy\.example|private|team|xxx/)
  await band.unmount()
})

for (const failure of ['draft', 'whitespace', 'unreadable', 'refuse', 'throw', 'write']) {
  test(`setup remains retryable after ${failure} without consuming the offer`, async ($, on) => {
    const w = engine(on)
    await start($)
    const band = await $.ui.mount(BAND)
    w.control.draft = failure === 'draft' ? 'my unfinished question' : failure === 'whitespace' ? '  ' : failure === 'unreadable' ? 'unreadable' : ''
    w.control.fill = failure === 'refuse' || failure === 'throw' ? failure : 'ok'
    w.control.writeFails = failure === 'write'
    await band.press({ key: 'banner:proxyquota:setup' })
    expect(w.files[await proxyQuotaNoticeFile('/lcw', HOST)]).toBeUndefined()
    expect(w.prompts).toEqual([])
    if (['draft', 'whitespace', 'unreadable'].includes(failure)) expect(w.fills).toEqual([])
    expect(await band.find({ type: 'Text', text: TITLE })).toBeDefined()
    expect(w.toasts.length > 0).toBe(true)
    w.control.draft = ''; w.control.fill = 'ok'; w.control.writeFails = false
    await band.press({ key: 'banner:proxyquota:setup' })
    const saved = w.files[await proxyQuotaNoticeFile('/lcw', HOST)]
    if (saved === undefined) throw new Error('The quota setup choice was not saved after retry')
    expect(JSON.parse(saved).choice).toBe('setup')
    await band.unmount()
  })
}

test('a host changed after drawing cannot accept a stale setup click', async ($, on) => {
  const w = engine(on)
  await start($)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: TITLE })).toBeDefined()
  w.control.endpoint = OTHER
  await band.press({ key: 'banner:proxyquota:setup' })
  expect(w.fills).toEqual([])
  expect(Object.keys(w.files).filter((p) => p.includes('/notices/'))).toEqual([])
  expect(w.toasts.join()).toMatch(/changed/)
  await band.unmount()
})

for (const race of ['turn', 'host']) {
  test(`a ${race} change while reading the draft invalidates setup before it fills`, async ($, on) => {
    const w = engine(on)
    await start($)
    const band = await $.ui.mount(BAND)
    w.control.beforeDraft = async () => {
      if (race === 'turn') await $.turn.start({ text: '', turnId: 't1' } as any)
      else w.control.endpoint = OTHER
    }
    await band.press({ key: 'banner:proxyquota:setup' })
    expect(w.fills).toEqual([])
    expect(w.prompts).toEqual([])
    expect(w.files[await proxyQuotaNoticeFile('/lcw', HOST)]).toBeUndefined()
    await band.unmount()
  })
}

for (const race of ['host', 'mark', 'human-pause']) {
  test(`a ${race} change during the final draft read invalidates setup before it fills`, async ($, on) => {
    const w = engine(on)
    await start($)
    const band = await $.ui.mount(BAND)
    w.control.beforeDraft = async () => {
      w.control.beforeDraft = async () => {
        if (race === 'host') w.control.endpoint = OTHER
        if (race === 'mark') w.files['/lcw/spend/s1.json'] = JSON.stringify({ v: 1, base: 0, max: 90, q: { [Math.floor((NOW - 86400000) / 900000)]: 90 } })
        if (race === 'human-pause') {
          w.files['/lcw/sessions/s1.json'] = JSON.stringify({ billing: 'payg', runDir: RUN })
          w.files[RUN + '/state.json'] = JSON.stringify({ id: 'r1', name: 'example', stage: 'Build', status: 'paused', pausedReason: 'human', driver: 's1' })
        }
      }
    }
    await band.press({ key: 'banner:proxyquota:setup' })
    expect(w.fills).toEqual([])
    expect(w.prompts).toEqual([])
    expect(w.files[await proxyQuotaNoticeFile('/lcw', HOST)]).toBeUndefined()
    await band.unmount()
  })
}

for (const clear of [false, true]) {
  test(`a draft filled${clear ? ' then cleared' : ''} during the final control snapshot is not replaced by setup`, async ($, on) => {
    const w = engine(on)
    await start($)
    const band = await $.ui.mount(BAND)
    w.control.beforeDraft = async () => {
      w.control.beforeDraft = async () => {
        w.control.beforeFile = async () => {
          await $.prompt.fill({ text: 'my unfinished question', mode: 'replace', origin: { kind: 'plugin', name: 'other' } })
          if (clear) await $.prompt.fill({ text: '', mode: 'replace', origin: { kind: 'plugin', name: 'other' } })
        }
      }
    }
    await band.press({ key: 'banner:proxyquota:setup' })
    expect(w.fills).toEqual(clear ? ['my unfinished question', ''] : ['my unfinished question'])
    expect(w.control.draft).toBe(clear ? '' : 'my unfinished question')
    expect(w.prompts).toEqual([])
    expect(w.files[await proxyQuotaNoticeFile('/lcw', HOST)]).toBeUndefined()
    await band.unmount()
  })
}

for (const source of ['typing', 'history']) for (const clear of [false, true]) {
  test(`${source}${clear ? ' then clearing' : ''} during the final control snapshot cancels setup`, async ($, on) => {
    const w = engine(on)
    // Composer notifications are supported by the test dispatcher, not by the public prompt API.
    const composer = $.prompt as typeof $.prompt & {
      edit: (input: PromptEditInput) => Promise<PromptEditResult>
      change: (input: PromptChangeInput) => Promise<PromptChangeResult>
    }
    await start($)
    const band = await $.ui.mount(BAND)
    w.control.beforeDraft = async () => {
      w.control.beforeDraft = async () => {
        w.control.beforeFile = async () => {
          if (source === 'typing') await composer.edit({ text: '', cursor: 0, start: 0, end: 0, inputText: 'my unfinished question', origin: { kind: 'composer' } })
          else await composer.change({ text: 'my unfinished question', cursor: 22, origin: { kind: 'history' } })
          if (clear) await composer.change({ text: '', cursor: 0, origin: { kind: 'clear' } })
        }
      }
    }
    await band.press({ key: 'banner:proxyquota:setup' })
    expect(w.fills).toEqual([])
    expect(w.control.draft).toBe(clear ? '' : 'my unfinished question')
    expect(w.prompts).toEqual([])
    expect(w.files[await proxyQuotaNoticeFile('/lcw', HOST)]).toBeUndefined()
    await band.unmount()
  })
}

test("another host's choice arriving during a press cannot be overwritten", async ($, on) => {
  const w = engine(on)
  const other = await proxyQuotaNoticeFile('/lcw', 'other.example')
  await start($)
  const band = await $.ui.mount(BAND)
  w.files[other] = '{"choice":"keep"}'
  await band.press({ key: 'banner:proxyquota:dismiss' })
  expect(w.files[other]).toBe('{"choice":"keep"}')
  const saved = w.files[await proxyQuotaNoticeFile('/lcw', HOST)]
  if (saved === undefined) throw new Error('The quota setup dismissal was not saved')
  expect(JSON.parse(saved).choice).toBe('dismiss')
  await band.unmount()
})

for (const condition of ['absent', 'native', 'native-v1', 'unsafe', 'configured', 'off', 'missing', 'corrupt', 'mismatch', 'driver']) {
  test(`${condition} connections cannot use onboarding to bypass their existing controls`, async ($, on) => {
    const w = engine(on)
    await start($)
    const band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: TITLE })).toBeDefined()
    const config = { v: 1, sourceId: 'external-quota', revision: 'r', enabled: true, endpoint: ENDPOINT, command: 'quota' }
    if (condition === 'absent') w.control.endpoint = undefined
    if (condition === 'native') w.control.endpoint = 'https://api.anthropic.com/'
    if (condition === 'native-v1') w.control.endpoint = 'https://api.anthropic.com/v1/'
    if (condition === 'unsafe') w.control.endpoint = 'https://user:secret@proxy.example/private'
    if (condition === 'configured') w.files['/lcw/quota-command.json'] = JSON.stringify(config)
    if (condition === 'off') w.files['/lcw/quota-command.json'] = '{"v":1,"sourceId":"external-quota","enabled":false,"revision":"off"}'
    if (['missing', 'corrupt', 'mismatch', 'driver'].includes(condition)) {
      const selection = { sourceId: 'external-quota', endpoint: ENDPOINT }
      w.files['/lcw/sessions/s1.json'] = JSON.stringify({ billing: 'subscription', ...(condition === 'driver' ? { runDir: RUN } : { quotaSelection: selection }) })
      if (condition === 'corrupt') w.files['/lcw/quota-command.json'] = '{'
      if (condition === 'mismatch') w.files['/lcw/quota-command.json'] = JSON.stringify({ ...config, endpoint: ENDPOINT + '/other' })
      if (condition === 'driver') {
        w.files['/lcw/sessions/driver.json'] = JSON.stringify({ billing: 'subscription', quotaSelection: selection })
        w.files[RUN + '/mod-alive'] = String(NOW)
        w.files[RUN + '/state.json'] = JSON.stringify({ id: 'r1', name: 'example', status: 'paused', pausedReason: 'mark', stage: 'Build', driver: 'driver' })
      }
    }
    const before = JSON.stringify(w.files)
    await band.press({ key: 'banner:proxyquota:setup' })
    expect(w.fills).toEqual([])
    expect(w.prompts).toEqual([])
    expect(JSON.stringify(w.files)).toBe(before)
    await w.clock.advance(2000)
    expect(await band.find({ type: 'Text', text: TITLE })).toBeUndefined()
    if (['missing', 'corrupt', 'mismatch', 'driver'].includes(condition)) expect(await band.find({ type: 'Text', text: /Subscription quota unavailable/ })).toBeDefined()
    await band.unmount()
  })
}

for (const condition of ['working', 'human-pause', 'other-driver', 'mark']) {
  test(`setup cannot launch or fill while ${condition} controls apply`, async ($, on) => {
    const w = engine(on)
    await start($)
    const band = await $.ui.mount(BAND)
    if (condition === 'working') await $.turn.start({ text: '', turnId: 't1' } as any)
    if (condition === 'mark') w.files['/lcw/spend/s1.json'] = JSON.stringify({ v: 1, base: 0, max: 90, q: { [Math.floor((NOW - 86400000) / 900000)]: 90 } })
    if (condition === 'human-pause' || condition === 'other-driver') {
      w.files['/lcw/sessions/s1.json'] = JSON.stringify({ billing: 'payg', runDir: RUN })
      w.files[RUN + '/state.json'] = JSON.stringify({ id: 'r1', name: 'example', stage: 'Build', status: condition === 'human-pause' ? 'paused' : 'running', pausedReason: 'human', driver: 'driver' })
    }
    await band.press({ key: 'banner:proxyquota:setup' })
    expect(w.fills).toEqual([])
    expect(w.prompts).toEqual([])
    expect(w.files[await proxyQuotaNoticeFile('/lcw', HOST)]).toBeUndefined()
    await band.unmount()
  })
}
