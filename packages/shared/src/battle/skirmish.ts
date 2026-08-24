import { z } from 'zod';
import type { TerritoryEffects } from '../city/index.js';
import type { Army, FittedUpgrades } from '../units/index.js';
import { analyseBattle, BattleAnalysisSchema } from './analysis.js';
import { perimeterToll } from './perimeter.js';
import { bareBattlefield, BattlefieldSchema, type Battlefield } from './battlefield.js';
import { simulate, type Simulation } from './engine.js';
import {
  BattleFindingSchema,
  findingsFor,
  narrate,
  standingReport,
  type BattleFinding,
} from './report.js';
import { mulberry32, seedFrom } from './rng.js';
import { pursuitSpeed, routSurvivors, winnerCasualties } from './rout.js';

/**
 * Taking a location (GDD §A4) — the seam every caller depends on.
 *
 * `SkirmishEngine` is an interface and the result shape is stable, so the model behind it can be
 * replaced without touching a route, a repository or a screen. It has been replaced once already:
 * the coin flip the board asked for first is still here as {@link CoinFlipSkirmishEngine}, kept
 * because a test that wants a decided outcome should not have to construct a whole army to get one.
 *
 * The real model is {@link TacticalSkirmishEngine}, and it lives in the modules beside this file.
 * Everything that matters is seeded from `input.seed`, so a fight replays from the string on its
 * battle row.
 */

export const SkirmishSideSchema = z.enum(['attacker', 'defender']);
export type SkirmishSide = z.infer<typeof SkirmishSideSchema>;

/** The board's coin flip. Still the middle of the range `rout.ts` tilts around. */
export const UNIT_FLEE_CHANCE = 0.5;

export interface SkirmishInput {
  /** Persisted on the row, so the fight replays from it. */
  seed: string;
  attackerName: string;
  defenderName: string;
  locationName: string;
  attacking: Army;
  defending: Army;
  /** The ground. Omitted means open ground and nothing dug in. */
  battlefield?: Battlefield;
  /** What each side's held territory is worth to its units (§A4). */
  attackerTerritory?: TerritoryEffects;
  defenderTerritory?: TerritoryEffects;
  /** What each side's workshop has fitted (`units/upgrades.ts`). */
  attackerUpgrades?: FittedUpgrades;
  defenderUpgrades?: FittedUpgrades;
  /** §A5 teamwork — how much of an oversized force each side can actually deploy. */
  attackerCohesionPercent?: number;
  defenderCohesionPercent?: number;
  /**
   * The ring each side left outside the fight (`battle/perimeter.ts`).
   *
   * Never enters the round loop. Only the **winner's** does anything at all, and what it does is cut
   * down the other side's runners — which is how a crew denies a beaten enemy their report.
   */
  attackerPerimeter?: Army;
  defenderPerimeter?: Army;
  /** Names the row this fight belongs to, so the report can be filed against it. */
  battleId?: string;
}

export const SkirmishOutcomeSchema = z.object({
  winner: SkirmishSideSchema,
  log: z.array(z.string()),
  /** Losing units that ran. They go back to their owner's army. */
  fled: z.record(z.string(), z.number().int().nonnegative()),
  /** Losing units that did not. They are gone. */
  killed: z.record(z.string(), z.number().int().nonnegative()),
  /** What the *winner* paid. Dead outright — a winner does not rout. */
  winnerLosses: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** How many rounds it took. One means it was over before it started. */
  rounds: z.number().int().nonnegative().default(0),
  /** Per-side, per-visibility notes — see `report.ts`. */
  findings: z.array(BattleFindingSchema).default([]),
  /** What each side had left standing, and what state it was in. */
  standing: z
    .object({
      attacker: z.array(z.object({ name: z.string(), state: z.string(), left: z.number().int() })),
      defender: z.array(z.object({ name: z.string(), state: z.string(), left: z.number().int() })),
    })
    .default({ attacker: [], defender: [] }),
  /**
   * Losing runners the winning side's ring stopped on the way out. Already counted inside
   * {@link SkirmishOutcome.killed} — this is the breakdown, not a second set of casualties.
   */
  perimeterCaught: z.record(z.string(), z.number().int().nonnegative()).default({}),
  battlefield: BattlefieldSchema.optional(),
  /**
   * The full ledger (`battle/analysis.ts`), when the engine that ran this was the real one.
   *
   * Optional because a stub engine has no simulation behind it to analyse, and a stub is exactly
   * what half the server suite injects. A caller that wants the ledger checks for it rather than
   * every test double having to fabricate one.
   */
  analysis: BattleAnalysisSchema.optional(),
});
export type SkirmishOutcome = z.infer<typeof SkirmishOutcomeSchema>;

export interface SkirmishEngine {
  resolve(input: SkirmishInput): SkirmishOutcome;
}

/**
 * A complete outcome from whichever fields a caller cares about.
 *
 * For test doubles. The outcome grew five fields when the coin flip was replaced, and every stub
 * engine in the server suite had to be edited to say `winnerLosses: {}` — which is noise that
 * teaches nothing and will have to be done again on the next field. A stub says what it is testing
 * and this fills in the rest.
 */
export function skirmishOutcome(partial: Partial<SkirmishOutcome> = {}): SkirmishOutcome {
  return {
    winner: 'attacker',
    log: [],
    fled: {},
    killed: {},
    winnerLosses: {},
    rounds: 1,
    findings: [],
    standing: { attacker: [], defender: [] },
    perimeterCaught: {},
    ...partial,
  };
}

const total = (force: Army): number => Object.values(force).reduce((sum, count) => sum + count, 0);

/**
 * The real model.
 *
 * Runs the round simulation in `engine.ts`, then resolves the losers into those who ran and those
 * who did not. The two use the **same** stream in a fixed order — simulation first, rout second —
 * so the seed reproduces the whole thing and not just the first half.
 */
export class TacticalSkirmishEngine implements SkirmishEngine {
  resolve(input: SkirmishInput): SkirmishOutcome {
    const battlefield = input.battlefield ?? bareBattlefield(input.locationName);
    const simulation = simulate({
      seed: input.seed,
      battlefield: { ...battlefield, locationName: input.locationName },
      attacker: {
        name: input.attackerName,
        army: input.attacking,
        defending: false,
        ...(input.attackerTerritory ? { territory: input.attackerTerritory } : {}),
        ...(input.attackerUpgrades ? { upgrades: input.attackerUpgrades } : {}),
        ...(input.attackerCohesionPercent !== undefined
          ? { cohesionPercent: input.attackerCohesionPercent }
          : {}),
      },
      defender: {
        name: input.defenderName,
        army: input.defending,
        defending: true,
        ...(input.defenderTerritory ? { territory: input.defenderTerritory } : {}),
        ...(input.defenderUpgrades ? { upgrades: input.defenderUpgrades } : {}),
        ...(input.defenderCohesionPercent !== undefined
          ? { cohesionPercent: input.defenderCohesionPercent }
          : {}),
      },
    });

    return outcomeFrom(simulation, input);
  }
}

/**
 * The rout roll and the report, from a finished simulation.
 *
 * Split out from the engine class so a test can drive a simulation directly and still get the
 * shape a caller sees — and so the two halves stay separately reviewable.
 */
export function outcomeFrom(simulation: Simulation, input: SkirmishInput): SkirmishOutcome {
  // A second stream, seeded from the same string with a suffix. Reusing the simulation's stream
  // would make the rout depend on exactly how many draws the round loop happened to take, so any
  // tuning pass would silently change every historical fight's survivors.
  const next = mulberry32(seedFrom(`${input.seed}:rout`));

  const winnerSide = simulation.winner === 'attacker' ? simulation.attacker : simulation.defender;
  const loserSide = simulation.winner === 'attacker' ? simulation.defender : simulation.attacker;
  const lastRound = simulation.rounds.length;

  const { fled, killed } = routSurvivors(
    loserSide,
    {
      pursuit: pursuitSpeed(winnerSide),
      lastRound,
      away: simulation.winner === 'defender',
      luck: loserSide.luck,
    },
    next,
  );

  // The ring, and only the winner's — a beaten side's perimeter walks away without fighting, which
  // is the board's rule and the whole gamble of setting one. Drawn from the rout's stream after the
  // rout itself, so a battle nobody ringed produces the exact stream it always did.
  const winnerRing =
    (simulation.winner === 'attacker' ? input.attackerPerimeter : input.defenderPerimeter) ?? {};
  const { caught, escaped } = perimeterToll(fled, winnerRing, next);
  const gotHome = escaped;
  const dead = mergeArmies(killed, caught);

  const findings: BattleFinding[] = findingsFor(simulation);
  const winnerLosses = winnerCasualties(winnerSide);
  return {
    winner: simulation.winner,
    log: [...narrate(simulation, findings), lossLine(gotHome, dead), ...ringLine(caught)],
    fled: gotHome,
    killed: dead,
    winnerLosses,
    rounds: lastRound,
    findings,
    standing: {
      attacker: standingReport(simulation.attacker),
      defender: standingReport(simulation.defender),
    },
    perimeterCaught: caught,
    battlefield: simulation.battlefield,
    analysis: analyseBattle({
      battleId: input.battleId ?? input.seed,
      locationName: input.locationName,
      simulation,
      fled: gotHome,
      winnerLosses,
      perimeter: {
        attacker: input.attackerPerimeter ?? {},
        defender: input.defenderPerimeter ?? {},
      },
      perimeterCaught: caught,
      trap: null,
      infamy: { attacker: 0, defender: 0 },
    }),
  };
}

function mergeArmies(into: Army, extra: Army): Army {
  const merged: Army = { ...into };
  for (const [unitId, count] of Object.entries(extra)) {
    if (count > 0) merged[unitId] = (merged[unitId] ?? 0) + count;
  }
  return merged;
}

/** One line, and only when a ring actually caught somebody. Silence is the usual case. */
function ringLine(caught: Army): string[] {
  const stopped = total(caught);
  return stopped === 0
    ? []
    : [`${stopped} got out of the fight and no further. The ring was waiting.`];
}

function lossLine(fled: Army, killed: Army): string {
  const ran = total(fled);
  const dead = total(killed);
  if (ran === 0 && dead === 0) return 'Nobody was lost on the ground.';
  if (ran === 0) return `${dead} did not make it out.`;
  return `${ran} broke and ran; ${dead} did not.`;
}

/**
 * The board's original coin flip, kept.
 *
 * It reads none of the sheet and is not a model of anything — what it is good for is a test that
 * needs a decided outcome without an army behind it, and a fallback that cannot fail.
 */
export class CoinFlipSkirmishEngine implements SkirmishEngine {
  resolve(input: SkirmishInput): SkirmishOutcome {
    const next = mulberry32(seedFrom(input.seed));
    const attackerWins = next() < 0.5;
    const losers = attackerWins ? input.defending : input.attacking;

    const fled: Army = {};
    const killed: Army = {};
    for (const [unitId, count] of Object.entries(losers)) {
      let ran = 0;
      for (let i = 0; i < count; i += 1) if (next() < UNIT_FLEE_CHANCE) ran += 1;
      if (ran > 0) fled[unitId] = ran;
      if (count - ran > 0) killed[unitId] = count - ran;
    }

    return {
      winner: attackerWins ? 'attacker' : 'defender',
      log: [
        attackerWins
          ? `${input.locationName} changes hands. ${input.attackerName} holds it.`
          : `The push on ${input.locationName} breaks. ${input.defenderName} still holds it.`,
        lossLine(fled, killed),
      ],
      fled,
      killed,
      winnerLosses: {},
      rounds: 1,
      findings: [],
      standing: { attacker: [], defender: [] },
      perimeterCaught: {},
    };
  }
}

/** The engine the server injects. Depend on the interface, never on this. */
export const defaultSkirmishEngine: SkirmishEngine = new TacticalSkirmishEngine();
