import type { Mission } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { recentlyReturned } from './MissionsPage';

/** A returned crew, identified by when it launched and when it came home. */
const returned = (id: string, startedAt: string, resolvedAt: string): Mission => ({
  id,
  baseId: 'base-1',
  templateId: 'scrap-run',
  startedAt,
  travelMinutes: 5,
  durationMinutes: 3,
  officerId: null,
  status: 'resolved',
  outcome: 'success',
  rewards: { scrap: 40 },
  resolvedAt,
});

const inFlight = (id: string, startedAt: string): Mission => ({
  ...returned(id, startedAt, startedAt),
  status: 'active',
  outcome: null,
  rewards: {},
  resolvedAt: null,
});

/** The board as the server hands it back: newest launch first. */
const byLaunchDesc = (missions: Mission[]) =>
  [...missions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

describe('recentlyReturned', () => {
  it('orders by return time, not launch time', () => {
    // The 26h expedition launched first and came home last; four short runs launched after it and
    // were already back. Ordered by launch, the expedition sorts below every one of them.
    const expedition = returned('deep', '2026-08-12T08:00:00.000Z', '2026-08-13T10:00:00.000Z');
    const shortRuns = [1, 2, 3, 4].map((n) =>
      returned(`short-${n}`, `2026-08-13T0${n}:00:00.000Z`, `2026-08-13T0${n}:30:00.000Z`),
    );

    expect(recentlyReturned(byLaunchDesc([expedition, ...shortRuns]))[0]).toBe(expedition);
  });

  it('keeps a long run on a full list instead of dropping it off the end', () => {
    const expedition = returned('deep', '2026-08-12T08:00:00.000Z', '2026-08-13T10:00:00.000Z');
    // More short runs than the list holds, every one of them launched after the expedition.
    const shortRuns = Array.from({ length: 9 }, (_, n) =>
      returned(
        `short-${n}`,
        `2026-08-13T09:${String(n).padStart(2, '0')}:00.000Z`,
        `2026-08-13T09:${String(n).padStart(2, '0')}:30.000Z`,
      ),
    );

    const list = recentlyReturned(byLaunchDesc([expedition, ...shortRuns]));
    expect(list).toHaveLength(6);
    expect(list.map((mission) => mission.id)).toContain('deep');
  });

  it('leaves crews that are still out off the list', () => {
    const list = recentlyReturned([
      inFlight('out', '2026-08-13T09:00:00.000Z'),
      returned('home', '2026-08-13T08:00:00.000Z', '2026-08-13T08:30:00.000Z'),
    ]);
    expect(list.map((mission) => mission.id)).toEqual(['home']);
  });

  it('falls back to launch order for a batch that settled on the same read', () => {
    // One `resolveDueMissions` call stamps every mission it banks with the same `resolvedAt`.
    const at = '2026-08-13T10:00:00.000Z';
    const list = recentlyReturned([
      returned('later-launch', '2026-08-13T09:30:00.000Z', at),
      returned('earlier-launch', '2026-08-13T09:00:00.000Z', at),
    ]);
    expect(list.map((mission) => mission.id)).toEqual(['later-launch', 'earlier-launch']);
  });
});
