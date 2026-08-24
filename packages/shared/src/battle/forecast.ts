import { bareBattlefield, type Battlefield } from './battlefield.js';
import { simulate, type SideSetup } from './engine.js';

/**
 * What a fight is likely to cost, before committing to it (GDD §A5).
 *
 * A Monte Carlo run of **the same engine the server will use**, not a model of it, not a formula
 * that approximates it. That is the whole design constraint: a simulator that is a second
 * implementation drifts from the real one the first time either is tuned, and then it is worse than
 * having none, because the player is planning against a lie.
 *
 * What it deliberately cannot do is see through fog. It is given the garrison *the player knows
 * about*, which on unscouted ground is nothing, so the forecast is only ever as good as the
 * scouting behind it, and a confident number on bad intelligence is the player's own risk.
 */

/**
 * The unit a forecast assumes when all it knows is a head count.
 *
 * Fog of war (§A4) hides an enemy garrison's *composition* and shows only its size: deliberately,
 * and the forecast may not quietly undo that. So an estimate against unscouted composition stands
 * a middling defensive regular in for every body and the screen says out loud that it is doing so.
 *
 * A Warden rather than a Razor or a Juggernaut: it is the roster's ordinary answer to "somebody is
 * holding this", so the estimate is wrong in both directions rather than reliably optimistic.
 */
export const ESTIMATE_UNIT = 'wardens';

/** A stand-in defence of `size` bodies, for ground whose composition nobody has seen. */
export function estimatedForce(size: number): Record<string, number> {
  return size > 0 ? { [ESTIMATE_UNIT]: Math.trunc(size) } : {};
}

/** Enough runs to separate a coin flip from a favourite, few enough to run on a click. */
export const FORECAST_RUNS = 60;

export interface Forecast {
  /** Share of runs the attacker took the ground, 0..1. */
  winChance: number;
  /** Mean share of the attacking force still standing at the end, 0..1. */
  attackerSurvival: number;
  /** ...and of the defence. */
  defenderSurvival: number;
  /** Mean rounds. A short fight is a decided one. */
  rounds: number;
  /** How many runs went into it, so a caller can say "of 60" rather than imply certainty. */
  runs: number;
}

export interface ForecastInput {
  attacker: SideSetup;
  defender: SideSetup;
  battlefield?: Battlefield;
  /** Distinguishes one forecast from another; the runs vary the seed from here. */
  seed?: string;
  runs?: number;
}

const survival = (side: { stacks: { started: number; alive: number }[] }): number => {
  const started = side.stacks.reduce((total, stack) => total + stack.started, 0);
  if (started === 0) return 1;
  return side.stacks.reduce((total, stack) => total + stack.alive, 0) / started;
};

/**
 * Runs the fight `runs` times and averages it.
 *
 * Seeded from `seed` plus the run index rather than from a clock, so the same plan against the same
 * intelligence forecasts the same way twice: a number that flickers while a player is reading it
 * is a number they stop trusting.
 */
export function forecast(input: ForecastInput): Forecast {
  const runs = Math.max(1, input.runs ?? FORECAST_RUNS);
  const battlefield = input.battlefield ?? bareBattlefield();
  const seed = input.seed ?? 'forecast';

  let wins = 0;
  let attackerLeft = 0;
  let defenderLeft = 0;
  let rounds = 0;

  for (let run = 0; run < runs; run += 1) {
    const simulation = simulate({
      seed: `${seed}:${run}`,
      battlefield,
      attacker: input.attacker,
      defender: input.defender,
    });
    if (simulation.winner === 'attacker') wins += 1;
    attackerLeft += survival(simulation.attacker);
    defenderLeft += survival(simulation.defender);
    rounds += simulation.rounds.length;
  }

  return {
    winChance: wins / runs,
    attackerSurvival: attackerLeft / runs,
    defenderSurvival: defenderLeft / runs,
    rounds: rounds / runs,
    runs,
  };
}

/**
 * The forecast in the words a report uses, rather than as a percentage.
 *
 * Deliberately banded. A player told "62%" will treat it as a promise and be angry at the 38%; a
 * player told "the odds are with you" has been given the same information and the right amount of
 * confidence in it. The bands are wide for the same reason the engine hides its multipliers.
 */
export function describeOdds(winChance: number): string {
  if (winChance >= 0.9) return 'They cannot hold this.';
  if (winChance >= 0.7) return 'The odds are with you.';
  if (winChance >= 0.55) return 'Better than even.';
  if (winChance >= 0.45) return 'This one is a coin flip.';
  if (winChance >= 0.3) return 'You are the underdog here.';
  if (winChance >= 0.1) return 'This goes badly for you.';
  return 'This is not a fight, it is a delivery.';
}

/** ...and the same for what it is expected to cost. */
export function describeCost(attackerSurvival: number): string {
  if (attackerSurvival >= 0.85) return 'Barely a scratch.';
  if (attackerSurvival >= 0.6) return 'You will take losses.';
  if (attackerSurvival >= 0.35) return 'Most of them come home. Most.';
  if (attackerSurvival >= 0.15) return 'You will be rebuilding after this.';
  return 'Whoever comes back will be walking.';
}
