import type { CrewProfileResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { useSession } from '../../store/session';
import { CrewProfilePage } from './CrewProfilePage';

/**
 * A crew's file, from the one door on it that leaves the page for the mailbox.
 *
 * The faction file's "write to them" was fixed on 2026-09-13 to open the composer addressed; this
 * one kept opening an empty mailbox, because the file carried only the name drawn on screen and
 * that is the display name wherever one is set.
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

async function renderFile(profile: CrewProfileResponse) {
  fetchMock.mockImplementation((path: string) => {
    if (String(path).includes('/crews/')) return reply(profile);
    if (String(path).endsWith('/me')) return reply(F.me);
    throw new Error(`unstubbed request: ${String(path)}`);
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/game/crews/${profile.crew.id}`]}>
        <Routes>
          <Route path="/game/crews/:id" element={<CrewProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.findByTestId('profile-message');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe("the door to write to a crew's player", () => {
  it('opens the composer addressed by their login name, not the name on the file', async () => {
    const door = await renderFile({
      ...F.rivalProfile,
      player: { ...F.rivalProfile.player, name: 'Vex of the Ninth', handle: 'vex_ninth' },
    });
    expect(door).toHaveAttribute('href', '/game/messages?to=vex_ninth');
  });

  it('still opens the mailbox for a file that does not say', async () => {
    const door = await renderFile(F.rivalProfile);
    expect(door).toHaveAttribute('href', '/game/messages');
  });
});
