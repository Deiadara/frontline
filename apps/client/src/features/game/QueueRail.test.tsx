import { missionCompletesAt, type MissionsResponse } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';

/**
 * Both halves of the rail's clock come from the same response.
 *
 * `useServerClock(serverNow, receivedAt)` returns `Date.now() + (serverNow - receivedAt)`, which is
 * a correction only while the two describe **one** answer. The rail paired the missions payload's
 * `serverNow` with the `/me` query's `dataUpdatedAt`, and those poll at 15s and 5s: fifteen seconds
 * after a missions poll the offset was -15s and every countdown read fifteen seconds long, then the
 * next missions poll swung it to +5s and every countdown jumped forward twenty. The rail's whole
 * job is saying what is in flight.
 *
 * Driven through the rendered countdown rather than by asserting the hook's arguments, so it is the
 * number a player reads that is pinned.
 */

/** The wall clock. The missions response arrived 15s ago; `/me` polled just now. */
const REAL_NOW = Date.parse('2026-08-26T12:00:00.000Z');
const MISSIONS_ARRIVED = REAL_NOW - 15_000;

const useMe = vi.hoisted(() => vi.fn());
const useMissions = vi.hoisted(() => vi.fn());
vi.mock('../../lib/queries', () => ({
  useMe,
  useMissions,
  useResearch: () => ({ data: undefined }),
  useRecallMission: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const { QueueRail } = await import('./QueueRail');

/** One crew out, landing `endsIn` from the wall clock (in *server* terms, see the cases). */
function missionsAt(serverNow: number, endsIn: number): MissionsResponse {
  const board = F.missionsResponse(new Date(REAL_NOW));
  const template = board.missions.find((mission) => mission.status === 'active');
  if (!template) throw new Error('the fixture has no crew out');
  // The end is `startedAt` plus the template's own legs, so it is placed by shifting the start
  // rather than by re-deriving the duration here: one less copy of a rule the shared package owns.
  const shift = REAL_NOW + endsIn - missionCompletesAt(template).getTime();
  return {
    ...board,
    serverNow: new Date(serverNow).toISOString(),
    missions: [
      {
        ...template,
        startedAt: new Date(Date.parse(template.startedAt) + shift).toISOString(),
        recalledAt: null,
      },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(REAL_NOW);
  useMe.mockReturnValue({
    data: { ...F.me, base: { ...F.me.base, buildQueue: [], trainingQueue: [] } },
    // Polled just now, at the wall clock: the wrong half to correct the missions payload with.
    dataUpdatedAt: REAL_NOW,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the in-flight rail', () => {
  it('counts down against the response its clock came from', () => {
    // The server and this browser agree: `serverNow` is what the wall clock read when the missions
    // response arrived, so the correction is zero and a minute is a minute.
    useMissions.mockReturnValue({
      data: missionsAt(MISSIONS_ARRIVED, 60_000),
      dataUpdatedAt: MISSIONS_ARRIVED,
    });

    render(
      <MemoryRouter initialEntries={['/game/missions']}>
        <QueueRail />
      </MemoryRouter>,
    );

    // 1m 15s is what pairing this payload with `/me`'s arrival produces instead.
    expect(screen.getByTestId('queue-rail')).toHaveTextContent('1m');
    expect(screen.getByTestId('queue-rail')).not.toHaveTextContent('1m 15s');
  });

  it('still applies a real skew, so this is a correction and not a shrug', () => {
    // The server is thirty seconds ahead of this browser at the moment the response lands.
    useMissions.mockReturnValue({
      data: missionsAt(MISSIONS_ARRIVED + 30_000, 60_000),
      dataUpdatedAt: MISSIONS_ARRIVED,
    });

    render(
      <MemoryRouter initialEntries={['/game/missions']}>
        <QueueRail />
      </MemoryRouter>,
    );

    // The end is fixed in server time, so a browser thirty seconds behind has thirty seconds less.
    expect(screen.getByTestId('queue-rail')).toHaveTextContent('30s');
  });
});
