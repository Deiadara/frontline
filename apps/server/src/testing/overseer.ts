import {
  findOverseerPreset,
  type OverseerPreset,
  type OverseerChoicesResponse,
} from '@frontline/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

/*
 * Picking a character, the way a client has to since §F6 made the roster a shared pool.
 *
 * A test cannot name a preset any more. There are thirty of them, an account is offered four,
 * and taking one removes it from the pool for every account in the world, so a hardcoded
 * `presetId` is a 409 the moment anything else got there first: the seeder's three rivals, or
 * simply the first of the two accounts a test stands up. Asking what this account is offered and
 * taking one of those is also what the real screen does, which is the other reason to do it here
 * rather than reach past the route into the table.
 */

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

/** What `GET /api/overseer/choices` has left for this account, in the order the screen shows it. */
export async function offeredOverseers(
  app: FastifyInstance,
  token: string,
): Promise<readonly OverseerPreset[]> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/overseer/choices',
    headers: auth(token),
  });
  if (res.statusCode !== 200) {
    throw new Error(`overseer choices: ${res.statusCode} ${res.body.slice(0, 200)}`);
  }
  return res.json<OverseerChoicesResponse>().choices;
}

/**
 * Takes the first character this account is offered, and answers with the route's own response.
 *
 * The response is passed straight back rather than asserted on here, because the callers disagree
 * about what they want from it: most read `base` out of it, a few assert 201 with the body in the
 * message, and one reads the level to prove the sandbox flag. A helper that swallowed it would
 * cost every one of them a second request.
 */
export async function chooseOverseer(
  app: FastifyInstance,
  token: string,
): Promise<LightMyRequestResponse> {
  const [first] = await offeredOverseers(app, token);
  if (!first) throw new Error('overseer pool is empty: nothing left to offer this account');
  return app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: first.presetId },
  });
}

/**
 * Puts a named character's sheet on the account holding `token`.
 *
 * For a test that measures something the Overseer can move and is not itself about §F6. Which of
 * the thirty an account is offered is a hash of a UUID minted at registration, and each carries a
 * signature perk loud enough to decide a number: +20% build speed, -15% build cost, +30% gate
 * defence, +18% on the road. A test comparing two worlds, or checking a duration against a
 * formula, would otherwise pass or fail on the draw. The default is the character every one of
 * these tests was written against before the pool existed.
 *
 * `preset_id` is deliberately left as the route wrote it, so the claim stays whatever the account
 * actually took and migration 0095's unique index cannot be tripped by two worlds pinning the
 * same person. Nothing but the pool reads that column.
 */
export function pinOverseer(app: FastifyInstance, token: string, presetId = 'enforcer'): void {
  const preset = findOverseerPreset(presetId);
  if (!preset) throw new Error(`no such overseer preset: ${presetId}`);
  const userId = app.jwt.decode<{ sub: string }>(token)?.sub;
  if (!userId) throw new Error('pinOverseer: that token names no account');
  const { changes } = app.db
    .prepare(
      `UPDATE overseers
          SET name = ?, archetype = ?, portrait_id = ?, bio = ?, attributes_json = ?, perks_json = ?
        WHERE user_id = ?`,
    )
    .run(
      preset.name,
      preset.archetype,
      preset.portraitId,
      preset.bio,
      JSON.stringify(preset.attributes),
      JSON.stringify(preset.perks),
      userId,
    );
  if (changes !== 1) throw new Error(`pinOverseer: ${userId} has no character to pin`);
}
