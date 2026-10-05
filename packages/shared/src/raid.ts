import { mulberry32, seedFrom } from './rng.js';
import { z } from 'zod';
import {
  RESOURCE_KEYS,
  type PartialResources,
  type ResourceKey,
  type Resources,
} from './resources.js';
import { bareLineRules, markedUnit, type LineRules } from './battle/line.js';
import { packBonusPercent } from './units/collective.js';
import {
  findUnit,
  fittedFor,
  upgradedStats,
  type Army,
  type FittedUpgrades,
  type UnitLoadouts,
  type UnitSpec,
} from './units/index.js';

/**
 * Raiding a home district (GDD §A4).
 *
 * A crew's own district is the thirteen structures of §A1, and it **cannot be taken**: losing
 * everything you have built because you were asleep is not a strategy game. What it can be is
 * *robbed*, and left limping afterwards.
 *
 * Two consequences, and they are different kinds of thing on purpose:
 *
 *   * **What leaves** is bounded by what the raiders can physically carry. That is what
 *     `lootCapacity` on the unit sheet is for, and it is why a stack of Road Reavers is worth
 *     bringing on a raid you intend to win and worth nothing on one you intend to fight.
 *   * **What stays broken** is disruption: the district's structures make less for a few hours.
 *     It costs the victim time rather than stock, which is the part they cannot buy back.
 */

/**
 * Load per unit of each resource: what one of the thing takes up in a unit's carry.
 *
 * Whole numbers of *slots* rather than kilograms. The screen used to print `25 kg`, which asks a
 * player to convert twice: once from the resource to a weight and once from the weight back to
 * "how much can this unit actually bring home". A load is compared directly against a unit's
 * `lootCapacity`, so the sum is the answer.
 *
 * The spread is the whole point of measuring the carry at all: high-quality metal is dense and
 * precious and costs five, supplies and oil come in drums and cans at three, and the bulk materials a
 * city is made of cost one apiece. A light fast raid is a real strategy rather than a worse
 * version of a heavy one, because *what* you carry out is a decision.
 */
export const RESOURCE_KG: Record<ResourceKey, number> = {
  caps: 1,
  supplies: 3,
  oil: 3,
  scrap: 1,
  planks: 1,
  highQualityMetal: 5,
};

/**
 * The order raiders empty a stockpile in: most value per kilogram first.
 *
 * Fixed rather than computed from a price table, because there is no market yet and a hard order
 * is honest about that. When §D5 lands this should read off it instead.
 */
export const PLUNDER_PRIORITY: readonly ResourceKey[] = [
  'caps',
  'highQualityMetal',
  'oil',
  'scrap',
  // Beside scrap, which is what it is: a kilogram of salvaged building material. It was missing
  // from this list entirely while being priced in `RESOURCE_KG` and stocked by every base, so no
  // raid in the game had ever taken a plank and a defender could bank them behind a broken gate
  // for nothing. `raid.test.ts` now derives this list from `RESOURCE_KEYS` so a seventh resource
  // cannot arrive un-lootable the same way.
  'planks',
  'supplies',
];

/**
 * The most a single raid can take of any one resource, whatever the raiders can carry.
 *
 * Without it a big enough force empties a district completely, and a player who logs in to
 * nothing has no move to make. A quarter hurts and leaves a game.
 */
export const MAX_RAID_SHARE = 0.25;

/**
 * What one group of one sheet carries, before the crew's own bag is spent on it.
 *
 * ## Collective, on something that does not fight
 *
 * `UnitSpec.pack` is one rule with two readings (maintainer, 2026-09-19: "add to Haulers the
 * Collective tag, but make it work different for carriers: instead of their combat stats, their
 * loot increases"). A fighter that masses gets offense (`packBonusPercent` in `battle/engine.ts`);
 * a carrier that masses gets **carry**, off the same curve, so the card's one sentence is true of
 * both and neither has to read an equation.
 *
 * It is the same curve deliberately. Massing a sheet should feel like one idea wherever it turns
 * up, and a second set of constants for the carriers would be two things to retune and one of
 * them would be forgotten.
 *
 * ## Whole kilograms, rounded up
 *
 * Per unit, and rounded **up** rather than to nearest. Loot is counted in whole kilograms
 * downstream (`plunder` floors every line it takes), so a fractional bag is a bag that quietly
 * rounds away: ten Haulers at 25.4 kg each is 254 kg on paper and 250 in the hold. Rounding the
 * per-unit figure up is what makes the bonus "only matter in integers" and makes it matter at
 * all, and the whole group is then a count of whole bags rather than a total that has to be
 * rounded again.
 */
function carriedBy(unit: UnitSpec, count: number, fitted: FittedUpgrades): number {
  const sheet = upgradedStats(unit.stats, fitted).lootCapacity;
  if (unit.pack !== true || count <= 0) return sheet * count;
  return Math.ceil(sheet * (1 + packBonusPercent(count) / 100)) * count;
}

/**
 * How much this force can carry home, in kilograms.
 *
 * The sheet times the count, times whatever the crew's holdings add. Nothing else: the flat
 * per-body load the `picker` mark used to add on top of the percentage was removed on
 * 2026-09-19 at the maintainer's request, along with the mark itself. What a unit carries is
 * what its `lootCapacity` says it carries.
 *
 * The sheet is the **fitted** one when the crew's `unitLoadouts` are passed: a Counterweight
 * Harness on the Haulers is a bigger bag on a raid as well as on a job, or the roster is quoting a
 * figure one of the two doors ignores. See `missionCarry`, which reads the same thing.
 */
export function lootCapacityOf(
  army: Army,
  bonusPercent = 0,
  loadouts: UnitLoadouts = {},
  /**
   * The marks this crew has been granted (`unit_mark`), read through `markedUnit`, which is the
   * same helper the engine builds a stack with.
   *
   * This said "Haul Rigging grants `picker` to the Haulers", which contradicted the note six lines
   * above it: `picker` and its flat per-body load were both removed on 2026-09-19. Haul Rigging
   * pays `carry`, not a mark, and no rung in the game grants one. The two `unit_mark` grants that
   * do exist are a held location's `stalwart` on the Ironsides and a perk's `strikes_first` on the
   * Cyber Dogs, and neither changes what anybody carries.
   *
   * So this argument moves no number today, and it is still the right shape: it is the one place a
   * granted carrying mark would have to be read, and a caller passing the raw sheet instead is the
   * bug the removed mark used to cause. `battle/resolve.ts` and `missions/resolve.ts` both pass it.
   */
  rules: LineRules = bareLineRules(),
): number {
  let base = 0;
  for (const [unitId, count] of Object.entries(army)) {
    const found = findUnit(unitId);
    if (!found) continue;
    const unit = markedUnit(found, rules);
    base += carriedBy(unit, count, fittedFor(loadouts, unitId));
  }
  return Math.max(0, base) * (1 + Math.max(0, bonusPercent) / 100);
}

/**
 * What a successful raid actually takes off `stock`.
 *
 * Bounded by what the raiders can carry and by {@link MAX_RAID_SHARE} of each line, rounded
 * **down** at every step: a raid never carries away a fraction of a unit, and rounding up would let
 * a tiny force take a whole one.
 *
 * `without` names lines the raiders leave alone. A raid on a home skips `caps`: caps are the only
 * resource a player spends on everything and they weigh a kilogram apiece, so a raid that could
 * take them filled its whole hold with somebody's wallet and left the interesting half of the
 * stockpile standing.
 *
 * ## The split is drawn, not ranked (maintainer, 2026-09-18)
 *
 * This used to walk {@link PLUNDER_PRIORITY} and fill the hold from the top, which made every raid
 * on a stocked district return the same shopping list: the priciest line per kilogram, to the share
 * cap, then the next. The maintainer asked for the haul to be "assigned randomly between the
 * resources it has", and that is what a raid is: people filling bags with whatever is in front of
 * them, not a valuation exercise.
 *
 * Two passes, because one is not enough. The first hands each eligible line a random share of the
 * hold, which is the mix. The second walks the same lines in a drawn order and tops the hold up
 * with whatever the first pass could not spend, because a line that runs out of stock or rounds
 * down to nothing would otherwise leave the raiders carrying air: a random split that wastes a
 * third of the capacity is a nerf to raiding dressed up as a mix.
 *
 * Seeded, like everything else a fight decides. A raid is replayable and two reads of one battle
 * cannot disagree about what left the district.
 */
export function plunder(
  stock: Resources,
  capacityKg: number,
  without: readonly ResourceKey[] = [],
  seed = 'plunder',
): PartialResources {
  let left = Math.max(0, capacityKg);
  const taken: Record<string, number> = {};
  const skip = new Set(without);

  /** The lines with something on them, in the order the priority table names them. */
  const eligible = PLUNDER_PRIORITY.filter(
    (key) => !skip.has(key) && Math.floor(stock[key] * MAX_RAID_SHARE) > 0,
  );
  if (eligible.length === 0 || left <= 0) return taken;

  const next = mulberry32(seedFrom(seed));
  /** A weight per line, normalised: this is the mix, before anything is rounded or capped. */
  const draws = eligible.map(() => next());
  const total = draws.reduce((sum, draw) => sum + draw, 0);

  /** How much of a line the raiders can still take, after the share cap and what is already in. */
  const roomOn = (key: ResourceKey): number =>
    Math.floor(stock[key] * MAX_RAID_SHARE) - (taken[key] ?? 0);

  const load = (key: ResourceKey, budgetKg: number): void => {
    const perUnit = RESOURCE_KG[key];
    const affordable = perUnit <= 0 ? roomOn(key) : Math.floor(Math.min(budgetKg, left) / perUnit);
    const amount = Math.min(roomOn(key), affordable);
    if (amount <= 0) return;
    taken[key] = (taken[key] ?? 0) + amount;
    left -= amount * perUnit;
  };

  // The mix.
  eligible.forEach((key, index) => {
    if (left <= 0) return;
    const share = total <= 0 ? 1 / eligible.length : (draws[index] ?? 0) / total;
    load(key, capacityKg * share);
  });

  // ...and the hold, filled. Walked in the drawn order so the line that soaks up the remainder is
  // not always the same one, which a fixed order would make it.
  for (const key of [...eligible].sort(
    (a, b) => (draws[eligible.indexOf(b)] ?? 0) - (draws[eligible.indexOf(a)] ?? 0),
  )) {
    if (left <= 0) break;
    load(key, left);
  }

  return taken;
}

/** The weight of a bundle: what a defender's readout means by "they could carry it all". */
export function weightOf(bundle: PartialResources): number {
  return RESOURCE_KEYS.reduce((total, key) => total + (bundle[key] ?? 0) * RESOURCE_KG[key], 0);
}

// --- disruption: what a raid leaves behind ---

/**
 * What a won raid costs a district after the loot (GDD §A4; maintainer ruling, 2026-09-29).
 *
 * A home district still cannot be taken. What a raid leaves behind is a cut to what the district's
 * **structures** make, for {@link RAID_DISRUPTION_HOURS} hours, sized by how hard the raid hit. The
 * ruling, verbatim: "all production by buildings is cut by a percentage based on how much it was
 * attacked. It should not be too punishing since the player needs to be able to recover somehow."
 *
 * Structures and nothing else. The held ground's own output runs at full rate, and so does every
 * bonus the crew holds: the chairs' rungs, the Lab, the table, the Gate. The rule this replaced
 * (2026-09-09) took a share off every positive percentage as well, which missed the chair rungs
 * because they are a list rather than a channel, and taxed a raided crew's fights, mustering and
 * research for a raid on its warehouse.
 *
 * ## How hard it hit
 *
 * A raid's **blow** is the share of the defending line the raiders put in the ground, 0 to 1, and 1
 * when nobody stood in it (`defenderLossShare` in `battle/resolve.ts`). Chosen over the attacking
 * force measured against the defence because it is what the fight settled rather than what was
 * sent: forty Razors who won by a hair against a full line hit less hard than forty who walked
 * through an empty one, and the loss share is the one number the settle already has for that.
 *
 * ## The curve
 *
 * `RAID_CUT_ASYMPTOTE x blow / (blow + RAID_CUT_HALF_BLOW)`: the hyperbola the Collective rule uses
 * (`units/collective.ts`). Every extra bit of blow costs the district something, each costs less than
 * the one before, and the cut closes on the asymptote without ever reaching it, so there is no clamp
 * anywhere (the maintainer's standing rule: no hard caps). One raid:
 *
 *   * light, a fifth of the line lost: 10%, 0.6 hours of the structures' output over the window;
 *   * medium, half the line lost: 20%, 1.2 hours;
 *   * crushing, the whole line lost or nobody home: 30%, 1.8 hours.
 *
 * Nothing drains a stockpile on a clock, so a cut slows the fill rate and never starves anything,
 * and the district is whole again when the window closes.
 */

/** What the cut closes on and never reaches. Two crushing raids stacked are 40%, three are 45%. */
export const RAID_CUT_ASYMPTOTE = 60;

/** The blow that buys half the asymptote: one crushing raid, which is 30%. */
export const RAID_CUT_HALF_BLOW = 1;

/** And for how long. Long enough to matter, short enough to be worth logging in to fix. */
export const RAID_DISRUPTION_HOURS = 6;

const RAID_DISRUPTION_MS = RAID_DISRUPTION_HOURS * 3_600_000;

/** The cut a blow buys, in percent off what the structures make. See the curve above. */
export function raidDisruptionPercent(blow: number): number {
  const hit = Math.max(0, blow);
  return (RAID_CUT_ASYMPTOTE * hit) / (hit + RAID_CUT_HALF_BLOW);
}

/**
 * The blow a standing cut stands for: {@link raidDisruptionPercent} run backwards.
 *
 * Read off the stored percentage rather than stored beside it, so a record written before this
 * ruling (at most the old ceiling of 50, under the asymptote of 60) stacks like any other.
 */
function blowOf(percent: number): number {
  const cut = Math.max(0, percent);
  return (RAID_CUT_HALF_BLOW * cut) / (RAID_CUT_ASYMPTOTE - cut);
}

export const DisruptionSchema = z.object({
  /** When the district's structures stop running at reduced output. Null when they are not. */
  until: z.string().datetime().nullable(),
  /**
   * ...and when it started, which the window needs as much as its end (maintainer, 2026-09-18).
   *
   * Production is settled lazily, so the window a settle prices is "everything since you last
   * looked", which can be days. `disruptionPercentAt` is a step function of time and the walk cut
   * that window at the expiry but not at the **start**, so the step was read as though it had
   * always been on: a crew raided one hour ago and settling twelve hours of absence lost half of
   * all twelve. Measured before this: 50% charged against a fair 4.2% at twelve hours, and a 23x
   * over-charge at twenty four. It only ever hit players who were away, which is every player who
   * gets raided.
   *
   * Nullable because a row written before this field existed has no start to read, and the honest
   * reading of that is the old one: unbounded backwards.
   */
  since: z.string().datetime().nullable().default(null),
  /** Percent off what the district's structures make while it lasts. */
  percent: z.number().min(0).max(100),
});
export type Disruption = z.infer<typeof DisruptionSchema>;

export function noDisruption(): Disruption {
  return { until: null, since: null, percent: 0 };
}

/** A fresh raid's worth of disruption, starting now, priced off how hard it hit. */
export function disruptionFrom(now: Date, blow: number): Disruption {
  return {
    until: new Date(now.getTime() + RAID_DISRUPTION_MS).toISOString(),
    since: now.toISOString(),
    percent: raidDisruptionPercent(blow),
  };
}

/**
 * How disrupted a district is *right now*, as a percentage.
 *
 * Derived from the stored expiry rather than stored as a live number, so it expires without
 * anything having to run: the same reason nothing else in this game has a scheduler.
 */
export function disruptionPercentAt(disruption: Disruption, now: Date): number {
  if (disruption.until === null) return 0;
  const at = now.getTime();
  // Before the raid landed is not disrupted. See `since`: without this the step reads as though it
  // had always been on, and a lazily settled window is charged for hours that happened first.
  if (disruption.since !== null && at < Date.parse(disruption.since)) return 0;
  return at < Date.parse(disruption.until) ? disruption.percent : 0;
}

/**
 * A second raid adds its blow to what is left of the first, and the sum goes through the curve.
 *
 * What is left of the first is its blow times the share of its window still to run, so a raid
 * that is nearly over adds almost nothing and one that has run out adds exactly nothing: the
 * audit fix of 2026-09-28 (a record that expired before the next raid landed is no record) is the
 * end of this slope rather than a special case. Summing blows rather than cuts is what keeps
 * repeated raids smooth: two crushing raids are 40% and three are 45%, where multiplying what is
 * left (70% of 70%) would be 51% and heading for zero. Two crews taking turns cannot hold a
 * district past the asymptote, and they cannot hold it at the old rate for ever either, since
 * every blow wears off with its window.
 *
 * The new record starts at the new raid. The caller settles the district to that instant first
 * (`resolveOne` settles every crew in a fight before it is fought), so the hours before it are
 * already banked at the old rate and nothing is charged twice or at the wrong rate.
 *
 * A token raid on a district that was just flattened can lower the rate for the next few hours,
 * and that is not a way out: the cut still owed never falls. With `r` the share of the old window
 * left, the curve's concavity gives `cut(r x blow) >= r x cut(blow)`, so six fresh hours at the
 * stacked rate always owe at least what the old record still did. `raid.test.ts` measures it.
 */
export function stackDisruption(current: Disruption, next: Disruption): Disruption {
  if (current.until === null) return next;
  if (next.until === null || next.since === null) return current;
  const landed = Date.parse(next.since);
  const left = Date.parse(current.until) - landed;
  if (left <= 0) return next;
  // Never more than the whole of it. Only a hand-written record can have more than one window left.
  const share = Math.min(1, left / RAID_DISRUPTION_MS);
  const until = Date.parse(current.until) > Date.parse(next.until) ? current.until : next.until;
  return {
    until,
    since: next.since,
    percent: raidDisruptionPercent(blowOf(next.percent) + blowOf(current.percent) * share),
  };
}

/**
 * What a breach carries out, on top of the disruption.
 *
 * Heavier than a street raid. This is somebody standing inside your warehouse rather than jumping
 * a truck, and still bounded by what the force could physically carry, which {@link plunder}
 * decides. The share here is the ceiling before that bound applies.
 */
export const BREACH_LOOT_SHARE = 0.35;
