import { z } from 'zod';
import type { PartialResources } from '../resources.js';
import {
  MODIFICATIONS,
  MODIFICATION_SLOT_LEVELS,
  MAX_MODIFICATION_SLOTS,
  findModification,
  modificationSlotsAt,
  type ModificationSpec,
  type ModificationEffect,
} from './modifications.js';
import type { BuildingKind } from './kinds.js';
import { buildingLevel, findBuilding, type Building } from './state.js';
import {
  UNIT_UPGRADES,
  UPGRADE_LINE_BLUEPRINT,
  findUpgrade,
  type UpgradeSpec,
} from '../units/upgrades.js';

/**
 * The Scrapyard's add-ons (§B9) and the slots they go in (§E).
 *
 * Two things the board asked for that turn out to be one mechanic seen from either end. §B9 is the
 * shop: the Scrapyard builds add-ons, they cost scrap and, for the advanced ones, high-quality
 * metal, and most of them want a blueprint researched first. §E is the fitting: every structure
 * has three slots, and a slot is filled and emptied **on the structure's own dialog** rather than
 * on a separate screen.
 *
 * ## Built and fitted are different states, and that is the whole change
 *
 * They used to be the same one. A research project ended by bolting a modification into whatever
 * slot happened to be free (`fitModification`), so "own it" and "have it installed" were one fact
 * and there was nothing to empty a slot *into*. §E needs those apart: an add-on the crew owns and
 * has taken out of a wall has to go somewhere. So the crew's stock lives here, and a structure's
 * `modifications` array is now a statement about what is *fitted* out of that stock.
 *
 * ## What a blueprint is
 *
 * For a building modification it is the Lab project for that modification, recorded in
 * {@link Addons.researched} when it completes. For a unit upgrade it is the line's blueprint item,
 * which the Runner sells and which `units/upgrades.ts` already names. Two different objects, one
 * word on screen, because to a player they are the same thing: the drawing you need before the
 * yard can cut metal.
 */

export const AddonsSchema = z.object({
  /** Modification ids whose Lab project has finished: the blueprints the yard may work from. */
  researched: z.array(z.string()).default([]),
  /** Modification ids the Scrapyard has actually built. Fitting moves one of these into a slot. */
  built: z.array(z.string()).default([]),
});
export type Addons = z.infer<typeof AddonsSchema>;

export function noAddons(): Addons {
  return { researched: [], built: [] };
}

/**
 * The line between a bolt-on and a piece of engineering.
 *
 * One threshold doing two of §B9's jobs, on purpose: an advanced entry is the one that needs a
 * blueprint *and* the one that costs high-quality metal. Two independent thresholds would have
 * been two numbers a player has to learn to predict a price, and they would have described the
 * same set of things anyway.
 */
export const ADVANCED_MODIFICATION_MAGNITUDE = 12;
/** For a unit upgrade, the tier at which the same is true. Tier one is open to anybody. */
export const ADVANCED_UPGRADE_TIER = 2;

/** Scrap per point of magnitude, for a building modification. */
export const ADDON_SCRAP_PER_MAGNITUDE = 250;
/** And high-quality metal per point, for the advanced ones. */
export const ADDON_METAL_PER_MAGNITUDE = 12;

export function isAdvancedModification(spec: ModificationSpec): boolean {
  return spec.magnitude >= ADVANCED_MODIFICATION_MAGNITUDE;
}

/**
 * What the Scrapyard charges for a building modification: scrap, plus metal when it is advanced.
 *
 * Nothing else appears, which is §B9's rule for the whole page. Caps in particular are absent:
 * caps are what a crew earns out in the city, and the Scrapyard's whole argument is that a district
 * can improve itself out of what it strips down at home.
 */
export function modificationPrice(spec: ModificationSpec): PartialResources {
  const scrap = ADDON_SCRAP_PER_MAGNITUDE * spec.magnitude;
  return isAdvancedModification(spec)
    ? { scrap, highQualityMetal: ADDON_METAL_PER_MAGNITUDE * spec.magnitude }
    : { scrap };
}

/** The same question for a unit upgrade, off the catalogue's own figures. */
export function upgradePrice(spec: UpgradeSpec): PartialResources {
  const price: PartialResources = { scrap: spec.cost.scrap ?? 0 };
  if (spec.cost.highQualityMetal !== undefined) {
    price.highQualityMetal = spec.cost.highQualityMetal;
  }
  return price;
}

/** Whether this unit upgrade is one of the advanced ones. */
export function isAdvancedUpgrade(spec: UpgradeSpec): boolean {
  return spec.tier >= ADVANCED_UPGRADE_TIER;
}

// --- what the crew owns -----------------------------------------------------------------------

/** Every modification currently sitting in a slot somewhere in the district. */
export function fittedModifications(buildings: readonly Building[]): string[] {
  return buildings.flatMap((building) => building.modifications);
}

/**
 * Modifications the crew has built and has *not* got installed: what a slot can be filled from.
 *
 * Counted rather than set-subtracted, because a crew may build the same modification twice, and
 * one built twice and fitted once still has one on the shelf. Cheap: both lists are short.
 */
export function shelvedModifications(addons: Addons, buildings: readonly Building[]): string[] {
  const fitted = fittedModifications(buildings);
  const shelf: string[] = [];
  for (const id of addons.built) {
    const index = fitted.indexOf(id);
    if (index === -1) shelf.push(id);
    else fitted.splice(index, 1);
  }
  return shelf;
}

// --- §E: the three slots ----------------------------------------------------------------------

/** One of a structure's three slots, as its dialog draws it. */
export interface ModificationSlot {
  /** 0, 1 or 2. Stable, so the dialog can address a slot without naming what is in it. */
  index: number;
  /** The structure level that opens it. */
  opensAtLevel: number;
  /** Open, or still waiting on a level. */
  open: boolean;
  /** What is fitted here, or null. */
  modificationId: string | null;
}

/**
 * A structure's three slots, whether or not it is standing.
 *
 * Always three (§E: "every building shows three clear slots"), and a locked one says which level
 * opens it rather than not being drawn. A player deciding what to upgrade next is exactly the
 * player who needs to see that level 10 buys a second slot.
 */
export function modificationSlots(building: Building | undefined): ModificationSlot[] {
  const level = building?.level ?? 0;
  const open = modificationSlotsAt(level);
  const fitted = building?.modifications ?? [];
  return MODIFICATION_SLOT_LEVELS.map((opensAtLevel, index) => ({
    index,
    opensAtLevel,
    open: index < open,
    modificationId: index < fitted.length ? (fitted[index] ?? null) : null,
  }));
}

/** Why a slot cannot take this modification right now. Ordered most structural first. */
export const SLOT_REFUSALS = [
  'no_structure',
  'bad_slot',
  'slot_locked',
  'slot_taken',
  'unknown_modification',
  'wrong_structure',
  'not_built',
  'already_fitted',
] as const;
export type SlotRefusalReason = (typeof SLOT_REFUSALS)[number];

/**
 * Whether this modification may go into this slot, and why not.
 *
 * The single gate §E's "a slot that cannot be filled yet says why" is written out of, and the same
 * one the route enforces, so a dead button and a 409 can never disagree about the reason.
 */
export function fitSlotRefusal(input: {
  kind: BuildingKind;
  modificationId: string;
  buildings: readonly Building[];
  addons: Addons;
}): SlotRefusalReason | null {
  const { kind, modificationId, buildings, addons } = input;
  const standing = findBuilding(buildings, kind);
  if (!standing) return 'no_structure';

  // The first free slot, or the fact that there is not one: §E's "says why" is mostly this line.
  const slots = modificationSlots(standing);
  const target = slots.find((slot) => slot.open && slot.modificationId === null);
  if (!target) {
    return slots.some((slot) => slot.modificationId === null) ? 'slot_locked' : 'slot_taken';
  }

  const spec = findModification(modificationId);
  if (!spec) return 'unknown_modification';
  if (spec.building !== kind) return 'wrong_structure';
  if (standing.modifications.includes(modificationId)) return 'already_fitted';
  if (!shelvedModifications(addons, buildings).includes(modificationId)) return 'not_built';
  return null;
}

/** The player-facing sentence for every refusal. The client never writes one of its own. */
export function describeSlotRefusal(reason: SlotRefusalReason, kind: BuildingKind): string {
  switch (reason) {
    case 'no_structure':
      return 'Build this first';
    case 'bad_slot':
      return 'There is no slot there';
    case 'slot_locked':
      return 'Raise this structure to open the slot';
    case 'slot_taken':
      return 'Something is already in that slot';
    case 'unknown_modification':
      return 'No such modification';
    case 'wrong_structure':
      return 'That does not fit here';
    case 'not_built':
      return 'The Scrapyard has not built one';
    case 'already_fitted':
      return `Already fitted to the ${kind}`;
  }
}

/**
 * `buildings` with `modificationId` fitted to `kind`, in the first slot that is free.
 *
 * The stored array stays **dense**: slot *n* is `modifications[n]`, and there are no holes. That is
 * a deliberate choice against a positional array with empty padding, which would have needed a
 * sentinel inside `ModificationIdSchema`, a matching hole in the repo's read-path filter and a
 * migration, to buy the player the ability to care which of three identical brackets a thing sits
 * in. Filling goes to the first free slot; emptying names what to take out, which is the half a
 * player actually has an opinion about.
 */
export function withModificationFitted(
  buildings: readonly Building[],
  kind: BuildingKind,
  modificationId: string,
): Building[] {
  return buildings.map((building) =>
    building.kind === kind
      ? { ...building, modifications: [...building.modifications, modificationId] }
      : building,
  );
}

/**
 * `buildings` with whatever is in `slot` of `kind` taken out and put back on the shelf.
 *
 * Addressed by slot rather than by id because that is what the dialog has to hand: the player
 * clicked a bracket. One occurrence is removed, not every one, so a structure carrying the same
 * modification twice loses one of them.
 */
export function withSlotEmptied(
  buildings: readonly Building[],
  kind: BuildingKind,
  slot: number,
): Building[] {
  return buildings.map((building) => {
    if (building.kind !== kind) return building;
    const next = building.modifications.filter((_, index) => index !== slot);
    return { ...building, modifications: next };
  });
}

/** Why a slot cannot be emptied. */
export type ClearSlotRefusal = 'no_structure' | 'bad_slot' | 'already_empty';

export function clearSlotRefusal(
  kind: BuildingKind,
  slot: number,
  buildings: readonly Building[],
): ClearSlotRefusal | null {
  const standing = findBuilding(buildings, kind);
  if (!standing) return 'no_structure';
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_MODIFICATION_SLOTS) return 'bad_slot';
  return standing.modifications[slot] === undefined ? 'already_empty' : null;
}

// --- §B9: what the Scrapyard shows ------------------------------------------------------------

/** Why an add-on cannot be built right now. */
export const ADDON_REFUSALS = [
  'unknown_addon',
  'needs_blueprint',
  'needs_previous_tier',
  'gauntlet_too_low',
  'already_built',
  'cannot_afford',
] as const;
export type AddonRefusal = (typeof ADDON_REFUSALS)[number];

export interface AddonEntry {
  id: string;
  kind: 'modification' | 'upgrade';
  name: string;
  description: string;
  /** The structure a modification bolts to, for grouping. Null for a unit upgrade. */
  building: BuildingKind | null;
  /** One line: what it actually does. */
  effect: string;
  cost: PartialResources;
  advanced: boolean;
  /** The blueprint it wants, in the player's words, or null when it needs none. */
  blueprint: string | null;
  /** Already in stock. A modification can be built again; an upgrade cannot. */
  built: boolean;
  blocker: AddonRefusal | null;
}

/** Everything the Scrapyard can turn out, modifications first then unit upgrades. */
export function addonCatalogue(): { modifications: ModificationSpec[]; upgrades: UpgradeSpec[] } {
  return { modifications: [...MODIFICATIONS], upgrades: [...UNIT_UPGRADES] };
}

/**
 * Whether the crew may build this modification, and why not.
 *
 * `affordable` is passed in rather than computed, because the price a crew actually pays depends
 * on discounts this module has no business knowing about: the same shape `vehicleRefusal` and
 * `upgradeRefusal` already use.
 */
export function modificationBuildRefusal(input: {
  spec: ModificationSpec;
  addons: Addons;
  affordable: (cost: PartialResources) => boolean;
}): AddonRefusal | null {
  const { spec, addons, affordable } = input;
  if (isAdvancedModification(spec) && !addons.researched.includes(spec.id)) {
    return 'needs_blueprint';
  }
  return affordable(modificationPrice(spec)) ? null : 'cannot_afford';
}

/** The blueprint an entry wants, in the player's words, or null. */
export function addonBlueprintName(spec: ModificationSpec | UpgradeSpec): string | null {
  if ('magnitude' in spec) {
    return isAdvancedModification(spec) ? `${spec.name} research` : null;
  }
  return isAdvancedUpgrade(spec) ? UPGRADE_LINE_BLUEPRINT[spec.line] : null;
}

/**
 * What each channel is called on a screen a player reads.
 *
 * The Scrapyard used to print the enum with its underscores swapped for spaces, which gives
 * "+12 defense percent" and "+10 build time reduction": a debug string wearing a label's clothes,
 * on a page where every other line is written in the game's voice. The channel names are internal
 * and were never meant to be read out loud.
 */
const ADDON_EFFECT_LABELS: Readonly<Record<ModificationEffect, string>> = {
  production_percent: 'production',
  build_cost_reduction: 'off what a build costs',
  build_time_reduction: 'off how long a build takes',
  storage_percent: 'room in the stockpile',
  defense_percent: 'holding your ground',
  faction_xp_percent: 'faction experience',
  research_time_reduction: 'off how long research takes',
  housing_percent: 'beds',
  character_xp_percent: 'experience',
  payroll_percent: 'room on the payroll',
  raid_loot_percent: 'what a raid brings home',
  training_time_reduction: 'off how long training takes',
  training_supplies_reduction: 'off the supplies a unit costs',
};

/** One line saying what an entry does, for the Scrapyard's list. */
export function describeAddonEffect(spec: ModificationSpec | UpgradeSpec): string {
  if ('magnitude' in spec) {
    return `+${spec.magnitude}% ${ADDON_EFFECT_LABELS[spec.effect]}`;
  }
  // `UnitStats` carries a `damageType` and a `resistances` map alongside the numbers, and neither
  // reads as "+3 something": only the numeric lines make a sentence.
  return Object.entries(spec.effect)
    .flatMap(([stat, amount]) =>
      typeof amount === 'number' ? [`${amount > 0 ? '+' : ''}${amount} ${stat}`] : [],
    )
    .join(', ');
}

/** The level a structure has to reach before its `slot`th bracket opens. */
export function slotOpensAt(slot: number): number {
  return MODIFICATION_SLOT_LEVELS[slot] ?? Number.POSITIVE_INFINITY;
}

/** How many slots this structure has open, and how many are filled. Read by the dialog's heading. */
export function slotSummary(
  buildings: readonly Building[],
  kind: BuildingKind,
): { open: number; filled: number } {
  const slots = modificationSlots(findBuilding(buildings, kind));
  return {
    open: slots.filter((slot) => slot.open).length,
    filled: slots.filter((slot) => slot.modificationId !== null).length,
  };
}

/** Convenience for callers that only have a level to hand. */
export function slotsOpenAtLevel(level: number): number {
  return modificationSlotsAt(level);
}

/** The Gauntlet level a unit upgrade wants, read off its own spec. */
export function upgradeGauntletLevel(id: string): number {
  return findUpgrade(id)?.requiresGauntletLevel ?? 0;
}

/** Whether the district's Gauntlet is tall enough for this upgrade. */
export function gauntletTallEnough(id: string, buildings: readonly Building[]): boolean {
  return buildingLevel(buildings, 'gauntlet') >= upgradeGauntletLevel(id);
}
