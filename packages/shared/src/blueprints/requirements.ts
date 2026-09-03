import { ADVANCED_MODIFICATION_MAGNITUDE } from '../building/addons.js';
import type { ModificationSpec } from '../building/modifications.js';
import type { Inventory } from '../items/inventory.js';
import { BLUEPRINTS, type BlueprintSpec, type BlueprintTargetKind } from './catalog.js';
import { isBlueprintUnlocked } from './state.js';

/**
 * Which blueprint gates a given thing (GDD §D12).
 *
 * The mapping lives on the blueprint, not on the unit or the machine or the add-on. One document
 * can gate more than one thing (§D12b: the motorbike and the Road Reavers who ride it), and a
 * field on each of those catalogues would have written that fact down twice and left the two
 * copies free to disagree. So the catalogue declares its `targets` and this module indexes them.
 *
 * `blueprints.test.ts` checks the other half: that every id named in a target is a real unit,
 * vehicle, upgrade, structure or boost, and that §D12's list is covered.
 */
const BY_TARGET = new Map<string, BlueprintSpec>(
  BLUEPRINTS.flatMap((spec) =>
    spec.targets.map((target) => [`${target.kind}:${target.id}`, spec] as const),
  ),
);

export function blueprintForTarget(
  kind: BlueprintTargetKind,
  id: string,
): BlueprintSpec | undefined {
  return BY_TARGET.get(`${kind}:${id}`);
}

export function blueprintForUnit(unitId: string): BlueprintSpec | undefined {
  return blueprintForTarget('unit', unitId);
}

export function blueprintForVehicle(vehicleId: string): BlueprintSpec | undefined {
  return blueprintForTarget('vehicle', vehicleId);
}

export function blueprintForUnitUpgrade(upgradeId: string): BlueprintSpec | undefined {
  return blueprintForTarget('unit_upgrade', upgradeId);
}

export function blueprintForBattleBoost(boostId: string): BlueprintSpec | undefined {
  return blueprintForTarget('battle_boost', boostId);
}

/**
 * §D12f: almost all building upgrades need a blueprint.
 *
 * "Almost all" is the advanced half of each structure's five modifications, which is a line the
 * Scrapyard already draws (`ADVANCED_MODIFICATION_MAGNITUDE`) and which already decides which of
 * them cost high-quality metal. Reusing it means a player learns one threshold rather than two,
 * and the small bolt-ons stay open to a district with nothing in its satchel.
 */
export function blueprintForModification(spec: ModificationSpec): BlueprintSpec | undefined {
  if (spec.magnitude < ADVANCED_MODIFICATION_MAGNITUDE) return undefined;
  return blueprintForTarget('building', spec.building);
}

/**
 * The modification half of {@link blueprintGateMet}, and the one to reach for.
 *
 * Asking `blueprintGateMet(inventory, 'building', 'garage')` answers "does this crew hold the
 * Garage retrofit", which is the right question only about an *advanced* modification. A caller
 * that asked it about a cheap bolt-on would gate something §D12f leaves open, so the check that
 * takes the whole spec is the one the Scrapyard should call.
 */
export function modificationGateMet(inventory: Inventory, spec: ModificationSpec): boolean {
  const blueprint = blueprintForModification(spec);
  return blueprint === undefined || isBlueprintUnlocked(inventory, blueprint.id);
}

/**
 * Whether the crew may build this thing as far as blueprints are concerned.
 *
 * True when nothing gates it, which is most of the catalogue: this answers only the blueprint
 * clause, and every other gate (a Garage level, a Gauntlet level, a location, the bill) is still
 * the caller's to check.
 */
export function blueprintGateMet(
  inventory: Inventory,
  kind: BlueprintTargetKind,
  id: string,
): boolean {
  const spec = blueprintForTarget(kind, id);
  return spec === undefined || isBlueprintUnlocked(inventory, spec.id);
}

/** The line a refusal prints, or null when nothing gates this. */
export function describeBlueprintGate(kind: BlueprintTargetKind, id: string): string | null {
  const spec = blueprintForTarget(kind, id);
  return spec === undefined ? null : `Needs the ${spec.name}`;
}
