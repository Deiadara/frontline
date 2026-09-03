import { z } from 'zod';
import { findUpgrade, type FittedUpgrades, type UpgradeSpec } from './upgrades.js';

/**
 * Three slots on every unit, and what a crew is allowed to put in them.
 *
 * The workshop *builds* an upgrade once (`fittedUpgrades`, which is the crew's stock). This is the
 * other half: which three of the things you have built are actually bolted onto the Razors, and
 * which three onto the Juggernauts. Building a Hardshell Rig no longer improves everybody by
 * itself; it improves whoever you fit it to.
 *
 * That is the whole point of a slot. Nine upgrades applied to nine unit types is not a decision,
 * it is a shopping list you work through in one order every game. Three slots per unit means the
 * Sparks can be the ones with the optics and the Scrapers the ones with the reflex wiring, and a
 * crew that has built everything still has to say what each unit is *for*.
 *
 * A built upgrade is not consumed by fitting it: the same Scrap Plate goes on every unit you want
 * it on. It cannot go into two slots of the *same* unit, which would be a free doubling.
 */

export const UNIT_UPGRADE_SLOTS = 3;

/** A slot is an upgrade id or an empty bracket. Length is capped; short arrays pad on read. */
export const UnitLoadoutSchema = z.array(z.string().nullable()).max(UNIT_UPGRADE_SLOTS);
export type UnitLoadout = z.infer<typeof UnitLoadoutSchema>;

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
 * Filtered against the catalogue on the way out, so an id left over from an upgrade that was
 * renamed or dropped costs a slot on screen but never silently pays stats.
 */
export function fittedFor(loadouts: UnitLoadouts, unitId: string): FittedUpgrades {
  const seen = new Set<string>();
  for (const id of slotsFor(loadouts, unitId)) {
    if (id !== null && findUpgrade(id)) seen.add(id);
  }
  return [...seen];
}

export type SlotRefusal =
  'bad_slot' | 'unknown_upgrade' | 'not_built' | 'already_slotted' | 'slot_taken' | 'cannot_unfit';

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
 * which is the board's rule ("you can only have each modification once") and the thing that makes
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
  if (!findUpgrade(upgradeId)) return 'unknown_upgrade';
  if (!built.includes(upgradeId)) return 'not_built';
  if (fittedOn(loadouts, upgradeId).length > 0) return 'already_slotted';
  // A bracket holds one thing, and taking the old one out means burning it.
  if (slotsFor(loadouts, unitId)[slot] !== null) return 'slot_taken';
  return null;
}

export type BurnRefusal = 'unknown_upgrade' | 'not_fitted';

/**
 * Burns a fitted modification off the roster (§D5c, board request).
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
  if (!findUpgrade(upgradeId)) return 'unknown_upgrade';
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

/**
 * A loadout for a crew that has never opened the screen: the best of what it has already built.
 *
 * Only used when the feature arrives on top of a save that predates it. Before slots existed
 * every built upgrade applied to every unit, so filling each unit with the three strongest is the
 * arrangement that costs an existing crew nothing on the day of the change. Highest tier first,
 * and within a tier the line order the workshop lists, so it is the same answer every time.
 */
export function defaultLoadout(built: FittedUpgrades): UnitLoadout {
  const specs = built
    .map((id) => findUpgrade(id))
    .filter((spec): spec is UpgradeSpec => spec !== undefined)
    .sort((a, b) => b.tier - a.tier);
  return specs.slice(0, UNIT_UPGRADE_SLOTS).map((spec) => spec.id);
}
