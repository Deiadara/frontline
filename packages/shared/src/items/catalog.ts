import { z } from 'zod';
import type { ItemRarity } from './rarity.js';
import {
  BLUEPRINTS,
  BLUEPRINT_IDS,
  BLUEPRINT_PAGE_IDS,
  type BlueprintId,
  type BlueprintPage,
  type BlueprintPageId,
  type BlueprintSpec,
  pageRarity,
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
 * - **Consumable**: spent for an effect, and gone. The one kind whose value is in using it up.
 *
 * Relics were a fifth kind and are not here any more: `ITEM_KINDS` has four entries and nothing
 * in the catalogue carries the kind. This list said five and named them for months after.
 * - **Consumable**: built to be spent once. The traps, cut in the Scrapyard and set under one
 *   fight the crew is defending (§I4).
 *
 * Everything here is tradeable between players unless it says otherwise, because an item economy
 * where the interesting items cannot move is a collection, not a market.
 *
 * Six `blueprint_*` goods that predated pages were retired on 2026-09-28 (maintainer: drop anything
 * sold that cannot be used). They gated nothing; the fence's four blueprint lots now sell real
 * documents instead (`fenceOnly` in `blueprints/catalog.ts`). A stored inventory that still names
 * one is repaired on read (`db/repos/bases.ts`).
 */

// `consumable` is a thing built to be spent once: a trap laid under one fight. It is not a good
// (the shops never draw from it) and not a part (nothing is made out of it).
export const ITEM_KINDS = ['blueprint', 'page', 'component', 'consumable'] as const;
export const ItemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof ItemKindSchema>;

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
  // Added 2026-09-14. Every one of these has a sink below: a part with nothing to spend it on is
  // the relic problem again, which is why the relics are gone.
  'weld_rod',
  'hydraulic_ram',
  'signal_relay',
  'pressure_valve',
] as const;

export type GoodId = (typeof ITEM_IDS)[number];

/**
 * The consumables, one per entry in `TRAP_CATALOG` (§I4).
 *
 * Written out as ids rather than mapped off that catalogue, for the reason the module note gives:
 * `battle/` sits above `items/` in the import graph, and a value import reaching back up would
 * close the loop at module-load time. `traps.test.ts` in `battle/` checks the two lists against
 * each other in both directions, so a trap added there without an item here fails.
 *
 * Kept out of {@link ITEM_IDS} on purpose. That array is what the Runner's barrow and the salvage
 * bins draw from, and a trap has exactly one source: the yard, behind a document and a Lab rung.
 * A shop that sold them would be a door round both gates.
 */
export const CONSUMABLE_ITEM_IDS = [
  'trap_pressure_plates',
  'trap_gas_shell',
  'trap_collapse',
  'trap_razor_wire',
  'trap_fuel_fougasse',
  'trap_flooded_cellar',
] as const;

export type ConsumableId = (typeof CONSUMABLE_ITEM_IDS)[number];

/**
 * Every id that may sit in an inventory: goods, consumables, finished blueprints and their pages.
 *
 * A page is an item so that it is stored, shown and traded by machinery that already exists. It
 * goes into `inventory` on the base like anything else, which is what §F1e asks for, and it needs
 * no column of its own to survive a save.
 *
 * A **finished** blueprint is an item for the same reason and one more: it is the record that the
 * player pressed Unlock. `blueprints/state.ts` reads it as the difference between "holds every
 * page" and "owns this, permanently".
 */
export const ALL_ITEM_IDS = [
  ...ITEM_IDS,
  ...CONSUMABLE_ITEM_IDS,
  ...BLUEPRINT_IDS,
  ...BLUEPRINT_PAGE_IDS,
] as const;

export type ItemId = GoodId | ConsumableId | BlueprintId | BlueprintPageId;

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
  /** What it is for, in the player's words. Every item in here has a sink. */
  usedFor: string;
  /**
   * What a vendor asks for one, in caps. Also the floor the barter broker values it at, and the
   * number a player has to beat to make an offer worth taking.
   */
  capsValue: number;
  /** Whether another crew will take it off you on the board. Traps are not tradeable. */
  tradeable: boolean;
}

const SPECS: readonly ItemSpec[] = [
  {
    id: 'scrap_servo',
    name: 'Scrap Servo',
    kind: 'component',
    rarity: 'basic',
    description: 'A salvaged actuator, rewound by hand. Whines, but holds.',
    usedFor: 'The Gauntlet’s upper levels, and the unit cards with moving parts in them.',
    capsValue: 120,
    tradeable: true,
  },
  {
    id: 'gyro_assembly',
    name: 'Gyro Assembly',
    kind: 'component',
    rarity: 'intricate',
    description:
      'Three rings and a weight, machined true. The last shop that made them closed in the war.',
    usedFor: 'The Garage’s upper levels, and the fence’s chrome and drop rigs.',
    capsValue: 320,
    tradeable: true,
  },
  {
    id: 'ceramic_plate',
    name: 'Ceramic Plate',
    kind: 'component',
    rarity: 'intricate',
    description: 'Pressed armour tile. Stops one round properly and then it is gravel.',
    usedFor: 'Armour upgrades, and the heavy end of the roster.',
    capsValue: 280,
    tradeable: true,
  },
  {
    id: 'optic_cluster',
    name: 'Optic Cluster',
    kind: 'component',
    rarity: 'intricate',
    description: 'A lens stack and a sensor, pulled from something that used to watch a street.',
    usedFor: 'Targeting implants and the Lab’s observation work.',
    capsValue: 340,
    tradeable: true,
  },
  {
    id: 'neural_shunt',
    name: 'Neural Shunt',
    kind: 'component',
    rarity: 'advanced',
    description: 'Wet-side hardware. Goes in at the base of the skull and does not come out.',
    usedFor: 'Cybernetic upgrades. The good ones and the ones that cost something.',
    capsValue: 900,
    tradeable: true,
  },
  {
    id: 'coolant_cell',
    name: 'Coolant Cell',
    kind: 'component',
    rarity: 'advanced',
    description: 'Sealed, pressurised, and older than anyone using it.',
    usedFor: 'Anything that runs hot: the Generator’s upper levels, and the unit cards that do.',
    capsValue: 760,
    tradeable: true,
  },
  {
    id: 'rotor_hub',
    name: 'Rotor Hub',
    kind: 'component',
    rarity: 'masterpiece',
    description: 'The one part of a helicopter the yard cannot make from scratch.',
    usedFor: 'The Garage’s top level, and every Rotor Drop Rig the yard cuts.',
    capsValue: 2400,
    tradeable: true,
  },
  {
    id: 'targeting_core',
    name: 'Targeting Core',
    kind: 'component',
    rarity: 'masterpiece',
    description: 'A dead drone’s brain, still counting things it can no longer see.',
    usedFor: 'The yard’s best gun cards.',
    capsValue: 2100,
    tradeable: true,
  },
  {
    id: 'weld_rod',
    name: 'Welding Rods',
    kind: 'component',
    rarity: 'basic',
    description: 'A bundle of flux-coated rod, 3.2 mm, the size that actually gets used.',
    usedFor:
      'Anything joined rather than bolted: the early structures, and the first armour plate.',
    capsValue: 90,
    tradeable: true,
  },
  {
    id: 'hydraulic_ram',
    name: 'Hydraulic Ram',
    kind: 'component',
    rarity: 'intricate',
    description: 'A cylinder with its seals still good. The seals are the part worth having.',
    usedFor: 'Anything that has to lift or brace: the Gate, the yard, and heavy armour.',
    capsValue: 360,
    tradeable: true,
  },
  {
    id: 'signal_relay',
    name: 'Signal Relay',
    kind: 'component',
    rarity: 'intricate',
    description: 'A repeater board off a Combine handset, still paired to a dead network.',
    usedFor: 'Talking to each other under fire: the Lab, and the discipline line.',
    capsValue: 300,
    tradeable: true,
  },
  {
    id: 'pressure_valve',
    name: 'Pressure Valve',
    kind: 'component',
    rarity: 'advanced',
    description: 'Rated for pressures this district will never reach. Worth taking for that alone.',
    usedFor:
      'Anything that runs hot or wet: the Generator, the Greenhouse, and cooled cybernetics.',
    capsValue: 820,
    tradeable: true,
  },
];

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
    // Authored in `blueprints/catalog.ts`, next to the page's own name and drawing, rather than
    // worked out from a page count here. A page is a hand-made thing and the sheet that decides
    // whether a document is out of reach is not always the last one in the list.
    rarity: pageRarity(blueprint, page),
    description: page.description,
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
/**
 * What a fence document is valued as, in pages: the longest document in the game.
 *
 * A fence document has no pages to count (`fenceOnly`), and pricing it off zero would value the
 * rarest thing on the shelf at nothing.
 */
const FENCE_DOCUMENT_PAGE_WEIGHT = 8;

function blueprintItemSpec(blueprint: BlueprintSpec): ItemSpec {
  const pages = blueprint.fenceOnly ? FENCE_DOCUMENT_PAGE_WEIGHT : blueprint.pages.length;
  return {
    id: blueprint.id as ItemId,
    name: blueprint.name,
    kind: 'blueprint',
    rarity: blueprint.rarity,
    description: blueprint.blurb,
    usedFor: blueprint.fenceOnly
      ? 'Unlocked, permanently. Bought whole from the fence.'
      : `Unlocked, permanently. Assembled from ${pages} pages.`,
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
/**
 * The six traps as items (§I4).
 *
 * `tradeable: false`, which is the whole shape of the thing: a trap is behind a document and a Lab
 * rung, and an item that walked out of the yard onto a barrow would be a way past both for anybody
 * with caps. `capsValue` is therefore only the barter broker's floor and the number a salvage
 * valuation would read. It sits above each trap's own caps line and below the whole bill, because
 * what a crew paid for one is mostly scrap and planks rather than money.
 *
 * The ids match `TRAP_CATALOG` exactly. `springTrap` takes one out of the inventory by the id it was
 * set under, so the two lists being the same list is the mechanic and not a tidiness rule.
 */
const CONSUMABLE_SPECS: readonly ItemSpec[] = [
  {
    id: 'trap_pressure_plates',
    name: 'Pressure Plates',
    kind: 'consumable',
    rarity: 'intricate',
    description:
      'Boards over a stairwell with something underneath them, cut and weighted, ready to lay.',
    usedFor: 'Set under one fight you are defending. Gone once it goes off.',
    capsValue: 900,
    tradeable: false,
  },
  {
    id: 'trap_gas_shell',
    name: 'Buried Shell',
    kind: 'consumable',
    rarity: 'advanced',
    description: 'A cracked chemical round, packed for carrying, with the wire already on it.',
    usedFor: 'Set under one fight you are defending. Gone once it goes off.',
    capsValue: 2400,
    tradeable: false,
  },
  {
    id: 'trap_collapse',
    name: 'Prepared Collapse',
    kind: 'consumable',
    rarity: 'masterpiece',
    description:
      'Cutting gear, jacks and one holding charge. Somebody still has to survey the wall.',
    usedFor: 'Set under one fight you are defending. Gone once it goes off.',
    capsValue: 6000,
    tradeable: false,
  },
  {
    id: 'trap_razor_wire',
    name: 'Razor Wire',
    kind: 'consumable',
    rarity: 'basic',
    description: 'Two reels of tape, a bag of pickets and a pair of gloves that will not last.',
    usedFor: 'Set under one fight you are defending. Gone once it goes off.',
    capsValue: 700,
    tradeable: false,
  },
  {
    id: 'trap_fuel_fougasse',
    name: 'Fuel Fougasse',
    kind: 'consumable',
    rarity: 'advanced',
    description: 'A drum of thickened oil, a scatter charge and the dimensions of the pit.',
    usedFor: 'Set under one fight you are defending. Gone once it goes off.',
    capsValue: 3200,
    tradeable: false,
  },
  {
    id: 'trap_flooded_cellar',
    name: 'Flooded Cellar',
    kind: 'consumable',
    rarity: 'masterpiece',
    description: 'Sluice plate, cable and two bus bars. The cellar has to be found locally.',
    usedFor: 'Set under one fight you are defending. Gone once it goes off.',
    capsValue: 7800,
    tradeable: false,
  },
];

const ALL_SPECS: readonly ItemSpec[] = [
  ...SPECS,
  ...CONSUMABLE_SPECS,
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
  consumable: 'Consumable',
};
