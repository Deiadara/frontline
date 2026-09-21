import { describe, expect, it } from 'vitest';
import {
  battleFeatsEarned,
  LOPSIDED_AT,
  OUTNUMBERED_AT,
  OVERWHELMED_AT,
  type BattleFeatFacts,
} from './battle.js';

/**
 * The four counters that ask what a fight *looked like*, held to the sentences the board sells.
 *
 * Every assertion below is written against a promise a blurb makes, because the blurb is the
 * contract: `odds_1` says "the line facing you was twice the size of your own", so a win at 1.9
 * times has to pay nothing and a win at exactly twice has to pay. A boundary that drifts one unit
 * slot either way is a feat that pays out for something the player was not told about, and no
 * other test in the tree can see it.
 */

const fight = (over: Partial<BattleFeatFacts> = {}): BattleFeatFacts => ({
  won: true,
  ownForce: 100,
  enemyForce: 100,
  killed: 1,
  lost: 1,
  // No Netrunners in the default fixture, no cell planted and nobody making a racket: each is
  // its own counter, and every other case here would earn them by accident.
  jam: 0,
  planted: false,
  loud: false,
  ...over,
});

describe('what a fight was worth telling somebody about', () => {
  it('pays nothing at all for a fight that was lost, however well it went', () => {
    // Every one of the four would otherwise fire on this: four to one against, nobody lost, and a
    // hundred of theirs dead.
    expect(
      battleFeatsEarned(
        fight({ won: false, ownForce: 100, enemyForce: 400, killed: 100, lost: 0 }),
      ),
    ).toEqual([]);
  });

  it('pays nothing for an ordinary win', () => {
    expect(battleFeatsEarned(fight())).toEqual([]);
  });

  describe('against the odds', () => {
    it('takes exactly the ratio the blurb promises, and not a slot less', () => {
      const own = 100;
      expect(battleFeatsEarned(fight({ ownForce: own, enemyForce: own * OUTNUMBERED_AT }))).toEqual(
        ['battles_won_outnumbered'],
      );
      expect(
        battleFeatsEarned(fight({ ownForce: own, enemyForce: own * OUTNUMBERED_AT - 1 })),
      ).toEqual([]);
    });

    it('counts a win at the harder ratio as both, the way a win is also a fight', () => {
      expect(battleFeatsEarned(fight({ ownForce: 100, enemyForce: 100 * OVERWHELMED_AT }))).toEqual(
        ['battles_won_outnumbered', 'battles_won_overwhelmed'],
      );
    });

    it('refuses a walkover onto empty ground, where the ratio is meaningless', () => {
      // Nobody standing there at all. Left unguarded this reads as infinitely outnumbered, and the
      // ladder becomes a measure of how much of the map is unoccupied.
      expect(battleFeatsEarned(fight({ ownForce: 0, enemyForce: 400 }))).toEqual([]);
      expect(
        battleFeatsEarned(fight({ ownForce: 100, enemyForce: 0, killed: 0, lost: 1 })),
      ).toEqual([]);
    });
  });

  describe('everybody home', () => {
    it('pays for a win with no casualties against a line that was really there', () => {
      expect(battleFeatsEarned(fight({ killed: 1, lost: 0 }))).toEqual(['battles_won_flawless']);
    });

    it('does not pay for walking onto an empty lot', () => {
      expect(battleFeatsEarned(fight({ enemyForce: 0, killed: 0, lost: 0 }))).toEqual([]);
    });

    it('stops the moment one unit is lost', () => {
      expect(battleFeatsEarned(fight({ killed: 1, lost: 1 }))).toEqual([]);
    });
  });

  describe('a rout', () => {
    it('wants the ratio and the floor, so a skirmish does not count as one', () => {
      // One of theirs for none of ours is an infinite ratio and is a scuffle. The floor is what
      // makes this feat about a fight rather than about arithmetic.
      expect(battleFeatsEarned(fight({ killed: LOPSIDED_AT - 1, lost: 0 }))).toEqual([
        'battles_won_flawless',
      ]);
      expect(battleFeatsEarned(fight({ killed: LOPSIDED_AT, lost: 0 }))).toEqual([
        'battles_won_flawless',
        'battles_won_lopsided',
      ]);
    });

    it('takes exactly ten of theirs for one of yours', () => {
      expect(battleFeatsEarned(fight({ killed: 10 * LOPSIDED_AT, lost: 10 }))).toEqual([
        'battles_won_lopsided',
      ]);
      expect(battleFeatsEarned(fight({ killed: 10 * LOPSIDED_AT - 1, lost: 10 }))).toEqual([]);
    });
  });

  it('can pay all four for the one fight that deserves it', () => {
    expect(
      battleFeatsEarned({
        won: true,
        ownForce: 100,
        enemyForce: 100 * OVERWHELMED_AT,
        killed: 400,
        lost: 0,
        jam: 0,
        planted: false,
        loud: false,
      }),
    ).toEqual([
      'battles_won_outnumbered',
      'battles_won_overwhelmed',
      'battles_won_flawless',
      'battles_won_lopsided',
    ]);
  });
});
