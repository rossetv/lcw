import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

// A hook script is a program: it reads stdin, prints, and calls process.exit. Starting one costs about 150 ms of
// CPU, most of it loading the same modules every time. hookIn() runs the script in this process instead, with the
// environment, folder and stdin a spawned one would have, so a test that is not about the process itself pays for the
// logic only. Tests keep one real run of each script for the wiring: the exit code, the streams, a broken stdin.

class Exit extends Error {}

// one at a time: each takes over the process's env, folder, stdin and streams while it runs
let queue = Promise.resolve()
let runs = 0

/** Runs fn with env as the whole environment, cwd as the folder and stdin read by fs.readFileSync(0); gives what it wrote and how it exited. */
function inEnv({ home, cwd, session, input = '', args, env: more = {} }, fn) {
  const call = queue.then(async () => {
    const env = { ...process.env, LCW_HOME: home, LCW_LOAD: '0' }
    delete env.CLAUDE_CODE_SESSION_ID
    delete env.CLAUDE_PID
    if (session) env.CLAUDE_CODE_SESSION_ID = session
    for (const [k, v] of Object.entries(more)) { if (v === undefined) delete env[k]; else env[k] = v }
    const saved = { env: process.env, cwd: process.cwd(), argv: process.argv, exit: process.exit, out: process.stdout.write, err: process.stderr.write, read: fs.readFileSync }
    let out = ''
    let err = ''
    let code = null
    process.env = { ...env }
    if (cwd) process.chdir(cwd)
    if (args) process.argv = [saved.argv[0], '', ...args]
    process.stdout.write = (chunk) => { out += chunk; return true }
    process.stderr.write = (chunk) => { err += chunk; return true }
    process.exit = (c = 0) => { code ??= c; throw new Exit() }
    fs.readFileSync = (file, ...rest) => (file === 0 ? input : saved.read(file, ...rest))
    try {
      await fn()
    } catch (e) {
      if (!(e instanceof Exit)) { code ??= 1; err += String(e?.stack ?? e) }
    } finally {
      process.env = saved.env
      process.argv = saved.argv
      process.chdir(saved.cwd)
      process.exit = saved.exit
      process.stdout.write = saved.out
      process.stderr.write = saved.err
      fs.readFileSync = saved.read
    }
    return { code: code ?? 0, out, err }
  })
  queue = call.catch(() => {})
  return call
}

/** run() for a hook script, in this process: the same options and result. */
export const hookIn = (script, opts = {}) => inEnv(opts, () => import(`${pathToFileURL(script).href}?run=${++runs}`))

/** Runs fn (the status line's main, say) with the same environment, folder and stdin as hookIn(). */
export const callIn = inEnv
