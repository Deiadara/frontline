import { describe, expect, it } from 'vitest';
import { blueprintForUnitUpgrade, blueprintGateMet } from '../blueprints/index.js';
import { ITEM_CATALOG } from '../items/catalog.js';
import {
  UNIT_UPGRADES,
  UPGRADE_LINES,
  UPGRADE_MAX_TIER,
  upgradeRefusal,
  upgradedStats,
  upgradesInLine,
} from './upgrades.js';
import { UNIT_CATALOG, findUnit } from './catalog.js';
import { UNIT_RATING_KEYS, UNIT_STAT_KEYS } from './stats.js';

const YES = () => true;
const NO = () => false;

describe('the workshop catalogue', () => {
  it('gives every line the same three rungs', () => {
    for (const line of UPGRADE_LINES) {
      expect(
        upgradesInLine(line).map((spec) => spec.tier),
        line,
      ).toEqual([1, 2, 3]);
    }
    expect(UNIT_UPGRADES).toHaveLength(UPGRADE_LINES.length * UPGRADE_MAX_TIER);
  });

  /** The board's rule: scrap is what the city is made of, so every physical thing costs it. */
  it('charges scrap for everything', () => {
    for (const spec of UNIT_UPGRADES) {
      expect(spec.cost.scrap, spec.id).toBeGreaterThan(0);
    }
  });

  it('asks for the scarce metal only past the first rung', () => {
    for (const spec of UNIT_UPGRADES) {
      if (spec.tier === 1) expect(spec.cost.highQualityMetal, spec.id).toBeUndefined();
      else expect(spec.cost.highQualityMetal, spec.id).toBeGreaterThan(0);
    }
  });

  it('gets dearer and asks for more of the Gauntlet as it climbs', () => {
    for (const line of UPGRADE_LINES) {
      const rungs = upgradesInLine(line);
      for (let index = 1; index < rungs.length; index++) {
        const below = rungs[index - 1];
        const above = rungs[index];
        if (!below || !above) throw new Error('expected a full ladder');
        expect(above.cost.scrap ?? 0, above.id).toBeGreaterThan(below.cost.scrap ?? 0);
        expect(above.requiresGauntletLevel, above.id).toBeGreaterThan(below.requiresGauntletLevel);
      }
    }
  });

  /**
   * §D12g: tiers two and three are behind a document, tier one is open.
   *
   * Read off `blueprints/catalog.ts` rather than off a table here, which is the whole point of the
   * move: the upgrade catalogue no longer names a blueprint, so there is nothing left to disagree
   * with the Blueprints page about.
   */
  it('puts every rung past the first behind a document, and leaves the first open', () => {
    for (const spec of UNIT_UPGRADES) {
      const document = blueprintForUnitUpgrade(spec.id);
      if (spec.tier === 1) expect(document, spec.id).toBeUndefined();
      else expect(document?.category, spec.id).toBe('upgrade');
    }
    // One document per line, shared by both of its gated rungs, not one per rung.
    for (const line of UPGRADE_LINES) {
      const gated = upgradesInLine(line).filter((spec) => spec.tier > 1);
      const documents = new Set(gated.map((spec) => blueprintForUnitUpgrade(spec.id)?.id));
      expect(documents.size, line).toBe(1);
    }
  });

  it('reads the gate out of the satchel, per rung', () => {
    const [tierOne, tierTwo] = upgradesInLine('armour');
    if (!tierOne || !tierTwo) throw new Error('expected a full armour ladder');
    expect(blueprintGateMet({}, 'unit_upgrade', tierOne.id)).toBe(true);
    expect(blueprintGateMet({}, 'unit_upgrade', tierTwo.id)).toBe(false);
    const document = blueprintForUnitUpgrade(tierTwo.id)!;
    expect(blueprintGateMet({ [document.id]: 1 }, 'unit_upgrade', tierTwo.id)).toBe(true);
  });

  it('names a real part in every recipe', () => {
    for (const spec of UNIT_UPGRADES) {
      for (const id of Object.keys(spec.parts)) {
        expect(ITEM_CATALOG[id as keyof typeof ITEM_CATALOG], `${spec.id}: ${id}`).toBeDefined();
      }
    }
  });

  it('moves only stats that exist', () => {
    for (const spec of UNIT_UPGRADES) {
      for (const key of Object.keys(spec.effect)) {
        expect(UNIT_STAT_KEYS, `${spec.id}: ${key}`).toContain(key);
      }
    }
  });
});

describe('fitting an upgrade', () => {
  const armour = upgradesInLine('armour');
  const [one, two, three] = armour;
  if (!one || !two || !three) throw new Error('expected three rungs');

  /**
   * An empty satchel, asked through the real mapping rather than through a flat `NO`.
   *
   * The tier rule moved out of `upgradeRefusal` and into `blueprints/catalog.ts`, so a blanket
   * "holds nothing" predicate would now refuse tier one as well and this suite would be asserting
   * the gate against itself. Reading the answer off `blueprintGateMet` is what keeps "tier one is
   * open to anybody" a measurement of the shipped catalogue.
   */
  const NO_DOCUMENTS = (id: string) => blueprintGateMet({}, 'unit_upgrade', id);

  it('takes the first rung with nothing but a Gauntlet and the money', () => {
    expect(
      upgradeRefusal(one.id, [], one.requiresGauntletLevel, NO_DOCUMENTS, YES, YES),
    ).toBeNull();
  });

  it('refuses a rung whose predecessor is not fitted', () => {
    expect(upgradeRefusal(two.id, [], 99, YES, YES, YES)).toBe('needs_previous_tier');
  });

  /**
   * The blueprint gate is checked before the money.
   *
   * Both can be true at once, and "you need the blueprint" is the one a player can act on today:
   * the caps will fix themselves.
   */
  it('names the blueprint before it names the price', () => {
    expect(upgradeRefusal(two.id, [one.id], 99, NO_DOCUMENTS, NO, YES)).toBe('needs_blueprint');
  });

  it('opens the second rung the moment the document is in the satchel', () => {
    const document = blueprintForUnitUpgrade(two.id)!;
    const held = (id: string) => blueprintGateMet({ [document.id]: 1 }, 'unit_upgrade', id);
    expect(upgradeRefusal(two.id, [one.id], two.requiresGauntletLevel, held, YES, YES)).toBeNull();
    expect(
      upgradeRefusal(two.id, [one.id], two.requiresGauntletLevel, NO_DOCUMENTS, YES, YES),
    ).toBe('needs_blueprint');
  });

  it('refuses a Gauntlet that is too low even with everything else in hand', () => {
    expect(upgradeRefusal(two.id, [one.id], 1, YES, YES, YES)).toBe('gauntlet_too_low');
  });

  it('refuses on money, then on parts', () => {
    expect(upgradeRefusal(two.id, [one.id], 99, YES, NO, YES)).toBe('cannot_afford');
    expect(upgradeRefusal(two.id, [one.id], 99, YES, YES, NO)).toBe('missing_parts');
  });

  it('refuses to fit the same thing twice', () => {
    expect(upgradeRefusal(one.id, [one.id], 99, YES, YES, YES)).toBe('already_fitted');
  });

  it('does not know what an invented upgrade is', () => {
    expect(upgradeRefusal('not_a_thing', [], 99, YES, YES, YES)).toBe('unknown_upgrade');
  });

  it('takes the top rung with the whole ladder underneath it', () => {
    expect(upgradeRefusal(three.id, [one.id, two.id], 99, YES, YES, YES)).toBeNull();
  });
});

describe('what a refit does to a sheet', () => {
  const razors = UNIT_CATALOG.find((unit) => unit.id === 'razors');
  if (!razors) throw new Error('expected the razors');

  it('changes nothing when nothing is fitted', () => {
    expect(upgradedStats(razors.stats, [])).toEqual(razors.stats);
  });

  it('adds every fitted line together', () => {
    const [armour] = upgradesInLine('armour');
    const [weapons] = upgradesInLine('weapons');
    if (!armour || !weapons) throw new Error('expected two rungs');
    const both = upgradedStats(razors.stats, [armour.id, weapons.id]);
    expect(both.vitality).toBe(razors.stats.vitality + (armour.effect.vitality ?? 0));
    expect(both.penetration).toBe(razors.stats.penetration + (weapons.effect.penetration ?? 0));
  });

  /** Armour is meant to cost speed. A fold that only ever added would quietly drop the tradeoff. */
  it('applies a penalty as a penalty', () => {
    const [armour] = upgradesInLine('armour');
    if (!armour) throw new Error('expected a rung');
    expect(armour.effect.speed ?? 0).toBeLessThan(0);
    expect(upgradedStats(razors.stats, [armour.id]).speed).toBeLessThan(razors.stats.speed);
  });

  /**
   * The ceiling is for ratings, and only for ratings.
   *
   * Both halves are asserted, because the interesting failure is the *second* one: this used to cap
   * everything except `lootCapacity`, and once damage and hit points became counts rather than
   * ratings that cap became a shredder. A Razor on 160 damage came out of the cheapest refit in the
   * game on 100, and every sheet converged on 100 the moment anything was slotted onto it. A test
   * that only checked the ceiling would have called that a pass.
   */
  it('caps the ratings and lets the open figures climb past 100', () => {
    const maxed = { ...razors.stats, vitality: 99, armor: 99, speed: 1, offense: 99 };
    const all = upgradedStats(
      maxed,
      UNIT_UPGRADES.map((spec) => spec.id),
    );
    for (const key of UNIT_RATING_KEYS) {
      expect(all[key], key).toBeGreaterThanOrEqual(0);
      expect(all[key], key).toBeLessThanOrEqual(100);
    }
    // Damage and hit points took the whole workshop and kept it: no ceiling, and the refit is
    // still worth what it says on it.
    expect(all.vitality).toBe(99 + 10 + 17 + 27);
    expect(all.offense).toBe(99 + 20 + 30 + 60);
  });

  it('ignores an upgrade id it does not recognise rather than throwing', () => {
    expect(upgradedStats(razors.stats, ['nonsense'])).toEqual(razors.stats);
  });
});

/**
 * Which bracket a refit was dropped into must not change the sheet.
 *
 * The clamp used to run per upgrade, so a rating that touched the ceiling lost the headroom a later
 * negative delta would have given back, and the result depended on the order of `fittedUpgrades`.
 * That array is positional and the player chooses the slot (`FitSlotRequestSchema`), while this
 * module's own doc says "Order does not matter; the set does".
 */
describe('the order upgrades were fitted in', () => {
  it('makes no difference to the sheet, on the case that used to differ', () => {
    const hound = findUnit('cyber_dogs');
    if (!hound) throw new Error('fixture: no cyber dogs');
    const set = ['armour_3', 'cybernetics_3', 'weapons_3'];
    // The precondition: this set really does cross the ceiling on speed, or the case is vacuous.
    expect(hound.stats.speed).toBeGreaterThan(85);

    const forwards = upgradedStats(hound.stats, set);
    const backwards = upgradedStats(hound.stats, [...set].reverse());
    const shuffled = upgradedStats(hound.stats, [set[1]!, set[2]!, set[0]!]);
    expect(backwards).toEqual(forwards);
    expect(shuffled).toEqual(forwards);
  });

  it('makes no difference for any unit and any permutation of the three lines', () => {
    const set = ['armour_3', 'cybernetics_3', 'weapons_3'];
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const unit of UNIT_CATALOG) {
      const first = upgradedStats(unit.stats, set);
      for (const order of permutations) {
        expect(
          upgradedStats(
            unit.stats,
            order.map((index) => set[index]!),
          ),
          unit.id,
        ).toEqual(first);
      }
    }
  });
});
