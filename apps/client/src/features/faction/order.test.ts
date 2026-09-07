import type { AllyBattle, FactionMember, FactionRank } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { fightOrder, seatOrder } from './order';

/**
 * Both comparators sort things a player reads top-down, and both look right when they run backwards:
 * a roster with the newest member at its head, or a fights strip with the fight nobody can join any
 * more in front of the one starting in ten minutes, draws exactly as tidily as the correct order.
 */

const member = (username: string, rank: FactionRank, armySize: number): FactionMember => ({
  userId: `user-${username}`,
  baseId: `base-${username}`,
  username,
  districtName: `${username}'s district`,
  districtId: 'ashen-terraces',
  rank,
  joinedAt: '2026-08-01T00:00:00.000Z',
  level: 5,
  infamy: 100,
  infamyEarned: 100,
  armySize,
  supplyUsed: 10,
  isBot: false,
  card: 'joker',
  cardMark: 'F',
});

const fight = (battleId: string, scheduledFor: string, canReinforce: boolean): AllyBattle => ({
  battleId,
  memberUserId: 'user-ally',
  memberName: 'Ally',
  districtName: 'Theirs',
  targetName: 'A market',
  districtLabel: 'neon-docks',
  scheduledFor,
  side: 'attacker',
  committed: 4,
  yourContribution: 0,
  canReinforce,
});

describe('the order the table is read in', () => {
  it('puts the leader at the head of it, then the chiefs', () => {
    const seats = seatOrder([
      member('Marrow', 'member', 90),
      member('Sable', 'chief', 10),
      member('Nikos', 'leader', 1),
    ]);
    expect(seats.map((seat) => seat.username)).toEqual(['Nikos', 'Sable', 'Marrow']);
  });

  it('puts whoever can field the most first inside a rank', () => {
    const seats = seatOrder([
      member('Small', 'member', 3),
      member('Big', 'member', 300),
      member('Middle', 'member', 30),
    ]);
    expect(seats.map((seat) => seat.username)).toEqual(['Big', 'Middle', 'Small']);
  });

  it('breaks a tie by name, so an unchanged faction does not reshuffle between reads', () => {
    const two = [member('Zed', 'member', 12), member('Abel', 'member', 12)];
    expect(seatOrder(two).map((seat) => seat.username)).toEqual(['Abel', 'Zed']);
    expect(seatOrder([...two].reverse()).map((seat) => seat.username)).toEqual(['Abel', 'Zed']);
  });

  it('leaves the payload alone', () => {
    const given = [member('B', 'member', 1), member('A', 'leader', 1)];
    seatOrder(given);
    expect(given.map((seat) => seat.username)).toEqual(['B', 'A']);
  });
});

describe('the order the fights are read in', () => {
  it('puts the ones still open in front of the ones that have run', () => {
    const strip = fightOrder([
      fight('done', '2026-08-13T01:00:00.000Z', false),
      fight('open', '2026-08-14T09:00:00.000Z', true),
    ]);
    expect(strip.map((entry) => entry.battleId)).toEqual(['open', 'done']);
  });

  it('puts the soonest mark first inside each group', () => {
    const strip = fightOrder([
      fight('later', '2026-08-14T09:00:00.000Z', true),
      fight('spent-late', '2026-08-13T08:00:00.000Z', false),
      fight('soon', '2026-08-14T03:30:00.000Z', true),
      fight('spent-early', '2026-08-13T02:00:00.000Z', false),
    ]);
    expect(strip.map((entry) => entry.battleId)).toEqual([
      'soon',
      'later',
      'spent-early',
      'spent-late',
    ]);
  });
});
