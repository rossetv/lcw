// The mascot: a small block creature that stands left of the status rows. No Node APIs.
//
// How it is drawn. A terminal row is taller than its block glyphs, so two rows of glyphs show a gap between them.
// Cells filled with a background colour do join, so a body is filled cells and its face is characters inside
// them. A block glyph is used only where nothing has to join above it: a rounded corner, an ear on top.
import { fnv1a32hex } from './key.mjs';
import { thresholds as TH } from './theme.mjs';

export const GAP = 1;  // cells between it and the status rows

const none = { t: ' ' };
const fill = bg => ({ t: ' ', bg });
const on = (t, c, bg) => ({ t, c, bg });                   // a mark inside a filled cell
const cut = (t, c, b) => (b ? { t, c, b } : { t, c });     // a glyph on its own
const dome = body => [cut('▟', body), fill(body), fill(body), fill(body), cut('▙', body)];
const face = (body, e, mouth, skin = body, lips = 'ink') => [fill(body), on(e[0], 'ink', skin), on(mouth, lips, skin), on(e[1], 'ink', skin), fill(body)];
// The frog's eyes stand on its head: white with a pupil, and its own green when shut.
const frogEye = c => on(c, 'ink', c === '-' ? 'frog' : 'eye');

// Each creature: its two rows, given its two eyes, whether it is mid-move and whether its mouth is open in a
// yawn. It stays where it is, at the left edge, and its shape never changes. It moves only as such a creature
// would: a beak opens, an ear folds or twitches, a frog croaks. The mushroom and the slime move only their faces.
// One more cell on its right holds a mark (a z, a !, a tear).
const creatures = {
  mushroom: (e, moving, open) => [
    [cut('▟', 'cap'), on('•', 'spot', 'cap'), fill('cap'), on('•', 'spot', 'cap'), cut('▙', 'cap')],
    [none, on(e[0], 'ink', 'stem'), on(open ? 'o' : 'ω', 'ink', 'stem'), on(e[1], 'ink', 'stem'), none]],
  slime: (e, moving, open) => [dome('slime'), face('slime', e, open ? 'o' : 'ω')],
  chick: (e, moving, open) => [
    [cut('▟', 'chick'), fill('chick'), cut('▙', 'chick')],
    [on(e[0], 'ink', 'chick'), on(moving || open ? '▼' : '▾', 'beak', 'chick'), on(e[1], 'ink', 'chick')]],
  bunny: (e, moving, open) => [[none, cut('▐', 'bunny'), none, cut(moving ? '▖' : '▌', 'bunny'), none], face('bunny', e, open ? 'o' : '▾')],
  frog: (e, moving, open) => [
    [none, frogEye(e[0]), none, frogEye(e[1]), none],
    [fill('frog'), on('─', 'ink', 'frog'), on(moving || open ? 'o' : '─', 'ink', 'frog'), on('─', 'ink', 'frog'), fill('frog')]],
  cat: (e, moving, open) => [[cut('▖', 'cat'), none, none, none, cut(moving ? '▖' : '▗', 'cat')], face('cat', e, open ? 'o' : 'ω')],
  bear: (e, moving, open) => [[cut('▄', 'bear'), none, none, none, cut(moving ? '▃' : '▄', 'bear')], face('bear', e, open ? 'o' : '▾')],
  penguin: (e, moving, open) => [dome('penguin'), face('penguin', e, moving || open ? '▼' : '▾', 'eye', 'beak')],
};
export const creatureNames = Object.keys(creatures);

/** The creature of a session: the same one for as long as the session lives, any of them for a new session. */
export const creatureFor = seed => creatureNames[parseInt(fnv1a32hex(seed ?? ''), 16) % creatureNames.length];

// A mood is three things: what the session is doing (act), how things are going (luck), and a context that is
// nearly full (hot). The eyes say how things are going; the mark beside the head says what it is doing.
export const acts = ['idle', 'working', 'done', 'asleep', 'needs'];
export const lucks = ['fine', 'good', 'great', 'uneasy', 'bad', 'awful'];

// A yawn, a second a frame: the eyes droop, squeeze shut as the mouth opens, and stay shut as it closes.
const YAWN = [['--', false], ['><', true], ['--', true], ['--', false]];
// It yawns in the four seconds before it falls asleep, and late at night (from midnight to six) every three
// minutes while it rests.
const yawnOf = ({ act, yawn, late }, t) => (
  yawn != null ? YAWN[yawn] ?? null
  : late && act === 'idle' && t % 180 < YAWN.length ? YAWN[t % 180] : null);

const eyesOf = ({ act, luck, hot, late }, t) => (
  act === 'needs' ? '●●' : act === 'asleep' ? '--' : hot ? '><'       // wide for you, shut in sleep, screwed up
  : luck === 'great' ? '**' : luck === 'good' ? '^^'                   // starry, pleased
  : luck === 'uneasy' ? 'óò' : luck === 'bad' ? 'TT' : luck === 'awful' ? 'òó' // worried, crying, angry
  : t % 6 === 5 || (late && t % 6 === 4) ? '--' : '••');             // resting: it blinks, slowly at night

// Three ways to look busy, eight seconds each: a turning cog, bubbling, a question.
const busy = [t => cut('+x'[t % 2], 'mid'), t => cut('.:'[t % 2], 'mid'), t => (t % 2 ? none : cut('?', 'mid'))];

// Confetti for the minute after a run finishes (and its pull request opens), in both cells, four frames.
const CONFETTI = [[['*', 'caution'], ["'", 'Fable']], [['+', 'Fable'], ['.', 'Haiku']], [['.', 'ok'], ['*', 'caution']], [["'", 'Haiku'], ['+', 'ok']]];

// The mark beside the head, and the one beside the face under it (a tear, or confetti).
function marksOf({ act, luck, hot, party }, t) {
  if (party && act !== 'needs') return CONFETTI[t % 4].map(([ch, c]) => cut(ch, c));
  const top = act === 'needs' ? (t % 2 ? none : cut('!', 'needsYou', true))
    : act === 'asleep' ? [cut('z', 'dim'), cut('Z', 'dim'), none][t % 3]
    : luck === 'awful' ? (t % 2 ? none : cut('#', 'needsYou', true))
    : hot ? cut("',"[t % 2], 'sweat')                                   // sweat running
    : luck === 'uneasy' ? (t % 4 < 2 ? cut("'", 'sweat') : none)        // a drop of sweat, now and then
    : act === 'working' ? busy[(t >> 3) % busy.length](t)
    : act === 'done' ? (t % 2 ? none : cut('*', 'caution'))
    : luck === 'great' ? [cut('*', 'caution'), cut('+', 'caution'), cut('.', 'caution'), none][t % 4] // it twinkles
    : t % 24 === 15 || t % 24 === 16 ? cut('~', 'dim') : none;          // resting: it hums
  return [top, luck === 'bad' && act !== 'asleep' ? cut("'."[t % 2], 'sweat') : none];
}

// When it makes its move: every other second when a turn has just ended, when it wants you, when it is hot or
// angry; every fourth while it works or things go very well; now and then while it rests; never in its sleep.
const moves = ({ act, luck, hot, party }, t) => act !== 'asleep' && (
  act === 'done' || act === 'needs' || hot || luck === 'awful' || party ? t % 2 === 1
  : act === 'working' || luck === 'great' ? t % 4 === 3
  : t % 12 === 9);

const HAPPY_FOR = 60_000, ASLEEP_AFTER = 5 * 60_000, ANSWERED_AFTER = 3000, FAILS_COUNT_FOR = 2 * 60_000, NEAR_MARK = 5;
const PARTY_FOR = 60_000;

/**
 * The mood, from what the session is doing and how it is going.
 * `activity` is what the hooks last recorded: { state, at, fails, failAt }, with state start, working, done,
 * failed, needs or rest, and fails the tool calls that failed in this turn. None (a session opened before the
 * hooks existed) gives the resting look. `markLeft` is how many points of the week are left before the
 * session's usage mark ("run up to N%"): worried within five of it, crying once it is reached. With `money`
 * (the pay-per-token view) both it and the run's share are worked out from it, in points of the weekly cap. `run` is what
 * an LCW run adds: its open questions, whether the person paused it, its requirements passing and failing, its
 * parked tasks, its quiet and stalled agents, its share of the week, and how long ago it finished. `hour` is
 * the local hour: from midnight to six it is sleepier.
 */
export function moodOf({ now = Date.now(), activity = null, transcriptAt = 0, contextPercent = null, markLeft = null, run = {}, money = null, hour = 12 } = {}) {
  // On pay-per-token billing the distances are points of the weekly cap: the dollars to the mark and the run's own spend.
  if (money) {
    markLeft = (money.markUsd - money.spentUsd) / money.capUsd * 100;
    run = { ...run, share: (money.runUsd ?? 0) / money.capUsd * 100 };
  }
  let state = activity?.state ?? null;
  const at = activity?.at ?? now, fails = activity?.fails ?? 0;
  const failedWithin = ms => !!activity?.failAt && now - activity.failAt < ms;
  // A question is over once the conversation has moved on past it; no hook says so.
  if (state === 'needs' && transcriptAt > at + ANSWERED_AFTER) state = 'working';
  const ended = (state === 'done' || state === 'failed') && now - at < HAPPY_FOR;
  const act = run.asks > 0 || state === 'needs' ? 'needs'
    : state === 'working' ? 'working'
    : run.paused ? 'asleep'
    : ended ? 'done'
    : state && now - at >= ASLEEP_AFTER ? 'asleep' : 'idle';
  const toMark = typeof markLeft === 'number' ? markLeft : Infinity;
  const luck = run.stalled > 0 || (fails >= 5 && failedWithin(FAILS_COUNT_FOR)) ? 'awful'
    : state === 'failed' || toMark <= 0 || run.failing > 0 || (fails >= 3 && failedWithin(FAILS_COUNT_FOR)) ? 'bad'
    : failedWithin(30_000) || toMark <= NEAR_MARK || run.parked > 0 || run.quiet > 0 || run.share >= TH.runShareRedFrom ? 'uneasy'
    : (run.total > 0 && run.passing === run.total) || run.finishedAgo < ASLEEP_AFTER ? 'great'
    : ended ? 'good' : 'fine';
  // The seconds before it falls asleep, when it yawns: not when a pause put it to sleep.
  const restFor = state ? now - at : 0;
  const yawn = act === 'idle' && restFor >= ASLEEP_AFTER - YAWN.length * 1000 ? Math.floor((restFor - (ASLEEP_AFTER - YAWN.length * 1000)) / 1000) : null;
  return { act, luck, hot: contextPercent >= TH.contextRedFrom, party: run.finishedAgo < PARTY_FOR, yawn, late: hour >= 0 && hour < 6 };
}

/**
 * The two rows as spans for the painter, one cell each. A creature's rows are always the same width, whatever
 * its mood, so the status rows beside it never shift. The clock picks the frame, so nothing is remembered.
 */
export function mascotRows({ now = Date.now(), seed = '', mood = {} } = {}) {
  const m = { act: 'idle', luck: 'fine', hot: false, party: false, yawn: null, late: false, ...mood }, t = Math.floor(now / 1000);
  const yawning = yawnOf(m, t);
  const [top, bottom] = creatures[creatureFor(seed)]([...(yawning ? yawning[0] : eyesOf(m, t))], !yawning && moves(m, t), !!yawning?.[1]);
  const [beside, under] = yawning ? [none, none] : marksOf(m, t);
  return [[...top, beside], [...bottom, under]];
}
