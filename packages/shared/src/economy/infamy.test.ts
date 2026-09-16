import { describe, expect, it } from 'vitest';
import { UNIT_CATALOG, findUnit } from '../units/index.js';
import {
  INFAMY_PER_UNIT_SLOT,
  MISSION_INFAMY_PER_UNIT_SLOT,
  NOTORIETY_TO_FIELD,
  STARTING_INFAMY,
  gainInfamy,
  hasInfamy,
  infamyForKill,
  infamyForKills,
  missionInfamyForKills,
  notorietyToField,
  spendInfamy,
  unitsBeyondNotoriety,
} from './infamy.js';
import { notorietySpentTo } from './notoriety.js';
import { startingEconomy } from './state.js';

const NOW = new Date('2026-08-16T12:00:00.000Z');

describe('what a kill is worth (§D7)', () => {
  /**
   * The maintainer's rule (2026-09-15): one point per unit slot killed, and a unit slot is the
   * unit's own slots. Pinned to literals off the sheet rather than to `unit.unitSlots`, because a test
   * that reads the rule's own input back cannot tell the rule from its absence.
   */
  it('pays one point per unit slot, so a Razor is one and a Colossus is twelve', () => {
    expect(INFAMY_PER_UNIT_SLOT).toBe(1);
    expect(findUnit('razors')!.unitSlots).toBe(1);
    expect(infamyForKill('razors')).toBe(1);
    expect(findUnit('the_colossus')!.unitSlots).toBe(12);
    expect(infamyForKill('the_colossus')).toBe(12);
  });

  it('is the unit slots for every unit on the sheet, whatever tier it is filed under', () => {
    for (const unit of UNIT_CATALOG) expect(infamyForKill(unit), unit.id).toBe(unit.unitSlots);
  });

  /**
   * The control for the rule above: two units of the same slots are worth the same however far
   * apart their tiers sit. The old table paid a Warden twenty four times a Razor's worth; anything
   * that reintroduces a tier term fails here before it fails on somebody's ledger.
   */
  it('reads nothing but the slots: a heavy at two slots is worth a rabble at two slots', () => {
    const wardens = findUnit('wardens')!;
    const anodics = findUnit('anodics')!;
    expect(wardens.tier).not.toBe(anodics.tier);
    expect(wardens.unitSlots).toBe(anodics.unitSlots);
    expect(infamyForKill(wardens)).toBe(infamyForKill(anodics));
  });

  it('is worth nothing for a unit id nothing answers to, rather than throwing', () => {
    // This sits on the settle path: a retired id on an old battle row must not take a read offline.
    expect(infamyForKill('a_unit_that_was_retired')).toBe(0);
  });

  it('sums a whole casualty list', () => {
    // Ten Razors at one slot and two Snipers at two: fourteen slots, fourteen points.
    expect(findUnit('snipers')!.unitSlots).toBe(2);
    expect(infamyForKills({ razors: 10, snipers: 2 })).toBe(14);
  });

  it('ignores a negative count rather than paying a refund for it', () => {
    expect(infamyForKills({ razors: -5 })).toBe(0);
  });
});

/**
 * The maintainer's own example, word for word: "if you kill 3 you get 2". Half a point a slot,
 * rounded up, so one slot still pays one and an even count pays exactly half.
 */
describe('what a battle job pays for a kill (§D7, §E5)', () => {
  it('pays half a point per unit slot killed, rounded up', () => {
    expect(MISSION_INFAMY_PER_UNIT_SLOT).toBe(0.5);
    expect(missionInfamyForKills({ razors: 3 })).toBe(2);
    expect(missionInfamyForKills({ razors: 1 })).toBe(1);
    expect(missionInfamyForKills({})).toBe(0);
    expect(missionInfamyForKills({ razors: 4 })).toBe(2);
  });

  it('counts slots and not units: one Colossus is twelve slots and pays six', () => {
    expect(missionInfamyForKills({ the_colossus: 1 })).toBe(6);
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
   * Both halves, because the gate is no longer the tier alone (see `NOTORIETY_HEAVY_UNIT_SLOTS`).
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
   * buy every rung up to the one a legendary asks for, and how many unit slots is that? A point a
   * slot, so the two numbers are the same, and the bound is on the ladder's price rather than on
   * a kill count that could be retuned underneath it. The ladder was priced when a Colossus paid
   * 250 rather than 12; whether it moves with the new scale is the maintainer's call, so this
   * pins the price as it stands and fails loudly if it moves either way.
   */
  it('sets a legendary gate a determined crew can actually clear', () => {
    const spent = notorietySpentTo(NOTORIETY_TO_FIELD.legendary);
    const slots = Math.ceil(spent / INFAMY_PER_UNIT_SLOT);
    expect(slots).toBe(36_300);
    // Three thousand Abominations, or a great many more Razors: a career, and a finite one.
    expect(Math.ceil(slots / infamyForKill('the_abomination'))).toBe(3_630);
  });
});
