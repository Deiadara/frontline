/**
 * The playthrough's clock: `Date` replaced for the whole process by one that only moves when told.
 *
 * The server reads the time through `new Date()` and `Date.now()` everywhere (settles, JWT expiry,
 * the rate limiter's windows, the Bar's midnight close), so swapping the global is the one seam that
 * reaches all of them without touching game code. It has to be installed before the server's
 * modules are evaluated: the rate limiter captures `Date.now` when it is constructed.
 *
 * Frozen rather than offset from the wall clock. A refused request must leave the database exactly
 * as it found it, and with a clock that drifts by a few milliseconds a settle inside the refusal can
 * legitimately bank a unit of production and look like a leak.
 */

const RealDate = Date;

let virtualNow = RealDate.now();

class VirtualDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(virtualNow);
    else super(...(args as [string | number | Date]));
  }

  static override now(): number {
    return virtualNow;
  }
}

let installed = false;

/** Swaps the global `Date` for the frozen one, starting at `startAt`. Idempotent. */
export function installClock(startAt: Date | string): void {
  virtualNow = new RealDate(startAt).getTime();
  if (installed) return;
  globalThis.Date = VirtualDate as DateConstructor;
  installed = true;
}

/** The virtual time, in epoch milliseconds. */
export function nowMs(): number {
  return virtualNow;
}

/** Moves the clock forward. Never backwards: nothing in the game expects time to reverse. */
export function advanceClock(ms: number): void {
  if (ms < 0) throw new Error(`the clock only moves forward (asked for ${ms}ms)`);
  virtualNow += Math.round(ms);
}

/** Sets the clock to an absolute instant, which must not be in the past. */
export function setClock(at: Date | number): void {
  const target = typeof at === 'number' ? at : at.getTime();
  advanceClock(target - virtualNow);
}

/** The wall clock, for timing the run itself. */
export function wallMs(): number {
  return RealDate.now();
}
