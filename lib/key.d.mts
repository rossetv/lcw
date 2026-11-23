export function fnv1a32hex(str: string): string
export function slug(text: string): string
export function repoKey(mainCheckoutPath: string): string
export function sessionFile(lcwHome: string, sessionId: string): string
export function placeFile(lcwHome: string, absPath: string): string
export function spendFile(lcwHome: string, sessionId: string): string
export function spendDir(lcwHome: string): string
export function capFile(lcwHome: string): string
export function spendCommandFile(lcwHome: string): string
export function noticesFile(lcwHome: string): string
export function proxyQuotaNoticeFile(lcwHome: string, endpoint: string): Promise<string>
export function spendReadingFile(lcwHome: string): string
export function spendTryFile(lcwHome: string, window: number): string
export function quotaFile(lcwHome: string): string
export function usageFile(lcwHome: string): string
export function activityFile(lcwHome: string, sessionId: string): string
export function runsDir(lcwHome: string, key: string): string
export function updateFile(lcwHome: string): string
export function checksFile(lcwHome: string): string
export function repoChecksFile(lcwHome: string, key: string): string
export function cleanupFile(lcwHome: string, key: string): string
export function awakeFile(runDir: string): string
export function runPaths(runDir: string): {
  dir: string; state: string; ledger: string; brainstorm: string; spec: string; plan: string; artifacts: string
  checkpoint: string; gate: string; modAlive: string; quiet: string; awake: string
}
