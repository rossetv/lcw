// The status line run in this process, as its program runs: the same environment in, the same bytes out.

import { oneAtATime } from '../../core/helpers.mjs'

/** Runs fn, one at a time with every other takeover of the process (cli() too), with exactly `env` as the process's environment, and puts the old one back. */
export function withEnv(env, fn) {
  return oneAtATime(async () => {
    const was = { ...process.env }
    for (const k of Object.keys(process.env)) delete process.env[k]
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v
    try {
      return await fn()
    } finally {
      for (const k of Object.keys(process.env)) delete process.env[k]
      Object.assign(process.env, was)
    }
  })
}

/** The bytes the status line of the plugin folder `root` prints for `input` (a string) when run with `env` as its environment. */
export function drawIn(root, input, env) {
  return withEnv(env, async () => {
    const { main } = await import(root + '/scripts/statusline.mjs')
    let out = ''
    await main({ input, write: (s) => { out += s } })
    return out
  })
}
