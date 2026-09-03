import { describe, expect, it } from 'vitest';
import { RESOURCE_KEYS } from '../resources.js';
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

    // And the three upgrades it used to have cost exactly what they used to cost.
    expect(upgradeCost('gas_station', 1)).toEqual({ caps: 260, scrap: 120, planks: 70 });
    expect(upgradeCost('gas_station', 2)).toEqual({ caps: 572, scrap: 264, planks: 154 });
    expect(upgradeCost('gas_station', 3)).toEqual({ caps: 1170, scrap: 540, planks: 315 });
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
              : bonus.perHour;
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
                    : bonus.percent;
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
   * The board asked for this by name: an upgrade has to *say what it is*.
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
