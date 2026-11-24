// The status line's files, which setup and the session-start hook copy from the plugin's scripts/bin into the LCW home.
import fs from 'node:fs'
import { writeAtomic } from './store.mjs'

// in this order: an older launcher still answers a newer player, and while there is no player the command runs the launcher alone
export const STATUS_FILES = ['installed.mjs', 'statusline.mjs', 'statusline.sh']

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
