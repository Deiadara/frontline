/**
 * The Combine's and the squatters' ground at the edges (bug pass, 2026-09-29).
 *
 * Reliquary is authored in the atlas and shut (`CITIES`, `open: false`): no art, no board, no way
 * onto its map in the client. The declaration only asked whether the district existed, so a crafted
 * call took the squatters' ferry there with a column that marched two hours to reach it, and the
 * crew held ground in a city nobody else could see.
 */
import { declarationWindow } from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { auth, closeWorlds, makeWorld, register } from '../testing/fight-world.js';

afterEach(closeWorlds);

async function call(target: object) {
  const world = await makeWorld('attacker');
  const crew = await register(world, 'pilgrim', { razors: 50 });
  const res = await world.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(crew.token),
    payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  return { res, pending: world.app.repos.sieges.pending() };
}

describe('a city that is not open', () => {
  it('takes no call on the squatters’ ground in it', async () => {
    const { res, pending } = await call({
      kind: 'location',
      districtId: 'candlemarket',
      locationId: 'candlemarket-waxstalls',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/not open/i);
    expect(pending).toHaveLength(0);
  });

  it('takes no call on an armed gate in it', async () => {
    const { res, pending } = await call({ kind: 'gate', districtId: 'gravefields' });
    expect(res.statusCode).toBe(409);
    expect(pending).toHaveLength(0);
  });

  it('still takes a call in an open city', async () => {
    const { res, pending } = await call({
      kind: 'location',
      districtId: 'coldwater-halt',
      locationId: 'coldwater-halt-signal',
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(pending).toHaveLength(1);
  });
});
