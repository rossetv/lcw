import { test as kitTest } from 'claude-code/testing'
import type { TestBody, TestOptions } from 'claude-code/testing'

// Many of these tests play minutes of the mod's timers, which takes seconds of real time, and several times that on a
// busy machine: each gets a minute where the kit gives five seconds. A test's own timeoutMs still wins.
const LIMIT_MS = 60000

export function test(name: string, ...rest: readonly [body: TestBody] | readonly [options: TestOptions, body: TestBody]): void {
  const [options, body] = rest.length === 2 ? rest : [{}, rest[0]]
  kitTest(name, { timeoutMs: LIMIT_MS, ...options }, body)
}
