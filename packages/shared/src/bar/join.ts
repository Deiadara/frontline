import { z } from 'zod';
import { METER_MAX, type Meter } from '../economy/meters.js';
import type { ReputationLabel } from '../economy/reputation.js';
import { reputationStance, STANCE_MIN, type Disposition } from './disposition.js';

/**
 * Who will even talk to you (GDD §H3, §H4).
 *
 * Two independent gates, and they fail for different reasons. §H3 is a *threshold* the crew either
 * clears or does not — "at least this much infamy" is the board's own example. §H4 is an *opinion*:
 * the same character will sign with one crew and walk away from another with identical numbers,
 * because they read your reputation word through their own ambition and moral compass.
 */

/**
 * §H3 — what a character demands of the crew before they will consider signing.
 *
 * One field today because infamy is the one crew-wide meter §H3 names and the only one W2 tallies
 * (INTERFACES R5). It is an object rather than a bare number so a second requirement lands as a
 * field rather than as a second parameter at every call site.
 */
export const JoinRequirementSchema = z.object({
  /** The §D7 infamy the crew must already have. `0` means anyone can approach them. */
  minInfamy: z.number().min(0).max(METER_MAX),
});
export type JoinRequirement = z.infer<typeof JoinRequirementSchema>;

/**
 * The hardest infamy gate the Bar will ever roll. Deliberately well below `METER_MAX`: a
 * requirement no reachable crew can clear is a character who is never recruitable, which reads as
 * a bug rather than as a locked door.
 */
export const RECRUIT_MAX_MIN_INFAMY = 60;

/**
 * §H4 — the stance at which a character will not join at all. `-2` is both halves of §H4
 * objecting at once, so refusal needs their ambition *and* their morals to be against you.
 */
export const JOIN_REFUSAL_STANCE = STANCE_MIN;

/** What the crew looks like from the other side of the table. */
export interface CrewStanding {
  infamy: Meter;
  reputation: ReputationLabel;
}

export const JOIN_BLOCKERS = ['infamy', 'reputation'] as const;
export type JoinBlocker = (typeof JOIN_BLOCKERS)[number];

export interface JoinAssessment {
  /** §H3 — the crew clears their infamy requirement. */
  meetsRequirement: boolean;
  /** §H4 — what they make of your reputation word, `-2`..`+2`. */
  stance: number;
  /** §H7 — "if the character is interested": both gates open, so a salary can be discussed. */
  interested: boolean;
  /** Why not, in the order a player should read them. Empty when `interested`. */
  blockers: JoinBlocker[];
}

/** §H3 + §H4 — the whole "will they talk to you" question, in one call. */
export function assessJoin(
  disposition: Disposition,
  requirement: JoinRequirement,
  crew: CrewStanding,
): JoinAssessment {
  const meetsRequirement = crew.infamy >= requirement.minInfamy;
  const stance = reputationStance(disposition, crew.reputation);

  const blockers: JoinBlocker[] = [];
  if (!meetsRequirement) blockers.push('infamy');
  if (stance <= JOIN_REFUSAL_STANCE) blockers.push('reputation');

  return { meetsRequirement, stance, interested: blockers.length === 0, blockers };
}

/**
 * §H2b — how many people one crew may sign in a UTC day.
 *
 * One. The Bar is a shared room (§H2) and its stock is finite: hiring somebody takes them out of it
 * for every player, and a seat produces a replacement rather than staying empty. Without a
 * per-player limit the first account awake each day works through the whole roster and every
 * replacement behind it, and nobody else ever meets anybody. The limit is what makes a shared shop
 * shared rather than a race.
 *
 * It lives here rather than beside the roster generator because both sides of the wire need it: the
 * server refuses the second hire, and the Bar screen has to be able to say why before the player
 * tries.
 */
export const BAR_HIRES_PER_DAY = 1;
