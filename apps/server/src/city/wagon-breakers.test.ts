import {
  COMPONENT_BREAKDOWN,
  ITEM_CATALOG,
  STARTING_RESOURCES,
  featMeasureKey,
  findUnit,
  isUnitUnlocked,
  missingRequirements,
  describeRequirement,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type Building,
  type ItemId,
  type PartialResources,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { breakDownComponent } from '../district/scrapyard.js';
import { unlockContextFor } from '../units/muster.js';
import { grantDaily } from './daily.js';

/**
 * The Marshalling Yards, batch 7 (maintainer, 2026-10-09): the Wagon Breakers' daily parts, the
 * Scrapyard's breakdown press, and Box Nine and the Mess Room as the doors to Snipers and Breakers.
 */

const HOUR = '2026-09-01T12:00:00.000Z';
const NOW = new Date(HOUR);
const DAY = '2026-09-01';

function stack(buildings: Building[] = []): { repos: Repositories; base: Base } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const repos = createRepositories(db);
  repos.users.insert({ id: 'u', username: 'holder', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Yard',
    districtId: 'south-quay',
    level: 20,
    isBot: false,
    resources: { ...STARTING_RESOURCES },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'nexus', kind: 'nexus', level: 10, modifications: [] }, ...buildings],
    buildQueue: [],
    army: {},
    musterQueue: [],
    training: startingTraining(HOUR),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: HOUR,
  };
  repos.bases.insert(base);
  return { repos, base };
}

function take(repos: Repositories, baseId: string, locationId: string, level = 1): void {
  const control = repos.city.control(locationId)!;
  repos.city.put({ ...control, holder: { kind: 'crew', baseId }, level, garrison: {} });
}

const WAGONS = 'marshalling-yards-breakers';

describe('the Wagon Breakers', () => {
  it('delivers a count and a rarity the level fixes, the same on a re-read', () => {
    const expected = [
      [1, 'basic'],
      [1, 'intricate'],
      [2, 'intricate'],
      [2, 'advanced'],
      [3, 'advanced'],
    ] as const;
    for (const [index, [count, rarity]] of expected.entries()) {
      const { repos, base } = stack();
      take(repos, base.id, WAGONS, index + 1);
      const grant = grantDaily(repos, base, DAY, NOW)!;
      expect(grant.components, `level ${index + 1}`).toHaveLength(count);
      for (const id of grant.components) expect(ITEM_CATALOG[id].rarity).toBe(rarity);
      // Seeded on the crew and the day: a second crew with the same id on the same day gets the
      // same parts, so a pay that is retried after a crash is the pay that crashed.
      const again = stack();
      take(again.repos, again.base.id, WAGONS, index + 1);
      expect(grantDaily(again.repos, again.base, DAY, NOW)!.components).toEqual(grant.components);
    }
  });

  it('lands in the bin, names the ground on the notice, and counts for the feats', () => {
    const { repos, base } = stack();
    take(repos, base.id, WAGONS, 3);
    const grant = grantDaily(repos, base, DAY, NOW)!;
    const after = repos.bases.findById(base.id)!;
    for (const id of grant.components) expect(after.inventory[id] ?? 0).toBeGreaterThan(0);
    expect(grant.componentsFrom).toEqual(['The Wagon Breakers', 'The Wagon Breakers']);
    expect(repos.social.notifications('u', 10)[0]?.body).toContain('from The Wagon Breakers');
    expect(repos.feats.tallies(base.id)[featMeasureKey('components_delivered')]).toBe(2);
  });
});

describe('breaking a component down', () => {
  const YARD: Building = { id: 'yard', kind: 'scrapyard', level: 1, modifications: [] };

  it('pays HQ metal and scrap by the part`s rarity, and takes the part', () => {
    for (const [id, rarity] of [
      ['scrap_servo', 'basic'],
      ['hydraulic_ram', 'intricate'],
      ['neural_shunt', 'advanced'],
      ['rotor_hub', 'masterpiece'],
    ] as const) {
      const { repos, base } = stack([YARD]);
      // Empty metal and scrap shelves, so the yield is measured rather than lost over a full store.
      repos.bases.updateHoldings(
        base.id,
        { ...base.resources, scrap: 0, highQualityMetal: 0 },
        { [id]: 2 },
      );
      const held = repos.bases.findById(base.id)!;
      const result = breakDownComponent(repos, held, id, NOW);
      expect(result.kind, id).toBe('built');
      const after = repos.bases.findById(base.id)!;
      const gain = COMPONENT_BREAKDOWN[rarity];
      expect(ITEM_CATALOG[id as ItemId].rarity).toBe(rarity);
      expect(after.inventory[id]).toBe(1);
      expect(after.resources.highQualityMetal - held.resources.highQualityMetal).toBe(
        gain.highQualityMetal,
      );
      expect(after.resources.scrap - held.resources.scrap).toBe(gain.scrap);
      expect(repos.feats.tallies(base.id)[featMeasureKey('components_broken_down')]).toBe(1);
    }
  });

  it('refuses without a yard, without the part, and for anything but a component', () => {
    const bare = stack();
    expect(breakDownComponent(bare.repos, bare.base, 'scrap_servo', NOW)).toEqual({
      kind: 'refused',
      reason: 'Build the Scrapyard first',
    });
    const { repos, base } = stack([YARD]);
    expect(breakDownComponent(repos, base, 'scrap_servo', NOW)).toEqual({
      kind: 'refused',
      reason: 'There is none of that in the parts bin',
    });
    expect(breakDownComponent(repos, base, 'adrenaline_syringes', NOW)).toEqual({
      kind: 'refused',
      reason: 'Only a component can be broken down',
    });
  });

  it('rises with the rarity, and pays a little under what a part is worth', () => {
    const worth = (gain: PartialResources) =>
      (gain.highQualityMetal ?? 0) * 12 + (gain.scrap ?? 0) * 2.5;
    const rows = (['basic', 'intricate', 'advanced', 'masterpiece'] as const).map((rarity) =>
      worth(COMPONENT_BREAKDOWN[rarity]),
    );
    for (let at = 1; at < rows.length; at += 1) expect(rows[at]!).toBeGreaterThan(rows[at - 1]!);
    expect(rows).toEqual([98, 317.5, 830, 2220]);
  });
});

describe('who may train Snipers and Breakers', () => {
  it('asks for Box Nine and the Mess Room, by name, and no Live-Fire Range', () => {
    const snipers = findUnit('snipers')!;
    const breakers = findUnit('breakers')!;
    const yard: Building[] = [
      { id: 'g', kind: 'gauntlet', level: 10, modifications: [] },
      { id: 'gate', kind: 'gate', level: 10, modifications: [] },
    ];
    const { repos, base } = stack(yard);
    // The ground clauses alone: the Snipers also want their blueprint, which is not this change.
    const missing = (unit: typeof snipers) =>
      missingRequirements(unit, unlockContextFor(repos, repos.bases.findById(base.id)!))
        .filter((need) => need.kind === 'place')
        .map(describeRequirement);
    expect(missing(snipers)).toEqual(['Hold Box Nine in The Marshalling Yards']);
    expect(missing(breakers)).toEqual(['Hold The Mess Room in The Marshalling Yards']);
    expect(snipers.requires.some((need) => need.kind === 'modification')).toBe(false);

    take(repos, base.id, 'marshalling-yards-signalbox');
    take(repos, base.id, 'marshalling-yards-messroom');
    expect(missing(snipers)).toEqual([]);
    expect(missing(breakers)).toEqual([]);
    const context = unlockContextFor(repos, repos.bases.findById(base.id)!);
    // The Breakers want nothing else past the Gauntlet; the Snipers still want their document.
    expect(isUnitUnlocked(breakers, context)).toBe(true);
  });
});
