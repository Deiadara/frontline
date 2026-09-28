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
      headers: new Headers(),
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
    // On the letter as a chosen name, not as text still to be matched: the door named a person.
    await waitFor(() =>
      expect(within(form).getByTestId('compose-recipient-Sable_Ninth')).toBeInTheDocument(),
    );
    expect(within(form).getByTestId('compose-to')).toHaveValue('');
    // Addressed to the person, not to the whole table: the row that was clicked was one person's.
    expect(within(form).getByTestId('to-faction')).not.toBeChecked();
  });

  it('opens the mailbox closed when nobody was named', async () => {
    open('/game/messages');

    await screen.findByTestId('compose');
    expect(screen.queryByTestId('compose-form')).toBeNull();
  });
});

/**
 * Arriving from the join sheet's picker (maintainer, 2026-09-24).
 *
 * The sheet on `/game/faction` lists the invitations a crew holds and offers to go and read one.
 * What it holds is the *invitation's* id, so the mailbox finds the message carrying it rather than
 * being handed a message id the faction payload does not have.
 */
describe('the mailbox, arrived at from an invitation', () => {
  const INVITED = F.messagesScreen.inbox.find((message) => message.invite !== null);
  if (!INVITED?.invite) throw new Error('the mailbox fixture carries no invitation');
  /* Pulled out of the narrowed const: the narrowing above does not reach inside the cases. */
  const INVITE_ID = INVITED.invite.inviteId;

  it('opens the message that carries that invitation, with its card on it', async () => {
    open(`/game/messages?invite=${INVITE_ID}`);

    const sheet = await screen.findByTestId('message-open');
    expect(within(sheet).getByRole('heading')).toHaveTextContent(INVITED.subject);
    // The card is the button that answers it, and it is on the message and nowhere else.
    expect(within(sheet).getByTestId('invite-card')).toBeInTheDocument();
  });

  it('leaves the mailbox closed when the invitation has no message left', async () => {
    open('/game/messages?invite=invite-that-was-binned');

    await screen.findByTestId('message-list');
    await waitFor(() => expect(screen.queryByTestId('message-open')).toBeNull());
  });
});
