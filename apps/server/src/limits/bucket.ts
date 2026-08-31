/**
 * Rate limiting, in this process, with no dependency.
 *
 * A fixed-window counter per caller per class of route. Written here rather than installed because
 * this server is one process holding one SQLite file: a limiter backed by Redis would be an extra
 * moving part to run and a network hop on every request, and it would not buy anything until there
 * is a second server to share state between. When there is, this is the file that gets replaced,
 * and the shape of `LimitDecision` is what it has to keep.
 *
 * ## Fixed window rather than a token bucket
 *
 * A fixed window lets a caller spend a whole window's budget in its last second and the next one's
 * in the following second, so the true worst case over a short span is twice the quota. That is
 * acceptable for what these limits are for: keeping one account or one address from hammering the
 * game, not shaping traffic to a precise rate. The cost of the more accurate options is per-caller
 * state that has to be aged out, and this already has to age its own out.
 */

export interface LimitRule {
  /** How many requests one caller may make in a window. */
  quota: number;
  /** How long the window is. */
  windowMs: number;
}

export interface LimitDecision {
  allowed: boolean;
  /** What is left in the current window, after this call. Sent as `X-RateLimit-Remaining`. */
  remaining: number;
  /** Seconds until the window rolls. Sent as `Retry-After` on a refusal. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  /** When this window ends, in epoch ms. */
  resetAt: number;
}

/**
 * How often expired windows are swept out.
 *
 * Without this the map grows by one entry per address that ever knocked, which is a slow leak that
 * only shows up on a server that has been running for a long time: exactly the one you cannot
 * restart to look at it. Swept on a timer rather than on every call so a burst does not pay for
 * everybody else's bookkeeping.
 */
export const LIMIT_SWEEP_MS = 60_000;

export class RateLimiter {
  readonly #windows = new Map<string, Window>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * Counts one request against `key` and says whether it may proceed.
   *
   * The count is incremented even when the answer is no, which is deliberate: a caller that keeps
   * knocking through a refusal stays refused for the rest of the window rather than being let back
   * in the moment they drop under the line.
   */
  take(key: string, rule: LimitRule): LimitDecision {
    const now = this.#now();
    const existing = this.#windows.get(key);
    const window =
      existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + rule.windowMs };
    window.count += 1;
    this.#windows.set(key, window);

    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    return {
      allowed: window.count <= rule.quota,
      remaining: Math.max(0, rule.quota - window.count),
      retryAfterSeconds,
    };
  }

  /** Drops windows that have already rolled. Called on a timer; safe to call at any time. */
  sweep(): void {
    const now = this.#now();
    for (const [key, window] of this.#windows) {
      if (window.resetAt <= now) this.#windows.delete(key);
    }
  }

  /** How many callers are being tracked. For the sweep's own test, and for a health readout. */
  size(): number {
    return this.#windows.size;
  }

  /** Forgets everything. Used between tests, never in anger. */
  reset(): void {
    this.#windows.clear();
  }
}
