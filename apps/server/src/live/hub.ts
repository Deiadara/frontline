import type { LiveEvent, LiveEventKind } from '@frontline/shared';

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

export class LiveHub {
  readonly #listeners = new Map<string, Set<LiveListener>>();

  /** Registers a listener and hands back the way to remove it. Never returns a stale remover. */
  subscribe(userId: string, listener: LiveListener): () => void {
    let set = this.#listeners.get(userId);
    if (!set) {
      set = new Set();
      this.#listeners.set(userId, set);
    }
    set.add(listener);
    return () => {
      const current = this.#listeners.get(userId);
      if (!current) return;
      current.delete(listener);
      // Dropped once empty, so an idle server holds no row per account that ever connected.
      if (current.size === 0) this.#listeners.delete(userId);
    };
  }

  /** Tells one player something moved. Silent and free when nobody is connected. */
  publish(userId: string, kind: LiveEventKind, now: Date): void {
    const set = this.#listeners.get(userId);
    if (!set || set.size === 0) return;
    const event: LiveEvent = { kind, at: now.toISOString() };
    // Copied before iterating: a listener that unsubscribes itself on delivery would otherwise
    // mutate the set mid-loop.
    for (const listener of [...set]) {
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
