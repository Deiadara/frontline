/**
 * When an escaped error is survivable, and when it means the process should go (hardening pass,
 * 2026-09-27).
 *
 * `index.ts` logs an error that escapes a callback and keeps serving, because every write here is
 * a synchronous SQLite transaction that commits whole or rolls back, so there is nothing half done
 * behind it. That argument holds for one stray bug. It does not hold for a process that is out of
 * file descriptors or memory, or for one throwing ten times a minute: that process is broken in a
 * way that logging does not fix, and a supervisor restarting it (`deploy/frontline.service`) is the
 * repair. So the budget answers "keep going" for the first case and "exit" for the others.
 */
export const CRASH_BUDGET = 10;
export const CRASH_WINDOW_MS = 60_000;

/** Errors no amount of carrying on will fix. */
const FATAL_CODES = new Set(['EMFILE', 'ENFILE', 'ENOMEM', 'ERR_WORKER_OUT_OF_MEMORY']);

export class CrashBudget {
  readonly #times: number[] = [];

  constructor(
    private readonly budget = CRASH_BUDGET,
    private readonly windowMs = CRASH_WINDOW_MS,
  ) {}

  /** Records one escaped error; true when the process should exit rather than carry on. */
  spend(error: unknown, now = Date.now()): boolean {
    if (isFatal(error)) return true;
    this.#times.push(now);
    while (this.#times.length > 0 && now - this.#times[0]! > this.windowMs) this.#times.shift();
    return this.#times.length > this.budget;
  }
}

export function isFatal(error: unknown): boolean {
  if (error instanceof RangeError && /heap|memory/i.test(error.message)) return true;
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && FATAL_CODES.has(code);
}
