import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

/**
 * What `/health` reports, and what a supervisor or an uptime check reads (hardening pass,
 * 2026-09-27).
 *
 * A process that answers is not a process that works. The two things that can fail while the port
 * still answers are the world clock (every fight, mission and auction lands on it) and the event
 * loop (a single-threaded server with a stalled loop answers nothing on time), so both are
 * measured here and `/health` turns either going wrong into a 503 a monitor can alert on.
 */

/** A clock that has not finished a tick for this long is stalled. The tick is every second. */
export const CLOCK_STALE_MS = 15_000;

let lastTickAt: number | null = null;
let loop: IntervalHistogram | null = null;

/** Stamped by the world clock after every tick, successful or not: a tick that ran is alive. */
export function recordTick(at = Date.now()): void {
  lastTickAt = at;
}

/** Starts sampling the event loop. Idempotent; `index.ts` calls it once at boot. */
export function watchEventLoop(): void {
  if (loop) return;
  loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
}

export interface Vitals {
  /** Milliseconds since the clock last ticked, or null when no clock runs (tests, tools). */
  clockAgeMs: number | null;
  /** The 99th percentile event-loop delay since the last reset, in milliseconds, or null. */
  loopP99Ms: number | null;
}

export function vitals(now = Date.now()): Vitals {
  return {
    clockAgeMs: lastTickAt === null ? null : now - lastTickAt,
    loopP99Ms: loop ? Math.round(loop.percentile(99) / 1e6) : null,
  };
}

/** Starts the next measuring window. Called once a minute by the loop watcher in `index.ts`. */
export function resetLoopWindow(): void {
  loop?.reset();
}

export function clockIsStale(now = Date.now()): boolean {
  return lastTickAt !== null && now - lastTickAt > CLOCK_STALE_MS;
}
