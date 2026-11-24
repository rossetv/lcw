// LCW's status line, run as `node <LCW home>/bin/statusline.mjs [second]` with Claude Code's input on stdin. Setup
// copies it there as it is. It finds the plugin, draws, and prints rows whatever fails: the session's last rows,
// or one line that says where to look. With the second the player read (date's %s%z), it also saves the frames
// the player prints in the seconds that follow.
import fs from 'node:fs'
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

/** The plugin's folder: the one the pointer names, else the folder LCW was set up from, else the installed plugin's. */
async function pluginRoot() {
  const pointer = read(new URL('../plugin-root', import.meta.url))?.trim()
  if (holds(pointer)) return pointer
  const setup = read(new URL('./setup-root', import.meta.url))?.trim()
  let installed = null
  if (!holds(setup)) try { installed = (await import('./installed.mjs')).installedFolder() } catch {}
  const found = holds(setup) ? setup : holds(installed) ? installed : null
  const gone = pointer ? `the plugin folder ${pointer} named in ${home}/plugin-root is gone` : `${home}/plugin-root names no plugin folder`
  if (found) log(`${gone}; drawing from ${found}. Run LCW setup again to point at it.`)
  else log(`${gone}, and no installed copy of LCW was found. Install LCW again, or run its setup.`)
  return found
}

async function run() {
  let text = ''
  try { text = fs.readFileSync(0, 'utf8') } catch {}
  const at = process.argv[2]
  try {
    const root = await pluginRoot()
    if (!root) return lastRows(text) ?? BROKEN
    let lcw
    try { lcw = await import(pathToFileURL(`${root}/scripts/statusline.mjs`).href) } catch (e) {
      log(`LCW's code in ${root} could not be loaded (${String(e?.message ?? e).split('\n')[0]}). Update or reinstall LCW.`)
      return lastRows(text) ?? BROKEN
    }
    if (at === undefined) { await lcw.main({ margin: 4, input: text }); return '' }
    if (typeof lcw.ahead !== 'function') {
      log(`LCW's code in ${root} is older than this status line. Run LCW setup again.`)
      return lastRows(text) ?? BROKEN
    }
    try { return await lcw.ahead(text, { at, margin: 4 }) } catch (e) {
      log(`The status line could not be drawn (${String(e?.message ?? e).split('\n')[0]}). Update or reinstall LCW if it goes on.`)
      return lastRows(text) ?? BROKEN
    }
  } catch { return lastRows(text) ?? BROKEN }
}

process.stdout.on('error', () => {})
try { process.stdout.write(await run()) } catch { try { process.stdout.write(BROKEN) } catch {} }
