import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { useSession } from '../../store/session';
import { NotificationsPage } from './NotificationsPage';

/** Bug pass, 2026-10-06: a read that did not save left the dot lit and said nothing. */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === 'POST'
        ? new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Not marked' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify(F.notificationsScreen), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('marking every receipt read, refused', () => {
  it('says why', async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MemoryRouter>
          <NotificationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByTestId('read-all-notifications'));
    expect(await screen.findByTestId('notification-read-error')).toHaveTextContent('Not marked');
  });
});
