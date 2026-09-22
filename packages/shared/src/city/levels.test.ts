import { describe, expect, it } from 'vitest';
import { RESOURCE_KEYS } from '../resources.js';
import { BUILDING_KINDS, levelCeilingFor } from '../building/kinds.js';
import { storageCapacityFor } from '../building/production.js';
import { LocationControlSchema } from './control.js';
import { CITY_DISTRICTS, CONTESTED_DISTRICTS, RESIDENTIAL_DISTRICTS } from './districts.js';
import {
  AUTHORED_UPGRADE_NOTES,
  LATE_UPGRADE_NOTES,
  LEVEL_SCALE,
  LOCATION_CATALOG,
  LOCATION_KINDS,
  MAX_LOCATION_LEVEL,
  UPGRADE_COST_SCALE,
  UPGRADE_MIX,
  bonusesAt,
  clampLevel,
  describeHoldBonus,
  upgradeCost,
  upgradeNote,
} from './locations.js';

/**
 * Levels (§A4): the board-game half of a location.
 *
 * A location is a post you take, work up, and lose. The properties that make that interesting are
 * measured here: an upgrade is always worth something, an upgrade always costs more than the last
 * one, and every step of the ladder says in words what it actually did to the place. **A capture
 * keeps the level**, which is enforced where captures happen (`apps/server/src/battle/`); what
 * this file pins is the arithmetic that changes hands.
 */

describe('a location at a level', () => {
  it('keeps a level inside the scale, whatever it is handed', () => {
    expect(clampLevel(0)).toBe(1);
    expect(clampLevel(1)).toBe(1);
    expect(clampLevel(99)).toBe(MAX_LOCATION_LEVEL);
    expect(clampLevel(2.7)).toBe(2);
  });

  it('has a scale entry for every level and starts at exactly its authored value', () => {
    expect(MAX_LOCATION_LEVEL).toBe(10);
    expect(LEVEL_SCALE).toHaveLength(MAX_LOCATION_LEVEL);
    expect(UPGRADE_COST_SCALE).toHaveLength(MAX_LOCATION_LEVEL - 1);
    expect(LEVEL_SCALE[0]).toBe(1);
  });

  /**
   * The ceiling moved from 4 to 10 and levels 1 to 4 had to not move with it.
   *
   * Written as literals rather than read off the constants on purpose: a test that derives its
   * expectation from `LEVEL_SCALE` agrees with whatever `LEVEL_SCALE` says today, which is exactly
   * the mistake it exists to catch. A control row sitting at level 3 in the database has to be
   * worth the same tomorrow as it was yesterday.
   */
  it('leaves the four levels that shipped exactly where they were', () => {
    expect(LEVEL_SCALE.slice(0, 4)).toEqual([1, 1.5, 2, 2.5]);
    expect(UPGRADE_COST_SCALE.slice(0, 3)).toEqual([1, 2.2, 4.5]);

    // A Gas Station is 18 oil an hour fresh, and was 27/36/45 up the old ladder.
    const oilAt = (level: number): number =>
      bonusesAt('gas_station', level).reduce(
        (sum, b) => sum + (b.kind === 'resource' && b.resource === 'oil' ? b.perHour : 0),
        0,
      );
    expect([1, 2, 3, 4].map(oilAt)).toEqual([18, 27, 36, 45]);

    /*
     * What an upgrade is *made of* did move, on 2026-09-22, and deliberately.
     *
     * The prices used to be a hand-written bundle per kind, mostly caps. They are one mix now
     * (`UPGRADE_MIX`) over a per-kind plank figure, so these three literals are the new ladder
     * rather than the old one. What has to hold across that change is the *curve*: the three
     * steps still stand in the 1 : 2.2 : 4.5 ratio the line above pins, which is what a saved
     * control row at level 3 is priced against.
     */
    expect(upgradeCost('gas_station', 1)).toEqual({
      planks: 120,
      highQualityMetal: 12,
      scrap: 36,
      oil: 48,
      caps: 24,
    });
    expect(upgradeCost('gas_station', 2)).toEqual({
      planks: 264,
      highQualityMetal: 26,
      scrap: 79,
      oil: 106,
      caps: 53,
    });
    expect(upgradeCost('gas_station', 3)).toEqual({
      planks: 540,
      highQualityMetal: 54,
      scrap: 162,
      oil: 216,
      caps: 108,
    });
  });

  /**
   * The other half of "levels 1 to 4 do not move": every *shape* `scaledBonus` handles.
   *
   * `LEVEL_SCALE` being right is not enough on its own. A percentage, a per-hour rate, a flat
   * point and the small whole-number channels all take different paths through `scaledBonus`, and
   * the whole-number ones have a floor of their own ("one more per level") that the multiplier
   * does not reach at these sizes. Literal expectations, one per path, because a saved control row
   * at level 3 has to keep meaning what it meant.
   */
  it('leaves every kind of bonus exactly where it was at levels 1 to 4', () => {
    const ladder = (kind: Parameters<typeof bonusesAt>[0], of: string): number[] =>
      [1, 2, 3, 4].map((level) => {
        const bonus = bonusesAt(kind, level).find((entry) => entry.kind === of)!;
        return 'percent' in bonus
          ? bonus.percent
          : 'districts' in bonus
            ? bonus.districts
            : 'flat' in bonus
              ? bonus.flat
              : 'minutes' in bonus
                ? bonus.minutes
                : 'perHour' in bonus
                  ? bonus.perHour
                  : // The rules carry no quantity at all: see `scaledBonus`. Nothing here ladders
                    // one, so anything that reaches this arm has nothing to compare.
                    0;
      });

    // Straight multiplication, rounded: percentages, flat points and per-hour rates.
    expect(ladder('high_ground', 'defense_percent')).toEqual([12, 18, 24, 30]);
    expect(ladder('revolutionist_statue', 'intimidation')).toEqual([6, 9, 12, 15]);
    // Rounds half up, which is what makes a 5 into 8 rather than 7 at level 2.
    expect(ladder('broadcast_station', 'officer_group')).toEqual([5, 8, 10, 13]);
    // The whole-number channels, where the "at least one more per level" floor is what bites.
    expect(ladder('watchtower', 'vision')).toEqual([1, 2, 3, 4]);
    expect(ladder('gym', 'training_sessions')).toEqual([1, 2, 3, 4]);
    expect(ladder('black_clinic', 'battle_stims')).toEqual([2, 3, 4, 5]);
  });

  /**
   * The rows already in the database.
   *
   * `LocationControl.level` is persisted, and `db/repos/city.ts` parses every row it reads through
   * this schema. The ceiling only ever widened, so a 3 written last week still parses; the check
   * that matters is that nothing narrowed and that the new top of the ladder is storable, because
   * a control row that fails to parse is not an error on a screen, it is the row refusing to load.
   */
  it('parses every level a row can hold, old and new', () => {
    const row = (level: number) => ({
      locationId: 'rustyard-press',
      holder: { kind: 'unoccupied' as const },
      level,
      upgradingUntil: null,
      fortification: 0,
      fortifyingUntil: null,
      garrison: {},
    });
    for (let level = 1; level <= MAX_LOCATION_LEVEL; level += 1) {
      expect(LocationControlSchema.parse(row(level)).level, `level ${level}`).toBe(level);
    }
    expect(LocationControlSchema.safeParse(row(MAX_LOCATION_LEVEL + 1)).success).toBe(false);
    expect(LocationControlSchema.safeParse(row(0)).success).toBe(false);
  });

  it('keeps climbing past the old ceiling instead of flattening out', () => {
    expect(upgradeCost('gas_station', MAX_LOCATION_LEVEL - 1)).not.toBeNull();
    const oil = (level: number): number =>
      bonusesAt('gas_station', level).reduce(
        (sum, b) => sum + (b.kind === 'resource' && b.resource === 'oil' ? b.perHour : 0),
        0,
      );
    expect(oil(MAX_LOCATION_LEVEL)).toBeGreaterThan(oil(4));
  });

  /** The point of pouring anything in: every level is worth strictly more than the one below. */
  it('pays strictly more at every level, for every kind', () => {
    for (const kind of LOCATION_KINDS) {
      for (let level = 1; level < MAX_LOCATION_LEVEL; level += 1) {
        const now = bonusesAt(kind, level);
        const next = bonusesAt(kind, level + 1);
        const total = (bonuses: ReturnType<typeof bonusesAt>): number =>
          bonuses.reduce((sum, bonus) => {
            const value =
              'perHour' in bonus
                ? bonus.perHour
                : 'districts' in bonus
                  ? bonus.districts
                  : 'flat' in bonus
                    ? bonus.flat
                    : 'minutes' in bonus
                      ? bonus.minutes
                      : 'percent' in bonus
                        ? bonus.percent
                        : 0;
            return sum + value;
          }, 0);
        expect(total(next), `${kind} level ${level + 1}`).toBeGreaterThan(total(now));
      }
    }
  });

  it('is worth what the top of the scale says, fully worked against fresh', () => {
    const fresh = bonusesAt('gas_station', 1);
    const worked = bonusesAt('gas_station', MAX_LOCATION_LEVEL);
    const oil = (list: ReturnType<typeof bonusesAt>): number =>
      list.reduce(
        (sum, b) => sum + (b.kind === 'resource' && b.resource === 'oil' ? b.perHour : 0),
        0,
      );
    expect(oil(worked) / oil(fresh)).toBeCloseTo(LEVEL_SCALE[MAX_LOCATION_LEVEL - 1] as number, 1);
  });
});

describe('what an upgrade costs and what it is', () => {
  it('prices every step of the ladder and refuses one past the top', () => {
    for (const kind of LOCATION_KINDS) {
      for (let level = 1; level < MAX_LOCATION_LEVEL; level += 1) {
        const cost = upgradeCost(kind, level);
        expect(cost, `${kind} → ${level + 1}`).not.toBeNull();
        expect(Object.keys(cost ?? {}).length, `${kind} → ${level + 1}`).toBeGreaterThan(0);
      }
      expect(upgradeCost(kind, MAX_LOCATION_LEVEL), kind).toBeNull();
      expect(upgradeNote(kind, MAX_LOCATION_LEVEL), kind).toBeNull();
    }
  });

  it('charges more for each one than the last', () => {
    const spend = (cost: ReturnType<typeof upgradeCost>): number =>
      RESOURCE_KEYS.reduce((sum, key) => sum + (cost?.[key] ?? 0), 0);
    for (const kind of LOCATION_KINDS) {
      for (let level = 1; level < MAX_LOCATION_LEVEL - 1; level += 1) {
        expect(spend(upgradeCost(kind, level + 1)), `${kind} @${level}`).toBeGreaterThan(
          spend(upgradeCost(kind, level)),
        );
      }
    }
  });

  /**
   * The maintainer asked for this by name: an upgrade has to *say what it is*.
   *
   * "+50% oil" is a number going up. "You get the underground tanks pumping again" is a thing that
   * happened to a petrol station you own, and it is the difference between a build order and a
   * place. Every one is checked for being a sentence rather than a label.
   */
  it('says what each upgrade actually does, in the player’s words', () => {
    for (const kind of LOCATION_KINDS) {
      for (let level = 1; level < MAX_LOCATION_LEVEL; level += 1) {
        const note = upgradeNote(kind, level) ?? '';
        expect(note.length, `${kind} → ${level + 1}`).toBeGreaterThan(25);
        expect(note.trim().endsWith('.'), `${kind} → ${level + 1}`).toBe(true);
      }
      // Nine different things, not the same sentence nine times.
      expect(new Set(LOCATION_CATALOG[kind].upgrades).size, kind).toBe(AUTHORED_UPGRADE_NOTES);
      const ladder = Array.from({ length: MAX_LOCATION_LEVEL - 1 }, (_, i) =>
        upgradeNote(kind, i + 1),
      );
      expect(new Set(ladder).size, kind).toBe(MAX_LOCATION_LEVEL - 1);
    }
  });

  /**
   * The place-specific writing is where a player meets it, and the shared ladder starts after.
   *
   * Pinned by position rather than by "some kind uses it": the two tables are indexed off each
   * other in `upgradeNote`, and an off-by-one there would hand out level 5's sentence at level 6
   * without any count changing.
   */
  it('authors the first three by hand and shares the rest', () => {
    expect(LATE_UPGRADE_NOTES).toHaveLength(MAX_LOCATION_LEVEL - 1 - AUTHORED_UPGRADE_NOTES);
    for (const kind of LOCATION_KINDS) {
      for (let level = 1; level <= AUTHORED_UPGRADE_NOTES; level += 1) {
        expect(upgradeNote(kind, level), `${kind} -> ${level + 1}`).toBe(
          LOCATION_CATALOG[kind].upgrades[level - 1],
        );
      }
      for (let level = AUTHORED_UPGRADE_NOTES + 1; level < MAX_LOCATION_LEVEL; level += 1) {
        expect(upgradeNote(kind, level), `${kind} -> ${level + 1}`).toBe(
          LATE_UPGRADE_NOTES[level - 1 - AUTHORED_UPGRADE_NOTES],
        );
      }
    }
  });
});

describe('the city as a board', () => {
  it('is four districts a crew can live in and eight to fight over', () => {
    expect(RESIDENTIAL_DISTRICTS).toHaveLength(4);
    expect(CONTESTED_DISTRICTS).toHaveLength(8);
    expect(CITY_DISTRICTS).toHaveLength(12);
  });

  it('puts between five and eight locations in every contested district', () => {
    for (const district of CONTESTED_DISTRICTS) {
      expect(district.locations.length, district.id).toBeGreaterThanOrEqual(5);
      expect(district.locations.length, district.id).toBeLessThanOrEqual(8);
    }
  });

  /** A board with forty identical posts is a board with one post. */
  it('draws on a wide enough catalogue that no district is a copy of another', () => {
    for (const district of CONTESTED_DISTRICTS) {
      const kinds = district.locations.map((location) => location.kind);
      // A district may repeat a kind (the Undergrid has two substations, deliberately) but must
      // not be mostly repeats.
      expect(new Set(kinds).size, district.id).toBeGreaterThanOrEqual(kinds.length - 1);
    }
    const everywhere = CONTESTED_DISTRICTS.flatMap((d) => d.locations.map((l) => l.kind));
    expect(new Set(everywhere).size).toBeGreaterThanOrEqual(30);
  });

  it('gives every location kind a legible bonus at every level', () => {
    for (const kind of LOCATION_KINDS) {
      for (let level = 1; level <= MAX_LOCATION_LEVEL; level += 1) {
        for (const bonus of bonusesAt(kind, level)) {
          expect(describeHoldBonus(bonus), `${kind}@${level}`).toBeTruthy();
        }
      }
    }
  });
});

/**
 * One mix for every location, anchored on planks (maintainer, 2026-09-22).
 *
 * The prices used to be forty-six hand-written resource bundles, mostly caps, and a level was
 * something you bought rather than something you built. Every order is now 50% planks, 5%
 * high-quality metal, 15% scrap, 20% oil and 10% caps, which is the 10 : 1 : 3 : 4 : 2 that
 * `UPGRADE_MIX` states, and the only thing a location's own entry decides is how big the order is.
 *
 * Worth holding because it is the kind of rule that rots quietly. A kind added later with a
 * hand-written bundle, or a mix edited to five numbers that no longer sum to a hundred, reads
 * perfectly well and would never fail a test that only checked that upgrades get dearer.
 */
describe('what every upgrade is made of', () => {
  /** The percentages the maintainer asked for, written out rather than read off `UPGRADE_MIX`. */
  const SHARE = {
    planks: 0.5,
    highQualityMetal: 0.05,
    scrap: 0.15,
    oil: 0.2,
    caps: 0.1,
  } as const;

  it('is the ratio the mix claims, and the ratio adds up to the whole order', () => {
    expect(UPGRADE_MIX).toEqual({
      planks: 1,
      highQualityMetal: 0.1,
      scrap: 0.3,
      oil: 0.4,
      caps: 0.2,
    });
    const parts = Object.values(UPGRADE_MIX).reduce((sum, share) => sum + share, 0);
    for (const [key, share] of Object.entries(SHARE)) {
      expect(UPGRADE_MIX[key as keyof typeof UPGRADE_MIX] / parts, key).toBeCloseTo(share, 10);
    }
  });

  it('bills every kind at every level in that ratio, and in nothing else', () => {
    for (const kind of LOCATION_KINDS) {
      for (let level = 1; level < MAX_LOCATION_LEVEL; level += 1) {
        const cost = upgradeCost(kind, level);
        if (!cost) throw new Error(`${kind} @${level} has no price`);
        // Five channels, always the same five. Supplies fed nine of the old bundles and are gone.
        expect(Object.keys(cost).sort(), `${kind} @${level}`).toEqual(
          ['caps', 'highQualityMetal', 'oil', 'planks', 'scrap'].sort(),
        );
        expect(cost.supplies, `${kind} @${level}`).toBeUndefined();
        const planks = cost.planks ?? 0;
        for (const [key, share] of Object.entries(UPGRADE_MIX)) {
          const amount = cost[key as keyof typeof cost] ?? 0;
          // Within a unit of the ratio: every channel is rounded, and the scarce one is floored
          // at 1 so that no order can quietly stop mentioning a material.
          expect(Math.abs(amount - planks * share), `${kind} @${level} ${key}`).toBeLessThanOrEqual(
            1,
          );
          expect(amount, `${kind} @${level} ${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  /**
   * The anchors the maintainer set: about 100 planks for a first upgrade, about 500 for the
   * dearest kind's, and a final level that runs to roughly five figures.
   *
   * Bounds rather than exact numbers, because the point is the shape of the ladder and not any
   * one kind's entry. A kind priced at 5 planks or at 5,000 would be a typo that every other
   * test in this file would wave through.
   */
  it('opens where the maintainer put it and tops out five figures up', () => {
    const opening = LOCATION_KINDS.map((kind) => upgradeCost(kind, 1)?.planks ?? 0);
    expect(Math.min(...opening)).toBeGreaterThanOrEqual(60);
    expect(Math.max(...opening)).toBeLessThanOrEqual(600);

    const final = LOCATION_KINDS.map(
      (kind) => upgradeCost(kind, MAX_LOCATION_LEVEL - 1)?.planks ?? 0,
    );
    expect(Math.min(...final)).toBeGreaterThan(2_000);
    expect(Math.max(...final)).toBeLessThan(20_000);
    // A dearer kind is dearer the whole way up, which is what makes the single mix safe: the
    // catalogue's own spread is the only thing separating a Pawn Shop from a Construction Site.
    expect(Math.max(...final) / Math.min(...final)).toBeCloseTo(
      Math.max(...opening) / Math.min(...opening),
      1,
    );
  });

  /**
   * Storage is the quiet ceiling on all of this.
   *
   * An order a maxed district cannot physically hold is an order nobody can ever place, and the
   * shelf is not one number: planks get the whole bulk shelf and high-quality metal a third of
   * it, so the scarce channel can bind first even at a tenth of the timber.
   */
  it('asks for nothing a fully built district cannot hold', () => {
    const maxed = BUILDING_KINDS.map((kind) => ({
      id: kind,
      kind,
      level: levelCeilingFor(kind),
      modifications: [] as string[],
    }));
    const dearest = LOCATION_KINDS.reduce((worst, kind) =>
      (upgradeCost(kind, MAX_LOCATION_LEVEL - 1)?.planks ?? 0) >
      (upgradeCost(worst, MAX_LOCATION_LEVEL - 1)?.planks ?? 0)
        ? kind
        : worst,
    );
    const cost = upgradeCost(dearest, MAX_LOCATION_LEVEL - 1);
    if (!cost) throw new Error('the dearest kind has no top price');
    for (const key of ['planks', 'scrap', 'oil', 'highQualityMetal'] as const) {
      expect(cost[key] ?? 0, `${dearest} ${key}`).toBeLessThanOrEqual(
        storageCapacityFor(maxed, key),
      );
    }
  });
});
