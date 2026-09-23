import {
  type PartialResources,
  MAX_NOTORIETY,
  ITEM_CATALOG,
  TRAP_CATALOG,
  UNIT_MODIFICATIONS,
  MODIFICATIONS,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  blueprintForModification,
  blueprintForTrap,
  blueprintForUnitUpgrade,
  findModification,
  findUnitModification,
  isAdvancedModification,
  blueprintGateMet,
  modificationGateMet,
  modificationPrice,
  scrapyardDiscountPercent,
  scrapyardLevelForModification,
  scrapyardLevelForTrap,
  scrapyardLevelForUpgrade,
  scrapyardPrice,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type Building,
  type Resources,
  BUILDING_KINDS,
  boltInRefusal,
  boltOntoUnitRefusal,
  findBuilding,
  markFromPoints,
  modificationFitsUnit,
  slotsFor,
  unlockedUnits,
  OFFICER_ROLES,
  createCommander,
  makeAttributes,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { buildAddon, projectScrapyard } from './scrapyard.js';
import { roleFit } from '../roles/requirements.js';
import { unlockContextFor } from '../units/training.js';

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
    // High enough that the crew-level gate is not what any of these tests is about.
    level: 30,
    isBot: false,
    resources: STARTING_RESOURCES,
    /*
     * ...and a rank, for the same reason the level above is 30: the top two modification bands ask
     * for one (§D7), and a fixture at rank 0 would refuse every advanced card for a reason none of
     * these tests is about.
     */
    economy: { ...startingEconomy(NOW.toISOString()), notoriety: MAX_NOTORIETY },
    progression: startingProgression(),
    research: startingResearch(),
    // A Gauntlet too: a unit card's level gate reads it the way a structure card reads its own
    // structure, so a fixture without one refuses every refit for a reason no test here is about.
    buildings: [build('nexus', 6), build('scrapyard', 4), build('gauntlet', 20)],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(NOW.toISOString()),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    /*
     * A full bench of strong officers, because a card asks for one (2026-09-16).
     *
     * Every modification now names a chair and a mark (`building/requirements.ts`), and an empty
     * chair is a refusal. This file is about the yard's own gates, the documents and the bills, so
     * the officer gate is satisfied for every role once here rather than fought with in eighteen
     * tests. The tests that are *about* the new gates seat nobody and say so.
     *
     * **Except the Fabricator** (maintainer, 2026-09-22). That chair now takes up to 30% off
     * every bill on this bench (`yardCostCutPercent`), and it gates no card at all, so seating
     * one by default would quietly move every price this file pins without buying a single gate
     * in return. The chair is left empty here and filled by the one test that is about it.
     */
    commanders: OFFICER_ROLES.filter((role) => role !== 'fabricator').map((role, index) =>
      createCommander(`off-${index}`, `Officer ${index}`, role, makeAttributes(90)),
    ),
    createdAt: NOW.toISOString(),
    ...over,
  };
  repos.bases.insert(base);
  return base;
}

describe('§B9: the Scrapyard builds add-ons', () => {
  it('prices every bracket and unit card in scrap, and in nothing but scrap and metal', () => {
    const repos = openStack();
    const { entries } = projectScrapyard(repos, seedBase(repos, { resources: RICH }));
    // Derived rather than typed: three benches, and a content edit to any of them should move this
    // number rather than redden a count nobody meant to pin.
    expect(entries.length).toBe(
      MODIFICATIONS.length + UNIT_MODIFICATIONS.length + TRAP_CATALOG.length,
    );

    /*
     * The board's two-column rule, and it is about the two benches that bolt things on.
     *
     * Traps are the exception and are excluded here rather than quietly weakening the assertion for
     * everybody: they are priced by `TRAP_CATALOG` in planks, oil and caps as well as scrap,
     * because a trap is made out of what is lying around. Their own bill is checked below.
     */
    const bolted = entries.filter((entry) => entry.kind !== 'trap');
    expect(bolted.length).toBe(MODIFICATIONS.length + UNIT_MODIFICATIONS.length);
    for (const entry of bolted) {
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

  /** §I4a: the trap bench, priced off `TRAP_CATALOG` with only the yard's own cut taken. */
  it('puts every trap on its own bench at the catalogue price less the yard discount', () => {
    const repos = openStack();
    const base = seedBase(repos, { resources: RICH });
    const { entries } = projectScrapyard(repos, base);
    const traps = entries.filter((entry) => entry.kind === 'trap');
    expect(traps.map((entry) => entry.id)).toEqual(TRAP_CATALOG.map((spec) => spec.id));

    for (const spec of TRAP_CATALOG) {
      const entry = traps.find((row) => row.id === spec.id)!;
      expect(entry.cost, spec.id).toEqual(scrapyardPrice(spec.cost, 4));
      // A trap belongs to no structure: it goes in the inventory, not into a bracket.
      expect(entry.building, spec.id).toBeNull();
      expect(entry.advanced, spec.id).toBe((spec.cost.highQualityMetal ?? 0) > 0);
    }
  });

  it('wants a blueprint for most of what it sells, and not for all of it', () => {
    const repos = openStack();
    const { entries } = projectScrapyard(repos, seedBase(repos, { resources: RICH }));
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
   * §D12f, as it stands since the desk went (plan §I2d): an advanced modification wants the
   * structure's retrofit document, and nothing else.
   *
   * It used to want a Lab project as well ("drawn up in the Lab"), and the two gates were asserted
   * separately because either alone passed the test while the other was missing. The project is
   * gone with the desk, so the third case here is the one that matters now: a crew that *only* has
   * the old `addons.researched` entry, with no document, is still refused, which proves the yard
   * has stopped reading that list rather than merely stopped requiring it.
   */
  it('refuses an advanced add-on until the crew holds the document, and asks for nothing else', () => {
    const repos = openStack();
    const advanced = MODIFICATIONS.find(isAdvancedModification);
    expect(advanced).toBeDefined();
    if (!advanced) return;
    const document = blueprintForModification(advanced);
    expect(document, 'the advanced half of §D12f is not behind a document').toBeDefined();
    if (!document) return;

    // Tall enough for an advanced card's own gate, which is a level on the structure it goes into.
    const into = advanced.building;
    const bare = seedBase(repos, {
      resources: RICH,
      buildings: [
        ...(into === 'nexus' ? [] : [build('nexus', 6)]),
        ...(into === 'scrapyard' ? [] : [build('scrapyard', 12)]),
        build(into, 20),
      ],
    });
    expect(buildAddon(repos, bare, 'modification', advanced.id, undefined, into)).toEqual({
      kind: 'refused',
      reason: `Needs the ${document.name}`,
    });

    // The retired Lab project on its own buys nothing: the list is not read any more.
    const drawnOnly: Base = { ...bare, addons: { researched: [advanced.id], built: [] } };
    expect(buildAddon(repos, drawnOnly, 'modification', advanced.id, undefined, into)).toEqual({
      kind: 'refused',
      reason: `Needs the ${document.name}`,
    });

    // The document is the last gate standing, and the card goes straight into a bracket.
    const drawn: Base = { ...bare, inventory: { [document.id]: 1 } };
    const built = buildAddon(repos, drawn, 'modification', advanced.id, undefined, into);
    expect(built.kind, built.kind === 'refused' ? built.reason : '').toBe('built');
    if (built.kind !== 'built') return;
    expect(findBuilding(built.base.buildings, into)?.modifications).toEqual([advanced.id]);
    // The bill is the list price less the yard's cut at level 12, which is what this crew stands.
    const bill = scrapyardPrice(modificationPrice(advanced), 12);
    expect(bill.scrap).toBeLessThan(modificationPrice(advanced).scrap ?? 0);
    expect(built.base.resources.scrap).toBe(RICH.scrap - (bill.scrap ?? 0));
    expect(built.base.resources.highQualityMetal).toBe(
      RICH.highQualityMetal - (bill.highQualityMetal ?? 0),
    );
    // ...and it is on disk, not only in the returned object.
    expect(findBuilding(repos.bases.findById(bare.id)!.buildings, into)?.modifications).toEqual([
      advanced.id,
    ]);
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
    const result = buildAddon(repos, noYard, 'modification', basic.id, undefined, basic.building);
    expect(result).toEqual({ kind: 'refused', reason: 'Build the Scrapyard first' });
  });

  /**
   * A unit card is cut for a named unit and bolted straight onto it (maintainer rule, 2026-09-16).
   *
   * There is no stock of unfitted cards any more, so what "built" means here is a bracket on one
   * sheet wearing it. Building the same card for the *same* unit twice is refused; building it for
   * a second unit is the supported way to kit two sheets, and costs the bill twice.
   */
  it('bolts a unit card onto the unit it was cut for, one per sheet', () => {
    const repos = openStack();
    const open = findUnitModification('taped_grips');
    expect(open).toBeDefined();
    if (!open) return;

    const base = seedBase(repos, {
      resources: RICH,
      buildings: [build('nexus', 6), build('scrapyard', 4), build('gauntlet', 20)],
    });
    const built = buildAddon(repos, base, 'upgrade', open.id, undefined, 'razors');
    expect(built.kind, built.kind === 'refused' ? built.reason : '').toBe('built');
    if (built.kind !== 'built') return;
    expect(built.base.unitLoadouts['razors']?.[0]).toBe(open.id);

    expect(buildAddon(repos, built.base, 'upgrade', open.id, undefined, 'razors')).toEqual({
      kind: 'refused',
      reason: 'Already bolted on here',
    });

    // ...and the same card for a different sheet is a second, legal purchase.
    const second = buildAddon(repos, built.base, 'upgrade', open.id, undefined, 'ghosts');
    expect(second.kind, second.kind === 'refused' ? second.reason : '').toBe('built');
  });

  /**
   * §D12g: twenty-seven of the thirty cards want their document, and the yard holds the gate.
   *
   * The open card is the control. Both are built by the same route with the same crew, so a build
   * that refused everything would pass the first half of this test and fail the second. Filed
   * Sights is BASIC, so the yard's level is not what is being read either.
   */
  it('refuses a gated card until its document is in the inventory, and takes an open one', () => {
    const repos = openStack();
    const base = seedBase(repos, {
      resources: RICH,
      // The parts the gated card is authored with, so the parts gate is not what is being read.
      inventory: { weld_rod: 20 },
    });
    const one = buildAddon(repos, base, 'upgrade', 'taped_grips', undefined, 'razors');
    expect(one.kind, 'the open card is gated too').toBe('built');
    if (one.kind !== 'built') return;

    const refused = buildAddon(repos, one.base, 'upgrade', 'filed_sights', undefined, 'razors');
    expect(refused).toEqual({ kind: 'refused', reason: 'Needs the Filed Sights Blueprint' });

    const read: Base = {
      ...one.base,
      inventory: { ...one.base.inventory, bp_mod_filed_sights: 1 },
    };
    expect(buildAddon(repos, read, 'upgrade', 'filed_sights', undefined, 'razors').kind).toBe(
      'built',
    );
  });

  it('names a modification the catalogue does not know rather than throwing', () => {
    const repos = openStack();
    const base = seedBase(repos, { resources: RICH });
    expect(findModification('scrapyard_nothing')).toBeUndefined();
    expect(
      buildAddon(repos, base, 'modification', 'scrapyard_nothing', undefined, 'scrapyard'),
    ).toEqual({
      kind: 'refused',
      reason: 'No such add-on',
    });
  });
});

/**
 * The door and the rule are the same rule (2026-09-14).
 *
 * `modificationBuildRefusal` lives in `@frontline/shared` and is where the ordering of the gates is
 * written down. For a while it was written down and not used: the Scrapyard had its own copy, and
 * the two drifted, because the shared one never learned the yard has a level. Its own tests stayed
 * green throughout, since they were its only caller.
 *
 * This walks the whole catalogue at several yard levels and asserts the page agrees with the rule
 * about *every* entry: a blocker exactly when the rule refuses, and none when it does not. A
 * reimplementation that drifts again fails here rather than in a player's hands.
 */
describe('the Scrapyard page answers with the shared rule, not a copy of it', () => {
  /** Every document in the inventory, so the yard's level is the only thing that can shut a row. */
  const everyDocument = Object.fromEntries(
    MODIFICATIONS.map(blueprintForModification)
      .filter((document) => document !== undefined)
      .map((document) => [document.id, 1]),
  );

  it('blocks exactly the modifications the rule refuses, on every structure they fit', () => {
    let refused = 0;
    let allowed = 0;

    for (const level of [1, 5, 11, 20]) {
      const repos = openStack();
      const base = seedBase(repos, {
        resources: RICH,
        buildings: [
          build('nexus', 20),
          build('scrapyard', level),
          build('gauntlet', 20),
          build('lab', 20),
          build('quarters', 20),
        ],
        inventory: everyDocument,
      });
      const page = projectScrapyard(repos, base);

      for (const spec of MODIFICATIONS) {
        const entry = page.entries.find((one) => one.id === spec.id)!;
        expect(entry, spec.id).toBeDefined();
        /*
         * Per target, because that is where the answer lives as of 2026-09-16: the same card is
         * buildable for the structure you raised and refused by the one you have not, so a single
         * blocker on the row could not be right for both.
         */
        for (const target of entry.targets) {
          const kind = BUILDING_KINDS.find((one) => one === target.id)!;
          const rule = boltInRefusal({
            spec,
            kind,
            yardLevel: level,
            blueprintUnlocked: (one) => modificationGateMet(base.inventory, one),
            buildings: base.buildings,
            crewLevel: base.level,
            // The same fact the page feeds it: a rule given different inputs is a different rule.
            notoriety: base.economy.notoriety,
            markFor: (role) => {
              const officer = base.commanders.find((one) => one.role === role);
              return officer ? markFromPoints(roleFit(officer.attributes, role)) : null;
            },
            affordable: () => true,
          });
          // `already_fitted` is an action rather than a refusal on the page: the row offers
          // Dismantle instead of a reason. Same split as the unit bench below.
          if (rule === null || rule === 'already_fitted') {
            allowed += 1;
            expect(target.blocker, `${spec.id} on ${target.id} at yard ${level}`).toBeNull();
          } else {
            refused += 1;
            expect(target.blocker, `${spec.id} on ${target.id} at yard ${level}`).not.toBeNull();
          }
        }
      }
    }

    // A guard on the guard. A page that blocked everything, or nothing, would satisfy one half of
    // the loop above and say nothing at all; both halves have to be exercised for this to mean
    // anything, and at these levels both are.
    expect(refused).toBeGreaterThan(20);
    expect(allowed).toBeGreaterThan(20);
  });

  it('blocks exactly the unit cards the rule refuses, on every sheet they fit', () => {
    let refused = 0;
    let allowed = 0;

    for (const level of [1, 5, 11, 20]) {
      const repos = openStack();
      const base = seedBase(repos, {
        resources: RICH,
        buildings: [build('nexus', 20), build('scrapyard', level), build('gauntlet', 20)],
        inventory: {
          ...Object.fromEntries(
            UNIT_MODIFICATIONS.map((spec) => blueprintForUnitUpgrade(spec.id))
              .filter((document) => document !== undefined)
              .map((document) => [document.id, 1]),
          ),
          // The parts every card is authored with, so the parts gate is not what is being read.
          ...Object.fromEntries(
            UNIT_MODIFICATIONS.flatMap((spec) => Object.keys(spec.parts)).map((item) => [item, 99]),
          ),
        },
        // One card already on one sheet, so `already_fitted` is exercised on the page as well.
        unitLoadouts: { razors: ['taped_grips', null, null] },
      });
      const page = projectScrapyard(repos, base);
      const trainable = new Set(
        unlockedUnits(unlockContextFor(repos, base)).map((unit) => unit.id),
      );

      for (const spec of UNIT_MODIFICATIONS) {
        const entry = page.entries.find((one) => one.id === spec.id)!;
        expect(entry, spec.id).toBeDefined();
        for (const target of entry.targets) {
          const rule = boltOntoUnitRefusal({
            id: spec.id,
            unitId: target.id,
            trainable: trainable.has(target.id),
            fitsUnit: modificationFitsUnit,
            slots: slotsFor(base.unitLoadouts, target.id),
            yardLevel: level,
            requiredYardLevel: scrapyardLevelForUpgrade,
            blueprintUnlocked: (id) => blueprintGateMet(base.inventory, 'unit_upgrade', id),
            gauntletLevel: 20,
            crewLevel: base.level,
            // The same fact the page feeds it: a rule given different inputs is a different rule.
            notoriety: base.economy.notoriety,
            markFor: (role) => {
              const officer = base.commanders.find((one) => one.role === role);
              return officer ? markFromPoints(roleFit(officer.attributes, role)) : null;
            },
            affordable: () => true,
            hasParts: () => true,
          });
          /*
           * `already_fitted` is the one refusal the page deliberately does not print.
           *
           * There is nothing left to do about a card that is already on this sheet, so the row
           * says so through `fitted` and offers Dismantle instead of telling a player off for
           * something they have finished.
           */
          if (rule === null || rule === 'already_fitted') {
            allowed += 1;
            expect(target.blocker, `${spec.id} on ${target.id} at yard ${level}`).toBeNull();
          } else {
            refused += 1;
            expect(target.blocker, `${spec.id} on ${target.id} at yard ${level}`).not.toBeNull();
          }
        }
      }
    }

    expect(refused).toBeGreaterThan(3);
    expect(allowed).toBeGreaterThan(3);
  });

  /**
   * Both benches group by the word on the row, so both carry one and only the traps do not.
   *
   * The structure rows sent `null` until 2026-09-16 and the bench grouped them by structure. They
   * are graded on the same four words as the unit cards now, and the grade is what the new
   * requirement bands are read off (`building/requirements.ts`), so a row without one would be a
   * row whose gates nothing could explain.
   */
  it('puts the grade on every card row, and on no trap', () => {
    const repos = openStack();
    const { entries } = projectScrapyard(repos, seedBase(repos, { resources: RICH }));
    for (const entry of entries) {
      if (entry.kind === 'upgrade') {
        expect(entry.rarity, entry.id).toBe(findUnitModification(entry.id)?.rarity);
        // BASIC is the bolt-on end; everything above it is the engineering the metal marks.
        expect(entry.advanced, entry.id).toBe(entry.rarity !== 'basic');
      } else if (entry.kind === 'modification') {
        expect(entry.rarity, entry.id).toBe(findModification(entry.id)?.rarity);
      } else {
        expect(entry.rarity, entry.id).toBeNull();
      }
    }
  });
});

/**
 * What the yard's own level is worth (maintainer request, 2026-09-10).
 *
 * Every entry carries the level it opens at, the shut ones say so before they say anything about
 * documents or money, and the whole board is priced with the level's cut already on it. Each gate
 * is checked with a positive control one level up, so a yard that refused everything would fail
 * the second half.
 */
describe("the yard's level opens the catalogue and cuts the bill", () => {
  const yardAt = (level: number): Partial<Base> => ({
    resources: RICH,
    buildings: [build('nexus', 20), build('scrapyard', level), build('gauntlet', 20)],
    // Every document, so the level is the only thing that can shut a row.
    inventory: Object.fromEntries(
      [
        ...MODIFICATIONS.map(blueprintForModification),
        ...UNIT_MODIFICATIONS.map((spec) => blueprintForUnitUpgrade(spec.id)),
        ...TRAP_CATALOG.map((spec) => blueprintForTrap(spec.id)),
      ]
        .filter((document) => document !== undefined)
        .map((document) => [document.id, 1]),
    ),
    research: {
      ...startingResearch(),
      technologies: TRAP_CATALOG.map((spec) => spec.requiresTech),
    },
  });

  it('quotes the level every entry opens at, and the cut the yard takes', () => {
    const repos = openStack();
    const view = projectScrapyard(repos, seedBase(repos, yardAt(6)));
    expect(view.scrapyardLevel).toBe(6);
    expect(view.discountPercent).toBe(scrapyardDiscountPercent(6));
    expect(view.discountPercent).toBeGreaterThan(0);
    for (const entry of view.entries) {
      expect(entry.requiresLevel, entry.id).toBeGreaterThanOrEqual(1);
    }
    const advanced = MODIFICATIONS.find(isAdvancedModification)!;
    const row = view.entries.find((entry) => entry.id === advanced.id)!;
    expect(row.requiresLevel).toBe(scrapyardLevelForModification(advanced));
    expect(row.cost).toEqual(scrapyardPrice(modificationPrice(advanced), 6));
  });

  it('holds an advanced modification below its level and opens it at it', () => {
    const repos = openStack();
    const advanced = MODIFICATIONS.find(isAdvancedModification)!;
    const opens = scrapyardLevelForModification(advanced);
    const into = advanced.building;
    const low = seedBase(repos, {
      ...yardAt(opens - 1),
      buildings: [
        ...(into === 'nexus' ? [] : [build('nexus', 20)]),
        build('scrapyard', opens - 1),
        build(into, 20),
      ],
      inventory: Object.fromEntries(
        MODIFICATIONS.map(blueprintForModification)
          .filter((document) => document !== undefined)
          .map((document) => [document.id, 1]),
      ),
    });
    expect(buildAddon(repos, low, 'modification', advanced.id, undefined, into)).toEqual({
      kind: 'refused',
      reason: `Needs the Scrapyard at level ${opens}`,
    });
    // The row answers per structure now, so the sentence is on the target the player is looking at.
    const shut = projectScrapyard(repos, low).entries.find((entry) => entry.id === advanced.id)!;
    expect(shut.targets.find((target) => target.id === into)?.blocker).toBe(
      `Needs the Scrapyard at level ${opens}`,
    );

    const tall: Base = {
      ...low,
      buildings: [
        ...(into === 'nexus' ? [] : [build('nexus', 20)]),
        build('scrapyard', opens),
        build(into, 20),
      ],
    };
    const built = buildAddon(repos, tall, 'modification', advanced.id, undefined, into);
    expect(built.kind, built.kind === 'refused' ? built.reason : '').toBe('built');
  });

  it('holds a masterpiece card for its level, and says so before it mentions the document', () => {
    const repos = openStack();
    const top = UNIT_MODIFICATIONS.find((spec) => spec.rarity === 'masterpiece')!;
    const opens = scrapyardLevelForUpgrade(top);
    expect(opens).toBeGreaterThan(1);
    // The documents held and the parts in hand: the level is the one thing left in the way.
    const base = seedBase(repos, {
      ...yardAt(opens - 1),
      inventory: {
        ...yardAt(1).inventory,
        ceramic_plate: 20,
        coolant_cell: 20,
        weld_rod: 20,
        hydraulic_ram: 20,
        pressure_valve: 20,
        signal_relay: 20,
      },
    });
    expect(buildAddon(repos, base, 'upgrade', top.id, undefined, 'razors')).toEqual({
      kind: 'refused',
      reason: `Needs the Scrapyard at level ${opens}`,
    });

    // Without the document as well, the level is still what the row says: raise the yard first.
    const bare: Base = {
      ...base,
      inventory: {
        ceramic_plate: 20,
        coolant_cell: 20,
        weld_rod: 20,
        hydraulic_ram: 20,
        pressure_valve: 20,
        signal_relay: 20,
      },
    };
    expect(buildAddon(repos, bare, 'upgrade', top.id, undefined, 'razors')).toEqual({
      kind: 'refused',
      reason: `Needs the Scrapyard at level ${opens}`,
    });

    const tall: Base = {
      ...base,
      buildings: [build('nexus', 20), build('scrapyard', opens), build('gauntlet', 20)],
    };
    const fitted = buildAddon(repos, tall, 'upgrade', top.id, undefined, 'razors');
    expect(fitted.kind, fitted.kind === 'refused' ? fitted.reason : '').toBe('built');
  });

  it('holds a trap for its level and opens it at it', () => {
    const repos = openStack();
    const trap = [...TRAP_CATALOG].sort(
      (a, b) => scrapyardLevelForTrap(b) - scrapyardLevelForTrap(a),
    )[0]!;
    const opens = scrapyardLevelForTrap(trap);
    expect(opens).toBeGreaterThan(1);
    const low = seedBase(repos, yardAt(opens - 1));
    expect(buildAddon(repos, low, 'trap', trap.id)).toEqual({
      kind: 'refused',
      reason: `Needs the Scrapyard at level ${opens}`,
    });
    const tall: Base = {
      ...low,
      buildings: [build('nexus', 20), build('scrapyard', opens), build('gauntlet', 20)],
    };
    const built = buildAddon(repos, tall, 'trap', trap.id);
    expect(built.kind).toBe('built');
    if (built.kind !== 'built') return;
    // Charged the discounted bill, not the list price.
    expect(built.base.resources.scrap).toBe(
      RICH.scrap - (scrapyardPrice(trap.cost, opens).scrap ?? 0),
    );
  });

  it("takes the Armory's cut off a unit card, on top of the yard's", () => {
    const repos = openStack();
    const base = seedBase(repos, yardAt(6));
    const first = UNIT_MODIFICATIONS.find((spec) => spec.rarity === 'basic')!;
    const bare = projectScrapyard(repos, base).entries.find((entry) => entry.id === first.id)!;
    const favoured = projectScrapyard(repos, base, { refitDiscountPercent: 10 }).entries.find(
      (entry) => entry.id === first.id,
    )!;
    expect(favoured.cost.scrap ?? 0).toBeLessThan(bare.cost.scrap ?? 0);
    // A building modification is not a unit card: the Armory has no say in it.
    const bracket = MODIFICATIONS[0]!;
    expect(
      projectScrapyard(repos, base, { refitDiscountPercent: 10 }).entries.find(
        (entry) => entry.id === bracket.id,
      )!.cost,
    ).toEqual(projectScrapyard(repos, base).entries.find((entry) => entry.id === bracket.id)!.cost);
  });
});

/**
 * The yard charges the parts a card is authored with.
 *
 * It did not, once: the Workshop's route required the crew to hold `spec.parts` and consumed
 * them, and this door checked neither, so the same refit could be bought through the yard with the
 * ceramic plates still in the inventory. The Workshop is gone (maintainer request, 2026-09-10) and
 * this is the one door, so the parts are a rule here or nowhere.
 */
describe('the Scrapyard charges the parts a card is authored with', () => {
  const NEEDS_PARTS = UNIT_MODIFICATIONS.find(
    (spec) => Object.keys(spec.parts).length > 0 && spec.rarity === 'basic',
  );
  /** Its document, held: the parts are the one gate left between the crew and the card. */
  const drawings = (): Record<string, number> => {
    if (!NEEDS_PARTS) throw new Error('fixture: no BASIC card needs parts');
    const document = blueprintForUnitUpgrade(NEEDS_PARTS.id);
    return document ? { [document.id]: 1 } : {};
  };

  it('refuses a card whose parts the crew does not hold', () => {
    if (!NEEDS_PARTS) throw new Error('fixture: no BASIC card needs parts');
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
      inventory: drawings(),
      buildings: [
        { id: 's', kind: 'scrapyard', level: 20, modifications: [] },
        build('gauntlet', 20),
      ],
    });

    const result = buildAddon(repos, base, 'upgrade', NEEDS_PARTS.id, undefined, 'razors');
    expect(result, 'the parts were never asked for').toMatchObject({ kind: 'refused' });
    // And refused *for the parts*, not for some other clause that happens to bite first: this
    // test passed against the unfixed code until the reason was pinned, because a wrong argument
    // shape was refusing it as "No such add-on".
    const [part] = Object.keys(NEEDS_PARTS.parts);
    if (result.kind === 'refused') {
      expect(result.reason).toContain(ITEM_CATALOG[part as keyof typeof ITEM_CATALOG].name);
    }
  });

  it('consumes the parts when it does build one', () => {
    if (!NEEDS_PARTS) throw new Error('fixture: no BASIC card needs parts');
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
      inventory: { ...held, ...drawings() },
      buildings: [
        { id: 's', kind: 'scrapyard', level: 20, modifications: [] },
        build('gauntlet', 20),
      ],
    });

    const result = buildAddon(repos, base, 'upgrade', NEEDS_PARTS.id, undefined, 'razors');
    expect(result, result.kind === 'refused' ? result.reason : '').toMatchObject({ kind: 'built' });

    const after = repos.bases.findById(base.id)!;
    // On the sheet it was cut for, rather than in a stock: there is no stock any more.
    expect(after.unitLoadouts['razors']).toContain(NEEDS_PARTS.id);
    // Exactly what the spec asks for, no more and no less. Asserting the leftover instead would
    // pass just as well against a build that spent the whole inventory.
    for (const [item, count] of Object.entries(NEEDS_PARTS.parts)) {
      const key = item as keyof typeof after.inventory;
      const spent = (held[item] ?? 0) - (after.inventory[key] ?? 0);
      expect(spent, `${item} was not spent`).toBe(count);
    }
  });
});

/**
 * What the Fabricator takes off the yard's bill (maintainer, 2026-09-22).
 *
 * Their sheet used to reach nothing outside their own research track. The chair gates no card on
 * this bench: it is named as `OFFICER_FOR_UNIT_FALLBACK`, and every one of the unit cards already
 * has a louder stat, so the fallback never fires and the chair opens nothing. Nothing else in the
 * game read the sheet either. A chair whose only effect is to unlock its own reading list is a
 * chair nobody has a reason to fill well.
 *
 * It buys price now, on the curve and ceiling each research chair already uses on its own track,
 * and off the **lifted** sheet, so teaching perks and the Lab count here as they do there.
 */
describe('the Fabricator cuts what the yard charges', () => {
  /** A yard at level 6 holding every document, so only the chair can move a price. */
  const yardAt = (level: number): Partial<Base> => ({
    resources: RICH,
    buildings: [build('nexus', 20), build('scrapyard', level), build('gauntlet', 20)],
    inventory: Object.fromEntries(
      [
        ...MODIFICATIONS.map(blueprintForModification),
        ...UNIT_MODIFICATIONS.map((spec) => blueprintForUnitUpgrade(spec.id)),
        ...TRAP_CATALOG.map((spec) => blueprintForTrap(spec.id)),
      ]
        .filter((document) => document !== undefined)
        .map((document) => [document.id, 5]),
    ),
  });

  /** The same seed with somebody in the chair, at whatever sheet is handed in. */
  const withFabricator = (repos: Repositories, rating: number, over: Partial<Base> = {}): Base =>
    seedBase(repos, {
      ...over,
      commanders: [
        ...OFFICER_ROLES.filter((role) => role !== 'fabricator').map((role, index) =>
          createCommander(`off-${index}`, `Officer ${index}`, role, makeAttributes(90)),
        ),
        createCommander('fab', 'The Fabricator', 'fabricator', makeAttributes(rating)),
      ],
    });

  const firstCost = (base: Base, repos: Repositories): PartialResources =>
    projectScrapyard(repos, base).entries[0]!.cost;

  it('charges less with a good one in the chair than with nobody', () => {
    const empty = openStack();
    const listed = firstCost(seedBase(empty, yardAt(6)), empty);

    const staffed = openStack();
    const cut = firstCost(withFabricator(staffed, 100, yardAt(6)), staffed);

    // Cheaper on every line, and not by a rounding error: the ceiling is 30%.
    for (const key of RESOURCE_KEYS) {
      const listedLine = listed[key];
      if (listedLine === undefined) continue;
      expect(cut[key] ?? 0, key).toBeLessThan(listedLine);
    }
    const total = (bill: PartialResources): number =>
      RESOURCE_KEYS.reduce((sum, key) => sum + (bill[key] ?? 0), 0);
    expect(total(cut) / total(listed)).toBeLessThan(0.85);
    expect(total(cut) / total(listed)).toBeGreaterThan(0.6);
  });

  /**
   * Points, not the mark band: a better Fabricator is continuously cheaper.
   *
   * This is the half that makes the chair worth *improving* rather than merely filling, and it is
   * the property a mark-shaped gate cannot have.
   */
  it('charges a poor one more than a good one, and neither more than the list', () => {
    const poor = openStack();
    const weak = firstCost(withFabricator(poor, 20, yardAt(6)), poor);
    const good = openStack();
    const strong = firstCost(withFabricator(good, 100, yardAt(6)), good);
    const empty = openStack();
    const listed = firstCost(seedBase(empty, yardAt(6)), empty);

    const total = (bill: PartialResources): number =>
      RESOURCE_KEYS.reduce((sum, key) => sum + (bill[key] ?? 0), 0);
    expect(total(strong)).toBeLessThan(total(weak));
    expect(total(weak)).toBeLessThanOrEqual(total(listed));
  });

  /**
   * The quote and the charge agree.
   *
   * The read path and the write path price separately (`projectScrapyard` and `buildAddon`), and
   * a page that quotes a discounted bill while the write charges the list price is how a player
   * is refused for money the screen says they are holding.
   */
  it('charges at the till exactly what the page quoted', () => {
    const repos = openStack();
    const base = withFabricator(repos, 100, {
      ...yardAt(6),
      resources: {
        caps: 500_000,
        supplies: 0,
        oil: 0,
        scrap: 500_000,
        highQualityMetal: 500_000,
        planks: 500_000,
      },
    });
    /*
     * A basic structure card: the one entry on this bench that needs nothing from the Lab, so
     * what is being measured is the till and not a research gate.
     */
    const basic = MODIFICATIONS.find((one) => !isAdvancedModification(one));
    if (!basic) throw new Error('fixture: the catalogue has no basic modification');
    const quoted = projectScrapyard(repos, base).entries.find((one) => one.id === basic.id);
    expect(quoted?.blocker, `${basic.id} should be open on this bench`).toBeNull();
    if (!quoted) return;

    const before = base.resources;
    const built = buildAddon(repos, base, 'modification', basic.id, undefined, basic.building);
    expect(built.kind, built.kind === 'refused' ? built.reason : '').toBe('built');
    if (built.kind !== 'built') return;
    for (const key of RESOURCE_KEYS) {
      const price = quoted.cost[key];
      if (price === undefined) continue;
      expect(before[key] - built.base.resources[key], key).toBe(price);
    }
  });
});
