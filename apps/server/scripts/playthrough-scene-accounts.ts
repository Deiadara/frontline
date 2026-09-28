/**
 * Accounts and the first five minutes: register, sign in, pick a character and a city.
 */
import {
  cityOfDistrict,
  type AuthResponse,
  type CreateOverseerResponse,
  type MeResponse,
  type OverseerChoicesResponse,
} from '@frontline/shared';
import type { Harness, Player } from './playthrough-harness.js';
import type { Cast, Label } from './playthrough-cast.js';

const PASSWORD = 'playthrough-pass';

interface Newcomer {
  label: Label;
  username: string;
  city: string;
}

/** Two crews in each open city, and a fifth in Ashfall kept for the destructive steps. */
const NEWCOMERS: readonly Newcomer[] = [
  { label: 'A', username: 'pt_alba', city: 'ashfall' },
  { label: 'B', username: 'pt_brask', city: 'ashfall' },
  { label: 'C', username: 'pt_corvo', city: 'terminus' },
  { label: 'D', username: 'pt_dune', city: 'terminus' },
  { label: 'E', username: 'pt_ember', city: 'ashfall' },
];

export async function accounts(h: Harness, cast: Cast): Promise<void> {
  h.at('accounts: the door');
  await h.ok({ as: null, method: 'GET', route: '/health' });
  await h.call({ as: null, method: 'GET', route: '/api/me', expect: 401, code: 'UNAUTHORIZED' });
  await h.call({
    as: null,
    method: 'GET',
    route: '/api/me',
    token: 'not.a.token',
    expect: 401,
    code: 'UNAUTHORIZED',
  });

  h.at('accounts: register');
  const pending: Player[] = [];
  for (const [index, newcomer] of NEWCOMERS.entries()) {
    const ip = `10.20.0.${index + 1}`;
    const probe: Player = {
      label: newcomer.label,
      username: newcomer.username,
      password: PASSWORD,
      token: '',
      userId: '',
      baseId: '',
      ip,
    };
    const registered = await h.ok<AuthResponse>({
      as: probe,
      method: 'POST',
      route: '/api/auth/register',
      body: { username: newcomer.username, password: PASSWORD },
      expect: 201,
    });
    h.check(
      registered.user.username === newcomer.username,
      `register answered with user ${registered.user.username}, not ${newcomer.username}`,
    );
    h.check(registered.user.overseerId === null, 'a new account already has a character');
    probe.token = registered.token;
    probe.userId = registered.user.id;
    pending.push(probe);
  }
  const [first] = pending;
  if (!first) return;

  h.at('accounts: bad registrations');
  // Names are one name whatever the case: "PT_ALBA" is "pt_alba".
  await h.refuse({
    as: first,
    method: 'POST',
    route: '/api/auth/register',
    body: { username: first.username.toUpperCase(), password: PASSWORD },
    expect: 409,
    code: 'USERNAME_TAKEN',
  });
  await h.refuse({
    as: first,
    method: 'POST',
    route: '/api/auth/register',
    body: { username: first.username, password: PASSWORD },
    expect: 409,
    code: 'USERNAME_TAKEN',
  });
  await h.refuse({
    as: first,
    method: 'POST',
    route: '/api/auth/register',
    body: { username: 'x!', password: PASSWORD },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: first,
    method: 'POST',
    route: '/api/auth/register',
    body: { username: 'pt_short', password: 'short' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: first,
    method: 'POST',
    route: '/api/auth/register',
    rawBody: '{"username":',
    expect: 400,
    code: 'VALIDATION_ERROR',
  });

  h.at('accounts: sign in');
  await h.refuse({
    as: first,
    method: 'POST',
    route: '/api/auth/login',
    body: { username: first.username, password: 'wrong-password' },
    expect: 401,
    code: 'INVALID_CREDENTIALS',
  });
  await h.refuse({
    as: first,
    method: 'POST',
    route: '/api/auth/login',
    body: { username: 'pt_nobody_at_all', password: PASSWORD },
    expect: 401,
    code: 'INVALID_CREDENTIALS',
  });
  await h.refuse({
    as: first,
    method: 'POST',
    route: '/api/auth/login',
    body: { username: first.username },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  const login = await h.ok<AuthResponse>({
    as: first,
    method: 'POST',
    route: '/api/auth/login',
    body: { username: first.username, password: PASSWORD },
  });
  h.check(login.user.id === first.userId, 'sign-in answered with a different account');
  first.token = login.token;

  h.at('accounts: before a character');
  const bare = await h.ok<MeResponse>({ as: first, method: 'GET', route: '/api/me' });
  h.check(bare.base === null && bare.overseer === null, 'an account with no character has a base');
  await h.call({ as: first, method: 'GET', route: '/api/units', expect: 409, code: 'NO_BASE' });
  await h.refuse({
    as: first,
    method: 'POST',
    route: '/api/base/build',
    body: { kind: 'generator' },
    expect: 409,
    code: 'NO_BASE',
  });

  h.at('accounts: choose a character');
  const offers = new Map<string, OverseerChoicesResponse>();
  for (const newcomer of pending) {
    const offer = await h.ok<OverseerChoicesResponse>({
      as: newcomer,
      method: 'GET',
      route: '/api/overseer/choices',
    });
    offers.set(newcomer.label, offer);
    h.check(offer.choices.length > 0, `${newcomer.label} was offered nobody`);
    // A refresh inside the hold shows the same people.
    const again = await h.ok<OverseerChoicesResponse>({
      as: newcomer,
      method: 'GET',
      route: '/api/overseer/choices',
    });
    h.check(
      JSON.stringify(again.choices.map((one) => one.presetId)) ===
        JSON.stringify(offer.choices.map((one) => one.presetId)),
      `${newcomer.label}'s offer changed on a refresh inside the hold`,
    );
  }
  const heldIds = [...offers.values()].map((offer) => offer.choices.map((one) => one.presetId));
  const overlap = heldIds.flat().length !== new Set(heldIds.flat()).size;
  h.check(!overlap, 'two accounts are being offered the same character at once');

  const [a, b] = pending;
  if (a && b) {
    const bsPick = offers.get(b.label)?.choices[0]?.presetId;
    if (bsPick) {
      await h.refuse({
        as: a,
        method: 'POST',
        route: '/api/overseer',
        body: { presetId: bsPick, cityId: 'ashfall' },
        expect: 409,
        code: 'PRESET_TAKEN',
      });
    }
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/overseer',
      body: { presetId: 'nobody-by-this-name' },
      expect: 400,
      code: 'UNKNOWN_PRESET',
    });
    const mine = offers.get(a.label)?.choices[0]?.presetId ?? 'x';
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/overseer',
      body: { presetId: mine, cityId: 'redline' },
      expect: 400,
      code: 'CITY_UNBUILT',
    });
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/overseer',
      body: { presetId: mine, cityId: 'atlantis' },
      expect: 400,
      code: 'CITY_UNBUILT',
    });
    await h.refuseMalformed(a, '/api/overseer', { presetId: 7 });
  }

  for (const [index, newcomer] of pending.entries()) {
    const spec = NEWCOMERS[index];
    const presetId = offers.get(newcomer.label)?.choices[0]?.presetId;
    if (!spec || !presetId) continue;
    const created = await h.ok<CreateOverseerResponse>({
      as: newcomer,
      method: 'POST',
      route: '/api/overseer',
      body: { presetId, cityId: spec.city },
      expect: 201,
    });
    if (!created?.base) continue;
    h.check(
      cityOfDistrict(created.base.districtId) === spec.city,
      `${newcomer.label} asked for ${spec.city} and was housed in ${cityOfDistrict(created.base.districtId)}`,
    );
    h.check(
      created.user.overseerId === created.overseer.id,
      'the account does not point at its new character',
    );
    newcomer.baseId = created.base.id;
    cast.players.set(spec.label, newcomer);
    h.players.push(newcomer);
  }

  h.at('accounts: a character is chosen once');
  if (a) {
    await h.call({
      as: a,
      method: 'GET',
      route: '/api/overseer/choices',
      expect: 409,
      code: 'OVERSEER_ALREADY_CHOSEN',
    });
    const presetId = offers.get(a.label)?.choices[1]?.presetId ?? 'x';
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/overseer',
      body: { presetId },
      expect: 409,
      code: 'OVERSEER_ALREADY_CHOSEN',
    });
  }

  h.at('accounts: a full city');
  await fillAshfall(h);
}

/**
 * Ashfall has four plots. A, B and E hold three; one more account takes the fourth and the next
 * one is refused, which is the honest race the choose screen is drawn around.
 */
async function fillAshfall(h: Harness): Promise<void> {
  const extras: Player[] = [];
  for (const [index, username] of ['pt_filler', 'pt_latecomer'].entries()) {
    const probe: Player = {
      label: 'E',
      username,
      password: PASSWORD,
      token: '',
      userId: '',
      baseId: '',
      ip: `10.20.1.${index + 1}`,
    };
    const registered = await h.ok<AuthResponse>({
      as: probe,
      method: 'POST',
      route: '/api/auth/register',
      body: { username, password: PASSWORD },
      expect: 201,
    });
    probe.token = registered.token;
    probe.userId = registered.user.id;
    extras.push(probe);
  }
  const [filler, latecomer] = extras;
  if (!filler || !latecomer) return;
  const fillerOffer = await h.ok<OverseerChoicesResponse>({
    as: filler,
    method: 'GET',
    route: '/api/overseer/choices',
  });
  const ashfall = fillerOffer.cities.find((city) => city.cityId === 'ashfall');
  h.check(
    ashfall?.free === 1,
    `Ashfall should have one free plot left, the offer says ${ashfall?.free}`,
  );
  await h.ok({
    as: filler,
    method: 'POST',
    route: '/api/overseer',
    body: { presetId: fillerOffer.choices[0]?.presetId ?? 'x', cityId: 'ashfall' },
    expect: 201,
  });
  const lateOffer = await h.ok<OverseerChoicesResponse>({
    as: latecomer,
    method: 'GET',
    route: '/api/overseer/choices',
  });
  h.check(
    lateOffer.cities.find((city) => city.cityId === 'ashfall')?.available === false,
    'a full Ashfall is still offered as available',
  );
  await h.refuse({
    as: latecomer,
    method: 'POST',
    route: '/api/overseer',
    body: { presetId: lateOffer.choices[0]?.presetId ?? 'x', cityId: 'ashfall' },
    expect: 409,
    code: 'CITY_FULL',
  });
}
