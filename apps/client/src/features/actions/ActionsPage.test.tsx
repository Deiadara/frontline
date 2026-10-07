import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { queryKeys } from '../../lib/queries';
import { useSession } from '../../store/session';
import { ActionsPage } from './ActionsPage';

/**
 * The road on the Monitor (bug pass, 2026-10-06): read off three requests, refused per row.
 */

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

const column = F.actionsResponse.movements[0]!;
const twoColumns = {
  ...F.actionsResponse,
  movements: [column, { ...column, id: 'col-twin' }],
};

function serve(over: {
  actions?: unknown;
  missions?: () => Promise<Response>;
  recall?: () => Promise<Response>;
}) {
  fetchMock.mockImplementation((path: string) => {
    const at = String(path);
    if (at.endsWith('/actions/recall')) return over.recall?.() ?? new Promise(() => {});
    if (at.endsWith('/actions')) return json(over.actions ?? twoColumns);
    if (at.includes('/missions')) return over.missions?.() ?? json(F.missionsResponse());
    if (at.endsWith('/battles')) return json(F.battles);
    return new Promise(() => {});
  });
}

function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/game/actions']}>
        <ActionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the road', () => {
  it('does not say nobody is out while the jobs are still being read', async () => {
    serve({
      actions: { ...F.actionsResponse, movements: [] },
      missions: () => new Promise(() => {}),
    });
    open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Nobody is out')).toBeNull();
    expect(screen.getByText('Counting heads…')).toBeInTheDocument();
  });

  it('waits only on the column being turned round', async () => {
    serve({});
    open();
    fireEvent.click(await screen.findByTestId(`recall-${column.id}`));
    await waitFor(() => expect(screen.getByTestId(`recall-${column.id}`)).toBeDisabled());
    expect(screen.getByTestId('recall-col-twin')).toBeEnabled();
  });

  it('takes a refusal away with the column it was about', async () => {
    serve({
      recall: () => json({ error: { code: 'CONFLICT', message: 'Too late to turn them' } }, 409),
    });
    const client = open();
    fireEvent.click(await screen.findByTestId(`recall-${column.id}`));
    expect(await screen.findByText('Too late to turn them')).toBeInTheDocument();
    // The column arrives and leaves the road.
    serve({ actions: { ...twoColumns, movements: [twoColumns.movements[1]] } });
    await client.refetchQueries({ queryKey: queryKeys.actions });
    await waitFor(() => expect(screen.queryByText('Too late to turn them')).toBeNull());
  });
});
