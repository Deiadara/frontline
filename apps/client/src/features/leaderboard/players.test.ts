import type { PlayerStanding } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { leaderboardPlayers } from '../../../e2e/fixtures';
import { filterPlayers, matchScore, sortPlayers, suggestPlayers } from './players';

/**
 * The two controls the maintainer asked the standings for, tested where they actually live.
 *
 * The fixture is the one the e2e suite draws, so a row added to the board is a row these
 * assertions are made against rather than a second hand-typed table that agrees with nothing.
 */

const ENTRIES = leaderboardPlayers.board === 'players' ? leaderboardPlayers.entries : [];
if (ENTRIES.length < 4) throw new Error('the standings fixture needs four rows');

const names = (rows: readonly PlayerStanding[]) => rows.map((row) => row.username);

describe('sorting the players board', () => {
  it('leaves the server order alone on the default', () => {
    expect(names(sortPlayers(ENTRIES, 'standing'))).toEqual(names(ENTRIES));
  });

  it('puts the highest level first', () => {
    const levels = sortPlayers(ENTRIES, 'level').map((row) => row.level);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
    expect(levels[0]).toBe(Math.max(...ENTRIES.map((row) => row.level)));
  });

  /**
   * The whole point of the second choice: the wallet and the lifetime total disagree, and they
   * disagree in the fixture. Vex holds more infamy than Nikos and has earned less of it.
   */
  it('ranks on the lifetime total rather than on the wallet', () => {
    const wallet = names(sortPlayers(ENTRIES, 'standing'));
    const total = names(sortPlayers(ENTRIES, 'total'));
    expect(total).not.toEqual(wallet);
    const totals = sortPlayers(ENTRIES, 'total').map((row) => row.totalInfamy);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it('keeps equal rows in the order the board ranked them', () => {
    const tied = sortPlayers(ENTRIES, 'level').filter((row) => row.level === 9);
    expect(names(tied)).toEqual(names(ENTRIES.filter((row) => row.level === 9)));
  });

  it('does not reorder the caller array', () => {
    const before = names(ENTRIES);
    sortPlayers(ENTRIES, 'total');
    expect(names(ENTRIES)).toEqual(before);
  });
});

describe('matching a name', () => {
  it('is case insensitive', () => {
    expect(matchScore('Sable_Ninth', 'SABLE')).not.toBeNull();
    expect(matchScore('Sable_Ninth', 'sable')).not.toBeNull();
  });

  it('scores the front of a name above the front of a word above the middle', () => {
    const front = matchScore('Ninth_Wall', 'nin');
    const word = matchScore('Sable_Ninth', 'nin');
    const middle = matchScore('Grinning', 'nin');
    expect(front).toBeLessThan(word!);
    expect(word).toBeLessThan(middle!);
  });

  it('forgives the punctuation between words', () => {
    expect(matchScore('Sable_Ninth', 'sableninth')).not.toBeNull();
    expect(matchScore('Sable_Ninth', 'sable ninth')).not.toBeNull();
  });

  it('says no to a name that does not answer at all', () => {
    expect(matchScore('Marrow', 'zzz')).toBeNull();
  });
});

describe('the suggestions under the field', () => {
  it('offers nothing until something has been typed', () => {
    expect(suggestPlayers(ENTRIES, '')).toEqual([]);
    expect(suggestPlayers(ENTRIES, '   ')).toEqual([]);
  });

  /** `Nikos` starts with it; `Sable_Ninth` only has a word that does. The prefix has to win. */
  it('recommends the best match first, not the highest row', () => {
    const found = names(suggestPlayers(ENTRIES, 'ni'));
    expect(found).toContain('Nikos');
    expect(found).toContain('Sable_Ninth');
    expect(found.indexOf('Nikos')).toBeLessThan(found.indexOf('Sable_Ninth'));
  });

  it('keeps the list short', () => {
    expect(suggestPlayers(ENTRIES, 'a', 2).length).toBeLessThanOrEqual(2);
  });
});

describe('filtering the table', () => {
  it('keeps every row while the field is empty', () => {
    expect(filterPlayers(ENTRIES, '')).toHaveLength(ENTRIES.length);
  });

  it('keeps only the rows that answer', () => {
    expect(names(filterPlayers(ENTRIES, 'marrow'))).toEqual(['Marrow']);
  });

  it('keeps the order it was handed, not the match order', () => {
    const sorted = sortPlayers(ENTRIES, 'level');
    expect(names(filterPlayers(sorted, 'n'))).toEqual(
      names(sorted).filter((name) => name.toLowerCase().includes('n')),
    );
  });
});
