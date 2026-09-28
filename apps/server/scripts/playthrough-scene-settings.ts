/**
 * The account's own record, and the sessions that open and close on it.
 */
import type { AuthResponse, SettingsResponse } from '@frontline/shared';
import type { Harness } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { DAY } from './playthrough-helpers.js';

export async function settings(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const b = player(cast, 'B');

  h.at('settings: reading and the tutorial');
  const read = await h.ok<SettingsResponse>({ as: a, method: 'GET', route: '/api/settings' });
  h.check(read?.user.id === a.userId, 'settings answered with another account');
  const once = await h.ok<SettingsResponse>({
    as: a,
    method: 'POST',
    route: '/api/settings/tutorial',
    body: { steps: ['welcome', 'city'] },
  });
  const twice = await h.ok<SettingsResponse>({
    as: a,
    method: 'POST',
    route: '/api/settings/tutorial',
    body: { steps: ['city', 'missions'] },
  });
  h.check(
    ['welcome', 'city'].every((step) => once?.user.tutorialSeen.includes(step)),
    'the tutorial steps were not remembered',
  );
  h.check(
    ['welcome', 'city', 'missions'].every((step) => twice?.user.tutorialSeen.includes(step)) &&
      new Set(twice?.user.tutorialSeen).size === twice?.user.tutorialSeen.length,
    `marking steps seen is not a union: ${JSON.stringify(twice?.user.tutorialSeen)}`,
  );
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/settings/tutorial',
    body: { steps: [] },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(a, '/api/settings/tutorial', { steps: 'welcome' });

  h.at('settings: the profile');
  const profiled = await h.ok<SettingsResponse>({
    as: a,
    method: 'PATCH',
    route: '/api/settings/profile',
    body: {
      displayName: 'Alba of the Ash',
      icon: 'eye',
      timezone: 'Europe/London',
      soundVolume: 30,
    },
  });
  h.check(
    profiled?.user.displayName === 'Alba of the Ash' &&
      profiled.user.icon === 'eye' &&
      profiled.user.timezone === 'Europe/London' &&
      profiled.user.soundVolume === 30,
    `the profile change did not stick: ${JSON.stringify(profiled?.user)}`,
  );
  await h.refuse({
    as: a,
    method: 'PATCH',
    route: '/api/settings/profile',
    body: {},
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: a,
    method: 'PATCH',
    route: '/api/settings/profile',
    body: { username: b.username },
    expect: 409,
    code: 'USERNAME_TAKEN',
  });
  await h.refuse({
    as: a,
    method: 'PATCH',
    route: '/api/settings/profile',
    body: { timezone: 'Mars/Olympus' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: a,
    method: 'PATCH',
    route: '/api/settings/profile',
    body: { soundVolume: 1000 },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: a,
    method: 'PATCH',
    route: '/api/settings/profile',
    body: { icon: 'crown-of-thorns' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(a, '/api/settings/profile', { displayName: 42 }, 'PATCH');

  // A rename is a new sign-in name; the old one stops working and the new one works.
  const renamed = 'pt_alba_renamed';
  await h.ok({
    as: a,
    method: 'PATCH',
    route: '/api/settings/profile',
    body: { username: renamed },
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/auth/login',
    body: { username: a.username, password: a.password },
    expect: 401,
    code: 'INVALID_CREDENTIALS',
  });
  await h.ok<AuthResponse>({
    as: a,
    method: 'POST',
    route: '/api/auth/login',
    body: { username: renamed, password: a.password },
  });
  await h.ok({
    as: a,
    method: 'PATCH',
    route: '/api/settings/profile',
    body: { username: a.username },
  });
  // Re-saving your own name is not a clash.
  await h.ok({
    as: a,
    method: 'PATCH',
    route: '/api/settings/profile',
    body: { username: a.username },
  });
}

/**
 * The end of the run for sessions: a renewal handed out after a day, a password change that ends
 * every other session, and "log out everywhere".
 */
export async function sessions(h: Harness, cast: Cast): Promise<void> {
  const c = player(cast, 'C');
  const d = player(cast, 'D');

  h.at('sessions: a token over a day old is renewed');
  const stale = c.token;
  h.advance(DAY + 60_000);
  const reply = await h.call({ as: c, method: 'GET', route: '/api/me', expect: 200 });
  const renewed = reply.headers.get('x-session-token');
  h.check(renewed !== null && renewed !== stale, 'a token signed over a day ago was not renewed');
  // The renewed token works, and so does the old one until it expires: renewal is not revocation.
  await h.call({ as: c, method: 'GET', route: '/api/me', expect: 200 });
  await h.call({ as: c, method: 'GET', route: '/api/me', token: stale, expect: 200 });

  h.at('sessions: a password change ends every other session');
  const other = await h.ok<AuthResponse>({
    as: d,
    method: 'POST',
    route: '/api/auth/login',
    body: { username: d.username, password: d.password },
  });
  const secondTab = other?.token ?? '';
  await h.refuse({
    as: d,
    method: 'POST',
    route: '/api/settings/password',
    body: { newPassword: 'short' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(d, '/api/settings/password', { newPassword: 12345678 });
  const changed = await h.call<SettingsResponse>({
    as: d,
    method: 'POST',
    route: '/api/settings/password',
    body: { newPassword: 'a-new-password-1' },
    expect: 200,
  });
  h.check(
    changed.headers.get('x-session-token') !== null,
    'a password change handed this tab no new token',
  );
  await h.call({
    as: d,
    method: 'GET',
    route: '/api/me',
    token: secondTab,
    expect: 401,
    code: 'UNAUTHORIZED',
  });
  await h.call({ as: d, method: 'GET', route: '/api/me', expect: 200 });
  await h.refuse({
    as: d,
    method: 'POST',
    route: '/api/auth/login',
    body: { username: d.username, password: d.password },
    expect: 401,
    code: 'INVALID_CREDENTIALS',
  });
  d.password = 'a-new-password-1';
  await h.ok({
    as: d,
    method: 'POST',
    route: '/api/auth/login',
    body: { username: d.username, password: d.password },
  });

  h.at('sessions: log out everywhere');
  const before = c.token;
  const out = await h.call({ as: c, method: 'POST', route: '/api/auth/logout-all', expect: 200 });
  h.check(
    out.headers.get('x-session-token') !== null,
    'log out everywhere handed this tab no new token',
  );
  await h.call({
    as: c,
    method: 'GET',
    route: '/api/me',
    token: before,
    expect: 401,
    code: 'UNAUTHORIZED',
  });
  await h.call({ as: c, method: 'GET', route: '/api/me', expect: 200 });
  await h.call({
    as: null,
    method: 'POST',
    route: '/api/auth/logout-all',
    expect: 401,
    code: 'UNAUTHORIZED',
  });
}
