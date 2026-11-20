// Where LCW was installed from, and what version that source holds now: shared by update.mjs, which writes the banner's
// update, and weekly.mjs update, which looks for one at the start of every session.
import { spawnSync } from 'node:child_process'
import { readJson } from './store.mjs'

const MARKETPLACE = 'lcw'
export const ID = `lcw@${MARKETPLACE}`

export const plugins = () => `${process.env.CLAUDE_CONFIG_DIR || `${process.env.HOME}/.claude`}/plugins`

/** Runs a command; ok only on exit 0. text is what it said, stdout and stderr, trimmed. */
export function sh(cmd, args, { cwd, timeout = 60000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] })
  const text = `${r.stdout || ''}${r.stderr || ''}`.trim()
  if (r.error) return { ok: false, out: '', text: r.error.code === 'ENOENT' ? `${cmd} was not found` : r.error.message }
  return { ok: r.status === 0, out: (r.stdout || '').trim(), text: text || `${cmd} exited with code ${r.status}` }
}

/** 1.10.0 > 1.9.2; anything after a dash or plus is ignored. */
export function newer(a, b) {
  const part = (v) => String(v).split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0)
  const [x, y] = [part(a), part(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  }
  return false
}

export function installed() {
  const entry = readJson(`${plugins()}/installed_plugins.json`)?.plugins?.[ID]?.[0]
  return entry?.version ? entry : null
}

/** The marketplace and the installed copy, when LCW came from one that is not a folder checkout; else null. */
export function updatable() {
  const market = readJson(`${plugins()}/known_marketplaces.json`)?.[MARKETPLACE]
  const mine = installed()
  if (!market || !mine || market.source?.source === 'directory' || market.source?.source === 'file') return null
  return { market, mine }
}

/**
 * Refreshes the marketplace and reads the version it now holds: { market, mine, version }, or null when LCW cannot be
 * updated from where it was installed. A refresh or a read that fails throws one plain line.
 */
export function marketVersion() {
  const from = updatable()
  if (!from) return null
  const refresh = sh('claude', ['plugin', 'marketplace', 'update', MARKETPLACE], { timeout: 120000 })
  if (!refresh.ok) throw new Error(`Could not refresh the LCW marketplace: ${refresh.text.split('\n')[0]}`)
  const version = readJson(`${from.market.installLocation}/.claude-plugin/plugin.json`)?.version
  if (!version) throw new Error('Could not read the new LCW version from the marketplace.')
  return { ...from, version }
}
