// The status line's files, which setup and the session-start hook copy from the plugin's scripts/bin into the LCW home.
import fs from 'node:fs'
import { writeAtomic } from './store.mjs'
import { installedFolders, isInstalled } from '../bin/installed.mjs'

// in this order: an older launcher still answers a newer player, and while there is no player the command runs the launcher alone
export const STATUS_FILES = ['installed.mjs', 'statusline.mjs', 'statusline.sh']

/**
 * Whether the plugin at root is installed now: an older version left in the cache counts as installed, but a session
 * still open on it must not move the status line back. So where records name folders that hold the plugin, root is
 * one of them, in any scope or order; where none does, any installed copy is.
 */
export function isCurrentInstall(root) {
  if (!isInstalled(root)) return false
  const named = installedFolders()
  try { return !named.length || named.includes(fs.realpathSync(root)) } catch { return false }
}

const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }

/** Copies them from the plugin at root as they are, each only when it differs, and notes root in bin/setup-root. */
export function copyStatusFiles(root, lcwHome) {
  const bin = `${lcwHome}/bin`
  if (read(`${bin}/setup-root`) !== root + '\n') writeAtomic(`${bin}/setup-root`, root + '\n')
  for (const f of STATUS_FILES) {
    const text = fs.readFileSync(`${root}/scripts/bin/${f}`, 'utf8')
    if (read(`${bin}/${f}`) !== text) writeAtomic(`${bin}/${f}`, text)
  }
}
