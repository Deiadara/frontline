import { z } from 'zod';
import { meetsNotoriety } from '../economy/notoriety.js';
import { MILESTONE_SECOND_SIGNATURE, isPlayerUnlockActive } from '../progression/unlocks.js';

/**
 * Who will even talk to you (GDD §H3).
 *
 * Two thresholds, and they are both numbers a player can see on their own HUD: the **rank** the
 * city has given the crew (§D7) and the crew's own **level** (§I). Nothing here is an opinion any
 * more. The reputation gate that used to sit beside them read a one-word verdict on the crew's
 * behaviour and let half the room refuse over it, which made recruitment a quiz about a label
 * rather than a negotiation about caps: a player who wanted a particular officer had no lever to
 * pull. Now the levers are rank, level and the money, and all three are things you go and get.
 *
 * The good ones ask for both. A recruit worth a fifth of the payroll book wants to see that the
 * crew is known *and* that it has been around, and asking for one of the two is what makes a
 * mid-table officer reachable early while the top of the room stays something to work towards.
 */

/** §H3: what a character demands of the crew before they will consider signing. */
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
  /**
   * The crew's own level (§I), or `1`, which every crew clears.
   *
   * A different question from the rank beside it, and the reason both exist. Notoriety is how loud
   * you are; level is how long you have been doing this. A demolitions specialist does not care
   * that the street knows your name, they care that you have run enough jobs to be worth working
   * for. Defaulted so a recruit rolled before levels gated anything parses as asking for nothing.
   */
  minLevel: z.number().int().min(1).default(1),
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

/** And the same shape for the level door: reachable, and worth reaching. */
export const RECRUIT_MIN_LEVEL_GATE = 2;
export const RECRUIT_MAX_MIN_LEVEL = 25;

/** What the crew looks like from the other side of the table. */
export interface CrewStanding {
  /** §D7 rank, an index into `NOTORIETY_TIERS`. */
  notoriety: number;
  /** §I: `Base.level`. */
  level: number;
}

export const JOIN_BLOCKERS = ['notoriety', 'level'] as const;
export type JoinBlocker = (typeof JOIN_BLOCKERS)[number];

export interface JoinAssessment {
  /** §H3: the crew's rank clears their requirement. */
  meetsNotoriety: boolean;
  /** §H3: and so does its level. */
  meetsLevel: boolean;
  /** §H7, "if the character is interested": every door open, so a fee can be discussed. */
  interested: boolean;
  /** Why not, in the order a player should read them. Empty when `interested`. */
  blockers: JoinBlocker[];
}

/** §H3: the whole "will they talk to you" question, in one call. */
export function assessJoin(requirement: JoinRequirement, crew: CrewStanding): JoinAssessment {
  const okNotoriety = meetsNotoriety(crew.notoriety, requirement.minNotoriety);
  const okLevel = crew.level >= requirement.minLevel;

  const blockers: JoinBlocker[] = [];
  if (!okNotoriety) blockers.push('notoriety');
  if (!okLevel) blockers.push('level');

  return {
    meetsNotoriety: okNotoriety,
    meetsLevel: okLevel,
    interested: blockers.length === 0,
    blockers,
  };
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
