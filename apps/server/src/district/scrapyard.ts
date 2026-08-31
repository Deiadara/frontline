import {
  ITEM_CATALOG,
  MODIFICATIONS,
  UNIT_UPGRADES,
  addonBlueprintName,
  addonsOf,
  buildingLevel,
  canAfford,
  describeAddonEffect,
  findModification,
  findUpgrade,
  isAdvancedModification,
  isAdvancedUpgrade,
  modificationPrice,
  spendResources,
  upgradePrice,
  type Base,
  type ItemId,
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

function upgradeBlockerFor(base: Base, spec: UpgradeSpec): string | null {
  if (base.fittedUpgrades.includes(spec.id)) return null;
  const previous = UNIT_UPGRADES.find(
    (other) => other.line === spec.line && other.tier === spec.tier - 1,
  );
  if (previous && !base.fittedUpgrades.includes(previous.id)) return `Build ${previous.name} first`;
  const blueprint = addonBlueprintName(spec);
  if (blueprint !== null && (base.inventory[blueprint as ItemId] ?? 0) <= 0) {
    return `Needs the ${ITEM_CATALOG[blueprint as ItemId]?.name ?? blueprint}`;
  }
  if (buildingLevel(base.buildings, 'gauntlet') < spec.requiresGauntletLevel) {
    return `Needs the Gauntlet at level ${spec.requiresGauntletLevel}`;
  }
  return canAfford(base.resources, upgradePrice(spec)) ? null : 'You cannot cover that';
}

function modificationBlockerFor(base: Base, id: string): string | null {
  const spec = findModification(id);
  if (!spec) return 'No such add-on';
  if (isAdvancedModification(spec) && !addonsOf(base).researched.includes(spec.id)) {
    return `Needs the ${spec.name} blueprint out of the Lab`;
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
    blueprint: addonBlueprintName(spec),
    owned: owned(spec.id),
    blocker: modificationBlockerFor(base, spec.id),
  }));

  const upgrades: ScrapyardEntry[] = UNIT_UPGRADES.map((spec) => {
    const blueprint = addonBlueprintName(spec);
    return {
      id: spec.id,
      kind: 'upgrade' as const,
      name: spec.name,
      description: spec.description,
      building: null,
      effect: describeAddonEffect(spec),
      cost: upgradePrice(spec),
      advanced: isAdvancedUpgrade(spec),
      blueprint: blueprint === null ? null : (ITEM_CATALOG[blueprint as ItemId]?.name ?? blueprint),
      owned: base.fittedUpgrades.includes(spec.id) ? 1 : 0,
      blocker: base.fittedUpgrades.includes(spec.id) ? null : upgradeBlockerFor(base, spec),
    };
  });

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
    fittedUpgrades: [...base.fittedUpgrades, spec.id],
  };
  repos.bases.updateResources(built.id, built.resources);
  repos.bases.updateUpgrades(built.id, built.fittedUpgrades);
  return { kind: 'built', base: built };
}
