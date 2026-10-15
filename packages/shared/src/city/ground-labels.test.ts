import { describe, expect, it } from 'vitest';
import { battlefieldFor } from '../battle/battlefield.js';
import { findLocation } from './atlas.js';
import type { LocationControl } from './control.js';
import { lampsOver, locationGroundLabels, withLamps } from './ground-labels.js';
import { envLabel, mergeLabels } from './labels.js';
import { bonusesAt, describeHoldBonus, lampsReach } from './locations.js';
import { weatherAt, weatherLabels } from './weather.js';

/**
 * Lampman's Row and the one place a location's ground is worked out (maintainer, 2026-10-09).
 */

const ROW = 'ironmouth-lampman';
const NOW = new Date('2026-10-09T12:00:00.000Z');

const at = (id: string) => {
  const location = findLocation(id);
  expect(location, id).toBeDefined();
  return location!;
};

function controlled(level: number, lit: boolean, crew = true): Map<string, LocationControl> {
  return new Map([
    [
      ROW,
      {
        locationId: ROW,
        holder: crew ? { kind: 'crew', baseId: 'keeper' } : { kind: 'looters' },
        level,
        upgradingUntil: null,
        garrison: {},
        switchedOn: !lit,
        switchedAt: null,
      },
    ],
  ]);
}

describe('what the lamps do to a list of labels', () => {
  it('lowers Dark and Foggy when lit, and a label brought to nothing is gone', () => {
    const labels = [envLabel('dark', 3), envLabel('foggy', 1), envLabel('wet', 2)];
    expect(withLamps(labels, { lit: true, tiers: 2 })).toEqual([
      envLabel('dark', 1),
      envLabel('wet', 2),
    ]);
  });

  it('raises them when out, adds them at the reach where absent, and stops at IV', () => {
    expect(withLamps([envLabel('dark', 3)], { lit: false, tiers: 2 })).toEqual([
      envLabel('dark', 4),
      envLabel('foggy', 2),
    ]);
    expect(withLamps([], { lit: false, tiers: 4 })).toEqual([
      envLabel('dark', 4),
      envLabel('foggy', 4),
    ]);
  });

  it('reaches a tier a level, and the whole city four tiers at level 5', () => {
    expect([1, 2, 3, 4, 5].map(lampsReach)).toEqual([
      { tiers: 1, wholeCity: false },
      { tiers: 2, wholeCity: false },
      { tiers: 3, wholeCity: false },
      { tiers: 4, wholeCity: false },
      { tiers: 4, wholeCity: true },
    ]);
    expect(describeHoldBonus(bonusesAt(at(ROW), 1)[0]!)).toContain('district');
    expect(describeHoldBonus(bonusesAt(at(ROW), 5)[0]!)).toContain('city');
  });
});

describe('the ground a location is had on', () => {
  const plain = (id: string) => mergeLabels(at(id).labels, weatherLabels(weatherAt(NOW)));

  it('is its own ground and the sky while nobody keeps the lamps', () => {
    expect(locationGroundLabels(at('ironmouth-shafts'), NOW, new Map())).toEqual(
      plain('ironmouth-shafts'),
    );
    expect(lampsOver(at('ironmouth-shafts'), controlled(3, false, false))).toEqual([]);
  });

  it('carries the lamps over the row`s district below level 5, and nowhere else', () => {
    const out = controlled(2, false);
    expect(locationGroundLabels(at('ironmouth-shafts'), NOW, out)).toEqual(
      withLamps(plain('ironmouth-shafts'), { lit: false, tiers: 2 }),
    );
    expect(locationGroundLabels(at('blockhouse-officershalt'), NOW, out)).toEqual(
      plain('blockhouse-officershalt'),
    );
  });

  it('carries them over the whole city at level 5, and not over another city', () => {
    const out = controlled(5, false);
    const far = locationGroundLabels(at('blockhouse-officershalt'), NOW, out);
    expect(far.filter((label) => label.id === 'dark' || label.id === 'foggy')).toEqual([
      envLabel('dark', 4),
      envLabel('foggy', 4),
    ]);
    const ashfall = at('steelbelt-ramp');
    expect(locationGroundLabels(ashfall, NOW, out)).toEqual(plain('steelbelt-ramp'));
  });

  it('is the ground the fight reads its dark and its frontage off', () => {
    const lit = controlled(4, true);
    const labels = locationGroundLabels(at('ironmouth-shafts'), NOW, lit);
    const field = battlefieldFor({
      locationName: 'The Ventilation Shafts',
      ground: at('ironmouth-shafts'),
      at: NOW,
      labels,
    });
    expect(field.labels).toEqual(labels);
    // Any Dark less four tiers is no Dark at all, so the shafts stop fighting as unlit ground.
    expect(labels.some((label) => label.id === 'dark')).toBe(false);
    expect(field.contexts).not.toContain('dark');
  });
});
