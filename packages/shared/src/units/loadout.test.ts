import { describe, expect, it } from 'vitest';
import {
  burnRefusal,
  burnUpgrade,
  fittedOn,
  UNIT_UPGRADE_SLOTS,
  defaultLoadout,
  fittedFor,
  slotRefusal,
  slotsFor,
  withSlot,
} from './loadout.js';
import { UNIT_UPGRADES, upgradedStats } from './upgrades.js';
import { findUnit } from './catalog.js';

const BUILT = ['armour_1', 'weapons_1', 'weapons_2', 'cybernetics_1'];

describe('unit upgrade slots', () => {
  it('reads three brackets whatever is stored', () => {
    expect(slotsFor({}, 'razors')).toEqual([null, null, null]);
    expect(slotsFor({ razors: ['armour_1'] }, 'razors')).toEqual(['armour_1', null, null]);
  });

  it('only pays for what is in a bracket', () => {
    const loadouts = { razors: ['armour_1', null, 'weapons_1'] };
    expect(fittedFor(loadouts, 'razors')).toEqual(['armour_1', 'weapons_1']);
    expect(fittedFor(loadouts, 'sparks')).toEqual([]);
  });

  it('drops an id the catalogue no longer knows rather than paying it', () => {
    expect(fittedFor({ razors: ['armour_1', 'ghost_9'] }, 'razors')).toEqual(['armour_1']);
  });

  it('refuses what the crew has not built, and a bracket that is taken', () => {
    const loadouts = { razors: ['armour_1', null, null] };
    expect(slotRefusal(loadouts, 'razors', 1, 'armour_3', BUILT)).toBe('not_built');
    expect(slotRefusal(loadouts, 'razors', 1, 'nonsense', BUILT)).toBe('unknown_upgrade');
    expect(slotRefusal(loadouts, 'razors', 1, 'weapons_1', BUILT)).toBeNull();
    // Slot 0 already holds something, and the only way it comes out is a burn.
    expect(slotRefusal(loadouts, 'razors', 0, 'weapons_1', BUILT)).toBe('slot_taken');
    expect(slotRefusal(loadouts, 'razors', UNIT_UPGRADE_SLOTS, 'weapons_1', BUILT)).toBe(
      'bad_slot',
    );
    expect(slotRefusal(loadouts, 'razors', -1, 'weapons_1', BUILT)).toBe('bad_slot');
  });

  /**
   * §D5c: one of a thing is one of a thing (board rule).
   *
   * This test used to assert the opposite, and it was right about the code: `already_slotted` only
   * looked at the unit being fitted, so a single Scrap Plate could be bolted to the Razors, the
   * Breakers, the Wardens and the Ironsides at once. A modification is an object the crew owns, so
   * where it goes is a decision rather than a broadcast.
   */
  it('refuses the same upgrade on a second unit', () => {
    const loadouts = withSlot({}, 'razors', 0, 'armour_1');
    expect(slotRefusal(loadouts, 'sparks', 0, 'armour_1', BUILT)).toBe('already_slotted');
    expect(fittedOn(loadouts, 'armour_1')).toEqual(['razors']);
  });

  /**
   * §D5c: and it never comes off, it burns.
   *
   * Both halves move together. Leaving it in `built` would be the un-fit this replaces wearing a
   * different name: burn it off the Razors, bolt the same one to the Breakers, nothing spent.
   */
  it('burns an upgrade off the roster and out of the crew\u2019s stock', () => {
    const loadouts = withSlot(withSlot({}, 'razors', 0, 'armour_1'), 'razors', 1, 'weapons_1');
    const after = burnUpgrade(loadouts, BUILT, 'armour_1');

    expect(fittedOn(after.loadouts, 'armour_1')).toEqual([]);
    expect(after.built).not.toContain('armour_1');
    // Everything else on that unit is untouched, and keeps its bracket.
    expect(after.loadouts.razors).toEqual([null, 'weapons_1', null]);
    expect(after.built).toContain('weapons_1');
  });

  it('refuses a burn of something that is not fitted', () => {
    expect(burnRefusal({}, 'armour_1')).toBe('not_fitted');
    expect(burnRefusal({ razors: ['armour_1'] }, 'nonsense')).toBe('unknown_upgrade');
    expect(burnRefusal({ razors: ['armour_1'] }, 'armour_1')).toBeNull();
  });

  it('clears a bracket without shifting the ones after it', () => {
    const loadouts = { razors: ['armour_1', 'weapons_1', 'cybernetics_1'] };
    expect(withSlot(loadouts, 'razors', 0, null).razors).toEqual([
      null,
      'weapons_1',
      'cybernetics_1',
    ]);
  });

  it('forgets a unit whose brackets are all empty', () => {
    expect(withSlot({ razors: ['armour_1'] }, 'razors', 0, null)).toEqual({});
  });

  it('fills a pre-slot save with its three strongest, so nobody loses stats on the day', () => {
    expect(defaultLoadout(BUILT)).toHaveLength(UNIT_UPGRADE_SLOTS);
    expect(defaultLoadout(BUILT)).toContain('weapons_2');
    expect(defaultLoadout(['armour_1'])).toEqual(['armour_1']);
    expect(defaultLoadout([])).toEqual([]);
  });

  /**
   * The one assumption a mission makes about a fitted unit, stated where it can be checked.
   *
   * `missionCarry` reads `lootCapacity` off the **catalogue**, not off the upgraded sheet, because
   * a force is a bag of unit ids and has no loadout to fold. That is correct exactly while no
   * upgrade touches the bag: the moment one does, the roster would promise a carry the mission
   * does not honour, silently, and a payout would be left on the floor with no figure on any
   * screen disagreeing.
   */
  it('has no upgrade that changes what a unit can carry, which missions rely on', () => {
    for (const spec of UNIT_UPGRADES) {
      expect(
        spec.effect.lootCapacity,
        `${spec.id} moves lootCapacity: teach missionCarry about loadouts before shipping it`,
      ).toBeUndefined();
    }
  });

  /**
   * Three of the nine, not nine of the nine. Pinned as a number rather than as a shape because the
   * cap is the design: raise `UNIT_UPGRADE_SLOTS` and this says so.
   */
  it('cannot stack the whole workshop onto one unit', () => {
    let loadouts = {};
    for (const [index, spec] of UNIT_UPGRADES.entries()) {
      loadouts = withSlot(loadouts, 'razors', index % UNIT_UPGRADE_SLOTS, spec.id);
    }
    expect(fittedFor(loadouts, 'razors')).toHaveLength(UNIT_UPGRADE_SLOTS);

    const razors = findUnit('razors')!;
    const all = upgradedStats(
      razors.stats,
      UNIT_UPGRADES.map((spec) => spec.id),
    );
    const slotted = upgradedStats(razors.stats, fittedFor(loadouts, 'razors'));
    expect(slotted.vitality).toBeLessThan(all.vitality);
  });
});
