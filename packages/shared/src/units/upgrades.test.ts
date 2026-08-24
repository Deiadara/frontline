import { describe, expect, it } from 'vitest';
import {
  MAX_PER_VEHICLE,
  VEHICLES,
  fleetTravelSpeedPercent,
  vehicleRefusal,
} from '../building/vehicles.js';
import { ITEM_CATALOG } from '../items/catalog.js';
import {
  UNIT_UPGRADES,
  UPGRADE_LINES,
  UPGRADE_LINE_BLUEPRINT,
  UPGRADE_MAX_TIER,
  upgradeRefusal,
  upgradedStats,
  upgradesInLine,
} from './upgrades.js';
import { UNIT_CATALOG } from './catalog.js';
import { UNIT_STAT_KEYS } from './stats.js';

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

  it('names a real blueprint for every line, and a real part in every recipe', () => {
    for (const line of UPGRADE_LINES) {
      expect(ITEM_CATALOG[UPGRADE_LINE_BLUEPRINT[line]].kind, line).toBe('blueprint');
    }
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

  it('takes the first rung with nothing but a Gauntlet and the money', () => {
    expect(upgradeRefusal(one.id, [], one.requiresGauntletLevel, NO, YES, YES)).toBeNull();
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
    expect(upgradeRefusal(two.id, [one.id], 99, NO, NO, YES)).toBe('needs_blueprint');
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
    expect(both.lethality).toBe(razors.stats.lethality + (weapons.effect.lethality ?? 0));
  });

  /** Armour is meant to cost speed. A fold that only ever added would quietly drop the tradeoff. */
  it('applies a penalty as a penalty', () => {
    const [armour] = upgradesInLine('armour');
    if (!armour) throw new Error('expected a rung');
    expect(armour.effect.speed ?? 0).toBeLessThan(0);
    expect(upgradedStats(razors.stats, [armour.id]).speed).toBeLessThan(razors.stats.speed);
  });

  it('keeps the bounded stats inside their range', () => {
    const maxed = { ...razors.stats, vitality: 99, armor: 99, speed: 1 };
    const all = upgradedStats(
      maxed,
      UNIT_UPGRADES.map((spec) => spec.id),
    );
    for (const key of UNIT_STAT_KEYS) {
      expect(all[key], key).toBeGreaterThanOrEqual(0);
      if (key !== 'lootCapacity' && key !== 'range') expect(all[key], key).toBeLessThanOrEqual(100);
    }
  });

  it('ignores an upgrade id it does not recognise rather than throwing', () => {
    expect(upgradedStats(razors.stats, ['nonsense'])).toEqual(razors.stats);
  });
});

describe('the yard', () => {
  it('is worth nothing empty', () => {
    expect(fleetTravelSpeedPercent({})).toBe(0);
  });

  it('pays less for each additional machine of a kind', () => {
    const one = fleetTravelSpeedPercent({ motorcycle: 1 });
    const two = fleetTravelSpeedPercent({ motorcycle: 2 });
    const three = fleetTravelSpeedPercent({ motorcycle: 3 });
    expect(two - one).toBeGreaterThan(0);
    expect(three - two).toBeLessThan(two - one);
  });

  it('caps each line however many are parked', () => {
    for (const spec of VEHICLES) {
      const full = fleetTravelSpeedPercent({ [spec.id]: 99 });
      expect(full, spec.id).toBeLessThanOrEqual(
        VEHICLES.reduce((total, other) => total + other.maxTravelSpeedPercent, 0),
      );
      expect(fleetTravelSpeedPercent({ [spec.id]: 99 }), spec.id).toBeLessThanOrEqual(
        spec.maxTravelSpeedPercent,
      );
    }
  });

  it('adds the two lines together', () => {
    const both = fleetTravelSpeedPercent({ motorcycle: 2, rotorcraft: 1 });
    expect(both).toBeGreaterThan(fleetTravelSpeedPercent({ motorcycle: 2 }));
    expect(both).toBeGreaterThan(fleetTravelSpeedPercent({ rotorcraft: 1 }));
  });

  describe('building one', () => {
    it('lets a Garage-owning crew lay down a motorcycle', () => {
      expect(vehicleRefusal('motorcycle', {}, 2, NO, YES, YES)).toBeNull();
    });

    it('will not build a rotorcraft without the blueprint, whatever the Garage is at', () => {
      expect(vehicleRefusal('rotorcraft', {}, 99, NO, YES, YES)).toBe('needs_blueprint');
    });

    it('refuses on the Garage, the money and the parts in that order', () => {
      expect(vehicleRefusal('rotorcraft', {}, 1, YES, YES, YES)).toBe('garage_too_low');
      expect(vehicleRefusal('motorcycle', {}, 9, YES, NO, YES)).toBe('cannot_afford');
      expect(vehicleRefusal('motorcycle', {}, 9, YES, YES, NO)).toBe('missing_parts');
    });

    it('stops at a full yard', () => {
      expect(vehicleRefusal('motorcycle', { motorcycle: MAX_PER_VEHICLE }, 9, YES, YES, YES)).toBe(
        'fleet_full',
      );
    });
  });
});
