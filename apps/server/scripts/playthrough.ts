/**
 * The whole game, played through the real HTTP API by several crews at once.
 *
 *   pnpm --filter @frontline/server playthrough
 *
 * Starts a throwaway server on port 4030 against a fresh SQLite file in the OS temp directory,
 * registers a handful of players across both open cities, and drives every route the server
 * registers: the happy path where the game allows it, and deliberately bad requests on every write
 * route (malformed bodies, somebody else's ids, prices nobody can pay, actions on finished state),
 * each of which must be refused with the right code and leave the database untouched. Every
 * response is parsed with the route's shared Zod schema, and a set of invariants is checked after
 * every scene. It ends with a report and exits non-zero on any failure, including any registered
 * route the run never called.
 *
 * Time is virtual (`playthrough-clock.ts`), so an eight-hour fight or a Bar table closing at
 * midnight takes no longer than any other step. The clock has to be installed before any server
 * module is evaluated, which is why everything else is imported dynamically below.
 *
 * Ctrl+C stops the server and removes the temp directory.
 */
import { installClock } from './playthrough-clock.js';

/**
 * A fixed start, so the day's mission boards, the Bar's roster and the back room's shelf are the
 * same on every run and a failure replays. 09:00 in Athens, the game's house clock.
 */
const START_AT = process.env.PLAYTHROUGH_START ?? '2026-10-05T06:00:00.000Z';

installClock(START_AT);
const { main } = await import('./playthrough-run.js');
process.exitCode = await main();
