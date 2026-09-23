import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';

/**
 * The Monitor's In progress page (2026-09-23), which replaced the rail of chips under the chrome.
 *
 * Two things the rail got wrong are pinned here so the page cannot get them wrong again: every
 * clock on it is read against one response's `serverNow` and that response's own arrival time,
 * and a build past its first tenth carries no X while one inside it does.
 */
const REAL_NOW = Date.parse('2026-08-26T12:00:00.000Z');

const useMe = vi.hoisted(() => vi.fn());
const useResearch = vi.hoisted(() => vi.fn());
const useTraining = vi.hoisted(() => vi.fn());
const useMissions = vi.hoisted(() => vi.fn());
const idle = () => ({ mutate: vi.fn(), isPending: false, error: null });
vi.mock('../../lib/queries', () => ({
  useMe,
  useResearch,
  useTraining,
  useMissions,
  useCrew: () => ({ data: { officers: [] } }),
  useCity: () => ({ data: { districts: [] } }),
  useDistrict: () => ({ data: undefined }),
  useCancelBuild: idle,
  useCancelTraining: idle,
  useCancelResearch: idle,
  useCancelDrill: idle,
  useCancelLocationUpgrade: idle,
  useCancelLocationFortify: idle,
}));

const { InProgressPage } = await import('./InProgressPage');

function draw(): void {
  render(
    <MemoryRouter initialEntries={['/game/actions/progress']}>
      <InProgressPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(REAL_NOW);
  useResearch.mockReturnValue({ data: { ...F.research, active: null } });
  useTraining.mockReturnValue({ data: F.trainingResponse });
  // The missions board answered fifteen seconds ago, and said so: the page's clock is that pair.
  useMissions.mockReturnValue({
    data: {
      ...F.missionsResponse(new Date(REAL_NOW)),
      serverNow: new Date(REAL_NOW - 15_000).toISOString(),
    },
    dataUpdatedAt: REAL_NOW - 15_000,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the In progress page', () => {
  it('says so when nothing is running', () => {
    useMe.mockReturnValue({
      data: {
        ...F.me,
        base: { ...F.me.base, buildQueue: [], trainingQueue: [], training: F.me.base?.training },
      },
    });
    draw();
    expect(screen.getByText('Nothing is running')).toBeVisible();
    expect(screen.queryByTestId('progress-builds')).toBeNull();
  });

  it('lists a build with a live countdown, and the X only inside its first tenth', () => {
    const base = F.me.base;
    if (!base) throw new Error('fixture has no base');
    useMe.mockReturnValue({
      data: {
        ...F.me,
        base: {
          ...base,
          trainingQueue: [],
          buildQueue: [
            {
              id: 'young',
              kind: 'quarters',
              level: 4,
              startedAt: new Date(REAL_NOW - 30_000).toISOString(),
              durationSeconds: 1200,
            },
            {
              id: 'old',
              kind: 'greenhouse',
              level: 2,
              startedAt: new Date(REAL_NOW - 600_000).toISOString(),
              durationSeconds: 1200,
            },
          ],
        },
      },
    });
    draw();
    const young = screen.getByTestId('progress-build-young');
    expect(young).toHaveTextContent('The Quarters to 4');
    // Thirty seconds into twenty minutes: nineteen and a half left, read off server time.
    expect(young).toHaveTextContent(/19m/);
    expect(screen.getByTestId('cancel-build-young')).toBeInTheDocument();
    // Ten minutes into twenty is long past the tenth: no X.
    expect(screen.getByTestId('progress-build-old')).toHaveTextContent(/10m/);
    expect(screen.queryByTestId('cancel-build-old')).toBeNull();
  });

  it('lists the bench with the batch and the delivered count', () => {
    const base = F.lateGame.base;
    if (!base) throw new Error('fixture has no base');
    useMe.mockReturnValue({
      data: {
        ...F.lateGame,
        base: {
          ...base,
          buildQueue: [],
          trainingQueue: [
            {
              ...base.trainingQueue[0]!,
              id: 'batch',
              delivered: 2,
              startedAt: new Date(REAL_NOW - 60_000).toISOString(),
            },
          ],
        },
      },
    });
    draw();
    const row = screen.getByTestId('progress-training-batch');
    expect(row).toHaveTextContent('6 × Razors');
    expect(row).toHaveTextContent('2 of 6 out');
  });
});
