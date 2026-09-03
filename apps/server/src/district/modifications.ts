import {
  MODIFICATIONS,
  addonsOf,
  canAfford,
  clearSlotRefusal,
  findBuilding,
  fitSlotRefusal,
  researchCost,
  withModificationFitted,
  withSlotEmptied,
  type Base,
  type Building,
  type BuildingKind,
  type ClearSlotRefusal,
  type ModificationBlocker,
  type ModificationOption,
  type ModificationSpec,
  type SlotRefusalReason,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Which modifications this district could actually start work on, and why not for the rest
 * (GDD §A1, §C4, §B9, §E).
 *
 * One function, read by both the research screen and the start route, so the reason a button is
 * dead is by construction the reason the server would give: the client never re-derives a gate.
 *
 * ## What a Lab project produces now
 *
 * A **blueprint**, not a fitted modification (§B9). The Scrapyard builds the thing and the
 * structure's own dialog fits it (§E). Two gates went with that change, and both had to:
 *
 * - **`no_slot` is gone.** It refused a project when every open bracket was full, which was right
 *   when the project ended by bolting the thing in and is wrong now: a crew with three fitted
 *   modifications is exactly the crew that wants a fourth design to swap in.
 * - **"already installed" became "already drawn".** A crew that has taken a modification out of a
 *   wall still owns the drawing, and offering them the project again would sell them the same
 *   piece of paper twice.
 */

/** §C4: modification work is the Lead Engineer's. Named once rather than spelled at each check. */
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
  if (isModificationDrawn(base, spec.id)) return 'already_drawn';
  if (!hasLeadEngineer(base)) return 'no_lead_engineer';
  if (base.research.active) return 'research_busy';
  return canAfford(base.resources, researchCost('modification')) ? null : 'cannot_afford';
}

/**
 * Whether the crew already holds this drawing.
 *
 * Reads the shelf **and** what is bolted on: a district that fitted a modification before §B9
 * existed has it in `addons.researched` too (migration 0056 backfills), but a fresh fit from a
 * peer's save or a hand-built fixture might not, and offering the project again would be a second
 * charge for the same paper.
 */
export function isModificationDrawn(base: Base, id: string): boolean {
  return (
    addonsOf(base).researched.includes(id) ||
    base.buildings.some((building) => building.modifications.includes(id))
  );
}

/** The whole catalogue as the research screen shows it, in catalogue order. */
export function modificationOptions(base: Base): ModificationOption[] {
  return MODIFICATIONS.map((spec) => {
    const installed = isModificationDrawn(base, spec.id);
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
 * §E: putting one of the crew's built add-ons into a structure's first free slot.
 *
 * Both halves of §E are one transaction each and neither charges anything: the Scrapyard already
 * took the scrap, and a refit fee on a decision this small is a wait with nothing on the other
 * side of it. The same argument `POST /units/loadout` makes about unit brackets.
 */
export function fitIntoSlot(
  repos: Repositories,
  base: Base,
  kind: BuildingKind,
  modificationId: string,
): { kind: 'refused'; reason: SlotRefusalReason } | { kind: 'fitted'; base: Base } {
  const reason = fitSlotRefusal({
    kind,
    modificationId,
    buildings: base.buildings,
    addons: addonsOf(base),
  });
  if (reason !== null) return { kind: 'refused', reason };

  const buildings = withModificationFitted(base.buildings, kind, modificationId);
  repos.bases.updateDistrict(base.id, buildings, base.buildQueue);
  return { kind: 'fitted', base: { ...base, buildings } };
}

/** §E: taking one out again. It goes back on the shelf, which is what `addons.built` already says. */
export function clearSlot(
  repos: Repositories,
  base: Base,
  kind: BuildingKind,
  slot: number,
): { kind: 'refused'; reason: ClearSlotRefusal } | { kind: 'cleared'; base: Base } {
  const reason = clearSlotRefusal(kind, slot, base.buildings);
  if (reason !== null) return { kind: 'refused', reason };

  const buildings = withSlotEmptied(base.buildings, kind, slot);
  repos.bases.updateDistrict(base.id, buildings, base.buildQueue);
  return { kind: 'cleared', base: { ...base, buildings } };
}
