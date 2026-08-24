import { describe, expect, it } from 'vitest';
import { UNIT_CATALOG, UNIT_TIERS, findUnit, unitsInTier } from '../units/index.js';
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

  it('climbs strictly with tier, taking the cheapest member of each as the comparison', () => {
    const cheapest = UNIT_TIERS.map((tier) =>
      Math.min(...unitsInTier(tier).map((unit) => infamyForKill(unit))),
    );
    for (let i = 1; i < cheapest.length; i += 1) {
      expect(cheapest[i]!, UNIT_TIERS[i]).toBeGreaterThan(cheapest[i - 1]!);
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

  it('scales inside a tier by what a unit eats, so a big specialist is worth two small ones', () => {
    // Wrecking Crew is supply 4 against the Snipers' 2: twice the bodies, twice the name.
    expect(infamyForKill('wrecking_crew')).toBe(2 * infamyForKill('snipers'));
  });

  it('never prices anything in the catalogue at nothing', () => {
    for (const unit of UNIT_CATALOG) expect(infamyForKill(unit), unit.id).toBeGreaterThan(0);
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
  it('lets anybody put rabble and regulars on the street', () => {
    expect(notorietyToField('razors')).toBe(0);
    expect(notorietyToField('breakers')).toBe(0);
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
