import {
  chairPassiveOf,
  factionXpBonus,
  resolvePlayerXpAward,
  type Base,
  type LevelUp,
  type PlayerXpAward,
  type PlayerXpSource,
  FOUND_FACTION_PLAYER_LEVEL,
  playerXpToNextLevel,
} from '@frontline/shared';
import { crewEffectsFor, standingEffectsFor } from '../crew/standing.js';
import { offerOpeningInvitationAt } from '../factions/opening.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * The percentage points every XP award to this crew carries: the district's and the crew's.
 *
 * Its own function so the missions board can quote it and the mission settle can record what it
 * paid, off the same sum the award banks.
 */
export function playerXpBonusPercent(
  repos: Repositories,
  base: Base,
  /** The instant the award is judged at: a settle passes its own, so a chair settling or an
   *  officer laid up is read at the mission's mark rather than at the wall clock (2026-10-05). */
  now: Date = new Date(),
): number {
  return factionXpBonus(base.buildings) + crewEffectsFor(repos, base, now).xpGainPercent;
}

/**
 * The Professor's passive: percentage points more on every mission's XP (maintainer, 2026-10-04).
 * Missions only, so it rides as the award's `extraPercent` on the mission settle and nowhere else.
 */
export function professorXpPercent(
  repos: Repositories,
  base: Base,
  now: Date = new Date(),
): number {
  return chairPassiveOf(crewEffectsFor(repos, base, now), 'professor', 'mission_xp');
}

/**
 * What a mission's XP is paid with: every award's bonus, the Professor's, and the ground's
 * (`missionXpPercent`, the Choir Loft, maintainer 2026-10-07) on top.
 */
export function missionXpBonusPercent(
  repos: Repositories,
  base: Base,
  now: Date = new Date(),
): number {
  return (
    playerXpBonusPercent(repos, base, now) +
    professorXpPercent(repos, base, now) +
    standingEffectsFor(repos, base, now).missionXpPercent
  );
}

export interface AwardedXp {
  /** The base with its new level and banked XP already applied. */
  base: Base;
  award: PlayerXpAward;
}

/**
 * Awards player XP for one thing that happened, and applies any level-up it paid for (GDD §I1-I2).
 *
 * **This is the only function in the server that writes player XP or `Base.level`**: INTERFACES §2
 * R7 gives W6 the whole XP side, so a system that makes XP happen calls this and names its source
 * rather than deciding an amount or touching the level itself. Call sites stay one line long.
 */
export function awardPlayerXp(
  repos: Repositories,
  base: Base,
  source: PlayerXpSource,
  /** Percentage points on top of the district's own, e.g. the lead's charisma on a project. */
  extraPercent = 0,
  /** The figure to pay instead of the source's table entry, for sources that price themselves. */
  amount?: number,
  /** The instant the crew's share is read at; a settle passes its own (see `playerXpBonusPercent`). */
  now: Date = new Date(),
): AwardedXp {
  const award = resolvePlayerXpAward(
    { level: base.level, xpIntoLevel: base.progression.xpIntoLevel },
    source,
    undefined,
    /*
     * §I1: the district's own contribution, the crew's, and whatever the caller adds on this event.
     *
     * The crew's share is read here rather than passed in by every caller, for the reason the note
     * above gives: this is the *only* function that writes player XP, so a channel folded in here
     * reaches missions, builds, fights and research without any of them knowing it exists. Wired
     * at the funnel is also the only way it cannot be forgotten at one of the four call sites.
     *
     * `crewEffectsFor` rather than `standingEffectsFor`: what a crew has learnt to squeeze out of
     * a job is about the people, and holding a Gas Station does not teach anybody anything.
     */
    playerXpBonusPercent(repos, base, now) + extraPercent,
    amount,
  );
  repos.bases.updateProgression(base.id, award.level, award.progression);
  /*
   * §I2: banked durably the moment it happens, so nothing has to be in a position to announce it.
   *
   * A level-up used to ride only on the response of the request that paid for it, which is right
   * for the announcement and wrong as the *only* record. Two paths lost one outright: the world
   * clock brings crews home every second and throws away what it banked, so a mission that crossed
   * a threshold overnight was never announced; and every read route settles the base while only
   * `/me` and the district answer with a `levelUp`, so a build finishing on a poll of `/crew` was
   * silent. The marker (migration 0083) is drained by {@link takeLevelUp}, which is what the
   * announcing responses call, so it is announced exactly once whichever door banked it.
   */
  // Crossing the Faction door's level is when the seeded faction's letter arrives: before it the
  // crew could not accept (`factions/opening.ts`).
  if (base.level < FOUND_FACTION_PLAYER_LEVEL && award.level >= FOUND_FACTION_PLAYER_LEVEL) {
    // Dated at the award's own instant, like the rest of it (bug pass, 2026-10-06).
    offerOpeningInvitationAt(repos, base.ownerId, award.level, now.toISOString());
  }
  if (award.levelsGained > 0) {
    repos.bases.setPendingLevelUp(
      base.id,
      mergeLevelUps(repos.bases.pendingLevelUp(base.id), levelUpFrom([award])) ?? null,
    );
  }
  return { base: { ...base, level: award.level, progression: award.progression }, award };
}

/**
 * A crew whose banked XP is past its level's threshold, rolled over into the levels it now pays for.
 *
 * The curve was retuned on 2026-09-28 with no migration, so a crew that banked 5,499 towards a
 * level whose threshold is now 2,070 sat past its own finish line: the HUD drew the bar overfull,
 * and the levels it had earned waited for the next award to cross them. Run on every settle, and a
 * no-op after the first one: a zero award through the one funnel, so the levels are banked and
 * announced like any other. The source only labels an award nobody is shown.
 */
export function settleRetunedCurve(repos: Repositories, base: Base): Base {
  if (base.progression.xpIntoLevel < playerXpToNextLevel(base.level)) return base;
  return awardPlayerXp(repos, base, 'missionCompleted', 0, 0).base;
}

/**
 * Two level-ups as one announcement.
 *
 * A player who crossed two thresholds while they were away is owed one card saying so, not two in
 * a queue: the levels **add up**, the level and the grants are the ones they ended on, and every
 * unlock either crossing opened is named. The same argument {@link levelUpFrom} makes about the
 * awards inside one settlement, one level further out.
 */
export function mergeLevelUps(
  earlier: LevelUp | undefined,
  later: LevelUp | undefined,
): LevelUp | undefined {
  if (!earlier) return later;
  if (!later) return earlier;
  const last = later.level >= earlier.level ? later : earlier;
  return {
    level: last.level,
    levelsGained: earlier.levelsGained + later.levelsGained,
    grants: last.grants,
    unlocks: [...earlier.unlocks, ...later.unlocks],
  };
}

/**
 * The level-up this crew is owed, and it is owed it exactly once.
 *
 * Reads the durable marker and clears it, so a response that announces cannot be followed by a
 * second one announcing the same thing. **Every** response that carries a `levelUp` goes through
 * here rather than through `levelUpFrom`: a route that computed its own from the awards it happened
 * to see would announce those and leave the marker behind for `/me` to announce again.
 */
export function takeLevelUp(repos: Repositories, baseId: string): LevelUp | undefined {
  const pending = repos.bases.pendingLevelUp(baseId);
  if (pending) repos.bases.setPendingLevelUp(baseId, null);
  return pending;
}

/**
 * One announcement for a run of awards, or `undefined` when none of them crossed a level (MOU-227:
 * presence is the signal, so no client compares two numbers).
 *
 * Takes the whole run because a single call can bank several: a settlement that brings two crews
 * home over two thresholds is *one* level-up to announce, so the levels **add up** while the level
 * and grants are the ones the player ended on. Passing `[award]` is the one-award case.
 *
 * Not what a route puts on its response any more: that is {@link takeLevelUp}, which reads the
 * durable marker this feeds and so also carries whatever an earlier settle banked with nobody
 * there to hear it.
 */
export function levelUpFrom(awards: readonly PlayerXpAward[]): LevelUp | undefined {
  const levelsGained = awards.reduce((total, award) => total + award.levelsGained, 0);
  const last = awards.at(-1);
  if (levelsGained === 0 || !last) return undefined;
  // §I3: every unlock the whole run crossed, not just the last award's. A settlement that banked
  // two missions across three levels can open two doors, and announcing one of them would leave a
  // player to discover the other by walking into it.
  const unlocks = awards.flatMap((award) => award.unlocks);
  return { level: last.level, levelsGained, grants: last.grants, unlocks };
}
