import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { useSession } from '../../store/session';
import { LocationSheet } from './LocationSheet';
import { spyingOf } from './SpyPanel';

/**
 * Bug pass, 2026-10-06: the sheet outlives its pickers, and a refused send of Sleepers was already
 * standing in the footer the next time the picker was opened.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) =>
    String(path).endsWith('/city/sleepers')
      ? Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: 'FORBIDDEN', message: 'The district is shut' } }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      : new Promise(() => {}),
  );
  vi.stubGlobal('fetch', fetchMock);
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('sending Sleepers, refused, then cancelled', () => {
  it('opens the picker again without the old refusal in it', async () => {
    const view = F.districtDetail.locations.find((one) => one.holder.kind !== 'unoccupied')!;
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MemoryRouter>
          <LocationSheet
            id="sheet"
            picked={false}
            view={view}
            mine={false}
            districtId={F.districtDetail.district.id}
            baseId="base-1"
            army={{ sleepers: 3 }}
            resources={F.base.resources}
            shut={false}
            now={new Date(F.districtDetail.serverNow)}
            onCall={() => undefined}
            spying={spyingOf(F.districtDetail)}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const open = screen.getByTestId(`send-sleepers-${view.location.id}`);
    fireEvent.click(open);
    fireEvent.change(screen.getByLabelText('How many Sleepers'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send them in' }));
    expect(await screen.findByText('The district is shut')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(open);
    expect(screen.queryByText('The district is shut')).toBeNull();
  });
});

/** Bug pass, 2026-10-06: a refused cancel stood beside the next upgrade started on the same sheet. */
describe('a refused call-off, then a new upgrade', () => {
  it('does not carry the old refusal to the new work', async () => {
    fetchMock.mockImplementation((path: string) =>
      String(path).endsWith('/city/cancel-upgrade')
        ? Promise.resolve(
            new Response(
              JSON.stringify({ error: { code: 'CONFLICT', message: 'Too late to call it off' } }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        : new Promise(() => {}),
    );
    const base = F.districtDetail.locations.find((one) => one.holder.kind !== 'unoccupied')!;
    const now = new Date(F.districtDetail.serverNow);
    const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
    const working = (since: string, until: string) => ({
      ...base,
      upgradingSince: since,
      upgradingUntil: until,
    });
    const sheet = (view: typeof base) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LocationSheet
            id="sheet"
            picked={false}
            view={view}
            mine
            districtId={F.districtDetail.district.id}
            baseId="base-1"
            army={{}}
            resources={F.base.resources}
            shut={false}
            now={now}
            onCall={() => undefined}
            spying={spyingOf(F.districtDetail)}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const view = render(sheet(working(at(-1), at(60))));
    fireEvent.click(screen.getByTestId(`cancel-upgrade-${base.location.id}`));
    expect(await screen.findByText('Too late to call it off')).toBeVisible();

    view.rerender(sheet(working(at(0), at(120))));
    // The query layer hands state changes on a tick later, so the clearing is waited for.
    await waitFor(() => expect(screen.queryByText('Too late to call it off')).toBeNull());
  });
});
