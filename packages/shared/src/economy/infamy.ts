import { z } from 'zod';
import { meetsNotoriety } from './notoriety.js';
import { UNIT_TIERS, findUnit, type Army, type UnitSpec, type UnitTier } from '../units/index.js';

/**
 * Infamy (GDD §D7): the score the street keeps.
 *
 * It was a 0..100 meter, which is the wrong shape for what the maintainer wants it to be. A meter has a
 * top, and a number with a top stops being a reason to do anything the moment it is full: a crew at
 * 100 had no reason to take another fight, and the whole "chase your name" loop was over in an
 * afternoon. This is an **uncapped point total** instead. It only ever goes up by being earned, and
 * the only thing that takes it back down is a player choosing to spend it.
 *
 * ## Where it comes from
 *
 * Killing people. That is the headline rule and everything else is trim: every unit slot that does
 * not walk off the field is worth one point ({@link infamyForKill}), to the winner and the loser
 * alike. A battle job pays half that, rounded up ({@link missionInfamyForKills}). Taking ground
 * off the Combine pays a bonus on top ({@link infamyForRaidWon}), because robbing the state is the
 * kind of thing the street repeats.
 *
 * ## What it is for
 *
 * Three sinks, and they are what stop it being a scoreboard:
 *
 * - **Gates.** These are not priced in points any more. Certain hires will not sit down with a
 *   nobody (§H3) and the heaviest units will not take a contract from one, and both now read the
 *   crew's *rank* (`notoriety.ts`) rather than its wallet.
 * - **Upgrades.** The top of every workshop line asks for a name as well as materials.
 * - **Rank.** Every rung of `notoriety.ts` is bought outright, and the ladder is where most of a
 *   career's earnings go.
 * - **Boosts.** `battle/boosts.ts` burns it on one declared fight. Spending is the only thing in
 *   the game that lowers infamy, so the number on the HUD is always either what you earned or what
 *   you chose to trade.
 *
 * ## The API surface
 *
 * {@link hasInfamy}, {@link spendInfamy} and {@link infamyForKill} are the whole contract other
 * features build on, and they are deliberately three plain functions over a plain number. Anything
 * that wants to charge infamy asks `hasInfamy` and then `spendInfamy`; nothing reaches into the
 * economy record and does the arithmetic itself.
 */

/** A crew's standing on the street. Whole points, no ceiling. */
export const InfamySchema = z.number().int().min(0);
export type Infamy = z.infer<typeof InfamySchema>;

/** Nobody starts with a name. */
export const STARTING_INFAMY = 0;

/**
 * What one kill is worth: the unit's own slots, which is what it took to house (maintainer,
 * 2026-09-15).
 *
 * It was a hand-tuned figure per tier, scaled by unit slots and patched per unit where the tier's
 * number disagreed with the roster. Three tables to keep in step, and they came apart every time
 * the tiers were regrouped. The rule is now the one number every unit already carries: a Colossus
 * is twelve slots and worth twelve, a Razor is one slot and worth one. A unit added tomorrow is
 * priced the day its housing cost is written.
 */
export const INFAMY_PER_UNIT_SLOT = 1;

/**
 * What killing one of these is worth.
 *
 * Takes a spec or an id; an id nothing in the catalogue answers to is worth nothing rather than
 * throwing, because this sits on the settle path and a retired unit id on an old battle row must not
 * take a crew's whole read offline.
 */
export function infamyForKill(unit: UnitSpec | string): number {
  const spec = typeof unit === 'string' ? findUnit(unit) : unit;
  if (!spec) return 0;
  return spec.unitSlots * INFAMY_PER_UNIT_SLOT;
}

/** What a whole casualty list is worth. The reading every declared fight settles on. */
export function infamyForKills(killed: Army): number {
  return Object.entries(killed).reduce(
    (total, [unitId, count]) => total + infamyForKill(unitId) * Math.max(0, count),
    0,
  );
}

/**
 * A battle job pays half a point per unit slot killed, rounded **up** (maintainer, 2026-09-15).
 *
 * Half, because the ground is nobody's and nobody was called out: the enemy is whoever the board
 * says was waiting, and killing them is work rather than a statement. Up rather than to nearest,
 * in the maintainer's own words: kill three and you get two. The half and the rounding live here
 * and nowhere else, so the mission settler and the screen cannot round in different directions.
 */
export const MISSION_INFAMY_PER_UNIT_SLOT = 0.5;

export function missionInfamyForKills(killed: Army): number {
  return Math.ceil(infamyForKills(killed) * MISSION_INFAMY_PER_UNIT_SLOT);
}

/**
 * Making a unit run is worth half of killing it (maintainer, 2026-09-23), rounded **down** on the
 * whole bulk rather than per unit: three one-slot units that fled are 1.5, paid as 1. Universal,
 * so a declared fight and a battle job both pay it, each at its own kill rate. It exists so
 * intimidation units, which break the enemy rather than kill them, are not worth nothing.
 */
export const FLED_INFAMY_SHARE = 0.5;

export function infamyForFled(fled: Army): number {
  return Math.floor(infamyForKills(fled) * FLED_INFAMY_SHARE);
}

/** The same half, off the battle job's own rate, floored on the bulk the same way. */
export function missionInfamyForFled(fled: Army): number {
  return Math.floor(infamyForKills(fled) * MISSION_INFAMY_PER_UNIT_SLOT * FLED_INFAMY_SHARE);
}

/**
 * A death at the ring pays half (maintainer, 2026-09-23), whichever side it is.
 *
 * A runner the ring kills already paid half for running, so the two halves make the whole; a
 * ring unit that dies holding the road pays its half to the attacker. Floored on the bulk like
 * the fled share, because it is the same kind of number.
 */
export const RING_INFAMY_SHARE = 0.5;

export function infamyForRingDead(dead: Army): number {
  return Math.floor(infamyForKills(dead) * RING_INFAMY_SHARE);
}

/** Infamy gained by taking any site by force (§D7), on top of whatever died taking it. */
export const INFAMY_PER_RAID_WON = 25;
/**
 * On top of the above, for taking it off the Combine (§A3, §D7), and again for a *seat* of its
 * power. Robbing a rival crew is a street matter; robbing the state is the kind of thing the street
 * repeats, and taking one of its two seats is the kind it repeats for a long time.
 */
export const INFAMY_PER_GOVERNMENT_SITE = 40;
export const INFAMY_PER_GOVERNMENT_SEAT = 75;

/** Whose ground a won raid took, as the infamy ledger reads it. */
export interface RaidInfamyInput {
  /** It was Combine ground. */
  fromTheState: boolean;
  /** And one of the two seats of its power, not an outpost. */
  seatOfPower: boolean;
}

/**
 * Infamy a won raid earns. Takes plain flags rather than a district so the ledger never has to know
 * what a district is: `raidTargetOf` is the one place the map is read.
 */
export function infamyForRaidWon({ fromTheState, seatOfPower }: RaidInfamyInput): number {
  return (
    INFAMY_PER_RAID_WON +
    (fromTheState ? INFAMY_PER_GOVERNMENT_SITE : 0) +
    (seatOfPower ? INFAMY_PER_GOVERNMENT_SEAT : 0)
  );
}

/**
 * What an award of `amount` is actually worth to a crew carrying `gainPercent` (§D8).
 *
 * The `infamy_gain` channel, whose own line is "a percentage more infamy off **everything** that
 * earns any" and whose chip on a screen reads "+X% infamy earned". Three things in the game pay
 * infamy and two of them scaled it, each with its own copy of this expression written inline; the
 * third, a claimed feat, paid the flat catalogue figure. So the Broadcast Tower and the two
 * Logistics perks were worth nothing on the one reward a player collects deliberately.
 *
 * One function rather than a third copy, for the reason `awardPlayerXp` gives about `xpGainPercent`
 * on the other side of the same screen: a multiplier every caller has to remember is a multiplier
 * one caller will forget, and this is the caller that did.
 */
export function earnedInfamy(amount: number, gainPercent: number): number {
  return Math.max(0, amount) * (1 + Math.max(0, gainPercent) / 100);
}

/** Adding to the total. Uncapped, and never negative: nothing but spending takes a name back. */
export function gainInfamy(infamy: number, amount: number): number {
  return Math.max(0, Math.round(infamy + Math.max(0, amount)));
}

/** Whether a crew can cover a price in infamy. */
export function hasInfamy(infamy: number, cost: number): boolean {
  return infamy >= cost;
}

/**
 * Paying it. Returns the total left, or `null` when the crew cannot cover it.
 *
 * `null` rather than a clamp or a throw: a caller that ignores the answer gets a type error rather
 * than a silent free purchase, and the refusal is a value the route can turn into a message.
 */
export function spendInfamy(infamy: number, cost: number): number | null {
  if (cost < 0 || !hasInfamy(infamy, cost)) return null;
  return infamy - cost;
}

/**
 * The **rank** a unit will not take the field without, as a `NOTORIETY_TIERS` index.
 *
 * Legendary units are people (and one machine) with a choice about who they work for, and the
 * board's rule is that they will not work for a nobody. This used to be a point threshold, which
 * made it fall over every time a crew bought anything: spend three hundred on contraband and the
 * Colossus walks off the roster, because the number the shop charged was the number the roster
 * read. A rank is bought once and kept, so what a crew may field is a thing they earned.
 *
 * Derived off the tier rather than authored per unit, so a legendary added later is gated the day
 * it is written. A unit that is not gated returns 0, and every call site can treat 0 as "anybody".
 */
export const NOTORIETY_TO_FIELD: Readonly<Record<UnitTier, number>> = {
  carrier: 0,
  rabble: 0,
  specialist: 0,
  /**
   * `Ill-Reputed`, the same as Heavy, and paired with it in {@link SLOT_GATED_TIERS}.
   *
   * Zero until §D12i moved the Hollow Men out of Heavy and into the wonders of engineering. The
   * rank a unit asks for is about how big a deal it is, not about which shelf of the catalogue it
   * was filed on, and a taxonomy change is not supposed to hand every crew in the city a shock
   * trooper it had to earn the day before. The slot exemption below keeps the small engineered
   * units (Road Reavers, Kite Crews, Cyberhounds, the Twins) open to anybody, exactly as they were.
   */
  wonder: 2,
  /** `Ill-Reputed`. A heavy unit wants to hear the name before it turns up. */
  heavy: 2,
  /** `Marked`. A legend does not work for anybody the Combine has not opened a file on. */
  legendary: 5,
};

/**
 * The unit slots a sheet has to eat before the middle band's rank gate applies to it.
 *
 * The gate is derived off the tier, and that stopped being sufficient when the line infantry moved
 * into Heavy: the tier now runs from Breakers, which a crew trains off a Gauntlet 4 in its first
 * session, up to Juggernauts. A flat rank on the tier locked three cheap early units behind a
 * reputation nobody has yet, which is a progression wall where the reshuffle meant to put a shelf
 * of armour.
 *
 * Unit slots are the right axis for what the gate was always asking: not "is it armoured" but "is it a
 * big deal". Five is where Juggernauts and Hollow Men sit and Breakers, Wardens, Sluggers and
 * Ironsides do not.
 */
export const NOTORIETY_HEAVY_UNIT_SLOTS = 5;

/**
 * The two tiers where the rank is decided by size rather than by the tier alone.
 *
 * Both of them hold cheap early units and expensive late ones, so both need the exemption. Rabble
 * and specialists are never gated, and a legend is always gated whatever it weighs.
 */
const SLOT_GATED_TIERS: readonly UnitTier[] = ['heavy', 'wonder'];

export function notorietyToField(unit: UnitSpec | string): number {
  const spec = typeof unit === 'string' ? findUnit(unit) : unit;
  if (!spec) return 0;
  // See `NOTORIETY_HEAVY_UNIT_SLOTS`: armour alone is not what the gate is about.
  if (SLOT_GATED_TIERS.includes(spec.tier) && spec.unitSlots < NOTORIETY_HEAVY_UNIT_SLOTS) return 0;
  return NOTORIETY_TO_FIELD[spec.tier];
}

/**
 * Every unit in a force that this crew's rank is not yet good enough to send.
 *
 * Returned as a list rather than a boolean so a refusal can name what is blocking it. Empty is the
 * common case and the cheap one.
 */
export function unitsBeyondNotoriety(force: Army, notoriety: number): string[] {
  return Object.entries(force)
    .filter(([unitId, count]) => count > 0 && !meetsNotoriety(notoriety, notorietyToField(unitId)))
    .map(([unitId]) => unitId);
}

/** Guards the rank table against a tier being added and silently going ungated. */
for (const tier of UNIT_TIERS) {
  if (NOTORIETY_TO_FIELD[tier] === undefined) {
    throw new Error(`no notoriety gate for the ${tier} tier`);
  }
}
