// The money LCW counts on pay-per-token billing. Pure code, shared by the mod and the scripts: the time is
// always passed in, and nothing here reads or writes a file.
//
// One record per session: {v:1, base, max, q:{<quarter>: <highest cumulative cost seen in that quarter>}}.
// A quarter is floor(epochMs / 900000). The spend since a time t is what the buckets from t's quarter on added,
// so the quarter holding t counts whole.

const QUARTER = 900000
const DAY = 86400000
const WEEK = 7 * DAY
export const DEFAULT_CAP_USD = 4000
/** Failed runs of the spend command in a row after which its figure is called failing. */
export const SPEND_COMMAND_FAILS = 3

const quarterOf = (ms) => Math.floor(ms / QUARTER)
const usable = (rec) => rec && typeof rec.max === 'number' && typeof rec.base === 'number' && rec.q && typeof rec.q === 'object'

/**
 * Fold a cost reading into a session's record and return the new one (the same object when nothing changed).
 * The first reading sets base and nothing before it counts. A reading lower than the highest seen is ignored:
 * a resumed session shows its earlier cost again and must not count it twice. Buckets older than 8 days are
 * dropped and base takes the newest dropped value, so a session resumed after a long gap does not count its
 * whole history again.
 */
export function recordReading(rec, rawCost, now) {
  const old = usable(rec) ? rec : null
  if (typeof rawCost !== 'number' || !Number.isFinite(rawCost) || rawCost < 0) return old
  const k = quarterOf(now)
  if (!old) return { v: 1, base: rawCost, max: rawCost, q: { [k]: rawCost } }
  if (rawCost < old.max || (rawCost === old.max && String(k) in old.q)) return old
  const next = { v: 1, base: old.base, max: rawCost, q: { ...old.q, [k]: rawCost } }
  const oldest = k - 8 * 96
  for (const key of Object.keys(next.q).map(Number).sort((a, b) => a - b)) {
    if (key >= oldest) break
    next.base = Math.max(next.base, next.q[key])
    delete next.q[key]
  }
  return next
}

/**
 * Whether a spend file written at mtimeMs can hold spend from the last 7 days. Records are kept for good, so a
 * resumed session is never counted twice, but one untouched for 8 days adds nothing to any figure, and skipping
 * it keeps the work of each tick from growing with every session there has ever been. An unknown time (0) is read.
 */
export const spendFileCounts = (mtimeMs, now) => !(mtimeMs > 0 && mtimeMs < now - 8 * DAY)

/** What each bucket of each record added, as [quarter, dollars] sorted by quarter. */
function additions(records) {
  const out = []
  for (const rec of records) {
    if (!usable(rec)) continue
    let prev = rec.base
    for (const key of Object.keys(rec.q).map(Number).sort((a, b) => a - b)) {
      out.push([key, rec.q[key] - prev])
      prev = rec.q[key]
    }
  }
  return out.sort((a, b) => a[0] - b[0])
}

/** Dollars spent since time t, over every record. */
export function spendSince(records, t, now) {
  if (t >= now) return 0
  const from = quarterOf(t)
  let sum = 0
  for (const [k, d] of additions(records)) if (k >= from) sum += d
  return sum
}

const midnightOf = (now) => new Date(now).setHours(0, 0, 0, 0)

/** The machine's spend in the last 7 days and since local midnight. */
export function machineSpend(records, now) {
  return { week: spendSince(records, now - WEEK, now), today: spendSince(records, midnightOf(now), now) }
}

/** Today's spend as a rate per day; the first hour of the day counts as a whole hour. */
export function ratePerDay(today, now) {
  return today / Math.max((now - midnightOf(now)) / 3600000, 1) * 24
}

/**
 * The highest the 7-day spend reaches over the next 7 days if spending goes on at rate dollars a day, stepping
 * by quarter: each past quarter drops out 7 days after it was spent.
 */
export function pacePeak(records, rate, now) {
  return peakOf(additions(records), rate, now)
}

/** held is a reading's dollars, taken at heldAt: they run down as the reading's days drop out of the 7 days. */
function peakOf(adds, rate, now, held = 0, heldAt = now) {
  const steps = WEEK / QUARTER
  let past = adds.reduce((sum, [, d]) => sum + d, 0)
  let i = 0
  let peak = 0
  for (let j = 0; j <= steps; j++) {
    const from = quarterOf(now + j * QUARTER - WEEK)
    while (i < adds.length && adds[i][0] < from) past -= adds[i++][1]
    peak = Math.max(peak, heldLeft(held, heldAt, now + j * QUARTER) + past + rate * (j * QUARTER) / DAY)
  }
  return peak
}

/**
 * What of a reading's dollars, taken at a time `at`, still falls in the 7 days before `t`: the reading covers the 7
 * days before it, and its oldest days drop out as it ages, taken as spent evenly over its week.
 */
const heldLeft = (usd, at, t) => usd * Math.min(1, Math.max(0, 1 - (t - at) / WEEK))

/** The pace against the full weekly cap: dollars spare, or dollars short. */
export function pace(peak, cap) {
  return { usd: Math.abs(cap - peak), short: peak > cap }
}

/** The session's mark in dollars: its dollar mark, else its share mark (75% unless set) of the cap. */
export function markUsdOf(session, cap) {
  return session?.markUsd ?? cap * (session?.markPercent ?? 75) / 100
}

/** The next 08:00 on the machine's clock after now: the same day when now is before 08:00. */
export function next0800(now) {
  const d = new Date(now)
  d.setHours(8, 0, 0, 0)
  if (d.getTime() <= now) {
    d.setDate(d.getDate() + 1)
    d.setHours(8, 0, 0, 0)
  }
  return d.getTime()
}

/** What a run has spent: what the session had spent before the run, plus what it spent since the run began. */
export function runSpend(state, sessionCum) {
  return (state?.usdBefore ?? 0) + sessionCum - (state?.usdAtStart ?? sessionCum)
}

const isObj = (x) => x !== null && typeof x === 'object'

/**
 * The reading of the spend command, from the setting and the reading files, or null when it is not one: both
 * must be objects, the reading must be for the command now set, and it must hold a usable figure and time.
 */
export function readingOf(setting, reading) {
  if (!isObj(setting) || !isObj(reading)) return null
  if (typeof setting.command !== 'string' || setting.command === '' || reading.command !== setting.command) return null
  if (typeof reading.usd !== 'number' || !Number.isFinite(reading.usd) || reading.usd < 0) return null
  if (typeof reading.at !== 'number' || !Number.isFinite(reading.at)) return null
  return {
    usd: reading.usd,
    at: reading.at,
    fails: Number.isInteger(reading.fails) && reading.fails >= 0 ? reading.fails : 0,
    failingSince: typeof reading.failingSince === 'number' ? reading.failingSince : null,
    lastError: typeof reading.lastError === 'string' ? reading.lastError : null,
  }
}

/**
 * The money view the renderer takes, for a session on pay-per-token billing. cap is the parsed cap file
 * ({usd}) or null when there is none, and then the default is assumed (a plain number counts as stated).
 */
export function moneyFrom({ records, cap, session, state, sessionCum, now, reading }) {
  const stated = typeof cap === 'number' ? cap : cap?.usd
  const capAssumed = !(Number.isFinite(stated) && stated > 0)
  const capUsd = capAssumed ? DEFAULT_CAP_USD : stated
  const machine = machineSpend(records, now)
  const today = machine.today
  const rate = ratePerDay(today, now)
  const markUsd = markUsdOf(session, capUsd)
  // With a reading of the spend command: what of its figure is still in the 7 days, plus what LCW counted since.
  const from = reading ? Math.max(reading.at, now - WEEK) : 0
  const sinceUsd = reading ? spendSince(records, from, now) : 0
  const week = reading ? heldLeft(reading.usd, reading.at, now) + sinceUsd : machine.week
  const peak = reading
    ? peakOf(additions(records).filter(([k]) => k >= quarterOf(from)), rate, now, reading.usd, reading.at)
    : pacePeak(records, rate, now)
  const view = {
    spentUsd: week,
    todayUsd: today,
    ratePerDay: rate,
    capUsd,
    capAssumed,
    markUsd,
    markShare: session?.markUsd == null ? session?.markPercent ?? 75 : null,
    pace: pace(peak, capUsd),
    atMark: week >= markUsd,
  }
  if (reading) {
    view.command = {
      readingUsd: reading.usd,
      at: reading.at,
      sinceUsd,
      failing: reading.fails >= SPEND_COMMAND_FAILS,
      failingSince: reading.failingSince,
      lastError: reading.lastError,
    }
  }
  if (Number.isFinite(sessionCum)) view.runUsd = runSpend(state, sessionCum)
  return view
}
