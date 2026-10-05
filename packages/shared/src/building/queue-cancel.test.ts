import { describe, expect, it } from 'vitest';
import { buildCancelWindowMs, queueCancelWindowMs, type BuildQueueEntry } from './queue.js';
import type { Building } from './state.js';

/**
 * Bug pass, 2026-10-02: the screens drew a cancel mark off the order's first tenth alone, and the
 * server also refuses a cancel that would leave an order behind it standing on nothing. Gauntlet 3
 * with Gauntlet 4 queued behind it counted down an X the press could only be refused on.
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

describe('the cancel mark on a build order', () => {
  it('is shut on an order another one behind it is built on', () => {
    const running = order('g3', 'gauntlet', 3, 1);
    const behind = order('g4', 'gauntlet', 4, -59);
    const district = { buildQueue: [running, behind], buildings, level: 50 };

    expect(queueCancelWindowMs(running, NOW), 'fixture: inside the first tenth').toBeGreaterThan(0);
    expect(buildCancelWindowMs(running, district, NOW)).toBe(0);
    expect(buildCancelWindowMs(behind, district, NOW)).toBe(queueCancelWindowMs(behind, NOW));
  });

  it('stays open when what is behind it does not lean on it', () => {
    const running = order('g3', 'gauntlet', 3, 1);
    const other = order('q3', 'quarters', 3, -59);
    const district = { buildQueue: [running, other], buildings, level: 50 };

    expect(buildCancelWindowMs(running, district, NOW)).toBe(queueCancelWindowMs(running, NOW));
  });
});
