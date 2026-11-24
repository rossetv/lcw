// LCW's status line, run as `node <LCW home>/bin/statusline.mjs [second]` with Claude Code's input on stdin. Setup
// copies it there as it is. It finds the plugin, draws, and prints rows whatever fails: the session's last rows,
// or one line that says where to look. With the second the player read (date's %s%z), it also saves the frames
// the player prints in the seconds that follow.
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const home = process.env.LCW_HOME || `${process.env.HOME}/.lcw`
const LOG = `${home}/statusline.log`
const LOG_BYTES = 64 * 1024
const BROKEN = 'LCW · status line could not load · see ~/.lcw/statusline.log\n'

const read = (file) => { try { return fs.readFileSync(file, 'utf8') } catch { return null } }
const holds = (dir) => !!dir && dir.startsWith('/') && fs.existsSync(`${dir}/scripts/statusline.mjs`)

/** Writes one line saying what failed, unless the last line already says it; the log is cut to its newest half past 64 KB. */
function log(what, now = Date.now()) {
  try {
    const text = read(LOG) ?? ''
    const lines = text.split('\n').filter(Boolean)
    const last = lines.at(-1)
    if (last && last.slice(last.indexOf(' ') + 1) === what) return
    const line = `${new Date(now).toISOString().replace(/\.\d+Z$/, 'Z')} ${what}\n`
    if (Buffer.byteLength(text) + Buffer.byteLength(line) > LOG_BYTES) {
      const tmp = `${LOG}.${process.pid}.tmp`
      fs.writeFileSync(tmp, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n' + line)
      fs.renameSync(tmp, LOG)
    } else fs.appendFileSync(LOG, line)
  } catch {}
}

/** The rows last drawn for the session the input names, as the player finds it; null when there are none. */
function lastRows(text) {
  const at = text.indexOf('"session_id":"')
  const id = at < 0 ? '' : text.slice(at + 14, text.indexOf('"', at + 14))
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? read(`${home}/frames/${id}/last`) || null : null
}

/**
 * The plugin folders to draw from, in order: the one the pointer names, then the folder LCW was set up from and the
 * installed plugin's, which are looked up only when `more` is asked for.
 */
function folders() {
  const pointer = read(new URL('../plugin-root', import.meta.url))?.trim()
  let rest = null
  const more = async () => {
    if (rest) return rest
    const setup = read(new URL('./setup-root', import.meta.url))?.trim()
    let installed = null
    try { installed = (await import('./installed.mjs')).installedFolder() } catch {}
    rest = [...new Set([setup, installed].filter(holds))].filter((dir) => dir !== pointer)
    if (!holds(pointer)) {
      const gone = pointer ? `the plugin folder ${pointer} named in ${home}/plugin-root is gone` : `${home}/plugin-root names no plugin folder`
      if (rest.length) log(`${gone}; drawing from ${rest[0]}. Run LCW setup again to point at it.`)
      else log(`${gone}, and no installed copy of LCW was found. Install LCW again, or run its setup.`)
    }
    return rest
  }
  return { first: holds(pointer) ? pointer : null, more }
}

/** One fresh draw by code from before frames ahead, which reads the input from stdin; null when it prints nothing. */
function freshFrom(root, text) {
  const code = `const { main } = await import(${JSON.stringify(pathToFileURL(`${root}/scripts/statusline.mjs`).href)}); await main({ margin: 4 })`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
  return r.status === 0 && r.stdout ? r.stdout : null
}

async function run() {
  let text = ''
  try { text = fs.readFileSync(0, 'utf8') } catch {}
  const at = process.argv[2]
  try {
    const { first, more } = folders()
    // A folder whose code is older than frames ahead, as a session open from before an update can leave the
    // pointer at, is passed over for one that can draw ahead; with none, the older code draws afresh each tick.
    let older = null
    const list = first ? [first] : await more()
    for (let i = 0; i < list.length; i++) {
      const root = list[i]
      let lcw
      try { lcw = await import(pathToFileURL(`${root}/scripts/statusline.mjs`).href) } catch (e) {
        log(`LCW's code in ${root} could not be loaded (${String(e?.message ?? e).split('\n')[0]}). Update or reinstall LCW.`)
        if (older) break
        return lastRows(text) ?? BROKEN
      }
      if (typeof lcw.ahead !== 'function') {
        if (!older && first && at !== undefined) list.push(...await more())
        older ??= root
        continue
      }
      if (at === undefined) { await lcw.main({ margin: 4, input: text }); return '' }
      if (older) log(`LCW's code in ${older} is older than this status line; drawing from ${root}. Run LCW setup again.`)
      try { return await lcw.ahead(text, { at, margin: 4 }) } catch (e) {
        log(`The status line could not be drawn (${String(e?.message ?? e).split('\n')[0]}). Update or reinstall LCW if it goes on.`)
        return lastRows(text) ?? BROKEN
      }
    }
    if (!older) return lastRows(text) ?? BROKEN
    if (at !== undefined) log(`LCW's code in ${older} is older than this status line, and no newer copy was found; each tick is drawn afresh. Run LCW setup again.`)
    return freshFrom(older, text) ?? lastRows(text) ?? BROKEN
  } catch { return lastRows(text) ?? BROKEN }
}

process.stdout.on('error', () => {})
try { process.stdout.write(await run()) } catch { try { process.stdout.write(BROKEN) } catch {} }
