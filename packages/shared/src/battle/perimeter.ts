import type { TerritoryEffects } from '../city/locations.js';
import { findUnit, type Army, type UnitLoadouts } from '../units/index.js';
import { simulate, type SideSetup, type SideState, type Simulation } from './engine.js';
import { winnerCasualties, type FleeContext } from './rout.js';

/**
 * The ring around the fight (GDD §A4, battle rework).
 *
 * A second force, chosen before the mark and standing outside the battle proper. It never joins the
 * line and never appears in the round loop. What it does is stop people leaving: anybody breaking
 * out of the fight, and anybody being quietly pulled back out of a deployment before the fight
 * starts.
 *
 * ## Why anybody would field one
 *
 * Not for the kills. A perimeter is an **intelligence weapon**: the losing side only ever learns
 * what happened from the people who walked home, so a ring that catches all of them means the enemy
 * gets a silence where their report should be (`battle/analysis.ts` enforces exactly that). It costs
 * you units that could have been in the line: the trade is units now against the other side
 * planning blind next time, which is the decision the whole mechanic exists to create.
 *
 * ## The rule that makes it a gamble
 *
 * **A losing side's perimeter never fights.** The board's rule, and it is the right one: the ring is
 * outside the battle, so when the line inside it collapses there is nothing for the ring to do and
 * it walks away intact. So a perimeter is a gamble on winning, and every unit in it is a unit that
 * was not helping you win.
 *
 * ## What meeting the ring actually is
 *
 * A **second battle**, on the same ground, under the same rules as the first: the runners attack and
 * the ring defends. It used to be a catch-rate, a per-runner roll against how thick the ring was,
 * and the two models answer very differently. A toll cannot be lost. A ring of four could not be
 * overrun by two hundred people coming through it, it simply caught its 85 percent ceiling of them
 * and took no casualties doing it, so a perimeter was free once you had won and its size only ever
 * changed how much it collected.
 *
 * That is the **breakout**, and it is what this module is mostly about. The other thing a ring does,
 * catching people quietly pulled out of a deployment before the fight, is still a toll and still
 * costs the ring nothing: see {@link perimeterToll} for why those two are not the same model.
 *
 * Now a breakout is a fight, so:
 *
 * - The ring can be **broken through**, and a thin one in front of a mass breakout will be.
 * - The ring **takes casualties**. Standing in front of desperate people costs units.
 * - Nobody flees the ring fight (maintainer, 2026-09-23). The losing side of it dies to the
 *   last unit, runners and ring alike: a unit that would have fled dies instead, and a death at
 *   the ring pays half infamy. Intimidation, which breaks units rather than killing them, kills
 *   here.
 *
 * And only the **defender** may set one. An attacker chose the ground and the hour; the ring is
 * the defender's answer to being chosen.
 */

const total = (force: Army): number =>
  Object.values(force).reduce((sum, count) => sum + Math.max(0, count), 0);

/**
 * How much of the ring is real, in units.
 *
 * Counted rather than weighted by sheet: standing on a road at night is a job a Razor does about as
 * well as a Sniper, and making the ring scale with offense would turn "deny them a report" into
 * "bring your best units and do it twice".
 */
export function perimeterUnits(perimeter: Army): number {
  return Object.entries(perimeter).reduce(
    (sum, [unitId, count]) => (findUnit(unitId) ? sum + Math.max(0, count) : sum),
    0,
  );
}

/**
 * How many runners one unit on the ring can realistically cover, when it is picking off a quiet
 * withdrawal rather than fighting a breakout.
 *
 * Above one because spotting people leaving is not a duel: somebody watching a road stops several
 * over the course of an evening. Not much above one, because a thin ring around a mass exit is a
 * formality.
 */
export const RUNNERS_COVERED_PER_BODY = 1.5;

/** The most of a withdrawal a ring can ever take this way. Nothing is airtight. */
export const MAX_PERIMETER_CATCH = 0.85;

/**
 * How much a runner's own speed and stealth are worth against the ring.
 *
 * The two stats that already decide who gets away from a lost fight (`rout.ts`), read the same way
 * here so a Road Reaver is hard to bottle up for the same reason it is hard to run down. Weighted
 * below one so no sheet makes a unit uncatchable.
 */
export const PERIMETER_EVASION_WEIGHT = 0.6;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** The share of a withdrawal the ring is thick enough to reach at all, 0..1. */
export function ringCoverage(perimeter: Army, runners: number): number {
  if (runners <= 0) return 0;
  return clamp((perimeterUnits(perimeter) * RUNNERS_COVERED_PER_BODY) / runners, 0, 1);
}

/** One runner's odds of being stopped, given how thick the ring is where they hit it. */
export function catchChance(
  unitId: string,
  coverage: number,
  /**
   * The sheet this crew actually fields, rather than the one in the catalogue.
   *
   * `rout.ts` reads speed and stealth off `stack.effective`, and the doc above says the two stats
   * are "read the same way here". They were not: a Ghost Wrap on the Sleepers moved their odds of
   * getting away from a lost fight and did nothing at all for their odds of slipping a ring, which
   * is the same withdrawal one screen later. Optional so the module's own tests can still ask about
   * a printed sheet, and defaulted to it so a caller with no crew in hand gets what it always did.
   */
  sheet: { speed: number; stealth: number } = findUnit(unitId)?.stats ?? { speed: 0, stealth: 0 },
): number {
  if (!findUnit(unitId)) return 0;
  const slipperiness = ((sheet.speed + sheet.stealth) / 200) * PERIMETER_EVASION_WEIGHT;
  return clamp(MAX_PERIMETER_CATCH * coverage * (1 - slipperiness), 0, MAX_PERIMETER_CATCH);
}

export interface PerimeterToll {
  /** Runners the ring stopped. Dead, and they carry no report home. */
  caught: Army;
  /** Runners who got past it. */
  escaped: Army;
}

/**
 * What a ring takes out of a crew being quietly pulled back out of a deployment, before any fight.
 *
 * **Not** the breakout: see {@link breakOut} for what happens to people leaving a fight they lost.
 * The two are separate models on purpose, and the difference is what the runners are doing rather
 * than a simplification.
 *
 * Meeting a ring on the way out of a lost battle is a battle, because both sides are already
 * committed and there is nothing left to lose by riding through. Sneaking units out of a deployment
 * days beforehand is not: nobody is committed to anything, and a player who could start a real fight
 * by withdrawing would withdraw one unit at a time and farm the enemy's ring to nothing for free,
 * one cheap request each. So this stays a toll, and a toll costs the ring nothing.
 *
 * Rolled per individual off the passed stream. An empty ring returns the withdrawal untouched
 * **without drawing**.
 */
export function perimeterToll(
  fleeing: Army,
  perimeter: Army,
  next: () => number,
  /** What each runner's sheet says once the crew's cards and channels are on it. */
  sheetOf: (unitId: string) => { speed: number; stealth: number } = (unitId) =>
    findUnit(unitId)?.stats ?? { speed: 0, stealth: 0 },
): PerimeterToll {
  const runners = total(fleeing);
  const coverage = ringCoverage(perimeter, runners);
  if (coverage <= 0 || runners === 0) return { caught: {}, escaped: { ...fleeing } };

  const caught: Army = {};
  const escaped: Army = {};
  for (const [unitId, count] of Object.entries(fleeing)) {
    if (count <= 0) continue;
    const chance = catchChance(unitId, coverage, sheetOf(unitId));
    let stopped = 0;
    for (let i = 0; i < count; i += 1) if (next() < chance) stopped += 1;
    if (stopped > 0) caught[unitId] = stopped;
    if (count - stopped > 0) escaped[unitId] = count - stopped;
  }
  return { caught, escaped };
}

export interface BreakoutInput {
  /** Who is coming out of the lost fight, after the first rout roll. */
  fleeing: Army;
  /** The winner's ring. The loser's never fights: see {@link perimeterFights}. */
  ring: Army;
  /** The same ground the first fight was on. Omitted is open ground, as it is for `simulate`. */
  battlefield?: Simulation['battlefield'];
  /** The parent fight's seed. The second battle takes its own stream off a suffix of it. */
  seed: string;
  /** The rout context of the fight they are running from, so the same sheets still matter. */
  context: FleeContext;
  /**
   * What each side brings to the second fight, on the same terms as the first.
   *
   * "The same rules as the first" was not true: the breakout ran with no territory, no fitted
   * cards and no cohesion on either side, so every perk, every held place and every bracket a
   * crew had bought was switched off for the half of the fight that decides who gets home. A
   * Road Reaver's crew paid for its speed and then ran the ring bare.
   *
   * Both halves are optional so the module's own tests can still drive a bare breakout, and so a
   * caller with nothing to say produces the identical stream it always did.
   */
  runners?: BreakoutSide;
  guards?: BreakoutSide;
}

/** One side's book for the second fight: exactly what `SideSetup` takes, minus who they are. */
export interface BreakoutSide {
  territory?: TerritoryEffects;
  upgrades?: UnitLoadouts;
  cohesionPercent?: number;
}

export interface Breakout {
  /** Runners who got clear. They go home and they carry the report. */
  escaped: Army;
  /** Runners the ring stopped, whether in the fight or on the second break. Dead. */
  caught: Army;
  /** What the ring paid to stop them. */
  ringLosses: Army;
  /** Whether the runners came through the line rather than being turned back by it. */
  brokeThrough: boolean;
  /** Rounds the second fight took. Zero when there was no ring and no fight. */
  rounds: number;
}

/**
 * One side's optional book, spread into a `SideSetup`.
 *
 * Written key by key because `exactOptionalPropertyTypes` refuses an explicit `undefined`: spreading
 * `{ territory: side?.territory }` past the engine would set the key to undefined rather than leave
 * it out, and `simulate` reads the presence of the key rather than its value.
 */
function sideSetup(side: BreakoutSide | undefined): Partial<SideSetup> {
  if (!side) return {};
  return {
    ...(side.territory ? { territory: side.territory } : {}),
    ...(side.upgrades ? { upgrades: side.upgrades } : {}),
    ...(side.cohesionPercent !== undefined ? { cohesionPercent: side.cohesionPercent } : {}),
  };
}

/** Everybody still on their feet, as an army. */
function standing(side: SideState): Army {
  const army: Army = {};
  for (const stack of side.stacks) {
    if (stack.alive > 0) army[stack.unit.id] = (army[stack.unit.id] ?? 0) + stack.alive;
  }
  return army;
}

/**
 * The runners against the ring.
 *
 * Draws nothing off the parent stream any more: the second fight is seeded on its own suffix and
 * nobody rolls to flee it (maintainer, 2026-09-23), so a battle with or without a ring produces
 * the identical stream for everything after it. The stream is still accepted so the call shape the
 * engine and the tests use does not change.
 */
export function breakOut(input: BreakoutInput, _next: () => number): Breakout {
  const clear = (): Breakout => ({
    escaped: { ...input.fleeing },
    caught: {},
    ringLosses: {},
    brokeThrough: true,
    rounds: 0,
  });
  if (total(input.fleeing) === 0 || perimeterUnits(input.ring) === 0) return clear();

  /*
   * The ring stands *outside* the works, so it does not get to stand behind them.
   *
   * `defending: true` reads `battlefield.fortifyPercent` and `battlefield.baseDefense` as toughness
   * (`battle/effects.ts`), and the works on this ground belong to whoever built the place. When the
   * attacker won, their ring was being handed the fortification of the location they had just
   * taken it off, which is the defender's wall protecting the people who breached it. A breakout
   * happens on the road out, so neither ring is behind anything: both fight on the ground's terms
   * with the works taken off. What a crew's own perks and held places are worth still applies,
   * through `guards.territory`.
   */
  const ground = input.battlefield
    ? { ...input.battlefield, fortifyPercent: 0, baseDefense: 0 }
    : undefined;

  // The runners attack, because they are the ones who need to be somewhere else, and the ring
  // defends, because it chose this ground before the first fight started.
  const second = simulate({
    seed: `${input.seed}:ring`,
    // Spread rather than assigned: `exactOptionalPropertyTypes` refuses an explicit `undefined` for
    // an optional property, and open ground is the absence of the key rather than an undefined one.
    ...(ground ? { battlefield: ground } : {}),
    attacker: {
      name: 'the withdrawal',
      army: input.fleeing,
      defending: false,
      ...sideSetup(input.runners),
    },
    defender: {
      name: 'the ring',
      army: input.ring,
      defending: true,
      ...sideSetup(input.guards),
    },
  });
  const ringLosses = winnerCasualties(second.defender);
  const rounds = second.rounds.length;

  /*
   * Nobody flees the ring (maintainer, 2026-09-23).
   *
   * The ring fight has no rout roll on either side. If the runners break through, whoever of
   * them is still standing is on their way home and the rest fell doing it; the ring, having lost,
   * is dead to the last unit, because a unit that would have fled dies instead. If the ring holds,
   * every runner dies: they already ran once and there is nowhere to run to. So intimidation,
   * which breaks units rather than killing them, kills here, and the whole ring fight is paid in
   * halves (`infamyForRingDead`) on top of the half the runners already paid for running.
   */
  if (second.winner === 'attacker') {
    return {
      escaped: standing(second.attacker),
      caught: winnerCasualties(second.attacker),
      ringLosses: { ...input.ring },
      brokeThrough: true,
      rounds,
    };
  }
  return { escaped: {}, caught: { ...input.fleeing }, ringLosses, brokeThrough: false, rounds };
}

/**
 * Whether a side's ring is allowed to do anything at all.
 *
 * The losing side's is not. Stated as a named predicate rather than an `if` inside the resolver
 * because it is the single rule people get wrong when reading the feature back, and a function with
 * this name in a stack trace explains itself.
 */
export function perimeterFights(side: 'attacker' | 'defender', winner: 'attacker' | 'defender') {
  // Only the defender may set one (maintainer, 2026-09-23), and only a winner's ring fights.
  return side === 'defender' && winner === 'defender';
}
