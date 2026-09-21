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
 *   * **What stays broken** is disruption: the district's structures run at reduced effectiveness
 *     for a while. It costs the victim time rather than stock, which is the part they cannot buy
 *     back.
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
 * What a broken gate costs a district (GDD §A4, battle rework).
 *
 * A home district still cannot be taken: that rule has not moved and it is not going to. What a
 * breach buys instead is a window in which the place runs badly: things get carried out and what
 * is left limps for a few hours. That is the whole design. A player who loses a siege loses
 * *tempo and stock*, not the thing they have spent three weeks building, so a bad night is
 * something to come back from rather than a reason to stop playing.
 *
 * ## The cut is a percentage, and it is capped at half
 *
 * The board's ceiling, and the right one (maintainer, 2026-09-18: "let us keep it to 50% meaning
 * that it can reduce it by half at most"). Half is enough to hurt and not enough to end anything.
 * Nothing in this game drains a stockpile on a clock, so a production cut slows the fill rate and
 * can never starve a roster: what it takes is the evening, which is the part the victim cannot buy
 * back. A district stopped dead would be a punishment loop rather than a setback, and one crew
 * holding another at zero is the grief tactic {@link refreshDisruption} exists to refuse.
 *
 * ## One penalty, not two
 *
 * A raid used to do this *and* wreck three structures on a 24 hour repair clock, so the same win
 * was charged to the victim twice: once per roof and once across the district. The per-structure
 * half is gone, along with `damage` on a structure and everything that read it. What is left is
 * this one number, scaled by how badly the defence lost so that the size of a raid still matters.
 */

/** The least a won raid takes: a breach nobody felt is a siege the attacker paid for and got nothing from. */
export const MIN_RAID_DISRUPTION_PERCENT = 10;

/** ...and the most, the board's half (§A4). */
export const MAX_RAID_DISRUPTION_PERCENT = 50;

/** And for how long. Long enough to matter, short enough to be worth logging in to fix. */
export const RAID_DISRUPTION_HOURS = 6;

/**
 * How hard the raid landed, from how badly the defence lost.
 *
 * `defenderLossShare` is the share of the defending line that was put in the ground, and it is 1
 * when nobody turned up at all. A fight that went the distance leaves the district at
 * {@link MIN_RAID_DISRUPTION_PERCENT} and an undefended one at
 * {@link MAX_RAID_DISRUPTION_PERCENT}: half the line lost is 30%, which is about what the flat
 * quarter this replaced used to charge everybody.
 */
export function raidDisruptionPercent(defenderLossShare: number): number {
  const share = Math.min(1, Math.max(0, defenderLossShare));
  return Math.round(
    MIN_RAID_DISRUPTION_PERCENT +
      (MAX_RAID_DISRUPTION_PERCENT - MIN_RAID_DISRUPTION_PERCENT) * share,
  );
}

export const DisruptionSchema = z.object({
  /** When the district stops running at reduced effectiveness. Null when it is not. */
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
  /** Percentage points off production and build speed while it lasts. */
  percent: z.number().min(0).max(100),
});
export type Disruption = z.infer<typeof DisruptionSchema>;

export function noDisruption(): Disruption {
  return { until: null, since: null, percent: 0 };
}

/** A fresh raid's worth of disruption, starting now, priced off how badly the defence lost. */
export function disruptionFrom(now: Date, defenderLossShare: number): Disruption {
  return {
    until: new Date(now.getTime() + RAID_DISRUPTION_HOURS * 3_600_000).toISOString(),
    since: now.toISOString(),
    percent: raidDisruptionPercent(defenderLossShare),
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
 * A second raid does not stack: it **refreshes**.
 *
 * Stacking would let a coordinated pair of crews hold a district at zero output indefinitely,
 * which is a grief tactic rather than a strategy. The later expiry and the harsher percentage,
 * taken field by field: the percentage moved with the defeat when it stopped being a constant, so
 * taking the whole of the later record wholesale would let a crew throw a token raid at a district
 * they had just flattened and *lift* it from 50% back to 10%. Neither field ever sums, so the cap
 * still holds and repeat raids stay meaningful without being terminal.
 */
export function refreshDisruption(current: Disruption, next: Disruption): Disruption {
  if (current.until === null) return next;
  if (next.until === null) return current;
  /*
   * `since` travels with the *percent*, not with the expiry, because those two fields are what a
   * settle reads together: the record says "cut by `percent` from `since` until `until`". Pairing
   * the start with the expiry instead would hand the surviving percentage a start that belongs to
   * the other raid, and a crew who raided at 10% yesterday, followed by one who raided at 50%
   * just now, would see yesterday's quiet hours charged at 50%. On a tie the earlier start wins,
   * which is exact: the rate is the same across both.
   */
  const until = Date.parse(next.until) > Date.parse(current.until) ? next.until : current.until;
  const harsher =
    next.percent > current.percent
      ? next
      : next.percent < current.percent
        ? current
        : earlierStart(current, next);
  return { until, since: harsher.since, percent: harsher.percent };
}

/** Of two records at the same rate, the one that has been running longer. A null start is oldest. */
function earlierStart(a: Disruption, b: Disruption): Disruption {
  if (a.since === null || b.since === null) return a.since === null ? a : b;
  return Date.parse(a.since) <= Date.parse(b.since) ? a : b;
}

/**
 * What a breach carries out, on top of the disruption.
 *
 * Heavier than a street raid. This is somebody standing inside your warehouse rather than jumping
 * a truck, and still bounded by what the force could physically carry, which {@link plunder}
 * decides. The share here is the ceiling before that bound applies.
 */
export const BREACH_LOOT_SHARE = 0.35;

export function breachLoot(stock: Resources, share = BREACH_LOOT_SHARE): PartialResources {
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const taken = Math.floor(stock[key] * share);
      return taken > 0 ? [[key, taken] as const] : [];
    }),
  );
}
