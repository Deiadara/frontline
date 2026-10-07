import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { MessagesPage } from './MessagesPage';
import { useSession } from '../../store/session';

/**
 * Blocking a sender (maintainer, 2026-10-02): one stranger could fill a mailbox every day. A letter
 * a player wrote carries a Block button; the list of blocked senders, and the way back, shows only
 * once somebody is on it.
 */

const fetchMock = vi.fn();
const LETTER = F.messagesScreen.inbox.find((message) => message.replyTo !== null);
if (!LETTER) throw new Error('the mailbox fixture carries no letter a player wrote');
const SENDER = LETTER.senderUserId;

const reply = (body: unknown) =>
  Promise.resolve({
    headers: new Headers(),
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function serve(blocked: { userId: string; name: string }[]) {
  fetchMock.mockImplementation((path: string) =>
    String(path).endsWith('/messages/block')
      ? reply({ messages: { ...F.messagesScreen, blocked } })
      : reply({ ...F.messagesScreen, blocked }),
  );
}

function open() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={['/game/messages']}>
        <MessagesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => vi.unstubAllGlobals());

const posted = (path: string) =>
  fetchMock.mock.calls
    .filter(([called]) => String(called).endsWith(path))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string) as unknown);

describe('blocking a sender', () => {
  it('blocks the writer of an open letter', async () => {
    serve([]);
    open();
    fireEvent.click(await screen.findByText(LETTER.subject));
    fireEvent.click(await screen.findByTestId('block-sender'));
    await waitFor(() =>
      expect(posted('/messages/block')).toEqual([{ userId: SENDER, blocked: true }]),
    );
  });

  it('lists the blocked only when there are any, and unblocks from the list', async () => {
    serve([]);
    const first = open();
    await screen.findByTestId('compose');
    expect(screen.queryByTestId('blocked-senders')).toBeNull();
    first.unmount();

    serve([{ userId: SENDER, name: 'Sable' }]);
    open();
    expect(await screen.findByTestId('blocked-senders')).toHaveTextContent('Sable');
    fireEvent.click(screen.getByTestId(`unblock-${SENDER}`));
    await waitFor(() =>
      expect(posted('/messages/block')).toEqual([{ userId: SENDER, blocked: false }]),
    );
  });
});

/** Bug pass, 2026-10-06: what one press in the mailbox left behind for the next. */
describe('the mailbox after a refusal or a press', () => {
  it('waits only on the row being unblocked', async () => {
    const other = 'other-user';
    fetchMock.mockImplementation((path: string) =>
      String(path).endsWith('/messages/block')
        ? new Promise(() => {})
        : reply({
            ...F.messagesScreen,
            blocked: [
              { userId: SENDER, name: 'Sable' },
              { userId: other, name: 'Rook' },
            ],
          }),
    );
    open();
    fireEvent.click(await screen.findByTestId(`unblock-${SENDER}`));
    await waitFor(() => expect(screen.getByTestId(`unblock-${SENDER}`)).toBeDisabled());
    expect(screen.getByTestId(`unblock-${other}`)).toBeEnabled();
  });

  it('opens a new letter without the last one’s refusal under it', async () => {
    fetchMock.mockImplementation((path: string, init?: RequestInit) =>
      String(path).endsWith('/messages') && init?.method === 'POST'
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                error: { code: 'FORBIDDEN', message: 'They are not taking letters' },
              }),
              { status: 403, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        : reply({ ...F.messagesScreen, blocked: [] }),
    );
    open();
    fireEvent.click(await screen.findByText(LETTER.subject));
    fireEvent.click(await screen.findByTestId('reply'));
    fireEvent.click(screen.getByTestId('send-message'));
    expect(await screen.findByTestId('compose-error')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Never mind' }));
    fireEvent.click(screen.getByTestId('compose'));
    expect(await screen.findByTestId('compose-form')).toBeVisible();
    expect(screen.queryByTestId('compose-error')).toBeNull();
  });
});
