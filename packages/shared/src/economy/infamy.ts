import { z } from 'zod';
import type { EffectChannel } from '../crew/effects.js';
import { IsoDateTimeSchema } from '../primitives.js';
import { UNIT_TIERS, findUnit, type Army, type UnitSpec, type UnitTier } from '../units/index.js';

/**
 * Infamy (GDD §D7) — the score the street keeps.
 *
 * It was a 0..100 meter, which is the wrong shape for what the board wants it to be. A meter has a
 * top, and a number with a top stops being a reason to do anything the moment it is full: a crew at
 * 100 had no reason to take another fight, and the whole "chase your name" loop was over in an
 * afternoon. This is an **uncapped point total** instead. It only ever goes up by being earned, and
 * the only thing that takes it back down is a player choosing to spend it.
 *
 * ## Where it comes from
 *
 * Killing people. That is the headline rule and everything else is trim: every body that does not
 * walk off the field is worth {@link infamyForKill}, and a fight against a real army is worth
 * hundreds. Taking ground off the Combine pays a bonus on top ({@link infamyForRaidWon}), because
 * robbing the state is the kind of thing the street repeats.
 *
 * ## What it is for
 *
 * Three sinks, and they are what stop it being a scoreboard:
 *
 * - **Gates.** Certain hires will not sit down with a nobody (§H3), and the heaviest units will not
 *   take a contract from one either — see {@link infamyToField}.
 * - **Upgrades.** The top of every workshop line asks for a name as well as materials.
 * - **Sacrifice.** {@link INFAMY_SACRIFICES} burns it outright for a temporary edge. Spending is the
 *   only thing in the game that lowers infamy, so the number on the HUD is always either what you
 *   earned or what you chose to trade.
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
 * What one body is worth, by what kind of body it was.
 *
 * The board's shape — 1, 5, 25, 100 from the cheapest thing on the street to a legend — with the
 * heavy tier filled in between the two ends it sits between. The steps are deliberately not linear:
 * killing five hundred Razors should not be worth the same as killing the Abomination, because
 * anybody can find five hundred Razors and only one crew in the city has an Abomination.
 */
export const INFAMY_PER_TIER: Readonly<Record<UnitTier, number>> = {
  rabble: 1,
  regular: 5,
  specialist: 25,
  heavy: 60,
  legendary: 100,
};

/**
 * The supply cost a tier's *typical* member eats, which is what the tier's headline number is
 * quoted against.
 *
 * Scaling by supply rather than authoring a number per unit is what keeps this table honest as the
 * roster grows: a Wrecking Crew is two Snipers' worth of bodies and is worth two Snipers' worth of
 * infamy without anybody remembering to say so. A unit added tomorrow is priced the day it is
 * written.
 */
export const TYPICAL_SUPPLY: Readonly<Record<UnitTier, number>> = {
  rabble: 1,
  regular: 2,
  specialist: 2,
  heavy: 5,
  legendary: 8,
};

/**
 * The exceptions, where what a thing is worth to kill is not what it costs to field.
 *
 * The Colossus is the board's own example. By supply it is twelve bodies; by reputation it is the
 * thing a district tells stories about, and killing one is the story. Anything in here is a
 * deliberate authorial call and needs a reason beside it.
 */
export const INFAMY_UNIT_VALUES: Readonly<Record<string, number>> = {
  the_colossus: 250,
};

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
  const override = INFAMY_UNIT_VALUES[spec.id];
  if (override !== undefined) return override;
  return Math.max(
    1,
    Math.round((INFAMY_PER_TIER[spec.tier] * spec.supply) / TYPICAL_SUPPLY[spec.tier]),
  );
}

/** What a whole casualty list is worth. The reading every battle settlement wants. */
export function infamyForKills(killed: Army): number {
  return Object.entries(killed).reduce(
    (total, [unitId, count]) => total + infamyForKill(unitId) * Math.max(0, count),
    0,
  );
}

/** Infamy gained by taking any site by force (§D7), on top of whatever died taking it. */
export const INFAMY_PER_RAID_WON = 25;
/**
 * On top of the above, for taking it off the Combine (§A3, §D7) — and again for a *seat* of its
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
 * what a district is — `raidTargetOf` is the one place the map is read.
 */
export function infamyForRaidWon({ fromTheState, seatOfPower }: RaidInfamyInput): number {
  return (
    INFAMY_PER_RAID_WON +
    (fromTheState ? INFAMY_PER_GOVERNMENT_SITE : 0) +
    (seatOfPower ? INFAMY_PER_GOVERNMENT_SEAT : 0)
  );
}

/** Adding to the total. Uncapped, and never negative — nothing but spending takes a name back. */
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
 * The infamy a unit will not take the field without.
 *
 * Legendary units are people (and one machine) with a choice about who they work for, and the
 * board's rule is that they will not work for a nobody. Derived off the tier rather than authored
 * per unit, so a legendary added later is gated the day it is written; a unit that is not
 * gated returns 0 and every call site can treat "0" as "anybody".
 */
export const INFAMY_TO_FIELD: Readonly<Record<UnitTier, number>> = {
  rabble: 0,
  regular: 0,
  specialist: 0,
  heavy: 250,
  legendary: 1200,
};

export function infamyToField(unit: UnitSpec | string): number {
  const spec = typeof unit === 'string' ? findUnit(unit) : unit;
  return spec ? INFAMY_TO_FIELD[spec.tier] : 0;
}

/**
 * Every unit in a force that this crew's name is not yet good enough to send.
 *
 * Returned as a list rather than a boolean so a refusal can name what is blocking it. Empty is the
 * common case and the cheap one.
 */
export function unitsBeyondInfamy(force: Army, infamy: number): string[] {
  return Object.entries(force)
    .filter(([unitId, count]) => count > 0 && infamy < infamyToField(unitId))
    .map(([unitId]) => unitId);
}

/**
 * Burning a name for an advantage (§D7).
 *
 * The counterweight to a number that only goes up. Each entry costs infamy outright, lasts a fixed
 * span, and lands on the same {@link EffectChannel} every other bonus in the game writes into — so a
 * sacrifice is wired into the battle engine, the city view and the district clocks the moment it is
 * bought, with nothing threaded anywhere.
 *
 * Priced against the fights that pay for them: the defensive one is roughly a won assault on a
 * garrisoned place, so it is a real decision rather than something a player buys on a whim.
 */
export interface InfamySacrificeSpec {
  id: string;
  name: string;
  /** What the crew gives up, and what the street gets out of it. */
  description: string;
  cost: number;
  hours: number;
  channel: EffectChannel;
  magnitude: number;
}

export const INFAMY_SACRIFICES: readonly InfamySacrificeSpec[] = [
  {
    id: 'sacrifice_bulwark',
    name: 'Call In The Name',
    description:
      'Every debt the street owes you, called in at once, and spent on people standing in your doorways.',
    cost: 300,
    hours: 24,
    channel: 'defensePercent',
    magnitude: 20,
  },
  {
    id: 'sacrifice_swagger',
    name: 'Make An Example',
    description:
      'Something public, something ugly, and a fortnight where nobody your people meet wants the fight.',
    cost: 500,
    hours: 12,
    channel: 'intimidationFlat',
    magnitude: 15,
  },
  {
    id: 'sacrifice_silence',
    name: 'Buy The Silence',
    description: 'Every fixer and every fence, paid to have seen nothing. It does not come cheap.',
    cost: 800,
    hours: 24,
    channel: 'intelResistancePercent',
    magnitude: 30,
  },
];

const SACRIFICE_BY_ID = new Map(INFAMY_SACRIFICES.map((spec) => [spec.id, spec]));

export function findSacrifice(id: string): InfamySacrificeSpec | undefined {
  return SACRIFICE_BY_ID.get(id);
}

/**
 * A sacrifice currently running, or `null`.
 *
 * One at a time, deliberately. Three at once would be a shop rather than a decision, and the whole
 * point of a sink is that spending on one thing is not spending on another.
 */
export const InfamySacrificeSchema = z.object({
  id: z.string().min(1),
  until: IsoDateTimeSchema,
});
export type InfamySacrifice = z.infer<typeof InfamySacrificeSchema>;

/** What a running sacrifice is worth right now — nothing at all once its clock is up. */
export function sacrificeEffect(
  sacrifice: InfamySacrifice | null,
  now: Date,
): { channel: EffectChannel; magnitude: number } | null {
  if (!sacrifice) return null;
  if (Date.parse(sacrifice.until) <= now.getTime()) return null;
  const spec = findSacrifice(sacrifice.id);
  return spec ? { channel: spec.channel, magnitude: spec.magnitude } : null;
}

/** Guards the tier tables against a tier being added and silently going unpriced. */
for (const tier of UNIT_TIERS) {
  if (INFAMY_PER_TIER[tier] === undefined) throw new Error(`no infamy value for the ${tier} tier`);
  if (TYPICAL_SUPPLY[tier] === undefined) throw new Error(`no typical supply for the ${tier} tier`);
  if (INFAMY_TO_FIELD[tier] === undefined) throw new Error(`no infamy gate for the ${tier} tier`);
}
