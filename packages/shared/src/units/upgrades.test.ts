import { describe, expect, it } from 'vitest';
import { blueprintForUnitUpgrade, blueprintGateMet } from '../blueprints/index.js';
import { BUILDING_MAX_LEVEL } from '../building/kinds.js';
import { scrapyardLevelForUpgrade } from '../building/scrapyard.js';
import { UNIT_MODIFICATIONS, findUnitModification } from './modifications.js';
import { UPGRADE_REFUSALS, upgradeRefusal, upgradedStats } from './upgrades.js';
import { UNIT_CATALOG, findUnit } from './catalog.js';
import { UNIT_RATING_KEYS, capRating } from './stats.js';

const YES = () => true;
const NO = () => false;

/** Three cards with nothing in common but the bench: open, gated and costly, universal all. */
const open = findUnitModification('taped_grips');
const gated = findUnitModification('ablative_layers');
const dear = findUnitModification('hardshell_exoframe');
if (!open || !gated || !dear) throw new Error('fixture: expected three named cards');

describe('building a card at the yard', () => {
  /**
   * An empty inventory, asked through the real mapping rather than through a flat `NO`.
   *
   * The card says whether it wants drawings (`requiresBlueprint`) and `blueprints/catalog.ts`
   * says which document those are. Reading the answer off `blueprintGateMet` is what keeps "three
   * cards are open to anybody" a measurement of the shipped catalogue.
   */
  const NO_DOCUMENTS = (id: string) => blueprintGateMet({}, 'unit_upgrade', id);

  /**
   * One call, with every gate open except the ones a test names.
   *
   * `yardLevel` defaults to the top of the ladder so that only the test that cares about it sees
   * it at all.
   */
  const refuse = (over: Partial<Parameters<typeof upgradeRefusal>[0]>) =>
    upgradeRefusal({
      id: open.id,
      fitted: [],
      yardLevel: BUILDING_MAX_LEVEL,
      requiredYardLevel: scrapyardLevelForUpgrade,
      blueprintUnlocked: YES,
      affordable: YES,
      hasParts: YES,
      ...over,
    });

  it('takes an open card with nothing but a standing yard and the money', () => {
    expect(refuse({ yardLevel: 1, blueprintUnlocked: NO_DOCUMENTS })).toBeNull();
  });

  /**
   * No tiers: a card never asks for the card below it.
   *
   * The Gauntlet came back on 2026-09-16 and it is a different rule, so it is no longer asserted
   * away here. A card used to ask for nothing but the yard, the drawings and the bill, and the
   * maintainer's ruling is that the good ones should be hard to get: `boltOntoUnitRefusal` asks
   * the Gauntlet's level, the crew's level and an officer's mark on top. `upgradeRefusal`, which
   * this exercises, is still the cut-it-at-all half and still asks none of them.
   */
  it('has no rung below a card to ask for', () => {
    expect(UPGRADE_REFUSALS).not.toContain('needs_previous_tier');
    // The dearest card in the catalogue, on a bare roster: nothing about what else is built is
    // asked, so the only thing between a crew and a masterpiece is the yard, the drawings and the
    // bill.
    expect(refuse({ id: dear.id, fitted: [] })).toBeNull();
  });

  /**
   * The blueprint gate is checked before the money.
   *
   * Both can be true at once, and "you need the blueprint" is the one a player can act on today:
   * the scrap will fix itself.
   */
  it('names the blueprint before it names the price', () => {
    expect(refuse({ id: gated.id, blueprintUnlocked: NO_DOCUMENTS, affordable: NO })).toBe(
      'needs_blueprint',
    );
  });

  it('opens a gated card the moment its document is in the inventory', () => {
    const document = blueprintForUnitUpgrade(gated.id);
    if (!document) throw new Error('fixture: the gated card has no document');
    const held = (id: string) => blueprintGateMet({ [document.id]: 1 }, 'unit_upgrade', id);
    expect(refuse({ id: gated.id, blueprintUnlocked: held })).toBeNull();
    expect(refuse({ id: gated.id, blueprintUnlocked: NO_DOCUMENTS })).toBe('needs_blueprint');
  });

  /** The yard's own level comes before the drawings: raising it is the errand either way. */
  it('names the yard before the document when both are short', () => {
    const opens = scrapyardLevelForUpgrade(dear);
    expect(opens).toBeGreaterThan(1);
    expect(refuse({ id: dear.id, yardLevel: opens - 1, blueprintUnlocked: NO_DOCUMENTS })).toBe(
      'yard_too_low',
    );
    expect(refuse({ id: dear.id, yardLevel: opens, blueprintUnlocked: NO_DOCUMENTS })).toBe(
      'needs_blueprint',
    );
  });

  it('refuses on parts, then on money', () => {
    expect(refuse({ id: gated.id, hasParts: NO, affordable: NO })).toBe('missing_parts');
    expect(refuse({ id: gated.id, affordable: NO })).toBe('cannot_afford');
  });

  it('refuses to build the same card twice', () => {
    expect(refuse({ fitted: [open.id] })).toBe('already_fitted');
  });

  it('does not know what an invented card is', () => {
    expect(refuse({ id: 'not_a_thing' })).toBe('unknown_upgrade');
    expect(refuse({ id: 'armour_1' }), 'a retired refit id is not a card').toBe('unknown_upgrade');
  });

  /** Every gate open, across the whole catalogue: no card is refused for a reason nobody named. */
  it('takes every card in the catalogue once every gate is open', () => {
    for (const spec of UNIT_MODIFICATIONS) {
      expect(refuse({ id: spec.id }), spec.id).toBeNull();
    }
  });
});

/**
 * A rating is out of a hundred, and nothing in the game may put one past it.
 *
 * The rule the maintainer stated (2026-09-15): every stat except damage and hit points is a 0..100
 * figure, and no modification may exceed it. `upgradedStats` clamps, and this is what stops that
 * clamp being quietly undone by a code change. Whether the *catalogue* respects the ceiling before
 * the clamp is a different question, measured on the raw sum in `modifications.test.ts`.
 *
 * Every card at once, on every unit, which is the worst case and not a realistic loadout. A test
 * over the realistic ones would pass the day somebody widened the brackets.
 */
describe('the hundred-point ceiling', () => {
  /*
   * The ceiling is one function, and this is the function.
   *
   * `upgradedStats`, `city/labels.ts` and `battle/effects.ts` each used to carry their own
   * `Math.min(100, ...)`, which is three places for the maintainer's rule to drift apart in. The
   * absurd inputs are the point: a bonus nobody has written yet still lands on 100.
   */
  it('is `capRating`, and it answers 100 to any bonus at all', () => {
    expect(capRating(100)).toBe(100);
    expect(capRating(101)).toBe(100);
    expect(capRating(340)).toBe(100);
    expect(capRating(Number.MAX_SAFE_INTEGER)).toBe(100);
    expect(capRating(Number.POSITIVE_INFINITY)).toBe(100);
    // ...and nothing to a penalty past the floor. Not rounded: the battlefield keeps speed's fraction.
    expect(capRating(-40)).toBe(0);
    expect(capRating(62.5)).toBe(62.5);
  });

  it('holds a sheet fed an absurd card total at 100, through `capRating`', () => {
    const razors = findUnit('razors');
    if (!razors) throw new Error('fixture: no Razors');
    // Every card in the catalogue, twice over: nothing the yard sells reaches this total honestly.
    const twice = [...UNIT_MODIFICATIONS, ...UNIT_MODIFICATIONS].map((spec) => spec.id);
    const sheet = upgradedStats(razors.stats, twice);
    for (const key of UNIT_RATING_KEYS) {
      expect(sheet[key], key).toBeLessThanOrEqual(100);
    }
    // A guard on the guard: the doubled catalogue does push at least one rating over the top.
    const raw = UNIT_RATING_KEYS.map(
      (key) =>
        razors.stats[key] +
        twice.reduce((total, id) => total + (findUnitModification(id)?.effect[key] ?? 0), 0),
    );
    expect(Math.max(...raw)).toBeGreaterThan(100);
  });

  it('cannot be passed by fitting every card in the catalogue at once', () => {
    const everything = UNIT_MODIFICATIONS.map((spec) => spec.id);
    // A guard on the guard: with nothing to fit, the loop below would prove nothing at all.
    expect(everything.length).toBeGreaterThan(5);

    const over: string[] = [];
    for (const unit of Object.values(UNIT_CATALOG)) {
      const sheet = upgradedStats(unit.stats, everything);
      for (const key of UNIT_RATING_KEYS) {
        if (sheet[key] > 100) over.push(`${unit.id}.${key} = ${sheet[key]}`);
        if (sheet[key] < 0) over.push(`${unit.id}.${key} = ${sheet[key]}`);
      }
    }
    expect(over, over.join('\n')).toEqual([]);
  });

  /*
   * Damage and hit points are deliberately outside it.
   *
   * They are figures rather than ratings: a Colossus is worth twenty Razors and says so in the
   * hundreds. Clamping them was a real bug once (`upgradedStats` records it: a Razor on 160 damage
   * came out on 100, so the cheapest card halved the unit), so this pins the exception rather
   * than leaving it as something a future tidy-up could "fix".
   */
  it('does not apply to damage or hit points', () => {
    const heavy = Object.values(UNIT_CATALOG).find((unit) => unit.stats.offense > 100);
    expect(heavy, 'some unit hits harder than a rating could').toBeDefined();
    const sheet = upgradedStats(
      heavy!.stats,
      UNIT_MODIFICATIONS.map((spec) => spec.id),
    );
    expect(sheet.offense).toBeGreaterThan(100);
  });
});

describe('what a card does to a sheet', () => {
  const razors = UNIT_CATALOG.find((unit) => unit.id === 'razors');
  if (!razors) throw new Error('expected the razors');

  it('changes nothing when nothing is fitted', () => {
    expect(upgradedStats(razors.stats, [])).toEqual(razors.stats);
  });

  it('adds every fitted card together', () => {
    const both = upgradedStats(razors.stats, [gated.id, open.id]);
    expect(both.vitality).toBe(razors.stats.vitality + (gated.effect.vitality ?? 0));
    expect(both.offense).toBe(razors.stats.offense + (open.effect.offense ?? 0));
  });

  /** Plate is meant to cost speed. A fold that only ever added would quietly drop the tradeoff. */
  it('applies a penalty as a penalty', () => {
    expect(gated.effect.speed ?? 0).toBeLessThan(0);
    expect(upgradedStats(razors.stats, [gated.id]).speed).toBeLessThan(razors.stats.speed);
  });

  /**
   * The ceiling is for ratings, and only for ratings.
   *
   * Both halves are asserted, because the interesting failure is the *second* one: this used to cap
   * everything except `lootCapacity`, and once damage and hit points became counts rather than
   * ratings that cap became a shredder. A Razor on 160 damage came out of the cheapest card in the
   * game on 100, and every sheet converged on 100 the moment anything was slotted onto it. A test
   * that only checked the ceiling would have called that a pass.
   */
  it('caps the ratings and lets the open figures climb past 100', () => {
    const maxed = { ...razors.stats, vitality: 99, armor: 99, speed: 1, offense: 99 };
    const set = ['scrap_vest', 'ablative_layers', 'composite_carapace', 'taped_grips'];
    const all = upgradedStats(maxed, set);
    for (const key of UNIT_RATING_KEYS) {
      expect(all[key], key).toBeGreaterThanOrEqual(0);
      expect(all[key], key).toBeLessThanOrEqual(100);
    }
    // Damage and hit points took the whole set and kept it: no ceiling, and the card is still
    // worth what it says on it. Written out per card rather than summed off the catalogue: a
    // total read back out of `UNIT_MODIFICATIONS` would agree with itself whatever it said.
    expect(all.vitality).toBe(99 + 12 + 24 + 40);
    expect(all.offense).toBe(99 + 16);
  });

  it('ignores a card id it does not recognise rather than throwing', () => {
    expect(upgradedStats(razors.stats, ['nonsense'])).toEqual(razors.stats);
  });
});

/**
 * Which bracket a card was dropped into must not change the sheet.
 *
 * The clamp used to run per card, so a rating that touched the ceiling lost the headroom a later
 * negative delta would have given back, and the result depended on the order of the fitted ids.
 * That array is positional and the brackets fill left to right, while this module's own doc says
 * "Order does not matter; the set does".
 */
describe('the order cards were fitted in', () => {
  /** A speed card past the ceiling, a plate that takes speed back, and a third that adds some. */
  const set = ['synaptic_lace', 'hardshell_exoframe', 'twitch_loop'];

  it('makes no difference to the sheet, on the case that used to differ', () => {
    const hound = findUnit('cyber_dogs');
    if (!hound) throw new Error('fixture: no cyber dogs');
    // The precondition: this set really does cross the ceiling on speed, or the case is vacuous.
    expect(hound.stats.speed).toBeGreaterThan(85);

    const forwards = upgradedStats(hound.stats, set);
    const backwards = upgradedStats(hound.stats, [...set].reverse());
    const shuffled = upgradedStats(hound.stats, [set[1]!, set[2]!, set[0]!]);
    expect(backwards).toEqual(forwards);
    expect(shuffled).toEqual(forwards);
  });

  it('makes no difference for any unit and any permutation of the three cards', () => {
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
