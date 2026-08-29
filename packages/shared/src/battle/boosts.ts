import { z } from 'zod';
import { OFFICER_ROLE_LABELS, type OfficerRole } from '../roles.js';
import { UNIT_TIERS, findUnit, type UnitTier } from '../units/index.js';

/**
 * What a name buys, one fight at a time (GDD §D7).
 *
 * Infamy is a wallet now (`economy/notoriety.ts` holds the rank half), and this is what the wallet
 * is for. A crew picks **one** boost per declared battle, pays for it out of the points it has
 * earned, and gets it on the ground when the mark comes round.
 *
 * ## One per battle, chosen against a known enemy
 *
 * The old shape was a district-wide buff on a 12 to 24 hour clock, bought whenever, and it made the
 * wrong decision interesting: the question was "can I afford this" rather than "what am I about to
 * walk into". Tied to a battle it is the second question, because by the time a player is buying
 * one they have already read the intel line on that fight. One per battle, and the whole roster of
 * them is on the fight's own page.
 *
 * ## Why the effects are specific
 *
 * "+20 offense" is not a promise anybody can check. Every boost here is either a percentage of a
 * force's own numbers or a percentage that lands on one slice of it, so a player can look at what
 * they are sending and know what they are getting: `+30% attack for your heavy units` against nine
 * Juggernauts is a figure, and `+20 offense` against the same nine is a riddle.
 *
 * ## Where the extras come from
 *
 * Three of them are open to anybody. The rest are proposed: a technology the Lab has finished, or
 * an officer in the right seat who knows somebody. Both are `unlock` clauses read at view time
 * rather than stored, so a boost appears the moment its condition is true and disappears again if
 * the officer walks.
 */

export const BOOST_STATS = ['offense', 'defense', 'morale'] as const;
export const BoostStatSchema = z.enum(BOOST_STATS);
export type BoostStat = z.infer<typeof BoostStatSchema>;

export const BOOST_STAT_LABELS: Readonly<Record<BoostStat, string>> = {
  offense: 'attack',
  defense: 'defence',
  morale: 'morale',
};

/**
 * What a boost actually does, as something measurable.
 *
 * Three shapes, and the narrowing is the point: `force` is everyone you sent, `tier` is one weight
 * class of them, and `unit` is one entry on the roster. A narrow boost is worth a bigger percentage
 * for the same money, which is what makes the drop-down a decision about the force you have already
 * built rather than a ranked list.
 */
export const BoostEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('force'), stat: BoostStatSchema, percent: z.number() }),
  z.object({
    kind: z.literal('tier'),
    tier: z.enum(UNIT_TIERS),
    stat: BoostStatSchema,
    percent: z.number(),
  }),
  z.object({
    kind: z.literal('unit'),
    unitId: z.string().min(1),
    stat: BoostStatSchema,
    percent: z.number(),
  }),
]);
export type BoostEffect = z.infer<typeof BoostEffectSchema>;

/** Who is allowed to offer this. Read at view time, never stored on a battle. */
export type BoostUnlock =
  { kind: 'open' } | { kind: 'tech'; techId: string } | { kind: 'officer'; role: OfficerRole };

export interface BattleBoostSpec {
  id: string;
  name: string;
  /** What the crew actually does. One line, in the street's words. */
  description: string;
  /** Infamy, on the scale a real fight pays: see `infamyForKill`. */
  cost: number;
  effect: BoostEffect;
  unlock: BoostUnlock;
}

const TIER_LABELS: Readonly<Record<UnitTier, string>> = {
  carrier: 'porters',
  rabble: 'rabble',
  wonder: 'engineered units',
  specialist: 'specialists',
  heavy: 'heavy units',
  legendary: 'legends',
};

/**
 * The catalogue.
 *
 * Priced from what the fight that pays for it is worth. An ordinary won skirmish banks a couple of
 * hundred points, a real assault a good deal more, so the open boosts are one fight's earnings and
 * the specialist ones are several. Nothing here is cheap enough to buy without thinking, which is
 * the whole design of a sink.
 */
export const BATTLE_BOOSTS: readonly BattleBoostSpec[] = [
  {
    id: 'boost_call_in_the_name',
    name: 'Call In The Name',
    description: 'Every debt the street owes you, called in at once and spent on this one night.',
    cost: 200,
    effect: { kind: 'force', stat: 'offense', percent: 12 },
    unlock: { kind: 'open' },
  },
  {
    id: 'boost_stand_your_ground',
    name: 'Stand Your Ground',
    description: 'Word goes out that anybody who runs tonight does not come back to this district.',
    cost: 200,
    effect: { kind: 'force', stat: 'defense', percent: 15 },
    unlock: { kind: 'open' },
  },
  {
    id: 'boost_make_an_example',
    name: 'Make An Example',
    description: 'Something public, something ugly, and nobody on your side thinking about home.',
    cost: 320,
    effect: { kind: 'force', stat: 'morale', percent: 20 },
    unlock: { kind: 'open' },
  },
  {
    id: 'boost_paid_in_advance',
    name: 'Paid In Advance',
    description:
      'The cheap end of the roster, paid before the fight instead of after it. They notice.',
    cost: 260,
    effect: { kind: 'tier', tier: 'rabble', stat: 'offense', percent: 40 },
    unlock: { kind: 'officer', role: 'finance_officer' },
  },
  {
    id: 'boost_drilled_all_week',
    name: 'Drilled All Week',
    description: 'Seven days of the same approach, walked until nobody has to be told twice.',
    cost: 420,
    effect: { kind: 'tier', tier: 'wonder', stat: 'offense', percent: 28 },
    unlock: { kind: 'officer', role: 'instructor_of_the_young' },
  },
  {
    id: 'boost_the_right_doors',
    name: 'The Right Doors',
    description: 'Somebody has already been inside and marked which way the specialists go in.',
    cost: 560,
    effect: { kind: 'tier', tier: 'specialist', stat: 'offense', percent: 30 },
    unlock: { kind: 'officer', role: 'head_spy' },
  },
  {
    id: 'boost_plated_overnight',
    name: 'Plated Overnight',
    description: 'Every heavy thing you own, up on blocks and welded to until the sun came up.',
    cost: 700,
    effect: { kind: 'tier', tier: 'heavy', stat: 'defense', percent: 35 },
    unlock: { kind: 'tech', techId: 'tech_standard_parts' },
  },
  {
    id: 'boost_shaped_for_this',
    name: 'Shaped For This',
    description: 'The charges cut for this wall, this week, by somebody who measured it.',
    cost: 640,
    effect: { kind: 'tier', tier: 'heavy', stat: 'offense', percent: 32 },
    unlock: { kind: 'tech', techId: 'tech_shaped_charges' },
  },
  {
    id: 'boost_they_came_for_this',
    name: 'They Came For This',
    description: 'The one on your roster the city tells stories about, told the story is tonight.',
    cost: 1100,
    effect: { kind: 'tier', tier: 'legendary', stat: 'offense', percent: 25 },
    unlock: { kind: 'officer', role: 'raid_boss' },
  },
  {
    id: 'boost_the_colossus_walks',
    name: 'The Colossus Walks',
    description: 'Fuel nobody should be able to get, poured into the biggest thing in the city.',
    cost: 1400,
    effect: { kind: 'unit', unitId: 'the_colossus', stat: 'offense', percent: 50 },
    unlock: { kind: 'tech', techId: 'tech_demolition_doctrine' },
  },
];

const BY_ID = new Map(BATTLE_BOOSTS.map((spec) => [spec.id, spec]));

export function findBattleBoost(id: string): BattleBoostSpec | undefined {
  return BY_ID.get(id);
}

/** What this does, in the player's words. The line the drop-down and the receipt both print. */
export function describeBoostEffect(effect: BoostEffect): string {
  const stat = BOOST_STAT_LABELS[effect.stat];
  const sign = effect.percent >= 0 ? '+' : '';
  switch (effect.kind) {
    case 'force':
      return `${sign}${effect.percent}% ${stat} for everything you send`;
    case 'tier':
      return `${sign}${effect.percent}% ${stat} for your ${TIER_LABELS[effect.tier]}`;
    case 'unit':
      return `${sign}${effect.percent}% ${stat} for ${findUnit(effect.unitId)?.name ?? effect.unitId}`;
  }
}

/** Why this one is on offer, or what it would take. Empty for the boosts anybody may buy. */
export function describeBoostUnlock(unlock: BoostUnlock, techName: (id: string) => string): string {
  switch (unlock.kind) {
    case 'open':
      return '';
    case 'tech':
      return `Proposed by the Lab: ${techName(unlock.techId)}`;
    case 'officer':
      return `Proposed by your ${OFFICER_ROLE_LABELS[unlock.role]}`;
  }
}

/** Whether this crew may buy this one at all, ignoring what it costs. */
export function boostAvailable(
  unlock: BoostUnlock,
  crew: { technologies: readonly string[]; roles: readonly OfficerRole[] },
): boolean {
  switch (unlock.kind) {
    case 'open':
      return true;
    case 'tech':
      return crew.technologies.includes(unlock.techId);
    case 'officer':
      return crew.roles.includes(unlock.role);
  }
}

/**
 * How much of a force one boost reaches, 0..1, weighted by supply.
 *
 * Used to turn a narrow boost into a whole-force figure the engine can apply, and weighted by
 * supply rather than by headcount for the same reason population is: forty Razors and four
 * Juggernauts are not eleven to one in anything that matters on a battlefield.
 */
export function boostCoverage(
  effect: BoostEffect,
  force: Readonly<Record<string, number>>,
): number {
  let total = 0;
  let covered = 0;
  for (const [unitId, count] of Object.entries(force)) {
    const spec = findUnit(unitId);
    if (!spec || count <= 0) continue;
    const weight = spec.supply * count;
    total += weight;
    const hit =
      effect.kind === 'force' ||
      (effect.kind === 'tier' && spec.tier === effect.tier) ||
      (effect.kind === 'unit' && spec.id === effect.unitId);
    if (hit) covered += weight;
  }
  return total === 0 ? 0 : covered / total;
}

/**
 * A bought boost as the battle engine reads it: three whole-force percentages.
 *
 * A narrow boost is folded down by {@link boostCoverage} rather than applied at full strength,
 * because the engine resolves a force and not a unit list. `+50% attack for the Colossus` on a
 * force that is a third Colossus by supply is `+16.7%` on the force, which is the same arithmetic
 * a player would do in their head and the reason a narrow boost is priced by how narrow it is.
 */
export function boostBundle(
  effect: BoostEffect,
  force: Readonly<Record<string, number>>,
): { offensePercent: number; defensePercent: number; moralePercent: number } {
  const share = boostCoverage(effect, force) * effect.percent;
  return {
    offensePercent: effect.stat === 'offense' ? share : 0,
    defensePercent: effect.stat === 'defense' ? share : 0,
    moralePercent: effect.stat === 'morale' ? share : 0,
  };
}

/** Guards the catalogue at load: a boost pointing at a unit nobody has is a boost nobody can use. */
for (const spec of BATTLE_BOOSTS) {
  if (spec.effect.kind === 'unit' && !findUnit(spec.effect.unitId)) {
    throw new Error(`${spec.id} boosts ${spec.effect.unitId}, which is not in the catalogue`);
  }
  if (spec.cost <= 0) throw new Error(`${spec.id} costs nothing`);
}
