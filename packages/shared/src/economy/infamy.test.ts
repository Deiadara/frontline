import { describe, expect, it } from 'vitest';
import {
  UNIT_CATALOG,
  UNIT_TIERS,
  findUnit,
  isCombatUnit,
  unitsInTier,
  type UnitSpec,
  type UnitTier,
} from '../units/index.js';
import {
  INFAMY_PER_TIER,
  NOTORIETY_TO_FIELD,
  INFAMY_UNIT_VALUES,
  STARTING_INFAMY,
  gainInfamy,
  hasInfamy,
  infamyForKill,
  infamyForKills,
  notorietyToField,
  spendInfamy,
  unitsBeyondNotoriety,
} from './infamy.js';
import { notorietySpentTo } from './notoriety.js';
import { startingEconomy } from './state.js';

const NOW = new Date('2026-08-16T12:00:00.000Z');

describe('what a kill is worth (§D7)', () => {
  it('prices the cheapest thing on the street at one, and a legend at a hundred', () => {
    expect(infamyForKill('razors')).toBe(1);
    expect(infamyForKill('the_specter')).toBe(INFAMY_PER_TIER.legendary);
  });

  it('pays nothing at all for a porter: they are never in the line to be killed', () => {
    for (const unit of unitsInTier('carrier')) expect(infamyForKill(unit), unit.id).toBe(0);
  });

  /**
   * Climbs over the rungs of the ladder, which is not the same as climbing over the tiers.
   *
   * Carriers are off the ladder entirely: they are never in a line to be killed. Specialists and
   * Wonders of Engineering share a rung (see `units.test.ts` for why), and the cheapest member of
   * a shared rung is what has to clear the rung below: a Stitcher eats one supply against a
   * Netrunner's three, so the two tiers interleave by design.
   */
  it('climbs strictly with the rungs, taking the cheapest member of each as the comparison', () => {
    const RUNGS: readonly (readonly UnitTier[])[] = [
      ['rabble'],
      ['specialist', 'wonder'],
      ['heavy'],
      ['legendary'],
    ];
    expect(RUNGS.flat().sort()).toEqual(UNIT_TIERS.filter((tier) => tier !== 'carrier').sort());

    const cheapest = RUNGS.map((rung) =>
      Math.min(...rung.flatMap((tier) => unitsInTier(tier)).map((unit) => infamyForKill(unit))),
    );
    for (let i = 1; i < cheapest.length; i += 1) {
      expect(cheapest[i]!, RUNGS[i]!.join('/')).toBeGreaterThan(cheapest[i - 1]!);
    }
  });

  /**
   * The board's rule: a Colossus is worth roughly what it could fight through. Pinned as a floor
   * against the *next* tier down rather than as an exact number, so a retune of the table cannot
   * quietly make the biggest thing in the game worth the same as a Sniper.
   */
  it('makes a Colossus worth a great deal more than an ordinary legend', () => {
    expect(INFAMY_UNIT_VALUES.the_colossus).toBeDefined();
    expect(infamyForKill('the_colossus')).toBeGreaterThan(infamyForKill('the_specter'));
    expect(infamyForKill('the_colossus')).toBeGreaterThan(150 * infamyForKill('razors'));
  });

  /**
   * Stated as the rule rather than as one pair, because the pair moved underneath it.
   *
   * It used to pin Snipers against Cyberhounds at 2:1, which held only while the hounds were supply
   * 1. They are supply 2 now (see the sheet for why) and the assertion went from "the rule holds"
   * to "these two happen to be equal", which is a test that passes for a reason nobody wrote down.
   * Every pair inside a tier is checked instead, so the next repricing is caught wherever it lands.
   *
   * Whole points, so the comparison carries a rounding tolerance: the cheapest specialist's 12.5
   * rounds up to 13 and twice that is 26 against a supply-4 unit's 25.
   *
   * `INFAMY_UNIT_VALUES` is excluded, and that is not a loophole: it is the documented escape hatch
   * for the handful of units whose tier and price genuinely disagree, and comparing one of those
   * against the derived rule would only ever re-derive that it was overridden.
   */
  const derived = (unit: UnitSpec) => INFAMY_UNIT_VALUES[unit.id] === undefined;

  it('scales inside a tier by what a unit eats, so a big specialist is worth two small ones', () => {
    for (const tier of UNIT_TIERS) {
      if (tier === 'carrier') continue;
      const inTier = unitsInTier(tier).filter(derived);
      for (const small of inTier) {
        for (const big of inTier) {
          if (big.supply <= small.supply) continue;
          const expected = (infamyForKill(small) * big.supply) / small.supply;
          expect(infamyForKill(big), `${big.id} against ${small.id}`).toBeCloseTo(expected, -0.5);
        }
      }
    }
  });

  it('has pairs to compare in more than one tier, so the rule above is not vacuous', () => {
    const compared = UNIT_TIERS.filter((tier) => tier !== 'carrier').flatMap((tier) => {
      const supplies = unitsInTier(tier)
        .filter(derived)
        .map((unit) => unit.supply);
      return new Set(supplies).size > 1 ? [tier] : [];
    });
    expect(compared.length).toBeGreaterThan(1);
  });

  it('never prices a fighting unit at nothing', () => {
    for (const unit of UNIT_CATALOG) {
      if (unit.tier === 'carrier') continue;
      expect(infamyForKill(unit), unit.id).toBeGreaterThan(0);
    }
  });

  it('is worth nothing for a unit id nothing answers to, rather than throwing', () => {
    // This sits on the settle path: a retired id on an old battle row must not take a read offline.
    expect(infamyForKill('a_unit_that_was_retired')).toBe(0);
  });

  it('sums a whole casualty list', () => {
    expect(infamyForKills({ razors: 10, snipers: 2 })).toBe(
      10 * infamyForKill('razors') + 2 * infamyForKill('snipers'),
    );
  });

  it('ignores a negative count rather than paying a refund for it', () => {
    expect(infamyForKills({ razors: -5 })).toBe(0);
  });
});

describe('the ledger is uncapped (§D7)', () => {
  it('starts at nothing and goes past where the old meter stopped', () => {
    expect(STARTING_INFAMY).toBe(0);
    expect(gainInfamy(95, 400)).toBe(495);
    expect(gainInfamy(10_000, 1)).toBe(10_001);
  });

  it('never falls through a gain, however the caller signs the argument', () => {
    expect(gainInfamy(40, -100)).toBe(40);
  });

  it('is the schema a base actually carries', () => {
    expect(startingEconomy(NOW.toISOString()).infamy).toBe(STARTING_INFAMY);
  });
});

describe('spending it', () => {
  it('answers whether a price is covered, at the boundary as well as either side of it', () => {
    expect(hasInfamy(300, 300)).toBe(true);
    expect(hasInfamy(299, 300)).toBe(false);
  });

  it('hands back what is left, and refuses rather than clamping when it is short', () => {
    expect(spendInfamy(500, 300)).toBe(200);
    expect(spendInfamy(299, 300)).toBeNull();
  });

  /** A negative price would be a way to *earn* by buying. Refused, not silently added. */
  it('refuses a negative price', () => {
    expect(spendInfamy(500, -100)).toBeNull();
  });
});

describe('what a name lets you field (§D7)', () => {
  /**
   * Both halves, because the gate is no longer the tier alone (see `NOTORIETY_HEAVY_SUPPLY`).
   *
   * Breakers are in the Heavy tier and are still ungated: they are a Gauntlet 4 unit a crew trains
   * in its first session, and a rank on the tier locked them behind a reputation nobody has yet.
   */
  it('lets anybody put rabble and the cheap end of the armour on the street', () => {
    expect(notorietyToField('razors')).toBe(0);
    for (const id of ['breakers', 'wardens', 'sluggers', 'ironsides']) {
      expect(notorietyToField(id), id).toBe(0);
    }
  });

  it('still asks for a name before the genuinely heavy things in the same tier', () => {
    for (const id of ['juggernauts', 'hollow_men']) {
      expect(notorietyToField(id), id).toBe(NOTORIETY_TO_FIELD.heavy);
    }
  });

  it('asks for a real name before the heaviest things will take a contract', () => {
    expect(notorietyToField('juggernauts')).toBe(NOTORIETY_TO_FIELD.heavy);
    expect(notorietyToField('the_colossus')).toBe(NOTORIETY_TO_FIELD.legendary);
    expect(NOTORIETY_TO_FIELD.legendary).toBeGreaterThan(NOTORIETY_TO_FIELD.heavy);
  });

  it('names exactly which units in a force are out of reach, and nothing else', () => {
    const force = { razors: 20, juggernauts: 2, the_colossus: 1 };
    expect(unitsBeyondNotoriety(force, 0).sort()).toEqual(['juggernauts', 'the_colossus']);
    expect(unitsBeyondNotoriety(force, NOTORIETY_TO_FIELD.heavy)).toEqual(['the_colossus']);
    expect(unitsBeyondNotoriety(force, NOTORIETY_TO_FIELD.legendary)).toEqual([]);
  });

  it('says nothing about a unit nobody is sending', () => {
    expect(unitsBeyondNotoriety({ the_colossus: 0 }, 0)).toEqual([]);
  });

  /**
   * The gate has to be reachable, or the unit is decoration.
   *
   * It is a rank now, so the arithmetic runs through the ladder: what does it cost in infamy to
   * buy every rung up to the one a legendary asks for, and how many real fights is that? Priced
   * against killing an Abomination, which is the most valuable body in the game.
   */
  it('sets a legendary gate a determined crew can actually clear', () => {
    const abomination = findUnit('the_abomination')!;
    const spent = notorietySpentTo(NOTORIETY_TO_FIELD.legendary);
    const kills = Math.ceil(spent / infamyForKill(abomination));
    expect(kills).toBeGreaterThan(20);
    expect(kills).toBeLessThanOrEqual(400);
  });
});

/**
 * A unit that is much harder to field is never worth a fraction of one that is easy.
 *
 * Not a tuning rule: it is the floor under one. Kill value is derived from **tier**, and a tier is
 * also the flavour grouping on the roster screen. Those two jobs agreed until the tiers were
 * regrouped by what a unit *is* rather than by what it costs, and then The Condemned, which needs a
 * Gauntlet 12 and a Fight Pit taken off somebody, was worth 3 against a Warden's 24 off a Gauntlet
 * 4. Eight times less for a far deeper gate, and nothing said a word.
 *
 * The bar is deliberately loose. Half is not a tuning target, it is the point past which the
 * economy is telling a player something false about what is worth killing, so ordinary spread
 * between neighbouring units stays free and an inversion of this size cannot land quietly.
 * `INFAMY_UNIT_VALUES` is the escape hatch when a unit's tier and its price genuinely disagree.
 */
describe('what a kill is worth tracks what it took to field', () => {
  /** How much campaign a unit costs: building levels, plus a flat weight for the harder clauses. */
  const gateDepth = (unit: UnitSpec): number =>
    unit.requires.reduce(
      (total, need) =>
        total +
        (need.kind === 'building'
          ? need.level
          : need.kind === 'location'
            ? LOCATION_WEIGHT
            : FITTED_WEIGHT),
      0,
    );
  /** Holding ground is a campaign; a fitted modification is a research project. */
  const LOCATION_WEIGHT = 12;
  const FITTED_WEIGHT = 8;
  /** Far enough apart that the two are not neighbours being split by rounding. */
  const MUCH_DEEPER = 8;
  const FLOOR = 0.5;

  const fighters = UNIT_CATALOG.filter((unit) => isCombatUnit(unit));

  it('has a spread of gate depths to compare, so this is not vacuous', () => {
    const depths = fighters.map(gateDepth);
    expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(MUCH_DEEPER * 2);
  });

  it('never prices a much deeper unit below half an easier one', () => {
    const upside: string[] = [];
    for (const deep of fighters) {
      for (const easy of fighters) {
        if (gateDepth(deep) < gateDepth(easy) + MUCH_DEEPER) continue;
        if (infamyForKill(deep) >= infamyForKill(easy) * FLOOR) continue;
        upside.push(
          `${deep.name} (gate ${gateDepth(deep)}, worth ${infamyForKill(deep)}) against ` +
            `${easy.name} (gate ${gateDepth(easy)}, worth ${infamyForKill(easy)})`,
        );
      }
    }
    expect(upside).toEqual([]);
  });
});
