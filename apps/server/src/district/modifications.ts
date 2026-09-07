import {
  addonsOf,
  clearSlotRefusal,
  fitSlotRefusal,
  withModificationFitted,
  withSlotEmptied,
  type Base,
  type BuildingKind,
  type ClearSlotRefusal,
  type SlotRefusalReason,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Fitting and clearing a structure's modification brackets (GDD §E).
 *
 * The Scrapyard builds an add-on onto the crew's shelf and this puts one into a bracket. Whether it
 * *can* be built is the yard's own question and is answered in `scrapyard.ts`, so nothing here
 * re-derives a gate.
 */

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
