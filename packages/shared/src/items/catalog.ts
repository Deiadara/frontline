import { z } from 'zod';

/**
 * Things that are not resources (GDD §D, extended).
 *
 * The stockpile is five fungible numbers, and everything in the game was priced in them. That
 * works until the game wants a *specific* thing to be the reason you cannot do something yet: a
 * blueprint you have not found, a servo you have to buy from a trader who is only in town twice a
 * day. A number cannot be that. An item can: it has a name, it either sits in your inventory or it
 * does not, and the sentence "you need one Gyro Assembly" is a sentence a player can act on.
 *
 * Three kinds, and the kind is what a player needs to know about it:
 *
 * - **Blueprint**: permanent knowledge. Consumed when it is read, and what it teaches is yours
 *   forever. These are the gates on the deep end of the Lab and on the better unit upgrades.
 * - **Component**: a physical part. Consumed by the thing it goes into. This is what makes a
 *   late-game structure or an implant cost something you cannot simply grind.
 * - **Relic**: worth caps and nothing else. Loot with no sink, so there is always something in
 *   the market worth haggling over that costs nobody a build.
 *
 * Everything here is tradeable between players unless it says otherwise, because an item economy
 * where the interesting items cannot move is a collection, not a market.
 */

export const ITEM_KINDS = ['blueprint', 'component', 'relic'] as const;
export const ItemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof ItemKindSchema>;

export const ITEM_RARITIES = ['common', 'uncommon', 'rare', 'exotic'] as const;
export const ItemRaritySchema = z.enum(ITEM_RARITIES);
export type ItemRarity = z.infer<typeof ItemRaritySchema>;

export const ITEM_IDS = [
  // Components: the physical half of everything built above the basics.
  'scrap_servo',
  'gyro_assembly',
  'ceramic_plate',
  'optic_cluster',
  'neural_shunt',
  'coolant_cell',
  'rotor_hub',
  'targeting_core',
  // Blueprints: read once, known forever.
  'blueprint_cybernetics',
  'blueprint_composite_armour',
  'blueprint_rotorcraft',
  'blueprint_signal_theory',
  'blueprint_field_medicine',
  'blueprint_munitions',
  // Relics: worth caps, nothing else.
  'combine_seal',
  'pre_collapse_ledger',
  'ivory_dice',
] as const;

export const ItemIdSchema = z.enum(ITEM_IDS);
export type ItemId = z.infer<typeof ItemIdSchema>;

export interface ItemSpec {
  id: ItemId;
  name: string;
  kind: ItemKind;
  rarity: ItemRarity;
  /** One line: what the thing is. */
  description: string;
  /** What it is for, in the player's words. Empty for a relic, which is for selling. */
  usedFor: string;
  /**
   * What a vendor asks for one, in caps. Also the floor the barter broker values it at, and the
   * number a player has to beat to make an offer worth taking.
   */
  capsValue: number;
  /** A relic exists to be sold; everything else has a sink and is not auto-priced by rarity. */
  tradeable: boolean;
}

const SPECS: readonly ItemSpec[] = [
  {
    id: 'scrap_servo',
    name: 'Scrap Servo',
    kind: 'component',
    rarity: 'common',
    description: 'A salvaged actuator, rewound by hand. Whines, but holds.',
    usedFor: 'The first tier of unit upgrades, and the Garage’s early frames.',
    capsValue: 120,
    tradeable: true,
  },
  {
    id: 'gyro_assembly',
    name: 'Gyro Assembly',
    kind: 'component',
    rarity: 'uncommon',
    description: 'Three rings and a weight, machined true. Nobody in the district makes these.',
    usedFor: 'Motorcycles, and anything that has to stay upright at speed.',
    capsValue: 320,
    tradeable: true,
  },
  {
    id: 'ceramic_plate',
    name: 'Ceramic Plate',
    kind: 'component',
    rarity: 'uncommon',
    description: 'Pressed armour tile. Stops one round properly and then it is gravel.',
    usedFor: 'Armour upgrades, and the heavy end of the roster.',
    capsValue: 280,
    tradeable: true,
  },
  {
    id: 'optic_cluster',
    name: 'Optic Cluster',
    kind: 'component',
    rarity: 'uncommon',
    description: 'A lens stack and a sensor, pulled from something that used to watch a street.',
    usedFor: 'Targeting implants and the Lab’s observation work.',
    capsValue: 340,
    tradeable: true,
  },
  {
    id: 'neural_shunt',
    name: 'Neural Shunt',
    kind: 'component',
    rarity: 'rare',
    description: 'Wet-side hardware. Goes in at the base of the skull and does not come out.',
    usedFor: 'Cybernetic upgrades. The good ones and the ones that cost something.',
    capsValue: 900,
    tradeable: true,
  },
  {
    id: 'coolant_cell',
    name: 'Coolant Cell',
    kind: 'component',
    rarity: 'rare',
    description: 'Sealed, pressurised, and older than anyone using it.',
    usedFor: 'Anything that runs hot: the Generator’s upper levels, and rotorcraft.',
    capsValue: 760,
    tradeable: true,
  },
  {
    id: 'rotor_hub',
    name: 'Rotor Hub',
    kind: 'component',
    rarity: 'exotic',
    description: 'The one part of a helicopter nobody has worked out how to fabricate.',
    usedFor: 'Rotorcraft. There is no substitute and no second use.',
    capsValue: 2400,
    tradeable: true,
  },
  {
    id: 'targeting_core',
    name: 'Targeting Core',
    kind: 'component',
    rarity: 'exotic',
    description: 'A dead drone’s brain, still counting things it can no longer see.',
    usedFor: 'The last tier of weapon upgrades.',
    capsValue: 2100,
    tradeable: true,
  },

  {
    id: 'blueprint_cybernetics',
    name: 'Blueprint: Cybernetics',
    kind: 'blueprint',
    rarity: 'rare',
    description: 'Surgical plates and a wiring diagram, annotated by somebody who stopped writing.',
    usedFor: 'Unlocks the cybernetic line of unit upgrades and the Lab’s wetware track.',
    capsValue: 1400,
    tradeable: true,
  },
  {
    id: 'blueprint_composite_armour',
    name: 'Blueprint: Composite Armour',
    kind: 'blueprint',
    rarity: 'uncommon',
    description: 'Lamination schedules for plate that is mostly air.',
    usedFor: 'Unlocks the armour line of unit upgrades.',
    capsValue: 800,
    tradeable: true,
  },
  {
    id: 'blueprint_rotorcraft',
    name: 'Blueprint: Rotorcraft',
    kind: 'blueprint',
    rarity: 'exotic',
    description: 'Rotor geometry, in a hand that assumed the reader already knew how to fly.',
    usedFor: 'Unlocks helicopters in the Garage.',
    capsValue: 3200,
    tradeable: true,
  },
  {
    id: 'blueprint_signal_theory',
    name: 'Blueprint: Signal Theory',
    kind: 'blueprint',
    rarity: 'rare',
    description: 'Combine cipher practice, written down by somebody who should not have.',
    usedFor: 'Unlocks the Lab’s signals track and the counter-intelligence upgrades.',
    capsValue: 1200,
    tradeable: true,
  },
  {
    id: 'blueprint_field_medicine',
    name: 'Blueprint: Field Medicine',
    kind: 'blueprint',
    rarity: 'uncommon',
    description: 'Triage under fire, in eleven pages and no diagrams.',
    usedFor: 'Unlocks the Lab’s medical track and the trauma implants.',
    capsValue: 700,
    tradeable: true,
  },
  {
    id: 'blueprint_munitions',
    name: 'Blueprint: Munitions',
    kind: 'blueprint',
    rarity: 'rare',
    description: 'Load tables. The margins argue with the tables.',
    usedFor: 'Unlocks the weapon line of unit upgrades.',
    capsValue: 1100,
    tradeable: true,
  },

  {
    id: 'combine_seal',
    name: 'Combine Seal',
    kind: 'relic',
    rarity: 'uncommon',
    description: 'An authority stamp from an office that no longer answers.',
    usedFor: '',
    capsValue: 450,
    tradeable: true,
  },
  {
    id: 'pre_collapse_ledger',
    name: 'Pre-Collapse Ledger',
    kind: 'relic',
    rarity: 'rare',
    description: 'Somebody’s accounts, kept immaculately, right up to the last page.',
    usedFor: '',
    capsValue: 1050,
    tradeable: true,
  },
  {
    id: 'ivory_dice',
    name: 'Ivory Dice',
    kind: 'relic',
    rarity: 'exotic',
    description: 'A matched pair, weighted. Everyone in the district knows whose they were.',
    usedFor: '',
    capsValue: 2600,
    tradeable: true,
  },
];

export const ITEM_CATALOG: Readonly<Record<ItemId, ItemSpec>> = Object.fromEntries(
  SPECS.map((spec) => [spec.id, spec]),
) as Record<ItemId, ItemSpec>;

export function findItem(id: string): ItemSpec | undefined {
  return ITEM_IDS.includes(id as ItemId) ? ITEM_CATALOG[id as ItemId] : undefined;
}

export const ITEM_KIND_LABELS: Readonly<Record<ItemKind, string>> = {
  blueprint: 'Blueprint',
  component: 'Component',
  relic: 'Relic',
};

export const ITEM_RARITY_LABELS: Readonly<Record<ItemRarity, string>> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  exotic: 'Exotic',
};

/** Every item of a kind, in catalogue order. */
export function itemsOfKind(kind: ItemKind): ItemSpec[] {
  return SPECS.filter((spec) => spec.kind === kind);
}
