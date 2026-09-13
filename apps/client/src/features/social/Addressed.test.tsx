import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { MessagesPage } from './MessagesPage';
import { useSession } from '../../store/session';

/**
 * Writing to somebody you just clicked on (maintainer request, 2026-09-12).
 *
 * The faction file lists an enemy's roster and offers a mail button on every row, and the crew
 * file has had a "write to them" door for longer than that. Both landed the reader on an empty
 * mailbox with the name they had just clicked nowhere on the screen, so the door was a door to the
 * wrong room. `?to=<username>` is the whole of the fix, and it has to be the query string rather
 * than router state or a copied link and a refresh both lose it.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: '',
      json: () => Promise.resolve(F.messagesScreen),
    } as Response),
  );
  useSession.setState({ token: 'session-token', user: null });
});

function open(entry: string) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <MessagesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the mailbox, arrived at from somebody’s file', () => {
  it('opens the composer already addressed to them', async () => {
    open('/game/messages?to=Sable_Ninth');

    const form = await screen.findByTestId('compose-form');
    const field = within(form).getByTestId('compose-to');
    await waitFor(() => expect(field).toHaveValue('Sable_Ninth'));
    // Addressed to the person, not to the whole table: the row that was clicked was one person's.
    expect(within(form).getByTestId('to-faction')).not.toBeChecked();
  });

  it('opens the mailbox closed when nobody was named', async () => {
    open('/game/messages');

    await screen.findByTestId('compose');
    expect(screen.queryByTestId('compose-form')).toBeNull();
  });
});
