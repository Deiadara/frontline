import {
  applyHoldBonus,
  describeHoldBonus,
  noTerritoryEffects,
  type HoldBonus,
  type TerritoryEffects,
} from '../city/locations.js';
import { MAX_NOTORIETY, NOTORIETY_TIERS, type NotorietyTier } from './notoriety.js';

/**
 * What a rank is worth in a fight (§D7, maintainer 2026-09-16).
 *
 * Notoriety was a gate and nothing else, and it ran out of things to gate at rank 5: every unit
 * tier is fieldable there (`NOTORIETY_TO_FIELD`) and the Bar's hardest recruit asks for five
 * (`RECRUIT_MAX_MIN_NOTORIETY`). So the eight ranks above it, which cost a cumulative 239 million
 * infamy between them, bought a different word on a chip and nothing else. A ladder whose top half
 * changes no number is a ladder nobody climbs.
 *
 * Every rank pays something now, and what it pays is the fiction stated as arithmetic: a crew the
 * city is frightened of hits harder, holds longer and is *believed*. Intimidation is the spine of
 * it, because intimidation is the one stat that is literally "how much your name is worth in the
 * room": `cow` spends a side's menace against the other's nerve before a shot is fired, so a rank
 * bought at the Nightmare end silences part of the enemy line by arriving.
 *
 * ## Why these are `HoldBonus` values
 *
 * Because the game already has a fold for them. `applyHoldBonus` is what a held location pays
 * through, `describeHoldBonus` is how a screen says it in words, and every channel below is one an
 * engine already reads. Inventing a second grant vocabulary would mean a second fold, a second set
 * of labels and a second place for a channel with no consumer to hide, which is the failure this
 * codebase has now found six times.
 *
 * ## The shape of the ladder
 *
 * It **widens** rather than steepening. The early ranks buy the cheap tiers, which is what a small
 * crew is actually fielding; the late ones buy the tiers that cost a fortune to put on the ground,
 * so the reward arrives when there is something to spend it on. Read down the table and the crew
 * grows from "rabble who are not afraid" to "a name that wins part of the fight before it starts".
 *
 * Nothing here touches production, research or money. A rank is a reputation, and a reputation is
 * worth something when somebody is pointing a gun at you; a crew that buys one and expects a
 * cheaper Greenhouse has bought the wrong thing.
 */
export const NOTORIETY_GRANTS: Readonly<Record<NotorietyTier, readonly HoldBonus[]>> = {
  /** Where everybody starts. Nobody has heard of you, so nothing is afraid of you. */
  Nobody: [],

  /** Somebody has heard the name once. The people who came with you stand a little straighter. */
  Unknown: [{ kind: 'unit_morale', flat: 2 }],

  /** Enough of a reputation that the street reads it off your people before they speak. */
  'Ill-Reputed': [{ kind: 'intimidation', flat: 3 }],

  /** The cheap tiers are the ones a crew this size fields, so this is where they get better. */
  'Back-Alley Rumored': [{ kind: 'unit_tier', tier: 'rabble', stat: 'offense', percent: 6 }],

  /** A name worth keeping quiet about: the first rank that buys the trade tiers anything. */
  Whispered: [
    { kind: 'intimidation', flat: 3 },
    { kind: 'unit_tier', tier: 'specialist', stat: 'offense', percent: 6 },
  ],

  /**
   * Marked is the old ceiling: every unit tier is fieldable here and every recruit will sit down.
   * From here up the ladder used to be decoration, so this is where the numbers start to bite.
   */
  Marked: [
    { kind: 'unit_tier', tier: 'rabble', stat: 'vitality', percent: 8 },
    { kind: 'unit_tier', tier: 'specialist', stat: 'vitality', percent: 8 },
  ],

  /** Known Trouble: the heavies are worth fielding, so the heavies are what this pays. */
  'Known Trouble': [
    { kind: 'intimidation', flat: 4 },
    { kind: 'unit_tier', tier: 'heavy', stat: 'armor', percent: 8 },
  ],

  /** A Bad Omen is a thing people plan around. The line holds because of who it belongs to. */
  'Bad Omen': [
    { kind: 'unit_morale', flat: 4 },
    { kind: 'unit_tier', tier: 'heavy', stat: 'offense', percent: 8 },
  ],

  /** Feared: the first rank where the name is doing real work before contact. */
  Feared: [
    { kind: 'intimidation', flat: 6 },
    { kind: 'unit_tier', tier: 'wonder', stat: 'offense', percent: 10 },
  ],

  /** Dreaded: what you hold is harder to take off you, because of what taking it would mean. */
  Dreaded: [
    { kind: 'defense_percent', percent: 8 },
    { kind: 'unit_tier', tier: 'wonder', stat: 'vitality', percent: 10 },
  ],

  /** A Street Devil moves like one: quiet, quick, and gone before the story is straight. */
  'Street Devil': [
    { kind: 'unit_speed', percent: 6 },
    { kind: 'unit_stealth', percent: 10 },
    { kind: 'intimidation', flat: 6 },
  ],

  /** A Scourge takes more away, because nobody argues about what is theirs. */
  Scourge: [
    { kind: 'loot_capacity', percent: 12 },
    { kind: 'unit_tier', tier: 'legendary', stat: 'offense', percent: 12 },
  ],

  /** Nightmare: the legends fight like legends, and the street tells the story for you. */
  Nightmare: [
    { kind: 'intimidation', flat: 8 },
    { kind: 'unit_tier', tier: 'legendary', stat: 'vitality', percent: 12 },
    { kind: 'infamy_gain', percent: 10 },
  ],

  /**
   * Nameless is the top of the ladder and the joke it is built around: the city has stopped using
   * a word for you. It pays the widest thing there is, on everything, plus the menace to match.
   */
  Nameless: [
    { kind: 'unit_offense', percent: 10 },
    { kind: 'intimidation', flat: 10 },
  ],
};

/** The grant one rank adds, on its own. Empty for a rank out of range or for `Nobody`. */
export function notorietyGrant(rank: number): readonly HoldBonus[] {
  const tier = NOTORIETY_TIERS[Math.max(0, Math.min(MAX_NOTORIETY, Math.trunc(rank)))];
  return tier === undefined ? [] : NOTORIETY_GRANTS[tier];
}

/**
 * Everything a crew's rank is worth, **cumulative**.
 *
 * Buying rank 9 does not replace rank 8: a reputation is a thing you keep, and `notoriety` is the
 * one number in the economy that never falls (see `notoriety.ts`). So this sums every rung up to
 * and including the one held, which is also what makes the ladder readable on a screen: each rung
 * says what it adds, and the crew carries the total.
 */
export function notorietyEffects(rank: number): TerritoryEffects {
  const total = noTerritoryEffects();
  const held = Math.max(0, Math.min(MAX_NOTORIETY, Math.trunc(rank)));
  for (let at = 0; at <= held; at += 1) {
    for (const bonus of notorietyGrant(at)) applyHoldBonus(total, bonus);
  }
  return total;
}

/** One rank's grant in words, for the chip that sells the next rung. */
export function describeNotorietyGrant(rank: number): string[] {
  return notorietyGrant(rank).map(describeHoldBonus);
}
