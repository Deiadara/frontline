import { z } from 'zod';
import type { ItemCost } from '../items/inventory.js';
import { MILESTONE_STANDING_INVITATION, isPlayerUnlockActive } from '../progression/unlocks.js';
import { dayInZone, GAME_TIMEZONE } from '../time/zone.js';

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
 * ## One a day, and the shelf never empties
 *
 * A crew may take **one thing per day**. Not one per slot, not one per kind: one. That is what
 * makes the five a *choice* rather than a shopping list, and it is why the prices can be steep
 * without the screen turning into a grind.
 *
 * What is taken is replaced immediately, so the shelf is always five deep. A slot that emptied
 * until midnight would punish everybody in the city for whoever got there first, and the interesting
 * version of scarcity here is "somebody took the one I wanted and something else is there now",
 * not "come back tomorrow".
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
] as const;
export const BlackMarketKindSchema = z.enum(BLACK_MARKET_KINDS);
export type BlackMarketKind = z.infer<typeof BlackMarketKindSchema>;

export const BLACK_MARKET_KIND_LABELS: Readonly<Record<BlackMarketKind, string>> = {
  contraband: 'Contraband',
  unit_upgrade: 'Off-book refit',
  blueprint: 'Blueprint',
  battle_boost: 'Battle boost',
};

/** How many slots stand at once, and how many a crew may empty in a day. */
export const BLACK_MARKET_SLOTS = 5;
export const BLACK_MARKET_TAKES_PER_DAY = 1;

/**
 * §I3, and how many a crew the door knows may empty.
 *
 * `MILESTONE_STANDING_INVITATION` at level 50 is the only thing that has ever moved this. One
 * extra, not an unlimited shelf: the point of the daily limit is that the five things on it are a
 * choice, and a crew that could take all five would be shopping rather than choosing.
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
 * between a purchase and whoever resolves the next battle.
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
  /** Battle boosts only: what the next fight gets. */
  boost?: BattleBoost;
  /** Everything else: what lands in the satchel. */
  grants?: ItemCost;
}

/**
 * The shelf.
 *
 * Weighted towards the consumables on purpose. A shelf where a blueprint is as likely as a syringe
 * is a shelf that hands out permanent knowledge every other day, and the infamy economy cannot
 * carry that. Boosts are the everyday purchase, contraband the frequent one, off-book refits the
 * treat and blueprints the thing you wait for.
 */
const SPECS: readonly BlackMarketGoodSpec[] = [
  // Battle boosts: one fight each, and they are what a crew comes back for.
  {
    id: 'adrenaline_syringes',
    kind: 'battle_boost',
    name: 'Adrenaline Syringes',
    description: 'A case of autoinjectors with the dosage label scraped off.',
    effect: 'Your next battle: +18% offense, +10% morale. Everybody is faster and nobody is calm.',
    infamy: 120,
    boost: { offensePercent: 18, defensePercent: 0, moralePercent: 10 },
  },
  {
    id: 'biochemical_infusers',
    kind: 'battle_boost',
    name: 'Biochemical Infusers',
    description: 'Pump packs that thread into the vest and feed something into the neck.',
    effect: 'Your next battle: +12% offense, +14% defence. It is not clear what is in them.',
    infamy: 180,
    boost: { offensePercent: 12, defensePercent: 14, moralePercent: 0 },
  },
  {
    id: 'banned_explosives',
    kind: 'battle_boost',
    name: 'Banned Explosives',
    description: 'Pre-Collapse breaching charges. The kind the Combine put a bounty on.',
    effect: 'Your next battle: +30% offense. Doors, walls and the people behind them.',
    infamy: 260,
    boost: { offensePercent: 30, defensePercent: -4, moralePercent: 0 },
  },
  {
    id: 'combat_stims',
    kind: 'battle_boost',
    name: 'Combat Stims',
    description: 'Blister packs, chalky, bitter, and they work.',
    effect: 'Your next battle: +16% morale, +8% defence. Nobody breaks and nobody sleeps after.',
    infamy: 140,
    boost: { offensePercent: 0, defensePercent: 8, moralePercent: 16 },
  },
  {
    id: 'nerve_gas_canisters',
    kind: 'battle_boost',
    name: 'Nerve Gas Canisters',
    description: 'Four squat cylinders in a foam case, seals intact, stencils in a dead language.',
    effect: 'Your next battle: +26% offense, -8% morale. Your own people know what you brought.',
    infamy: 320,
    boost: { offensePercent: 26, defensePercent: 0, moralePercent: -8 },
  },

  // Contraband: parts and materiel that never reaches the Runner's barrow.
  {
    id: 'crate_neural_shunts',
    kind: 'contraband',
    name: 'Crate of Neural Shunts',
    description: 'Surgical stock, still sterile, still in Combine packaging.',
    effect: 'Three Neural Shunts into the satchel. The Runner will never carry these.',
    infamy: 240,
    grants: { neural_shunt: 3 },
  },
  {
    id: 'looted_targeting_cores',
    kind: 'contraband',
    name: 'Looted Targeting Cores',
    description: 'Pulled off something that was still warm.',
    effect: 'Two Targeting Cores into the satchel.',
    infamy: 220,
    grants: { targeting_core: 2 },
  },
  {
    id: 'salvaged_rotor_hub',
    kind: 'contraband',
    name: 'Salvaged Rotor Hub',
    description: 'A whole hub, off the books, no questions about the airframe it left.',
    effect: 'One Rotor Hub into the satchel.',
    infamy: 200,
    grants: { rotor_hub: 1 },
  },
  {
    id: 'coolant_run',
    kind: 'contraband',
    name: 'Coolant Run',
    description: 'Six cells on a hand truck, condensation still on them.',
    effect: 'Six Coolant Cells into the satchel.',
    infamy: 160,
    grants: { coolant_cell: 6 },
  },
  {
    id: 'ceramic_consignment',
    kind: 'contraband',
    name: 'Ceramic Consignment',
    description:
      'A pallet of plate that was written off in transit, by somebody paid to write it off.',
    effect: 'Eight Ceramic Plates into the satchel.',
    infamy: 150,
    grants: { ceramic_plate: 8 },
  },

  // Off-book refits: the parts an upgrade needs, sold as a set, so a line opens early.
  {
    id: 'refit_hardshell',
    kind: 'unit_upgrade',
    name: 'Hardshell Refit Kit',
    description: 'Everything the Gauntlet needs for a carapace, in one crate, minus the paperwork.',
    effect: 'Eight Ceramic Plates and two Coolant Cells: a Hardshell Rig without the wait.',
    infamy: 380,
    grants: { ceramic_plate: 8, coolant_cell: 2 },
  },
  {
    id: 'refit_wetwork',
    kind: 'unit_upgrade',
    name: 'Wetwork Refit Kit',
    description: 'Shunts, optics and a sealed bag of things the fitter will not name.',
    effect: 'Two Neural Shunts and three Optic Clusters: cybernetics fitted out of hours.',
    infamy: 420,
    grants: { neural_shunt: 2, optic_cluster: 3 },
  },
  {
    id: 'refit_gunsmith',
    kind: 'unit_upgrade',
    name: "Gunsmith's Set",
    description: "Servos, cores and a jig, in a toolbox with somebody else's name on it.",
    effect: 'Four Scrap Servos and two Targeting Cores: the weapons line, off the books.',
    infamy: 340,
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
    grants: { blueprint_cybernetics: 1 },
  },
  {
    id: 'munitions_schematics',
    kind: 'blueprint',
    name: 'Munitions Schematics',
    description: 'Hand-copied, in three different hands, and the last page is missing.',
    effect: 'The Munitions blueprint. Enough of it survived to be worth having.',
    infamy: 480,
    grants: { blueprint_munitions: 1 },
  },
  {
    id: 'rotorcraft_plans',
    kind: 'blueprint',
    name: 'Rotorcraft Plans',
    description: 'A full airframe set, rolled in a length of pipe.',
    effect: 'The Rotorcraft blueprint. Somebody died carrying this out of the yard.',
    infamy: 560,
    grants: { blueprint_rotorcraft: 1 },
  },
  {
    id: 'field_medicine_notes',
    kind: 'blueprint',
    name: "A Field Surgeon's Notes",
    description: 'Two decades of a war nobody won, in handwriting that gets worse towards the end.',
    effect: 'The Field Medicine blueprint. Read it before a raid, not after.',
    infamy: 440,
    grants: { blueprint_field_medicine: 1 },
  },
];

export const BLACK_MARKET_GOODS: Readonly<Record<string, BlackMarketGoodSpec>> = Object.freeze(
  Object.fromEntries(SPECS.map((spec) => [spec.id, spec])),
);

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
function decksFor(day: string): string[][] {
  const rng = rngFrom(`${day}:black:deal`);
  const shuffled = [...BLACK_MARKET_GOOD_IDS];
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
function sequenceFor(day: string, index: number, deck: readonly string[]): string[] {
  const rng = rngFrom(`${day}:black:${index}:order`);
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
  return parts.length === 0
    ? spec.effect
    : `Your next battle: ${parts.join(', ')}. ${spec.effect.split('. ').slice(1).join('. ')}`.trim();
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
export function blackMarketBoard(day: string, generations: readonly number[]): BlackMarketSlot[] {
  const decks = decksFor(day);
  return Array.from({ length: BLACK_MARKET_SLOTS }, (_, index) => {
    const generation = Math.max(0, generations[index] ?? 0);
    // A deck can only run short if the catalogue is smaller than the shelf, which a test forbids;
    // falling back to everything keeps this total rather than throwing on a data edit.
    const deck = decks[index] ?? [];
    const sequence = sequenceFor(day, index, deck.length > 0 ? deck : [...BLACK_MARKET_GOOD_IDS]);
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
  'daily_limit',
] as const;
export const BlackMarketRefusalSchema = z.enum(BLACK_MARKET_REFUSALS);
export type BlackMarketRefusal = z.infer<typeof BlackMarketRefusalSchema>;

export const BLACK_MARKET_REFUSAL_TEXT: Readonly<Record<BlackMarketRefusal, string>> = {
  unknown_slot: 'There is nothing in that slot.',
  moved_on: 'Somebody got there first. Something else is in that slot now.',
  not_enough_infamy: 'He has heard of you, but not enough. Come back with a worse reputation.',
  daily_limit: 'One a day. He is not greedy and he is not stupid.',
};

export interface TakeRequest {
  /** Which slot, and what the player believed was in it. Both, so a race is refused rather than
   *  silently charged for something else. */
  slotIndex: number;
  goodId: string;
  /** The shelf as it actually stands, server-side. */
  board: readonly BlackMarketSlot[];
  infamy: number;
  /** How many things this crew has already taken today. */
  takenToday: number;
  /** §I3: the player level, which is what decides how many takes a day they get. */
  level: number;
  /** The city's average player level, which is what the price is weighted by. */
  cityLevel: number;
}

/** The first reason this cannot be taken, or `null`. Nothing here writes anything. */
export function takeRefusal(request: TakeRequest): BlackMarketRefusal | null {
  const slot = request.board.find((entry) => entry.index === request.slotIndex);
  if (!slot) return 'unknown_slot';
  // The good is named in the request as well as the slot, so a player who clicked a moment after
  // somebody else took it is told what happened instead of being sold the replacement.
  if (slot.goodId !== request.goodId) return 'moved_on';
  const spec = findBlackMarketGood(slot.goodId);
  if (!spec) return 'unknown_slot';
  if (request.takenToday >= blackMarketTakesPerDay(request.level)) return 'daily_limit';
  // The weighted price, not the catalogue's: what the dealer is asking in *this* city.
  if (request.infamy < blackMarketPrice(spec, request.cityLevel)) return 'not_enough_infamy';
  return null;
}

/**
 * Boosts a crew is holding, waiting for a fight.
 *
 * A sparse count map, exactly like the satchel and for the same reason: two syringes are two
 * syringes, and a zero is not a fact worth storing.
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

/**
 * What a set of boosts is worth to **one** fight, added together.
 *
 * Additive rather than multiplicative, and deliberately: a player reading "+18%" and "+12%" on two
 * cards expects thirty, and a compounding rule that quietly gives them 32.2 is a rule nobody can
 * plan around.
 *
 * **The same boost counts once, however many are in the bag** (board). Different crates stack;
 * duplicates do not. Two of a thing stacking is the shape that ends one way: the correct play
 * becomes hoarding a fortnight of infamy into six syringes and deleting somebody with a number no
 * defence was balanced against, and every fight before that one is spent saving up rather than
 * fighting. One of each is a bag a defender can reason about and an attacker can still build.
 *
 * The extras are not wasted: {@link spentStash} takes one of each, so the second syringe is the
 * next fight's.
 */
export function stashBoost(stash: BoostStash, cityLevel: number): BattleBoost {
  return Object.keys(stash).reduce<BattleBoost>((total, goodId) => {
    const spec = stashCount(stash, goodId) > 0 ? findBlackMarketGood(goodId) : undefined;
    const boost = spec ? blackMarketBoost(spec, cityLevel) : undefined;
    if (!boost) return total;
    return {
      offensePercent: total.offensePercent + boost.offensePercent,
      defensePercent: total.defensePercent + boost.defensePercent,
      moralePercent: total.moralePercent + boost.moralePercent,
    };
  }, NO_BOOST);
}

/**
 * The bag after a fight has taken what it was allowed to take: **one of each**.
 *
 * The other half of "the same boost only once". A fight applies one syringe, so a fight consumes
 * one syringe: clearing the whole bag instead would make the second one a crate a player paid
 * infamy for and never got to open, and stacking it would put the rule back.
 *
 * Called win or lose. A boost is bought for *a* battle, not for a won one.
 */
export function spentStash(stash: BoostStash): BoostStash {
  return Object.keys(stash).reduce<BoostStash>(
    (left, goodId) => takeFromStash(left, goodId),
    stash,
  );
}

/** Whether anything in the stash would change a fight. Cheaper to ask than to compare a bundle. */
export function hasBoost(stash: BoostStash): boolean {
  // Asked of the *catalogue* rather than of a weighted figure: "is there contraband in this bag" is
  // a question about the bag, and a potency that happened to round a crate's only figure to zero
  // must not make the crate disappear from the settle that is supposed to consume it.
  return Object.keys(stash).some(
    (goodId) => stashCount(stash, goodId) > 0 && findBlackMarketGood(goodId)?.boost !== undefined,
  );
}
