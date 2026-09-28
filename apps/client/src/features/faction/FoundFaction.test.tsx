import type { FactionResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { useSession } from '../../store/session';
import { FoundFaction } from './FoundFaction';

/**
 * The left-hand door, once a crew is holding invitations (maintainer, 2026-09-24).
 *
 * The sheet used to explain, in a paragraph, that an invitation arrives in your messages with a
 * button on it. The maintainer asked for the paragraph to become a picker of the invitations the
 * crew already holds, which opens the one that is chosen. So there are two shapes to hold here:
 * with invitations, the rows that answer them *and* the picker that goes to what was written; with
 * none, no empty picker at all, because a control with nothing in it is worse than a line saying
 * nobody has asked.
 */

const [FIRST] = F.factionNone.invites;
if (!FIRST) throw new Error('the empty-faction fixture holds no invitation');

/** A second table asking, so "lists the invitations" cannot pass on a list of one. */
const SECOND = {
  ...FIRST,
  id: 'invite-2',
  factionId: 'faction-2',
  factionName: 'The Rust Parliament',
  invitedBy: 'Halloran',
};

const holding = (...invites: FactionResponse['invites']): FactionResponse => ({
  ...F.factionNone,
  invites,
});

/** Where the picker took the reader, read off the router rather than off a mock. */
function Landed() {
  const location = useLocation();
  return <p data-testid="landed">{`${location.pathname}${location.search}`}</p>;
}

function open(data: FactionResponse) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/game/faction']}>
        <Routes>
          <Route path="/game/faction" element={<FoundFaction data={data} />} />
          <Route path="/game/messages" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  useSession.setState({ token: 'session-token', user: null });
});

describe('the join sheet', () => {
  it('lists every invitation the crew holds in the picker', () => {
    open(holding(FIRST, SECOND));

    fireEvent.click(screen.getByTestId('invite-messages'));
    const options = screen.getAllByRole('option').map((option) => option.textContent ?? '');
    expect(options).toHaveLength(2);
    expect(options[0]).toContain(FIRST.factionName);
    expect(options[0]).toContain(FIRST.invitedBy);
    expect(options[1]).toContain(SECOND.factionName);
  });

  it('opens the chosen invitation’s own message', () => {
    open(holding(FIRST, SECOND));

    fireEvent.click(screen.getByTestId('invite-messages'));
    fireEvent.click(screen.getByRole('option', { name: new RegExp(SECOND.factionName) }));

    // The mailbox, carrying which invitation to open: the message is found by the invite it holds.
    expect(screen.getByTestId('landed')).toHaveTextContent(`/game/messages?invite=${SECOND.id}`);
  });

  it('still answers an invitation from the sheet itself', () => {
    open(holding(FIRST, SECOND));

    // The picker is the way to what they wrote, not a replacement for yes and no.
    expect(screen.getByTestId(`accept-${FIRST.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`decline-${FIRST.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`accept-${SECOND.id}`)).toBeInTheDocument();
  });

  it('says nobody has asked rather than drawing an empty picker', () => {
    open(holding());

    expect(screen.queryByTestId('invite-messages')).toBeNull();
    const sheet = screen.getByTestId('join-sheet');
    expect(sheet).toHaveTextContent('Nobody has asked you yet');
    // The paragraph the picker replaced, which said in three lines what this one says in one.
    expect(sheet).not.toHaveTextContent('An invitation is the only way in');
    // The way to the mailbox is still on the sheet, with nothing specific to point at.
    expect(screen.getByTestId('to-messages')).toHaveAttribute('href', '/game/messages');
  });
});
