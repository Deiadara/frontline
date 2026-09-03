import {
  removeItems,
  ITEM_CATALOG,
  MODIFICATIONS,
  UNIT_UPGRADES,
  addonsOf,
  blueprintForModification,
  blueprintForUnitUpgrade,
  blueprintGateMet,
  buildingLevel,
  canAfford,
  describeAddonEffect,
  findModification,
  findUpgrade,
  isAdvancedModification,
  isAdvancedUpgrade,
  modificationGateMet,
  modificationPrice,
  spendResources,
  upgradePrice,
  type Base,
  type ItemId,
  type ModificationSpec,
  type ScrapyardEntry,
  type ScrapyardResponse,
  type UpgradeSpec,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * The Scrapyard's own page (§B9).
 *
 * One list of everything the yard can turn out: the fifty-five building modifications and the nine
 * unit upgrades, side by side, because they are the same kind of object to a player. Both are a
 * permanent thing bolted to something they already own, both cost scrap and, past the cheap end,
 * high-quality metal, and both mostly want a blueprint first.
 *
 * **No other resource appears on this page**, which is the board's rule and is enforced by
 * `modificationPrice` and `upgradePrice` rather than trusted: neither can return a caps line.
 *
 * What the yard does *not* do is fit anything. A built modification goes on the shelf
 * (`Base.addons.built`) and is put into a slot from the structure's own dialog, which is §E.
 */

/** The Scrapyard has to be standing to build anything: this is its shop. */
export const SCRAPYARD_REQUIRED_LEVEL = 1;

/**
 * The document a Scrapyard entry is behind (§D12f, §D12g), named, or null when nothing gates it.
 *
 * One function for both halves of the board because a player reads one word: the drawings the
 * yard cannot cut metal without. Which document it is comes off `blueprints/catalog.ts`, so the
 * name here and the name on the Blueprints page are the same string.
 */
function documentFor(spec: ModificationSpec | UpgradeSpec): string | null {
  const document =
    'magnitude' in spec ? blueprintForModification(spec) : blueprintForUnitUpgrade(spec.id);
  return document?.name ?? null;
}

function upgradeBlockerFor(base: Base, spec: UpgradeSpec): string | null {
  if (base.fittedUpgrades.includes(spec.id)) return null;
  const previous = UNIT_UPGRADES.find(
    (other) => other.line === spec.line && other.tier === spec.tier - 1,
  );
  if (previous && !base.fittedUpgrades.includes(previous.id)) return `Build ${previous.name} first`;
  if (!blueprintGateMet(base.inventory, 'unit_upgrade', spec.id)) {
    return `Needs the ${documentFor(spec)}`;
  }
  if (buildingLevel(base.buildings, 'gauntlet') < spec.requiresGauntletLevel) {
    return `Needs the Gauntlet at level ${spec.requiresGauntletLevel}`;
  }
  /*
   * The same parts the Workshop asks for, because it is the same upgrade.
   *
   * Both doors write `fittedUpgrades`, which is permanent and roster-wide. The Workshop requires
   * `spec.parts` and consumes them; this one asked for neither, so the cheaper door bought the
   * same thing with the parts still in the satchel and the Workshop's refusal became advice. The
   * resource prices stay different on purpose (§B9: the Scrapyard is scrap and sometimes
   * high-quality metal); it is the parts, a designed sink, that cannot have a free door beside it.
   */
  const missing = Object.entries(spec.parts).find(
    ([item, count]) => (base.inventory[item as ItemId] ?? 0) < count,
  );
  if (missing) {
    const [item, count] = missing;
    return `Needs ${count} ${ITEM_CATALOG[item as ItemId]?.name ?? item}`;
  }
  return canAfford(base.resources, upgradePrice(spec)) ? null : 'You cannot cover that';
}

/**
 * Two drawings, and the advanced half of every structure wants both (§D12f).
 *
 * The **document** first: it is the structure's retrofit blueprint, collected page by page, and it
 * gates all five of that structure's advanced modifications at once. A crew short of pages gets
 * nothing out of running the Lab project, so telling them about the project first would send them
 * to the wrong building. The Lab project second, then the money, which is the order
 * `modificationBuildRefusal` states as the rule.
 */
function modificationBlockerFor(base: Base, id: string): string | null {
  const spec = findModification(id);
  if (!spec) return 'No such add-on';
  if (!modificationGateMet(base.inventory, spec)) return `Needs the ${documentFor(spec)}`;
  if (isAdvancedModification(spec) && !addonsOf(base).researched.includes(spec.id)) {
    return `Needs the ${spec.name} drawn up in the Lab`;
  }
  return canAfford(base.resources, modificationPrice(spec)) ? null : 'You cannot cover that';
}

export function projectScrapyard(base: Base): ScrapyardResponse {
  const addons = addonsOf(base);
  const owned = (id: string): number => addons.built.filter((built) => built === id).length;

  const modifications: ScrapyardEntry[] = MODIFICATIONS.map((spec) => ({
    id: spec.id,
    kind: 'modification' as const,
    name: spec.name,
    description: spec.description,
    building: spec.building,
    effect: describeAddonEffect(spec),
    cost: modificationPrice(spec),
    advanced: isAdvancedModification(spec),
    blueprint: documentFor(spec),
    owned: owned(spec.id),
    blocker: modificationBlockerFor(base, spec.id),
  }));

  const upgrades: ScrapyardEntry[] = UNIT_UPGRADES.map((spec) => ({
    id: spec.id,
    kind: 'upgrade' as const,
    name: spec.name,
    description: spec.description,
    building: null,
    effect: describeAddonEffect(spec),
    cost: upgradePrice(spec),
    advanced: isAdvancedUpgrade(spec),
    blueprint: documentFor(spec),
    owned: base.fittedUpgrades.includes(spec.id) ? 1 : 0,
    blocker: base.fittedUpgrades.includes(spec.id) ? null : upgradeBlockerFor(base, spec),
  }));

  return {
    scrapyardLevel: buildingLevel(base.buildings, 'scrapyard'),
    resources: base.resources,
    entries: [...modifications, ...upgrades],
  };
}

export type AddonBuildResult = { kind: 'refused'; reason: string } | { kind: 'built'; base: Base };

/**
 * Builds one add-on: takes the scrap, and puts the thing on the shelf.
 *
 * A modification goes into `addons.built` and waits for a slot; a unit upgrade goes straight into
 * `fittedUpgrades`, which is where the roster already reads it from. The asymmetry is the two
 * things themselves rather than an inconsistency: a modification lives in one of three brackets on
 * one structure, and a unit upgrade is a pattern the whole roster works from.
 */
export function buildAddon(
  repos: Repositories,
  base: Base,
  kind: 'modification' | 'upgrade',
  id: string,
): AddonBuildResult {
  if (buildingLevel(base.buildings, 'scrapyard') < SCRAPYARD_REQUIRED_LEVEL) {
    return { kind: 'refused', reason: 'Build the Scrapyard first' };
  }

  if (kind === 'modification') {
    const spec = findModification(id);
    if (!spec) return { kind: 'refused', reason: 'No such add-on' };
    const blocker = modificationBlockerFor(base, id);
    if (blocker !== null) return { kind: 'refused', reason: blocker };

    const addons = addonsOf(base);
    const built: Base = {
      ...base,
      resources: spendResources(base.resources, modificationPrice(spec)),
      addons: { ...addons, built: [...addons.built, spec.id] },
    };
    repos.bases.updateResources(built.id, built.resources);
    repos.bases.updateAddons(built.id, built.addons ?? addons);
    return { kind: 'built', base: built };
  }

  const spec = findUpgrade(id);
  if (!spec) return { kind: 'refused', reason: 'No such add-on' };
  if (base.fittedUpgrades.includes(spec.id)) return { kind: 'refused', reason: 'Already built' };
  const blocker = upgradeBlockerFor(base, spec);
  if (blocker !== null) return { kind: 'refused', reason: blocker };

  const built: Base = {
    ...base,
    resources: spendResources(base.resources, upgradePrice(spec)),
    // Spent, not merely checked. A requirement that is verified and never consumed is a one-off
    // toll that buys every upgrade in the line for ever.
    inventory: removeItems(base.inventory, spec.parts),
    fittedUpgrades: [...base.fittedUpgrades, spec.id],
  };
  repos.bases.updateHoldings(built.id, built.resources, built.inventory);
  repos.bases.updateUpgrades(built.id, built.fittedUpgrades);
  return { kind: 'built', base: built };
}
