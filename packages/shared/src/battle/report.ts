import { z } from 'zod';
import { COMBAT_CONTEXT_LABELS, type UnitModifierId } from '../units/index.js';
import type { Battlefield } from './battlefield.js';
import { engagementMultiplier, exchange } from './matchup.js';
import { moraleState, MORALE_STATE_LABELS } from './morale.js';
import type { Simulation, SideState, Stack } from './engine.js';

/**
 * Turning a simulation into something a player reads (GDD §A5).
 *
 * The design constraint is the interesting part: **not everything the engine knew may be shown.**
 * A report that prints every multiplier turns a fight into a spreadsheet and hands a player the
 * exact counter-list without their ever having scouted anything. A report that prints only the
 * result teaches nothing and reads as a coin flip.
 *
 * So each finding carries a visibility, and the three are used for different things:
 *
 * - `shared`: both sides saw it happen. The ground, the outcome, who broke.
 * - `own`: only the side it belongs to. Your own units' modifiers; the enemy's are theirs.
 * - `implied`: never stated as a number, only as its consequence. "Your Snipers never got a shot
 *   off" is the whole of what a player is told about an engagement multiplier of 0.4, and it is
 *   enough to act on without being enough to solve.
 */

export const FINDING_VISIBILITIES = ['shared', 'own', 'implied'] as const;
export const FindingVisibilitySchema = z.enum(FINDING_VISIBILITIES);
export type FindingVisibility = z.infer<typeof FindingVisibilitySchema>;

export const FINDING_KINDS = ['ground', 'engagement', 'resistance', 'morale'] as const;
export const FindingKindSchema = z.enum(FINDING_KINDS);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const BattleFindingSchema = z.object({
  side: z.enum(['attacker', 'defender']),
  /** What the finding is about, so a reader can group or filter without parsing the prose. */
  kind: FindingKindSchema,
  visibility: FindingVisibilitySchema,
  text: z.string(),
});
export type BattleFinding = z.infer<typeof BattleFindingSchema>;

/** An engagement multiplier at or above this was decisive enough to say something about. */
export const DOMINANT_ENGAGEMENT = 1.25;

/** ...and at or below this, the unit may as well not have been there. */
export const SMOTHERED_ENGAGEMENT = 1.02;

const sideOf = (simulation: Simulation, side: SideState): 'attacker' | 'defender' =>
  side === simulation.attacker ? 'attacker' : 'defender';

/** The average engagement a stack got across everything it was shooting at. */
function averageEngagement(stack: Stack, enemy: SideState): number {
  const targets = enemy.stacks.filter((target) => target.started > 0);
  if (targets.length === 0) return 1;
  // Through `engagementMultiplier`, not a second copy of its arithmetic: the report carried its
  // own `0.45` and `0.6` and would have silently drifted the first time either was tuned.
  const total = targets.reduce(
    (sum, target) => sum + engagementMultiplier(stack.effective, target.effective),
    0,
  );
  return total / targets.length;
}

/**
 * The one thing about each side's own force worth telling them.
 *
 * Deliberately one line per side rather than a table. A player who is told "the Reavers ran the
 * Snipers down" learns the rule; a player handed thirteen multipliers learns the spreadsheet, and
 * then plays the spreadsheet.
 */
function engagementFindings(
  simulation: Simulation,
  side: SideState,
  enemy: SideState,
): BattleFinding[] {
  const live = side.stacks.filter((stack) => stack.started > 0);
  if (live.length === 0) return [];

  const scored = live
    .map((stack) => ({ stack, score: averageEngagement(stack, enemy) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const worst = scored[scored.length - 1];
  const findings: BattleFinding[] = [];
  const which = sideOf(simulation, side);

  if (best && best.score >= DOMINANT_ENGAGEMENT) {
    findings.push({
      side: which,
      kind: 'engagement',
      visibility: 'implied',
      text: `The ${best.stack.unit.name} were fighting the battle they were built for.`,
    });
  }
  if (worst && worst.score <= SMOTHERED_ENGAGEMENT && worst !== best) {
    findings.push({
      side: which,
      kind: 'engagement',
      visibility: 'implied',
      text: `The ${worst.stack.unit.name} never got to do what they are for.`,
    });
  }
  return findings;
}

/** Resistances that mattered: stated as an effect, never as the percentage on the sheet. */
function resistanceFindings(
  simulation: Simulation,
  side: SideState,
  enemy: SideState,
): BattleFinding[] {
  const findings: BattleFinding[] = [];
  for (const stack of side.stacks) {
    if (stack.started === 0) continue;
    for (const target of enemy.stacks) {
      if (target.started === 0) continue;
      const modifiers: readonly UnitModifierId[] = stack.unit.modifiers;
      const { parts } = exchange(stack.effective, modifiers, target.effective, target.morale);
      if (parts.type <= 0.5) {
        findings.push({
          side: sideOf(simulation, side),
          kind: 'resistance',
          visibility: 'implied',
          text: `Whatever the ${stack.unit.name} were shooting, the ${target.unit.name} were built to walk through it.`,
        });
      } else if (parts.type >= 1.3) {
        findings.push({
          side: sideOf(simulation, side),
          kind: 'resistance',
          visibility: 'implied',
          text: `The ${target.unit.name} had no answer at all to what the ${stack.unit.name} carry.`,
        });
      }
    }
  }
  // One is a lesson; six is a table. Keep the sharpest, and never the same sentence twice: the
  // loop walks every pair, so two stacks of the same kind used to produce the line twice over.
  const seen = new Set<string>();
  return findings
    .filter((finding) => !seen.has(finding.text) && seen.add(finding.text))
    .slice(0, 2);
}

/** What the ground was worth. Shared: both sides stood on it. */
function groundFindings(battlefield: Battlefield): BattleFinding[] {
  const named = battlefield.contexts
    .filter((context) => context !== 'defending' && context !== 'outnumbered')
    .map((context) => COMBAT_CONTEXT_LABELS[context]);
  if (named.length === 0) return [];
  return [
    {
      side: 'defender',
      kind: 'ground',
      visibility: 'shared',
      text: `Fought ${named.join(', ')}.`,
    },
  ];
}

function moraleFindings(simulation: Simulation, side: SideState): BattleFinding[] {
  const broken = side.stacks.filter((stack) => stack.brokeAt !== null);
  if (broken.length === 0) return [];
  const first = broken.reduce((a, b) => ((a.brokeAt ?? 0) <= (b.brokeAt ?? 0) ? a : b));
  return [
    {
      side: sideOf(simulation, side),
      kind: 'morale',
      visibility: 'shared',
      text: `The ${first.unit.name} went first, in round ${first.brokeAt}. ${
        broken.length > 1 ? `${broken.length - 1} more followed them.` : 'The rest held.'
      }`,
    },
  ];
}

export function findingsFor(simulation: Simulation): BattleFinding[] {
  return [
    ...groundFindings(simulation.battlefield),
    ...engagementFindings(simulation, simulation.attacker, simulation.defender),
    ...engagementFindings(simulation, simulation.defender, simulation.attacker),
    ...resistanceFindings(simulation, simulation.attacker, simulation.defender),
    ...resistanceFindings(simulation, simulation.defender, simulation.attacker),
    ...moraleFindings(simulation, simulation.attacker),
    ...moraleFindings(simulation, simulation.defender),
  ];
}

const standing = (side: SideState): number =>
  side.stacks.reduce((total, stack) => total + stack.alive, 0);
const started = (side: SideState): number =>
  side.stacks.reduce((total, stack) => total + stack.started, 0);

/**
 * The narrative log: the part a player actually reads.
 *
 * Written as events rather than as figures. The numbers are all on the report beside it; this is
 * the thing that has to make a defeat legible in four lines.
 */
export function narrate(simulation: Simulation, findings: readonly BattleFinding[]): string[] {
  const { attacker, defender, battlefield, winner } = simulation;
  const log: string[] = [];

  log.push(
    started(defender) === 0
      ? `${started(attacker)} moving on ${battlefield.locationName}. It is standing empty, or looks it.`
      : `${started(attacker)} moving on ${battlefield.locationName}. ${defender.name} has ${started(defender)} on the ground.`,
  );

  const ground = findings.find((finding) => finding.kind === 'ground');
  if (ground) log.push(ground.text);

  for (const record of simulation.rounds) {
    const broke = [...record.attackerBroke, ...record.defenderBroke];
    if (broke.length > 0) log.push(`Round ${record.round}: ${broke.join(' and ')} broke.`);
  }

  log.push(
    winner === 'attacker'
      ? `${battlefield.locationName} changes hands. ${attacker.name} holds it.`
      : `The push on ${battlefield.locationName} breaks. ${defender.name} still holds it.`,
  );

  if (simulation.decidedOnPower) {
    log.push('Neither side broke. It was called on who was left standing.');
  }

  for (const finding of findings) {
    if (finding.visibility === 'implied') log.push(finding.text);
  }

  return log;
}

/** The state each side finished in, for the readout beside the log. */
export function standingReport(side: SideState): { name: string; state: string; left: number }[] {
  return side.stacks
    .filter((stack) => stack.started > 0)
    .map((stack) => ({
      name: stack.unit.name,
      state: MORALE_STATE_LABELS[stack.brokeAt === null ? moraleState(stack.morale) : 'routed'],
      left: stack.alive,
    }));
}

export { standing, started };
