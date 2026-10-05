import { z } from 'zod';
import { OFFICER_ROLE_LABELS, type OfficerRole } from '../roles.js';
import { UNIT_TIERS, findUnit, type UnitTier, type UnitTierStat } from '../units/index.js';
import { bareLineRules, standsInLine, type LineRules } from './line.js';

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

/**
 * Who is allowed to offer this. Read at view time, never stored on a battle.
 *
 * `open` is off the shelf for anybody. `blueprint` is made from its drawings and nobody proposes
 * it: the three a Lab rung used to propose are opened by their blueprint alone (maintainer,
 * 2026-10-01). `officer` is proposed by whoever is working that chair.
 */
export type BoostUnlock =
  { kind: 'open' } | { kind: 'blueprint' } | { kind: 'officer'; role: OfficerRole };

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
 *
 * ## The rate, and why it has to be about the same for all of them
 *
 * Two boosts at different rates are not two decisions, they are a right answer and a trap. Until
 * 2026-10-02 the rate was read off the label, in infamy per point of percentage, because every
 * narrow boost was folded onto the whole force by head count and a point was a point.
 *
 * Narrow boosts land on the units they name now (`boostBundle`), so a point on a Razor and a
 * point on a Juggernaut are different amounts of fight, and the rate is measured in the engine
 * instead: what a boost adds to the share of the enemy a line built around it kills (its slice
 * half the line by unit slots), against what the open name of the same stat adds to the same
 * fights. Measured that day, the narrow names were worth 170 to 550 infamy at the open names'
 * rate, while they were priced at 420 to 1150. They were re-priced to the measurement (maintainer
 * ruling P10-C).
 *
 * `boosts.test.ts` holds the rate. A new boost is priced into it first and flavoured second.
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
    /*
     * +10, not +20 (maintainer, 2026-09-29). A morale point lands on `unitMoraleFlat` one for one
     * and is worth about two points of attack or defence in the engine, so at +20 this bought about
     * twice the force per infamy of the two 200-infamy names. `market/morale-price.test.ts` holds
     * the rate against the engine.
     */
    effect: { kind: 'force', stat: 'morale', percent: 10 },
    unlock: { kind: 'open' },
  },
  {
    id: 'boost_paid_in_advance',
    name: 'Paid In Advance',
    description:
      'The cheap end of the roster, paid before the fight instead of after it. They notice.',
    cost: 280,
    effect: { kind: 'tier', tier: 'rabble', stat: 'offense', percent: 40 },
    unlock: { kind: 'officer', role: 'fixer' },
  },
  {
    id: 'boost_drilled_all_week',
    name: 'Drilled All Week',
    description: 'Seven days of the same approach, walked until nobody has to be told twice.',
    cost: 310,
    effect: { kind: 'tier', tier: 'wonder', stat: 'offense', percent: 28 },
    unlock: { kind: 'officer', role: 'veteran' },
  },
  {
    id: 'boost_the_right_doors',
    name: 'The Right Doors',
    description: 'Somebody has already been inside and marked which way the specialists go in.',
    cost: 320,
    effect: { kind: 'tier', tier: 'specialist', stat: 'offense', percent: 30 },
    unlock: { kind: 'officer', role: 'master_of_whispers' },
  },
  {
    id: 'boost_plated_overnight',
    name: 'Plated Overnight',
    description: 'Every heavy thing you own, up on blocks and welded to until the sun came up.',
    cost: 170,
    effect: { kind: 'tier', tier: 'heavy', stat: 'defense', percent: 35 },
    unlock: { kind: 'blueprint' },
  },
  {
    id: 'boost_shaped_for_this',
    name: 'Shaped For This',
    description: 'The charges cut for this wall, this week, by somebody who measured it.',
    cost: 300,
    effect: { kind: 'tier', tier: 'heavy', stat: 'offense', percent: 32 },
    unlock: { kind: 'blueprint' },
  },
  {
    id: 'boost_they_came_for_this',
    name: 'They Came For This',
    description: 'The one on your roster the city tells stories about, told the story is tonight.',
    // Re-measured when morale began reading wounds (2026-10-05): worth 324 on its built-for line.
    cost: 330,
    effect: { kind: 'tier', tier: 'legendary', stat: 'offense', percent: 45 },
    unlock: { kind: 'officer', role: 'raid_boss' },
  },
  {
    id: 'boost_the_colossus_walks',
    name: 'The Colossus Walks',
    description: 'Fuel nobody should be able to get, poured into the biggest thing in the city.',
    // Re-measured when morale began reading wounds (2026-10-05): worth 344 on its built-for line.
    cost: 350,
    effect: { kind: 'unit', unitId: 'the_colossus', stat: 'offense', percent: 50 },
    unlock: { kind: 'blueprint' },
  },
];

const BY_ID = new Map(BATTLE_BOOSTS.map((spec) => [spec.id, spec]));

/**
 * Names a crew may burn on one fight before anything is researched (§D7).
 *
 * One, and the rule reads as one: a fight is decided by what you brought, and a name is the thumb
 * on the scale rather than the scale. The Field Commander's eighth rung, Two Names, buys a second
 * (`battleBoostsFlat`), which is a real reward deep in a ten-rung track rather than a dial.
 */
export const BASE_BATTLE_BOOSTS = 1;

/** How many a crew with these effects may burn on one fight. */
export function battleBoostSlots(extraFlat: number): number {
  return BASE_BATTLE_BOOSTS + Math.max(0, Math.trunc(extraFlat));
}

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

/**
 * Why this one is on offer, or what it would take. Empty for the boosts anybody may buy, and for
 * one made from drawings the crew holds: the blueprint line is the view's (`describeBlueprintGate`).
 */
export function describeBoostUnlock(unlock: BoostUnlock): string {
  switch (unlock.kind) {
    case 'open':
    case 'blueprint':
      return '';
    case 'officer':
      return `Proposed by your ${OFFICER_ROLE_LABELS[unlock.role]}`;
  }
}

/**
 * Whether this crew may buy this one at all, ignoring what it costs.
 *
 * §D12e: a boost that is *manufactured* is behind its blueprint as well as behind whoever proposed
 * it. The document is checked first because it is the harder gate and the one a player can do
 * something about: a chair is a thing you already have or do not, and a blueprint is a thing you
 * are part way through collecting. A manufactured boost nobody proposes is the blueprint alone.
 *
 * The gate arrives as a predicate rather than as an inventory, for the same reason every other
 * blueprint gate does: `blueprints/requirements.ts` sits above `battle/` in the import graph, and
 * reaching back down from here would close the loop at module load. Callers hand in
 * `(id) => blueprintGateMet(inventory, 'battle_boost', id)`. A boost nothing gates answers true, so
 * the boosts that are open to anybody and carry no drawings are unaffected.
 */
export function boostAvailable(
  spec: { id: string; unlock: BoostUnlock },
  crew: { roles: readonly OfficerRole[] },
  blueprintUnlocked: (boostId: string) => boolean,
): boolean {
  if (!blueprintUnlocked(spec.id)) return false;
  switch (spec.unlock.kind) {
    case 'open':
    case 'blueprint':
      return true;
    case 'officer':
      return crew.roles.includes(spec.unlock.role);
  }
}

/**
 * How much of a force one boost reaches, 0..1, by head count.
 *
 * What the fight page prints as a boost's reach, and how a morale boost aimed at a slice is folded
 * onto the side (`boostBundle`). It used to fold every narrow boost that way. **Heads, not unit
 * slots** (maintainer, 2026-09-15): a unit slot prices what a sheet costs to house, to carry and to
 * kill, and it says nothing about a battlefield. This was the one reader of slots inside the
 * engine, and it made a narrow boost on the heavy end worth more than the share of the line it
 * actually reached, on an argument the rest of the engine does not make: combat width, nerve,
 * menace and targeting have always counted the things that are standing there.
 */
export function boostCoverage(
  effect: BoostEffect,
  force: Readonly<Record<string, number>>,
  rules: LineRules = bareLineRules(),
): number {
  let total = 0;
  let covered = 0;
  for (const [unitId, count] of Object.entries(force)) {
    const spec = findUnit(unitId);
    if (!spec || count <= 0) continue;
    // Only the line. A porter is not standing anywhere a boost could reach (`standsInLine`), and
    // counting it diluted every narrow boost by whoever was carrying the loot: ten Ironsides and
    // forty Scavengers turned a bought "+35% for your heavy units" into +7% on the force, at full
    // price, for owning porters. The rule is the engine's own, and a crew whose porters do fight
    // passes it in, so the two answers cannot drift apart.
    if (!standsInLine(spec, rules)) continue;
    const weight = count;
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
 * The half of a boost that lands on the units it names: per-tier and per-unit percentages, on the
 * channels the engine already reads per stack (`effectiveStats`).
 */
export interface AimedBoost {
  unitTierPercent: Partial<Record<UnitTier, Partial<Record<UnitTierStat, number>>>>;
  unitKindPercent: Record<string, Partial<Record<UnitTierStat, number>>>;
}

/** A bought boost as the battle engine reads it. */
export interface BoostBundle {
  offensePercent: number;
  defensePercent: number;
  moralePercent: number;
  aimed: AimedBoost;
}

export const NO_AIM: AimedBoost = { unitTierPercent: {}, unitKindPercent: {} };

/** The engine's channel for a boost's stat on a named unit. Morale has none: it is a side's. */
const AIMED_STAT: Readonly<Partial<Record<BoostStat, UnitTierStat>>> = {
  offense: 'offense',
  defense: 'vitality',
};

/**
 * A bought boost as the battle engine reads it.
 *
 * A whole-force boost lands on the three whole-force channels. A tier or unit boost lands on the
 * units it names, at its full percentage (maintainer ruling P10-C, 2026-10-02). It used to be
 * folded down by {@link boostCoverage} and spread over the whole force by head count, so The
 * Colossus Walks (+50% attack for The Colossus) with one Colossus and forty Razors gave +1.22% to
 * all forty-one, a third of what the card promises and most of it on the Razors.
 *
 * Morale is still folded by coverage, because morale is held per stack but broken per side: there
 * is no channel for one unit's nerve, and no boost on the shelf aims morale at a slice.
 */
export function boostBundle(
  effect: BoostEffect,
  force: Readonly<Record<string, number>>,
  rules: LineRules = bareLineRules(),
): BoostBundle {
  const aimedStat = AIMED_STAT[effect.stat];
  if (effect.kind !== 'force' && aimedStat) {
    const amount = { [aimedStat]: effect.percent };
    return {
      offensePercent: 0,
      defensePercent: 0,
      moralePercent: 0,
      aimed:
        effect.kind === 'tier'
          ? { unitTierPercent: { [effect.tier]: amount }, unitKindPercent: {} }
          : { unitTierPercent: {}, unitKindPercent: { [effect.unitId]: amount } },
    };
  }
  const share = boostCoverage(effect, force, rules) * effect.percent;
  return {
    offensePercent: effect.stat === 'offense' ? share : 0,
    defensePercent: effect.stat === 'defense' ? share : 0,
    moralePercent: effect.stat === 'morale' ? share : 0,
    aimed: NO_AIM,
  };
}

/** Adds two `{ key: { stat: number } }` maps, the shape both aimed channels have. */
function addAimed<K extends string>(
  a: Partial<Record<K, Partial<Record<UnitTierStat, number>>>>,
  b: Partial<Record<K, Partial<Record<UnitTierStat, number>>>>,
): Partial<Record<K, Partial<Record<UnitTierStat, number>>>> {
  const total = { ...a };
  for (const key of Object.keys(b) as K[]) {
    const into = { ...(total[key] ?? {}) };
    for (const [stat, value] of Object.entries(b[key] ?? {}) as [UnitTierStat, number][]) {
      into[stat] = (into[stat] ?? 0) + value;
    }
    total[key] = into;
  }
  return total;
}

/** Two aimed boosts on one side, added: two names stack by adding, aimed or not. */
export function mergeAimed(a: AimedBoost, b: AimedBoost): AimedBoost {
  return {
    unitTierPercent: addAimed(a.unitTierPercent, b.unitTierPercent),
    unitKindPercent: addAimed(
      a.unitKindPercent,
      b.unitKindPercent,
    ) as AimedBoost['unitKindPercent'],
  };
}

/** Guards the catalogue at load: a boost pointing at a unit nobody has is a boost nobody can use. */
for (const spec of BATTLE_BOOSTS) {
  if (spec.effect.kind === 'unit' && !findUnit(spec.effect.unitId)) {
    throw new Error(`${spec.id} boosts ${spec.effect.unitId}, which is not in the catalogue`);
  }
  if (spec.cost <= 0) throw new Error(`${spec.id} costs nothing`);
}
