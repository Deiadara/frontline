import {
  UNIT_UPGRADES,
  MODIFICATIONS,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  addonsOf,
  blueprintForModification,
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

  /**
   * §D12f: an advanced modification wants the retrofit document *and* the Lab project.
   *
   * Both halves are asserted, and separately, because either one on its own is a gate that passes
   * this test while the other is missing entirely: a build refused for want of pages looks exactly
   * like a build refused for want of a Lab project from the outside.
   */
  it('refuses an advanced add-on until the crew holds the document and the Lab has drawn it', () => {
    const repos = openStack();
    const advanced = MODIFICATIONS.find(isAdvancedModification);
    expect(advanced).toBeDefined();
    if (!advanced) return;
    const document = blueprintForModification(advanced);
    expect(document, 'the advanced half of §D12f is not behind a document').toBeDefined();
    if (!document) return;

    const bare = seedBase(repos, { resources: RICH });
    expect(buildAddon(repos, bare, 'modification', advanced.id)).toEqual({
      kind: 'refused',
      reason: `Needs the ${document.name}`,
    });

    // The document alone is not enough: the Lab still has to draw this particular bracket.
    const read: Base = { ...bare, inventory: { [document.id]: 1 } };
    const stillRefused = buildAddon(repos, read, 'modification', advanced.id);
    expect(stillRefused.kind).toBe('refused');
    if (stillRefused.kind === 'refused') expect(stillRefused.reason).toMatch(/Lab/);

    // And the Lab project alone is not enough either.
    const drawnOnly: Base = { ...bare, addons: { researched: [advanced.id], built: [] } };
    expect(buildAddon(repos, drawnOnly, 'modification', advanced.id)).toEqual({
      kind: 'refused',
      reason: `Needs the ${document.name}`,
    });

    const drawn: Base = {
      ...bare,
      inventory: { [document.id]: 1 },
      addons: { researched: [advanced.id], built: [] },
    };
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

  /**
   * §D12g: the yard is the Workshop's second door, and it has to hold the same document gate.
   *
   * Tier one is the control. Both rungs are built by the same route with the same crew, so a build
   * that refused everything would pass the first half of this test and fail the second.
   */
  it('refuses a refit past the first rung until its document is in the satchel', () => {
    const repos = openStack();
    const tall: Partial<Base> = {
      resources: RICH,
      buildings: [build('nexus', 6), build('scrapyard', 4), build('gauntlet', 20)],
      inventory: { ceramic_plate: 20 },
    };

    const base = seedBase(repos, tall);
    const one = buildAddon(repos, base, 'upgrade', 'armour_1');
    expect(one.kind, 'the open rung is gated too').toBe('built');
    if (one.kind !== 'built') return;

    const refused = buildAddon(repos, one.base, 'upgrade', 'armour_2');
    expect(refused).toEqual({ kind: 'refused', reason: 'Needs the Composite Armour Blueprint' });

    const read: Base = {
      ...one.base,
      inventory: { ...one.base.inventory, bp_composite_armour: 1 },
    };
    expect(buildAddon(repos, read, 'upgrade', 'armour_2').kind).toBe('built');
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

/**
 * The Scrapyard is a second door to the Workshop's upgrades, and it has to charge the same parts.
 *
 * Both write the same `fittedUpgrades` column, which is a permanent, roster-wide effect. The
 * Workshop requires the crew to hold `spec.parts` and consumes them; the Scrapyard checked neither
 * and removed nothing, so `POST /scrapyard/build {"kind":"upgrade","id":"armour_2"}` bought the
 * same upgrade with the four ceramic plates still in the satchel, and the Workshop's refusal for
 * exactly that upgrade became advice rather than a rule.
 *
 * The resource prices are deliberately different and stay different: the board specified the
 * Scrapyard as scrap and sometimes high-quality metal. It is the *parts*, a designed sink, that
 * cannot have a free door beside it.
 */
describe('the Scrapyard charges the same parts the Workshop does', () => {
  const NEEDS_PARTS = UNIT_UPGRADES.find(
    (spec) => Object.keys(spec.parts).length > 0 && spec.tier === 1,
  );

  it('refuses an upgrade whose parts the crew does not hold', () => {
    if (!NEEDS_PARTS) throw new Error('fixture: no tier-1 upgrade needs parts');
    const repos = openStack();
    const base = seedBase(repos, {
      resources: {
        caps: 0,
        supplies: 0,
        oil: 0,
        scrap: 900_000,
        highQualityMetal: 90_000,
        planks: 0,
      },
      inventory: {},
      buildings: [
        { id: 'g', kind: 'gauntlet', level: 20, modifications: [], damage: 0 },
        { id: 's', kind: 'scrapyard', level: 20, modifications: [], damage: 0 },
      ],
    });

    const result = buildAddon(repos, base, 'upgrade', NEEDS_PARTS.id);
    expect(result, 'the parts were never asked for').toMatchObject({ kind: 'refused' });
    // And refused *for the parts*, not for some other clause that happens to bite first: this
    // test passed against the unfixed code until the reason was pinned, because a wrong argument
    // shape was refusing it as "No such add-on".
    if (result.kind === 'refused') expect(result.reason).toMatch(/servo|part/i);
  });

  it('consumes the parts when it does build one', () => {
    if (!NEEDS_PARTS) throw new Error('fixture: no tier-1 upgrade needs parts');
    const repos = openStack();
    const held = Object.fromEntries(
      Object.entries(NEEDS_PARTS.parts).map(([item, count]) => [item, count + 1]),
    );
    const base = seedBase(repos, {
      resources: {
        caps: 0,
        supplies: 0,
        oil: 0,
        scrap: 900_000,
        highQualityMetal: 90_000,
        planks: 0,
      },
      inventory: held,
      buildings: [
        { id: 'g', kind: 'gauntlet', level: 20, modifications: [], damage: 0 },
        { id: 's', kind: 'scrapyard', level: 20, modifications: [], damage: 0 },
      ],
    });

    const result = buildAddon(repos, base, 'upgrade', NEEDS_PARTS.id);
    expect(result).toMatchObject({ kind: 'built' });

    const after = repos.bases.findById(base.id)!;
    expect(after.fittedUpgrades).toContain(NEEDS_PARTS.id);
    // Exactly what the spec asks for, no more and no less. Asserting the leftover instead would
    // pass just as well against a build that spent the whole satchel.
    for (const [item, count] of Object.entries(NEEDS_PARTS.parts)) {
      const key = item as keyof typeof after.inventory;
      const spent = (held[item] ?? 0) - (after.inventory[key] ?? 0);
      expect(spent, `${item} was not spent`).toBe(count);
    }
  });
});
