import type { ScheduledBattle } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import type { Repositories } from '../db/repos/index.js';
import { sideFought } from './deploy.js';

/**
 * The side a crew fought on, for a fight that is over (bug pass, 2026-10-02).
 *
 * The crew file counted won and lost through `sideOf`, which asks about today's faction first. An
 * ally that helped a friend and later left the faction dropped out of its own fight, and its "Fights
 * won" went down a week after the fight. The rows are the record: the mark already moved each one
 * to the side its crew stood on. The repos here have no faction table at all, so any read of
 * today's alignment throws.
 */

const battle: ScheduledBattle = {
  id: 'b1',
  target: { kind: 'location', districtId: 'kettle-row', locationId: 'loc-1' },
  attackerBaseId: 'caller',
  defender: { kind: 'unoccupied' },
  scheduledFor: '2026-10-01T12:00:00.000Z',
  declaredAt: '2026-10-01T11:00:00.000Z',
  resolvedAt: '2026-10-01T12:00:00.000Z',
  seed: 'seed',
  holdAfterCapture: true,
  wokeSleepers: false,
};

const rows = { attacker: ['helper'], defender: ['guard'] };
const repos = {
  sieges: {
    side: (_battleId: string, side: 'attacker' | 'defender') =>
      rows[side].map((baseId) => ({ baseId })),
  },
} as unknown as Repositories;

describe('the side a crew fought on, once the fight is over', () => {
  it('reads the rows, not the faction the crew is in today', () => {
    expect(sideFought(repos, battle, 'caller')).toBe('attacker');
    expect(sideFought(repos, battle, 'helper')).toBe('attacker');
    expect(sideFought(repos, battle, 'guard')).toBe('defender');
    expect(sideFought(repos, battle, 'nobody')).toBeNull();
  });
});
