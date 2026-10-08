import { describe, expect, it } from 'vitest';
import { EVERY_LOCATION, findDistrict } from './atlas.js';
import {
  districtHolder,
  districtWholeFor,
  territoryEffectsFor,
  tollingTowerNoise,
  wholeHolderAmong,
  type LocationControl,
  type LocationHolder,
} from './control.js';
import { NOISE_SWITCH_TIER } from './arca.js';

/**
 * Holding a district as a faction (maintainer ruling, 2026-10-07): the members together must
 * hold every location; then every member is paid the unified bonus, the gate is armed, and the
 * member holding the most of it answers for the gate.
 */

const printworks = findDistrict('printworks')!;
const saintsRest = findDistrict('saints-rest')!;
const bellfounders = findDistrict('bellfounders')!;

function crew(baseId: string): LocationHolder {
  return { kind: 'crew', baseId };
}

/** Every location of a district held by the holder each id maps to, in map order. */
function controlsOf(
  district: typeof printworks,
  holders: readonly LocationHolder[],
  extra: Partial<LocationControl> = {},
): Map<string, LocationControl> {
  return new Map(
    district.locations.map((location, index) => [
      location.id,
      {
        locationId: location.id,
        holder: holders[index] ?? { kind: 'unoccupied' as const },
        level: 1,
        upgradingUntil: null,
        garrison: {},
        ...extra,
      },
    ]),
  );
}

const table = (baseId: string) => (baseId === 'c' ? 'other' : 'wolves');
const joined = (baseId: string) =>
  ({ a: '2026-01-01', b: '2026-02-01', c: '2026-03-01' })[baseId] ?? '';

describe('districtWholeFor', () => {
  it('is whole for a set holding every location between them, and not for a subset', () => {
    const controls = controlsOf(printworks, [
      ...Array<LocationHolder>(4).fill(crew('a')),
      ...Array<LocationHolder>(3).fill(crew('b')),
    ]);
    expect(districtWholeFor(printworks, controls, new Set(['a', 'b']))).toBe(true);
    expect(districtWholeFor(printworks, controls, new Set(['a']))).toBe(false);
    // The single-holder reading stays what it was: two crews is nobody.
    expect(districtHolder(printworks, controls)).toBeNull();
  });
});

describe('wholeHolderAmong', () => {
  it('names the member holding the most locations of a district held by one table', () => {
    const controls = controlsOf(printworks, [
      ...Array<LocationHolder>(4).fill(crew('a')),
      ...Array<LocationHolder>(3).fill(crew('b')),
    ]);
    expect(wholeHolderAmong(printworks, controls, table, joined)).toEqual(crew('a'));
  });

  it('answers null when the crews sit at different tables, or one sits at none', () => {
    const controls = controlsOf(printworks, [
      ...Array<LocationHolder>(4).fill(crew('a')),
      ...Array<LocationHolder>(3).fill(crew('c')),
    ]);
    expect(wholeHolderAmong(printworks, controls, table, joined)).toBeNull();
    expect(wholeHolderAmong(printworks, controls, () => null, joined)).toBeNull();
  });

  it('breaks a tie to the member who has held their ground the longest, then the earliest seat', () => {
    const even = [
      ...Array<LocationHolder>(4).fill(crew('a')),
      ...Array<LocationHolder>(4).fill(crew('b')),
    ];
    const controls = controlsOf(saintsRest, even);
    // Nothing recorded: b joined later than a, so a answers.
    expect(wholeHolderAmong(saintsRest, controls, table, joined)).toEqual(crew('a'));
    // b took its first plot before a took any: b has held longer and answers.
    const heldAt = (baseId: string, when: string) => {
      for (const [id, control] of controls) {
        if (control.holder.kind !== 'crew' || control.holder.baseId !== baseId) continue;
        controls.set(id, { ...control, heldSince: when });
      }
    };
    heldAt('b', '2026-05-01T00:00:00.000Z');
    heldAt('a', '2026-06-01T00:00:00.000Z');
    expect(wholeHolderAmong(saintsRest, controls, table, joined)).toEqual(crew('b'));
  });

  /*
   * Bug pass, 2026-10-07. `trophiesSince` carried two meanings: the row's capture instant, which
   * this tiebreak reads, and the moment a Trophy Hall started counting kills, which the hall
   * writes on its first kill. So a crew whose plot here was a hall held since before the column
   * existed answered for the district until it made a kill, and then stopped, because of a fight
   * that had nothing to do with this ground. The two are separate fields now.
   */
  it('is not moved by a Trophy Hall starting its tally', () => {
    const even = [
      ...Array<LocationHolder>(4).fill(crew('a')),
      ...Array<LocationHolder>(4).fill(crew('b')),
    ];
    const controls = controlsOf(saintsRest, even);
    // b's rows carry a capture instant and a's do not, which is a row from before the column: a
    // has held since the start, so a answers.
    for (const [id, control] of controls) {
      if (control.holder.kind !== 'crew' || control.holder.baseId !== 'b') continue;
      controls.set(id, { ...control, heldSince: '2026-05-01T00:00:00.000Z' });
    }
    expect(wholeHolderAmong(saintsRest, controls, table, joined)).toEqual(crew('a'));

    // A hall of a's starts counting: `trophiesSince` moves and the answer must not.
    for (const [id, control] of controls) {
      if (control.holder.kind !== 'crew' || control.holder.baseId !== 'a') continue;
      controls.set(id, { ...control, trophiesSince: '2026-09-01T00:00:00.000Z' });
    }
    expect(wholeHolderAmong(saintsRest, controls, table, joined)).toEqual(crew('a'));
  });

  it('keeps the single holder, the looters and the Combine as they were', () => {
    const looters = controlsOf(printworks, Array<LocationHolder>(7).fill({ kind: 'looters' }));
    expect(wholeHolderAmong(printworks, looters, table, joined)).toEqual({ kind: 'looters' });
    const alone = controlsOf(printworks, Array<LocationHolder>(7).fill(crew('a')));
    expect(wholeHolderAmong(printworks, alone, table, joined)).toEqual(crew('a'));
  });
});

describe('territoryEffectsFor with allies', () => {
  const split = controlsOf(printworks, [
    ...Array<LocationHolder>(4).fill(crew('a')),
    ...Array<LocationHolder>(3).fill(crew('b')),
  ]);

  it('pays the unified bonus to a member while the table holds the district whole', () => {
    const alone = territoryEffectsFor('b', EVERY_LOCATION, split);
    const together = territoryEffectsFor('b', EVERY_LOCATION, split, new Set(['a']));
    expect(alone.payrollPercent).toBe(0);
    expect(together.payrollPercent).toBe(10);
  });

  /*
   * Maintainer, 2026-10-07: "you only get the collective bonus all of you". The gate, the three
   * `districts_held_whole` feats and the whole-district combat perk already counted a member with
   * no plot in the district; the payout walked this crew's own holdings and paid them nothing.
   */
  it('pays a member who holds no plot in the district at all', () => {
    const theirs = controlsOf(printworks, Array<LocationHolder>(7).fill(crew('a')));
    const nothing = territoryEffectsFor('c', EVERY_LOCATION, theirs);
    const seated = territoryEffectsFor('c', EVERY_LOCATION, theirs, new Set(['a']));
    expect(nothing.payrollPercent).toBe(0);
    expect(seated.payrollPercent).toBe(10);
    // ...and still nothing of what the plots themselves pay, which stays with whoever holds them.
    expect(seated.perHour.oil ?? 0).toBe(0);
  });

  it("does not pay a member for a mate's own ground", () => {
    const a = territoryEffectsFor('a', EVERY_LOCATION, split, new Set(['b']));
    const b = territoryEffectsFor('b', EVERY_LOCATION, split, new Set(['a']));
    // The Boiler House's oil is a's alone; b holds the canteen, the tunnels and the tomb.
    expect(a.perHour.oil ?? 0).toBeGreaterThan(0);
    expect(b.perHour.oil ?? 0).toBe(0);
    expect(a.perHour.supplies ?? 0).toBe(0);
    expect(b.perHour.supplies ?? 0).toBeGreaterThan(0);
  });

  it('pays a whenDistrictWhole bonus only while the district is whole, by faction', () => {
    const inn = saintsRest.locations.findIndex((location) => location.id === 'saints-rest-inn');
    const holders = Array<LocationHolder>(8).fill(crew('a'));
    holders[inn] = crew('b');
    const controls = controlsOf(saintsRest, holders);
    const alone = territoryEffectsFor('b', EVERY_LOCATION, controls);
    const together = territoryEffectsFor('b', EVERY_LOCATION, controls, new Set(['a']));
    // Twenty beds for the Inn at level 1, and the same again while Saint's Rest is whole.
    expect(together.unitSlotBonus - alone.unitSlotBonus).toBe(20);
  });
});

describe('tollingTowerNoise', () => {
  const tower = bellfounders.locations.findIndex(
    (location) => location.id === 'bellfounders-tollingtower',
  );

  it('lays Noisy over the district while a held tower is switched on, and nothing otherwise', () => {
    const holders = Array<LocationHolder>(7).fill({ kind: 'looters' });
    holders[tower] = crew('a');
    const off = controlsOf(bellfounders, holders);
    expect(tollingTowerNoise(bellfounders, off)).toEqual([]);
    const on = new Map(off);
    on.set('bellfounders-tollingtower', {
      ...off.get('bellfounders-tollingtower')!,
      switchedOn: true,
    });
    expect(tollingTowerNoise(bellfounders, on)).toEqual([{ id: 'noisy', tier: NOISE_SWITCH_TIER }]);
    // A switch left on by a holder the looters took it from counts for nobody.
    on.set('bellfounders-tollingtower', {
      ...on.get('bellfounders-tollingtower')!,
      holder: { kind: 'looters' },
    });
    expect(tollingTowerNoise(bellfounders, on)).toEqual([]);
  });
});
