// LCW's status line, run as `node <LCW home>/bin/statusline.mjs [second]` with Claude Code's input on stdin. Setup
// copies it there as it is. It finds the plugin, draws, and prints rows whatever fails: the session's last rows,
// or one line that says where to look. With the second the player read (date's %s%z), it also saves the frames
// the player prints in the seconds that follow.
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const home = process.env.LCW_HOME || `${process.env.HOME}/.lcw`
const LOG = `${home}/statusline.log`
const LOG_BYTES = 64 * 1024
const BROKEN = 'LCW · status line could not load · see ~/.lcw/statusline.log\n'

const read = (file) => { try { return fs.readFileSync(file, 'utf8') } catch { return null } }
const holds = (dir) => !!dir && dir.startsWith('/') && fs.existsSync(`${dir}/scripts/statusline.mjs`)

// A fault already among the last lines is not written again, so faults of a few sessions that take turns add nothing.
const RECENT = 8

/** Writes one line saying what failed, unless a recent line already says it; the log is cut to its newest half past 64 KB. */
function log(what, now = Date.now()) {
  try {
    const text = read(LOG) ?? ''
    const lines = text.split('\n').filter(Boolean)
    if (lines.slice(-RECENT).some((l) => l.slice(l.indexOf(' ') + 1) === what)) return
    const line = `${new Date(now).toISOString().replace(/\.\d+Z$/, 'Z')} ${what}\n`
    if (Buffer.byteLength(text) + Buffer.byteLength(line) > LOG_BYTES) {
      const tmp = `${LOG}.${process.pid}.tmp`
      fs.writeFileSync(tmp, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n' + line)
      fs.renameSync(tmp, LOG)
    } else fs.appendFileSync(LOG, line)
  } catch {}
}

/**
 * What an error says, and the file and line it was raised at when its stack gives them. An error in loading code
 * (`url`) gives none in Node's stack; loading it alone in a second Node, which prints the place first, does.
 */
function why(e, url) {
  const file = (line) => { const m = /(file:\/\/[^\s()]+?):(\d+)(?::\d+)?\)?\s*$/.exec(line ?? ''); try { return m ? `${fileURLToPath(m[1])}:${m[2]}` : null } catch { return null } }
  let where = file(String(e?.stack ?? '').split('\n').find((l) => l.includes('file://')))
  if (!where && url) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], timeout: 3000, killSignal: 'SIGKILL' })
    where = file(String(r.stderr ?? '').split('\n')[0])
  }
  return `${String(e?.message ?? e).split('\n')[0]}${where ? ` at ${where}` : ''}`
}

/** The rows last drawn for the session the input names, as the player finds it; null when there are none. */
function lastRows(text) {
  const at = text.indexOf('"session_id":"')
  const id = at < 0 ? '' : text.slice(at + 14, text.indexOf('"', at + 14))
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? read(`${home}/frames/${id}/last`) || null : null
}

/**
 * The plugin folders to draw from, in order: the one the pointer names, then the folder LCW was set up from and the
 * installed plugin's, which are looked up only when `more` is asked for. `gone` says what is wrong with the pointer.
 */
function folders() {
  // the pointer beside this file, which may be another home's than the session's
  const file = fileURLToPath(new URL('../plugin-root', import.meta.url))
  const pointer = read(file)?.trim()
  const more = async () => {
    const setup = read(new URL('./setup-root', import.meta.url))?.trim()
    let installed = null
    try { installed = (await import('./installed.mjs')).installedFolder() } catch {}
    return [...new Set([setup, installed].filter(holds))].filter((dir) => dir !== pointer)
  }
  const gone = holds(pointer) ? null : pointer ? `The plugin folder ${pointer} named in ${file} is gone` : `${file} names no plugin folder`
  return { file, first: gone ? null : pointer, gone, more }
}

/** One fresh draw by code from before frames ahead, which reads the input from stdin; null when it prints nothing in 3 seconds. */
function freshFrom(root, text) {
  const code = `const { main } = await import(${JSON.stringify(pathToFileURL(`${root}/scripts/statusline.mjs`).href)}); await main({ margin: 4 })`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000, killSignal: 'SIGKILL' })
  return r.status === 0 && r.stdout ? r.stdout : null
}

async function run() {
  let text = ''
  try { text = fs.readFileSync(0, 'utf8') } catch {}
  const at = process.argv[2]
  // What went wrong this draw, written as one line once the draw is settled, so the same fault writes the same line.
  const notes = []
  const done = (out) => { if (notes.length) log(notes.join(' ')); return out }
  try {
    const { file, first, gone, more } = folders()
    // A folder whose code is older than frames ahead, as a session open from before an update can leave the
    // pointer at, is passed over for one that can draw ahead; with none, the older code draws afresh each tick.
    let older = null
    const list = first ? [first] : await more()
    for (let i = 0; i < list.length; i++) {
      const root = list[i]
      let lcw
      const url = pathToFileURL(`${root}/scripts/statusline.mjs`).href
      try { lcw = await import(url) } catch (e) {
        notes.push(`LCW's code in ${root} could not be loaded (${why(e, url)}): update or reinstall LCW.`)
        if (older) break
        if (gone) notes.unshift(`${gone}.`)
        return done(lastRows(text) ?? BROKEN)
      }
      if (typeof lcw.ahead !== 'function') {
        if (!older && first && at !== undefined) list.push(...await more())
        older ??= root
        continue
      }
      const passed = gone ?? (older && at !== undefined ? `LCW's code in ${older} is older than this status line` : null)
      if (passed) notes.unshift(`${passed}; the rows are drawn from ${root}, and nothing needs doing: the next Claude Code session points ${file} at the installed plugin.`)
      if (at === undefined) { done(); await lcw.main({ margin: 4, input: text }); return '' }
      try { return done(await lcw.ahead(text, { at, margin: 4 })) } catch (e) {
        notes.push(`The status line could not be drawn (${why(e)}): update or reinstall LCW if it goes on.`)
        return done(lastRows(text) ?? BROKEN)
      }
    }
    if (!older) { notes.unshift(`${gone}, and no other copy of LCW was found: install LCW again.`); return done(lastRows(text) ?? BROKEN) }
    if (at !== undefined) notes.unshift(`${gone ? `${gone}. ` : ''}LCW's code in ${older} is older than this status line and no newer copy was found, so each tick is drawn afresh: update LCW.`)
    return done(freshFrom(older, text) ?? lastRows(text) ?? BROKEN)
  } catch { return done(lastRows(text) ?? BROKEN) }
}

process.stdout.on('error', () => {})
try { process.stdout.write(await run()) } catch { try { process.stdout.write(BROKEN) } catch {} }
