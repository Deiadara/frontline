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
  'bad_slot' | 'unknown_upgrade' | 'not_built' | 'already_slotted' | 'already_empty';

/**
 * Checked in the order a player wants to hear it: "you have not built that yet" is a thing to go
 * and do, "it is already in slot 2" is a thing to look at.
 */
export function slotRefusal(
  loadouts: UnitLoadouts,
  unitId: string,
  slot: number,
  upgradeId: string | null,
  built: FittedUpgrades,
): SlotRefusal | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= UNIT_UPGRADE_SLOTS) return 'bad_slot';
  const slots = slotsFor(loadouts, unitId);
  if (upgradeId === null) return slots[slot] === null ? 'already_empty' : null;
  if (!findUpgrade(upgradeId)) return 'unknown_upgrade';
  if (!built.includes(upgradeId)) return 'not_built';
  if (slots.some((id, index) => id === upgradeId && index !== slot)) return 'already_slotted';
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
