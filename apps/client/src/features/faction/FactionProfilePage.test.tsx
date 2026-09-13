import { FACTION_RANK_LABELS, FactionProfileResponseSchema } from '@frontline/shared';
import type { FactionProfileResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { FactionProfilePage } from './FactionProfilePage';
import { useSession } from '../../store/session';

/**
 * A faction's public file (maintainer request, 2026-09-12).
 *
 * The page is the same page for a member and for a stranger, so the assertions come in pairs: the
 * content is checked once, and the doors are checked against both readers. A regression that put
 * the roster behind `isYours` would pass every content assertion and fail the second door test,
 * which is the failure worth having.
 */

const PROFILE = F.factionProfile;
const [LEADER, CHIEF, MEMBER] = PROFILE.members;
if (!LEADER || !CHIEF || !MEMBER) throw new Error('the faction file fixture needs three seats');

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function Landed({ what }: { what: string }) {
  const { id } = useParams<{ id: string }>();
  return <p data-testid={`landed-${what}`}>{id ?? 'here'}</p>;
}

/**
 * The mailbox, standing in for the real one.
 *
 * Reads the router's own location rather than `window.location`: a `MemoryRouter` keeps its
 * history in memory and never touches the address bar, so `window.location.search` here is the
 * empty string whatever the door put in the query string.
 */
function Mail() {
  return <p data-testid="landed-mail">{useLocation().search}</p>;
}

async function renderFile(profile: FactionProfileResponse = PROFILE) {
  fetchMock.mockImplementation((path: string) => {
    if (String(path).includes('/profile')) return reply(profile);
    if (String(path).endsWith('/me')) return reply(F.me);
    throw new Error(`unstubbed request: ${String(path)}`);
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/game/factions/${profile.faction.id}`]}>
        <Routes>
          <Route path="/game/factions/:id" element={<FactionProfilePage />} />
          <Route path="/game/crews/:id" element={<Landed what="crew" />} />
          <Route path="/game/faction" element={<Landed what="room" />} />
          <Route path="/game/leaderboard" element={<Landed what="board" />} />
          <Route path="/game/messages" element={<Mail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.findByTestId('faction-profile');
}

/** The same file, read by somebody sitting at the table. */
const asMember = (): FactionProfileResponse => ({
  ...PROFILE,
  isYours: true,
  members: PROFILE.members.map((member, index) => ({ ...member, isYou: index === 2 })),
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the fixture it is drawn from', () => {
  it('is the shape the route answers with', () => {
    expect(FactionProfileResponseSchema.safeParse(PROFILE).success).toBe(true);
  });
});

describe("a faction's file", () => {
  it('names the faction, draws its badge and prints what it is for', async () => {
    await renderFile();
    expect(screen.getByRole('heading', { name: PROFILE.faction.name })).toBeVisible();
    expect(
      within(screen.getByTestId('faction-profile-badge')).getByRole('img', {
        name: `${PROFILE.faction.name}'s badge`,
      }),
    ).toBeVisible();
    expect(screen.getByTestId('faction-profile-blurb')).toHaveTextContent(PROFILE.faction.blurb);
  });

  /** The house clock is Athens and the fixture was founded at 10:00 UTC on the 12th. */
  it('says when it was founded, as a date rather than as a timestamp', async () => {
    await renderFile();
    expect(screen.getByTestId('faction-profile-founded')).toHaveTextContent('12 August 2026');
  });

  it('gives what the table has won a section of its own', async () => {
    await renderFile();
    expect(screen.getByTestId('faction-profile-earned')).toHaveTextContent('1,820');
  });

  it('prints the average level as a whole number', async () => {
    await renderFile();
    // Six, eleven and nine: 8.67, drawn as 9 and never as 8.666666666666666.
    expect(screen.getByTestId('faction-profile-average')).toHaveTextContent('9');
    expect(screen.getByTestId('faction-profile-average')).not.toHaveTextContent('.');
  });

  it('says where it sits on the factions board', async () => {
    await renderFile();
    expect(screen.getByTestId('faction-profile-rank')).toHaveTextContent('#1');
  });

  it('leaves the board place out when the board does not list it', async () => {
    await renderFile({ ...PROFILE, rank: null });
    expect(screen.queryByTestId('faction-profile-rank')).toBeNull();
  });
});

describe('the roster on it', () => {
  it('draws every seat with its rank, its level and its infamy', async () => {
    await renderFile();
    const seats = within(screen.getByTestId('faction-profile-members')).getAllByRole('listitem');
    expect(seats).toHaveLength(PROFILE.members.length);
    for (const member of PROFILE.members) {
      const row = screen.getByTestId(`faction-member-${member.username}`);
      expect(row).toHaveTextContent(FACTION_RANK_LABELS[member.rank]);
      expect(row).toHaveTextContent(String(member.level));
      expect(row).toHaveTextContent(Math.round(member.infamy).toLocaleString());
    }
  });

  /*
   * Their own face, not a drawing of their seat (maintainer request, 2026-09-13).
   *
   * The roster used to be generated sigils, which made a table of five people read as five
   * strangers in goggles. The reader of this page is deciding about these specific people, so it
   * shows the picture of them the game already has. The fixture carries a member with no Overseer
   * on purpose: that row has to fall back rather than take the table down.
   */
  it('draws each member as their own Overseer, and falls back for an account with none', async () => {
    await renderFile();

    const withFace = PROFILE.members.filter((member) => member.portraitId !== null);
    const withoutFace = PROFILE.members.filter((member) => member.portraitId === null);
    // Preconditions: the fixture exercises both branches, or one of them is never reached.
    expect(withFace.length).toBeGreaterThan(0);
    expect(withoutFace.length).toBeGreaterThan(0);

    for (const member of withFace) {
      expect(screen.getByTestId(`member-face-${member.username}`)).toHaveAttribute(
        'data-face',
        member.portraitId,
      );
    }
    for (const member of withoutFace) {
      expect(screen.getByTestId(`member-face-${member.username}`)).toHaveAttribute(
        'data-face',
        'none',
      );
    }
    // The two people with faces have different ones, so a roster drawing one portrait for
    // everybody would be visible here rather than only to somebody looking at the screen.
    const drawn = withFace.map((member) => member.portraitId);
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it('opens a name onto that crew file', async () => {
    await renderFile();
    fireEvent.click(screen.getByTestId(`faction-member-link-${CHIEF.username}`));
    expect(await screen.findByTestId('landed-crew')).toHaveTextContent(CHIEF.userId);
  });

  it('offers the mail, addressed to the person whose row it is', async () => {
    await renderFile();
    expect(screen.getByTestId(`faction-member-message-${LEADER.username}`)).toHaveAttribute(
      'href',
      `/game/messages?to=${encodeURIComponent(LEADER.handle)}`,
    );
  });

  /*
   * The door addresses the login handle, not the name drawn on the row (regression, 2026-09-13).
   *
   * `username` here is `displayNameOf(user)` and `POST /messages` resolves login names only, so a
   * door built on the name it prints left every member with a display name unreachable: the
   * composer opened addressed to a name no account answers to and the send came back
   * `no_such_player`. The chief in the fixture is the one row where the two differ, which is what
   * keeps this from being an assertion that agrees with whatever the component happens to read.
   */
  it('addresses the mail by the login handle even when the row prints another name', async () => {
    expect(CHIEF.handle, 'the fixture needs a row whose two names differ').not.toBe(CHIEF.username);
    await renderFile();

    const door = screen.getByTestId(`faction-member-message-${CHIEF.username}`);
    expect(door).toHaveAttribute('href', `/game/messages?to=${encodeURIComponent(CHIEF.handle)}`);

    // Followed, because what matters is the query string the mailbox is handed, not the markup.
    fireEvent.click(door);
    expect(await screen.findByTestId('landed-mail')).toHaveTextContent(
      `to=${encodeURIComponent(CHIEF.handle)}`,
    );
  });

  it('does not offer to write to you', async () => {
    await renderFile(asMember());
    expect(screen.getByTestId(`faction-member-${MEMBER.username}`)).toHaveTextContent('you');
    expect(screen.queryByTestId(`faction-member-message-${MEMBER.username}`)).toBeNull();
    expect(screen.getByTestId(`faction-member-message-${LEADER.username}`)).toBeVisible();
  });
});

describe('what the reader changes', () => {
  it('offers a stranger the board it was found on', async () => {
    await renderFile();
    expect(screen.getByTestId('faction-profile')).toHaveAttribute('data-yours', 'false');
    expect(screen.getByTestId('faction-profile-board')).toBeVisible();
    expect(screen.queryByTestId('faction-profile-room')).toBeNull();
  });

  it('offers a member the room, and changes nothing else about the page', async () => {
    await renderFile(asMember());
    expect(screen.getByTestId('faction-profile')).toHaveAttribute('data-yours', 'true');
    expect(screen.getByTestId('faction-profile-room')).toBeVisible();
    expect(screen.queryByTestId('faction-profile-board')).toBeNull();
    // The content is the same page for both readers, which is the whole point of the route.
    expect(screen.getByTestId('faction-profile-earned')).toHaveTextContent('1,820');
    expect(
      within(screen.getByTestId('faction-profile-members')).getAllByRole('listitem'),
    ).toHaveLength(PROFILE.members.length);
  });
});
