import { describe, expect, it } from 'vitest';
import {
  FACTION_RANKS,
  MAX_FACTION_MEMBERS,
  canAdminister,
  canEditDescription,
  canEditIdentity,
  canInvite,
  canKick,
  canSetRank,
  factionHasRoom,
  leavingDisbands,
  sameFactionName,
  type FactionRank,
} from './factions.js';

/**
 * The rank table, asserted as a table.
 *
 * Written out in full rather than as a loop over the permission functions, because a loop that
 * derives what it expects from the thing it is testing agrees with any implementation, including a
 * wrong one. Every cell below was read off the board's spec and typed in by hand: leader does
 * everything, a chief invites and removes *members* and keeps the description, a member sees
 * everything and fights.
 */
describe('what each rank carries', () => {
  const ranks: readonly FactionRank[] = FACTION_RANKS;

  it('has exactly the three ranks the game talks about', () => {
    expect(ranks).toEqual(['leader', 'chief', 'member']);
  });

  it.each([
    ['leader', true],
    ['chief', true],
    ['member', false],
  ] as const)('%s invites: %s', (rank, allowed) => {
    expect(canInvite(rank)).toBe(allowed);
  });

  it.each([
    ['leader', true],
    ['chief', true],
    ['member', false],
  ] as const)('%s rewrites the description: %s', (rank, allowed) => {
    expect(canEditDescription(rank)).toBe(allowed);
  });

  /** The line between a chief and the leader: identity is the leader's alone. */
  it.each([
    ['leader', true],
    ['chief', false],
    ['member', false],
  ] as const)('%s renames and re-badges: %s', (rank, allowed) => {
    expect(canEditIdentity(rank)).toBe(allowed);
  });

  it.each([
    ['leader', true],
    ['chief', false],
    ['member', false],
  ] as const)('%s promotes and demotes: %s', (rank, allowed) => {
    expect(canSetRank(rank)).toBe(allowed);
    expect(canAdminister(rank)).toBe(allowed);
  });
});

/**
 * Removing somebody takes two ranks, and the interesting cell is chief-on-chief.
 *
 * That one is the reason this is a matrix rather than a predicate on the actor: a chief who could
 * remove another chief turns a disagreement into a race, and both of them can see the button.
 */
describe('who can remove whom', () => {
  const cases: ReadonlyArray<[FactionRank, FactionRank, boolean]> = [
    ['leader', 'chief', true],
    ['leader', 'member', true],
    ['leader', 'leader', false],
    ['chief', 'member', true],
    ['chief', 'chief', false],
    ['chief', 'leader', false],
    ['member', 'member', false],
    ['member', 'chief', false],
    ['member', 'leader', false],
  ];

  it.each(cases)('a %s removing a %s: %s', (actor, target, allowed) => {
    expect(canKick(actor, target)).toBe(allowed);
  });

  it('lets nobody at all remove the leader', () => {
    for (const actor of FACTION_RANKS) expect(canKick(actor, 'leader')).toBe(false);
  });
});

/**
 * §J: leaving, and what it takes with it.
 *
 * The board's rule: a leader walking out disbands the faction, unless they handed it over first,
 * and the last person out disbands it whatever their rank. The handover case is covered by the
 * rank the caller *holds at that moment*, which is what makes "hand over, then leave" work without
 * a second flag: after the handover they are a chief, and a chief leaving is just a chief leaving.
 */
describe('leaving', () => {
  it('takes the faction with it when the leader goes', () => {
    expect(leavingDisbands('leader', 4)).toBe(true);
    expect(leavingDisbands('leader', 2)).toBe(true);
  });

  it('is an ordinary departure for anybody else while somebody is left', () => {
    expect(leavingDisbands('chief', 3)).toBe(false);
    expect(leavingDisbands('member', 2)).toBe(false);
  });

  it('disbands whatever the rank once the leaver is the only one there', () => {
    for (const rank of FACTION_RANKS) expect(leavingDisbands(rank, 1)).toBe(true);
  });

  /** The handover path, as the route performs it: rank first, then the same question again. */
  it('stops disbanding once the leader has handed it on', () => {
    expect(leavingDisbands('leader', 3)).toBe(true);
    expect(leavingDisbands('chief', 3)).toBe(false);
  });
});

describe('the table itself', () => {
  it('seats five', () => {
    expect(MAX_FACTION_MEMBERS).toBe(5);
    expect(factionHasRoom(MAX_FACTION_MEMBERS - 1)).toBe(true);
    expect(factionHasRoom(MAX_FACTION_MEMBERS)).toBe(false);
  });

  it('reads two names as one when they paint the same pixels', () => {
    expect(sameFactionName('The  Ninth   Circle', 'the ninth circle')).toBe(true);
    expect(sameFactionName('Ninth Circle', 'Ninth Circles')).toBe(false);
  });
});
