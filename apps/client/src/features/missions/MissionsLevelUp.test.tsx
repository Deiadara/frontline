import type { LevelUp, MissionsResponse } from '@frontline/shared';
import { playerLevelGrants } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useMissions = vi.hoisted(() => vi.fn());
const launchMutate = vi.hoisted(() => vi.fn());
vi.mock('../../lib/queries', () => ({
  useMissions,
  useCrew: () => ({ data: undefined }),
  // §C3: the send dialog reads the yard off the session snapshot. Empty is a crew with no Garage.
  useMe: () => ({ data: undefined }),
  useLaunchMission: () => ({ mutate: launchMutate, isPending: false, variables: undefined }),
}));

const { MissionsPage } = await import('./MissionsPage');

const NOW = '2026-08-13T12:00:00.000Z';

function board(levelUp?: LevelUp): { data: MissionsResponse; dataUpdatedAt: number } {
  return {
    data: {
      missions: [],
      justResolved: [],
      areas: [],
      army: {},
      resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
      activeLimit: 3,
      serverNow: NOW,
      ...(levelUp ? { levelUp } : {}),
    },
    dataUpdatedAt: Date.parse(NOW),
  };
}

const crossed: LevelUp = { level: 4, levelsGained: 1, grants: playerLevelGrants(4), unlocks: [] };

beforeEach(() => {
  useMissions.mockReset();
  launchMutate.mockReset();
});

/**
 * MOU-227 §7: the server reports a level-up on the settling response *only*. The page polls every
 * few seconds, so anything read straight off `data` would flash for one interval and disappear
 * before the player looked up. These pin the latch.
 */
describe('MissionsPage latches the level-up a returning crew paid for', () => {
  it('announces it on the poll that settled the crew', () => {
    useMissions.mockReturnValue(board(crossed));

    render(<MissionsPage />);

    expect(screen.getByRole('region', { name: 'Level up' })).toHaveTextContent('LEVEL 4');
  });

  it('keeps it on screen once the next poll stops reporting it', () => {
    useMissions.mockReturnValue(board(crossed));
    const { rerender } = render(<MissionsPage />);

    // The very next poll carries no level-up, because the settle already happened.
    useMissions.mockReturnValue(board());
    rerender(<MissionsPage />);

    expect(screen.getByRole('region', { name: 'Level up' })).toHaveTextContent('LEVEL 4');
  });

  it('says nothing when no poll has reported one', () => {
    useMissions.mockReturnValue(board());

    render(<MissionsPage />);

    expect(screen.queryByRole('region', { name: 'Level up' })).toBeNull();
  });
});
