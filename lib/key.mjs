// Keys and paths of the LCW archive. Pure code: no Node APIs, so the mod and the scripts share it.

/** 32-bit FNV-1a over the UTF-8 bytes of str, as 8 lower-case hex digits. */
export function fnv1a32hex(str) {
  let h = 0x811c9dc5
  for (const byte of utf8(String(str))) {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function utf8(str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    const c = str.codePointAt(i)
    if (c > 0xffff) i++
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

/** Lower-case letters, digits and dashes only. */
export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
}

/** <basename>-<hash of the absolute path of the main checkout>. */
export function repoKey(mainCheckoutPath) {
  const path = String(mainCheckoutPath).replace(/\/+$/, '')
  return `${slug(path.split('/').pop())}-${fnv1a32hex(path)}`
}

export const sessionFile = (lcwHome, sessionId) => `${lcwHome}/sessions/${sessionId}.json`
export const placeFile = (lcwHome, absPath) => `${lcwHome}/places/${fnv1a32hex(String(absPath).replace(/\/+$/, ''))}.json`
export const spendFile = (lcwHome, sessionId) => `${lcwHome}/spend/${sessionId}.json`
export const spendDir = (lcwHome) => `${lcwHome}/spend`
export const capFile = (lcwHome) => `${lcwHome}/cap.json`
/** The banners the person said never to show again on this machine: { advisor: 'never', spend: 'never' }. */
export const noticesFile = (lcwHome) => `${lcwHome}/notices.json`
// One bounded filename per connection avoids read-modify-write loss between different connections' choices.
export async function proxyQuotaNoticeFile(lcwHome, endpoint) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(utf8(endpoint))))
  return `${lcwHome}/notices/proxy-quota/${[...digest].map((b) => b.toString(16).padStart(2, '0')).join('')}.json`
}
/** The spend command the person set, and what it last gave. */
export const spendCommandFile = (lcwHome) => `${lcwHome}/spend-command.json`
export const spendReadingFile = (lcwHome) => `${lcwHome}/spend-reading.json`
/** The lock of one 5-minute window: whoever creates it runs the spend command in that window. */
export const spendTryFile = (lcwHome, window) => `${lcwHome}/cache/spend-try-${window}`
export const quotaFile = (lcwHome) => `${lcwHome}/quota-command.json`
export const usageFile = (lcwHome) => `${lcwHome}/usage.json`
/** What a session is doing, as its hooks last recorded it: the mascot's mood is read from it. */
export const contextFile = (lcwHome, sessionId) => `${lcwHome}/cache/context-${sessionId}.json`
export const activityFile = (lcwHome, sessionId) => `${lcwHome}/activity/${sessionId}.json`
export const runsDir = (lcwHome, key) => `${lcwHome}/repos/${key}/runs`
/** The update check's result: the versions available and updated, and their bullets. */
export const updateFile = (lcwHome) => `${lcwHome}/update.json`
/** When the machine-wide weekly update check last ran. */
export const checksFile = (lcwHome) => `${lcwHome}/checks.json`
/** When this repository's weekly cleanup check last ran. */
export const repoChecksFile = (lcwHome, key) => `${lcwHome}/repos/${key}/checks.json`
/** The cleanup box a check recorded for this repository. */
export const cleanupFile = (lcwHome, key) => `${lcwHome}/repos/${key}/cleanup.json`
/** The keep-awake hold of a run. */
export const awakeFile = (runDir) => `${runDir}/awake`

/** Every file of one run. */
export function runPaths(runDir) {
  return {
    dir: runDir,
    state: `${runDir}/state.json`,
    ledger: `${runDir}/ledger.md`,
    brainstorm: `${runDir}/brainstorm.md`,
    spec: `${runDir}/spec.md`,
    plan: `${runDir}/plan.md`,
    artifacts: `${runDir}/artifacts`,
    checkpoint: `${runDir}/checkpoint`,
    gate: `${runDir}/gate`,
    modAlive: `${runDir}/mod-alive`,
    quiet: `${runDir}/quiet-agents.json`,
    awake: `${runDir}/awake`,
  }
}
