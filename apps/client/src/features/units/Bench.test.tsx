import type { TrainingOrder, UnitsResponse } from '@frontline/shared';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUnits = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
vi.mock('../../lib/queries', () => ({
  useUnits,
  useMe: () => ({ data: { base: { id: 'base-1' } } }),
  useTrainUnits: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelTraining: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { UnitsPage } = await import('./UnitsPage');

/*
 * The clock the page reads. Pinned rather than live so "fourteen seconds into the first order" is
 * a fact about the fixture instead of a race with the test runner.
 */
const NOW = '2026-08-13T12:00:00.000Z';
vi.mock('../missions/useServerClock', () => ({ useServerClock: () => new Date(NOW) }));

/** One order on the bench, `startedAt` given as seconds before `NOW`. */
function order(id: string, unitId: string, secondsAgo: number, seconds: number): TrainingOrder {
  return {
    id,
    unitId,
    count: 1,
    delivered: 0,
    startedAt: new Date(Date.parse(NOW) - secondsAgo * 1000).toISOString(),
    durationSeconds: seconds,
    paid: { caps: 0 },
  };
}

function bench(queue: TrainingOrder[]): {
  data: UnitsResponse;
  dataUpdatedAt: number;
  refetch: () => void;
} {
  return {
    data: {
      serverNow: NOW,
      units: [],
      army: {},
      garrisoned: {},
      abroad: {},
      supplyUsed: 0,
      supplyCap: 100,
      queue,
      resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
      trainingCostReduction: 0,
      trainingSpeedBonus: 0,
      built: [],
    },
    dataUpdatedAt: Date.parse(NOW),
    refetch,
  };
}

beforeEach(() => {
  useUnits.mockReset();
  refetch.mockReset();
});

/**
 * The bench is a queue, and a queue runs one at a time.
 *
 * The roster only re-reads every poll interval, so between reads `data.queue` still carries an
 * order that has already handed its last body over. Rendering that snapshot straight out drew the
 * finished order at `1/1  0s` with a full bar *above* the one that had started behind it, so two
 * batches appeared to be training at once. Deriving the display through `splitDueTraining`, which
 * is what the server settles with, is what makes the two agree.
 */
describe('the training bench', () => {
  it('drops an order that has already finished, leaving only the one still running', () => {
    // First order: a 10s batch started 14s ago, so it is done and gone.
    // Second: a 20s batch that started when the first finished, 4s in and still going.
    useUnits.mockReturnValue(
      bench([order('done', 'sparks', 14, 10), order('running', 'razors', 4, 20)]),
    );

    render(<UnitsPage />);
    const rows = within(screen.getByTestId('training-queue')).getAllByRole('listitem');
    expect(rows, 'a finished order is still on the bench').toHaveLength(1);
    expect(rows[0]).toHaveTextContent(/razors/i);
    expect(screen.getByTestId('training-queue')).not.toHaveTextContent(/sparks/i);
  });

  it('re-reads the roster when somebody walks off the bench, so the army count catches up', () => {
    useUnits.mockReturnValue(bench([order('done', 'sparks', 14, 10)]));
    render(<UnitsPage />);
    expect(refetch).toHaveBeenCalled();
  });

  it('leaves a bench where nothing has finished exactly as it is', () => {
    useUnits.mockReturnValue(
      bench([order('first', 'sparks', 4, 20), order('second', 'razors', 0, 20)]),
    );
    render(<UnitsPage />);
    expect(within(screen.getByTestId('training-queue')).getAllByRole('listitem')).toHaveLength(2);
    expect(refetch, 'nothing settled, so nothing to re-read').not.toHaveBeenCalled();
  });
});
