import { z } from 'zod';
import { meetsNotoriety } from '../economy/notoriety.js';

/**
 * Who will even talk to you (GDD §H3).
 *
 * The ordinary door is one threshold a player can see on their own HUD: the **rank** the city has
 * given the crew (§D7). Nothing here is an opinion. The reputation gate that used to sit beside it
 * read a one-word verdict on the crew's behaviour and let half the room refuse over it, which made
 * recruitment a quiz about a label rather than a negotiation about caps.
 *
 * A level door stood beside the rank until 2026-09-28, when the maintainer took it out: every door
 * in the room is about infamy now, the rank for everybody and the wallet and the badge for the two
 * standout chairs.
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
/**
 * The hardest door the *ordinary* room rolls. The two chairs at the end of it ask more.
 *
 * `Marked` is the fifth rung of fourteen, about two weeks of fighting since the ladder was repriced
 * (2026-09-28), so an ordinary seat tops out where "has been doing the thing the game is about"
 * starts. The room's rank shift lifts it as the city climbs (`roomRankShift` in the Bar roster).
 */
export const RECRUIT_MAX_MIN_NOTORIETY = 5;

/**
 * ...and the hardest door in the Bar, which belongs to the people worth building a crew around
 * (maintainer, 2026-09-16).
 *
 * The room used to stop asking at `Marked`, which is also where every other notoriety gate in the
 * game stopped: past rank five a crew had bought a word on a chip and nothing else, and the best
 * sheet the Bar could roll was already available to them. `Feared` is the eighth rung, well past
 * the point where the ladder used to go quiet, and it is what the `legend` grade below asks for.
 *
 * Still reachable, which is the rule the ordinary ceiling is held to as well: a door no crew can
 * clear is a character who is never recruitable, and that reads as a bug rather than a locked one.
 */
export const RECRUIT_LEGEND_NOTORIETY = 8;

/**
 * The infamy door's band, against what a crew holds in its wallet.
 *
 * Retuned with the rank ladder (2026-09-28): a crew that fights every day earns about twelve
 * thousand infamy by the late game and puts most of it into its name, so a door of twelve thousand
 * (grown by a fifth per rank of the room) asked for more than it would ever hold at once. The
 * softest door is a few days of fighting; the hardest, at a room averaging rank ten, about two
 * weeks of late-game earnings saved rather than spent.
 */
export const RECRUIT_MIN_INFAMY_GATE = 200;
export const RECRUIT_MAX_MIN_INFAMY = 2_500;

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

export const JOIN_BLOCKERS = ['notoriety', 'infamy', 'faction'] as const;
export type JoinBlocker = (typeof JOIN_BLOCKERS)[number];

export interface JoinAssessment {
  /** §H3: the crew's rank clears their requirement. */
  meetsNotoriety: boolean;
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
  // Defaulted at the read as well as in the schema: a stored requirement from before these two
  // doors existed parses with zeroes, and a hand-built one in a test may leave them out.
  const okInfamy = crew.infamy >= (requirement.minInfamy ?? 0);
  const okFaction = crew.factionInfamy >= (requirement.minFactionInfamy ?? 0);

  // In the order a player should read them: the rank on their own HUD, then the wallet, then the
  // one that is about somebody other than them.
  const blockers: JoinBlocker[] = [];
  if (!okNotoriety) blockers.push('notoriety');
  if (!okInfamy) blockers.push('infamy');
  if (!okFaction) blockers.push('faction');

  return {
    meetsNotoriety: okNotoriety,
    meetsInfamy: okInfamy,
    meetsFaction: okFaction,
    interested: blockers.length === 0,
    blockers,
  };
}
