import { describe, expect, it } from 'vitest';
import {
  burnRefusal,
  burnUpgrade,
  fittedOn,
  UNIT_UPGRADE_SLOTS,
  fittedFor,
  firstFreeIndex,
  firstFreeSlot,
  slotRefusal,
  slotsFor,
  withSlot,
} from './loadout.js';
import { UNIT_MODIFICATIONS, findUnitModification } from './modifications.js';
import { upgradedStats } from './upgrades.js';
import { UNIT_CATALOG, findUnit } from './catalog.js';

/** Four universal cards the crew has built: three open ones and a gated one. */
const BUILT = ['taped_grips', 'scrap_vest', 'broken_in_boots', 'filed_sights'];

describe('unit modification slots', () => {
  it('reads three brackets whatever is stored', () => {
    expect(slotsFor({}, 'razors')).toEqual([null, null, null]);
    expect(slotsFor({ razors: ['scrap_vest'] }, 'razors')).toEqual(['scrap_vest', null, null]);
  });

  it('only pays for what is in a bracket', () => {
    const loadouts = { razors: ['scrap_vest', null, 'taped_grips'] };
    expect(fittedFor(loadouts, 'razors')).toEqual(['scrap_vest', 'taped_grips']);
    expect(fittedFor(loadouts, 'sparks')).toEqual([]);
  });

  it('drops an id the catalogue no longer knows rather than paying it', () => {
    expect(fittedFor({ razors: ['scrap_vest', 'armour_1'] }, 'razors')).toEqual(['scrap_vest']);
  });

  it('refuses what the crew has not built, and a bracket that is taken', () => {
    const loadouts = { razors: ['scrap_vest', null, null] };
    expect(slotRefusal(loadouts, 'razors', 1, 'ablative_layers', BUILT)).toBe('not_built');
    expect(slotRefusal(loadouts, 'razors', 1, 'nonsense', BUILT)).toBe('unknown_upgrade');
    expect(slotRefusal(loadouts, 'razors', 1, 'taped_grips', BUILT)).toBeNull();
    // Slot 0 already holds something, and the only way it comes out is a burn.
    expect(slotRefusal(loadouts, 'razors', 0, 'taped_grips', BUILT)).toBe('slot_taken');
    expect(slotRefusal(loadouts, 'razors', UNIT_UPGRADE_SLOTS, 'taped_grips', BUILT)).toBe(
      'bad_slot',
    );
    expect(slotRefusal(loadouts, 'razors', -1, 'taped_grips', BUILT)).toBe('bad_slot');
  });

  /**
   * Brackets fill from the left (maintainer request, 2026-09-15).
   *
   * Whichever bracket a player presses, the card goes into the first empty one, and the rule
   * lives here rather than in the button so that every door onto a loadout obeys it. The
   * interesting refusal is the *empty* bracket that is not the first empty one: `slot_taken` still
   * wins on a full bracket, because "it is full" is the reason a player can act on.
   */
  it('names the first empty bracket, and refuses an empty one further right', () => {
    expect(firstFreeIndex([null, null, null])).toBe(0);
    expect(firstFreeIndex(['scrap_vest', null, null])).toBe(1);
    expect(firstFreeIndex(['scrap_vest', 'taped_grips', null])).toBe(2);
    expect(firstFreeIndex(['scrap_vest', 'taped_grips', 'broken_in_boots'])).toBeNull();

    const loadouts = { razors: ['scrap_vest', null, null] };
    expect(firstFreeSlot(loadouts, 'razors')).toBe(1);
    expect(firstFreeSlot(loadouts, 'ironsides'), 'nothing stored is three empties').toBe(0);

    // Bracket 1 is the first empty: allowed. Bracket 2 is empty too, and refused for skipping 1.
    expect(slotRefusal(loadouts, 'razors', 1, 'taped_grips', BUILT)).toBeNull();
    expect(slotRefusal(loadouts, 'razors', 2, 'taped_grips', BUILT)).toBe('skipped_slot');
    // A full bracket says it is full, not that it is out of order.
    expect(slotRefusal(loadouts, 'razors', 0, 'taped_grips', BUILT)).toBe('slot_taken');
  });

  /**
   * Who a card will go on is `modificationFitsUnit`, asked here so the route and the screen agree.
   *
   * Three cases, each with its control: a restricted card outside its list, a legendary that takes
   * nothing at all (a universal card, so the `fits` list is not what is refusing it), and a unit
   * the catalogue has never heard of. The refusal comes before `not_built`, because building the
   * card would not change the answer.
   */
  it('refuses a card the unit cannot take, before it asks whether the crew built one', () => {
    const harness = findUnitModification('counterweight_harness');
    if (!harness?.fits) throw new Error('expected a restricted card');
    expect(harness.fits).toContain('haulers');
    expect(harness.fits).not.toContain('razors');
    // Not built, and still refused for the fit rather than for the stock.
    expect(slotRefusal({}, 'razors', 0, 'counterweight_harness', [])).toBe('does_not_fit');
    expect(slotRefusal({}, 'haulers', 0, 'counterweight_harness', [])).toBe('not_built');
    expect(slotRefusal({}, 'haulers', 0, 'counterweight_harness', ['counterweight_harness'])).toBe(
      null,
    );

    const legendary = UNIT_CATALOG.find((unit) => unit.tier === 'legendary');
    if (!legendary) throw new Error('expected a legendary');
    for (const spec of UNIT_MODIFICATIONS) {
      expect(slotRefusal({}, legendary.id, 0, spec.id, [spec.id]), spec.id).toBe('does_not_fit');
    }
    const carrier = UNIT_CATALOG.find((unit) => unit.tier === 'carrier');
    if (!carrier) throw new Error('expected a carrier');
    expect(slotRefusal({}, carrier.id, 0, 'taped_grips', BUILT)).toBeNull();

    expect(slotRefusal({}, 'not_a_unit', 0, 'taped_grips', BUILT)).toBe('does_not_fit');
  });

  /**
   * §D5c: one of a thing is one of a thing (project rule).
   *
   * This test used to assert the opposite, and it was right about the code: `already_slotted` only
   * looked at the unit being fitted, so a single Scrap Vest could be bolted to the Razors, the
   * Breakers, the Wardens and the Ironsides at once. A modification is an object the crew owns, so
   * where it goes is a decision rather than a broadcast.
   */
  it('refuses the same card on a second unit', () => {
    const loadouts = withSlot({}, 'razors', 0, 'scrap_vest');
    expect(slotRefusal(loadouts, 'sparks', 0, 'scrap_vest', BUILT)).toBe('already_slotted');
    expect(fittedOn(loadouts, 'scrap_vest')).toEqual(['razors']);
  });

  /**
   * §D5c: and it never comes off, it burns.
   *
   * Both halves move together. Leaving it in `built` would be the un-fit this replaces wearing a
   * different name: burn it off the Razors, bolt the same one to the Breakers, nothing spent.
   */
  it('burns a card off the roster and out of the crew’s stock', () => {
    const loadouts = withSlot(withSlot({}, 'razors', 0, 'scrap_vest'), 'razors', 1, 'taped_grips');
    const after = burnUpgrade(loadouts, BUILT, 'scrap_vest');

    expect(fittedOn(after.loadouts, 'scrap_vest')).toEqual([]);
    expect(after.built).not.toContain('scrap_vest');
    // Everything else on that unit is untouched, and keeps its bracket.
    expect(after.loadouts.razors).toEqual([null, 'taped_grips', null]);
    expect(after.built).toContain('taped_grips');
  });

  it('refuses a burn of something that is not fitted', () => {
    expect(burnRefusal({}, 'scrap_vest')).toBe('not_fitted');
    expect(burnRefusal({ razors: ['scrap_vest'] }, 'nonsense')).toBe('unknown_upgrade');
    expect(burnRefusal({ razors: ['scrap_vest'] }, 'scrap_vest')).toBeNull();
  });

  it('clears a bracket without shifting the ones after it', () => {
    const loadouts = { razors: ['scrap_vest', 'taped_grips', 'broken_in_boots'] };
    expect(withSlot(loadouts, 'razors', 0, null).razors).toEqual([
      null,
      'taped_grips',
      'broken_in_boots',
    ]);
  });

  it('forgets a unit whose brackets are all empty', () => {
    expect(withSlot({ razors: ['scrap_vest'] }, 'razors', 0, null)).toEqual({});
  });

  /**
   * Three of the thirty, not thirty of the thirty. Pinned as a number rather than as a shape
   * because the cap is the design: raise `UNIT_UPGRADE_SLOTS` and this says so.
   */
  it('cannot stack the whole catalogue onto one unit', () => {
    let loadouts = {};
    for (const [index, spec] of UNIT_MODIFICATIONS.entries()) {
      loadouts = withSlot(loadouts, 'razors', index % UNIT_UPGRADE_SLOTS, spec.id);
    }
    expect(fittedFor(loadouts, 'razors')).toHaveLength(UNIT_UPGRADE_SLOTS);

    const razors = findUnit('razors')!;
    const all = upgradedStats(
      razors.stats,
      UNIT_MODIFICATIONS.map((spec) => spec.id),
    );
    const slotted = upgradedStats(razors.stats, fittedFor(loadouts, 'razors'));
    expect(slotted.vitality).toBeLessThan(all.vitality);
  });
});
