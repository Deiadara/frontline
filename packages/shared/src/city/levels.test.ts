import { describe, expect, it } from 'vitest';
import { RESOURCE_KEYS } from '../resources.js';
import { CITY_DISTRICTS, CONTESTED_DISTRICTS, RESIDENTIAL_DISTRICTS } from './districts.js';
import {
  LEVEL_SCALE,
  LOCATION_CATALOG,
  LOCATION_KINDS,
  MAX_LOCATION_LEVEL,
  bonusesAt,
  clampLevel,
  describeHoldBonus,
  upgradeCost,
  upgradeNote,
} from './locations.js';

/**
 * Levels (§A4) — the board-game half of a location.
 *
 * A location is a post you take, work up, and lose. The three properties that makes interesting
 * are all measured here: an upgrade is always worth something, an upgrade always costs more than
 * the last one, and **a capture puts it back to 1**, so nobody inherits the previous holder's
 * work. The last of those is enforced where captures happen (`apps/server/src/battle/`), and what
 * this file pins is the arithmetic it resets *to*.
 */

describe('a location at a level', () => {
  it('keeps a level inside the scale, whatever it is handed', () => {
    expect(clampLevel(0)).toBe(1);
    expect(clampLevel(1)).toBe(1);
    expect(clampLevel(99)).toBe(MAX_LOCATION_LEVEL);
    expect(clampLevel(2.7)).toBe(2);
  });

  it('has a scale entry for every level and starts at exactly its authored value', () => {
    expect(LEVEL_SCALE).toHaveLength(MAX_LOCATION_LEVEL);
    expect(LEVEL_SCALE[0]).toBe(1);
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
                : 'amount' in bonus
                  ? bonus.amount
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

  it('is worth about two and a half times as much fully worked as fresh', () => {
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
  it('prices three upgrades and refuses a fourth', () => {
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
      // Three different things, not the same sentence three times.
      expect(new Set(LOCATION_CATALOG[kind].upgrades).size, kind).toBe(MAX_LOCATION_LEVEL - 1);
    }
  });
});

describe('the city as a board', () => {
  it('is three districts a crew can live in and seven to fight over', () => {
    expect(RESIDENTIAL_DISTRICTS).toHaveLength(3);
    expect(CONTESTED_DISTRICTS).toHaveLength(7);
    expect(CITY_DISTRICTS).toHaveLength(10);
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
