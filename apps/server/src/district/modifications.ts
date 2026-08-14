import {
  MODIFICATIONS,
  canAfford,
  findBuilding,
  findModification,
  modificationCapacity,
  researchCost,
  type Base,
  type Building,
  type ModificationBlocker,
  type ModificationOption,
  type ModificationSpec,
} from '@frontline/shared';

/**
 * Which of the sixty-five modifications this district could actually start, and why not for the
 * rest (GDD §A1, §C4).
 *
 * One function, read by both the research screen and the start route, so the reason a button is
 * dead is by construction the reason the server would give — the client never re-derives a gate.
 */

/** §C4 — modification work is the Lead Engineer's. Named once rather than spelled at each check. */
export const MODIFICATION_ROLE = 'lead_engineer' as const;

export function hasLeadEngineer(base: Base): boolean {
  return base.commanders.some((officer) => officer.role === MODIFICATION_ROLE);
}

/**
 * The first thing standing between this district and this modification, or `null` when nothing is.
 *
 * Checked most-structural first, so a player is told to build the Lab before they are told they
 * cannot afford to modify it.
 */
export function modificationBlocker(
  base: Base,
  spec: ModificationSpec,
): ModificationBlocker | null {
  const standing: Building | undefined = findBuilding(base.buildings, spec.building);
  if (!standing) return 'not_built';
  if (standing.modifications.includes(spec.id)) return null;
  if (modificationCapacity(standing).free <= 0) return 'no_slot';
  if (!hasLeadEngineer(base)) return 'no_lead_engineer';
  if (base.research.active) return 'research_busy';
  return canAfford(base.resources, researchCost('modification')) ? null : 'cannot_afford';
}

export function isModificationInstalled(base: Base, id: string): boolean {
  return base.buildings.some((building) => building.modifications.includes(id));
}

/** The whole catalogue as the research screen shows it, in catalogue order. */
export function modificationOptions(base: Base): ModificationOption[] {
  return MODIFICATIONS.map((spec) => {
    const installed = isModificationInstalled(base, spec.id);
    return {
      id: spec.id,
      building: spec.building,
      name: spec.name,
      description: spec.description,
      effect: spec.effect,
      magnitude: spec.magnitude,
      installed,
      blocker: installed ? null : modificationBlocker(base, spec),
    };
  });
}

/**
 * `buildings` with `id` fitted to the structure it belongs to.
 *
 * Returns the list unchanged when there is nowhere to put it — the structure was demolished, or
 * the slot was filled by something else, between starting the work and finishing it. A project
 * that lands with nowhere to go is a rare edge, not an exception: the crew did the work, and the
 * settle has to complete either way rather than leaving the project running forever.
 */
export function fitModification(buildings: readonly Building[], id: string): Building[] {
  const spec = findModification(id);
  if (!spec) return [...buildings];
  return buildings.map((building) => {
    if (building.kind !== spec.building) return building;
    if (building.modifications.includes(id)) return building;
    if (modificationCapacity(building).free <= 0) return building;
    return { ...building, modifications: [...building.modifications, id] };
  });
}
