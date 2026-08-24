import { z } from 'zod';
import type { ItemCost } from '../items/inventory.js';
import type { ItemId } from '../items/catalog.js';
import type { PartialResources } from '../resources.js';
import { UNIT_STAT_KEYS, type UnitStats } from './stats.js';

/**
 * What the workshop does to a roster (GDD §A5, workshop extension).
 *
 * Training gives you *more* of a unit. This gives you a *better* one, and it is the sink that
 * makes scrap matter past the early game. Every upgrade is bought once and applies to every one of
 * that unit you will ever field, which is the version that respects a player's time: nobody wants
 * to re-buy a helmet for each recruit.
 *
 * ## Three lines, each behind a blueprint
 *
 * **Armour** is plate and padding — vitality and armour, at the cost of a little speed. **Weapons**
 * are what they carry — lethality, offense, range. **Cybernetics** are what goes *in* them —
 * reflex and speed and stealth, and the only line whose top tier asks for a Neural Shunt per
 * upgrade rather than per unit.
 *
 * Each line's first tier is open to anybody. The second and third want the line's blueprint, which
 * is what puts the Runner's barrow on the critical path: a crew that never trades tops out at tier
 * one on everything.
 *
 * ## Everything costs scrap
 *
 * That is the board's rule and it is a good one — scrap is the material the city is made of, so
 * every physical improvement comes out of the same pile that the buildings do. High-quality metal
 * appears at tier two and above, components at tier two and three. Nothing costs food, because
 * nothing here is a person.
 */

export const UPGRADE_LINES = ['armour', 'weapons', 'cybernetics'] as const;
export const UpgradeLineSchema = z.enum(UPGRADE_LINES);
export type UpgradeLine = z.infer<typeof UpgradeLineSchema>;

export const UPGRADE_LINE_LABELS: Readonly<Record<UpgradeLine, string>> = {
  armour: 'Armour',
  weapons: 'Weapons',
  cybernetics: 'Cybernetics',
};

export const UPGRADE_LINE_BLURBS: Readonly<Record<UpgradeLine, string>> = {
  armour: 'Plate, padding and whatever else stops a round. Heavier people move slower.',
  weapons: 'What they are carrying, and how far it reaches.',
  cybernetics: 'Wet-side work. Faster than a body has any business being, and it costs.',
};

/** The blueprint each line needs past its first tier. */
export const UPGRADE_LINE_BLUEPRINT: Readonly<Record<UpgradeLine, ItemId>> = {
  armour: 'blueprint_composite_armour',
  weapons: 'blueprint_munitions',
  cybernetics: 'blueprint_cybernetics',
};

export const UPGRADE_MAX_TIER = 3;

export interface UpgradeSpec {
  id: string;
  line: UpgradeLine;
  tier: number;
  name: string;
  description: string;
  /** Flat changes to every unit of the tiers this applies to. */
  effect: Partial<UnitStats>;
  /** Caps, scrap and — past tier one — high-quality metal. */
  cost: PartialResources;
  /** Parts. Consumed on purchase, like everything else. */
  parts: ItemCost;
  /** Fitted in the Gauntlet, and it has to be standing at this level. */
  requiresGauntletLevel: number;
}

const SPECS: readonly UpgradeSpec[] = [
  // Armour — survivability, paid for in speed.
  {
    id: 'armour_1',
    line: 'armour',
    tier: 1,
    name: 'Scrap Plate',
    description: 'Road sign and truck panel, cut to shape and strapped on. Ugly, and it works.',
    effect: { vitality: 6, armor: 3, speed: -2 },
    cost: { scrap: 900, caps: 400 },
    parts: {},
    requiresGauntletLevel: 2,
  },
  {
    id: 'armour_2',
    line: 'armour',
    tier: 2,
    name: 'Composite Weave',
    description: 'Layered ceramic in a woven backing. Half the weight for twice the stopping.',
    effect: { vitality: 10, armor: 7, speed: -1 },
    cost: { scrap: 2600, highQualityMetal: 180, caps: 1400 },
    parts: { ceramic_plate: 4 },
    requiresGauntletLevel: 6,
  },
  {
    id: 'armour_3',
    line: 'armour',
    tier: 3,
    name: 'Hardshell Rig',
    description: 'A full carapace with its own cooling. You hear them coming.',
    effect: { vitality: 16, armor: 12, intimidation: 5, speed: -3 },
    cost: { scrap: 6400, highQualityMetal: 620, caps: 4200 },
    parts: { ceramic_plate: 8, coolant_cell: 2 },
    requiresGauntletLevel: 12,
  },

  // Weapons — reach and damage.
  {
    id: 'weapons_1',
    line: 'weapons',
    tier: 1,
    name: 'Machined Barrels',
    description: 'Bored true instead of bored out. Everything lands where it was pointed.',
    effect: { lethality: 5, offense: 4 },
    cost: { scrap: 1000, caps: 500 },
    parts: { scrap_servo: 2 },
    requiresGauntletLevel: 3,
  },
  {
    id: 'weapons_2',
    line: 'weapons',
    tier: 2,
    name: 'Match Loads',
    description: 'Powder measured by somebody who cared. The difference is at distance.',
    effect: { lethality: 9, offense: 6, range: 8 },
    cost: { scrap: 3000, highQualityMetal: 220, caps: 1800 },
    parts: { optic_cluster: 3 },
    requiresGauntletLevel: 8,
  },
  {
    id: 'weapons_3',
    line: 'weapons',
    tier: 3,
    name: 'Slaved Optics',
    description: 'The sight talks to the trigger. Nobody has to be a good shot any more.',
    effect: { lethality: 14, offense: 12, range: 14 },
    cost: { scrap: 7200, highQualityMetal: 780, caps: 5200 },
    parts: { targeting_core: 2, optic_cluster: 4 },
    requiresGauntletLevel: 14,
  },

  // Cybernetics — speed, reflex, and the quiet approach.
  {
    id: 'cybernetics_1',
    line: 'cybernetics',
    tier: 1,
    name: 'Reflex Wiring',
    description: 'A cheap shunt down one arm. It twitches for a week and then it is yours.',
    effect: { speed: 6, evasion: 4 },
    cost: { scrap: 1200, caps: 700 },
    parts: { scrap_servo: 3 },
    requiresGauntletLevel: 4,
  },
  {
    id: 'cybernetics_2',
    line: 'cybernetics',
    tier: 2,
    name: 'Muffled Servos',
    description: 'The same limbs, rebuilt to make no sound at all.',
    effect: { speed: 8, stealth: 10, evasion: 5 },
    cost: { scrap: 3400, highQualityMetal: 260, caps: 2200 },
    parts: { scrap_servo: 6, neural_shunt: 1 },
    requiresGauntletLevel: 9,
  },
  {
    id: 'cybernetics_3',
    line: 'cybernetics',
    tier: 3,
    name: 'Full Interface',
    description: 'Base of the skull, straight into the spine. It does not come out again.',
    effect: { speed: 12, evasion: 10, stealth: 8, morale: -4 },
    cost: { scrap: 8000, highQualityMetal: 900, caps: 6400 },
    parts: { neural_shunt: 4, coolant_cell: 2 },
    requiresGauntletLevel: 16,
  },
];

export const UNIT_UPGRADES: readonly UpgradeSpec[] = SPECS;
export const UPGRADE_IDS: readonly string[] = SPECS.map((spec) => spec.id);

const BY_ID = new Map(SPECS.map((spec) => [spec.id, spec]));

export function findUpgrade(id: string): UpgradeSpec | undefined {
  return BY_ID.get(id);
}

/** Every upgrade in a line, in tier order. */
export function upgradesInLine(line: UpgradeLine): UpgradeSpec[] {
  return SPECS.filter((spec) => spec.line === line).sort((a, b) => a.tier - b.tier);
}

/** What a crew has fitted. Order does not matter; the set does. */
export const FittedUpgradesSchema = z.array(z.string());
export type FittedUpgrades = readonly string[];

export type UpgradeRefusal =
  | 'unknown_upgrade'
  | 'already_fitted'
  | 'needs_previous_tier'
  | 'needs_blueprint'
  | 'gauntlet_too_low'
  | 'cannot_afford'
  | 'missing_parts';

/**
 * The order the checks run in is the order a player wants to hear them.
 *
 * "You need the blueprint" is more useful than "you cannot afford it" when both are true, because
 * one of them is a thing you can go and do something about today and the other is a number that
 * will fix itself. Cheapest-to-check-first would put them the other way round.
 */
export function upgradeRefusal(
  id: string,
  fitted: FittedUpgrades,
  gauntletLevel: number,
  hasBlueprint: (item: ItemId) => boolean,
  affordable: (cost: PartialResources) => boolean,
  hasParts: (parts: ItemCost) => boolean,
): UpgradeRefusal | null {
  const spec = findUpgrade(id);
  if (!spec) return 'unknown_upgrade';
  if (fitted.includes(id)) return 'already_fitted';

  const previous = upgradesInLine(spec.line).find((other) => other.tier === spec.tier - 1);
  if (previous && !fitted.includes(previous.id)) return 'needs_previous_tier';
  if (spec.tier > 1 && !hasBlueprint(UPGRADE_LINE_BLUEPRINT[spec.line])) return 'needs_blueprint';
  if (gauntletLevel < spec.requiresGauntletLevel) return 'gauntlet_too_low';
  if (!affordable(spec.cost)) return 'cannot_afford';
  if (!hasParts(spec.parts)) return 'missing_parts';
  return null;
}

/**
 * Every fitted upgrade, folded onto a unit's sheet.
 *
 * Applied at read time rather than written into the roster, so an upgrade bought today improves
 * the units trained last week — which is what "the workshop refits everyone" means, and the only
 * version a player will not find infuriating. Clamped to each stat's own range on the way out.
 */
export function upgradedStats(base: UnitStats, fitted: FittedUpgrades): UnitStats {
  const next: UnitStats = { ...base };
  for (const id of fitted) {
    const spec = findUpgrade(id);
    if (!spec) continue;
    for (const key of UNIT_STAT_KEYS) {
      const delta = spec.effect[key];
      if (delta === undefined) continue;
      // `lootCapacity` and `range` are unbounded above; the 0..100 stats are not. Both floor at 0.
      const raw = next[key] + delta;
      const capped = key === 'lootCapacity' || key === 'range' ? raw : Math.min(100, raw);
      next[key] = Math.max(0, Math.round(capped));
    }
  }
  return next;
}
