import { describe, expect, it, vi } from 'vitest';
import { LiveHub, MAX_STREAMS_PER_ACCOUNT } from './hub.js';
import type { LiveEvent } from '@frontline/shared';

const NOON = new Date('2026-08-31T12:00:00.000Z');

describe('the live switchboard', () => {
  it('reaches the player it is addressed to and nobody else', () => {
    const hub = new LiveHub();
    const mine: LiveEvent[] = [];
    const theirs: LiveEvent[] = [];
    hub.subscribe('me', (event) => mine.push(event));
    hub.subscribe('them', (event) => theirs.push(event));

    hub.publish('me', 'battle', NOON);

    expect(mine).toEqual([{ kind: 'battle', at: NOON.toISOString() }]);
    expect(theirs).toEqual([]);
  });

  /** Two tabs is the common case, not the exotic one: it is how a player ends up with a stale one. */
  it('tells every tab the same player has open', () => {
    const hub = new LiveHub();
    const first = vi.fn();
    const second = vi.fn();
    hub.subscribe('me', first);
    hub.subscribe('me', second);

    hub.publish('me', 'notification', NOON);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(hub.connectionCount()).toBe(2);
  });

  it('stops sending once a tab has gone, and forgets the account entirely', () => {
    const hub = new LiveHub();
    const listener = vi.fn();
    const leave = hub.subscribe('me', listener);

    leave();
    hub.publish('me', 'notification', NOON);

    expect(listener).not.toHaveBeenCalled();
    expect(hub.connectionCount()).toBe(0);
    expect(hub.isConnected('me')).toBe(false);
  });

  /** Calling the remover twice happens: a socket that errors and then closes runs both handlers. */
  it('survives being told twice that the same tab has gone', () => {
    const hub = new LiveHub();
    const leave = hub.subscribe('me', vi.fn());
    leave();
    expect(() => leave()).not.toThrow();
    expect(hub.connectionCount()).toBe(0);
  });

  /**
   * The promise `notify` makes, kept one layer down.
   *
   * `publish` is called from inside a settle that has already moved an army. A listener that throws
   * is a socket that died between the check and the write, and it must not take the fight with it,
   * nor the delivery to the *other* side of that fight.
   */
  it('delivers to everyone else when one listener throws', () => {
    const hub = new LiveHub();
    const good = vi.fn();
    hub.subscribe('me', () => {
      throw new Error('socket closed');
    });
    hub.subscribe('me', good);

    expect(() => hub.publish('me', 'battle', NOON)).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });

  /** The shared world: a location changing hands is everybody's map, whoever moved on it. */
  it('broadcasts a world nudge to every account with a tab open, once per tab', () => {
    const hub = new LiveHub();
    const mine: LiveEvent[] = [];
    const theirs: LiveEvent[] = [];
    const theirSecond: LiveEvent[] = [];
    hub.subscribe('me', (event) => mine.push(event));
    hub.subscribe('them', (event) => theirs.push(event));
    hub.subscribe('them', (event) => theirSecond.push(event));

    hub.broadcast('world', NOON);

    const nudge = { kind: 'world', at: NOON.toISOString() };
    expect(mine).toEqual([nudge]);
    expect(theirs).toEqual([nudge]);
    expect(theirSecond).toEqual([nudge]);
  });

  it('costs nothing when nobody is listening', () => {
    const hub = new LiveHub();
    expect(() => hub.publish('nobody', 'battle', NOON)).not.toThrow();
    expect(hub.connectionCount()).toBe(0);
  });

  /** A fight has two sides and an ally can be on both lists. Telling them twice would double-fetch. */
  it('tells a player once when they appear twice in the same batch', () => {
    const hub = new LiveHub();
    const listener = vi.fn();
    hub.subscribe('me', listener);

    hub.publishAll(['me', 'me', 'them'], 'battle', NOON);

    expect(listener).toHaveBeenCalledOnce();
  });

  /** A listener that removes itself on delivery must not corrupt the iteration it is inside. */
  it('lets a listener unsubscribe itself while it is being called', () => {
    const hub = new LiveHub();
    const second = vi.fn();
    const leave = hub.subscribe('me', () => leave());
    hub.subscribe('me', second);

    expect(() => hub.publish('me', 'notification', NOON)).not.toThrow();
    expect(second).toHaveBeenCalledOnce();
    expect(hub.connectionCount()).toBe(1);
  });
});

/**
 * A client that opens streams and never lets them go cannot hold unlimited sockets (robustness
 * pass, 2026-09-25). One past the cap closes the oldest, not the newest.
 */
describe('streams per account', () => {
  it('closes the oldest stream once an account opens one more than the cap', () => {
    const hub = new LiveHub();
    const evicted: number[] = [];
    const heard: number[] = [];
    for (let i = 0; i <= MAX_STREAMS_PER_ACCOUNT; i += 1) {
      hub.subscribe(
        'u1',
        () => heard.push(i),
        () => evicted.push(i),
      );
    }
    expect(evicted).toEqual([0]);
    expect(hub.connectionCount()).toBe(MAX_STREAMS_PER_ACCOUNT);
    hub.publish('u1', 'base', new Date());
    expect(heard).not.toContain(0);
    expect(heard).toHaveLength(MAX_STREAMS_PER_ACCOUNT);
  });

  it('counts each account on its own, and survives an eviction that throws', () => {
    const hub = new LiveHub();
    hub.subscribe(
      'u1',
      () => undefined,
      () => {
        throw new Error('socket already gone');
      },
    );
    for (let i = 0; i < MAX_STREAMS_PER_ACCOUNT; i += 1) hub.subscribe('u1', () => undefined);
    hub.subscribe('u2', () => undefined);
    expect(hub.connectionCount()).toBe(MAX_STREAMS_PER_ACCOUNT + 1);
  });
});

describe('a burst of broadcasts', () => {
  it('sends the first at once and folds the rest of the window into one', () => {
    vi.useFakeTimers();
    try {
      const hub = new LiveHub(2_000);
      const heard: LiveEvent[] = [];
      hub.subscribe('me', (event) => heard.push(event));
      const start = Date.now();
      for (let n = 0; n < 50; n += 1) hub.broadcast('world', new Date(start + n * 10));
      expect(heard).toHaveLength(1);
      vi.advanceTimersByTime(2_000);
      expect(heard).toHaveLength(2);
      // And the window after that is a fresh one: the next broadcast is not held back further.
      vi.advanceTimersByTime(5_000);
      hub.broadcast('world', new Date());
      expect(heard).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces each kind on its own', () => {
    const hub = new LiveHub(2_000);
    const heard: string[] = [];
    hub.subscribe('me', (event) => heard.push(event.kind));
    hub.broadcast('world', NOON);
    hub.broadcast('market', NOON);
    hub.broadcast('bar', NOON);
    expect(heard).toEqual(['world', 'market', 'bar']);
  });
});
