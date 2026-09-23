import { z } from 'zod';
import { EnvLabelSchema, WeatherKindSchema } from '../city/index.js';
import { COMBINE_LEADERS, type CombinePower } from '../city/combine.js';
import { findUnit, UnitTierSchema, type Army } from '../units/index.js';
import { officerOutcomeOf, type Simulation, type SideState } from './engine.js';
import { moraleState, MORALE_STATE_LABELS } from './morale.js';
import { BattleFindingSchema, findingsFor, narrate, type BattleFinding } from './report.js';
import { OfficerReportSchema } from './officer.js';
import { BattleSideSchema, type BattleSide } from './scheduled.js';

/**
 * The report a player actually reads afterwards (GDD §A5, battle rework).
 *
 * `report.ts` writes the *prose*: the four lines that make a defeat legible. This writes the
 * **ledger**: who was there, what they did, what it cost, and which of them earned their unit slots.
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
 * of what was withheld, the count of hidden rows, the fact that a fight happened at all, and the
 * whole point of a perimeter is to buy a silence.
 */

export const UnitPerformanceSchema = z.object({
  unitId: z.string().min(1),
  name: z.string().min(1),
  tier: UnitTierSchema,
  /** One of a kind. Called out separately in the report: a legend's day is its own paragraph. */
  unique: z.boolean(),
  /** Units that walked onto the ground. */
  started: z.number().int().nonnegative(),
  /** Units that did not walk off it, whatever took them. */
  lost: z.number().int().nonnegative(),
  /** Units that broke, ran, and got home. Zero for the winning side, which does not rout. */
  fled: z.number().int().nonnegative(),
  /** Units that broke, ran, and were stopped on the way out by the enemy's ring. */
  caught: z.number().int().nonnegative(),
  /** Units back on the roster. */
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
  /** Units this side kept outside the fight on the ring. */
  perimeter: z.number().int().nonnegative(),
  /** ...and how many of the enemy's runners it stopped. */
  perimeterCaught: z.number().int().nonnegative(),
  /**
   * ...and what the ring paid to stop them.
   *
   * Meeting a withdrawal is a second battle now (`battle/perimeter.ts`) rather than a catch-rate, so
   * a ring has casualties. Reported because it is the number that decides whether setting one again
   * is worth it: a ring that held and a ring that was ridden through can catch the same few people
   * and cost wildly different amounts.
   */
  perimeterLost: z.number().int().nonnegative().default(0),
  /**
   * §D3: units on this side too intimidated to fire, settled before the first shot.
   *
   * The engine has reported this on {@link Simulation} since intimidation landed, with a doc saying
   * in as many words that a mechanic the player cannot see reads as a bug. It then stopped here: the
   * analysis never carried it and the report never drew it, so a line that did a third of its damage
   * with every unit still standing looked exactly like a broken engine. This is the rest of that
   * sentence.
   */
  intimidated: z.number().int().nonnegative().default(0),
  /** Infamy this side banked for what it killed (§D7). */
  infamy: z.number().int().nonnegative(),
  units: z.array(UnitPerformanceSchema),
  /**
   * §D1: the officer who led this side, or null when nobody did.
   *
   * Beside the unit rows rather than in them. Every figure in `units` is a unit count the settler
   * writes back to a roster, and an officer is neither trained nor lost nor recovered: they are
   * one person who was there. `injured` is filled in by the settler once the stretcher has been
   * decided, and it is what {@link reportReaches} reads to withhold this side's report (§D4).
   *
   * Defaulted, so a report written before officers could lead reads as a fight nobody led.
   */
  officer: OfficerReportSchema.nullable().default(null),
});
export type SideAnalysis = z.infer<typeof SideAnalysisSchema>;

export const BattleAnalysisSchema = z.object({
  battleId: z.string().min(1),
  locationName: z.string(),
  winner: BattleSideSchema,
  rounds: z.number().int().nonnegative(),
  /** Nobody broke and the round cap called it on who was left standing. */
  decidedOnPower: z.boolean(),
  /** How it ended: somebody standing, the round cap, or both lines falling together. */
  settledBy: z.enum(['standing', 'cap', 'collapse']).default('standing'),
  attacker: SideAnalysisSchema,
  defender: SideAnalysisSchema,
  /** The narrative from `report.ts`. */
  log: z.array(z.string()),
  findings: z.array(BattleFindingSchema),
  /** What a trap took before anybody was in contact, if one was laid. */
  trap: z.object({ name: z.string(), killed: z.number().int().nonnegative() }).nullable(),
  /** One line per legendary unit that was there, whatever happened to it. */
  legends: z.array(z.string()),
  /**
   * The Combine legendary whose shadow this fight was under, or null.
   *
   * A mechanic the player cannot see reads as a bug, and this was the last one that could not be
   * seen. The Executioner and Directive Xero each leave a toll the report already prints
   * (`executed`, `turned`), so a reader could at least tell something had happened to them. The
   * Syndic leaves none: her power is points on the Combine's sheets, so a crew walked into a much
   * harder fight in the Annexes, lost it, and read an aftermath that never mentioned her. Since
   * her 2026-09-20 retune that is the difference between holding 3 of 80 seeds and 75 of 80, which
   * is the whole fight and no part of the report.
   *
   * `.default(null)` because this is written into `scheduled_battles.analysis_json` and read back
   * for ever: a report settled before this field existed parses as a fight under nobody, which is
   * the right answer for one.
   */
  /**
   * The Combine legendary whose ground this was, and the power every defender carried.
   *
   * The two tolls below are the only trace the regime's leaders used to leave on a report, and
   * they only cover two of the three: the Syndic's power is points on her units' sheets, so a
   * crew could walk into a fight that was 25 penetration and 25 armour harder than the numbers
   * they read, lose it, and find nothing in the aftermath about why. That is the same failure the
   * intimidation figure was added for.
   *
   * `.default(null)` rather than a migration, and the difference matters: the `cowed` rename had
   * the old value sitting in the row under a stale key, and this never had one at all. A report
   * settled before 2026-09-21 does not know who it was fought under and no sweep can tell it, so
   * it reads as nobody, which is the only honest thing left to say about it.
   */
  underLeader: z
    .object({ name: z.string().min(1), powerName: z.string().min(1) })
    .nullable()
    .default(null),
  /**
   * The Combine's two tolls, when one of its leaders was over the ground (`city/combine.ts`).
   *
   * `turned` is the attacker's units that changed sides under Directive Xero, by unit id, and is
   * empty in every fight he was not over. `executed` is how many the Executioner finished after
   * an exchange. On the analysis rather than only on the `SkirmishOutcome` because the report is
   * what a player reads afterwards, and both of these are things that need explaining: units that
   * are neither home nor in the casualty list, and deaths the damage numbers do not account for.
   */
  turned: z.record(z.string(), z.number().int().nonnegative()).default({}),
  executed: z.number().int().nonnegative().default(0),
  /** The one sentence at the top. Everything else is detail under it. */
  headline: z.string(),
  /**
   * Whether the beaten side's withdrawal came through the winner's ring rather than breaking on it.
   *
   * True when there was no ring, which is the honest answer to "were they stopped": nobody was.
   * Defaulted so a report written before the ring became a fight still reads.
   */
  brokeThrough: z.boolean().default(true),
  /**
   * §A4: the sky the fight actually happened under, and what the ground was like.
   *
   * The labels decide a real share of the outcome: Anodics at +46% in a press hall, a Colossus
   * losing a fifth of itself to a corridor, and for a while the report said nothing about any of
   * it. A player read a loss with no way to learn that they had sent riflemen into `Crammed IV` in
   * the fog, which makes the whole system a hidden dice roll rather than a thing to plan around.
   *
   * Stored on the analysis rather than recomputed when the card is drawn: the ground is a fact
   * about a moment that has passed, and the weather will have moved by the time anybody reads it.
   */
  weather: WeatherKindSchema,
  ground: z.array(EnvLabelSchema),
});
export type BattleAnalysis = z.infer<typeof BattleAnalysisSchema>;

export interface AnalysisInput {
  battleId: string;
  locationName: string;
  simulation: Simulation;
  /** Losing units that ran and got home, after any ring took its cut. */
  fled: Army;
  /** What the winning side paid, dead outright. */
  winnerLosses: Army;
  /** The legendary whose power the defence carried, when one did. See `city/combine.ts`. */
  underLeader?: CombinePower | undefined;
  /** Each side's ring, which never entered the fight. */
  perimeter: Record<BattleSide, Army>;
  /** Enemy runners the winner's ring stopped. Empty when nobody set one. */
  perimeterCaught: Army;
  /** What the winner's ring paid stopping them. Empty when nobody set one. */
  perimeterLosses?: Army;
  /** Whether the withdrawal came through the ring. True when there was no ring. */
  brokeThrough?: boolean;
  /**
   * The narrative, when the caller has already composed it.
   *
   * `narrate()` writes what happened *in* the fight; the resolver adds what happened on the way out
   * of it, which is the loss line and whatever the ring did. Those lines were on `SkirmishOutcome`
   * and not on the analysis, so the battle log and the report told different stories about the same
   * fight: the report simply stopped before the withdrawal. Passed in rather than recomposed here,
   * because there is one narrative and two readers of it.
   */
  log?: readonly string[];
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
  /*
   * Clamped at zero per stack, not only in the total.
   *
   * `damage` is `z.number().nonnegative()` and `damageShare` is `z.number().min(0).max(1)` on this
   * module's own schema, and nothing validates an analysis before `db/repos/sieges.ts` stores it.
   * The read path *does* validate, and on a failure it logs "stored report is not readable by this
   * build, skipping" and returns nothing for that row: the player wins a fight and it never appears
   * on their board, with a server warning as the only trace. One negative `dealt` was enough, and
   * it also pushed every other stack's share past 1 by shrinking the divisor.
   *
   * A negative `dealt` is not reachable today (`MIN_GROUND_EFFECT_PERCENT` in `city/labels.ts` is
   * the floor that closed it, and a sweep of all 37,324 shipped location x weather x unit x side
   * combinations finds no negative effective offense). This is the boundary guard behind it: a
   * report is the record of something that already happened, and it must be storable whatever the
   * engine hands it.
   */
  const contribution = (stack: SideState['stacks'][number]): number => Math.max(0, stack.dealt);
  const dealt = side.stacks.reduce((sum, stack) => sum + contribution(stack), 0);

  return (
    side.stacks
      // §D1: the officer is not a unit row. `committed`, `lost` and `survived` are sums of these and
      // every one of them is a unit count the settler acts on; an officer is a person who was there,
      // and they get their own field on the side. See `SideAnalysis.officer`.
      .filter((stack) => stack.started > 0 && stack.officer === undefined)
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
          damage: Math.round(contribution(stack)),
          damageShare: dealt <= 0 ? 0 : contribution(stack) / dealt,
          brokeAtRound: stack.brokeAt,
          state: MORALE_STATE_LABELS[stack.brokeAt === null ? moraleState(stack.morale) : 'routed'],
        };
      })
      .sort((a, b) => b.damage - a.damage)
  );
}

interface SideAnalysisInput {
  name: string;
  units: readonly UnitPerformance[];
  perimeter: Army;
  perimeterCaught: number;
  perimeterLost: number;
  intimidated: number;
  /**
   * Units of this side's that changed sides under Directive Xero (`changeOfHeart`), by unit id.
   *
   * Added back into `committed` below and nowhere else. The engine takes the turncoats off their
   * stack's `started` on purpose, because `started - alive` is how `routSurvivors` and
   * `winnerCasualties` count the dead and a man who walked away is not a casualty. But `committed`
   * means "what I sent", and what a player sent includes the ones who did not come back because
   * they are his now. Without this the report told a crew that marched twenty Razors into the CCS
   * that it had committed five.
   */
  turned: Army;
  infamy: number;
  officer: SideAnalysis['officer'];
}

function sideAnalysis(input: SideAnalysisInput): SideAnalysis {
  const { units } = input;
  return {
    name: input.name,
    committed: units.reduce((sum, unit) => sum + unit.started, 0) + total(input.turned),
    lost: units.reduce((sum, unit) => sum + unit.lost, 0),
    survived: units.reduce((sum, unit) => sum + unit.survived, 0),
    fled: units.reduce((sum, unit) => sum + unit.fled, 0),
    perimeter: total(input.perimeter),
    perimeterCaught: input.perimeterCaught,
    perimeterLost: input.perimeterLost,
    intimidated: input.intimidated,
    infamy: input.infamy,
    units: [...units],
    officer: input.officer,
  };
}

/**
 * The officer as the report first sees them: what they did, and not yet what it cost them.
 *
 * `injured` is false here on purpose. Whether an officer ends up on a stretcher is a roll the
 * *settler* makes, because it needs the day's margin and a stream it can bank against, and the
 * engine has neither. The settler overwrites this field; nothing else may.
 */
function officerReportFor(side: SideState): SideAnalysis['officer'] {
  const outcome = officerOutcomeOf(side);
  return outcome === null ? null : { ...outcome, injured: false };
}

/**
 * Who the defence was standing under, by name, for the report.
 *
 * Derived from the power rather than passed alongside it, because `CombinePower.kind` *is* the
 * leader's unit id and a second field would be a second thing to keep in step. Null for a fight
 * nobody commanded, and null for a power naming somebody the catalogue has never heard of, which
 * is a fight the report should describe as nobody's rather than as a blank name's.
 */
function leaderBehind(power: CombinePower | undefined): BattleAnalysis['underLeader'] {
  if (!power) return null;
  const leader = COMBINE_LEADERS.find((one) => one.unitId === power.kind);
  const sheet = leader ? findUnit(leader.unitId) : undefined;
  return leader && sheet ? { name: sheet.name, powerName: leader.powerName } : null;
}

/**
 * What the legends did.
 *
 * Written as sentences rather than as rows, because a legendary unit is one unit and a table row
 * about one unit is a strange thing to read. A crew that fielded the Colossus wants to be told
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
  // Only the winner's ring fought, so only the winner's has casualties to report.
  const ringPaid = total(input.perimeterLosses ?? {});
  const attacker = sideAnalysis({
    name: simulation.attacker.name,
    units: attackerUnits,
    perimeter: input.perimeter.attacker,
    perimeterCaught: attackerWon ? stopped : 0,
    perimeterLost: attackerWon ? ringPaid : 0,
    intimidated: simulation.intimidated.attacker,
    // Only the attacker can lose units to Change of Heart: the Combine never attacks.
    turned: simulation.turned,
    infamy: input.infamy.attacker,
    officer: officerReportFor(simulation.attacker),
  });
  const defender = sideAnalysis({
    name: simulation.defender.name,
    units: defenderUnits,
    perimeter: input.perimeter.defender,
    perimeterCaught: attackerWon ? 0 : stopped,
    perimeterLost: attackerWon ? 0 : ringPaid,
    intimidated: simulation.intimidated.defender,
    turned: {},
    infamy: input.infamy.defender,
    officer: officerReportFor(simulation.defender),
  });

  const findings: BattleFinding[] = findingsFor(simulation);
  return {
    battleId: input.battleId,
    locationName: input.locationName,
    winner: simulation.winner,
    rounds: simulation.rounds.length,
    decidedOnPower: simulation.decidedOnPower,
    settledBy: simulation.settledBy,
    attacker,
    defender,
    log: [...(input.log ?? narrate(simulation, findings))],
    findings,
    trap: input.trap,
    legends: legendLines([attacker, defender]),
    underLeader: leaderBehind(input.underLeader),
    turned: simulation.turned,
    executed: simulation.executed,
    headline: headlineFor(simulation, attacker, defender),
    brokeThrough: input.brokeThrough ?? true,
    // Copied off the battlefield the engine actually fought on, so the card and the fight cannot
    // disagree about the weather.
    weather: simulation.battlefield.weather as BattleAnalysis['weather'],
    ground: simulation.battlefield.labels,
  };
}

/**
 * Whether this side is told what happened (maintainer, 2026-09-23).
 *
 * A defender always is: it is their ground, their gate or their district, and they can see what
 * came at it whether or not anybody of theirs is left standing. An attacker is told if they won,
 * or if at least one of their units got home past the ring; nobody home, no report, which is the
 * entire reason a ring is worth the units it costs. The officer counts for nothing here either
 * way: a report is written by whoever walked back, not by the one on the stretcher.
 */
export function reportReaches(side: BattleSide, analysis: BattleAnalysis): boolean {
  if (side === 'defender') return true;
  if (side === analysis.winner) return true;
  return analysis[side].fled > 0;
}

/** The line shown in place of a report nobody came back from. */
export const NO_REPORT_LINE = 'Nobody came back. Whatever happened out there, it stayed out there.';
