import type { AuthResponse, MeResponse, User } from '@frontline/shared';
import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  TUTORIAL_STEPS,
  playerLevelGrants,
} from '@frontline/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  WASTE_DECLINED,
  barterResources,
  getMe,
  logoutEverywhere,
  register,
  signOut,
} from './api';
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
  useSession.setState({ signedIn: false, user: null });
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

  /*
   * The session is an httpOnly cookie (security pass, 2026-09-30): the page holds no token to send,
   * so what is left to check is that the cookie goes with the request and that every write carries
   * the header the server's CSRF guard asks for.
   */
  it('sends the cookie and the page’s header, and no token', async () => {
    useSession.setState({ signedIn: true, user: USER });
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: ME }));

    await getMe();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(init.credentials).toBe('same-origin');
    expect(headers.get(CSRF_HEADER)).toBe(CSRF_HEADER_VALUE);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('keeps nothing but the user from a sign-in, and writes no token anywhere', async () => {
    const body: AuthResponse = { token: 'never-kept', user: USER };
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 201, body }));

    const answer = await register({ username: 'operator', password: 'password123' });
    useSession.getState().login(answer.user);

    expect(useSession.getState()).toMatchObject({ signedIn: true, user: USER });
    expect(JSON.stringify(useSession.getState())).not.toContain('never-kept');
    expect(JSON.stringify({ ...localStorage })).not.toContain('never-kept');
  });

  /*
   * The race "log out everywhere" opens: a poll sent on the old session lands after this tab was
   * handed its new one, and comes back 401. It is about the old session, and must not end the new
   * one.
   */
  it('ignores a 401 for a session the tab has since had rotated', async () => {
    useSession.setState({ signedIn: true, user: USER });
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
    const inFlight = getMe().catch(() => undefined);

    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: { ok: true } }));
    await logoutEverywhere();
    answer(
      fakeResponse({
        ok: false,
        status: 401,
        body: { error: { code: 'UNAUTHORIZED', message: 'This session has ended' } },
      }),
    );
    await inFlight;

    expect(useSession.getState().signedIn).toBe(true);
  });

  it('still signs out on a 401 for the session the tab is using', async () => {
    useSession.setState({ signedIn: true, user: USER });
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 401,
        body: { error: { code: 'UNAUTHORIZED', message: 'This session has ended' } },
      }),
    );
    await getMe().catch(() => undefined);
    expect(useSession.getState().signedIn).toBe(false);
  });

  it('signs out through the server, which is the only side that can drop the cookie', async () => {
    useSession.setState({ signedIn: true, user: USER });
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: { ok: true } }));

    await signOut();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/logout');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get(CSRF_HEADER)).toBe(CSRF_HEADER_VALUE);
    expect(useSession.getState()).toMatchObject({ signedIn: false, user: null });
  });

  it('signs the page out even when the server does not answer', async () => {
    useSession.setState({ signedIn: true, user: USER });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await signOut().catch(() => undefined);

    expect(useSession.getState().signedIn).toBe(false);
  });

  it('rejects a malformed 2xx body instead of leaking it', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: { user: {} } }));
    await expect(getMe()).rejects.toThrow();
  });

  /*
   * Bug pass, 2026-10-06: these two escaped as a raw ZodError (its message is the issue list as
   * JSON) and a bare TypeError, and screens print `error.message` as it comes.
   */
  it('turns a body of the wrong shape into a sentence that names the route', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: { user: {} } }));
    const error: unknown = await getMe().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 200, code: 'BAD_RESPONSE' });
    expect((error as Error).message).toMatch(/\/me/);
    expect((error as Error).message).not.toMatch(/[[{]/);
  });

  it('turns a request that never reached the server into a sentence', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error: unknown = await getMe().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK' });
    expect((error as Error).message).not.toMatch(/Failed to fetch/);
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
    useSession.setState({ signedIn: true, user: USER });
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 401,
        body: { error: { code: 'UNAUTHORIZED', message: 'Token expired' } },
      }),
    );

    await expect(getMe()).rejects.toBeInstanceOf(ApiRequestError);
    expect(useSession.getState().signedIn).toBe(false);
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
  beforeEach(() => useSession.setState({ signedIn: true, user: null }));

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
