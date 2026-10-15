import {
  STARTING_RESOURCES,
  findDistrict,
  findUnit,
  homeMusterSource,
  isUnitUnlocked,
  missingRequirements,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type Building,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { heldLocationLevels, unlockContextFor } from '../units/muster.js';
import { projectDistrict } from './view.js';

/**
 * Batch 9 (maintainer, 2026-10-09): the Hump, the Mess Room and the Crated Yard no longer open
 * what ground like them opens, and the Kennels open the Cyberhounds by name.
 */

const HOUR = '2026-09-01T12:00:00.000Z';
const NOW = new Date(HOUR);

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

const ALL_BUILT: Building[] = [
  'gauntlet',
  'gate',
  'garage',
  'generator',
  'infirmary',
  'lab',
  'scrapyard',
].map((kind) => ({ id: kind, kind: kind as Building['kind'], level: 20, modifications: [] }));

const opensUp = (repos: Repositories, base: Base, districtId: string, locationId: string) =>
  projectDistrict(repos, base, findDistrict(districtId)!, NOW).locations.find(
    (one) => one.location.id === locationId,
  )!.unlocks;

describe('ground that stopped opening what others like it open', () => {
  it('opens nothing it is not named for, on the gate and on the sheet', () => {
    for (const [districtId, id, others] of [
      ['marshalling-yards', 'marshalling-yards-hump', 'the_loose_end'],
      ['marshalling-yards', 'marshalling-yards-messroom', null],
      ['bonded-row', 'bonded-row-crated', 'the_colossus'],
    ] as const) {
      const { repos, base } = stack(ALL_BUILT);
      take(repos, base.id, id, 5);
      const context = unlockContextFor(repos, repos.bases.findById(base.id)!);
      // The Hauler Yard still opens the Loose End and the scaffolds the Colossus; these do not.
      if (others !== null) {
        const unit = findUnit(others)!;
        expect(
          missingRequirements(unit, context).some((need) => need.kind === 'location'),
          id,
        ).toBe(true);
        expect(homeMusterSource(unit, heldLocationLevels(repos, base)), id).toBeNull();
      }
      // Nothing that names other ground is on its sheet; the Mess Room still names the Breakers.
      const sheet = opensUp(repos, base, districtId, id);
      expect(sheet, id).toEqual(id === 'marshalling-yards-messroom' ? ['Breakers'] : []);
    }
  });

  it('leaves the Cartographer and the Loose End to other ground', () => {
    const { repos, base } = stack(ALL_BUILT);
    take(repos, base.id, 'marshalling-yards-hump', 5);
    const cartographer = findUnit('the_cartographer')!;
    const context = unlockContextFor(repos, repos.bases.findById(base.id)!);
    expect(isUnitUnlocked(findUnit('the_loose_end')!, context)).toBe(false);
    expect(isUnitUnlocked(cartographer, context)).toBe(false);
  });
});

describe('the Kennels', () => {
  it('open the Cyberhounds by name, once on the sheet', () => {
    const { repos, base } = stack(ALL_BUILT);
    const dogs = findUnit('cyber_dogs')!;
    expect(
      unlockContextFor(repos, repos.bases.findById(base.id)!).heldPlaces.has('bonded-row-kennels'),
    ).toBe(false);
    take(repos, base.id, 'bonded-row-kennels', 1);
    const context = unlockContextFor(repos, repos.bases.findById(base.id)!);
    expect(context.heldPlaces.has('bonded-row-kennels')).toBe(true);
    // The ground clauses met; the Cyberhounds' document and rank are not this change.
    expect(
      missingRequirements(dogs, context).filter(
        (need) => need.kind === 'place' || need.kind === 'building',
      ),
    ).toEqual([]);
    expect(opensUp(repos, base, 'bonded-row', 'bonded-row-kennels')).toEqual([dogs.name]);
  });
});
