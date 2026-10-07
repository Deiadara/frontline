import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { queryKeys } from '../../lib/queries';
import { useSession } from '../../store/session';
import { BarPage } from './BarPage';

/**
 * The stool remembers who it was showing by id (bug pass, 2026-10-06). It held an index, so after
 * the room turned over, or the player looked into another city, the stool opened on whoever sat in
 * the same place there rather than at the start of the bar.
 */

const fetchMock = vi.fn();
let room = F.bar;

const reply = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

beforeEach(() => {
  room = F.bar;
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) =>
    String(path).includes('/bar') ? reply(room) : reply(F.me),
  );
  vi.stubGlobal('fetch', fetchMock);
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the stool after the room turns over', () => {
  it('starts at the first person of the new room, not at the old position', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(queryKeys.me, F.me);
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/game/bar']}>
          <BarPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const sit = await screen.findByTestId('sit-down');
    await waitFor(() => expect(sit).toBeEnabled());
    fireEvent.click(sit);
    await screen.findByTestId('bar-file');
    fireEvent.click(screen.getByTestId('seat-on'));
    fireEvent.click(screen.getByTestId('seat-on'));
    expect(screen.getByTestId(`recruit-${F.bar.recruits[2]!.id}`)).toBeVisible();

    // Midnight: a new roster, nobody in it the old one had.
    room = {
      ...F.bar,
      recruits: F.bar.recruits.map((recruit) => ({ ...recruit, id: `${recruit.id}-next` })),
      auctions: F.bar.auctions.map((auction) => ({
        ...auction,
        recruitId: `${auction.recruitId}-next`,
      })),
    };
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.bar }));
    expect(await screen.findByTestId(`recruit-${F.bar.recruits[0]!.id}-next`)).toBeVisible();
  });
});

/** Bug pass, 2026-10-06: a refused release stayed under the row after the player kept them. */
describe('letting somebody go, refused, then kept', () => {
  it('takes the refusal away with the confirmation', async () => {
    fetchMock.mockImplementation((path: string) =>
      String(path).endsWith('/bar/release')
        ? Promise.resolve(
            new Response(
              JSON.stringify({ error: { code: 'CONFLICT', message: 'They are out on a job' } }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        : String(path).includes('/bar')
          ? reply(room)
          : reply(F.me),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(queryKeys.me, F.me);
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/game/bar']}>
          <BarPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByTestId('open-crew'));
    const officer = F.bar.officers[1]!.commander.id;
    fireEvent.click(await screen.findByTestId(`release-${officer}`));
    fireEvent.click(screen.getByTestId(`confirm-release-${officer}`));
    expect(await screen.findByText('They are out on a job')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
    expect(screen.queryByText('They are out on a job')).toBeNull();
  });
});
