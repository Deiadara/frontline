import { z } from 'zod';
import {
  BLUEPRINTS,
  BLUEPRINT_IDS,
  BLUEPRINT_PAGE_IDS,
  type BlueprintId,
  type BlueprintPage,
  type BlueprintPageId,
  type BlueprintSpec,
} from '../blueprints/catalog.js';

/**
 * Things that are not resources (GDD §D, extended).
 *
 * The stockpile is five fungible numbers, and everything in the game was priced in them. That
 * works until the game wants a *specific* thing to be the reason you cannot do something yet: a
 * blueprint you have not found, a servo you have to buy from a trader who is only in town twice a
 * day. A number cannot be that. An item can: it has a name, it either sits in your inventory or it
 * does not, and the sentence "you need one Gyro Assembly" is a sentence a player can act on.
 *
 * Four kinds, and the kind is what a player needs to know about it:
 *
 * - **Blueprint**: permanent knowledge, and the record that a document was assembled and unlocked.
 *   Never tradeable: see `blueprintItemSpec`.
 * - **Page**: one named part of a blueprint (§D1). Found, bought, sold and swapped. The catalogue
 *   of these is generated from `blueprints/catalog.ts`, one item per page.
 * - **Component**: a physical part. Consumed by the thing it goes into. This is what makes a
 *   late-game structure or an implant cost something you cannot simply grind.
 * - **Relic**: worth caps and nothing else. Loot with no sink, so there is always something in
 *   the market worth haggling over that costs nobody a build.
 *
 * Everything here is tradeable between players unless it says otherwise, because an item economy
 * where the interesting items cannot move is a collection, not a market.
 *
 * The six `blueprint_*` goods below predate pages and are still what the Lab's tracks and the
 * Black Market's shelf name. They are not part of the pages model and are left alone here: both
 * of those catalogues are owned elsewhere, and moving them is their change to make.
 */

export const ITEM_KINDS = ['blueprint', 'page', 'component', 'relic'] as const;
export const ItemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof ItemKindSchema>;

export const ITEM_RARITIES = ['common', 'uncommon', 'rare', 'exotic'] as const;
export const ItemRaritySchema = z.enum(ITEM_RARITIES);
export type ItemRarity = z.infer<typeof ItemRaritySchema>;

/**
 * Goods only, and it stays that way.
 *
 * Blueprints and their pages are items too (see {@link ALL_ITEM_IDS}), but they are **not** in
 * here, because this array is what the city's shops draw from: `market/vendor.ts` builds the
 * Runner's barrow out of it and `items/salvage.ts` builds what a bin gives up. Two hundred page
 * ids in that pool would turn both of them into page dispensers, and where pages come from is a
 * designed thing (§F) rather than a side effect of a list getting longer.
 */
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

export type GoodId = (typeof ITEM_IDS)[number];

/**
 * Every id that may sit in a satchel: goods, finished blueprints, and blueprint pages.
 *
 * A page is an item so that it is stored, shown and traded by machinery that already exists. It
 * goes into `inventory` on the base like anything else, which is what §F1e asks for, and it needs
 * no column of its own to survive a save.
 *
 * A **finished** blueprint is an item for the same reason and one more: it is the record that the
 * player pressed Unlock. `blueprints/state.ts` reads it as the difference between "holds every
 * page" and "owns this, permanently".
 */
export const ALL_ITEM_IDS = [...ITEM_IDS, ...BLUEPRINT_IDS, ...BLUEPRINT_PAGE_IDS] as const;

export type ItemId = GoodId | BlueprintId | BlueprintPageId;

/*
 * The cast is the price of building the list at runtime.
 *
 * `z.enum` wants a non-empty tuple to read its literals off, and `ALL_ITEM_IDS` is three arrays
 * spread together, which TypeScript types as an array rather than a tuple however many `as const`s
 * are on it. The union it should produce is written out above instead, so the cast asserts a shape
 * (non-empty) rather than inventing a type: every member really is an `ItemId`, and
 * `blueprints.test.ts` checks the runtime list against the catalogue it was built from.
 */
export const ItemIdSchema = z.enum(ALL_ITEM_IDS as unknown as [ItemId, ...ItemId[]]);

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

  /*
   * The six pre-war `blueprint_*` documents, which gate nothing.
   *
   * They gated the old five-theme research tree and the old single-item unit unlocks. Research is
   * nineteen officer tracks now and a blueprint is a document assembled out of named pages
   * (`blueprints/`), so neither reader exists. They are still in the catalogue on purpose: crews
   * hold them, the Runner's barrow and the Black Market both stock them, and deleting an item a
   * player is holding is a migration and a theft.
   *
   * What was changed is the copy. Every one of them used to name a track or a line of upgrades it
   * would open, and a player buying one for 1,400 caps on the strength of that sentence was being
   * lied to by the shop. They are worth what they sell for and nothing else, and now say so.
   *
   * Whether they should be retired from the shelves or turned into page sets is a content call
   * that has not been made.
   */
  {
    id: 'blueprint_cybernetics',
    name: 'Blueprint: Cybernetics',
    kind: 'blueprint',
    rarity: 'rare',
    description: 'Surgical plates and a wiring diagram, annotated by somebody who stopped writing.',
    usedFor: 'Nothing the Lab can use. Collectors pay for it anyway.',
    capsValue: 1400,
    tradeable: true,
  },
  {
    id: 'blueprint_composite_armour',
    name: 'Blueprint: Composite Armour',
    kind: 'blueprint',
    rarity: 'uncommon',
    description: 'Lamination schedules for plate that is mostly air.',
    usedFor: 'Nothing the Lab can use. Collectors pay for it anyway.',
    capsValue: 800,
    tradeable: true,
  },
  {
    id: 'blueprint_rotorcraft',
    name: 'Blueprint: Rotorcraft',
    kind: 'blueprint',
    rarity: 'exotic',
    description: 'Rotor geometry, in a hand that assumed the reader already knew how to fly.',
    usedFor: 'Nothing the Lab can use. Collectors pay for it anyway.',
    capsValue: 3200,
    tradeable: true,
  },
  {
    id: 'blueprint_signal_theory',
    name: 'Blueprint: Signal Theory',
    kind: 'blueprint',
    rarity: 'rare',
    description: 'Combine cipher practice, written down by somebody who should not have.',
    usedFor: 'Nothing the Lab can use. Collectors pay for it anyway.',
    capsValue: 1200,
    tradeable: true,
  },
  {
    id: 'blueprint_field_medicine',
    name: 'Blueprint: Field Medicine',
    kind: 'blueprint',
    rarity: 'uncommon',
    description: 'Triage under fire, in eleven pages and no diagrams.',
    usedFor: 'Nothing the Lab can use. Collectors pay for it anyway.',
    capsValue: 700,
    tradeable: true,
  },
  {
    id: 'blueprint_munitions',
    name: 'Blueprint: Munitions',
    kind: 'blueprint',
    rarity: 'rare',
    description: 'Load tables. The margins argue with the tables.',
    usedFor: 'Nothing the Lab can use. Collectors pay for it anyway.',
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

/**
 * How rare a document is, read off how many pages it takes.
 *
 * One number decides it because one number is what §D3 already scaled: a two-page motorbike is an
 * early thing and an eight-page Colossus is the end of a campaign, so a second dial for rarity
 * would only be a chance to disagree with the first.
 */
function blueprintRarity(pages: number): ItemRarity {
  if (pages <= 3) return 'uncommon';
  if (pages <= 5) return 'rare';
  return 'exotic';
}

/** A page is one step commoner than the document it belongs to: you find pages, not documents. */
const RARITY_BELOW: Readonly<Record<ItemRarity, ItemRarity>> = {
  common: 'common',
  uncommon: 'common',
  rare: 'uncommon',
  exotic: 'rare',
};

/**
 * What a page is worth in caps.
 *
 * Scaled by the length of its document rather than flat, so a page of the Colossus is not priced
 * like a page of the Quarters retrofit. The Runner sells pages for caps (§F3c) and the barter
 * broker values them off this number.
 */
const CAPS_PER_PAGE_STEP = 180;

function pageItemSpec(blueprint: BlueprintSpec, page: BlueprintPage): ItemSpec {
  const pages = blueprint.pages.length;
  return {
    id: page.id as ItemId,
    name: `${blueprint.name}: ${page.name}`,
    kind: 'page',
    rarity: RARITY_BELOW[blueprintRarity(pages)],
    description: `One page of ${pages} from the ${blueprint.name}.`,
    usedFor: `Collect all ${pages} to unlock the ${blueprint.name}.`,
    capsValue: CAPS_PER_PAGE_STEP * pages,
    tradeable: true,
  };
}

/**
 * The finished document, held once and never again.
 *
 * `tradeable: false`, and that is the whole difference between this and a page. Pages move: they
 * are found, bought, sold and reimagined, and a crew short of one page has somewhere to go. A
 * blueprint that had been unlocked is knowledge somebody has, and knowledge does not come back out
 * of a head and onto a barrow.
 */
function blueprintItemSpec(blueprint: BlueprintSpec): ItemSpec {
  const pages = blueprint.pages.length;
  return {
    id: blueprint.id as ItemId,
    name: blueprint.name,
    kind: 'blueprint',
    rarity: blueprintRarity(pages),
    description: blueprint.blurb,
    usedFor: `Unlocked, permanently. Assembled from ${pages} pages.`,
    capsValue: CAPS_PER_PAGE_STEP * pages * pages,
    tradeable: false,
  };
}

/**
 * Goods first, then the documents and their pages.
 *
 * Generated rather than typed out: a hundred and fifty-seven hand-written page specs would be a
 * hundred and fifty-seven chances for a page to disagree with the blueprint it belongs to about
 * how many pages that blueprint has.
 */
const ALL_SPECS: readonly ItemSpec[] = [
  ...SPECS,
  ...BLUEPRINTS.map(blueprintItemSpec),
  ...BLUEPRINTS.flatMap((blueprint) =>
    blueprint.pages.map((page) => pageItemSpec(blueprint, page)),
  ),
];

export const ITEM_CATALOG: Readonly<Record<ItemId, ItemSpec>> = Object.fromEntries(
  ALL_SPECS.map((spec) => [spec.id, spec]),
) as Record<ItemId, ItemSpec>;

export const ITEM_KIND_LABELS: Readonly<Record<ItemKind, string>> = {
  blueprint: 'Blueprint',
  page: 'Page',
  component: 'Component',
  relic: 'Relic',
};

export const ITEM_RARITY_LABELS: Readonly<Record<ItemRarity, string>> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  exotic: 'Exotic',
};
