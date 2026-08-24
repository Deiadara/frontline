import { z } from 'zod';
import { meetsNotoriety } from '../economy/notoriety.js';
import type { ReputationLabel } from '../economy/reputation.js';
import { MILESTONE_SECOND_SIGNATURE, isPlayerUnlockActive } from '../progression/unlocks.js';
import { reputationStance, STANCE_MIN, type Disposition } from './disposition.js';

/**
 * Who will even talk to you (GDD §H3, §H4).
 *
 * Two independent gates, and they fail for different reasons. §H3 is a *threshold* the crew either
 * clears or does not: "at least this much of a name" is the board's own example. §H4 is an *opinion*:
 * the same character will sign with one crew and walk away from another with identical numbers,
 * because they read your reputation word through their own ambition and moral compass.
 */

/**
 * §H3: what a character demands of the crew before they will consider signing.
 *
 * One field today because a crew's name is the one standing §H3 names and the only one W2 tallies
 * (INTERFACES R5). It is an object rather than a bare number so a second requirement lands as a
 * field rather than as a second parameter at every call site.
 */
export const JoinRequirementSchema = z.object({
  /**
   * The §D7 **rank** the crew must already hold, as a `NOTORIETY_TIERS` index. `0` is `Nobody`,
   * which means anyone can approach them.
   *
   * A rank rather than a point total since the infamy rework. A recruit who would sit down with you
   * on Monday and not on Tuesday because you bought a crate of stimulants in between was reading
   * the wallet; what they actually care about is whether anybody has heard of you.
   */
  minNotoriety: z.number().int().min(0),
});
export type JoinRequirement = z.infer<typeof JoinRequirementSchema>;

/**
 * The hardest §H3 door the Bar will ever roll, and the softest one that is still a door.
 *
 * Deliberately reachable: a requirement no crew can clear is a character who is never recruitable,
 * which reads as a bug rather than as a locked door. `Marked` is the fifth rung of fourteen and the
 * same rank a legendary unit asks for, so the hardest door in the Bar opens for a crew that has
 * been doing the thing the game is about, and stays shut for one that has not started.
 */
export const RECRUIT_MIN_NOTORIETY_GATE = 1;
export const RECRUIT_MAX_MIN_NOTORIETY = 5;

/**
 * §H4: the stance at which a character will not join at all. `-2` is both halves of §H4
 * objecting at once, so refusal needs their ambition *and* their morals to be against you.
 */
export const JOIN_REFUSAL_STANCE = STANCE_MIN;

/** What the crew looks like from the other side of the table. */
export interface CrewStanding {
  /** §D7 rank, an index into `NOTORIETY_TIERS`. What the door actually judges. */
  notoriety: number;
  reputation: ReputationLabel;
}

export const JOIN_BLOCKERS = ['notoriety', 'reputation'] as const;
export type JoinBlocker = (typeof JOIN_BLOCKERS)[number];

export interface JoinAssessment {
  /** §H3: the crew's rank clears their requirement. */
  meetsRequirement: boolean;
  /** §H4: what they make of your reputation word, `-2`..`+2`. */
  stance: number;
  /** §H7, "if the character is interested": both gates open, so a salary can be discussed. */
  interested: boolean;
  /** Why not, in the order a player should read them. Empty when `interested`. */
  blockers: JoinBlocker[];
}

/** §H3 + §H4: the whole "will they talk to you" question, in one call. */
export function assessJoin(
  disposition: Disposition,
  requirement: JoinRequirement,
  crew: CrewStanding,
): JoinAssessment {
  const meetsRequirement = meetsNotoriety(crew.notoriety, requirement.minNotoriety);
  const stance = reputationStance(disposition, crew.reputation);

  const blockers: JoinBlocker[] = [];
  if (!meetsRequirement) blockers.push('notoriety');
  if (stance <= JOIN_REFUSAL_STANCE) blockers.push('reputation');

  return { meetsRequirement, stance, interested: blockers.length === 0, blockers };
}

/**
 * §H2b: how many people one crew may sign in a UTC day.
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

/**
 * §I3, and how many a crew who has earned it may sign.
 *
 * The one exception to the paragraph above, and it is a deliberate one: `MILESTONE_SECOND_SIGNATURE`
 * is worth reaching level 40 for precisely because the limit it lifts has bound every crew in the
 * city since their first night. Two is the whole of it: the room still empties, it just empties
 * slightly faster for one crew.
 *
 * Every reader of the limit goes through here rather than through the constant, so the milestone
 * cannot be honoured on the screen and forgotten at the gate.
 */
export function barHiresPerDay(level: number): number {
  return BAR_HIRES_PER_DAY + (isPlayerUnlockActive(MILESTONE_SECOND_SIGNATURE, level) ? 1 : 0);
}
