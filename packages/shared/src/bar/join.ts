import { z } from 'zod';
import { meetsNotoriety } from '../economy/notoriety.js';

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
  /**
   * Infamy **in the wallet**, which is a different question from the rank above it (maintainer request,
   * 2026-09-11).
   *
   * Notoriety is a rank the crew *bought*: infamy went in and a title came out, and once it is
   * bought the wallet is empty again. This asks the other half, whether there is anything in the
   * account right now. A specialist who wants to see a balance is asking whether the crew is still
   * earning, not whether it once spent; a crew that bought its way to `Marked` and has not won a
   * fight since fails this and passes the rank.
   *
   * Defaulted, so every recruit rolled before the door existed reads as asking for nothing.
   */
  minInfamy: z.number().int().min(0).default(0),
  /**
   * What the crew's **faction** has earned, ever (`Faction.infamyEarned`, §J8).
   *
   * The hardest door in the room, and the only one a player cannot walk through alone: a crew in no
   * faction counts as zero and never clears a positive threshold. That is the point. The people
   * behind it are worth a fifth of a payroll book, and what they are asking is whether there is an
   * organisation behind the person offering them a contract.
   *
   * The faction's own number rather than the member's share of it, because a faction is what is
   * being asked about: somebody who joined a serious badge last week is standing behind everything
   * that badge has done, which is exactly the thing the recruit is buying.
   */
  minFactionInfamy: z.number().int().min(0).default(0),
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

/**
 * The infamy door's band, read off the numbers the game already runs on.
 *
 * The Console's own stages are the yardstick: a mid-game crew sits at about 900 infamy and an
 * end-game one at 25,000. So the softest door opens below mid game and the hardest sits well under
 * the ceiling, which keeps the top of the room something a crew reaches rather than something it
 * ages into.
 */
export const RECRUIT_MIN_INFAMY_GATE = 500;
export const RECRUIT_MAX_MIN_INFAMY = 12_000;

/**
 * And the faction door's, against `Faction.infamyEarned`, which is append-only and counts every
 * scrap won in battle by anybody wearing the badge.
 *
 * Lower than the personal band on purpose: this is a whole faction's lifetime rather than one
 * crew's wallet, but it is also the one door that cannot be opened by playing alone, and a
 * threshold a new badge cannot reach in a fortnight would make the standouts permanent scenery.
 */
export const RECRUIT_MIN_FACTION_INFAMY_GATE = 250;
export const RECRUIT_MAX_MIN_FACTION_INFAMY = 5_000;

/** What the crew looks like from the other side of the table. */
export interface CrewStanding {
  /** §D7 rank, an index into `NOTORIETY_TIERS`. */
  notoriety: number;
  /** §I: `Base.level`. */
  level: number;
  /** What is in the wallet right now: `Base.economy.infamy`. */
  infamy: number;
  /**
   * The crew's faction's lifetime earned infamy, or `0` for a crew in no faction.
   *
   * Zero rather than null, so "no faction" and "a faction that has done nothing yet" answer the
   * same door the same way. Neither has anything to show.
   */
  factionInfamy: number;
}

export const JOIN_BLOCKERS = ['notoriety', 'level', 'infamy', 'faction'] as const;
export type JoinBlocker = (typeof JOIN_BLOCKERS)[number];

export interface JoinAssessment {
  /** §H3: the crew's rank clears their requirement. */
  meetsNotoriety: boolean;
  /** §H3: and so does its level. */
  meetsLevel: boolean;
  /** ...and there is enough in the wallet. */
  meetsInfamy: boolean;
  /** ...and the badge behind the crew has earned enough. */
  meetsFaction: boolean;
  /** §H7, "if the character is interested": every door open, so a fee can be discussed. */
  interested: boolean;
  /** Why not, in the order a player should read them. Empty when `interested`. */
  blockers: JoinBlocker[];
}

/** §H3: the whole "will they talk to you" question, in one call. */
export function assessJoin(requirement: JoinRequirement, crew: CrewStanding): JoinAssessment {
  const okNotoriety = meetsNotoriety(crew.notoriety, requirement.minNotoriety);
  const okLevel = crew.level >= requirement.minLevel;
  // Defaulted at the read as well as in the schema: a stored requirement from before these two
  // doors existed parses with zeroes, and a hand-built one in a test may leave them out.
  const okInfamy = crew.infamy >= (requirement.minInfamy ?? 0);
  const okFaction = crew.factionInfamy >= (requirement.minFactionInfamy ?? 0);

  // In the order a player should read them: the two they can see on their own HUD, then the wallet,
  // then the one that is about somebody other than them.
  const blockers: JoinBlocker[] = [];
  if (!okNotoriety) blockers.push('notoriety');
  if (!okLevel) blockers.push('level');
  if (!okInfamy) blockers.push('infamy');
  if (!okFaction) blockers.push('faction');

  return {
    meetsNotoriety: okNotoriety,
    meetsLevel: okLevel,
    meetsInfamy: okInfamy,
    meetsFaction: okFaction,
    interested: blockers.length === 0,
    blockers,
  };
}
