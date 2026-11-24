// Which copy of LCW is the installed one, read from Claude Code's own records. It imports nothing from the
// plugin, as a copy of this file also runs alone beside the status-line launcher when the plugin's folder is gone.
import fs from 'node:fs'
import path from 'node:path'

const NAME = 'lcw'
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
const real = (p) => { try { return fs.realpathSync(p) } catch { return null } }

/** The folders the records give as the installed plugin, and the cache folders whose copies count as installed. */
function places() {
  const plugins = `${process.env.CLAUDE_CONFIG_DIR || `${process.env.HOME}/.claude`}/plugins`
  const markets = readJson(`${plugins}/known_marketplaces.json`)
  const installs = readJson(`${plugins}/installed_plugins.json`)?.plugins
  const folders = []
  const caches = []
  if (!markets || typeof markets !== 'object') return { folders, caches }
  for (const [name, market] of Object.entries(markets)) {
    if (market?.source?.source === 'directory') {
      // a directory marketplace's recorded install path can name an older copy long after the plugin moved, so it is never read
      const base = market.source.path ?? market.installLocation
      if (typeof base !== 'string') continue
      const listed = readJson(path.join(base, '.claude-plugin', 'marketplace.json'))?.plugins
      const source = Array.isArray(listed) ? listed.find((p) => p?.name === NAME)?.source : undefined
      if (typeof source === 'string') folders.push(path.resolve(base, source))
    } else {
      const records = installs?.[`${NAME}@${name}`]
      if (Array.isArray(records)) for (const r of records) if (typeof r?.installPath === 'string') folders.push(r.installPath)
      caches.push(path.join(plugins, 'cache', name, NAME))
    }
  }
  return { folders, caches }
}

/** Whether the plugin in `folder` is the one Claude Code loads in ordinary sessions; a throwaway copy is not. */
export function isInstalled(folder) {
  try {
    const me = real(folder) ?? path.resolve(folder)
    const { folders, caches } = places()
    return folders.some((f) => real(f) === me) || caches.some((c) => { const r = real(c); return r !== null && me.startsWith(r + path.sep) })
  } catch { return false }
}

/** Every folder the records give as the installed plugin that still exists and holds it, by real path, in record order. */
export function installedFolders() {
  try {
    return places().folders.filter((f) => readJson(path.join(f, '.claude-plugin', 'plugin.json'))?.name === NAME).map(real).filter(Boolean)
  } catch { return [] }
}

/** The installed plugin's folder, if it still exists and holds the plugin; null otherwise. */
export function installedFolder() {
  try {
    for (const f of places().folders) {
      if (readJson(path.join(f, '.claude-plugin', 'plugin.json'))?.name === NAME) return real(f)
    }
  } catch {}
  return null
}
