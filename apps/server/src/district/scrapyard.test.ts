import {
  MODIFICATIONS,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  addonsOf,
  findModification,
  findUpgrade,
  isAdvancedModification,
  modificationPrice,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type Building,
  type Resources,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { buildAddon, projectScrapyard } from './scrapyard.js';

/**
 * The Scrapyard's page (§B9).
 *
 * The load-bearing claims are the two the board stated as rules rather than as content: **nothing
 * but scrap and high-quality metal ever appears on this page**, and **most entries want a
 * blueprint first**. Both are properties of the whole catalogue rather than of any one entry, so
 * both are asserted across it.
 */

const dbs: AppDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));

const NOW = new Date('2026-08-20T09:00:00.000Z');

const RICH: Resources = {
  caps: 500_000,
  supplies: 500_000,
  oil: 500_000,
  scrap: 500_000,
  highQualityMetal: 500_000,
  planks: 500_000,
};

const build = (kind: Building['kind'], level: number): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications: [],
  damage: 0,
  fortification: 0,
});

function openStack(): Repositories {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return createRepositories(db);
}

function seedBase(repos: Repositories, over: Partial<Base> = {}): Base {
  repos.users.insert({
    id: 'user-1',
    username: 'Yardhand',
    passwordHash: 'x',
    createdAt: NOW.toISOString(),
  });
  const base: Base = {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'The Cutting Floor',
    districtId: 'neon-docks',
    level: 5,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: startingEconomy(NOW.toISOString()),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [build('nexus', 6), build('scrapyard', 4)],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(NOW.toISOString()),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: NOW.toISOString(),
    ...over,
  };
  repos.bases.insert(base);
  return base;
}

describe('§B9: the Scrapyard builds add-ons', () => {
  it('prices every entry in scrap, and in nothing but scrap and metal', () => {
    const repos = openStack();
    const { entries } = projectScrapyard(seedBase(repos, { resources: RICH }));
    expect(entries.length).toBe(MODIFICATIONS.length + 9);

    for (const entry of entries) {
      expect(entry.cost.scrap ?? 0, entry.id).toBeGreaterThan(0);
      for (const key of RESOURCE_KEYS) {
        if (key === 'scrap' || key === 'highQualityMetal') continue;
        expect(entry.cost[key], `${entry.id} charges ${key}`).toBeUndefined();
      }
      // And metal is the advanced entries' tax, on both halves of the catalogue.
      expect((entry.cost.highQualityMetal ?? 0) > 0, `${entry.id} metal vs advanced`).toBe(
        entry.advanced,
      );
    }
  });

  it('wants a blueprint for most of what it sells, and not for all of it', () => {
    const repos = openStack();
    const { entries } = projectScrapyard(seedBase(repos, { resources: RICH }));
    const wanting = entries.filter((entry) => entry.blueprint !== null);
    expect(wanting.length).toBeGreaterThan(entries.length / 2);
    expect(wanting.length).toBeLessThan(entries.length);

    /*
     * Anchored on two named entries, not on the threshold constant.
     *
     * "Most of them are advanced" is true of *any* threshold that lands in the middle of the
     * catalogue, and `advanced` decides both the blueprint and the metal, so a test that reads
     * either back off the other agrees with whatever the constant is set to. A Grid Priority Bus
     * is 8 points of build time and is a bolt-on; an Encrypted Core is 12 and is engineering.
     */
    const find = (id: string) => entries.find((entry) => entry.id === id);
    expect(find('nexus_priority_bus')?.advanced).toBe(false);
    expect(find('nexus_priority_bus')?.blueprint).toBeNull();
    expect(find('nexus_priority_bus')?.cost.highQualityMetal).toBeUndefined();
    expect(find('nexus_encrypted_core')?.advanced).toBe(true);
    expect(find('nexus_encrypted_core')?.blueprint).not.toBeNull();
    expect(find('nexus_encrypted_core')?.cost.highQualityMetal ?? 0).toBeGreaterThan(0);
  });

  it('refuses an advanced add-on the Lab has not drawn, and builds it once it has', () => {
    const repos = openStack();
    const advanced = MODIFICATIONS.find(isAdvancedModification);
    expect(advanced).toBeDefined();
    if (!advanced) return;

    const bare = seedBase(repos, { resources: RICH });
    const refused = buildAddon(repos, bare, 'modification', advanced.id);
    expect(refused.kind).toBe('refused');

    const drawn: Base = { ...bare, addons: { researched: [advanced.id], built: [] } };
    const built = buildAddon(repos, drawn, 'modification', advanced.id);
    expect(built.kind).toBe('built');
    if (built.kind !== 'built') return;
    expect(addonsOf(built.base).built).toEqual([advanced.id]);
    expect(built.base.resources.scrap).toBe(RICH.scrap - (modificationPrice(advanced).scrap ?? 0));
    expect(built.base.resources.highQualityMetal).toBe(
      RICH.highQualityMetal - (modificationPrice(advanced).highQualityMetal ?? 0),
    );
    // ...and it is on disk, not only in the returned object.
    expect(addonsOf(repos.bases.findById(bare.id)!).built).toEqual([advanced.id]);
  });

  it('refuses everything until the Scrapyard is standing', () => {
    const repos = openStack();
    const noYard = seedBase(repos, {
      resources: RICH,
      buildings: [build('nexus', 6)],
    });
    const basic = MODIFICATIONS.find((spec) => !isAdvancedModification(spec));
    expect(basic).toBeDefined();
    if (!basic) return;
    const result = buildAddon(repos, noYard, 'modification', basic.id);
    expect(result).toEqual({ kind: 'refused', reason: 'Build the Scrapyard first' });
  });

  it('builds a unit upgrade into the roster’s own stock rather than onto a shelf', () => {
    const repos = openStack();
    const tierOne = findUpgrade('armour_1');
    expect(tierOne).toBeDefined();
    if (!tierOne) return;

    const base = seedBase(repos, {
      resources: RICH,
      buildings: [build('nexus', 6), build('scrapyard', 4), build('gauntlet', 6)],
    });
    const built = buildAddon(repos, base, 'upgrade', tierOne.id);
    expect(built.kind).toBe('built');
    if (built.kind !== 'built') return;
    expect(built.base.fittedUpgrades).toEqual([tierOne.id]);
    expect(buildAddon(repos, built.base, 'upgrade', tierOne.id)).toEqual({
      kind: 'refused',
      reason: 'Already built',
    });
  });

  it('names a modification the catalogue does not know rather than throwing', () => {
    const repos = openStack();
    const base = seedBase(repos, { resources: RICH });
    expect(findModification('scrapyard_nothing')).toBeUndefined();
    expect(buildAddon(repos, base, 'modification', 'scrapyard_nothing')).toEqual({
      kind: 'refused',
      reason: 'No such add-on',
    });
  });
});
