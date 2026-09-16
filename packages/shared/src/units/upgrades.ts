import { z } from 'zod';
import type { ItemCost } from '../items/inventory.js';
import {
  findUnitModification,
  unitModificationBlueprintMet,
  type UnitModificationBlueprintGate,
  type UnitModificationSpec,
} from './modifications.js';
import { capRating, UNIT_FIGURE_KEYS, UNIT_STAT_KEYS, type UnitStats } from './stats.js';

/**
 * What the Scrapyard's unit bench does to a roster (GDD §A5).
 *
 * Training gives you *more* of a unit. A modification card gives you a *better* one, and it is
 * the sink that makes scrap matter past the early game. The cards themselves live in
 * `modifications.ts`; this module is the two rules every door onto them shares: whether the yard
 * will cut one ({@link upgradeRefusal}) and what a fitted set does to a sheet ({@link
 * upgradedStats}).
 *
 * ## History
 *
 * This file used to hold `UNIT_UPGRADES`: twelve tiered refits in four lines, each rung needing
 * the rung below it and a Gauntlet level of its own. The maintainer retired that model on
 * 2026-09-15 for the thirty cards in `modifications.ts`, and everything that only existed for the
 * ladder went with it: `UPGRADE_LINES`, `upgradesInLine`, `findUpgrade`, the
 * `needs_previous_tier` and `gauntlet_too_low` refusals, and the `requiresGauntletLevel` gate.
 * The blueprint document and the yard's level are the whole gate now.
 *
 * ## Everything costs scrap
 *
 * That is the maintainer's rule and it is a good one: scrap is the material the city is made of,
 * so every physical improvement comes out of the same pile that the buildings do. High-quality
 * metal appears from INTRICATE up, components on every card the yard needs drawings for. **Scrap
 * and metal are the only two resources on the bill** (§B9), because these are built in the
 * Scrapyard and that page shows no other.
 */

/** What a crew has built. Order does not matter; the set does. */
export const FittedUpgradesSchema = z.array(z.string());
export type FittedUpgrades = readonly string[];

/**
 * Why the yard will not build this yet.
 *
 * A tuple rather than a bare union so the strings are readable at runtime: the testing build's
 * waiver list quotes refusals by name, and it has no way to check itself against a type.
 */
export const UPGRADE_REFUSALS = [
  'unknown_upgrade',
  'already_fitted',
  /** The Scrapyard itself is not senior enough to cut this rarity (§B9's ladder). */
  'yard_too_low',
  'needs_blueprint',
  'cannot_afford',
  'missing_parts',
] as const;
export type UpgradeRefusal = (typeof UPGRADE_REFUSALS)[number];

/**
 * Whether the crew holds the blueprint document that gates a card, by card id.
 *
 * Pass `(id) => blueprintGateMet(inventory, 'unit_upgrade', id)`. The card's own
 * `requiresBlueprint` is consulted first, so the three open cards never ask the inventory at all.
 */
export type UpgradeBlueprintGate = UnitModificationBlueprintGate;

/**
 * The order the checks run in is the order a player wants to hear them.
 *
 * "You need the blueprint" is more useful than "you cannot afford it" when both are true, because
 * one of them is a thing you can go and do something about today and the other is a number that
 * will fix itself. Cheapest-to-check-first would put them the other way round. Money is last for
 * the same reason, behind the parts: a missing part is an errand and a missing pile of scrap is a
 * wait.
 *
 * ## The order is the Scrapyard's, because the Scrapyard asks this
 *
 * It was not, for a while. The yard had its own copy of these gates and this one had no idea the
 * yard has a level, so the two answered differently and nothing noticed: `upgradeRefusal`'s only
 * caller was its own test file, so every assertion here was checking a function the game did not
 * run. `district/scrapyard.ts` now words this function's answer rather than deciding it, and
 * `scrapyard.test.ts` holds the two together across the whole catalogue.
 *
 * Arguments in a bag rather than in a row, because a call site reading
 * `upgradeRefusal(id, [], 4, gate, afford, parts)` cannot be checked by eye.
 */
export function upgradeRefusal(input: {
  id: string;
  fitted: FittedUpgrades;
  /** The Scrapyard's own level, which gates the dearer rarities before anything else does. */
  yardLevel: number;
  requiredYardLevel: (spec: UnitModificationSpec) => number;
  blueprintUnlocked: UpgradeBlueprintGate;
  affordable: (spec: UnitModificationSpec) => boolean;
  hasParts: (parts: ItemCost) => boolean;
}): UpgradeRefusal | null {
  const { id, fitted, yardLevel, requiredYardLevel, blueprintUnlocked, affordable, hasParts } =
    input;

  const spec = findUnitModification(id);
  if (!spec) return 'unknown_upgrade';
  if (fitted.includes(id)) return 'already_fitted';
  // The yard's own level, before the document: a crew four pages short of the drawings and three
  // levels short of the yard has to raise the yard first either way.
  if (yardLevel < requiredYardLevel(spec)) return 'yard_too_low';
  if (!unitModificationBlueprintMet(spec, blueprintUnlocked)) return 'needs_blueprint';
  if (!hasParts(spec.parts)) return 'missing_parts';
  return affordable(spec) ? null : 'cannot_afford';
}

/**
 * Every fitted card, folded onto a unit's sheet.
 *
 * Applied at read time rather than written into the roster, so a card bolted on today improves
 * the units trained last week, which is what "the yard refits everyone" means, and the only
 * version a player will not find infuriating. Clamped to each stat's own range on the way out.
 */
export function upgradedStats(base: UnitStats, fitted: FittedUpgrades): UnitStats {
  /*
   * Summed first, clamped once, and that ordering is the whole of the fix here.
   *
   * The clamp used to run inside the loop, so a rating that touched the ceiling lost the headroom a
   * later negative delta would have given back, and the answer depended on the *order* the cards
   * happened to be fitted in. A unit on 95 speed with a card that costs 3 speed, one that adds 12
   * and a third that adds nothing: speed-first is 95 -> 107 -> clamp 100 -> 97; cost-first is
   * 95 -> 92 -> 104 -> clamp 100. Three points of speed decided by which bracket the player dropped
   * a card into, with nothing on the screen saying bracket order means anything and this module's
   * own doc saying the opposite ("Order does not matter; the set does"). Speed feeds
   * `engagementMultiplier` and, since the speed rebalance, both roads as well
   * (`units/catalog.ts`, `unitColumnSpeed`), so those points are real twice over.
   */
  const totals: Partial<Record<(typeof UNIT_STAT_KEYS)[number], number>> = {};
  for (const id of fitted) {
    const spec = findUnitModification(id);
    if (!spec) continue;
    for (const key of UNIT_STAT_KEYS) {
      const delta = spec.effect[key];
      if (delta === undefined) continue;
      totals[key] = (totals[key] ?? 0) + delta;
    }
  }

  const next: UnitStats = { ...base };
  for (const key of UNIT_STAT_KEYS) {
    const delta = totals[key];
    if (delta === undefined) continue;
    /*
     * The ceiling applies to **ratings only**, and which stats those are is read off
     * `UNIT_FIGURE_KEYS` rather than listed here.
     *
     * It used to name `lootCapacity` as the single exception, and that quietly became wrong the
     * day damage and hit points stopped being ratings: a Razor on 160 damage fitted with the
     * cheapest weapons card came out on 100, so the yard's cheapest card *halved* the unit it was
     * bolted to, and every sheet in the game converged on 100 the moment anything was slotted onto
     * it.
     *
     * `range` is not an exception and must not become one. Both of its readers treat it as a
     * rating: `matchup.ts` clamps `range - speed` into 0..100, and `rangedShare` divides it by
     * 100 to produce a share it documents as 0..1. An uncapped range once put a Sniper on 109,
     * which drew a bar past the end of its own track on the roster and handed the engine a share
     * of 1.09.
     */
    const raw = next[key] + delta;
    const rating = !(UNIT_FIGURE_KEYS as readonly string[]).includes(key);
    // The ceiling itself is `capRating`'s, so this line and the battlefield's agree by construction.
    next[key] = Math.round(rating ? capRating(raw) : Math.max(0, raw));
  }
  return next;
}
