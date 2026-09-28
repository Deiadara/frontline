import { describe, expect, it } from 'vitest';
import { RESOURCE_KEYS, type ResourceKey } from '../resources.js';
import { findUnit } from '../units/index.js';
import { splitFeatReward, type FeatClaimRoom } from './waste.js';

/**
 * The arithmetic behind the warning and the clamp (maintainer ruling, 2026-09-23).
 *
 * One function answers both "what would this cost you" on the feats read and "what actually lands"
 * in the claim transaction, so the cases worth pinning are the ones where a second implementation
 * would have drifted: a bundle clamped line by line rather than refused whole, a unit taken whole
 * or not at all, and the two ceilings that are not ceilings (caps, and a store already over its
 * top).
 */

/** Room in every store, with the named ones overridden. Caps are `Infinity` in the real fold. */
function room(spare: Partial<Record<ResourceKey, number>>, unitSlots = 0): FeatClaimRoom {
  const resources = {} as Record<ResourceKey, number>;
  for (const key of RESOURCE_KEYS) {
    resources[key] = spare[key] ?? Number.POSITIVE_INFINITY;
  }
  return { resources, unitSlots };
}

describe('splitting a feat reward against the room for it', () => {
  it('pays a reward that fits and reports nothing wasted', () => {
    const reward = { resources: { caps: 240, scrap: 40 }, xp: 100 };
    const split = splitFeatReward(reward, room({ scrap: 40 }));
    expect(split.paid).toEqual(reward);
    expect(split.wasted).toBeUndefined();
  });

  it('pays a store up to its ceiling and discards the difference', () => {
    const split = splitFeatReward({ resources: { scrap: 40 } }, room({ scrap: 10 }));
    expect(split.paid).toEqual({ resources: { scrap: 10 } });
    expect(split.wasted).toEqual({ resources: { scrap: 30 } });
  });

  /**
   * A bundle is clamped line by line, not refused because one line of it does not fit.
   *
   * The claim route's old unit gate refused the whole reward when the beds were short, and the
   * bulk walk still skips on the same test. A single confirmed claim does neither: the planks land
   * in full while the scrap is cut.
   */
  it('clamps each store on its own', () => {
    const split = splitFeatReward(
      { resources: { caps: 240, scrap: 40, planks: 40 } },
      room({ scrap: 10, planks: 400 }),
    );
    expect(split.paid).toEqual({ resources: { caps: 240, scrap: 10, planks: 40 } });
    expect(split.wasted).toEqual({ resources: { scrap: 30 } });
  });

  it('never wastes caps, which have no ceiling', () => {
    const split = splitFeatReward({ resources: { caps: 1_000_000 } }, room({}));
    expect(split.paid).toEqual({ resources: { caps: 1_000_000 } });
    expect(split.wasted).toBeUndefined();
  });

  /**
   * A stockpile already above its ceiling has no room under it, and the whole line is lost.
   *
   * That state is ordinary rather than exotic: raid loot lands on top of a full store and
   * `accrueProduction` caps production at `max(what is held, the ceiling)`, so nothing ever clamps
   * it back down. The ruling pays up to the ceiling, and there is nothing to pay up to.
   */
  it('reads a store that is already over its top as no room at all', () => {
    const split = splitFeatReward({ resources: { scrap: 40 }, xp: 5 }, room({ scrap: -900 }));
    expect(split.paid).toEqual({ xp: 5 });
    expect(split.wasted).toEqual({ resources: { scrap: 40 } });
  });

  it('leaves xp, infamy, items and boosts whole whatever the stores are doing', () => {
    const reward = {
      resources: { scrap: 40 },
      items: { scrap_servo: 2 },
      xp: 300,
      infamy: 50,
      boosts: ['combat_stims'] as [string],
    };
    const split = splitFeatReward(reward, room({ scrap: 0 }));
    expect(split.paid).toEqual({
      items: reward.items,
      xp: 300,
      infamy: 50,
      boosts: reward.boosts,
    });
    expect(split.wasted).toEqual({ resources: { scrap: 40 } });
  });

  describe('units', () => {
    // Read off the catalogue rather than written down, so a retune moves the expectations with it.
    const JUGGERNAUT = findUnit('juggernauts')!.unitSlots;
    const RAZOR = findUnit('razors')!.unitSlots;

    it('takes whole units only, and leaves the ones with no bed', () => {
      const split = splitFeatReward(
        { units: { juggernauts: 4 } },
        room({}, JUGGERNAUT * 2 + JUGGERNAUT - 1),
      );
      expect(split.paid).toEqual({ units: { juggernauts: 2 } });
      expect(split.wasted).toEqual({ units: { juggernauts: 2 } });
    });

    it('walks the reward in the order it lists its units', () => {
      // Beds for one Juggernaut and nothing else. The Juggernauts come first in the reward, so
      // they take the room and the Razors behind them are lost.
      const split = splitFeatReward({ units: { juggernauts: 1, razors: 3 } }, room({}, JUGGERNAUT));
      expect(split.paid).toEqual({ units: { juggernauts: 1 } });
      expect(split.wasted).toEqual({ units: { razors: 3 } });
    });

    it('fills the beds that are left after the bigger units have taken theirs', () => {
      const split = splitFeatReward(
        { units: { juggernauts: 2, razors: 5 } },
        room({}, JUGGERNAUT + RAZOR * 2),
      );
      expect(split.paid).toEqual({ units: { juggernauts: 1, razors: 2 } });
      expect(split.wasted).toEqual({ units: { juggernauts: 1, razors: 3 } });
    });

    it('pays no units at all into a district with no beds, and says so', () => {
      const split = splitFeatReward({ units: { razors: 3 }, xp: 10 }, room({}, 0));
      expect(split.paid).toEqual({ xp: 10 });
      expect(split.wasted).toEqual({ units: { razors: 3 } });
    });
  });
});
