import {
  ITEM_CATALOG,
  TRAP_CATALOG,
  UNIT_MODIFICATIONS,
  MODIFICATIONS,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  addonsOf,
  blueprintForModification,
  blueprintForTrap,
  blueprintForUnitUpgrade,
  findModification,
  findUnitModification,
  isAdvancedModification,
  blueprintGateMet,
  modificationBuildRefusal,
  modificationGateMet,
  modificationPrice,
  scrapyardDiscountPercent,
  scrapyardLevelForModification,
  scrapyardLevelForTrap,
  scrapyardLevelForUpgrade,
  scrapyardPrice,
  upgradeRefusal,
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
  it('prices every bracket and unit card in scrap, and in nothing but scrap and metal', () => {
    const repos = openStack();
    const { entries } = projectScrapyard(seedBase(repos, { resources: RICH }));
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
    const { entries } = projectScrapyard(base);
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

    const bare = seedBase(repos, { resources: RICH });
    expect(buildAddon(repos, bare, 'modification', advanced.id)).toEqual({
      kind: 'refused',
      reason: `Needs the ${document.name}`,
    });

    // The retired Lab project on its own buys nothing: the list is not read any more.
    const drawnOnly: Base = { ...bare, addons: { researched: [advanced.id], built: [] } };
    expect(buildAddon(repos, drawnOnly, 'modification', advanced.id)).toEqual({
      kind: 'refused',
      reason: `Needs the ${document.name}`,
    });

    // The document alone is the whole gate.
    const drawn: Base = { ...bare, inventory: { [document.id]: 1 } };
    const built = buildAddon(repos, drawn, 'modification', advanced.id);
    expect(built.kind).toBe('built');
    if (built.kind !== 'built') return;
    expect(addonsOf(built.base).built).toEqual([advanced.id]);
    // The bill is the list price less the yard's cut at level 4, which is what the seed stands.
    const bill = scrapyardPrice(modificationPrice(advanced), 4);
    expect(bill.scrap).toBeLessThan(modificationPrice(advanced).scrap ?? 0);
    expect(built.base.resources.scrap).toBe(RICH.scrap - (bill.scrap ?? 0));
    expect(built.base.resources.highQualityMetal).toBe(
      RICH.highQualityMetal - (bill.highQualityMetal ?? 0),
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

  it('builds a unit card into the crew’s own stock rather than onto a shelf', () => {
    const repos = openStack();
    const open = findUnitModification('taped_grips');
    expect(open).toBeDefined();
    if (!open) return;

    const base = seedBase(repos, { resources: RICH });
    const built = buildAddon(repos, base, 'upgrade', open.id);
    expect(built.kind).toBe('built');
    if (built.kind !== 'built') return;
    expect(built.base.fittedUpgrades).toEqual([open.id]);
    expect(buildAddon(repos, built.base, 'upgrade', open.id)).toEqual({
      kind: 'refused',
      reason: 'Already built',
    });
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
    const one = buildAddon(repos, base, 'upgrade', 'taped_grips');
    expect(one.kind, 'the open card is gated too').toBe('built');
    if (one.kind !== 'built') return;

    const refused = buildAddon(repos, one.base, 'upgrade', 'filed_sights');
    expect(refused).toEqual({ kind: 'refused', reason: 'Needs the Filed Sights Blueprint' });

    const read: Base = {
      ...one.base,
      inventory: { ...one.base.inventory, bp_mod_filed_sights: 1 },
    };
    expect(buildAddon(repos, read, 'upgrade', 'filed_sights').kind).toBe('built');
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

  it('blocks exactly the modifications the rule refuses, at every yard level', () => {
    let refused = 0;
    let allowed = 0;

    for (const level of [1, 5, 11, 20]) {
      const repos = openStack();
      const base = seedBase(repos, {
        resources: RICH,
        buildings: [build('nexus', 20), build('scrapyard', level), build('gauntlet', 20)],
        inventory: everyDocument,
      });
      const page = projectScrapyard(base);

      for (const spec of MODIFICATIONS) {
        const rule = modificationBuildRefusal({
          spec,
          yardLevel: level,
          blueprintUnlocked: (one) => modificationGateMet(base.inventory, one),
          affordable: () => true,
        });
        const entry = page.entries.find((one) => one.id === spec.id)!;
        expect(entry, spec.id).toBeDefined();
        if (rule === null) {
          allowed += 1;
          expect(entry.blocker, `${spec.id} at yard ${level}`).toBeNull();
        } else {
          refused += 1;
          expect(entry.blocker, `${spec.id} at yard ${level}`).not.toBeNull();
        }
      }
    }

    // A guard on the guard. A page that blocked everything, or nothing, would satisfy one half of
    // the loop above and say nothing at all; both halves have to be exercised for this to mean
    // anything, and at these levels both are.
    expect(refused).toBeGreaterThan(20);
    expect(allowed).toBeGreaterThan(20);
  });

  it('blocks exactly the unit cards the rule refuses, at every yard level', () => {
    let refused = 0;
    let allowed = 0;

    for (const level of [1, 5, 11, 20]) {
      const repos = openStack();
      const base = seedBase(repos, {
        resources: RICH,
        buildings: [build('nexus', 20), build('scrapyard', level)],
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
        // One card already in the stock, so `already_fitted` is exercised on the page as well.
        fittedUpgrades: ['taped_grips'],
      });
      const page = projectScrapyard(base);

      for (const spec of UNIT_MODIFICATIONS) {
        const rule = upgradeRefusal({
          id: spec.id,
          fitted: base.fittedUpgrades,
          yardLevel: level,
          requiredYardLevel: scrapyardLevelForUpgrade,
          blueprintUnlocked: (id) => blueprintGateMet(base.inventory, 'unit_upgrade', id),
          affordable: () => true,
          hasParts: () => true,
        });
        const entry = page.entries.find((one) => one.id === spec.id)!;
        expect(entry, spec.id).toBeDefined();
        /*
         * `already_fitted` is the one refusal the page deliberately does not print.
         *
         * There is nothing left to do about a card that is already in the stock, so the row says
         * so through `owned` and leaves `blocker` null rather than telling a player off for
         * something they have finished. That is a wording decision, which is this file's half of
         * the split, so it belongs here rather than in the rule.
         */
        if (rule === null || rule === 'already_fitted') {
          allowed += 1;
          expect(entry.blocker, `${spec.id} at yard ${level}`).toBeNull();
        } else {
          refused += 1;
          expect(entry.blocker, `${spec.id} at yard ${level}`).not.toBeNull();
        }
      }
    }

    expect(refused).toBeGreaterThan(3);
    expect(allowed).toBeGreaterThan(3);
  });

  /** The bench groups by the word on the row, so every unit card carries one and nothing else does. */
  it('puts the rarity on every unit card row and on no other row', () => {
    const repos = openStack();
    const { entries } = projectScrapyard(seedBase(repos, { resources: RICH }));
    for (const entry of entries) {
      if (entry.kind === 'upgrade') {
        expect(entry.rarity, entry.id).toBe(findUnitModification(entry.id)?.rarity);
        // BASIC is the bolt-on end; everything above it is the engineering the metal marks.
        expect(entry.advanced, entry.id).toBe(entry.rarity !== 'basic');
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
    const view = projectScrapyard(seedBase(repos, yardAt(6)));
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
    const low = seedBase(repos, yardAt(opens - 1));
    expect(buildAddon(repos, low, 'modification', advanced.id)).toEqual({
      kind: 'refused',
      reason: `Needs the Scrapyard at level ${opens}`,
    });
    const shut = projectScrapyard(low).entries.find((entry) => entry.id === advanced.id)!;
    expect(shut.blocker).toBe(`Needs the Scrapyard at level ${opens}`);

    const tall: Base = { ...low, buildings: [build('nexus', 20), build('scrapyard', opens)] };
    expect(buildAddon(repos, tall, 'modification', advanced.id).kind).toBe('built');
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
    expect(buildAddon(repos, base, 'upgrade', top.id)).toEqual({
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
    expect(buildAddon(repos, bare, 'upgrade', top.id)).toEqual({
      kind: 'refused',
      reason: `Needs the Scrapyard at level ${opens}`,
    });

    const tall: Base = {
      ...base,
      buildings: [build('nexus', 20), build('scrapyard', opens), build('gauntlet', 20)],
    };
    expect(buildAddon(repos, tall, 'upgrade', top.id).kind).toBe('built');
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
    const bare = projectScrapyard(base).entries.find((entry) => entry.id === first.id)!;
    const favoured = projectScrapyard(base, { refitDiscountPercent: 10 }).entries.find(
      (entry) => entry.id === first.id,
    )!;
    expect(favoured.cost.scrap ?? 0).toBeLessThan(bare.cost.scrap ?? 0);
    // A building modification is not a unit card: the Armory has no say in it.
    const bracket = MODIFICATIONS[0]!;
    expect(
      projectScrapyard(base, { refitDiscountPercent: 10 }).entries.find(
        (entry) => entry.id === bracket.id,
      )!.cost,
    ).toEqual(projectScrapyard(base).entries.find((entry) => entry.id === bracket.id)!.cost);
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
      buildings: [{ id: 's', kind: 'scrapyard', level: 20, modifications: [], damage: 0 }],
    });

    const result = buildAddon(repos, base, 'upgrade', NEEDS_PARTS.id);
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
      buildings: [{ id: 's', kind: 'scrapyard', level: 20, modifications: [], damage: 0 }],
    });

    const result = buildAddon(repos, base, 'upgrade', NEEDS_PARTS.id);
    expect(result).toMatchObject({ kind: 'built' });

    const after = repos.bases.findById(base.id)!;
    expect(after.fittedUpgrades).toContain(NEEDS_PARTS.id);
    // Exactly what the spec asks for, no more and no less. Asserting the leftover instead would
    // pass just as well against a build that spent the whole inventory.
    for (const [item, count] of Object.entries(NEEDS_PARTS.parts)) {
      const key = item as keyof typeof after.inventory;
      const spent = (held[item] ?? 0) - (after.inventory[key] ?? 0);
      expect(spent, `${item} was not spent`).toBe(count);
    }
  });
});
