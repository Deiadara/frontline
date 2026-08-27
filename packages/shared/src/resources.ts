import { z } from 'zod';

/**
 * The five base resources (GDD §D1 supplies, §D2 caps, §D3 oil, §D5 scrap, §D6 high-quality metal).
 *
 * `caps` is the currency: officer wages are paid in caps (§D2, §H7). `scrap` and high-quality
 * metal are deliberately distinct (§D6): scrap is the salvage floor, high-quality metal is the
 * scarce input. This set *replaces* the MVP's credits/power/data/alloy outright (§D9); there is
 * no live player data, so the migration is destructive.
 *
 * ## Whole numbers, everywhere
 *
 * A stockpile is a count of things. There is no such thing as `37772.751872` bottle caps, and a
 * readout carrying six decimal places is not a rounding cosmetic. It is the game telling the
 * player that the number is not a count of anything. Every amount here is an integer and the
 * schema is the gate: a fraction fails to parse at the wire and at the database, loudly, at the
 * line that produced it.
 *
 * Production is the one place that legitimately generates fractions, because output is quoted per
 * hour and a settle can be a second long. It does not round them away: it banks the whole units
 * and carries the remainder (`EconomyState.productionCarry`), so a player polling every second
 * still earns exactly what a player who came back in the morning earns. See `accrueProduction`.
 */
const AmountSchema = z.number().int().nonnegative();

export const ResourcesSchema = z.object({
  caps: AmountSchema,
  supplies: AmountSchema,
  oil: AmountSchema,
  scrap: AmountSchema,
  highQualityMetal: AmountSchema,
  /**
   * §D5b: sawn timber, and the other half of what everything is built out of.
   *
   * Scrap is what a ruined city gives you when you strip the metal; planks are what it gives you
   * when you strip everything else. Almost every structure wants both, in a ratio that says what
   * the thing physically *is*: a Gate is a palisade and wants more timber than plate, a Garage is
   * machinery and wants the reverse.
   *
   * **Last in this object on purpose.** `art/manifest.ts` derives every resource icon's seed from
   * this key order, so a key inserted in the middle renumbers the seeds of the ones after it and
   * silently re-rolls art that has already been made. Where planks belongs *on screen* is a
   * separate question, answered by `RESOURCE_ORDER`.
   */
  planks: AmountSchema,
});
export type Resources = z.infer<typeof ResourcesSchema>;
export type ResourceKey = keyof Resources;

/**
 * Every resource key in display order: derived from the schema, so a resource added to
 * `ResourcesSchema` can never be silently missing from a readout.
 */
export const RESOURCE_KEYS = Object.keys(ResourcesSchema.shape) as readonly ResourceKey[];

/**
 * The order a player reads them in, which is not the order they are stored in.
 *
 * `RESOURCE_KEYS` is storage order and it fixes the art seeds, so a new resource has to be
 * appended there. Reading order is about what the numbers *mean*: the two bulk building materials
 * sit together, and the scarce one comes last.
 */
export const RESOURCE_ORDER: readonly ResourceKey[] = [
  'caps',
  'supplies',
  'oil',
  'scrap',
  'planks',
  'highQualityMetal',
];

/** One resource *name*, for anything a player picks rather than a stockpile the server writes. */
export const ResourceKeySchema = z.enum([
  'caps',
  'supplies',
  'oil',
  'scrap',
  'highQualityMetal',
  'planks',
]);

/** Partial bundle: used for costs, outputs and battle rewards. Whole units, like the stockpile. */
export const PartialResourcesSchema = ResourcesSchema.partial();
export type PartialResources = z.infer<typeof PartialResourcesSchema>;

/**
 * The one bundle of resource amounts that is *allowed* to be fractional, and the only signed one.
 *
 * Production is quoted per hour and settles on whatever window the last read left, so it makes
 * fractions of a unit, and, for oil, fractions of a *burn*. They are carried in
 * `EconomyState.productionCarry` rather than rounded into or out of the stockpile; see
 * `accrueProduction` for why the sign matters.
 *
 * Every value sits in `(-1, 1)` in practice. The schema does not assert that: this is read on a
 * settle path, and a bound the arithmetic already guarantees is a bound that can only ever fire as
 * a crash on a row the code could simply have consumed.
 */
/*
 * Derived from `ResourcesSchema`'s own keys rather than listed again.
 *
 * It was listed again, and adding `planks` is what found it: the stockpile grew a resource and the
 * carry did not, so production would have banked whole planks and thrown away every fraction of
 * one, for ever, with nothing failing. One key list, and a new resource cannot repeat it.
 */
export const FractionalResourcesSchema = z
  .object(
    Object.fromEntries(RESOURCE_KEYS.map((key) => [key, z.number()])) as Record<
      ResourceKey,
      z.ZodNumber
    >,
  )
  .partial();
export type FractionalResources = z.infer<typeof FractionalResourcesSchema>;

/**
 * Stockpile every new base starts with.
 *
 * Sized against the level-1 `BUILDING_CATALOG` prices so the opening is tight but not dead: every
 * empty plot is affordable on its own, three of them can be raised, and then **oil** is what runs
 * out: GDD §D3's sink is what ends the first session, not an arbitrary wall. The level-2 Command
 * Center stays out of reach, so the cap that holds the village down has to be earned.
 * `build.test.ts` pins both halves of that shape.
 */
export const STARTING_RESOURCES: Resources = {
  caps: 600,
  supplies: 300,
  oil: 120,
  scrap: 500,
  /*
   * Sized so timber is never the thing that ends the opening.
   *
   * 420 against a 1000-plank bill for one of every level-1 structure, where scrap is 500 against
   * 1790: planks are proportionally *more* plentiful than scrap on purpose. Only the Quarters and
   * the Greenhouse cost more timber than metal, and both by a little, so the pinch a new player
   * hits is the caps-and-scrap one that was already there. Adding a sixth resource should widen
   * the opening's vocabulary, not add a sixth wall to it.
   */
  planks: 420,
  highQualityMetal: 40,
};

/**
 * What a player calls each of these.
 *
 * The storage key is not a word anybody says: `highQualityMetal` is a field name, "HQ metal" is
 * what is written on a crate. One table, so a picker, a listing and a readout all say the same
 * thing: the market had its own private copy of this and the two had already drifted.
 */
export const RESOURCE_LABELS: Readonly<Record<ResourceKey, string>> = {
  caps: 'Caps',
  supplies: 'Supplies',
  oil: 'Oil',
  scrap: 'Scrap',
  planks: 'Planks',
  highQualityMetal: 'HQ metal',
};

/** Whether `stock` covers every line of `cost`. The affordability half of any purchase. */
export function canAfford(stock: Resources, cost: PartialResources): boolean {
  return RESOURCE_KEYS.every((key) => stock[key] >= (cost[key] ?? 0));
}

/**
 * Immutable spend: `stock` with `cost` taken off it.
 *
 * Callers must check {@link canAfford} first: `ResourcesSchema` refuses negatives, so an
 * unaffordable spend would be caught only on the way back out of the database, one layer too late
 * to say anything useful to the player.
 */
export function spendResources(stock: Resources, cost: PartialResources): Resources {
  return Object.fromEntries(
    RESOURCE_KEYS.map((key) => [key, stock[key] - (cost[key] ?? 0)]),
  ) as Resources;
}

/** Immutable add: returns `a` with `b`'s amounts applied on top. */
export function addResources(a: Resources, b: PartialResources): Resources {
  return Object.fromEntries(RESOURCE_KEYS.map((key) => [key, a[key] + (b[key] ?? 0)])) as Resources;
}

/**
 * Two *partial* bundles, added.
 *
 * Distinct from {@link addResources}, which takes a full stockpile on the left and answers with
 * one. This is for combining two things a fight or a trade produced before either has touched
 * anybody's books, a raid's plunder and a Bone Market refund, say, where "absent" has to stay
 * absent rather than becoming a zero somebody then displays.
 */
export function mergeResources(a: PartialResources, b: PartialResources): PartialResources {
  const total: PartialResources = { ...a };
  for (const key of RESOURCE_KEYS) {
    const amount = (a[key] ?? 0) + (b[key] ?? 0);
    if (amount !== 0) total[key] = amount;
  }
  return total;
}

/**
 * A stockpile forced back to whole, non-negative units.
 *
 * The repair function, not a licence to be sloppy: every producer is expected to hand over integers
 * of its own, and the schema refuses anything else. This exists for the two places that are reading
 * numbers they did not compute: a save written before the rule existed, and the sandbox filling a
 * district to a derived ceiling: where throwing would cost a player their game over an old row.
 *
 * Floors rather than rounds. A stockpile is what you are holding, and the one direction it must
 * never move on its own is up.
 */
export function wholeResources(stock: Resources): Resources {
  return Object.fromEntries(
    RESOURCE_KEYS.map((key) => {
      const amount = stock[key];
      return [key, Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0];
    }),
  ) as Resources;
}

/** What a resource *is*, and what a player actually spends it on. */
export interface ResourceLore {
  /** One line of flavour: what the stuff is. */
  what: string;
  /** Where it goes. Three or four concrete sinks, in the order a player meets them. */
  spentOn: readonly string[];
  /** Where it comes from. */
  from: string;
}

/**
 * The stockpile explained (GDD §D).
 *
 * Five numbers along the top of the screen with an icon each, and nothing anywhere in the game
 * that said what any of them were for. A player could reach the mid game without ever learning
 * that high-quality metal is the thing gating their best units: the number simply sat there going
 * up. This is the copy behind the window that opens when a resource is pointed at, and it is
 * deliberately concrete: "the Garage, and every vehicle in it" teaches, "a valuable material" does
 * not.
 */
export const RESOURCE_LORE: Readonly<Record<ResourceKey, ResourceLore>> = {
  caps: {
    what: 'Bottle caps. The city stopped believing in anything else a long time ago.',
    spentOn: [
      'Wages, every week, whether you have them or not',
      'Recruiting at the Bar',
      'Research projects',
      'Buying from the market',
    ],
    from: 'Contracts, raids, and selling what you do not need.',
  },
  supplies: {
    what: 'Ration bricks, tank protein, whatever the Greenhouse manages to grow.',
    spentOn: ['Feeding the crew every week', 'Training the units that eat before they fight'],
    from: 'The Greenhouse, and anything you take off somebody else.',
  },
  oil: {
    what: 'Refined fuel. Everything with a motor in it drinks this.',
    spentOn: [
      'Running the Generator',
      'Building and upgrading structures',
      'Vehicles, once the Garage is standing',
    ],
    from: 'The Cistern, and holds like the Chemical Plant.',
  },
  planks: {
    what: 'Sawn timber, pulled out of whatever the city was before it was this.',
    spentOn: [
      'Every structure you raise, alongside scrap',
      'Digging a position in',
      'Working a location up',
    ],
    from: 'The Scrapyard, which strips the wood out of a ruin as well as the metal.',
  },
  scrap: {
    what: 'Torn plate, cable, dead machines. The city is made of it and so is everything you build.',
    spentOn: [
      'Every structure you raise',
      'Weapons, armour and unit upgrades',
      'Contraptions and vehicles in the Garage',
    ],
    from: 'The Scrapyard, salvage runs, and anything you pull apart.',
  },
  highQualityMetal: {
    what: 'Milled alloy. Rare, and the only thing precise enough for the work that matters.',
    spentOn: [
      'The heavy end of the roster',
      'Cybernetics and the better implants',
      'Late structures and their modifications',
    ],
    from: 'Foundries, deep salvage, and the market when somebody is selling.',
  },
};
