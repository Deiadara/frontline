import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { BarPage } from './BarPage';
import { useSession } from '../../store/session';

/**
 * The Bar's payroll readout and its `Increase Payroll` (maintainer, 2026-10-01): "extend the
 * payroll left box to include on the right part of it a hand drawn button that says increase
 * payroll and when you click it it opens the page that also opens when you click change payroll on
 * the nexus".
 */

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    headers: new Headers(),
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function renderBar() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={['/game/bar']}>
        <BarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/bar')) return reply(F.bar);
    if (path.endsWith('/me')) return reply(F.me);
    return reply({});
  });
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the payroll left box', () => {
  it('keeps the readout and draws Increase payroll on its right', async () => {
    renderBar();
    const box = await screen.findByTestId('payroll-left');
    const readout = within(box).getByTestId('payroll-readout');
    const raise = within(box).getByTestId('bar-increase-payroll');
    expect(readout).toHaveTextContent(`Payroll left${F.bar.payroll.available.toLocaleString()}`);
    expect(raise).toHaveTextContent('Increase payroll');
    // The readout first, the button after it: "on the right part of it".
    expect(readout.compareDocumentPosition(raise) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /**
   * "Only the increase payroll button is clickable" (maintainer, 2026-10-01): the figure is a
   * readout, with no button, no link and no hover, and pressing it opens nothing.
   */
  it('lets only the button be pressed', async () => {
    renderBar();
    const box = await screen.findByTestId('payroll-left');
    expect(within(box).getAllByRole('button')).toEqual([
      within(box).getByTestId('bar-increase-payroll'),
    ]);
    const readout = within(box).getByTestId('payroll-readout');
    expect(readout.closest('button, a')).toBeNull();
    expect(readout.className).not.toMatch(/hover:/);
    fireEvent.click(readout);
    // Long enough for a window that waits on `/me` to have drawn, had the press opened one.
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the same window the Nexus opens', async () => {
    renderBar();
    const raise = await screen.findByTestId('bar-increase-payroll');
    await waitFor(() => expect(raise).toBeEnabled());
    fireEvent.click(raise);

    const dialog = await screen.findByTestId('payroll-dialog');
    expect(within(dialog).getByTestId('payroll-ledger')).toBeInTheDocument();
    expect(within(dialog).getByTestId('increase-payroll')).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/the nexus/i);
  });
});
