import { describe, expect, it } from 'vitest';
import { PLAYER_LEVEL_MIN, applyPlayerXp, playerXpToNextLevel } from './curve.js';
import { EFFORT_BASELINE_MINUTES, MIN_EFFORT_SHARE, effortScale } from './effort.js';
import { rewardScale } from '../missions.js';
import { playerLevelGrants } from './grants.js';
import {
  PLAYER_XP_AWARDS,
  ProgressionStateSchema,
  resolvePlayerXpAward,
  startingProgression,
  xpForClock,
  type PlayerXpSource,
} from './state.js';
import {
  AREA_UNLOCK_LEVELS,
  FIRST_MILESTONE_LEVEL,
  GATED_AREAS,
  MILESTONE_STEP,
  PLAYER_LEVEL_UNLOCKS,
  findPlayerUnlock,
  isPlayerUnlockActive,
  nextPlayerUnlock,
  playerUnlocksBetween,
  type PlayerLevelUnlock,
} from './unlocks.js';

const XP_SOURCES = Object.keys(PLAYER_XP_AWARDS) as PlayerXpSource[];

describe('the level curve (§I2)', () => {
  it('costs 100, 300, 600, 1000, 1500 XP for the first five levels', () => {
    expect([1, 2, 3, 4, 5].map(playerXpToNextLevel)).toEqual([100, 300, 600, 1000, 1500]);
  });

  it('is strictly increasing and integral, so a level always costs more than the last', () => {
    for (let level = PLAYER_LEVEL_MIN + 1; level < 200; level += 1) {
      const cost = playerXpToNextLevel(level);
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThan(playerXpToNextLevel(level - 1));
    }
  });

  it('levels up exactly on the threshold, not one XP early', () => {
    const start = { level: 1, xpIntoLevel: 0 };
    expect(applyPlayerXp(start, 99)).toEqual({ level: 1, xpIntoLevel: 99, levelsGained: 0 });
    expect(applyPlayerXp(start, 100)).toEqual({ level: 2, xpIntoLevel: 0, levelsGained: 1 });
  });

  it('carries leftover XP into the new level', () => {
    expect(applyPlayerXp({ level: 1, xpIntoLevel: 40 }, 75)).toEqual({
      level: 2,
      xpIntoLevel: 15,
      levelsGained: 1,
    });
  });

  it('crosses several levels on one oversized award', () => {
    // 100 + 300 + 600 clears levels 1..3 exactly; the extra 50 lands inside level 4.
    expect(applyPlayerXp({ level: 1, xpIntoLevel: 0 }, 1050)).toEqual({
      level: 4,
      xpIntoLevel: 50,
      levelsGained: 3,
    });
  });

  it('is path independent: one big award equals the same total drip-fed', () => {
    const oneShot = applyPlayerXp({ level: 1, xpIntoLevel: 0 }, 2000);
    let stepwise = { level: 1, xpIntoLevel: 0 };
    for (let i = 0; i < 40; i += 1) {
      stepwise = applyPlayerXp(stepwise, 50);
    }
    expect(stepwise).toMatchObject({ level: oneShot.level, xpIntoLevel: oneShot.xpIntoLevel });
  });

  it('never moves backwards or off the curve on junk input', () => {
    expect(applyPlayerXp({ level: 3, xpIntoLevel: 10 }, -500)).toEqual({
      level: 3,
      xpIntoLevel: 10,
      levelsGained: 0,
    });
    expect(applyPlayerXp({ level: 0, xpIntoLevel: -5 }, 0).level).toBe(PLAYER_LEVEL_MIN);
  });

  it('leaves progress strictly below the next threshold, at every level', () => {
    let progress = { level: 1, xpIntoLevel: 0 };
    for (let i = 0; i < 500; i += 1) {
      progress = applyPlayerXp(progress, 137);
      expect(progress.xpIntoLevel).toBeLessThan(playerXpToNextLevel(progress.level));
      expect(progress.xpIntoLevel).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('level-up grants (§I2 → §H8)', () => {
  it('grants recruit slots per §H8: 2 at the start, +1 per level', () => {
    expect([1, 2, 5, 10].map((l) => playerLevelGrants(l).recruitSlots)).toEqual([2, 3, 6, 11]);
  });

  it('never regresses as level rises', () => {
    for (let level = PLAYER_LEVEL_MIN; level < 60; level += 1) {
      const here = playerLevelGrants(level);
      const next = playerLevelGrants(level + 1);
      expect(next.recruitSlots).toBeGreaterThanOrEqual(here.recruitSlots);
    }
  });

  it('clamps a malformed level instead of throwing: grants sit on a read path', () => {
    expect(playerLevelGrants(0)).toEqual(playerLevelGrants(1));
    expect(playerLevelGrants(2.9)).toEqual(playerLevelGrants(2));
  });
});

describe('the unlock catalogue (§I3)', () => {
  const catalogue: PlayerLevelUnlock[] = [
    { id: 'reskilling', level: 3, name: 'Reskilling', description: 'Move an assignee.' },
    { id: 'hard-missions', level: 5, name: 'Hard work', description: 'The bad jobs.' },
  ];

  it('opens the four screens at the levels the board named', () => {
    expect(AREA_UNLOCK_LEVELS).toEqual({ research: 3, market: 5, training: 7, bar: 10 });
    for (const area of GATED_AREAS) {
      expect(isPlayerUnlockActive(area, AREA_UNLOCK_LEVELS[area] - 1)).toBe(false);
      expect(isPlayerUnlockActive(area, AREA_UNLOCK_LEVELS[area])).toBe(true);
      // A door has copy, because a locked one has to say what it is rather than only when.
      expect(findPlayerUnlock(area)?.description).toBeTruthy();
    }
  });

  it('puts every milestone on the ten-level ladder from 40, and none below it', () => {
    const milestones = PLAYER_LEVEL_UNLOCKS.filter(
      (unlock) => !GATED_AREAS.includes(unlock.id as (typeof GATED_AREAS)[number]),
    );
    expect(milestones.length).toBeGreaterThan(0);
    for (const milestone of milestones) {
      expect(milestone.level).toBeGreaterThanOrEqual(FIRST_MILESTONE_LEVEL);
      expect(milestone.level % MILESTONE_STEP).toBe(0);
    }
  });

  it('reports only the unlocks a level-up actually crossed', () => {
    expect(playerUnlocksBetween(1, 3, catalogue)).toEqual([catalogue[0]]);
    // Already had reskilling at 3; levelling 3 -> 5 must not re-announce it.
    expect(playerUnlocksBetween(3, 5, catalogue)).toEqual([catalogue[1]]);
    expect(playerUnlocksBetween(1, 5, catalogue)).toHaveLength(2);
    expect(playerUnlocksBetween(5, 5, catalogue)).toEqual([]);
  });

  it('answers membership by level, and treats an unknown id as locked', () => {
    expect(isPlayerUnlockActive('reskilling', 2, catalogue)).toBe(false);
    expect(isPlayerUnlockActive('reskilling', 3, catalogue)).toBe(true);
    expect(isPlayerUnlockActive('nope', 99, catalogue)).toBe(false);
  });

  it('names the next thing worth reaching, and stops naming one past the ladder', () => {
    expect(nextPlayerUnlock(1)?.id).toBe('research');
    expect(nextPlayerUnlock(3)?.id).toBe('market');
    expect(nextPlayerUnlock(10)?.level).toBe(FIRST_MILESTONE_LEVEL);
    expect(nextPlayerUnlock(9_999)).toBeNull();
  });
});

describe('XP awards (§I1)', () => {
  it('prices every §I1 source, including the clocks the widening added', () => {
    expect(XP_SOURCES).toEqual([
      'missionCompleted',
      'buildingConstructed',
      'questCompleted',
      'raidWon',
      'raidLost',
      'researchCompleted',
      'unitTrained',
      'officerHired',
    ]);
    for (const source of XP_SOURCES) {
      expect(PLAYER_XP_AWARDS[source]).toBeGreaterThan(0);
    }
    expect(PLAYER_XP_AWARDS.raidWon).toBeGreaterThan(PLAYER_XP_AWARDS.raidLost);
    // The ordering the table's doc comment claims: priced by how long the thing takes and how much
    // of it can be running at once. A batch off the bench is the cheapest and most frequent.
    expect(PLAYER_XP_AWARDS.researchCompleted).toBeGreaterThan(PLAYER_XP_AWARDS.officerHired);
    expect(PLAYER_XP_AWARDS.officerHired).toBeGreaterThan(PLAYER_XP_AWARDS.unitTrained);
  });

  it('starts a fresh player at zero progress, and that parses', () => {
    expect(ProgressionStateSchema.parse(startingProgression())).toEqual({ xpIntoLevel: 0 });
  });

  it('rejects a progression that is not a whole, non-negative XP count', () => {
    expect(() => ProgressionStateSchema.parse({ xpIntoLevel: -1 })).toThrow();
    expect(() => ProgressionStateSchema.parse({ xpIntoLevel: 1.5 })).toThrow();
  });

  it('reports the level-up and the grants that came with it', () => {
    const award = resolvePlayerXpAward({ level: 3, xpIntoLevel: 580 }, 'missionCompleted');
    expect(award).toMatchObject({
      source: 'missionCompleted',
      xpGained: 120,
      level: 4,
      levelsGained: 1,
      progression: { xpIntoLevel: 100 },
      xpToNextLevel: 1000,
    });
    expect(award.grants).toEqual({ recruitSlots: 5 });
  });

  it('reports the grants unchanged when the award did not level anyone up', () => {
    const award = resolvePlayerXpAward({ level: 2, xpIntoLevel: 0 }, 'raidLost');
    expect(award).toMatchObject({ level: 2, levelsGained: 0, progression: { xpIntoLevel: 25 } });
    expect(award.grants).toEqual(playerLevelGrants(2));
    expect(award.unlocks).toEqual([]);
  });

  it('surfaces every unlock a multi-level award crossed', () => {
    const catalogue: PlayerLevelUnlock[] = [
      { id: 'a', level: 2, name: 'A', description: 'The first door.' },
      { id: 'b', level: 3, name: 'B', description: 'The second door.' },
      { id: 'later', level: 9, name: 'Later', description: 'Not yet.' },
    ];
    const award = resolvePlayerXpAward({ level: 1, xpIntoLevel: 380 }, 'questCompleted', catalogue);
    expect(award.level).toBe(3);
    expect(award.unlocks.map((u) => u.id)).toEqual(['a', 'b']);
  });
});

/**
 * Every clock pays on the same curve (§I1, §E5).
 *
 * The rule `PLAYER_XP_AWARDS` states, and did not keep: the table is a set of **anchors**, priced
 * "by how long the thing takes". Only missions read theirs that way. A fifty-five-second first
 * Gauntlet and a nine-hour level 20 both paid a flat 60; a Razor off the bench in 45 seconds and a
 * Colossus after ninety minutes both paid 20.
 */
describe('anything with a clock on it is priced off that clock (§I1)', () => {
  it('pays more for a longer job, on every source', () => {
    for (const source of Object.keys(PLAYER_XP_AWARDS) as PlayerXpSource[]) {
      const short = xpForClock(source, 60);
      const long = xpForClock(source, 9 * 3600);
      expect(long, source).toBeGreaterThan(short * 4);
    }
  });

  it('pays the anchor exactly for a job of the baseline length', () => {
    for (const source of Object.keys(PLAYER_XP_AWARDS) as PlayerXpSource[]) {
      expect(xpForClock(source, EFFORT_BASELINE_MINUTES * 60), source).toBe(
        PLAYER_XP_AWARDS[source],
      );
    }
  });

  /**
   * The floor, and why it is not zero. The curve prices a twenty-second build at 3% of its anchor,
   * which is a progress bar that does not visibly move for a whole first session. A quarter is what
   * keeps the opening, which is a great many very short builds, worth playing.
   */
  it('never pays less than the floor, however trivial the clock', () => {
    for (const seconds of [0, 1, 20, 60]) {
      expect(xpForClock('buildingConstructed', seconds)).toBe(
        Math.round(PLAYER_XP_AWARDS.buildingConstructed * MIN_EFFORT_SHARE),
      );
    }
  });

  it('grows sub-linearly, so a long job is the bigger payout and the worse rate', () => {
    const shortMinutes = 15;
    const longMinutes = 15 * 20;
    const short = xpForClock('missionCompleted', shortMinutes * 60);
    const long = xpForClock('missionCompleted', longMinutes * 60);
    expect(long).toBeGreaterThan(short);
    expect(long / short).toBeLessThan(longMinutes / shortMinutes);
    expect(long / longMinutes).toBeLessThan(short / shortMinutes);
  });

  /**
   * One curve, not two. `missions.ts` used to declare its own copy of the exponent and the
   * baseline, which is how the two drifted apart in the first place.
   */
  it('is the same curve the mission board pays on', () => {
    for (const minutes of [1, 15, 30, 120, 1440]) {
      expect(rewardScale(minutes, 'standard')).toBeCloseTo(effortScale(minutes), 10);
    }
  });
});
