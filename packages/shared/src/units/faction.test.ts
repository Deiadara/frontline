import { describe, expect, it } from 'vitest';
import { BLUEPRINTS } from '../blueprints/index.js';
import { CITY_DISTRICTS } from '../city/districts.js';
import { COMBINE_LEADERS, combineGarrison } from '../city/combine.js';
import { startingGarrison, startingHolder } from '../city/control.js';
import { FEATS } from '../feats/catalog.js';
import { MISSION_TEMPLATES } from '../missions.js';
import { COMBINE_UNITS, PLAYER_UNITS, UNIT_CATALOG, UNIT_TIERS, unitsInTier } from './catalog.js';
import { modificationsForUnit } from './modifications.js';
import { unlockedUnits } from './unlocks.js';

/**
 * The one-way wall: a Combine sheet is met, never held (maintainer, 2026-09-19).
 *
 * `units/units.test.ts` holds the shape of the regime's roster. This file holds the thing that
 * actually matters about it, which is a **negative across the whole game**: there is no content
 * path anywhere that puts one of these units on a player's books.
 *
 * It is written as a sweep over every catalogue rather than as a list of the paths anybody thought
 * of, because the failure this guards against is not a path being written wrongly: it is a path
 * being written *later* by somebody who has never heard of `UnitSpec.faction`. `FeatReward.units`
 * is an `Army`, which is a free-form map of unit id to count, and nothing in its type stops a feat
 * from paying out a Suppressor. There are 496 feats. Nobody is going to read them all again.
 *
 * What a breach would look like in the game: a player holding a unit with no price, no training
 * clock and no gate, that no screen can explain, that the Scrapyard cannot refit and that the
 * balance sheet does not price. It would not crash. It would just be wrong, quietly, for good.
 */

const COMBINE_IDS = new Set(COMBINE_UNITS.map((unit) => unit.id));

/** Every unit id named anywhere inside a value, however deeply nested. */
function unitIdsIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (COMBINE_IDS.has(value)) into.add(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) unitIdsIn(item, into);
    return into;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      // A key can name a unit too: `Army` is `Record<unitId, count>`.
      if (COMBINE_IDS.has(key)) into.add(key);
      unitIdsIn(nested, into);
    }
  }
  return into;
}

describe('the wall around the Combine roster', () => {
  it('has something to guard, so none of this is vacuous', () => {
    expect(COMBINE_IDS.size).toBe(7);
    expect(FEATS.length).toBeGreaterThan(400);
    expect(PLAYER_UNITS.length).toBeGreaterThan(20);
    expect(PLAYER_UNITS.length + COMBINE_UNITS.length).toBe(UNIT_CATALOG.length);
    // The sweep below can actually see a Combine id when one is there.
    expect([...unitIdsIn({ reward: { units: { suppressor: 1 } } })]).toEqual(['suppressor']);
  });

  it('is named by no feat reward, anywhere in the four hundred', () => {
    const offenders = FEATS.filter((feat) => unitIdsIn(feat.reward).size > 0).map(
      (feat) => `${feat.id} pays out ${[...unitIdsIn(feat.reward)].join(', ')}`,
    );
    expect(offenders).toEqual([]);
  });

  it('is named by no mission, in its rewards or anywhere else on the card', () => {
    expect(MISSION_TEMPLATES.length).toBeGreaterThan(20);
    const offenders = MISSION_TEMPLATES.filter((mission) => unitIdsIn(mission).size > 0).map(
      (mission) => `${mission.id} names ${[...unitIdsIn(mission)].join(', ')}`,
    );
    expect(offenders).toEqual([]);
  });

  it('has no blueprint, because a blueprint is a thing you build towards', () => {
    const offenders = BLUEPRINTS.filter((doc) => unitIdsIn(doc).size > 0).map((doc) => doc.id);
    expect(offenders).toEqual([]);
  });

  it('is never unlocked, never in a tier a screen draws, and never in the player roster', () => {
    expect(
      unlockedUnits({
        buildings: [],
        heldPlaceKinds: new Set(),
        buildableVehicles: new Set(),
        inventory: {},
      }).some((unit) => COMBINE_IDS.has(unit.id)),
    ).toBe(false);
    for (const tier of UNIT_TIERS) {
      expect(
        unitsInTier(tier).some((unit) => COMBINE_IDS.has(unit.id)),
        tier,
      ).toBe(false);
    }
    expect(PLAYER_UNITS.some((unit) => COMBINE_IDS.has(unit.id))).toBe(false);
  });

  it('never reaches the Scrapyard: no card fits one', () => {
    for (const id of COMBINE_IDS) {
      expect(modificationsForUnit(id), id).toEqual([]);
    }
  });

  /**
   * The other direction, and the half that is easy to forget: the regime's own ground must field
   * the regime's own units and nobody else's. A Combine garrison of Razors would be the same
   * wall breached from the other side, and it would read on the district screen as the Combine
   * hiring looters.
   */
  it('fields only its own units on its own ground, and the looters only field the roster', () => {
    for (const district of CITY_DISTRICTS.filter((one) => one.locations.length > 0)) {
      for (const location of district.locations) {
        const garrison = startingGarrison(location, district);
        const holder = startingHolder(location, district).kind;
        for (const id of Object.keys(garrison)) {
          if (holder === 'government') {
            expect(COMBINE_IDS.has(id), `${location.id} fields ${id}`).toBe(true);
          } else {
            expect(COMBINE_IDS.has(id), `${location.id} fields ${id}`).toBe(false);
          }
        }
      }
    }
  });

  it('keeps its three leaders off every garrison but their own plot', () => {
    for (const difficulty of [1, 3, 5, 7, 9, 10]) {
      for (const slots of [2, 10, 50, 120]) {
        const faces = Object.keys(combineGarrison(difficulty, slots));
        for (const leader of COMBINE_LEADERS) {
          expect(faces, `${difficulty} at ${slots}`).not.toContain(leader.unitId);
        }
      }
    }
    // ...and each leader stands on exactly one plot in the whole city.
    for (const leader of COMBINE_LEADERS) {
      const plots = CITY_DISTRICTS.flatMap((district) =>
        district.locations.filter(
          (location) => (startingGarrison(location, district)[leader.unitId] ?? 0) > 0,
        ),
      );
      expect(
        plots.map((one) => one.id),
        leader.unitId,
      ).toEqual([leader.locationId]);
    }
  });
});
