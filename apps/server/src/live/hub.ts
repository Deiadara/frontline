import type { LiveEvent, LiveEventKind } from '@frontline/shared';
import { afterCommit } from '../db/after-commit.js';

/**
 * The live channel's switchboard: who is listening, and how to reach them.
 *
 * One process, one map, no broker. A player with three tabs open is three subscribers under one
 * user id, and all three are told, because "I did it in the other tab" is the most common way a
 * screen goes stale and the cheapest one to fix.
 *
 * ## Deliberately not durable
 *
 * Nothing here is stored and nothing is replayed. An event is a hint that the database moved, and
 * the database is the record; a client that was disconnected when one was published catches up by
 * refetching on reconnect, which it does anyway. That is what keeps this file free of the delivery
 * guarantees a queue would need, and it is only sound because of the rule in `LiveEventSchema`:
 * events carry no state, so a lost one costs latency and never correctness.
 *
 * ## Failure is the subscriber's problem, never the publisher's
 *
 * `publish` is called from inside settle paths that have already changed the world. A listener that
 * throws (a socket closed between the check and the write) must not roll back the fight that was
 * being announced, so every delivery is guarded, exactly as `notify` guards writing a receipt.
 */
export type LiveListener = (event: LiveEvent) => void;

/**
 * The most streams one account may hold open at once (robustness pass, 2026-09-25).
 *
 * Nothing capped it. The rate limit counts streams *opened* per minute, so a client that opened
 * one and never let go, again and again, held a socket, a timer and a listener per stream for as
 * long as it liked, and a buggy tab that reconnects without closing does exactly that. Eight is
 * several tabs on several devices. The ninth closes the oldest rather than being refused, because
 * the newest tab is the one the player is looking at.
 */
export const MAX_STREAMS_PER_ACCOUNT = 8;

/**
 * The shortest gap between two broadcasts of one kind (hardening pass, 2026-09-27).
 *
 * Every tab that hears `world` refetches the map, the board and the standings, so a broadcast is
 * paid for once per open tab. Uncoalesced, one account at the write limit made every player's
 * client refetch twice a second, and an auction evening did the same with nobody misbehaving. The
 * first broadcast goes out at once; any that follow inside the window are folded into one that
 * goes out when it closes, so a burst of fifty is two nudges and nothing is ever dropped.
 */
export const BROADCAST_COALESCE_MS = 2_000;

export class LiveHub {
  /** Per account, each listener with the way to close its stream, oldest first. */
  readonly #listeners = new Map<string, Map<LiveListener, () => void>>();
  readonly #coalesceMs: number;
  readonly #lastBroadcast = new Map<LiveEventKind, number>();
  readonly #pending = new Map<LiveEventKind, ReturnType<typeof setTimeout>>();

  constructor(coalesceMs = BROADCAST_COALESCE_MS) {
    this.#coalesceMs = coalesceMs;
  }

  /**
   * Registers a listener and hands back the way to remove it. Never returns a stale remover.
   *
   * `evict` closes this listener's stream, and is called if the account opens more than
   * {@link MAX_STREAMS_PER_ACCOUNT} and this is the oldest.
   */
  subscribe(
    userId: string,
    listener: LiveListener,
    evict: () => void = () => undefined,
  ): () => void {
    let set = this.#listeners.get(userId);
    if (!set) {
      set = new Map();
      this.#listeners.set(userId, set);
    }
    while (set.size >= MAX_STREAMS_PER_ACCOUNT) {
      const oldest = set.entries().next().value;
      if (oldest === undefined) break;
      set.delete(oldest[0]);
      try {
        oldest[1]();
      } catch {
        // A socket that will not close is still off the list, which is what bounds the memory.
      }
    }
    set.set(listener, evict);
    return () => {
      const current = this.#listeners.get(userId);
      if (!current) return;
      current.delete(listener);
      // Dropped once empty, so an idle server holds no row per account that ever connected.
      if (current.size === 0) this.#listeners.delete(userId);
    };
  }

  /**
   * Tells one player something moved. Silent and free when nobody is connected.
   *
   * Sent once the transaction it was published in commits, and never if it rolls back
   * (`db/after-commit.ts`): a nudge for a write that did not happen chimes for nothing, and the
   * next read that makes the write chimes again.
   */
  publish(userId: string, kind: LiveEventKind, now: Date): void {
    afterCommit(() => this.#deliver(userId, kind, now));
  }

  #deliver(userId: string, kind: LiveEventKind, now: Date): void {
    const set = this.#listeners.get(userId);
    if (!set || set.size === 0) return;
    const event: LiveEvent = { kind, at: now.toISOString() };
    // Copied before iterating: a listener that unsubscribes itself on delivery would otherwise
    // mutate the set mid-loop.
    for (const listener of [...set.keys()]) {
      try {
        listener(event);
      } catch {
        // See the note at the top: a dead socket cannot undo the thing it was being told about.
      }
    }
  }

  /** The same to several people at once, deduplicated. For a fight, which has two sides. */
  publishAll(userIds: Iterable<string>, kind: LiveEventKind, now: Date): void {
    for (const userId of new Set(userIds)) this.publish(userId, kind, now);
  }

  /**
   * Tell every open tab, whoever owns it.
   *
   * For the kinds that name the shared world (`world`, `market`, `bar`): a location changing hands
   * is a fact about the map, and every player looking at the map is looking at the same one. Sent
   * to accounts, not sockets, so a player with three tabs open is told on all three and a player
   * with none costs nothing. What is sent is a nudge with no payload, so nothing private crosses
   * over: each tab refetches through its own reads, which hide what that crew may not see.
   */
  broadcast(kind: LiveEventKind, now: Date): void {
    // After the commit, like `publish`, and before the coalescing clock sees it: a broadcast that
    // is rolled back must not hold the window shut for one that is not.
    afterCommit(() => this.#broadcastSoon(kind, now));
  }

  #broadcastSoon(kind: LiveEventKind, now: Date): void {
    const at = now.getTime();
    const last = this.#lastBroadcast.get(kind);
    // A clock that went backwards (a test, or a corrected system clock) is a window that has shut.
    if (last === undefined || at - last >= this.#coalesceMs || at < last) {
      this.#broadcastNow(kind, now);
      return;
    }
    if (this.#pending.has(kind)) return;
    const timer = setTimeout(
      () => {
        this.#pending.delete(kind);
        this.#broadcastNow(kind, new Date());
      },
      last + this.#coalesceMs - at,
    );
    timer.unref?.();
    this.#pending.set(kind, timer);
  }

  #broadcastNow(kind: LiveEventKind, now: Date): void {
    this.#lastBroadcast.set(kind, now.getTime());
    for (const userId of [...this.#listeners.keys()]) this.#deliver(userId, kind, now);
  }

  /** How many sockets are open. Read by the tick to skip work nobody is waiting on, and by tests. */
  connectionCount(): number {
    let total = 0;
    for (const set of this.#listeners.values()) total += set.size;
    return total;
  }

  /** Whether this player is on right now. */
  isConnected(userId: string): boolean {
    return (this.#listeners.get(userId)?.size ?? 0) > 0;
  }
}

/**
 * The process-wide hub.
 *
 * A singleton rather than something threaded through every call site, because the publishers are
 * `notify` and the settle functions, and those sit at the bottom of call stacks that start in a
 * dozen routes. Threading a hub down all of them would touch every signature between here and
 * there to deliver a hint that is, by design, allowed to be lost.
 *
 * The cost is that two apps built in one test process share it. That is harmless: the hub only does
 * anything when somebody has subscribed, and a test that subscribes builds one app. `LiveHub` is
 * exported so a test can hold its own instance where it wants isolation.
 */
export const liveHub = new LiveHub();
