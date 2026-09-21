import { isCombineUnit } from './catalog.js';
import { describe, expect, it } from 'vitest';
import { ITEM_CATALOG } from '../items/catalog.js';
import { UNIT_CATALOG, findUnit } from './catalog.js';
import {
  OPEN_FIGURE_WEIGHT,
  UNIT_MODIFICATIONS,
  UNIT_MODIFICATION_IDS,
  UNIT_MODIFICATION_RARITIES,
  UNIT_MODIFICATION_RARITY_BANDS,
  UNIT_MODIFICATION_RARITY_LABELS,
  findUnitModification,
  largestRatingDelta,
  modificationFitsUnit,
  modificationsForUnit,
  unitModificationBlueprintMet,
  unitModificationPower,
  unitModificationsOfRarity,
  type UnitModificationRarity,
} from './modifications.js';
import { UNIT_RATING_KEYS, UNIT_STAT_KEYS, type StatKey, type UnitStats } from './stats.js';

/** The maintainer's figure, written here rather than read off the array it is checking. */
const CATALOGUE_SIZE = 31;
/** Tape, offcuts and second-hand boots: the three a crew can build on its first day. */
const OPEN_FROM_THE_START = ['taped_grips', 'scrap_vest', 'broken_in_boots'];

const open = () => UNIT_MODIFICATIONS.filter((spec) => !spec.requiresBlueprint);

/**
 * Where the three best eligible cards put a rating past 100 before the clamp, as `unit.rating`.
 *
 * Thirty-two pairs on 2026-09-15. See the test that reads it for why this is a list and not a
 * rule. Morale is twenty of them: eleven units carry 66 or more and the three morale cards add 49.
 */
const KNOWN_OVERSHOOT: readonly string[] = [
  'anodics.morale',
  'ash_walkers.morale',
  'breakers.morale',
  'cyber_dogs.morale',
  'cyber_dogs.speed',
  'cyber_dogs.stealth',
  'demolishers.morale',
  'ghosts.morale',
  'ghosts.stealth',
  'hollow_men.intimidation',
  'hollow_men.morale',
  'ironsides.armor',
  'ironsides.morale',
  'juggernauts.armor',
  'juggernauts.intimidation',
  'juggernauts.morale',
  'kite_crews.morale',
  'kite_crews.range',
  'kite_crews.speed',
  'netrunners.morale',
  'netrunners.stealth',
  'road_reavers.morale',
  'sleepers.morale',
  'sleepers.stealth',
  'sluggers.morale',
  'snipers.morale',
  'snipers.range',
  'snipers.stealth',
  'stitchers.morale',
  'the_condemned.morale',
  'the_twins.morale',
  'wardens.morale',
];
const legendary = UNIT_CATALOG.filter((unit) => unit.tier === 'legendary');
const carriers = UNIT_CATALOG.filter((unit) => unit.tier === 'carrier');

describe('the modification catalogue', () => {
  it('holds thirty-one cards with no two sharing an id', () => {
    expect(UNIT_MODIFICATIONS).toHaveLength(CATALOGUE_SIZE);
    expect(new Set(UNIT_MODIFICATION_IDS).size).toBe(CATALOGUE_SIZE);
    for (const spec of UNIT_MODIFICATIONS) {
      expect(findUnitModification(spec.id), spec.id).toBe(spec);
    }
  });

  it('gives every card a name and a line of its own', () => {
    expect(new Set(UNIT_MODIFICATIONS.map((spec) => spec.name)).size).toBe(CATALOGUE_SIZE);
    expect(new Set(UNIT_MODIFICATIONS.map((spec) => spec.description)).size).toBe(CATALOGUE_SIZE);
  });

  it('moves only stats that exist, and moves at least one of them', () => {
    for (const spec of UNIT_MODIFICATIONS) {
      const keys = Object.keys(spec.effect);
      expect(keys.length, spec.id).toBeGreaterThan(0);
      for (const key of keys) expect(UNIT_STAT_KEYS, `${spec.id}: ${key}`).toContain(key);
    }
  });

  it('names a real part in every recipe', () => {
    for (const spec of UNIT_MODIFICATIONS) {
      for (const id of Object.keys(spec.parts)) {
        expect(ITEM_CATALOG[id as keyof typeof ITEM_CATALOG], `${spec.id}: ${id}`).toBeDefined();
      }
    }
  });

  /** §B9: the Scrapyard's page shows scrap and high-quality metal, so a bill may show nothing else. */
  it('charges scrap for everything and the scarce metal only past BASIC', () => {
    for (const spec of UNIT_MODIFICATIONS) {
      expect(spec.cost.scrap, spec.id).toBeGreaterThan(0);
      expect(Object.keys(spec.cost).sort(), spec.id).toEqual(
        spec.rarity === 'basic' ? ['scrap'] : ['highQualityMetal', 'scrap'],
      );
    }
  });
});

describe('no tiers and no prerequisites', () => {
  /**
   * The whole point of the new model, asserted against the shape of the card rather than against a
   * behaviour.
   *
   * A refit carried `line` and `tier` and `upgradeRefusal` read them to demand the rung below. If a
   * card ever grows either field back, this is where it gets caught, before a `needs_previous_tier`
   * refusal follows it.
   */
  it('puts no ladder field on any card', () => {
    for (const spec of UNIT_MODIFICATIONS) {
      const card = spec as unknown as Record<string, unknown>;
      for (const field of ['tier', 'line', 'requires', 'requiresUpgrade', 'prerequisite']) {
        expect(card[field], `${spec.id}: ${field}`).toBeUndefined();
      }
    }
  });
});

describe('what a crew can build on day one', () => {
  it('opens exactly three cards, and all three are BASIC', () => {
    const free = open();
    expect(free.map((spec) => spec.id)).toEqual(OPEN_FROM_THE_START);
    expect(free).toHaveLength(3);
    for (const spec of free) expect(spec.rarity, spec.id).toBe('basic');
    expect(UNIT_MODIFICATIONS.filter((spec) => spec.requiresBlueprint)).toHaveLength(
      CATALOGUE_SIZE - 3,
    );
  });

  /**
   * "The simplest ones" is the maintainer's wording, and this is what it has to mean if anything
   * is going to hold it: no components at all, and cheaper than every card the yard needs drawings
   * for.
   */
  it('makes the open three the simplest cards in the catalogue', () => {
    const gated = UNIT_MODIFICATIONS.filter((spec) => spec.requiresBlueprint);
    const dearestOpen = Math.max(...open().map((spec) => spec.cost.scrap ?? 0));
    const cheapestGated = Math.min(...gated.map((spec) => spec.cost.scrap ?? 0));
    expect(dearestOpen).toBeLessThan(cheapestGated);
    for (const spec of open()) expect(Object.keys(spec.parts), spec.id).toEqual([]);
    // The guard on the guard: if nothing were gated the comparison above would be empty maxima.
    expect(gated.length).toBeGreaterThan(0);
  });

  it('answers the blueprint clause off the card, not off the gate alone', () => {
    const [free] = open();
    const gated = UNIT_MODIFICATIONS.find((spec) => spec.requiresBlueprint);
    if (!free || !gated) throw new Error('expected one of each');
    const holdsNothing = () => false;
    const holdsEverything = () => true;
    expect(unitModificationBlueprintMet(free, holdsNothing)).toBe(true);
    expect(unitModificationBlueprintMet(gated, holdsNothing)).toBe(false);
    expect(unitModificationBlueprintMet(gated, holdsEverything)).toBe(true);
    // The gate is asked about this card and no other.
    expect(unitModificationBlueprintMet(gated, (id) => id === gated.id)).toBe(true);
    expect(unitModificationBlueprintMet(gated, (id) => id !== gated.id)).toBe(false);
  });
});

describe('rarity is a claim about the numbers', () => {
  it('uses exactly the four words and shouts them', () => {
    expect(UNIT_MODIFICATION_RARITIES).toEqual(['basic', 'intricate', 'advanced', 'masterpiece']);
    expect(Object.values(UNIT_MODIFICATION_RARITY_LABELS)).toEqual([
      'BASIC',
      'INTRICATE',
      'ADVANCED',
      'MASTERPIECE',
    ]);
  });

  it('fills every band', () => {
    for (const rarity of UNIT_MODIFICATION_RARITIES) {
      expect(unitModificationsOfRarity(rarity).length, rarity).toBeGreaterThan(0);
    }
    const counted = UNIT_MODIFICATION_RARITIES.reduce(
      (total, rarity) => total + unitModificationsOfRarity(rarity).length,
      0,
    );
    expect(counted).toBe(CATALOGUE_SIZE);
  });

  /**
   * The measure, spelled out here rather than imported, so the test is not the implementation.
   *
   * `unitModificationPower` sums the deltas with the three open figures (damage, hit points, loot)
   * counted at a quarter. Recomputing it independently is what makes the band assertions below a
   * measurement of the *catalogue* rather than of the function.
   */
  const power = (effect: Partial<UnitStats>) => {
    let total = 0;
    for (const key of UNIT_STAT_KEYS) {
      const delta = effect[key];
      if (delta === undefined) continue;
      total += (UNIT_RATING_KEYS as readonly StatKey[]).includes(key)
        ? delta
        : delta * OPEN_FIGURE_WEIGHT;
    }
    return total;
  };

  it('scores each card the way the module says it does', () => {
    for (const spec of UNIT_MODIFICATIONS) {
      expect(unitModificationPower(spec), spec.id).toBe(power(spec.effect));
    }
  });

  it('keeps every card inside its declared band', () => {
    for (const spec of UNIT_MODIFICATIONS) {
      const band = UNIT_MODIFICATION_RARITY_BANDS[spec.rarity];
      const score = unitModificationPower(spec);
      expect(score, `${spec.id} (${spec.rarity})`).toBeGreaterThanOrEqual(band.min);
      expect(score, `${spec.id} (${spec.rarity})`).toBeLessThanOrEqual(band.max);
    }
  });

  /**
   * The claim a player is actually reading: a masterpiece is plainly better than an advanced card,
   * which is plainly better than an intricate one.
   *
   * Measured off the shipped cards, band by band, rather than off the declared ranges: the ranges
   * are the author's intent and this is whether the catalogue met it. Strictly, so no two bands may
   * meet in the middle.
   */
  it('climbs, band by band, with no overlap', () => {
    const scores = UNIT_MODIFICATION_RARITIES.map((rarity) =>
      unitModificationsOfRarity(rarity).map(unitModificationPower),
    );
    for (let index = 1; index < scores.length; index++) {
      const below = scores[index - 1]!;
      const above = scores[index]!;
      expect(below.length, UNIT_MODIFICATION_RARITIES[index - 1]).toBeGreaterThan(0);
      expect(above.length, UNIT_MODIFICATION_RARITIES[index]).toBeGreaterThan(0);
      expect(Math.min(...above), UNIT_MODIFICATION_RARITIES[index]).toBeGreaterThan(
        Math.max(...below),
      );
    }
  });

  /** Money says the same thing the word does, or the word is decoration on the shop page. */
  it('gets dearer band by band', () => {
    const scrap = UNIT_MODIFICATION_RARITIES.map((rarity) =>
      unitModificationsOfRarity(rarity).map((spec) => spec.cost.scrap ?? 0),
    );
    for (let index = 1; index < scrap.length; index++) {
      expect(Math.min(...scrap[index]!), UNIT_MODIFICATION_RARITIES[index]).toBeGreaterThan(
        Math.max(...scrap[index - 1]!),
      );
    }
  });
});

/**
 * The maintainer's rule: every stat except damage and hit points is out of a hundred.
 *
 * `upgradedStats` clamps into 0..100 for ratings, which means the ceiling cannot be *observed* on
 * its output: `Math.max(0, Math.min(100, raw))` is in range whatever the catalogue says. So both
 * halves here are measured on the **raw** sum, before the clamp, which is the only place a card
 * authored with an absurd delta can still be seen.
 *
 * The top half cannot be stated as "every card at once stays under 100": every card on one unit
 * is not a loadout, and no catalogue worth having would survive it. What is stated instead is a
 * per-card ceiling that climbs with the rarity, which is the authorable mistake this is for.
 */
describe('the hundred-point ceiling', () => {
  it('holds every card to its band’s largest single move', () => {
    for (const spec of UNIT_MODIFICATIONS) {
      const band = UNIT_MODIFICATION_RARITY_BANDS[spec.rarity];
      expect(largestRatingDelta(spec), `${spec.id} (${spec.rarity})`).toBeLessThanOrEqual(
        band.maxRatingDelta,
      );
    }
  });

  it('lets a dearer card move a rating further than a cheaper one', () => {
    const reached = UNIT_MODIFICATION_RARITIES.map((rarity) =>
      Math.max(...unitModificationsOfRarity(rarity).map(largestRatingDelta)),
    );
    for (let index = 1; index < reached.length; index++) {
      expect(reached[index]!, UNIT_MODIFICATION_RARITIES[index]).toBeGreaterThan(
        reached[index - 1]!,
      );
    }
  });

  /**
   * The floor, on the raw sum, with every card a unit can take fitted at once.
   *
   * This one can genuinely fail. Four units sit on 0 in four separate ratings (a Scavenger has no
   * armour, no penetration, no range and no intimidation) and Ironsides walk at 22, so a card that
   * took points off any of those would be visible here the moment it was written. Every downside
   * in the shipped catalogue is on speed or morale for exactly that reason.
   */
  it('cannot drive a rating below zero, even with everything fitted at once', () => {
    const under: string[] = [];
    for (const unit of UNIT_CATALOG) {
      const fitted = modificationsForUnit(unit.id);
      // A legendary takes nothing, and neither does anything the Combine fields: the yard never
      // sees their sheets (`UnitSpec.faction`).
      if (unit.tier === 'legendary' || isCombineUnit(unit)) {
        expect(fitted, unit.id).toEqual([]);
        continue;
      }
      // A guard on the guard: an empty fit would make the loop below prove nothing.
      expect(fitted.length, unit.id).toBeGreaterThan(5);
      for (const key of UNIT_RATING_KEYS) {
        const raw = fitted.reduce(
          (total, spec) => total + (spec.effect[key] ?? 0),
          unit.stats[key],
        );
        if (raw < 0) under.push(`${unit.id}.${key} = ${raw}`);
      }
    }
    expect(under, under.join('\n')).toEqual([]);
  });

  /**
   * The top half, on the raw sum, with the three best eligible cards a unit can take.
   *
   * The rule as the maintainer stated it ("no modification may exceed 100") cannot be held on the
   * raw sum across this catalogue: the Hollow Men, the Condemned and the Twins sit on 100 morale,
   * Sleepers on 95 stealth and Snipers on 95 range, so any card that adds one of those is past the
   * ceiling on that unit before the clamp. Holding it would mean either a `fits` list on every
   * morale, stealth and range card that names the units below the line, or deltas small enough to
   * fall out of their rarity band. That is a product call, not a retune, so what this pins is the
   * set of unit-and-rating pairs where the overshoot happens today. A card retuned upward, or a
   * new card, that puts a new pair past the line fails here and has to be added by hand; a retune
   * that takes one off the list fails too, so the list never overstates.
   *
   * Measured on the three largest positive deltas among the cards the unit can take, which is the
   * most any loadout can add: `UNIT_UPGRADE_SLOTS` is three and a card goes on one unit.
   */
  it('overshoots on the raw top-three sum exactly where it is known to', () => {
    const over: string[] = [];
    for (const unit of UNIT_CATALOG) {
      if (unit.tier === 'legendary') continue;
      const cards = modificationsForUnit(unit.id);
      for (const key of UNIT_RATING_KEYS) {
        const best = cards
          .map((spec) => spec.effect[key] ?? 0)
          .filter((delta) => delta > 0)
          .sort((a, b) => b - a)
          .slice(0, 3);
        const raw = unit.stats[key] + best.reduce((total, delta) => total + delta, 0);
        if (raw > 100) over.push(`${unit.id}.${key}`);
      }
    }
    expect(over.sort()).toEqual([...KNOWN_OVERSHOOT].sort());
    // Six ratings and no others: offense, vitality and the bag are open figures, and evasion and
    // penetration sit low enough on every sheet for three cards to fit under the line.
    expect(new Set(KNOWN_OVERSHOOT.map((pair) => pair.split('.')[1]))).toEqual(
      new Set(['morale', 'stealth', 'range', 'speed', 'armor', 'intimidation']),
    );
  });

  /** Every downside in the catalogue, and where it is allowed to land. */
  it('takes its downsides out of speed and morale and nowhere else', () => {
    for (const spec of UNIT_MODIFICATIONS) {
      for (const key of UNIT_RATING_KEYS) {
        const delta = spec.effect[key] ?? 0;
        if (delta < 0) expect(['speed', 'morale'], `${spec.id}: ${key}`).toContain(key);
      }
    }
    // Not vacuous: the catalogue really does carry downsides.
    const withCost = UNIT_MODIFICATIONS.filter((spec) =>
      UNIT_RATING_KEYS.some((key) => (spec.effect[key] ?? 0) < 0),
    );
    expect(withCost.length).toBeGreaterThan(2);
  });
});

describe('who a card will go on', () => {
  /**
   * The guard on the two eligibility tests below.
   *
   * Both of them would pass on a catalogue where every card was universal, or on one where every
   * card was restricted, by never finding the case they are about. This is the assertion that the
   * catalogue actually contains both kinds.
   */
  it('carries both restricted and universal cards', () => {
    const restricted = UNIT_MODIFICATIONS.filter((spec) => spec.fits !== undefined);
    const universal = UNIT_MODIFICATIONS.filter((spec) => spec.fits === undefined);
    expect(restricted.length).toBeGreaterThan(0);
    expect(universal.length).toBeGreaterThan(0);
    expect(restricted.length + universal.length).toBe(CATALOGUE_SIZE);
  });

  it('names only real, non-legendary units in a fits list', () => {
    for (const spec of UNIT_MODIFICATIONS) {
      if (!spec.fits) continue;
      expect(spec.fits.length, spec.id).toBeGreaterThan(0);
      expect(new Set(spec.fits).size, spec.id).toBe(spec.fits.length);
      for (const id of spec.fits) {
        const unit = findUnit(id);
        expect(unit, `${spec.id}: ${id}`).toBeDefined();
        expect(unit!.tier, `${spec.id}: ${id}`).not.toBe('legendary');
      }
    }
  });

  it('refuses a restricted card to a unit outside its list and takes it inside', () => {
    const spec = findUnitModification('counterweight_harness');
    if (!spec?.fits) throw new Error('expected a restricted card');
    expect(spec.fits).toContain('haulers');
    expect(spec.fits).not.toContain('razors');
    expect(modificationFitsUnit(spec, 'haulers')).toBe(true);
    expect(modificationFitsUnit(spec, 'razors')).toBe(false);
  });

  it('takes a universal card anywhere that is not legendary', () => {
    const spec = UNIT_MODIFICATIONS.find((card) => card.fits === undefined);
    if (!spec) throw new Error('expected a universal card');
    for (const unit of UNIT_CATALOG) {
      expect(modificationFitsUnit(spec, unit.id), `${spec.id}: ${unit.id}`).toBe(
        unit.tier !== 'legendary' && !isCombineUnit(unit),
      );
    }
  });

  it('does not know what an invented unit is', () => {
    const [spec] = UNIT_MODIFICATIONS;
    if (!spec) throw new Error('expected a card');
    expect(modificationFitsUnit(spec, 'not_a_unit')).toBe(false);
    expect(modificationsForUnit('not_a_unit')).toEqual([]);
  });
});

describe('the two tiers the rule is actually about', () => {
  it('refuses a legendary every card in the catalogue', () => {
    // Guard on the guard: the roster has legendaries to refuse.
    expect(legendary.length).toBeGreaterThan(0);
    for (const unit of legendary) {
      for (const spec of UNIT_MODIFICATIONS) {
        expect(modificationFitsUnit(spec, unit.id), `${spec.id}: ${unit.id}`).toBe(false);
      }
      expect(modificationsForUnit(unit.id), unit.id).toEqual([]);
    }
  });

  it('takes modifications on a carrier, including one written for carriers', () => {
    expect(carriers.length).toBeGreaterThan(0);
    for (const unit of carriers) {
      const fitted = modificationsForUnit(unit.id);
      expect(fitted.length, unit.id).toBeGreaterThan(0);
      // Not just the universal ones: a card whose `fits` names this carrier and nothing generic.
      const written = fitted.filter((spec) => spec.fits?.includes(unit.id));
      expect(written.length, unit.id).toBeGreaterThan(0);
    }
  });
});

describe('the rarity a card is filed under', () => {
  it('is one of the four and nothing else', () => {
    const known = new Set<UnitModificationRarity>(UNIT_MODIFICATION_RARITIES);
    for (const spec of UNIT_MODIFICATIONS) {
      expect(known.has(spec.rarity), `${spec.id}: ${spec.rarity}`).toBe(true);
    }
  });
});

/**
 * A card's `fits` list is a claim that the card is worth buying for that unit.
 *
 * It stopped being true once, and quietly. The Netrunners' offense went to twenty when
 * `UnitSpec.jammer` became the whole of what they are, and the yard went on selling them the
 * marksman line: Hardened Optics, Ranging Gear and Guided Rounds, +12, +48 and +72 offense on a
 * sheet where offense decides nothing. Three cards, a blueprint each, and no gate said a word.
 *
 * So the rule is written down. A sheet whose contribution is not its damage may not be sold a
 * card whose only contribution is damage. `jamPercent` reads the stacks still standing and still
 * in the line, so what a jammer is actually sold has to be able to keep it there.
 */
describe('what the yard sells a unit that does not shoot', () => {
  /**
   * The jammers, and only the jammers.
   *
   * The first cut of this said "every support sheet", which swept in the Stitchers and went red
   * on Filed Sights. That was the test being wrong, not the catalogue: a Stitcher carries 60
   * offense, so Recoil Dampers is a 47% boost to a real number and a perfectly good thing to sell
   * one. A *jammer* is the case where damage is not merely low but definitionally beside the
   * point, and its 20 is the lowest figure on the roster against a median of 280.
   */
  const SUPPORT = UNIT_CATALOG.filter((unit) => unit.jammer === true);

  /** What a card moves, split into the figures that decide a fight for a support sheet. */
  const movesOnly = (effect: Partial<UnitStats>, keys: readonly (keyof UnitStats)[]): boolean =>
    Object.keys(effect).length > 0 &&
    Object.keys(effect).every((key) => keys.includes(key as keyof UnitStats));

  it('has support sheets in the catalogue at all, so this is not vacuous', () => {
    expect(SUPPORT.length).toBeGreaterThan(0);
    expect(SUPPORT.map((unit) => unit.id)).toContain('netrunners');
  });

  it('never sells one a card that is only a bigger gun', () => {
    const gunOnly: readonly (keyof UnitStats)[] = ['offense', 'penetration', 'range'];
    for (const unit of SUPPORT) {
      for (const card of modificationsForUnit(unit.id)) {
        expect(
          movesOnly(card.effect, gunOnly),
          `${card.name} is a gunsight and the yard offers it to ${unit.name}`,
        ).toBe(false);
      }
    }
  });

  /**
   * ...and it sells them something. Removing the wrong cards and leaving a sheet with nothing is
   * the other way to get this wrong, and it would read as "fixed" on the test above alone.
   */
  it('leaves them cards that keep them upright, at every rarity', () => {
    const keepsYouThere: readonly (keyof UnitStats)[] = [
      'vitality',
      'armor',
      'evasion',
      'morale',
      'stealth',
      'speed',
      'intimidation',
    ];
    for (const unit of SUPPORT) {
      const cards = modificationsForUnit(unit.id);
      for (const rarity of UNIT_MODIFICATION_RARITIES) {
        const atRarity = cards.filter((card) => card.rarity === rarity);
        expect(atRarity.length, `${unit.name} is sold nothing at ${rarity}`).toBeGreaterThan(0);
        expect(
          atRarity.some((card) => movesOnly(card.effect, keepsYouThere)),
          `${unit.name} has no ${rarity} card that only keeps it on the field`,
        ).toBe(true);
      }
    }
  });
});
