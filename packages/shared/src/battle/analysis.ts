import { z } from 'zod';
import { UnitTierSchema, type Army } from '../units/index.js';
import type { Simulation, SideState } from './engine.js';
import { moraleState, MORALE_STATE_LABELS } from './morale.js';
import { BattleFindingSchema, findingsFor, narrate, type BattleFinding } from './report.js';
import { BattleSideSchema, type BattleSide } from './scheduled.js';

/**
 * The report a player actually reads afterwards (GDD §A5, battle rework).
 *
 * `report.ts` writes the *prose* — the four lines that make a defeat legible. This writes the
 * **ledger**: who was there, what they did, what it cost, and which of them earned their supply.
 * The two are deliberately separate and both are on the payload, because they answer different
 * questions and a player wants both: the narrative tells you what happened, the ledger tells you
 * what to change.
 *
 * ## Who gets one
 *
 * The rule is the board's and it is the reason perimeters exist:
 *
 * - **The winner always gets a report.** They held the ground and walked the field.
 * - **The loser gets one only if somebody ran and made it home.** A report is not a system message;
 *   it is what the survivors told you. Nobody home, nothing to tell.
 *
 * {@link reportReaches} is the single enforcement point, and the server refuses to hand over an
 * analysis it says no to rather than sending a redacted one. A redacted report still leaks the shape
 * of what was withheld — the count of hidden rows, the fact that a fight happened at all — and the
 * whole point of a perimeter is to buy a silence.
 */

export const UnitPerformanceSchema = z.object({
  unitId: z.string().min(1),
  name: z.string().min(1),
  tier: UnitTierSchema,
  /** One of a kind. Called out separately in the report — a legend's day is its own paragraph. */
  unique: z.boolean(),
  /** Bodies that walked onto the ground. */
  started: z.number().int().nonnegative(),
  /** Bodies that did not walk off it, whatever took them. */
  lost: z.number().int().nonnegative(),
  /** Bodies that broke, ran, and got home. Zero for the winning side, which does not rout. */
  fled: z.number().int().nonnegative(),
  /** Bodies that broke, ran, and were stopped on the way out by the enemy's ring. */
  caught: z.number().int().nonnegative(),
  /** Bodies back on the roster. */
  survived: z.number().int().nonnegative(),
  /** Damage put out across the whole fight, rounded. */
  damage: z.number().nonnegative(),
  /** ...as a share of everything this side dealt, 0..1. The figure that ranks the table. */
  damageShare: z.number().min(0).max(1),
  /** The round it broke, or null if it never did. */
  brokeAtRound: z.number().int().positive().nullable(),
  /** What state it finished in, in the words the morale table uses. */
  state: z.string(),
});
export type UnitPerformance = z.infer<typeof UnitPerformanceSchema>;

export const SideAnalysisSchema = z.object({
  name: z.string(),
  committed: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  survived: z.number().int().nonnegative(),
  /** Everybody who broke and got clear. The number the loser's report hangs on. */
  fled: z.number().int().nonnegative(),
  /** Bodies this side kept outside the fight on the ring. */
  perimeter: z.number().int().nonnegative(),
  /** ...and how many of the enemy's runners it stopped. */
  perimeterCaught: z.number().int().nonnegative(),
  /** Infamy this side banked for what it killed (§D7). */
  infamy: z.number().int().nonnegative(),
  units: z.array(UnitPerformanceSchema),
});
export type SideAnalysis = z.infer<typeof SideAnalysisSchema>;

export const BattleAnalysisSchema = z.object({
  battleId: z.string().min(1),
  locationName: z.string(),
  winner: BattleSideSchema,
  rounds: z.number().int().nonnegative(),
  /** Nobody broke and the round cap called it on who was left standing. */
  decidedOnPower: z.boolean(),
  attacker: SideAnalysisSchema,
  defender: SideAnalysisSchema,
  /** The narrative from `report.ts`. */
  log: z.array(z.string()),
  findings: z.array(BattleFindingSchema),
  /** What a trap took before anybody was in contact, if one was laid. */
  trap: z.object({ name: z.string(), killed: z.number().int().nonnegative() }).nullable(),
  /** One line per legendary unit that was there, whatever happened to it. */
  legends: z.array(z.string()),
  /** The one sentence at the top. Everything else is detail under it. */
  headline: z.string(),
});
export type BattleAnalysis = z.infer<typeof BattleAnalysisSchema>;

export interface AnalysisInput {
  battleId: string;
  locationName: string;
  simulation: Simulation;
  /** Losing bodies that ran and got home, after any ring took its cut. */
  fled: Army;
  /** What the winning side paid, dead outright. */
  winnerLosses: Army;
  /** Each side's ring, which never entered the fight. */
  perimeter: Record<BattleSide, Army>;
  /** Enemy runners the winner's ring stopped. Empty when nobody set one. */
  perimeterCaught: Army;
  trap: { name: string; killed: number } | null;
  infamy: Record<BattleSide, number>;
}

const total = (force: Army): number =>
  Object.values(force).reduce((sum, count) => sum + Math.max(0, count), 0);

function performanceFor(
  side: SideState,
  winning: boolean,
  fled: Army,
  winnerLosses: Army,
  caught: Army,
): UnitPerformance[] {
  const dealt = side.stacks.reduce((sum, stack) => sum + stack.dealt, 0);

  return side.stacks
    .filter((stack) => stack.started > 0)
    .map((stack): UnitPerformance => {
      // Two entirely different accountings, because the two sides end a fight in different states.
      // A winner's roster is what it started with less its dead; a loser's is only the people who
      // ran and got clear, and everybody else is gone however they went.
      const ranHome = winning ? 0 : (fled[stack.unit.id] ?? 0);
      const stopped = winning ? 0 : (caught[stack.unit.id] ?? 0);
      const survived = winning ? stack.started - (winnerLosses[stack.unit.id] ?? 0) : ranHome;

      return {
        unitId: stack.unit.id,
        name: stack.unit.name,
        tier: stack.unit.tier,
        unique: stack.unit.unique,
        started: stack.started,
        lost: Math.max(0, stack.started - survived),
        fled: ranHome,
        caught: stopped,
        survived: Math.max(0, survived),
        damage: Math.round(stack.dealt),
        damageShare: dealt <= 0 ? 0 : stack.dealt / dealt,
        brokeAtRound: stack.brokeAt,
        state: MORALE_STATE_LABELS[stack.brokeAt === null ? moraleState(stack.morale) : 'routed'],
      };
    })
    .sort((a, b) => b.damage - a.damage);
}

function sideAnalysis(
  name: string,
  units: readonly UnitPerformance[],
  perimeter: Army,
  perimeterCaught: number,
  infamy: number,
): SideAnalysis {
  return {
    name,
    committed: units.reduce((sum, unit) => sum + unit.started, 0),
    lost: units.reduce((sum, unit) => sum + unit.lost, 0),
    survived: units.reduce((sum, unit) => sum + unit.survived, 0),
    fled: units.reduce((sum, unit) => sum + unit.fled, 0),
    perimeter: total(perimeter),
    perimeterCaught,
    infamy,
    units: [...units],
  };
}

/**
 * What the legends did.
 *
 * Written as sentences rather than as rows, because a legendary unit is one body and a table row
 * about one body is a strange thing to read. A crew that fielded the Colossus wants to be told
 * whether the Colossus is still standing, in those words.
 */
function legendLines(sides: readonly { units: readonly UnitPerformance[]; name: string }[]) {
  const lines: string[] = [];
  for (const side of sides) {
    for (const unit of side.units) {
      if (!unit.unique) continue;
      if (unit.survived > 0 && unit.damageShare >= 0.3) {
        lines.push(`${unit.name} carried it. Most of what ${side.name} did, ${unit.name} did.`);
      } else if (unit.survived > 0) {
        lines.push(`${unit.name} walked off the ground.`);
      } else if (unit.caught > 0) {
        lines.push(`${unit.name} broke, and did not get past the ring.`);
      } else {
        lines.push(`${unit.name} did not come back. There is not another one.`);
      }
    }
  }
  return lines;
}

function headlineFor(simulation: Simulation, attacker: SideAnalysis, defender: SideAnalysis) {
  const won = simulation.winner === 'attacker' ? attacker : defender;
  const lost = simulation.winner === 'attacker' ? defender : attacker;
  if (lost.committed === 0) {
    return `${won.name} walked onto ${simulation.battlefield.locationName}. Nobody was there.`;
  }
  if (won.lost === 0) {
    return `${won.name} took ${simulation.battlefield.locationName} and did not lose a soul doing it.`;
  }
  return `${won.name} holds ${simulation.battlefield.locationName}. It cost ${won.lost}, and ${lost.name} lost ${lost.lost}.`;
}

/** The whole ledger, from a finished simulation and what the resolver did with it. */
export function analyseBattle(input: AnalysisInput): BattleAnalysis {
  const { simulation } = input;
  const attackerWon = simulation.winner === 'attacker';

  const attackerUnits = performanceFor(
    simulation.attacker,
    attackerWon,
    input.fled,
    input.winnerLosses,
    input.perimeterCaught,
  );
  const defenderUnits = performanceFor(
    simulation.defender,
    !attackerWon,
    input.fled,
    input.winnerLosses,
    input.perimeterCaught,
  );

  const stopped = total(input.perimeterCaught);
  const attacker = sideAnalysis(
    simulation.attacker.name,
    attackerUnits,
    input.perimeter.attacker,
    attackerWon ? stopped : 0,
    input.infamy.attacker,
  );
  const defender = sideAnalysis(
    simulation.defender.name,
    defenderUnits,
    input.perimeter.defender,
    attackerWon ? 0 : stopped,
    input.infamy.defender,
  );

  const findings: BattleFinding[] = findingsFor(simulation);
  return {
    battleId: input.battleId,
    locationName: input.locationName,
    winner: simulation.winner,
    rounds: simulation.rounds.length,
    decidedOnPower: simulation.decidedOnPower,
    attacker,
    defender,
    log: narrate(simulation, findings),
    findings,
    trap: input.trap,
    legends: legendLines([attacker, defender]),
    headline: headlineFor(simulation, attacker, defender),
  };
}

/**
 * Whether this side is told what happened.
 *
 * The winner always is. The loser is only if somebody got home to tell them — which is the entire
 * reason a perimeter is worth the bodies it costs.
 */
export function reportReaches(side: BattleSide, analysis: BattleAnalysis): boolean {
  if (side === analysis.winner) return true;
  return analysis[side].fled > 0;
}

/** The line shown in place of a report nobody came back from. */
export const NO_REPORT_LINE = 'Nobody came back. Whatever happened out there, it stayed out there.';
