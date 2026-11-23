// Setup: node setup.mjs install [--advisor]|advisor|statusline|auto|uninstall|status [--settings <path>]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { home, readJson, writeAtomic, writeJson } from './lib/store.mjs'
import { noticesFile } from '../lib/key.mjs'

const [cmd, ...rest] = process.argv.slice(2)
const i = rest.indexOf('--settings')
const settingsPath = i >= 0 ? rest[i + 1] : `${process.env.CLAUDE_CONFIG_DIR || `${process.env.HOME}/.claude`}/settings.json`
const lcw = home()
const shim = `${lcw}/bin/statusline.mjs`
const prevFile = `${lcw}/previous-statusline.json`
const addedDirFile = `${lcw}/added-directory`
const advisorFile = `${lcw}/set-advisor`
const depthFile = `${lcw}/set-depth`
const attributionFile = `${lcw}/previous-attribution.json`
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let quiet = false // auto prints only its own lines
const out = (s) => quiet || console.log(s)
const fail = (s) => { console.error(s); process.exit(1) }

const shimText = `// Written by LCW setup. Follows the plugin folder across updates.
import fs from 'node:fs'
let root = ${JSON.stringify(pluginRoot)}
try { root = fs.readFileSync(new URL('../plugin-root', import.meta.url), 'utf8').trim() || root } catch {}
const { main } = await import(\`\${root}/scripts/statusline.mjs\`)
// Under the padding setup writes beside this command, Claude Code shows COLUMNS - 4 cells of each row.
await main({ margin: 4 })
`
const quoted = (p) => `'${p.replace(/'/g, `'\\''`)}'`
// a path with a space or a quote in it is quoted for the shell; a plain one stays bare, as installs before this wrote it
const command = `node ${/^[\w@%+=:,./-]+$/.test(shim) ? shim : quoted(shim)}`

function load() {
  if (!fs.existsSync(settingsPath)) return {}
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    if (s && typeof s === 'object' && !Array.isArray(s)) return s
  } catch {}
  fail(`${settingsPath} is not valid JSON; left untouched.`)
}

/** Writes the settings file whole: through a link to the file it names (a dotfiles manager's), keeping the link and the file's mode. */
function put(text) {
  let target = settingsPath, mode
  try { target = fs.realpathSync(settingsPath); mode = fs.statSync(target).mode & 0o777 } catch {
    // a link (or a chain of them) to a file that is not there yet: write where the last one points
    for (let hop = 0; hop < 8; hop++) {
      try {
        const dir = path.dirname(target)
        let base = dir
        try { base = fs.realpathSync(dir) } catch {}
        target = path.resolve(base, fs.readlinkSync(target))
      } catch { break }
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text, { mode: mode ?? 0o666 })
  if (mode !== undefined) fs.chmodSync(tmp, mode) // the umask narrows a new file's mode
  fs.renameSync(tmp, target)
}

/** Backs up, writes, re-reads; restores the backup if the result does not parse. */
function save(settings) {
  let backup = null
  if (fs.existsSync(settingsPath)) {
    const dir = `${lcw}/backup`
    fs.mkdirSync(dir, { recursive: true })
    const newest = fs.readdirSync(dir).filter((f) => f.startsWith('settings-')).sort().pop()
    // a backup the same as the newest one is not written again: something that keeps changing a setting back would add one a session
    if (newest && fs.readFileSync(`${dir}/${newest}`, 'utf8') === fs.readFileSync(settingsPath, 'utf8')) backup = `${dir}/${newest}`
    else {
      backup = `${dir}/settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      fs.copyFileSync(settingsPath, backup)
      out(`backup: ${backup}`)
    }
  }
  put(JSON.stringify(settings, null, 2) + '\n')
  try { JSON.parse(fs.readFileSync(settingsPath, 'utf8')) } catch {
    if (backup) put(fs.readFileSync(backup, 'utf8'))
    fail('the written settings did not parse; restored the backup.')
  }
}

const mine = (sl) => [`node ${shim}`, `node ${quoted(shim)}`].includes(sl?.command)

/** Turns on the advisor a run consults at every stage; leaves a choice the human already made. */
function setAdvisor(s) {
  if (s.advisorModel !== undefined) return out(`advisorModel is already "${s.advisorModel}"; left as it is`)
  s.advisorModel = 'fable'
  writeAtomic(advisorFile, 'fable\n')
  out('set advisorModel to "fable": a second model reviews the work at every stage of a run')
}

/** Writes the shim and sets LCW's status rows, keeping the status line that was there. */
function setStatusLine(s) {
  writeAtomic(shim, shimText)
  out(`wrote ${shim}`)
  // the line replaced is saved each time it is not LCW's own, so uninstall restores the newest one the person had
  if (s.statusLine && !mine(s.statusLine)) {
    writeAtomic(prevFile, JSON.stringify(s.statusLine, null, 2) + '\n')
    out(`saved your previous statusLine to ${prevFile}`)
  } else if (!s.statusLine) fs.rmSync(prevFile, { force: true }) // the person deleted the saved line: uninstall must not bring it back
  // every second, the shortest Claude Code allows: the mascot moves once a second. A padding of 0 starts the
  // rows two cells in and shows COLUMNS - 4 of them whole (seen in 2.1.327; the shim tells the script how much
  // room it has).
  s.statusLine = { type: 'command', command, refreshInterval: 1, padding: 0 }
  out(`set statusLine to: ${command}`)
}

/** Whether this folder's own settings files set a status line: it then wins over the user's, so auto leaves it alone. */
const projectStatusLine = () => ['settings.json', 'settings.local.json'].some((f) => {
  try { return !!JSON.parse(fs.readFileSync(`${process.cwd()}/.claude/${f}`, 'utf8'))?.statusLine } catch { return false }
})

const attributionOff = (s) => s.attribution?.commit === '' && s.attribution?.pr === ''

/** No AI attribution, ever: Claude Code otherwise adds a Co-Authored-By trailer to commits and a line to pull requests. Returns whether it changed. */
function setAttributionOff(s) {
  if (attributionOff(s)) return false
  const att = s.attribution && typeof s.attribution === 'object' ? s.attribution : null
  // the original is saved once: a later run, with LCW's own value or the person's second thoughts, never replaces it
  if (!fs.existsSync(attributionFile)) writeAtomic(attributionFile, JSON.stringify(s.attribution ?? null) + '\n')
  s.attribution = { ...att, commit: '', pr: '' }
  return true
}

/** The depth of nested agents a run needs and the LCW folder as a place to write; each only when not already set. Returns whether it changed. */
function setRunSettings(s) {
  let changed = false
  s.env = s.env && typeof s.env === 'object' ? s.env : {}
  if (s.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH === undefined) {
    s.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = '5'
    writeAtomic(depthFile, '5\n')
    out('set env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH to "5"')
    changed = true
  }
  const perms = s.permissions && typeof s.permissions === 'object' ? s.permissions : (s.permissions = {})
  const dirs = Array.isArray(perms.additionalDirectories) ? perms.additionalDirectories : (perms.additionalDirectories = [])
  if (!dirs.includes(lcw)) {
    dirs.push(lcw)
    writeAtomic(addedDirFile, lcw + '\n')
    out(`added ${lcw} to permissions.additionalDirectories, so an unattended run can write its records there`)
    changed = true
  }
  return changed
}

if (cmd === 'install') {
  const s = load()
  setStatusLine(s)
  const notices = readJson(noticesFile(lcw))
  // a set up turns automatic setup back on and lets the advisor and spend boxes ask again (the cap box keeps no choice); the other boxes' choices stay
  const asksAgain = ['auto', 'advisor', 'spend']
  if (notices && asksAgain.some((k) => k in notices)) { for (const k of asksAgain) delete notices[k]; writeJson(noticesFile(lcw), notices) }
  setRunSettings(s)
  if (setAttributionOff(s)) out('set attribution.commit and attribution.pr to "": no AI attribution in commits or pull requests')
  if (rest.includes('--advisor')) setAdvisor(s)
  save(s)
} else if (cmd === 'advisor') {
  const s = load()
  setAdvisor(s)
  save(s)
} else if (cmd === 'statusline') {
  const s = load()
  setStatusLine(s)
  save(s)
} else if (cmd === 'auto') {
  // Runs on an interactive session's first draw: prints a line for each thing it turned on, and nothing otherwise.
  quiet = true
  const notices = readJson(noticesFile(lcw)) ?? {}
  if (notices.auto !== 'off') {
    const s = load()
    const said = []
    if (!s.statusLine && notices.statusline !== 'never' && !projectStatusLine()) {
      setStatusLine(s)
      said.push('LCW turned on its status rows. Say "uninstall LCW" to undo it.')
    }
    const attributionChanged = setAttributionOff(s)
    const tell = attributionChanged && !notices.attributionTold // the first time on a machine only
    if (tell) said.push('LCW turned off the AI attribution Claude Code adds to commits and pull requests. Say "uninstall LCW" to put it back.')
    if (attributionChanged || said.length) {
      save(s)
      if (tell) writeJson(noticesFile(lcw), { ...notices, attributionTold: true })
      for (const line of said) console.log(line)
    }
  }
} else if (cmd === 'uninstall') {
  const s = load()
  const done = [] // the records of what install changed, removed only once the settings are saved without them
  if (mine(s.statusLine)) {
    const prev = readJson(prevFile)
    if (prev && typeof prev === 'object' && !Array.isArray(prev) && typeof prev.command === 'string' && prev.command.trim() !== '') { s.statusLine = prev; out('restored your previous statusLine') }
    else { delete s.statusLine; out('removed statusLine') }
  }
  done.push(prevFile) // a saved line the person has since replaced is not kept for a later install
  if (s.env?.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH === '5' && fs.existsSync(depthFile)) {
    delete s.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH
    if (!Object.keys(s.env).length) delete s.env
    out('removed env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH')
  } else if (s.env?.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH === '5') {
    out('left env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH at "5": LCW has no record of setting it; remove it yourself if LCW did')
  }
  done.push(depthFile)
  if (fs.existsSync(addedDirFile) && Array.isArray(s.permissions?.additionalDirectories)) {
    s.permissions.additionalDirectories = s.permissions.additionalDirectories.filter((x) => x !== lcw)
    if (!s.permissions.additionalDirectories.length) delete s.permissions.additionalDirectories
    if (!Object.keys(s.permissions).length) delete s.permissions
    out(`removed ${lcw} from permissions.additionalDirectories`)
  }
  done.push(addedDirFile)
  if (fs.existsSync(attributionFile)) {
    let prev
    try { prev = JSON.parse(fs.readFileSync(attributionFile, 'utf8')) } catch { prev = undefined }
    // only while it is still as LCW set it; what the person has set beside commit and pr wins over the record
    if (prev === undefined) out('left your attribution setting: LCW\'s record of the old one is unreadable')
    else if (attributionOff(s)) {
      const { commit, pr, ...kept } = s.attribution
      s.attribution = { ...(prev && typeof prev === 'object' ? prev : {}), ...kept }
      if (!Object.keys(s.attribution).length) delete s.attribution
      out('restored your previous attribution setting')
    } else out('left your attribution setting: it has changed since LCW set it')
    done.push(attributionFile)
  }
  if (fs.existsSync(advisorFile) && s.advisorModel === 'fable') { delete s.advisorModel; out('removed advisorModel') }
  done.push(advisorFile)
  if (fs.existsSync(settingsPath)) save(s)
  for (const f of done) fs.rmSync(f, { force: true })
  if (fs.existsSync(shim)) { fs.rmSync(shim); out(`deleted ${shim}`) }
  // neither the status rows nor the attribution come back by themselves, until the person says "set up LCW"
  writeJson(noticesFile(lcw), { ...readJson(noticesFile(lcw)), auto: 'off' })
} else if (cmd === 'status') {
  const s = fs.existsSync(settingsPath) ? load() : {}
  out(`settings: ${settingsPath}`)
  out(`statusLine: ${mine(s.statusLine) ? 'LCW' : s.statusLine ? 'another command' : 'none'}`)
  out(`shim: ${fs.existsSync(shim) ? 'present' : 'missing'}`)
  out(`previous statusLine saved: ${fs.existsSync(prevFile) ? 'yes' : 'no'}`)
  out(`permissions.additionalDirectories has ${lcw}: ${s.permissions?.additionalDirectories?.includes(lcw) ? 'yes' : 'no'}`)
  out(`env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: ${s.env?.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH ?? 'unset'}`)
  out(`advisorModel: ${s.advisorModel ?? 'unset'}`)
  out(`AI attribution: ${s.attribution?.commit === '' && s.attribution?.pr === '' ? 'off' : 'on'}`)
} else {
  fail('usage: node setup.mjs install [--advisor]|advisor|statusline|auto|uninstall|status [--settings <path>]')
}
