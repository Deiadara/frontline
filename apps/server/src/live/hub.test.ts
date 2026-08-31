import { describe, expect, it, vi } from 'vitest';
import { LiveHub } from './hub.js';
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
