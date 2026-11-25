import { expect } from 'claude-code/testing'
import { test } from './kit'

const RECORD = '/lcw/activity/s1.json'

// The world beneath the mod: files in memory and a fixed clock.
function engine(on: any, files: Record<string, string>) {
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.stop', (_: any, e: any) => ({ isTurnRunning: e.isTurnRunning }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'LCW_HOME' ? '/lcw' : undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.write', (_: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: 9000 }))
  on('clock.every', () => ({ value: {} }))
  on('clock.after', () => ({ value: {} }))
  return files
}

test('pressing Stop on a running turn closes the turn the mascot shows as working, and keeps its count of failures', async ($, on) => {
  const files = engine(on, { [RECORD]: JSON.stringify({ state: 'working', at: 5, fails: 2 }) })
  await $.session.stop({ isTurnRunning: true })
  expect(JSON.parse(files[RECORD] ?? 'null')).toEqual({ state: 'rest', at: 9000, fails: 2 })
})

test('Stop with no turn running changes nothing', async ($, on) => {
  const done = JSON.stringify({ state: 'done', at: 5, fails: 0 })
  const files = engine(on, { [RECORD]: done })
  await $.session.stop({ isTurnRunning: false })
  expect(files[RECORD]).toBe(done)
})

test('a resumed session, whose hooks write under another name, still gets its interrupted turn closed', async ($, on) => {
  const files = engine(on, {})
  await $.session.stop({ isTurnRunning: true })
  expect(JSON.parse(files[RECORD] ?? 'null')).toEqual({ state: 'rest', at: 9000 })
})
