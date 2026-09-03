import type { TrainingOrder, UnitsResponse } from '@frontline/shared';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUnits = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
/* The two writes, as mutable state rather than a fresh literal, so a test can put a refusal on one
   of them the way react-query would. */
const train = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  error: null as Error | null,
  variables: undefined as { unitId: string; count: number } | undefined,
}));
const cancel = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  error: null as Error | null,
}));
vi.mock('../../lib/queries', () => ({
  useUnits,
  useMe: () => ({ data: { base: { id: 'base-1' } } }),
  useTrainUnits: () => train,
  useCancelTraining: () => cancel,
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
  train.error = null;
  train.variables = undefined;
  cancel.error = null;
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

/**
 * A refused write has to reach the player, and the effect that chases the bench must not loop.
 *
 * Neither `train.error` nor `cancel.error` was rendered anywhere, and the QueryClient has no
 * `MutationCache.onError`, so a refusal was swallowed at both ends: the button un-dimmed, nothing
 * on the bench or the roster moved, and no message appeared. The count field is bounded by
 * `TRAINING_MAX_BATCH` rather than by what the crew can afford (that figure only feeds the **Max**
 * button), so asking for a batch the server refuses is ordinary rather than exotic.
 */
describe('when a write is refused', () => {
  it('says why the batch was not started, against the unit that was pressed', () => {
    useUnits.mockReturnValue(bench([]));
    train.error = new Error('Not enough supplies for twenty Razors.');
    train.variables = { unitId: 'razors', count: 20 };

    render(<UnitsPage />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Razors');
    expect(alert).toHaveTextContent('Not enough supplies for twenty Razors.');
  });

  it('says why an order could not be called off', () => {
    useUnits.mockReturnValue(bench([order('running', 'razors', 4, 20)]));
    cancel.error = new Error('Too late: the first one is already out.');

    render(<UnitsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Too late: the first one is already out.');
  });
});

/**
 * The bench-chasing effect depends on `query.refetch`, not on the query object.
 *
 * react-query hands back a **new result object every render**, so `[settled, query]` never matched
 * and the body ran after every one. `settled` is derived from a clock that ticks once a second, so
 * once it flipped true this fired again on each of the refetch's own re-renders and kept firing
 * until the response shrank the bench. The other cases in this file use `mockReturnValue`, which
 * hands back one frozen object and therefore cannot see this at all: this one returns a fresh
 * object per call, which is what the real hook does.
 */
describe('re-reading a settled bench', () => {
  it('asks once however many times the page re-renders', () => {
    useUnits.mockImplementation(() => bench([order('done', 'sparks', 14, 10)]));

    const { rerender } = render(<UnitsPage />);
    rerender(<UnitsPage />);
    rerender(<UnitsPage />);

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
