import { describe, expect, it } from 'vitest';
import { BATTLE_BOOSTS } from '../battle/boosts.js';
import { BUILDING_KINDS } from '../building/kinds.js';
import { MODIFICATIONS } from '../building/modifications.js';
import { ADVANCED_MODIFICATION_MAGNITUDE } from '../building/addons.js';
import { VEHICLE_IDS, findVehicle } from '../building/vehicles.js';
import { ITEM_CATALOG } from '../items/catalog.js';
import { InventorySchema, type Inventory } from '../items/inventory.js';
import { UNIT_UPGRADES } from '../units/upgrades.js';
import { findUnit } from '../units/catalog.js';
import {
  BLUEPRINTS,
  BLUEPRINT_CATEGORIES,
  BLUEPRINT_IDS,
  BLUEPRINT_PAGE_IDS,
  blueprintsOfCategory,
  blueprintOfPage,
  findBlueprint,
} from './catalog.js';
import {
  blueprintForBattleBoost,
  blueprintForModification,
  blueprintForUnit,
  blueprintForUnitUpgrade,
  blueprintForVehicle,
  blueprintGateMet,
  describeBlueprintGate,
  modificationGateMet,
} from './requirements.js';
import {
  REIMAGINING_PAGES_SPENT,
  blueprintHolding,
  blueprintStatus,
  isBlueprintUnlocked,
  knownBlueprints,
  reimaginingAvailable,
  reimaginingRequirements,
  sparePages,
  unlockBlueprint,
  unlockRefusal,
} from './state.js';

/** Every page of one document, one copy each: the satchel of a crew that has finished collecting. */
function allPagesOf(id: string): Inventory {
  const spec = findBlueprint(id);
  if (!spec) throw new Error(`no blueprint ${id}`);
  return Object.fromEntries(spec.pages.map((page) => [page.id, 1]));
}

describe('the blueprint catalogue (§D1 to §D3)', () => {
  it('gives every blueprint a name, a category and between two and eight named pages', () => {
    for (const spec of BLUEPRINTS) {
      expect(spec.name.length, spec.id).toBeGreaterThan(3);
      expect(BLUEPRINT_CATEGORIES, spec.id).toContain(spec.category);
      expect(spec.blurb.length, spec.id).toBeGreaterThan(20);
      expect(spec.pages.length, spec.id).toBeGreaterThanOrEqual(2);
      expect(spec.pages.length, spec.id).toBeLessThanOrEqual(8);
      expect(spec.targets.length, spec.id).toBeGreaterThan(0);
      for (const page of spec.pages) expect(page.name.length, page.id).toBeGreaterThan(2);
    }
  });

  it('never reuses an id or a page id', () => {
    expect(new Set(BLUEPRINT_IDS).size).toBe(BLUEPRINT_IDS.length);
    expect(new Set(BLUEPRINT_PAGE_IDS).size).toBe(BLUEPRINT_PAGE_IDS.length);
    // A page belongs to exactly one document, which is what makes a square on one row mean
    // nothing to any other row.
    for (const pageId of BLUEPRINT_PAGE_IDS) expect(blueprintOfPage(pageId)).toBeDefined();
  });

  it('scales the page count with what is at the end of it', () => {
    // §D3 in three samples: the scrap motorbike a district builds in its first week, a mid-yard
    // machine, and the Colossus.
    expect(findBlueprint('bp_motorcycle')?.pages.length).toBe(2);
    expect(findBlueprint('bp_armoured_car')?.pages.length).toBe(4);
    expect(findBlueprint('bp_the_colossus')?.pages.length).toBe(8);
  });

  it('splits into the three categories, each with something in it (§D11)', () => {
    for (const category of BLUEPRINT_CATEGORIES) {
      expect(blueprintsOfCategory(category).length, category).toBeGreaterThan(0);
    }
    const counted = BLUEPRINT_CATEGORIES.reduce(
      (total, category) => total + blueprintsOfCategory(category).length,
      0,
    );
    expect(counted).toBe(BLUEPRINTS.length);
  });
});

/**
 * Where a page lives when the browser is shut.
 *
 * `db/repos/bases.ts` reads a stored satchel back through `knownKeys(json, id => id in
 * ITEM_CATALOG)`, so a page id the catalogue has never heard of is dropped silently on load. That
 * predicate is the whole persistence contract for this feature, and it is asserted here in the
 * same shape the repo writes it.
 */
describe('pages persist because they are items', () => {
  it('puts every page and every finished document in the item catalogue', () => {
    for (const pageId of BLUEPRINT_PAGE_IDS) {
      expect(pageId in ITEM_CATALOG, pageId).toBe(true);
      expect(ITEM_CATALOG[pageId].kind, pageId).toBe('page');
    }
    for (const id of BLUEPRINT_IDS) {
      expect(id in ITEM_CATALOG, id).toBe(true);
      expect(ITEM_CATALOG[id].kind, id).toBe('blueprint');
      // An unlocked blueprint is knowledge somebody has. It does not go back on a barrow.
      expect(ITEM_CATALOG[id].tradeable, id).toBe(false);
    }
  });

  it('round-trips a satchel holding pages and a finished document through the schema', () => {
    const stored = { pg_colossus_hull_sections: 2, bp_motorcycle: 1, scrap_servo: 4 };
    expect(InventorySchema.parse(stored)).toEqual(stored);
  });

  it('names a page after the document it belongs to, so the satchel row means something', () => {
    expect(ITEM_CATALOG.pg_colossus_hull_sections.name).toBe('Colossus Blueprint: Hull Sections');
  });
});

describe('what needs a blueprint (§D12)', () => {
  it('gates the eight named units', () => {
    for (const unitId of [
      'snipers',
      'demolishers',
      'the_twins',
      'cyber_dogs',
      'kite_crews',
      'juggernauts',
      'hollow_men',
      'ironsides',
    ]) {
      expect(blueprintForUnit(unitId), unitId).toBeDefined();
    }
  });

  it('hands Road Reavers the same document as the motorbike, not one of their own (§D12b)', () => {
    const reavers = blueprintForUnit('road_reavers');
    expect(reavers?.id).toBe('bp_motorcycle');
    expect(blueprintForVehicle('motorcycle')?.id).toBe('bp_motorcycle');
  });

  it('gives every vehicle its own (§D12c)', () => {
    const seen = new Set<string>();
    for (const id of VEHICLE_IDS) {
      const spec = blueprintForVehicle(id);
      expect(spec, id).toBeDefined();
      if (spec) seen.add(spec.id);
    }
    expect(seen.size).toBe(VEHICLE_IDS.length);
  });

  it('gates the five uniques (§D12d)', () => {
    for (const unitId of [
      'the_abomination',
      'the_colossus',
      'the_specter',
      'the_crimson_dancer',
      'the_loose_end',
    ]) {
      expect(blueprintForUnit(unitId), unitId).toBeDefined();
    }
  });

  it('gates some of the battle boosts and leaves the open ones open (§D12e)', () => {
    const gated = BATTLE_BOOSTS.filter((boost) => blueprintForBattleBoost(boost.id) !== undefined);
    expect(gated.length).toBeGreaterThan(0);
    expect(gated.length).toBeLessThan(BATTLE_BOOSTS.length);
    // Nothing anybody may buy off the shelf sits behind a document nobody can find yet.
    for (const boost of BATTLE_BOOSTS) {
      if (boost.unlock.kind === 'open')
        expect(blueprintForBattleBoost(boost.id), boost.id).toBeUndefined();
    }
  });

  it('gates the advanced half of every structure and leaves the bolt-ons alone (§D12f)', () => {
    for (const kind of BUILDING_KINDS) {
      const advanced = MODIFICATIONS.filter(
        (spec) => spec.building === kind && spec.magnitude >= ADVANCED_MODIFICATION_MAGNITUDE,
      );
      expect(advanced.length, kind).toBeGreaterThan(0);
      for (const spec of advanced) expect(blueprintForModification(spec), spec.id).toBeDefined();
    }
    const cheap = MODIFICATIONS.filter((spec) => spec.magnitude < ADVANCED_MODIFICATION_MAGNITUDE);
    expect(cheap.length).toBeGreaterThan(0);
    for (const spec of cheap) expect(blueprintForModification(spec), spec.id).toBeUndefined();
  });

  it('answers the modification gate off the whole spec, so a bolt-on stays open', () => {
    const advanced = MODIFICATIONS.find(
      (spec) => spec.building === 'garage' && spec.magnitude >= ADVANCED_MODIFICATION_MAGNITUDE,
    );
    const cheap = MODIFICATIONS.find(
      (spec) => spec.building === 'garage' && spec.magnitude < ADVANCED_MODIFICATION_MAGNITUDE,
    );
    expect(advanced).toBeDefined();
    expect(cheap).toBeDefined();
    if (!advanced || !cheap) return;
    expect(modificationGateMet({}, advanced)).toBe(false);
    expect(modificationGateMet({ bp_garage_retrofit: 1 }, advanced)).toBe(true);
    // The cheap one needs nothing, whatever the satchel holds.
    expect(modificationGateMet({}, cheap)).toBe(true);
  });

  it('gates the upper tiers of every unit upgrade line and not the first (§D12g)', () => {
    for (const upgrade of UNIT_UPGRADES) {
      const gate = blueprintForUnitUpgrade(upgrade.id);
      if (upgrade.tier === 1) expect(gate, upgrade.id).toBeUndefined();
      else expect(gate, upgrade.id).toBeDefined();
    }
  });

  it('names something real with every target it declares', () => {
    const upgradeIds = new Set(UNIT_UPGRADES.map((spec) => spec.id));
    const boostIds = new Set(BATTLE_BOOSTS.map((spec) => spec.id));
    for (const spec of BLUEPRINTS) {
      for (const target of spec.targets) {
        const found =
          target.kind === 'unit'
            ? findUnit(target.id) !== undefined
            : target.kind === 'vehicle'
              ? findVehicle(target.id) !== undefined
              : target.kind === 'unit_upgrade'
                ? upgradeIds.has(target.id)
                : target.kind === 'building'
                  ? (BUILDING_KINDS as readonly string[]).includes(target.id)
                  : boostIds.has(target.id);
        expect(found, `${spec.id} -> ${target.kind}:${target.id}`).toBe(true);
      }
    }
  });

  it('moves the Hollow Men into the wonders of engineering (§D12i)', () => {
    expect(findUnit('hollow_men')?.tier).toBe('wonder');
  });

  it('answers the gate off the satchel, and says what is missing when it is shut', () => {
    expect(blueprintGateMet({}, 'unit', 'razors')).toBe(true);
    expect(blueprintGateMet({}, 'unit', 'snipers')).toBe(false);
    expect(blueprintGateMet({ bp_snipers: 1 }, 'unit', 'snipers')).toBe(true);
    expect(describeBlueprintGate('unit', 'razors')).toBeNull();
    expect(describeBlueprintGate('unit', 'snipers')).toBe('Needs the Sniper Blueprint');
  });
});

describe('what a crew knows about a blueprint (§D5 to §D10)', () => {
  const snipers = findBlueprint('bp_snipers');
  if (!snipers) throw new Error('bp_snipers missing');

  it('does not exist at all with no pages (§D5)', () => {
    expect(blueprintStatus({}, snipers)).toBe('unknown');
    expect(knownBlueprints({})).toEqual([]);
    // Holding a page of something else does not reveal it either.
    expect(knownBlueprints({ pg_colossus_hull_sections: 1 }).map((h) => h.blueprint.id)).toEqual([
      'bp_the_colossus',
    ]);
  });

  it('appears partial with one page, and draws a square per page (§D6)', () => {
    const holding = blueprintHolding({ pg_snipers_range_cards: 1 }, snipers);
    expect(holding.status).toBe('partial');
    expect(holding.distinctHeld).toBe(1);
    expect(holding.pages.map((entry) => entry.held)).toEqual([0, 1, 0]);
  });

  it('is complete, not unlocked, once every page is in (§D9)', () => {
    const inventory = allPagesOf('bp_snipers');
    expect(blueprintStatus(inventory, snipers)).toBe('complete');
    expect(isBlueprintUnlocked(inventory, 'bp_snipers')).toBe(false);
    expect(unlockRefusal(inventory, 'bp_snipers')).toBeNull();
  });

  it('turns the pages into the document, keeping spares (§D10)', () => {
    const inventory = { ...allPagesOf('bp_snipers'), pg_snipers_range_cards: 3 };
    const after = unlockBlueprint(inventory, 'bp_snipers');
    expect(after).not.toBeNull();
    if (!after) return;
    expect(blueprintStatus(after, snipers)).toBe('unlocked');
    expect(after.bp_snipers).toBe(1);
    expect(after.pg_snipers_barrel_liners).toBeUndefined();
    expect(after.pg_snipers_range_cards).toBe(2);
    // Still on the page, in the unlocked list rather than gone.
    expect(knownBlueprints(after).map((holding) => holding.status)).toEqual(['unlocked']);
  });

  it('refuses an unlock it cannot honour, with the reason a player is owed', () => {
    expect(unlockRefusal({}, 'bp_nonsense')).toBe('unknown_blueprint');
    expect(unlockRefusal({ pg_snipers_range_cards: 1 }, 'bp_snipers')).toBe('missing_pages');
    expect(unlockRefusal({ bp_snipers: 1 }, 'bp_snipers')).toBe('already_unlocked');
    expect(unlockBlueprint({ pg_snipers_range_cards: 1 }, 'bp_snipers')).toBeNull();
    expect(unlockBlueprint({}, 'bp_nonsense')).toBeNull();
  });

  it('leaves a satchel alone when it unlocks', () => {
    const inventory = allPagesOf('bp_snipers');
    const snapshot = { ...inventory };
    unlockBlueprint(inventory, 'bp_snipers');
    expect(inventory).toEqual(snapshot);
  });
});

describe('the Reimagining seam (§G4)', () => {
  it('stays locked until both requirements are met, and says which is missing', () => {
    const none = { hasHeadOfResearch: false, hasReimaginingResearch: false };
    expect(reimaginingAvailable(none)).toBe(false);
    expect(reimaginingRequirements(none).every((line) => !line.met)).toBe(true);

    const halfway = { hasHeadOfResearch: true, hasReimaginingResearch: false };
    expect(reimaginingAvailable(halfway)).toBe(false);
    expect(reimaginingRequirements(halfway).map((line) => line.met)).toEqual([true, false]);

    expect(reimaginingAvailable({ hasHeadOfResearch: true, hasReimaginingResearch: true })).toBe(
      true,
    );
  });

  it('states the price the trade will ask (§G2)', () => {
    expect(REIMAGINING_PAGES_SPENT).toBe(3);
  });

  it('counts a duplicate as spare, and every copy of a page of a finished document', () => {
    expect(sparePages({ pg_snipers_range_cards: 1 })).toEqual([]);
    expect(sparePages({ pg_snipers_range_cards: 3 })).toEqual([
      { pageId: 'pg_snipers_range_cards', spare: 2 },
    ]);
    expect(sparePages({ bp_snipers: 1, pg_snipers_range_cards: 1 })).toEqual([
      { pageId: 'pg_snipers_range_cards', spare: 1 },
    ]);
  });
});
