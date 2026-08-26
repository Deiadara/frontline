import { describe, expect, it } from 'vitest';
import {
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

  it('refuses what the crew has not built, and what is already on the unit', () => {
    const loadouts = { razors: ['armour_1', null, null] };
    expect(slotRefusal(loadouts, 'razors', 1, 'armour_3', BUILT)).toBe('not_built');
    expect(slotRefusal(loadouts, 'razors', 1, 'nonsense', BUILT)).toBe('unknown_upgrade');
    expect(slotRefusal(loadouts, 'razors', 1, 'armour_1', BUILT)).toBe('already_slotted');
    expect(slotRefusal(loadouts, 'razors', 0, 'armour_1', BUILT)).toBeNull();
    expect(slotRefusal(loadouts, 'razors', UNIT_UPGRADE_SLOTS, 'weapons_1', BUILT)).toBe(
      'bad_slot',
    );
    expect(slotRefusal(loadouts, 'razors', -1, 'weapons_1', BUILT)).toBe('bad_slot');
    expect(slotRefusal(loadouts, 'razors', 1, null, BUILT)).toBe('already_empty');
    expect(slotRefusal(loadouts, 'razors', 0, null, BUILT)).toBeNull();
  });

  it('lets the same built upgrade go on two different units', () => {
    const loadouts = withSlot(withSlot({}, 'razors', 0, 'armour_1'), 'sparks', 0, 'armour_1');
    expect(fittedFor(loadouts, 'razors')).toEqual(['armour_1']);
    expect(fittedFor(loadouts, 'sparks')).toEqual(['armour_1']);
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
