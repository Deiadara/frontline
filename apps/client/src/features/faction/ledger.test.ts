import { DEFAULT_BADGE, type FactionResponse } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { ledger } from './ledger';

/**
 * A feed derived from a payload with no feed in it.
 *
 * Two failures this pins, both of which draw a perfectly tidy list of sentences: the order running
 * backwards, so the oldest thing that happened is the first thing a player reads, and a kind of
 * entry going missing entirely, which looks like a quiet week rather than like a bug.
 */

const NOW = '2026-08-13T12:00:00.000Z';

const payload = (over: Partial<FactionResponse> = {}): FactionResponse => ({
  faction: {
    id: 'faction-1',
    name: 'The Ninth Circle',
    badge: DEFAULT_BADGE,
    blurb: '',
    infamyEarned: 100,
    foundedAt: '2026-08-01T00:00:00.000Z',
  },
  members: [],
  rank: 'leader',
  invites: [],
  pending: [],
  battles: [],
  armies: [],
  serverNow: NOW,
  ...over,
});

const member = (username: string, joinedAt: string) => ({
  userId: `user-${username}`,
  baseId: `base-${username}`,
  username,
  districtName: 'Somewhere',
  districtId: 'ashen-terraces',
  rank: 'member' as const,
  joinedAt,
  level: 5,
  infamy: 0,
  infamyEarned: 0,
  armySize: 10,
  supplyUsed: 4,
  isBot: false,
  card: 'joker' as const,
  cardMark: 'F' as const,
});

const battle = (battleId: string, scheduledFor: string, yourContribution = 0) => ({
  battleId,
  memberUserId: 'user-Sable',
  memberName: 'Sable_Ninth',
  districtName: 'Theirs',
  targetName: 'The Tideline Market',
  districtLabel: 'neon-docks',
  scheduledFor,
  side: 'attacker' as const,
  committed: 24,
  yourContribution,
  canReinforce: true,
});

describe('what the table has been up to', () => {
  it('reads newest first', () => {
    const entries = ledger(
      payload({
        members: [member('Sable_Ninth', '2026-08-05T00:00:00.000Z')],
        battles: [battle('b1', '2026-08-14T03:30:00.000Z')],
      }),
    );
    expect(entries.map((entry) => entry.at)).toEqual([
      '2026-08-14T03:30:00.000Z',
      '2026-08-05T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
    ]);
  });

  it('carries all four kinds plus the founding', () => {
    const entries = ledger(
      payload({
        members: [member('Sable_Ninth', '2026-08-05T00:00:00.000Z')],
        pending: [
          {
            id: 'invite-9',
            factionId: 'faction-1',
            factionName: 'The Ninth Circle',
            factionBadge: DEFAULT_BADGE,
            invitedBy: 'Nikos',
            invitedUserId: 'user-stranger',
            sentAt: '2026-08-12T00:00:00.000Z',
          },
        ],
        battles: [battle('b1', '2026-08-14T03:30:00.000Z', 12)],
      }),
    );
    expect(entries.map((entry) => entry.text)).toEqual([
      'Sable_Ninth called a fight at The Tideline Market',
      'You sent 12 to The Tideline Market',
      'Nikos asked somebody in, and nobody has answered',
      'Sable_Ninth came to the table',
      'The Ninth Circle was put together',
    ]);
  });

  it('leaves out help nobody sent', () => {
    const entries = ledger(payload({ battles: [battle('b1', '2026-08-14T03:30:00.000Z', 0)] }));
    expect(entries.map((entry) => entry.id)).toEqual(['fight-b1', 'founded']);
  });

  it('orders entries stamped with the same instant by what they are', () => {
    const entries = ledger(
      payload({
        members: [member('Nikos', '2026-08-01T00:00:00.000Z')],
        battles: [battle('b1', '2026-08-01T00:00:00.000Z')],
      }),
    );
    expect(entries.map((entry) => entry.id)).toEqual(['fight-b1', 'joined-user-Nikos', 'founded']);
  });

  it('says who is being come for rather than who called it, when it is not ours', () => {
    const entries = ledger(
      payload({
        battles: [{ ...battle('b1', '2026-08-14T03:30:00.000Z'), side: 'defender' }],
      }),
    );
    expect(entries[0]?.text).toBe('Sable_Ninth is being come for at The Tideline Market');
  });
});
