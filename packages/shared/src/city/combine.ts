/**
 * Units by id. Spelled here rather than imported from `units/`, because `units/` imports `city/`
 * and a type import that closed the loop would be the first thing the lint refused. The ids are
 * still unit ids and `city.test.ts` pins that every one of them resolves.
 */
type Garrison = Record<string, number>;

/**
 * The three facts about a control row this module reads. Structural rather than `LocationControl`
 * itself, because `city/control.ts` imports this module for the garrison tables and a type
 * import back would close the loop.
 */
interface HeldGround {
  readonly locationId: string;
  readonly holder: { readonly kind: string };
  readonly garrison: Readonly<Garrison>;
}

/**
 * The Combine: who holds Ashfall, and the three people who run it (maintainer, 2026-09-19).
 *
 * Six of the eight contested districts are the regime's, and the theme of the whole city is that
 * it has been taken. Its headquarters is the Chosen Chapel in the CCS, its military is on the
 * Blacksite, its factories are the Annexes, and the Docks, the Steelbelt and the Glasshouse
 * Fields are simply ground it holds because it holds everything worth holding. The Undergrid and
 * Chrome Row are the two places it does not, and looters have them.
 *
 * This module is the Combine's *command*: which legendary is over which district, what each of
 * them is worth to the units under him, and what the regime stands on a location. The units
 * themselves are in `units/catalog.ts` behind `UnitSpec.faction`; the ground is in
 * `city/districts.ts`; the engine reads the powers through `battle/engine.ts`'s `presence`.
 *
 * ## A leader's reach is the district, his body is one plot
 *
 * The maintainer's rule, and the two halves of it are different mechanics:
 *
 *   * A leader's **powers** cover every Combine defence in his district while he lives. A crew
 *     fighting Greycoats on the far side of the Annexes fights them with the Syndic's Standing
 *     Orders in them, and knows it, because the district screen says so and the leader's card is
 *     a hover away.
 *   * The leader **himself** stands on one location and fights only there. Take that plot and he
 *     is dead: for the whole world, for good. The Combine never musters him, never moves him, and
 *     never replaces him. He is a stationary target with a shadow the size of a district.
 *
 * "Alive" is therefore derived and not stored: he is alive while his unit is standing in the
 * garrison of a Combine-held location in his district ({@link combineLeaderAlive}). Nothing has
 * to remember to flip a flag when the plot falls, and nothing can resurrect him by accident.
 */

export type CombineLeaderId = 'syndic' | 'executioner' | 'directive_xero';

/**
 * What a leader does for the defence, in the engine's terms.
 *
 * A union rather than a bag of optional numbers, for the reason `AreaRequirement` is one: each
 * leader does one recognisable thing, and a reader of the engine's hook should see the name of
 * the thing rather than four fields that might be set.
 */
export type CombinePower =
  /**
   * The Syndic: his side is better informed and better paid than yours.
   *
   * Flat points on the sheets he stands with, and nothing at all on the sheets sent against them
   * (maintainer, 2026-09-20). Defending only: the Combine never attacks, so there is no other
   * case, and there is no field here for the attacker even so.
   */
  | { kind: 'syndic'; penetration: number; armor: number }
  /**
   * The Executioner: a body brought to `threshold` of a life is finished, and what it had left
   * below the line is forfeited. Applied inside the damage walk (`takeDamage`), on every enemy
   * stack in the fight, whether or not he is in it.
   */
  | { kind: 'executioner'; threshold: number }
  /**
   * Directive Xero: nobody with him is frightened, and some of the people against him change
   * sides.
   *
   * His side's units start at `morale`, which is the ceiling, so §D3 cannot silence them. And
   * the enemy units §D3 *would* have silenced do not stand there with their heads down: they
   * cross the line and fight for him (`changeOfHeart`). They are his for good.
   */
  | { kind: 'directive_xero'; morale: number; changeOfHeart: true };

export interface CombineLeader {
  /** The unit, from `units/catalog.ts`. */
  readonly unitId: CombineLeaderId;
  /** The district he commands: every Combine defence in it carries his power while he lives. */
  readonly districtId: string;
  /** The one location he stands on and fights at. */
  readonly locationId: string;
  readonly power: CombinePower;
  /**
   * The power's **name**, which is what a card puts on a chip (maintainer, 2026-09-20).
   *
   * Every other thing a unit carries into a fight has one: `Shield Line`, `Dug In`, `Urban
   * Bonus`. A legendary's power was the one that did not, so his card printed a sentence where
   * every other card prints a mark, and the two read as different kinds of fact when they are
   * the same kind. Two or three words, the register the rule book already uses.
   */
  readonly powerName: string;
  /**
   * How the game speaks about this one, for the lines that are written once for all three.
   *
   * The Syndic is a woman (her portrait landed 2026-09-21 and the maintainer has called her "her"
   * throughout); the other two are men. The tag, the ground box and the card all compose sentences
   * about "the leader", so without this they would have had to pick one and be wrong about a third
   * of the cast. Three words rather than a gender, because three words is all any of those
   * sentences ever needs.
   */
  readonly pronoun: {
    readonly subject: string;
    readonly object: string;
    readonly possessive: string;
  };
  /** What the power is, in the player's words, for the district screen and the battle report. */
  readonly powerLine: string;
}

/**
 * What the Syndic is worth to a defence, in sheet points. Maintainer's figures, 2026-09-20.
 *
 * Both of them land on **her own** units and nothing lands on yours. The opening pair was +20
 * penetration and +20 morale with -20 armour off the attacker, and the morale and the armour cut
 * both went on the maintainer's call: the morale was doing the Directive's job a district early,
 * and reaching across the line to take points off the attacker's sheet is the one thing none of
 * the other two leaders do. What is left is a harder line to shoot at and a harder line to shrug
 * off, which is what a paymaster buys.
 */
export const SYNDIC_PENETRATION = 25;
export const SYNDIC_ARMOR = 25;

/**
 * The share of a life at which the Executioner finishes a unit (`battle/engine.ts`, `takeDamage`).
 *
 * A body under him dies the moment it is brought *to* this line rather than to zero, and what it
 * had left below the line is forfeited: neither spent on that body nor carried to the next. So
 * every body sent against him is worth the top `1 - threshold` of itself, which is a rule about
 * each unit's own health and the reason the engine keeps a per-body ledger at all.
 *
 * It was a rule about the one wounded body at the front of a stack, read after the exchange, and
 * measured on 2026-09-21 that was worth nothing: he moved the force needed to take the Blacksite
 * by 0 slots at 10% and still 0 at 20%, because a stack has only one such body. The maintainer's
 * redesign the same day moved him into the damage walk, with 20% as the worked example.
 *
 * Thirty, measured the same day on the real Blacksite garrison at 800 seeds per point: the extra
 * army a crew needs to take the district is +5% with the line at 20%, +12% at 25%, +15% at 30%,
 * +17% at 35% and +25% at 40%. The maintainer's ordering has him worth more than the Syndic (+9%
 * at her +25/+25) and less than Directive Xero (+79%), in multiples of five. Thirty is the lowest
 * line that clears her by more than the measurement's own two-slot resolution.
 */
export const EXECUTIONER_THRESHOLD = 0.3;

/** Directive Xero's line starts at the morale ceiling, which is what "immune to intimidation" is. */
export const DIRECTIVE_XERO_MORALE = 100;

export const COMBINE_LEADERS: readonly CombineLeader[] = [
  {
    unitId: 'syndic',
    districtId: 'datavault-sigma',
    locationId: 'datavault-sigma-uplink',
    power: {
      kind: 'syndic',
      penetration: SYNDIC_PENETRATION,
      armor: SYNDIC_ARMOR,
    },
    // The paymaster, and what this ground gets is orders backed by a budget.
    powerName: 'Standing Orders',
    pronoun: { subject: 'she', object: 'her', possessive: 'her' },
    powerLine: `Every Combine unit in the Annexes fights with +${SYNDIC_PENETRATION} penetration and +${SYNDIC_ARMOR} armour.`,
  },
  {
    unitId: 'executioner',
    districtId: 'blacksite-7',
    locationId: 'blacksite-7-armory',
    power: { kind: 'executioner', threshold: EXECUTIONER_THRESHOLD },
    powerName: 'No Survivors',
    pronoun: { subject: 'he', object: 'him', possessive: 'his' },
    powerLine: `In any fight on the Blacksite, a unit of yours is finished the moment it falls to ${Math.round(EXECUTIONER_THRESHOLD * 100)}% of its vitality. What it had left is lost, and the fire moves on to the next.`,
  },
  {
    unitId: 'directive_xero',
    districtId: 'combine-spire',
    locationId: 'combine-spire-chapel',
    power: { kind: 'directive_xero', morale: DIRECTIVE_XERO_MORALE, changeOfHeart: true },
    // Both halves of it: nobody under him doubts, and anybody who would have is his.
    powerName: 'Zero Doubt',
    pronoun: { subject: 'he', object: 'him', possessive: 'his' },
    powerLine:
      'Every Combine unit in the CCS fights at 100 morale and cannot be intimidated. Any unit of yours that would have been intimidated changes sides instead, and is his from then on.',
  },
];

/** The leader over a district, or `undefined` for ground no legendary commands. */
export function combineLeaderOf(districtId: string): CombineLeader | undefined {
  return COMBINE_LEADERS.find((leader) => leader.districtId === districtId);
}

/** The leader standing on a location, or `undefined`. */
export function combineLeaderAt(locationId: string): CombineLeader | undefined {
  return COMBINE_LEADERS.find((leader) => leader.locationId === locationId);
}

/**
 * Whether a leader is still standing, read off the world rather than off a flag.
 *
 * He is alive while his unit is in the garrison of a Combine-held location in his district.
 * `controls` is that district's control rows, in any order; a row for another district is
 * ignored rather than trusted, so a caller that hands over the whole city gets the right answer.
 */
export function combineLeaderAlive(
  leader: CombineLeader,
  controls: readonly HeldGround[],
): boolean {
  return controls.some(
    (control) =>
      control.locationId === leader.locationId &&
      control.holder.kind === 'government' &&
      (control.garrison[leader.unitId] ?? 0) > 0,
  );
}

/**
 * The leader whose shadow a fight on this district is under, or `undefined`.
 *
 * The engine's question, asked at the settle: which power, if any, does the Combine's side carry
 * here. Answered only while he lives, which is the whole of what killing him buys.
 */
export function combinePresenceOver(
  districtId: string,
  controls: readonly HeldGround[],
): CombineLeader | undefined {
  const leader = combineLeaderOf(districtId);
  return leader && combineLeaderAlive(leader, controls) ? leader : undefined;
}

// ------------------------------------------------------------------------- who stands where

/**
 * How much fighting weight the Combine stands on a location of this difficulty, in **unit slots**.
 *
 * Slots and not bodies, and that is the whole of the fix this constant exists for. `strength` in
 * `city/control.ts` is a head count, and a head is not a unit of force: a Suppressor is four slots
 * and a Levy is one, so twenty heads of Blacksite garrison were four times the army twenty heads
 * of Annexes garrison were. Measured on a mid-game crew (105 slots) before this was changed, the
 * Annexes at difficulty 6 held **0%** of their plots while the Blacksite at 8 held 88: the ladder
 * did not climb, it jumped, and the jump was an accident of who happened to be standing there.
 *
 * Superlinear on purpose. A district's difficulty is a promise about the fight, and the fight a
 * player brings grows faster than linearly too: they arrive at the Docks with a dozen Razors and
 * at the spire with a hundred slots of heavy armour. The exponent is what keeps the top of the
 * map a wall without making the bottom of it a wall as well, which is the maintainer's rule for
 * the Docks: light in their armed gate.
 *
 * What it gives, against a `baseDefense` of 5: 10 slots at difficulty 1, 15 at 2, 22 at 3, 54 at
 * 6, 83 at 8, 118 at 10. Measured rather than written from memory, and pinned by
 * `city.test.ts`: the four low figures here said 6, 12, 19 and 53 for as long as this comment has
 * existed, which is the one place a reader goes to find out how thin the Docks' gate actually is.
 */
export const COMBINE_SLOTS_PER_DIFFICULTY = 2.2;
export const COMBINE_DIFFICULTY_EXPONENT = 1.7;
export const COMBINE_SLOTS_PER_BASE_DEFENSE = 1.5;

export function combineSlotBudget(difficulty: number, baseDefense: number): number {
  return Math.max(
    2,
    Math.round(
      COMBINE_SLOTS_PER_DIFFICULTY *
        Math.pow(Math.max(1, difficulty), COMBINE_DIFFICULTY_EXPONENT) +
        COMBINE_SLOTS_PER_BASE_DEFENSE * Math.max(0, baseDefense),
    ),
  );
}

/**
 * What the Combine stands on a location, given a budget in unit slots.
 *
 * The ladder the maintainer set: Levy on the cheapest ground, Greycoats behind them as it rises,
 * Enforcers from the Annexes, Suppressors from the Blacksite, and all of it in the CCS. One table
 * rather than a formula per district, so the composition can be read off in a glance and a new
 * district sorts itself by its difficulty.
 *
 * `allegiance.ts`'s `GOVERNMENT_GARRISONS` is the same ladder in words; `city.test.ts` holds the
 * two together.
 */
export function combineGarrison(difficulty: number, slots: number): Garrison {
  if (difficulty <= 1) return fill(slots, [['civic_levy', 1]]);
  if (difficulty <= 4)
    return fill(slots, [
      ['civic_levy', 0.6],
      ['greycoat', 0.4],
    ]);
  if (difficulty <= 6)
    return fill(slots, [
      ['greycoat', 0.55],
      ['street_enforcers', 0.45],
    ]);
  if (difficulty <= 8)
    return fill(slots, [
      ['street_enforcers', 0.5],
      ['suppressor', 0.5],
    ]);
  return fill(slots, [
    ['greycoat', 0.25],
    ['street_enforcers', 0.35],
    ['suppressor', 0.4],
  ]);
}

/**
 * A slot budget spent on the named units in the given proportions.
 *
 * Each share buys whole bodies of that unit, at least one, and the rounding remainder goes to the
 * cheapest unit in the list, which is the one that can always absorb a slot or two. Deterministic
 * and order-preserving, because a garrison is a thing a test states rather than samples.
 */
function fill(slots: number, shares: readonly (readonly [string, number])[]): Garrison {
  const army: Garrison = {};
  let left = Math.max(1, Math.round(slots));
  const cheapest = [...shares].sort(
    (a, b) => COMBINE_UNIT_SLOTS[a[0]]! - COMBINE_UNIT_SLOTS[b[0]]!,
  )[0];
  for (const [unitId, share] of shares) {
    const cost = COMBINE_UNIT_SLOTS[unitId] ?? 1;
    const bodies = Math.max(1, Math.round((slots * share) / cost));
    army[unitId] = bodies;
    left -= bodies * cost;
  }
  // Whatever is left over goes to the cheapest sheet on the list, and whatever was overspent
  // comes off it, down to the one body every named unit is guaranteed.
  if (cheapest) {
    const [unitId] = cheapest;
    const cost = COMBINE_UNIT_SLOTS[unitId] ?? 1;
    army[unitId] = Math.max(1, (army[unitId] ?? 1) + Math.round(left / cost));
  }
  return army;
}

/**
 * What each Combine sheet costs in unit slots.
 *
 * Spelled here rather than read off `UNIT_CATALOG`, for the reason the `Garrison` type is spelled
 * here: `units/` imports `city/`, so reading the catalogue would close the loop. `city.test.ts`
 * pins every figure against the catalogue, so the copy cannot drift.
 */
const COMBINE_UNIT_SLOTS: Readonly<Record<string, number>> = {
  civic_levy: 1,
  greycoat: 1,
  street_enforcers: 2,
  suppressor: 4,
};

/** The squatters: numbers and knives. */
export function looterGarrison(strength: number): Garrison {
  const bodies = Math.max(1, Math.round(strength));
  return split(bodies, [
    ['razors', 0.7],
    ['scrapers', 0.3],
  ]);
}

/**
 * `bodies` shared out by the given fractions, summing to exactly `bodies`.
 *
 * Every named unit gets at least one when there are bodies enough to go round; when there are
 * not, the first units in the list are the ones that stand (a garrison of two on Combine ground
 * is two Levy, not a Levy and a Greycoat and a third body nobody asked for). The rounding
 * remainder lands on the biggest share, so the small ones keep their one. Deterministic and
 * order-preserving, because a garrison is a thing a test states rather than samples.
 */
function split(bodies: number, shares: readonly (readonly [string, number])[]): Garrison {
  const army: Garrison = {};
  if (bodies < shares.length) {
    for (const [unitId] of shares.slice(0, Math.max(0, bodies))) army[unitId] = 1;
    return army;
  }
  const counts = shares.map(([, share]) => Math.max(1, Math.round(bodies * share)));
  const biggest = counts.indexOf(Math.max(...counts));
  const total = counts.reduce((sum, count) => sum + count, 0);
  counts[biggest] = Math.max(1, (counts[biggest] ?? 1) + (bodies - total));
  shares.forEach(([unitId], index) => {
    army[unitId] = counts[index] ?? 1;
  });
  return army;
}
