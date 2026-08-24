import type { MeResponse, User } from '@frontline/shared';
import { playerLevelGrants } from '@frontline/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, getMe, register } from './api';
import { useSession } from '../store/session';

const USER: User = {
  id: 'u1',
  username: 'operator',
  overseerId: null,
  createdAt: '2026-08-12T10:00:00.000Z',
  displayName: null,
  icon: 'shield',
  timezone: 'Europe/Athens',
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
