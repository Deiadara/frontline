import { z } from 'zod';
import { IsoDateTimeSchema } from '../primitives.js';
import type { Meter } from './meters.js';

/**
 * Reputation is a *word*, not a number (GDD §D8): a label the street applies to your group
 * based on what it has actually done. Every label named by the board exists here from day one
 * (§D8a) — the ones no mechanic can reach yet carry a `TODO-LATER` naming what will drive them.
 */
export const REPUTATION_LABELS = [
  'Revolutionary',
  'Anti-systemic',
  'Hostile',
  'Cautious',
  'Opportunist',
  'Honorable',
  'Treacherous',
  'Collaborator',
  'Reckless',
  'Feared',
  'Respected',
] as const;
export const ReputationLabelSchema = z.enum(REPUTATION_LABELS);
export type ReputationLabel = z.infer<typeof ReputationLabelSchema>;

export interface ReputationLabelSpec {
  /** Shown under the label in the HUD. */
  description: string;
  /**
   * `null` once a live mechanic can produce this label. Otherwise the marker naming the
   * mechanic and the issue that will wire it up (§D8a).
   */
  todo: string | null;
}

export const REPUTATION_LABEL_SPECS: Readonly<Record<ReputationLabel, ReputationLabelSpec>> = {
  Revolutionary: {
    description: 'You are not raiding the state. You are trying to replace it.',
    todo: 'TODO-LATER: organised anti-government campaign tally — W10/MOU-169 (The Government)',
  },
  'Anti-systemic': {
    description: 'Sustained action against the government, without a banner to plant.',
    todo: 'TODO-LATER: anti-government action tally — W10/MOU-169 (The Government)',
  },
  Hostile: {
    description: 'You hit other crews often enough that they expect it.',
    todo: 'TODO-LATER: player-vs-player attack tally — PvP sieges are not open in any milestone yet; needs a board-filed PvP issue',
  },
  Cautious: {
    description: 'Nothing on the street says otherwise yet. You pick your moments.',
    todo: null,
  },
  Opportunist: {
    description: 'You take the job that pays, whoever is paying.',
    todo: 'TODO-LATER: contract-selection bias across accepted missions — W3/MOU-162 (Missions)',
  },
  Honorable: {
    description: 'Your word holds and your people get paid on time.',
    todo: 'TODO-LATER: contracts honoured + wages paid on time — W5/MOU-164 (The Bar, salary negotiation)',
  },
  Treacherous: {
    description: 'Deals with you are worth what you decide they are worth.',
    todo: 'TODO-LATER: contracts broken / allies betrayed — W5/MOU-164 (The Bar, salary negotiation)',
  },
  Collaborator: {
    description: 'The state finds you useful. The street has noticed.',
    todo: 'TODO-LATER: co-operation with the government — W10/MOU-169 (The Government)',
  },
  Reckless: {
    description: 'You keep throwing your people at doors that do not open.',
    todo: null,
  },
  Feared: {
    description: 'Your name arrives before you do.',
    todo: null,
  },
  Respected: {
    description: 'You win, and the street counts the wins.',
    todo: null,
  },
};

/**
 * The tallied actions reputation is derived from (§D8). Only actions that exist in the game
 * today have a counter — a counter no code can increment would make the `TODO-LATER` markers
 * above dishonest. New counters land with the mechanics named in `REPUTATION_LABEL_SPECS`.
 */
export const ReputationTallySchema = z.object({
  /** When the counters below were last decayed or written. Drives the §D8 drift. */
  updatedAt: IsoDateTimeSchema,
  raidsWon: z.number().nonnegative(),
  raidsLost: z.number().nonnegative(),
});
export type ReputationTally = z.infer<typeof ReputationTallySchema>;

/**
 * §D8: reputation "changes over time". The tally decays continuously rather than on a tick, so
 * a crew that stops acting drifts back to `Cautious` on its own with no scheduler involved.
 */
export const TALLY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/** Infamy at or above which the street simply calls you `Feared`. */
export const FEARED_INFAMY = 60;
/** Losses that mark a crew `Reckless`, provided it is losing more than it wins. */
export const RECKLESS_LOSSES = 5;
/** Wins that earn `Respected`. */
export const RESPECTED_WINS = 5;

export function startingTally(now: string): ReputationTally {
  return { updatedAt: now, raidsWon: 0, raidsLost: 0 };
}

/** Applies the §D8 drift up to `now`. Never inflates a counter if the clock jumps backwards. */
export function decayTally(tally: ReputationTally, now: Date): ReputationTally {
  const elapsed = Math.max(0, now.getTime() - new Date(tally.updatedAt).getTime());
  const factor = Math.pow(0.5, elapsed / TALLY_HALF_LIFE_MS);
  return {
    updatedAt: now.toISOString(),
    raidsWon: tally.raidsWon * factor,
    raidsLost: tally.raidsLost * factor,
  };
}

/** Decays to `now`, then counts the raid. The only live writer of the tally today. */
export function recordRaidOutcome(
  tally: ReputationTally,
  winner: 'attacker' | 'defender',
  now: Date,
): ReputationTally {
  const decayed = decayTally(tally, now);
  return winner === 'attacker'
    ? { ...decayed, raidsWon: decayed.raidsWon + 1 }
    : { ...decayed, raidsLost: decayed.raidsLost + 1 };
}

export interface ReputationInputs {
  infamy: Meter;
  tally: ReputationTally;
}

/**
 * The one derivation, in precedence order. Kept deliberately small: a label is only reachable
 * once a mechanic can actually produce the signal behind it, which is what keeps every
 * `todo: null` in `REPUTATION_LABEL_SPECS` true and every non-null one honest.
 */
export function deriveReputation({ infamy, tally }: ReputationInputs, now: Date): ReputationLabel {
  const { raidsWon, raidsLost } = decayTally(tally, now);

  if (infamy >= FEARED_INFAMY) return 'Feared';
  if (raidsLost >= RECKLESS_LOSSES && raidsLost > raidsWon) return 'Reckless';
  if (raidsWon >= RESPECTED_WINS) return 'Respected';
  return 'Cautious';
}

/** Labels a live mechanic can currently produce — the complement of the `TODO-LATER` set. */
export const LIVE_REPUTATION_LABELS: readonly ReputationLabel[] = REPUTATION_LABELS.filter(
  (label) => REPUTATION_LABEL_SPECS[label].todo === null,
);
