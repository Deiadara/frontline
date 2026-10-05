/**
 * Sweeps over every registered route, read off the server rather than a hand list: no route
 * answers a caller with no token, and no write route does anything with a body that is not JSON.
 * Plus the admin bench, which must not exist while admin mode is off.
 */
import type { AuthResponse, CityResponse } from '@frontline/shared';
import type { Harness, Method, Player } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';

/**
 * The routes a caller with no token may use. Signing out is one: it clears a cookie, and a
 * session that has already ended still leaves one behind to clear.
 */
const OPEN_ROUTES = new Set([
  'GET /health',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/logout',
]);

function split(route: string): { method: Method; path: string } {
  const [method, path] = route.split(' ');
  return { method: method as Method, path: path ?? '' };
}

function paramsFor(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of path.matchAll(/:([A-Za-z]+)/g)) if (match[1]) out[match[1]] = 'nobody';
  return out;
}

export async function doors(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');

  h.at('doors: every route wants a token');
  for (const route of h.routes) {
    if (OPEN_ROUTES.has(route)) continue;
    const { method, path } = split(route);
    await h.call({
      as: null,
      method,
      route: path,
      params: paramsFor(path),
      ...(method === 'GET' ? {} : { body: {} }),
      expect: 401,
      code: 'UNAUTHORIZED',
    });
  }

  h.at('doors: every write refuses a body that is not JSON');
  for (const route of h.routes) {
    const { method, path } = split(route);
    if (method === 'GET') continue;
    await h.refuse({
      as: a,
      method,
      route: path,
      params: paramsFor(path),
      rawBody: '{"half a thought":',
      expect: 400,
      code: 'VALIDATION_ERROR',
    });
  }

  h.at('doors: an account with no character yet');
  // Every route answers somebody who has signed up and not chosen a character: a refusal or an
  // empty screen, never a fault.
  const drifter: Player = {
    label: 'drifter',
    username: 'pt_drifter',
    password: 'playthrough-pass',
    token: '',
    userId: '',
    baseId: '',
    ip: '10.20.2.1',
  };
  const joined = await h.ok<AuthResponse>({
    as: drifter,
    method: 'POST',
    route: '/api/auth/register',
    body: { username: drifter.username, password: drifter.password },
    expect: 201,
  });
  drifter.token = joined?.token ?? '';
  drifter.userId = joined?.user.id ?? '';
  for (const route of h.routes) {
    if (OPEN_ROUTES.has(route) || route === 'GET /api/events') continue;
    const { method, path } = split(route);
    const reply = await h.call({
      as: drifter,
      method,
      route: path,
      params: paramsFor(path),
      ...(method === 'GET' ? {} : { body: {} }),
      expect: 'any',
    });
    h.check(
      reply.status < 500,
      `${route} answered ${reply.status} to an account with no character`,
    );
  }

  h.at('doors: a read changes nothing the second time');
  const map = await h.ok<CityResponse>({ as: a, method: 'GET', route: '/api/city' });
  const params: Record<string, Record<string, string>> = {
    '/api/base/:id': { id: a.baseId },
    '/api/city/:id': { id: map?.homeDistrictId ?? 'nowhere' },
    '/api/crews/:id': { id: a.baseId },
    '/api/factions/:id/profile': { id: cast.facts.get('faction:ash') ?? 'nobody' },
  };
  const skip = new Set(['GET /api/events', 'GET /api/admin', 'GET /health']);
  for (const route of h.routes) {
    const { method, path } = split(route);
    if (method !== 'GET' || skip.has(route)) continue;
    const expect = route === 'GET /api/overseer/choices' ? 409 : 200;
    const options = { as: a, method, route: path, params: params[path] ?? {}, expect } as const;
    await h.call(options);
    await h.unchanged(options);
  }

  h.at('doors: the admin bench does not exist with admin mode off');
  for (const route of h.routes.filter((one) => one.includes('/api/admin'))) {
    const { method, path } = split(route);
    await h.refuse({
      as: a,
      method,
      route: path,
      ...(method === 'GET'
        ? {}
        : {
            body: { playerLevel: 60, districtId: 'steelbelt', visible: true, units: { razors: 5 } },
          }),
      expect: 404,
      code: 'NOT_FOUND',
    });
  }
}
