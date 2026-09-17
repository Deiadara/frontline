import { z } from 'zod';
import { BLUEPRINTS } from '../blueprints/catalog.js';
import { PAGE_DRAW_WEIGHT } from '../blueprints/prize.js';
import type { ItemRarity } from '../items/rarity.js';
import { DEFAULT_CITY_ID } from '../city/cities.js';
import type { ItemCost } from '../items/inventory.js';
import { MILESTONE_STANDING_INVITATION, isPlayerUnlockActive } from '../progression/unlocks.js';
import { dayInZone, GAME_TIMEZONE, instantAtHourInZone } from '../time/zone.js';
import { LotAuctionSchema, canOpenLot, lotSeed, nextLotBid } from './auction.js';

/**
 * The back room of the market (black-market extension).
 *
 * The market proper is a shop: you turn caps and resources into things, and the only question is
 * whether you can afford it. This is the other kind of transaction: the shelf here is stocked with
 * things that are not for sale anywhere, and what it takes is **infamy**, which you cannot farm and
 * cannot trade. It is the sink that gives a reputation for violence somewhere to go.
 *
 * ## One city, one shelf
 *
 * Five slots, the same five for every player in the city, drawn from the day alone. That is the same
 * decision the Runner's barrow makes and for the same reason: a back room where two players see
 * different stock is a vending machine with a random number generator in it, and there is nothing
 * to say to anybody about it. Here everyone is looking at the same five things and knows that
 * somebody else can take the one they want.
 *
 * ## Every slot is a lot (maintainer, 2026-09-17)
 *
 * It used to be first press wins: the shelf was shared, but buying off it was not, so five crews
 * looking at the same crate were racing a network round trip and the one with the best connection
 * took it. That is the failure the Runner's barrow had, and it was fixed there the same way it is
 * fixed here. Every slot is a **lot** now. Bids are in the open all day under the crew's name, and
 * at midnight the fence settles: highest bidder takes the crate at what they bid.
 *
 * The machinery is the barrow's, not a second copy of it. `nextLotBid`, `rankLotBids` and
 * `lotSeed` in `auction.ts` decide the step, the ranking and the tie-break for both counters, and
 * {@link BlackMarketLotSchema} extends the same `LotAuctionSchema` the Runner's lots are drawn
 * from. Two things differ and both are deliberate: the currency is **infamy**, which is what this
 * room has always taken, and the close is the day boundary rather than the end of a two-hour visit,
 * because the fence never leaves.
 *
 * ## One a day, at the close
 *
 * A crew may win **one lot per day**, or two with a standing invitation. Not one bid: a crew may
 * be in on all five, and if it is leading more than it is allowed to win, the surplus falls to the
 * next crew down at the close. That is what makes the five a *choice* rather than a shopping list,
 * and it is why the prices can be steep without the screen turning into a grind.
 *
 * Nothing is escrowed at the bid, exactly as at the barrow: infamy is checked at the table and
 * again at the close, and a leader who has spent theirs in between passes to the crew behind them.
 *
 * The shelf stands for the whole day. A slot cannot empty mid-day any more, because nothing is
 * taken mid-day, so the generation below moves at the close of a lot that sold rather than at a
 * purchase.
 *
 * ## Almost no state
 *
 * A slot stores a single integer: how many times it has turned over today. The good itself is
 * derived from `(day, slot, generation)`, so the server writes one number when something is taken
 * and the client can draw the whole shelf without being told what is on it. Two servers a month
 * apart agree about what was on the shelf on any given day at any generation.
 *
 * The day is the **Athens** day (see `time/zone.ts`), not the UTC one. All time in this game is
 * Greece time, and a refresh that happened at a different hour than every other clock would be the
 * one thing on the screen quietly running to a different calendar.
 */

export const BLACK_MARKET_KINDS = [
  'contraband',
  'unit_upgrade',
  'blueprint',
  'battle_boost',
  'blueprint_page',
] as const;
export const BlackMarketKindSchema = z.enum(BLACK_MARKET_KINDS);
export type BlackMarketKind = z.infer<typeof BlackMarketKindSchema>;

export const BLACK_MARKET_KIND_LABELS: Readonly<Record<BlackMarketKind, string>> = {
  contraband: 'Contraband',
  unit_upgrade: 'Off-book kit',
  blueprint: 'Blueprint',
  battle_boost: 'Battle boost',
  blueprint_page: 'Blueprint page',
};

/** How many slots stand at once, and how many lots a crew may win in a day. */
export const BLACK_MARKET_SLOTS = 5;
export const BLACK_MARKET_TAKES_PER_DAY = 1;

/**
 * §I3, and how many lots a crew the door knows may win at one close.
 *
 * `MILESTONE_STANDING_INVITATION` at level 50 is the only thing that has ever moved this. One
 * extra, not an unlimited shelf: the point of the daily limit is that the five things on it are a
 * choice, and a crew that could take all five would be shopping rather than choosing.
 *
 * Enforced at the **close** rather than at the table. A crew may bid on every slot; the settle
 * walks the ranking and skips anybody already at their allowance for that day, so the fifth crate
 * a crew is leading goes to whoever is second on it.
 */
export function blackMarketTakesPerDay(level: number): number {
  return (
    BLACK_MARKET_TAKES_PER_DAY +
    (isPlayerUnlockActive(MILESTONE_STANDING_INVITATION, level) ? 1 : 0)
  );
}

/**
 * What a boost does to a force for exactly one fight.
 *
 * Percentages rather than flat numbers, so a syringe is worth the same to a squad of Runners as to
 * a Colossus and the table does not have to be retuned every time a unit sheet moves. Kept as a
 * plain bundle with no engine in it: the fight belongs to `battle/`, and this is the *contract*
 * between a purchase and the fight a player chooses to spend it on.
 */
export const BattleBoostSchema = z.object({
  /** Added to every unit's offense, as a percentage. */
  offensePercent: z.number(),
  /** Added to defence: armour and the will to stand in front of something. */
  defensePercent: z.number(),
  /** Added to the force's morale, which is what decides whether a bad round becomes a rout. */
  moralePercent: z.number(),
});
export type BattleBoost = z.infer<typeof BattleBoostSchema>;

export const NO_BOOST: BattleBoost = { offensePercent: 0, defensePercent: 0, moralePercent: 0 };

export interface BlackMarketGoodSpec {
  id: string;
  kind: BlackMarketKind;
  name: string;
  /** One line: what the thing physically is. */
  description: string;
  /** What it does, in the player's own words. This is the line the buy button is judged against. */
  effect: string;
  /** The price, in infamy. Nothing here is priced in anything else. */
  infamy: number;
  /**
   * §D7: the rank the fence will deal this to, or absent for anything he sells to anybody.
   *
   * Money is not the only thing a fence wants. The back room's whole premise is that walking in is
   * supposed to feel like walking somewhere you should not be, and a crew nobody has heard of
   * buying the best drawings in the city off a stranger is the one transaction that breaks it.
   * It is also the gate the notoriety ladder was missing: past `Marked` a rank changed no number
   * and opened no door, so the eight rungs above it were a word on a chip.
   *
   * On the *good* stock only. The syringes and the ordinary crates stay open to everybody, because
   * a shelf a new crew cannot buy from is a shelf they stop opening.
   */
  minNotoriety?: number;
  /** Battle boosts only: what a fight the crate is taken into gets. */
  boost?: BattleBoost;
  /** Everything else: what lands in the inventory. */
  grants?: ItemCost;
}

/**
 * The shelf.
 *
 * Weighted towards the consumables on purpose. A shelf where a blueprint is as likely as a syringe
 * is a shelf that hands out permanent knowledge every other day, and the infamy economy cannot
 * carry that. Boosts are the everyday purchase, contraband the frequent one, off-book kits the
 * treat and blueprints the thing you wait for.
 */
const SPECS: readonly BlackMarketGoodSpec[] = [
  // Battle boosts: one fight each, and they are what a crew comes back for.
  {
    id: 'adrenaline_syringes',
    kind: 'battle_boost',
    name: 'Adrenaline Syringes',
    description: 'A case of autoinjectors with the dosage label scraped off.',
    effect:
      'Any fight you take it into: +18% offense, +10% morale. Everybody is faster and nobody is calm.',
    infamy: 120,
    boost: { offensePercent: 18, defensePercent: 0, moralePercent: 10 },
  },
  {
    id: 'biochemical_infusers',
    kind: 'battle_boost',
    name: 'Biochemical Infusers',
    description: 'Pump packs that thread into the vest and feed something into the neck.',
    effect:
      'Any fight you take it into: +12% offense, +14% defence. It is not clear what is in them.',
    infamy: 180,
    boost: { offensePercent: 12, defensePercent: 14, moralePercent: 0 },
  },
  {
    id: 'banned_explosives',
    kind: 'battle_boost',
    name: 'Banned Explosives',
    description: 'Pre-Collapse breaching charges. The kind the Combine put a bounty on.',
    effect: 'Any fight you take it into: +30% offense. Doors, walls and the people behind them.',
    infamy: 260,
    boost: { offensePercent: 30, defensePercent: -4, moralePercent: 0 },
  },
  {
    id: 'combat_stims',
    kind: 'battle_boost',
    name: 'Combat Stims',
    description: 'Blister packs, chalky, bitter, and they work.',
    effect:
      'Any fight you take it into: +16% morale, +8% defence. Nobody breaks and nobody sleeps after.',
    infamy: 140,
    boost: { offensePercent: 0, defensePercent: 8, moralePercent: 16 },
  },
  {
    id: 'nerve_gas_canisters',
    kind: 'battle_boost',
    name: 'Nerve Gas Canisters',
    description: 'Four squat cylinders in a foam case, seals intact, stencils in a dead language.',
    effect:
      'Any fight you take it into: +26% offense, -8% morale. Your own people know what you brought.',
    infamy: 320,
    minNotoriety: 3,
    boost: { offensePercent: 26, defensePercent: 0, moralePercent: -8 },
  },

  // Contraband: parts and materiel that never reaches the Runner's barrow.
  {
    id: 'crate_neural_shunts',
    kind: 'contraband',
    name: 'Crate of Neural Shunts',
    description: 'Surgical stock, still sterile, still in Combine packaging.',
    effect: 'Three Neural Shunts into the inventory. The Runner will never carry these.',
    infamy: 240,
    grants: { neural_shunt: 3 },
  },
  {
    id: 'looted_targeting_cores',
    kind: 'contraband',
    name: 'Looted Targeting Cores',
    description: 'Pulled off something that was still warm.',
    effect: 'Two Targeting Cores into the inventory.',
    infamy: 220,
    grants: { targeting_core: 2 },
  },
  {
    id: 'salvaged_rotor_hub',
    kind: 'contraband',
    name: 'Salvaged Rotor Hub',
    description: 'A whole hub, off the books, no questions about the airframe it left.',
    effect: 'One Rotor Hub into the inventory.',
    infamy: 200,
    grants: { rotor_hub: 1 },
  },
  {
    id: 'coolant_run',
    kind: 'contraband',
    name: 'Coolant Run',
    description: 'Six cells on a hand truck, condensation still on them.',
    effect: 'Six Coolant Cells into the inventory.',
    infamy: 160,
    grants: { coolant_cell: 6 },
  },
  {
    id: 'ceramic_consignment',
    kind: 'contraband',
    name: 'Ceramic Consignment',
    description:
      'A pallet of plate that was written off in transit, by somebody paid to write it off.',
    effect: 'Eight Ceramic Plates into the inventory.',
    infamy: 150,
    grants: { ceramic_plate: 8 },
  },

  // Off-book kits: the parts a unit modification needs, sold as a set, so a card is cut early.
  {
    id: 'refit_hardshell',
    kind: 'unit_upgrade',
    name: 'Hardshell Kit',
    description: 'Everything the Gauntlet needs for a carapace, in one crate, minus the paperwork.',
    effect:
      'Eight Ceramic Plates and two Coolant Cells: most of a Hardshell Exoframe, without the wait.',
    infamy: 380,
    minNotoriety: 4,
    grants: { ceramic_plate: 8, coolant_cell: 2 },
  },
  {
    id: 'refit_wetwork',
    kind: 'unit_upgrade',
    name: 'Wetwork Kit',
    description: 'Shunts, optics and a sealed bag of things the fitter will not name.',
    effect: 'Two Neural Shunts and three Optic Clusters: cybernetics fitted out of hours.',
    infamy: 420,
    minNotoriety: 5,
    grants: { neural_shunt: 2, optic_cluster: 3 },
  },
  {
    id: 'refit_gunsmith',
    kind: 'unit_upgrade',
    name: "Gunsmith's Set",
    description: "Servos, cores and a jig, in a toolbox with somebody else's name on it.",
    effect: 'Four Scrap Servos and two Targeting Cores: gun work, off the books.',
    infamy: 340,
    minNotoriety: 4,
    grants: { scrap_servo: 4, targeting_core: 2 },
  },

  // Blueprints: the rare shelf, and the reason to check every day.
  {
    id: 'stolen_cybernetics_plans',
    kind: 'blueprint',
    name: 'Stolen Cybernetics Plans',
    description: 'A drum of microfiche and a reader that only works if you hold it level.',
    effect: 'The Cybernetics blueprint. Permanent, and nobody else has to know where it came from.',
    infamy: 520,
    minNotoriety: 7,
    grants: { blueprint_cybernetics: 1 },
  },
  {
    id: 'munitions_schematics',
    kind: 'blueprint',
    name: 'Munitions Schematics',
    description: 'Hand-copied, in three different hands, and the last page is missing.',
    effect: 'The Munitions blueprint. Enough of it survived to be worth having.',
    infamy: 480,
    minNotoriety: 6,
    grants: { blueprint_munitions: 1 },
  },
  {
    id: 'rotorcraft_plans',
    kind: 'blueprint',
    name: 'Rotorcraft Plans',
    description: 'A full airframe set, rolled in a length of pipe.',
    effect: 'The Rotorcraft blueprint. Somebody died carrying this out of the yard.',
    infamy: 560,
    minNotoriety: 8,
    grants: { blueprint_rotorcraft: 1 },
  },
  {
    id: 'field_medicine_notes',
    kind: 'blueprint',
    name: "A Field Surgeon's Notes",
    description: 'Two decades of a war nobody won, in handwriting that gets worse towards the end.',
    effect: 'The Field Medicine blueprint. Read it before a raid, not after.',
    infamy: 440,
    minNotoriety: 5,
    grants: { blueprint_field_medicine: 1 },
  },
];

/** The shelf id for a page. Distinct from the item id, which is what the purchase actually grants. */
export function pageGoodId(pageId: string): string {
  return `page_${pageId}`;
}

/**
 * §F2: every page, as something the fence can be holding.
 *
 * Generated rather than written out: a hand-written shelf entry per page would be one chance per page to spell a
 * page id wrong, and the price is a rule rather than a judgement. Unlike a mission, the fence tells
 * you exactly which page you are buying, which is what makes infamy worth spending here: the Market
 * is where you go when you need the *one* page you are short of, and the price is the tax on
 * skipping the wait.
 *
 * Priced off how many pages the document takes. An eight page blueprint is the rarest thing in the
 * game and its pages cost accordingly, so completing a Colossus by shopping is possible and never
 * cheap.
 */
const PAGE_INFAMY_BASE = 55;
const PAGE_INFAMY_PER_PAGE = 22;

const PAGE_GOODS: Record<string, BlackMarketGoodSpec> = Object.fromEntries(
  BLUEPRINTS.flatMap((blueprint) =>
    blueprint.pages.map((page): [string, BlackMarketGoodSpec] => [
      pageGoodId(page.id),
      {
        id: pageGoodId(page.id),
        kind: 'blueprint_page',
        name: page.name,
        description: `One page of the ${blueprint.name}.`,
        effect: `Goes into the ${blueprint.name}, which takes ${blueprint.pages.length} pages in all.`,
        infamy: PAGE_INFAMY_BASE + PAGE_INFAMY_PER_PAGE * blueprint.pages.length,
        grants: { [page.id]: 1 },
      },
    ]),
  ),
);

export const BLACK_MARKET_GOODS: Readonly<Record<string, BlackMarketGoodSpec>> = Object.freeze({
  ...Object.fromEntries(SPECS.map((spec) => [spec.id, spec])),
  ...PAGE_GOODS,
});

export const BLACK_MARKET_GOOD_IDS: readonly string[] = SPECS.map((spec) => spec.id);

export function findBlackMarketGood(id: string): BlackMarketGoodSpec | undefined {
  return BLACK_MARKET_GOODS[id];
}

/**
 * How often each kind comes up.
 *
 * Read as a ratio rather than a probability: for every blueprint on the shelf there are six boosts.
 * The numbers are the design, so they live here rather than being smeared across the draw below.
 */
const KIND_WEIGHT: Readonly<Record<BlackMarketKind, number>> = {
  battle_boost: 6,
  contraband: 4,
  unit_upgrade: 2,
  blueprint: 1,
  /*
   * §F2: rarest on the shelf, and rarer still than a whole blueprint.
   *
   * A page is the cheapest thing here and the one a player most wants to see, so weight is the only
   * brake on it. `PAGES_ON_THE_SHELF` is the other half: the deck carries a handful of pages a day
   * rather than the whole catalogue, or the Black Market stops being a black market and becomes a
   * page shop.
   */
  blueprint_page: 1,
};

/** FNV-1a then an LCG: the same derivation the Runner's barrow uses, kept local for the same reason. */
function rngFrom(seed: string): () => number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * The catalogue dealt into one deck per slot, for the day.
 *
 * This is the load-bearing decision in the whole module, and it replaced something that looked
 * simpler and was wrong. The first version drew each slot in turn and re-rolled anything an earlier
 * slot had already taken, which made every slot's contents depend on every other slot's. Emptying
 * slot 2 then collided with slot 4's draw, slot 4 silently became a different thing, and a player
 * who had been looking at slot 4 got told it had "moved on" by somebody else's purchase five feet
 * away. A gate caught it; nothing about the code said it.
 *
 * Dealing the ids into disjoint decks makes the property structural instead of procedural. Two
 * slots can never show the same thing because they are drawing from sets that do not intersect, and
 * a slot's contents depend on nothing but `(day, slot, generation)`. The deal is reshuffled daily,
 * so no item is stuck in one slot.
 */
/**
 * §F2: how many of the catalogue's pages the fence has on any given day.
 *
 * Four. The deck is dealt across the slots and worked through in order, so putting every page in it
 * would make roughly nine tenths of everything the Black Market ever shows a page, and the crates
 * and refits it exists for would stop appearing. Four is enough that a player who checks most days
 * sees pages regularly and never sees the one they are hunting on demand.
 */
export const PAGES_ON_THE_SHELF = 4;

/**
 * Which pages the fence has today, drawn from the day alone so every player sees the same shelf.
 *
 * Weighted by rarity (2026-09-17), the same ladder the mission prize draws on: see
 * {@link PAGE_DRAW_WEIGHT} for why it is as gentle as it is. This was the second of the two places
 * a page was drawn flat, and the two together were the whole of how a player finds one, so a
 * Masterpiece sheet was exactly as easy to come across as a Basic one on either channel.
 *
 * A weighted shuffle rather than a weighted pick repeated four times, because the four have to be
 * *different* pages: picking four times over would sometimes stock the same sheet twice and the
 * shelf would read as broken. Each page draws a key of `random ** (1 / weight)` and the top four
 * keys win, which is the standard way to take a weighted sample without replacement.
 */
export function pagesOnShelf(day: string): string[] {
  const rng = rngFrom(`${day}:black:pages`);
  const keyed = BLUEPRINTS.flatMap((blueprint) =>
    blueprint.pages.map((page) => {
      const rarity =
        ('rarity' in page ? (page.rarity as ItemRarity | undefined) : undefined) ??
        blueprint.rarity;
      return { id: pageGoodId(page.id), key: rng() ** (1 / PAGE_DRAW_WEIGHT[rarity]) };
    }),
  );
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, PAGES_ON_THE_SHELF).map((entry) => entry.id);
}

function decksFor(day: string, room: string): string[][] {
  const rng = rngFrom(`${room}${day}:black:deal`);
  const shuffled = [...BLACK_MARKET_GOOD_IDS, ...pagesOnShelf(day)];
  // Fisher-Yates, drawn from the same stream so the deal is reproducible from the date alone.
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  const decks: string[][] = Array.from({ length: BLACK_MARKET_SLOTS }, () => []);
  shuffled.forEach((id, index) => decks[index % BLACK_MARKET_SLOTS]?.push(id));
  return decks;
}

/**
 * The order a slot works through its deck, with rarity folded in.
 *
 * A *sequence* rather than a draw, and that is what buys the second half of the refill rule: a slot
 * at generation `g` shows `sequence[g % length]`, so consecutive generations are consecutive
 * entries and a refill is guaranteed to be something else. Drawing randomly each time would hand a
 * player the same crate back roughly a third of the time, which reads as a purchase that did not
 * happen.
 *
 * Rarity survives because the sequence is built in *passes*: everything appears in pass one,
 * everything with weight above one appears again in pass two, and so on, so a common item comes
 * round six times as often as a blueprint. Each pass is rotated by one, which is what keeps the
 * item at the end of a pass different from the item at the start of the next.
 */
function sequenceFor(day: string, index: number, deck: readonly string[], room: string): string[] {
  const rng = rngFrom(`${room}${day}:black:${index}:order`);
  const distinct = [...deck];
  for (let at = distinct.length - 1; at > 0; at--) {
    const swap = Math.floor(rng() * (at + 1));
    [distinct[at], distinct[swap]] = [distinct[swap]!, distinct[at]!];
  }

  const weightOf = (id: string) => {
    const spec = BLACK_MARKET_GOODS[id];
    return spec ? KIND_WEIGHT[spec.kind] : 1;
  };
  const passes = Math.max(...distinct.map(weightOf), 1);

  const sequence: string[] = [];
  for (let pass = 0; pass < passes; pass++) {
    for (let step = 0; step < distinct.length; step++) {
      const id = distinct[(step + pass) % distinct.length]!;
      if (weightOf(id) > pass) sequence.push(id);
    }
  }

  // The rotation keeps a pass boundary clean, but it cannot see the seam where the sequence wraps
  // round to its own start, and that seam is a real generation boundary for any slot the city
  // works all the way through in a day. Collapsing neighbours and then trimming the wrap costs one
  // entry of weight and makes the "a refill is always something else" rule hold everywhere rather
  // than almost everywhere.
  const spaced = sequence.filter((id, at) => id !== sequence[at - 1]);
  if (spaced.length > 1 && spaced[0] === spaced[spaced.length - 1]) spaced.pop();
  return spaced;
}

/**
 * What the city's average player level does to the back room (board).
 *
 * The shelf is **one shared shelf for the whole city**, and it is the only thing in the game that
 * is. That is what makes this necessary rather than decorative: a fixed catalogue is either
 * unaffordable to the crews who need it or free to the crews who do not, depending entirely on how
 * far along everybody else happens to be, and a fixed *effect* is a rounding error at level fifty
 * and a decisive advantage at level three, which is the same problem read the other way.
 *
 * So both move with the room. The dealer reads the street, prices what it will bear, and stocks
 * what is worth stocking for the company he is currently keeping.
 *
 * Measured off the **average**, not off the buyer. Off the buyer it would be a per-player price
 * list, which is not a black market, it is a shop; off the average it is a fact about the city that
 * every crew in it reads the same way, and a low-level crew in a veteran city genuinely is being
 * quoted prices meant for somebody else. That is the intended feeling.
 */
const REFERENCE_CITY_LEVEL = 1;

/** Fraction added to a price, and to a boost, per level of city average above the reference. */
export const BLACK_MARKET_PRICE_PER_LEVEL = 0.06;
export const BLACK_MARKET_POTENCY_PER_LEVEL = 0.03;

/**
 * The ceiling on the potency multiplier.
 *
 * Prices may run away: infamy is earned faster in a veteran city too, so the two curves track each
 * other, but a boost may not. Doubling every figure on the crate turns a +18% syringe into +36%,
 * which is past the point where a defence can be built against it at all. Capped at half again.
 */
export const MAX_BLACK_MARKET_POTENCY = 1.5;

/** The city's average player level, floored at the reference. Bots are not players (§A3). */
export function averageCityLevel(levels: readonly number[]): number {
  const players = levels.filter((level) => Number.isFinite(level) && level > 0);
  if (players.length === 0) return REFERENCE_CITY_LEVEL;
  const mean = players.reduce((total, level) => total + level, 0) / players.length;
  return Math.max(REFERENCE_CITY_LEVEL, mean);
}

/** What one crate costs in a city this far along, in infamy. */
export function blackMarketPrice(spec: BlackMarketGoodSpec, cityLevel: number): number {
  const above = Math.max(0, cityLevel - REFERENCE_CITY_LEVEL);
  return Math.max(1, Math.round(spec.infamy * (1 + BLACK_MARKET_PRICE_PER_LEVEL * above)));
}

/** How much better the goods are in a city this far along, as a multiplier on every figure. */
export function blackMarketPotency(cityLevel: number): number {
  const above = Math.max(0, cityLevel - REFERENCE_CITY_LEVEL);
  return Math.min(MAX_BLACK_MARKET_POTENCY, 1 + BLACK_MARKET_POTENCY_PER_LEVEL * above);
}

/**
 * One crate's boost as it would actually land, in a city this far along.
 *
 * Rounded per figure rather than scaled as a bundle, because these are the numbers a player reads
 * on the card and then expects to see in the report. A penalty (the Chem Cocktail's -4% defence)
 * scales with everything else: a better batch is a stronger batch, not a safer one.
 */
export function blackMarketEffect(spec: BlackMarketGoodSpec, cityLevel: number): string {
  const boost = blackMarketBoost(spec, cityLevel);
  if (!boost) return spec.effect;

  // Written from the numbers rather than authored, because the authored line has the *catalogue's*
  // figures baked into its prose, and a card that reads "+18% offense" over a fight that applied
  // +27% is the card lying, which is worse than the card being plain.
  const parts = [
    ['offense', boost.offensePercent],
    ['defence', boost.defensePercent],
    ['morale', boost.moralePercent],
  ]
    .filter(([, value]) => value !== 0)
    .map(
      ([label, value]) => `${(value as number) > 0 ? '+' : ''}${String(value)}% ${String(label)}`,
    );
  // "Whichever battle you take it into", not "your next battle": a crate is applied to a fight on
  // that fight's own screen now rather than spending itself on whatever happens next.
  return parts.length === 0
    ? spec.effect
    : `Any fight you take it into: ${parts.join(', ')}. ${spec.effect.split('. ').slice(1).join('. ')}`.trim();
}

export function blackMarketBoost(
  spec: BlackMarketGoodSpec,
  cityLevel: number,
): BattleBoost | undefined {
  if (!spec.boost) return undefined;
  const potency = blackMarketPotency(cityLevel);
  const scale = (value: number): number => Math.round(value * potency);
  return {
    offensePercent: scale(spec.boost.offensePercent),
    defensePercent: scale(spec.boost.defensePercent),
    moralePercent: scale(spec.boost.moralePercent),
  };
}

/** The Athens calendar date a moment belongs to. The shelf's unit of time. */
export function blackMarketDay(now: Date, zone: string = GAME_TIMEZONE): string {
  return dayInZone(now, zone);
}

export const BlackMarketSlotSchema = z.object({
  /** 0..{@link BLACK_MARKET_SLOTS}-1. Stable for the day; only what stands in it changes. */
  index: z.number().int().nonnegative(),
  /** How many times this slot has been emptied today. Part of the good's seed. */
  generation: z.number().int().nonnegative(),
  goodId: z.string().min(1),
});
export type BlackMarketSlot = z.infer<typeof BlackMarketSlotSchema>;

/**
 * What is on the shelf, given how many times each slot has turned over today.
 *
 * Each slot draws from its own deck (see {@link decksFor}), so the five are always five different
 * things and emptying one of them cannot disturb the other four. The refill is guaranteed to
 * *differ* from what was just taken, which is the visible half of the rule: a slot that restocked
 * with the same crate would read as a purchase that did not happen.
 */
export function blackMarketBoard(
  day: string,
  generations: readonly number[],
  cityId: string = DEFAULT_CITY_ID,
): BlackMarketSlot[] {
  const room = blackRoomKey(cityId);
  const decks = decksFor(day, room);
  return Array.from({ length: BLACK_MARKET_SLOTS }, (_, index) => {
    const generation = Math.max(0, generations[index] ?? 0);
    // A deck can only run short if the catalogue is smaller than the shelf, which a test forbids;
    // falling back to everything keeps this total rather than throwing on a data edit.
    const deck = decks[index] ?? [];
    const sequence = sequenceFor(
      day,
      index,
      deck.length > 0 ? deck : [...BLACK_MARKET_GOOD_IDS],
      room,
    );
    return {
      index,
      generation,
      goodId: sequence[generation % sequence.length] ?? SPECS[0]!.id,
    };
  });
}

export const BLACK_MARKET_REFUSALS = [
  'unknown_slot',
  'moved_on',
  'not_enough_infamy',
  /** §D7: he has the thing. He does not hand it to somebody the street has not heard of. */
  'not_known_enough',
  /** Under the opening price, or under whoever is in front. */
  'too_low',
  /** Already leading it. Raising your own number buys nothing and costs the reputation. */
  'outbid_yourself',
  /** §H7a: `MAX_OPEN_LOTS` lots at once, counted across the shelf on the night they stand. */
  'too_many_lots',
] as const;
export const BlackMarketRefusalSchema = z.enum(BLACK_MARKET_REFUSALS);
export type BlackMarketRefusal = z.infer<typeof BlackMarketRefusalSchema>;

export const BLACK_MARKET_REFUSAL_TEXT: Readonly<Record<BlackMarketRefusal, string>> = {
  unknown_slot: 'There is nothing in that slot.',
  moved_on: 'Somebody got there first. Something else is in that slot now.',
  not_enough_infamy: 'He has heard of you, but not enough. Come back with a worse reputation.',
  not_known_enough: 'He keeps this for people with a name. Yours is not one of them yet.',
  too_low: 'He will not write that down. Somebody has already said more.',
  too_many_lots: 'You have a name down on every crate you can hold. Wait for one to close.',
  outbid_yourself: 'You are the one in front. Bidding against yourself is not a negotiation.',
};

/*
 * There is no `daily_limit` refusal any more, and that is a statement about where the limit lives.
 *
 * It used to refuse the second *take* of a day. Nothing is taken now: a crew may say a number on
 * all five lots, and the allowance is spent at the close, where `settleBlackMarketLots` walks past
 * a crew that is already at it and hands the crate to whoever is behind them. A refusal nothing can
 * return is a sentence a player will never see, so it is not written.
 */

/**
 * §A4: the Statue of the Revolutionist takes infamy off what the dealer asks.
 *
 * Capped and floored: standing under nine metres of bronze does not make contraband free, and a
 * price of zero would turn the daily limit into the only gate the black market has.
 *
 * This lives beside `blackMarketPrice` rather than on the server because three places need the same
 * answer: the card that quotes it, the close that charges it, and `blackBidRefusal` that decides
 * whether a number can be written down at all. It used to live only next to the first two, and the
 * third compared against the undiscounted figure: a crew holding the Statue with infamy between 85%
 * and 100% of a price saw an affordable button, pressed it, and was told the dealer had not heard
 * enough of them.
 *
 * It comes off the **bid**, not off the reserve. The reserve is the city's floor and has to be the
 * same number for everybody at the table; the discount is what the winner is charged, exactly as a
 * crew's ground comes off what they pay at the Runner's close.
 */
export const MAX_BLACK_MARKET_DISCOUNT = 50;

export function discountedInfamy(price: number, percent: number): number {
  if (!Number.isFinite(price)) return price;
  const off = Math.min(MAX_BLACK_MARKET_DISCOUNT, Math.max(0, percent));
  return Math.max(1, Math.round(price * (1 - off / 100)));
}

/**
 * Which city's back room this is, as a prefix.
 *
 * Every city, the open one included. The first version folded Ashfall to an empty string so that
 * lot ids already filed in `black_market_bids` and `black_market_lot_results` kept their names;
 * with nothing released there is nothing to keep, and one scheme with no special case is worth more
 * than a migration-safety trick nobody needs (maintainer, 2026-09-17: breaking changes are fine).
 */
export function blackRoomKey(cityId: string): string {
  return `${cityId}:`;
}

/**
 * Which city a stored lot id belongs to.
 *
 * The close reads its work out of `black_market_lot_results` and `black_market_bids`, where the
 * only thing identifying the room is the id's own prefix, so this is the one place it is read back.
 * A city id can never contain a colon (they are slugs, see `city/atlas.ts`), which is what makes
 * splitting on the first one total rather than a guess.
 */
export function cityOfBlackLot(lotId: string): string {
  const colon = lotId.indexOf(':');
  return colon === -1 ? DEFAULT_CITY_ID : lotId.slice(0, colon);
}

/**
 * The lot id a bid names: the slot, on the day it stood, in the room it stood in.
 *
 * The city goes in the id rather than beside it because that is what keeps two cities' slot 3 from
 * being one auction: the bids table is keyed `(day, lot_id, user_id)` and the results table on
 * `(day, lot_id)`, so unique ids are the whole of what makes the rooms separate ledgers. Every
 * city is named, so `ashfall:2026-09-17-black-3` and nothing is a special case.
 */
export function blackLotId(
  day: string,
  slotIndex: number,
  cityId: string = DEFAULT_CITY_ID,
): string {
  return `${blackRoomKey(cityId)}${day}-black-${slotIndex}`;
}

/**
 * When the fence settles: the end of the Athens day the shelf belongs to.
 *
 * Hour 24, which `instantAtHourInZone` reads as the first instant of the next day, so the close and
 * the shelf's own turnover are the same instant rather than two clocks a second apart. The Runner's
 * `visitClosesAt` spells the same trick for the same reason.
 */
export function blackMarketClosesAt(day: string, zone: string = GAME_TIMEZONE): Date {
  return instantAtHourInZone(day, 24, zone);
}

/** What seeds a lot's tie-break coin. The barrow's function, with the fence's one session. */
export function blackLotSeed(
  day: string,
  slotIndex: number,
  cityId: string = DEFAULT_CITY_ID,
): string {
  return lotSeed(day, 0, blackLotId(day, slotIndex, cityId));
}

/** One slot's auction, as this reader sees it. The barrow's shape with the fence's lot id on it. */
export const BlackMarketLotSchema = LotAuctionSchema.extend({
  lotId: z.string().min(1),
  /** Which slot on the shelf, so a card and its lot cannot be matched up wrongly. */
  slotIndex: z.number().int().nonnegative(),
});
export type BlackMarketLot = z.infer<typeof BlackMarketLotSchema>;

/** Bidding names the slot, what was believed to be in it, and the number. */
export const PlaceBlackMarketBidRequestSchema = z.object({
  slotIndex: z.number().int().min(0),
  goodId: z.string().min(1),
  amount: z.number().int().positive(),
  /**
   * Which city's back room the bid is placed in. Absent means the crew's own.
   *
   * Carried on the request, unlike the barrow's bid, and the difference is the identifier: a
   * vendor bid names a line id that already has the room in it, while a fence bid names a slot
   * index, which is 0 to 4 in every city. Without this field a crew standing in Saltmarch would
   * bid on Ashfall's slot 3.
   */
  city: z.string().min(1).optional(),
});
export type PlaceBlackMarketBidRequest = z.infer<typeof PlaceBlackMarketBidRequestSchema>;

export interface BlackBidRequest {
  /** Which slot, and what the player believed was in it. Both, so a shelf that turned over under
   *  the reader is refused rather than bid on by accident. */
  slotIndex: number;
  goodId: string;
  /** The shelf as it actually stands, server-side. */
  board: readonly BlackMarketSlot[];
  /** The number said, in infamy. */
  amount: number;
  /** What the crew has to spend right now. Checked again at the close; nothing is escrowed. */
  infamy: number;
  /** The city's average player level, which is what the opening price is weighted by. */
  cityLevel: number;
  /** The highest bid already on this lot, or null on an untouched one. */
  leading: number | null;
  /** Whether the reader is the crew holding that leading bid. */
  leadingIsYou: boolean;
  /** §A4: this crew's standing discount, so the guard tests what the close will actually charge. */
  discountPercent?: number;
  /** §D7: the crew's rank, for the stock the fence keeps for people with a name. */
  notoriety?: number;
  /**
   * The slots this crew already has money on tonight (maintainer, 2026-09-17).
   *
   * §H7a's rule, which the Bar has always had and neither shelf did: `MAX_OPEN_LOTS` at once. Slots
   * rather than a count, so raising on a lot the crew is already in is never the one refused. The
   * shelf stands for the whole day, so the slot is the lot's identity for as long as the limit
   * counts. Left out entirely by a caller that has not read them, which reads as "no lots" and
   * therefore never refuses: a guard that fired on an unsupplied argument would be a guard that
   * refused everybody the day somebody forgot to pass it.
   */
  openSlots?: readonly number[];
}

/**
 * Where a lot opens: the city's number, with nobody's standing on it.
 *
 * The same call the barrow makes and for the same reason. Two crews bidding against each other have
 * to be bidding against the same floor, or one crew's legal offer is under the other's reserve.
 * A winner's own discount comes off what they **pay** at the close.
 */
export function blackLotReserve(spec: BlackMarketGoodSpec, cityLevel: number): number {
  return blackMarketPrice(spec, cityLevel);
}

/** The first reason this bid cannot be written down, or `null`. Nothing here writes anything. */
export function blackBidRefusal(request: BlackBidRequest): BlackMarketRefusal | null {
  const slot = request.board.find((entry) => entry.index === request.slotIndex);
  if (!slot) return 'unknown_slot';
  // The good is named in the request as well as the slot, so a reader whose shelf turned over
  // under them bids on nothing rather than on the replacement.
  if (slot.goodId !== request.goodId) return 'moved_on';
  const spec = findBlackMarketGood(slot.goodId);
  if (!spec) return 'unknown_slot';
  /*
   * Before the number, because it is the refusal a player can do nothing about tonight.
   *
   * Being told "you are short of infamy" about a crate he was never going to sell you sends a
   * player away to earn a number that was not the reason.
   */
  if ((request.notoriety ?? 0) < (spec.minNotoriety ?? 0)) return 'not_known_enough';
  if (request.leadingIsYou) return 'outbid_yourself';
  /*
   * Before the price, for the same reason the rank gate is: a crew who cannot open another lot
   * cannot open this one at any number, and telling them to bid higher sends them to do something
   * that was never going to work.
   */
  if (!canOpenLot(request.openSlots ?? [], request.slotIndex)) return 'too_many_lots';

  const reserve = blackLotReserve(spec, request.cityLevel);
  if (request.amount < nextLotBid(reserve, request.leading)) return 'too_low';
  // What the close would actually charge this crew, which is the bid after their own standing.
  // A gate on the raw bid would refuse bids the crew could comfortably cover, and the two numbers
  // would then disagree about the same crew at the table and at the close.
  if (request.infamy < discountedInfamy(request.amount, request.discountPercent ?? 0)) {
    return 'not_enough_infamy';
  }
  return null;
}

/**
 * Boosts a crew is holding, waiting to be taken into a fight.
 *
 * A sparse count map, exactly like the inventory and for the same reason: two syringes are two
 * syringes, and a zero is not a fact worth storing.
 *
 * The bag used to empty itself into whichever battle resolved next, on both sides, which meant the
 * only decision a crate involved was when to next press attack. Its contents are listed under
 * **Boosts** on a fight's own screen now and one is applied there, against intel the player has
 * already read. See `battle/view.ts` and `appliedBoost` in `battle/resolve.ts`.
 */
export const BoostStashSchema: z.ZodType<Record<string, number>> = z.record(
  z.string().min(1),
  z.number().int().positive(),
);
export type BoostStash = z.infer<typeof BoostStashSchema>;

export function stashCount(stash: BoostStash, goodId: string): number {
  return stash[goodId] ?? 0;
}

export function addToStash(stash: BoostStash, goodId: string): BoostStash {
  return { ...stash, [goodId]: stashCount(stash, goodId) + 1 };
}

/** Takes one out, dropping the key at zero. Floors rather than going negative, like `removeItems`. */
export function takeFromStash(stash: BoostStash, goodId: string): BoostStash {
  const next = { ...stash };
  const left = stashCount(stash, goodId) - 1;
  if (left > 0) next[goodId] = left;
  else delete next[goodId];
  return next;
}
