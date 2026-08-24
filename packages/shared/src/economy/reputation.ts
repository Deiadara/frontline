import { z } from 'zod';
import type { Faction, MissionStance } from '../factions.js';
import { IsoDateTimeSchema } from '../primitives.js';

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
    todo: null,
  },
  'Anti-systemic': {
    description: 'Sustained action against the government, without a banner to plant.',
    todo: null,
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
    todo: null,
  },
  Honorable: {
    description: 'Your word holds and your people get paid on time.',
    todo: null,
  },
  Treacherous: {
    description: 'Deals with you are worth what you decide they are worth.',
    todo: null,
  },
  Collaborator: {
    description: 'The state finds you useful. The street has noticed.',
    todo: null,
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
  /**
   * §A3/§D8 — blows against the Combine that actually landed: raids won on ground it holds, plus
   * anti-government missions that came home a success. Only *successful* action counts, because
   * throwing crews at the state and losing already has a word for it (`Reckless`) and counting a
   * loss on both ledgers would let one raid record produce two contradictory labels.
   *
   * The three counters below default to `0` so a tally written before W10 still parses: a crew
   * that has never met the Combine has taken nothing off it, which is exactly what the missing
   * field means. That is what keeps this a schema change rather than a migration.
   */
  governmentSitesTaken: z.number().nonnegative().default(0),
  /**
   * The subset of the above taken off a *seat* of Combine power (`isSeatOfGovernmentPower`) —
   * what separates replacing the state from robbing it.
   */
  governmentSeatsTaken: z.number().nonnegative().default(0),
  /** §D8 — jobs completed *for* the Combine. Co-operation, and the street counts it. */
  governmentContracts: z.number().nonnegative().default(0),
  /**
   * §D8a — pay-weeks the wage book was settled in full, and pay-weeks it was not.
   *
   * The wage book *is* a contract (see `PayrollStateSchema`): the base agrees a weekly number with
   * a named officer and either meets it or does not. That is the only promise the game currently
   * lets a player make and break, so it is what `Honorable` and `Treacherous` read. A week with no
   * officers on the books moves neither counter — there was no promise to keep.
   *
   * Both default to `0` so a tally written before this landed still parses, exactly as the W10
   * counters above do: a crew with no payroll history has honoured and broken nothing.
   */
  paydaysHonoured: z.number().nonnegative().default(0),
  paydaysMissed: z.number().nonnegative().default(0),
});
export type ReputationTally = z.infer<typeof ReputationTallySchema>;

/**
 * §D8: reputation "changes over time". The tally decays continuously rather than on a tick, so
 * a crew that stops acting drifts back to `Cautious` on its own with no scheduler involved.
 */
export const TALLY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The counters the §D8 drift applies to, read off the schema rather than listed by hand: a counter
 * added above without a decay line would give its label a score a crew could never drift back out
 * of, and deriving the list makes that unrepresentable instead of merely reviewable.
 */
export type ReputationTallyCounter = Exclude<keyof ReputationTally, 'updatedAt'>;
export const TALLY_COUNTERS: readonly ReputationTallyCounter[] = ReputationTallySchema.omit({
  updatedAt: true,
}).keyof().options;

/**
 * Infamy at or above which the street simply calls you `Feared`.
 *
 * Re-quoted when infamy stopped being a 0..100 meter: 60 used to be most of a full meter and is now
 * one dead Colossus. 500 is roughly two won assaults on a garrisoned place — a crew that has done
 * real damage twice rather than one that has been lucky once.
 */
export const FEARED_INFAMY = 500;
/** Losses that mark a crew `Reckless`, provided it is losing more than it wins. */
export const RECKLESS_LOSSES = 5;
/** Wins that earn `Respected`. */
export const RESPECTED_WINS = 5;
/**
 * Blows landed on the Combine before the street calls it sustained (§D8, "lots of anti-government
 * action"). Deliberately above `RESPECTED_WINS` is *not* the aim — four is reachable in an evening
 * of raiding, because a crew that spends its evenings raiding the state is what the word describes.
 */
export const ANTI_SYSTEMIC_ACTIONS = 4;
/**
 * Seats of Combine power taken before the word is `Revolutionary`. Two, because there are exactly
 * two on the map (Blacksite 7 and the Spire) and holding both once is a campaign, not a raid.
 */
export const REVOLUTIONARY_SEATS = 2;
/** Jobs run for the Combine before the street calls it collaboration. */
export const COLLABORATOR_CONTRACTS = 4;
/**
 * Jobs taken *each way* before working both sides is read as a business model rather than as a
 * crew that has not picked one yet (§D8a). Two, because one job in each direction is a fortnight
 * of ordinary play and says nothing — doing it twice each way is a pattern.
 */
export const OPPORTUNIST_JOBS_EACH_WAY = 2;
/**
 * Paydays met before a crew's word is worth something, and paydays missed before the street stops
 * taking it (§D8a). Missing is cheaper than earning on purpose: a reputation for paying is built
 * slowly and a reputation for stiffing people is not.
 *
 * **Why these are small.** Unlike raids, which a player can run back-to-back, paydays arrive on a
 * fixed weekly clock — and the §D8 half-life is 14 days, so a counter fed once a week decays
 * faster than it fills. Its ceiling is `1 / (1 - 0.5^(7/14))` ≈ **3.41**, whatever the player does.
 * A threshold of 5 would be a label no crew could ever earn, and 4 would take seven weeks while
 * claiming to take four. At these values the constants mean what they say at the only cadence the
 * game can produce them: the 3rd consecutive met payday earns `Honorable`, the 2nd missed one earns
 * `Treacherous`, and `reputation.test.ts` pins both against the real writer rather than by hand.
 */
export const HONORABLE_PAYDAYS = 3;
export const TREACHEROUS_MISSED_PAYDAYS = 2;

/**
 * Whether a decayed counter still carries `actions` worth of the thing it counts.
 *
 * The drift is applied *before* every increment, so the Nth action leaves its counter somewhere in
 * `(N - 1, N]` — never exactly `N` unless two actions land in the same millisecond. A `>= N` test
 * therefore silently asks for `N + 1` actions, which is why the threshold is `> N - 1`: true the
 * moment the Nth action lands at any spacing, false after `N - 1`, and still false again once the
 * counter has drifted back down (§D8). Every threshold below reads through this, so a constant
 * documented as "N of these" means N.
 */
export function tallyReaches(counter: number, actions: number): boolean {
  return counter > actions - 1;
}

export function startingTally(now: string): ReputationTally {
  return {
    updatedAt: now,
    raidsWon: 0,
    raidsLost: 0,
    governmentSitesTaken: 0,
    governmentSeatsTaken: 0,
    governmentContracts: 0,
    paydaysHonoured: 0,
    paydaysMissed: 0,
  };
}

/** Applies the §D8 drift up to `now`. Never inflates a counter if the clock jumps backwards. */
export function decayTally(tally: ReputationTally, now: Date): ReputationTally {
  const elapsed = Math.max(0, now.getTime() - new Date(tally.updatedAt).getTime());
  const factor = Math.pow(0.5, elapsed / TALLY_HALF_LIFE_MS);
  const decayed: ReputationTally = { ...tally, updatedAt: now.toISOString() };
  for (const counter of TALLY_COUNTERS) decayed[counter] = tally[counter] * factor;
  return decayed;
}

/** What §D8's stance counters need to know about a raided district, and nothing more (§A3). */
export interface RaidTarget {
  /** Whose ground it was. Only the Combine moves a stance counter. */
  faction: Faction;
  /** A seat of Combine power rather than one of its outposts — see `isSeatOfGovernmentPower`. */
  isSeatOfPower: boolean;
}

/** A raid, as the tally reads it. */
export interface RaidRecord {
  winner: 'attacker' | 'defender';
  target: RaidTarget;
}

/**
 * Decays to `now`, then counts the raid.
 *
 * A won raid on Combine ground is the same event on two ledgers: it is a win the street counts
 * (`raidsWon`) *and* a blow against the government (§A3). Nothing here tallies a second time
 * anywhere else — `EconomyState.reputationTally` is the one copy.
 */
export function recordRaidOutcome(
  tally: ReputationTally,
  { winner, target }: RaidRecord,
  now: Date,
): ReputationTally {
  const decayed = decayTally(tally, now);
  if (winner === 'defender') return { ...decayed, raidsLost: decayed.raidsLost + 1 };

  const againstTheState = target.faction === 'government';
  return {
    ...decayed,
    raidsWon: decayed.raidsWon + 1,
    governmentSitesTaken: decayed.governmentSitesTaken + (againstTheState ? 1 : 0),
    governmentSeatsTaken:
      decayed.governmentSeatsTaken + (againstTheState && target.isSeatOfPower ? 1 : 0),
  };
}

/**
 * Decays to `now`, then books a mission that came home (§E, §D8).
 *
 * A mission moves a stance counter only on success, for the reason given on the schema: an attempt
 * that failed is already priced in morale and in the `Reckless` word. `unaligned` work touches the
 * Combine not at all and is here only so the caller does not have to branch.
 */
export function recordMissionOutcome(
  tally: ReputationTally,
  stance: MissionStance,
  outcome: 'success' | 'failure',
  now: Date,
): ReputationTally {
  const decayed = decayTally(tally, now);
  if (outcome === 'failure' || stance === 'unaligned') return decayed;
  return stance === 'against_government'
    ? { ...decayed, governmentSitesTaken: decayed.governmentSitesTaken + 1 }
    : { ...decayed, governmentContracts: decayed.governmentContracts + 1 };
}

/** A settled payroll, as the tally reads it (§D8a). Weeks, never caps — see `paydaysHonoured`. */
export interface PayrollRecord {
  /** Pay weeks the wage book was met in full. */
  honoured: number;
  /** Pay weeks it was not. */
  missed: number;
}

/**
 * Decays to `now`, then books a settled payroll.
 *
 * Both counters move on the same settle, because a four-week absence can honour some weeks and
 * miss others: paying three weeks and stiffing the fourth is exactly the mixed record the
 * dominance test in `deriveReputation` exists to read.
 */
export function recordPayrollOutcome(
  tally: ReputationTally,
  { honoured, missed }: PayrollRecord,
  now: Date,
): ReputationTally {
  const decayed = decayTally(tally, now);
  return {
    ...decayed,
    paydaysHonoured: decayed.paydaysHonoured + honoured,
    paydaysMissed: decayed.paydaysMissed + missed,
  };
}

export interface ReputationInputs {
  /** §D7 points, uncapped — see `economy/infamy.ts`. */
  infamy: number;
  tally: ReputationTally;
}

/**
 * The one derivation, in precedence order. Kept deliberately small: a label is only reachable
 * once a mechanic can actually produce the signal behind it, which is what keeps every
 * `todo: null` in `REPUTATION_LABEL_SPECS` true and every non-null one honest.
 *
 * **Why the three government words outrank infamy and the raid record.** Where a crew stands on
 * the Combine (§A3) is a claim about *what it is for*; `Feared`, `Reckless` and `Respected` only
 * say how loud and how successful it has been. Once the street can answer "whose side are they
 * on?", that is the answer it gives — a crew four raids into a campaign against the state is read
 * as `Anti-systemic` even at maximum infamy, because the politics is the more specific fact.
 *
 * Within the bloc: `Revolutionary` outranks `Anti-systemic` because its signal is a strict subset
 * (a seat taken is also a site taken), so the narrower claim must be tested first or it could never
 * be returned. A crew that plays both sides needs a *dominant* side to earn one of those words —
 * and once neither ledger leads, working both of them **is** the answer to "whose side are they
 * on?", so `Opportunist` closes the bloc rather than letting a crew that sells to everyone fall
 * through to `Cautious` ("nothing on the street says otherwise yet"), which would be a lie.
 */
export function deriveReputation({ infamy, tally }: ReputationInputs, now: Date): ReputationLabel {
  const {
    raidsWon,
    raidsLost,
    governmentSitesTaken,
    governmentSeatsTaken,
    governmentContracts,
    paydaysHonoured,
    paydaysMissed,
  } = decayTally(tally, now);

  const againstTheState = governmentSitesTaken > governmentContracts;
  if (againstTheState && tallyReaches(governmentSeatsTaken, REVOLUTIONARY_SEATS)) {
    return 'Revolutionary';
  }
  if (againstTheState && tallyReaches(governmentSitesTaken, ANTI_SYSTEMIC_ACTIONS)) {
    return 'Anti-systemic';
  }
  if (
    tallyReaches(governmentContracts, COLLABORATOR_CONTRACTS) &&
    governmentContracts > governmentSitesTaken
  ) {
    return 'Collaborator';
  }
  // Neither ledger leads far enough to name a side, but both are worked: that is a side.
  if (
    tallyReaches(governmentSitesTaken, OPPORTUNIST_JOBS_EACH_WAY) &&
    tallyReaches(governmentContracts, OPPORTUNIST_JOBS_EACH_WAY)
  ) {
    return 'Opportunist';
  }

  // Whether your word holds is a more specific claim than how loud or how successful you are, so
  // the payroll pair outranks the volume labels for the same reason the government bloc outranks
  // both. A mixed record needs a dominant side to earn a word at all, exactly as the stance
  // counters do — a crew that pays half the time is neither, and falls through.
  // Both sides test strictly, so a crew with a level record falls through to the volume labels
  // rather than being called treacherous for a tie — the same shape as `Anti-systemic` and
  // `Collaborator`, which both require their counter to lead the other.
  if (paydaysMissed > paydaysHonoured && tallyReaches(paydaysMissed, TREACHEROUS_MISSED_PAYDAYS)) {
    return 'Treacherous';
  }
  if (paydaysHonoured > paydaysMissed && tallyReaches(paydaysHonoured, HONORABLE_PAYDAYS)) {
    return 'Honorable';
  }

  // Infamy is a running total, not a decayed tally counter, so it is read directly.
  if (infamy >= FEARED_INFAMY) return 'Feared';
  if (tallyReaches(raidsLost, RECKLESS_LOSSES) && raidsLost > raidsWon) return 'Reckless';
  if (tallyReaches(raidsWon, RESPECTED_WINS)) return 'Respected';
  return 'Cautious';
}

/** Labels a live mechanic can currently produce — the complement of the `TODO-LATER` set. */
export const LIVE_REPUTATION_LABELS: readonly ReputationLabel[] = REPUTATION_LABELS.filter(
  (label) => REPUTATION_LABEL_SPECS[label].todo === null,
);
