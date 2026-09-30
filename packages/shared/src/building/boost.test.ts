import { describe, expect, it } from 'vitest';
import { xpForClock } from '../progression/state.js';
import { BUILD_BOOST_PERCENT, boostedQueue } from './boost.js';
import { queueEntryXp, type BuildQueueEntry } from './queue.js';

/**
 * The burn moves the clock and never the XP (maintainer, 2026-09-29). `durationSeconds` is what
 * the burn rewrites, so an order has to carry its XP past the rewrite.
 */
describe('the Generator’s burn and what a build pays', () => {
  const now = new Date('2026-01-01T01:00:00.000Z');
  const order = (id: string, durationSeconds: number, xp?: number): BuildQueueEntry => ({
    id,
    kind: 'lab',
    level: 3,
    startedAt: now.toISOString(),
    durationSeconds,
    ...(xp === undefined ? {} : { xp }),
    paid: {},
    parts: {},
  });

  it('keeps the XP an order was frozen with', () => {
    const [boosted] = boostedQueue([order('a', 8000, 77)], now, BUILD_BOOST_PERCENT);
    expect(boosted!.durationSeconds).toBe(6000);
    expect(queueEntryXp(boosted!)).toBe(77);
  });

  it('pins an order from before the XP was frozen at what its unburned clock pays', () => {
    const [boosted] = boostedQueue([order('a', 8000)], now, BUILD_BOOST_PERCENT);
    expect(boosted!.durationSeconds).toBe(6000);
    expect(queueEntryXp(boosted!)).toBe(xpForClock('buildingConstructed', 8000));
    expect(queueEntryXp(boosted!)).toBeGreaterThan(xpForClock('buildingConstructed', 6000));
  });
});
