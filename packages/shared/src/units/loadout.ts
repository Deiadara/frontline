import { z } from 'zod';
import { findUnitModification, modificationFitsUnit } from './modifications.js';
import type { FittedUpgrades } from './upgrades.js';

/**
 * Three slots on every unit, and what a crew is allowed to put in them.
 *
 * The Scrapyard *builds* a modification card once (`fittedUpgrades`, which is the crew's stock).
 * This is the other half: which three of the things you have built are actually bolted onto the
 * Razors, and which three onto the Juggernauts. Building a Hardshell Exoframe does not improve
 * everybody by itself; it improves whoever you fit it to.
 *
 * That is the whole point of a slot. Thirty cards applied to every unit type is not a decision,
 * it is a shopping list you work through in one order every game. Three slots per unit means the
 * Sparks can be the ones with the optics and the Scrapers the ones with the twitch loop, and a
 * crew that has built everything still has to say what each unit is *for*.
 *
 * Which cards a unit may take at all is `modificationFitsUnit` in `modifications.ts`: a card's
 * `fits` list, and the rule that a legendary takes nothing. {@link slotRefusal} asks it, so the
 * roster's greyed-out cards and the route's refusal are one answer.
 */

export const UNIT_UPGRADE_SLOTS = 3;

/** A slot is a card id or an empty bracket. Length is capped; short arrays pad on read. */
export const UnitLoadoutSchema = z.array(z.string().nullable()).max(UNIT_UPGRADE_SLOTS);

/**
 * Keyed by unit id, and deliberately not one entry per unit in the catalogue: a crew that has
 * fitted nothing to the Juggernauts has no Juggernaut key, and a unit added to the catalogue
 * tomorrow reads as three empty slots rather than as a parse failure on every stored district.
 */
export const UnitLoadoutsSchema = z.record(z.string(), UnitLoadoutSchema);
export type UnitLoadouts = z.infer<typeof UnitLoadoutsSchema>;

/** The three brackets, padded, so the UI never has to think about a short array. */
export function slotsFor(loadouts: UnitLoadouts, unitId: string): (string | null)[] {
  const stored = loadouts[unitId] ?? [];
  return Array.from({ length: UNIT_UPGRADE_SLOTS }, (_, index) => stored[index] ?? null);
}

/**
 * What is actually bolted to this unit, in a shape `upgradedStats` accepts.
 *
 * Filtered against the catalogue on the way out, so an id left over from a card that was renamed
 * or dropped costs a slot on screen but never silently pays stats.
 */
export function fittedFor(loadouts: UnitLoadouts, unitId: string): FittedUpgrades {
  const seen = new Set<string>();
  for (const id of slotsFor(loadouts, unitId)) {
    if (id !== null && findUnitModification(id)) seen.add(id);
  }
  return [...seen];
}

export type SlotRefusal =
  | 'bad_slot'
  | 'unknown_upgrade'
  /** The card does not go on this unit: outside its `fits` list, or the unit is a legendary. */
  | 'does_not_fit'
  | 'not_built'
  | 'already_slotted'
  | 'slot_taken'
  | 'skipped_slot';

/**
 * The first empty bracket in a row of them, or null when every one is full.
 *
 * Brackets fill from the left (maintainer request, 2026-09-15): whichever bracket a player
 * presses, the card goes into the first free one, so three empty brackets are one decision and
 * not three. Over the bare id row rather than over `UnitLoadouts`, so the client can ask it of the
 * slots the wire hands it and land on the same index the server will insist on.
 */
export function firstFreeIndex(slots: readonly (string | null)[]): number | null {
  const index = slots.findIndex((id) => id === null);
  return index === -1 ? null : index;
}

/** {@link firstFreeIndex}, asked of a stored loadout. */
export function firstFreeSlot(loadouts: UnitLoadouts, unitId: string): number | null {
  return firstFreeIndex(slotsFor(loadouts, unitId));
}

/**
 * Every unit id this crew has bolted `upgradeId` to. Empty when it is still on the shelf.
 *
 * The whole roster, not one unit, and that is the rule: a modification is **one object**. A crew
 * that has built one Scrap Plate has one Scrap Plate, and it is bolted to the Razors or it is not
 * bolted to anything.
 */
export function fittedOn(loadouts: UnitLoadouts, upgradeId: string): string[] {
  return Object.entries(loadouts)
    .filter(([, slots]) => slots.includes(upgradeId))
    .map(([unitId]) => unitId);
}

/**
 * Why this cannot be bolted on, checked in the order a player wants to hear it (§D5c).
 *
 * ## One of a thing is one of a thing
 *
 * `already_slotted` used to mean "already in another bracket **on this unit**", so the same
 * upgrade could be fitted to every unit type in the game off a single build: one Scrap Plate on
 * the Razors, the Breakers, the Wardens and the Ironsides at once. It now means fitted anywhere,
 * which is the maintainer's rule ("you can only have each modification once") and the thing that makes
 * choosing *which* unit gets it a decision at all.
 *
 * ## And it does not come off
 *
 * There is no un-fit. Passing `null` used to empty a bracket and hand the upgrade back, which made
 * the choice free and reversible: a crew could move one plate around the roster to suit whatever
 * they were about to field. What replaces it is `burnUpgrade`, which destroys the thing. The
 * decision costs something, and changing your mind costs building it again.
 */
export function slotRefusal(
  loadouts: UnitLoadouts,
  unitId: string,
  slot: number,
  upgradeId: string,
  built: FittedUpgrades,
): SlotRefusal | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= UNIT_UPGRADE_SLOTS) return 'bad_slot';
  const spec = findUnitModification(upgradeId);
  if (!spec) return 'unknown_upgrade';
  /*
   * Before `not_built`, because it is the one refusal nothing the player does will change: a
   * Counterweight Harness is never going on the Razors, and telling somebody to go and build one
   * first would send them to the yard for a card they still could not fit when they got back.
   */
  if (!modificationFitsUnit(spec, unitId)) return 'does_not_fit';
  if (!built.includes(upgradeId)) return 'not_built';
  if (fittedOn(loadouts, upgradeId).length > 0) return 'already_slotted';
  // A bracket holds one thing, and taking the old one out means burning it.
  const slots = slotsFor(loadouts, unitId);
  if (slots[slot] !== null) return 'slot_taken';
  /*
   * Left to right, and enforced here rather than left to the screen (maintainer request,
   * 2026-09-15). The client always aims at the first free bracket, but a rule that lives only in
   * one button is a rule the next screen forgets: the picker in the Scrapyard, a future drag, a
   * hand-written request. Checked after `slot_taken`, because a press on a full bracket should
   * hear that it is full, not that it is out of order.
   */
  if (slot !== firstFreeIndex(slots)) return 'skipped_slot';
  return null;
}

export type BurnRefusal = 'unknown_upgrade' | 'not_fitted';

/**
 * Burns a fitted modification off the roster (§D5c, maintainer request).
 *
 * The only way one ever comes off. It is destroyed rather than returned: gone from the bracket it
 * was in *and* from what the crew has built, so getting it back means building or finding another.
 * That is what stops the three brackets being a free loadout screen a player re-arranges before
 * every fight, and it is why fitting one is worth thinking about.
 *
 * Returns both halves because they have to move together: leaving it in `built` would let a crew
 * burn a plate off the Razors and immediately bolt the same plate to the Breakers, which is the
 * un-fit this replaces wearing a different name.
 */
export function burnUpgrade(
  loadouts: UnitLoadouts,
  built: FittedUpgrades,
  upgradeId: string,
): { loadouts: UnitLoadouts; built: FittedUpgrades } {
  const stripped: UnitLoadouts = {};
  for (const [unitId, slots] of Object.entries(loadouts)) {
    const kept = slots.map((id) => (id === upgradeId ? null : id));
    if (kept.some((id) => id !== null)) stripped[unitId] = kept;
  }
  return { loadouts: stripped, built: built.filter((id) => id !== upgradeId) };
}

export function burnRefusal(loadouts: UnitLoadouts, upgradeId: string): BurnRefusal | null {
  if (!findUnitModification(upgradeId)) return 'unknown_upgrade';
  if (fittedOn(loadouts, upgradeId).length === 0) return 'not_fitted';
  return null;
}

/** The map with one bracket changed. Empty trailing slots are not stored. */
export function withSlot(
  loadouts: UnitLoadouts,
  unitId: string,
  slot: number,
  upgradeId: string | null,
): UnitLoadouts {
  const slots = slotsFor(loadouts, unitId);
  slots[slot] = upgradeId;
  const next = { ...loadouts };
  if (slots.every((id) => id === null)) delete next[unitId];
  else next[unitId] = slots;
  return next;
}
