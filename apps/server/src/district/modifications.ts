import {
  clearSlotRefusal,
  withSlotEmptied,
  type Base,
  type BuildingKind,
  type ClearSlotRefusal,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Emptying a structure's modification brackets (GDD §E).
 *
 * Filling one is the Scrapyard's own job as of 2026-09-16: the bench cuts a card for a named
 * structure and bolts it straight in, so the fit half of this module is gone and nothing here
 * re-derives a gate.
 */

/**
 * §E: taking one out again, which destroys it.
 *
 * The only half left. A card is cut for a named structure and bolted in by the same press now
 * (`district/scrapyard.ts`), so there is no shelf for this to put one back on: what comes out is
 * gone, and putting the same card back means paying for it again. That is the whole weight behind
 * choosing which three of a structure's cards to wear.
 */
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
