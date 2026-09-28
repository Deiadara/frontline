import type { MeResponse, User } from '@frontline/shared';
import { TUTORIAL_STEPS, playerLevelGrants } from '@frontline/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, WASTE_DECLINED, barterResources, getMe, register } from './api';
import { useWasteConfirm } from '../store/wasteConfirm';
import { useSession } from '../store/session';

const USER: User = {
  id: 'u1',
  username: 'operator',
  overseerId: null,
  createdAt: '2026-08-12T10:00:00.000Z',
  displayName: null,
  icon: 'shield',
  timezone: 'Europe/Athens',
  soundVolume: 60,
  // Seen, so the opening tutorial does not draw over a test about something else.
  tutorialSeen: [...TUTORIAL_STEPS],
};

const ME: MeResponse = {
  admin: false,
  user: USER,
  overseer: null,
  base: null,
};

interface FakeResponseInit {
  ok: boolean;
  status: number;
  body: unknown;
  statusText?: string;
}

function fakeResponse({ ok, status, body, statusText }: FakeResponseInit) {
  return {
    headers: new Headers(),
    ok,
    status,
    statusText: statusText ?? '',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: null, user: null });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('parses a valid 2xx body through the shared schema', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: ME }));
    await expect(getMe()).resolves.toEqual(ME);
  });

  it('attaches the bearer token when a session exists', async () => {
    useSession.setState({ token: 'secret-token', user: USER });
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: ME }));

    await getMe();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer secret-token');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  /*
   * A login renews itself while the player plays (`apps/server/src/auth/session.ts`), and a
   * password change or "log out everywhere" hands this tab its one surviving token in the same
   * header. Missing it once is a player signed out a day later for no reason they can see.
   */
  it('swaps in a renewed session token from any answer', async () => {
    useSession.setState({ token: 'old-token', user: USER });
    fetchMock.mockResolvedValueOnce({
      ...fakeResponse({ ok: true, status: 200, body: ME }),
      headers: new Headers({ 'x-session-token': 'new-token' }),
    });

    await getMe();

    expect(useSession.getState().token).toBe('new-token');
    expect(useSession.getState().user).toEqual(USER);
  });

  /*
   * The race "log out everywhere" opens: a poll sent with the old token lands after this tab was
   * handed its new one, and comes back 401. It is about the old token, and must not end the new
   * session.
   */
  it('ignores a 401 for a token the tab has already replaced', async () => {
    useSession.setState({ token: 'old-token', user: USER });
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
    const inFlight = getMe().catch(() => undefined);

    useSession.getState().setToken('new-token');
    answer({
      ...fakeResponse({
        ok: false,
        status: 401,
        body: { error: { code: 'UNAUTHORIZED', message: 'This session has ended' } },
      }),
      headers: new Headers(),
    });
    await inFlight;

    expect(useSession.getState().token).toBe('new-token');
  });

  it('still signs out on a 401 for the token the tab is using', async () => {
    useSession.setState({ token: 'only-token', user: USER });
    fetchMock.mockResolvedValueOnce({
      ...fakeResponse({
        ok: false,
        status: 401,
        body: { error: { code: 'UNAUTHORIZED', message: 'This session has ended' } },
      }),
      headers: new Headers(),
    });
    await getMe().catch(() => undefined);
    expect(useSession.getState().token).toBeNull();
  });

  it('does not sign a logged-out tab back in from a stray header', async () => {
    fetchMock.mockResolvedValueOnce({
      ...fakeResponse({ ok: true, status: 200, body: ME }),
      headers: new Headers({ 'x-session-token': 'new-token' }),
    });

    await getMe();

    expect(useSession.getState().token).toBeNull();
  });

  it('rejects a malformed 2xx body instead of leaking it', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: { user: {} } }));
    await expect(getMe()).rejects.toThrow();
  });

  it('throws a typed ApiRequestError from the shared error envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 409,
        body: { error: { code: 'USERNAME_TAKEN', message: 'Username already exists' } },
      }),
    );

    await expect(register({ username: 'operator', password: 'password123' })).rejects.toMatchObject(
      {
        status: 409,
        code: 'USERNAME_TAKEN',
        message: 'Username already exists',
      },
    );
  });

  it('carries a level-up the refusal banked on its way to refusing', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 409,
        body: {
          error: { code: 'MISSION_NEEDS_OFFICER', message: 'That job needs an officer' },
          levelUp: { level: 4, levelsGained: 1, grants: playerLevelGrants(4) },
        },
      }),
    );

    await expect(getMe()).rejects.toMatchObject({
      code: 'MISSION_NEEDS_OFFICER',
      levelUp: { level: 4, levelsGained: 1 },
    });
  });

  /*
   * `levelUp` is an extra riding along on the envelope, not part of why the call failed, so a
   * malformed one must not be able to take the refusal *message* down with it: the whole-object
   * parse would fail and `apiFetch` would fall back to `UNKNOWN` / `res.statusText`, leaving the
   * player with no reason at all. Hardening: the shared build makes this unreachable today.
   */
  it('keeps the refusal message when the level-up rides along malformed', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 409,
        body: {
          error: { code: 'MISSION_NEEDS_OFFICER', message: 'That job needs an officer' },
          levelUp: { level: 4, levelsGained: 1, grants: 'not-a-grants-object' },
        },
      }),
    );

    await expect(getMe()).rejects.toMatchObject({
      code: 'MISSION_NEEDS_OFFICER',
      message: 'That job needs an officer',
      levelUp: undefined,
    });
  });

  it('clears the session on a 401', async () => {
    useSession.setState({ token: 'expired', user: USER });
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 401,
        body: { error: { code: 'UNAUTHORIZED', message: 'Token expired' } },
      }),
    );

    await expect(getMe()).rejects.toBeInstanceOf(ApiRequestError);
    expect(useSession.getState().token).toBeNull();
    expect(useSession.getState().user).toBeNull();
  });
});

/**
 * What arrives is not always JSON, even on a 200.
 *
 * A captive portal, a proxy error page, or a dev server routing `/api` to the SPA all answer with
 * HTML and a success status. `res.json()` throws a bare `SyntaxError` on that, and nothing in the
 * client catches `SyntaxError`: every screen's error branch is written for `ApiRequestError`, so
 * the player was shown "Unexpected token < in JSON at position 0" and we were shown nothing at all.
 */
describe('a success that is not JSON', () => {
  beforeEach(() => useSession.setState({ token: 'tok', user: null }));

  it('is an ApiRequestError naming the status, not a raw SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('<!doctype html><title>Sign in to the wifi</title>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
        ),
      ),
    );

    await expect(getMe()).rejects.toBeInstanceOf(ApiRequestError);
    await expect(getMe()).rejects.toMatchObject({ status: 200, code: 'BAD_RESPONSE' });
    // And it names the route, because "something is not JSON" is not a bug report.
    await expect(getMe()).rejects.toThrow(/\/me/);
  });

  /** An error body that is not JSON already worked, and must keep working. */
  it('still reports the status when a failure body is not JSON either', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>502</html>', { status: 502 }))),
    );
    await expect(getMe()).rejects.toMatchObject({ status: 502 });
  });
});

/**
 * The warning before anything goes to waste (maintainer ruling, 2026-09-28).
 *
 * The server refuses a credit that would overflow the stores with `WOULD_WASTE` and the figure. The
 * fetch layer puts that figure to the player and sends the same request again only on a yes.
 */
describe('a request that would waste', () => {
  const wouldWaste = () =>
    fakeResponse({
      ok: false,
      status: 409,
      body: {
        error: { code: 'WOULD_WASTE', message: 'This would put you over your storage' },
        waste: { scrap: 120 },
      },
    });
  const refused = () =>
    fakeResponse({
      ok: false,
      status: 409,
      body: { error: { code: 'MARKET_REFUSED', message: 'That listing is gone' } },
    });
  const bodyOf = (call: number) =>
    JSON.parse((fetchMock.mock.calls[call] as [string, RequestInit])[1].body as string) as Record<
      string,
      unknown
    >;
  /** Answers the question as soon as it is asked. */
  const answer = (yes: boolean) =>
    useWasteConfirm.subscribe((state) => {
      if (state.question) {
        expect(state.question.waste).toEqual({ scrap: 120 });
        state.question.answer(yes);
      }
    });

  it('asks, and sends the same request again with the yes on it', async () => {
    fetchMock.mockResolvedValueOnce(wouldWaste()).mockResolvedValueOnce(refused());
    const stop = answer(true);
    const trade = { give: 'oil', want: 'scrap', amount: 400 } as const;
    await expect(barterResources(trade)).rejects.toMatchObject({ code: 'MARKET_REFUSED' });
    stop();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(0)).toEqual(trade);
    expect(bodyOf(1)).toEqual({ ...trade, acceptWaste: true });
  });

  it('sends nothing more on a no, and refuses with nothing to say', async () => {
    fetchMock.mockResolvedValueOnce(wouldWaste());
    const stop = answer(false);
    const declined = barterResources({ give: 'oil', want: 'scrap', amount: 400 });
    await expect(declined).rejects.toBeInstanceOf(ApiRequestError);
    await expect(declined).rejects.toMatchObject({ code: WASTE_DECLINED, message: '' });
    stop();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useWasteConfirm.getState().question).toBeNull();
  });
});
