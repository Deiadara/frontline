import { describe, expect, it } from 'vitest';
import {
  queueCancelCascade,
  queueCancellable,
  queueClockMs,
  queueWaiting,
  type BuildQueueEntry,
} from './queue.js';
import type { Building } from './state.js';

/**
 * Calling off a build order (maintainer, 2026-10-08): anything still waiting its turn can go, and
 * the orders built on it go with it. Before this a Gauntlet 3 with Gauntlet 4 queued behind it
 * could not be called off at all, because Gauntlet 4 would have been left standing on nothing.
 */
const NOW = new Date('2026-10-02T12:00:00.000Z');
const HOUR = 3_600;

const buildings: Building[] = [
  { id: 'b-nexus', kind: 'nexus', level: 10, modifications: [] },
  { id: 'b-gauntlet', kind: 'gauntlet', level: 2, modifications: [] },
  { id: 'b-quarters', kind: 'quarters', level: 2, modifications: [] },
];

const order = (id: string, kind: Building['kind'], level: number, minutesAgo: number) =>
  ({
    id,
    kind,
    level,
    startedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    durationSeconds: HOUR,
    paid: {},
    parts: {},
  }) satisfies BuildQueueEntry;

describe('calling off a build order', () => {
  it('takes the orders built on it down with it', () => {
    const running = order('g3', 'gauntlet', 3, 1);
    const behind = order('g4', 'gauntlet', 4, -59);
    const other = order('q3', 'quarters', 3, -119);
    expect(queueCancelCascade([running, behind, other], buildings, 50, 'g3')).toEqual(['g4']);
  });

  it('takes nothing else when what is behind it does not lean on it', () => {
    const running = order('g3', 'gauntlet', 3, 1);
    const other = order('q3', 'quarters', 3, -59);
    expect(queueCancelCascade([running, other], buildings, 50, 'g3')).toEqual([]);
  });

  it('takes a whole chain, not just the next link', () => {
    const queue = [
      order('g3', 'gauntlet', 3, 1),
      order('g4', 'gauntlet', 4, -59),
      order('g5', 'gauntlet', 5, -119),
    ];
    expect(queueCancelCascade(queue, buildings, 50, 'g3')).toEqual(['g4', 'g5']);
    expect(queueCancelCascade(queue, buildings, 50, 'g4')).toEqual(['g5']);
    expect(queueCancelCascade(queue, buildings, 50, 'g5')).toEqual([]);
  });

  it('can call off a waiting order at any time, however long it has waited', () => {
    const waiting = order('g4', 'gauntlet', 4, -600);
    expect(queueWaiting(waiting, NOW)).toBe(true);
    expect(queueCancellable(waiting, NOW)).toBe(true);
    expect(queueCancellable(order('g3', 'gauntlet', 3, 30), NOW), 'past the tenth').toBe(false);
  });
});

describe('the time a build row shows', () => {
  it('counts down only the order being worked; one waiting shows its whole clock', () => {
    const running = order('g3', 'gauntlet', 3, 10);
    const waiting = order('g4', 'gauntlet', 4, -50);
    expect(queueClockMs(running, NOW)).toBe(50 * 60_000);
    expect(queueClockMs(waiting, NOW)).toBe(HOUR * 1000);
    // And it holds still while it waits.
    const later = new Date(NOW.getTime() + 20 * 60_000);
    expect(queueClockMs(waiting, later)).toBe(HOUR * 1000);
  });
});
