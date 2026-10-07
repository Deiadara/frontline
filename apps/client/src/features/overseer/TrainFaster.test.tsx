import { type TrainingResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { TrainingPage } from './TrainingPage';
import type * as QueriesModule from '../../lib/queries';

/**
 * Officers train faster with Speed, Resolve and Organization (maintainer, 2026-10-01).
 *
 * The tab carries a hand-drawn "Train Faster" note top right, whose hover says exactly what the
 * maintainer wrote, and the drill's button quotes the person's own hour rather than the plain one.
 */
const board = vi.hoisted(() => ({ current: null as TrainingResponse | null }));

vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof QueriesModule>()),
  useTraining: () => ({
    data: board.current,
    isError: false,
    dataUpdatedAt: Date.parse(F.trainingResponse.serverNow),
    refetch: () => undefined,
  }),
  useStartTraining: () => ({
    mutate: () => undefined,
    reset: () => undefined,
    isPending: false,
    error: null,
  }),
  useCancelDrill: () => ({
    mutate: () => undefined,
    reset: () => undefined,
    isPending: false,
    error: null,
  }),
}));

const SUBJECT = F.trainingResponse.subjects[1]!;

function withSeconds(sessionSeconds: number | undefined): TrainingResponse {
  const { sessionSeconds: _dropped, ...rest } = SUBJECT;
  return {
    ...F.trainingResponse,
    subjects: [
      {
        ...rest,
        ...(sessionSeconds === undefined ? {} : { sessionSeconds }),
        attributes: { ...SUBJECT.attributes, logic: 20 },
        lastAttribute: 'stamina',
      },
    ],
  };
}

beforeEach(() => {
  board.current = withSeconds(undefined);
});

function drawSheet(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TrainingPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('the Train Faster note', () => {
  it('sits on the tab and says exactly what the maintainer wrote', async () => {
    drawSheet();
    const note = screen.getByTestId('info-note');
    expect(note).toHaveTextContent('Train Faster');
    fireEvent.mouseEnter(note);
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        'Speed, Resolve and Organization all reduce the time it takes for an officer to train.',
      ),
    );
  });
});

describe('the length the drill quotes', () => {
  it("quotes the person's own hour", () => {
    board.current = withSeconds(1981);
    drawSheet();
    fireEvent.click(screen.getByTestId('drill-logic'));
    expect(screen.getByRole('button', { name: /^33m 1s · \+2 Logic$/ })).toBeInTheDocument();
  });

  it('falls back to the plain hour from a server that does not send one', () => {
    drawSheet();
    fireEvent.click(screen.getByTestId('drill-logic'));
    expect(screen.getByRole('button', { name: /^1h · \+2 Logic$/ })).toBeInTheDocument();
  });
});
