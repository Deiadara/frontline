import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { CITY_DISTRICTS, STARTING_RESOURCES } from '@frontline/shared';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { postOffer } from '../market/board.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * Clean slate (maintainer request, 2026-09-14): a crew back to its first second, character and all.
 *
 * The thing worth a real server rather than a unit test is that it **completes**. A base cannot be
 * deleted once the crew has touched anything, because five tables reference `bases(id)` with no
 * `ON DELETE CASCADE`, so the route rewrites the row in place instead. That is the kind of decision
 * a green unit test on a bare fixture would never exercise: the interesting case is a crew that has
 * already played, and it is the one a player pressing this button is always in.
 */
const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function console_(): Promise<{
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
}> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: 'true',
    UNLOCKED: 'false',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'reviewer', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  return { app, db, token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

describe('the console wipes a crew', () => {
  it('empties a crew that has already played, and hands back its ground', async () => {
    const { app, db, token, baseId } = await console_();

    /*
     * Play first. This is the whole point of the test.
     *
     * The End game preset is the heaviest thing the console can do to a crew: it maxes every
     * structure, finishes all nineteen programmes, fills the inventory with every document and part,
     * cuts ten of every trap and puts five of every boost on the shelf. A reset that works on a
     * fresh account and falls over on this one is a reset nobody can use.
     */
    const grant = await app.inject({
      method: 'POST',
      url: '/api/admin/grant',
      headers: auth(token),
      payload: {
        technologies: 'all',
        blueprints: 'all',
        pages: 'all',
        parts: 250,
        consumables: 10,
        boosts: 5,
      },
    });
    expect(grant.statusCode, grant.body).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { buildingLevel: 20, playerLevel: 30, infamy: 25_000 },
    });

    const before = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    const played = before.json<{
      base: { level: number; inventory: Record<string, number>; research: { technologies: [] } };
    }>().base;
    expect(played.level, 'the crew has played').toBe(30);
    expect(Object.keys(played.inventory).length).toBeGreaterThan(20);
    // Eighteen chairs, ten rungs each, since the Scout's chair went on 2026-09-22.
    expect(played.research.technologies.length).toBe(180);

    /*
     * The ground, counted in the table rather than off `/api/city`.
     *
     * The city route answers through the fog: a district nobody has scouted comes back without its
     * locations, so a crew's own holdings can be invisible on the wire while sitting in the
     * database. That made the first cut of this assertion read zero before the wipe and pass the
     * one after it for entirely the wrong reason.
     *
     * `location_control.holder_base_id` is also the exact column the route has to clean, because it
     * carries a base id with **no foreign key**: nothing would cascade it, and a wiped crew would
     * otherwise keep its ground forever. Reading it directly is reading the thing under test.
     */
    const heldRows = (): number =>
      (
        db
          .prepare('SELECT COUNT(*) AS n FROM location_control WHERE holder_base_id = ?')
          .get(baseId) as { n: number }
      ).n;
    /*
     * Put the crew on a location first, because creation does not.
     *
     * `openTheNearestGround` only marks the nearest district *scouted*; a new crew owns nothing in
     * the city. The first cut of this assumed otherwise and asserted "holds ground before the
     * wipe" against a crew that never had any, which would have passed the release assertion
     * afterwards no matter what the route did.
     */
    const somewhere = CITY_DISTRICTS.flatMap((one) => one.locations)[0]!;
    const control = app.repos.city.control(somewhere.id)!;
    app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
    expect(heldRows(), 'the crew holds ground before the wipe').toBeGreaterThan(0);

    /*
     * The three things keyed on the id that no cascade reaches, because the row is never deleted.
     *
     * Feats: a lifetime counter and a collected rung. Without the wipe the fresh crew opened its
     * feats screen on "units trained: 5" and a rung it could not collect twice. The market: a
     * standing listing whose escrow, on the ordinary close, would have been credited to the fresh
     * stockpile two days later. The map: the districts the old life had scouted.
     */
    app.repos.feats.bump(baseId, 'units_trained', 5);
    expect(app.repos.feats.claim(baseId, 'first_blood', new Date().toISOString())).toBe(true);
    const played2 = app.repos.bases.findById(baseId)!;
    const listed = postOffer(
      app.repos,
      played2,
      { resources: { scrap: 25 }, items: {} },
      { resources: { caps: 5 }, items: {} },
      undefined,
      new Date(),
    );
    expect(listed.kind, 'the fixture listing has to post').toBe('done');
    expect(app.repos.market.openBySeller(baseId)).toHaveLength(1);
    expect(
      app.repos.city.scouted(baseId).size,
      'the crew has seen inside somewhere',
    ).toBeGreaterThan(0);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/admin/reset',
      headers: auth(token),
      payload: {},
    });
    expect(reset.statusCode, reset.body).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    const body = after.json<{ overseer: unknown }>();

    // The character is gone, which is what sends the player to the picker. `?? null` because the
    // wire omits the key rather than sending an explicit null, and both mean the same thing here.
    expect(body.overseer ?? null, 'no overseer after a wipe').toBeNull();

    /*
     * The district, read from the repository rather than from `/me`.
     *
     * `/me` answers with no base once there is no overseer, which is correct for the screen it
     * feeds and useless for checking what the wipe left behind: the row is still there, and it is
     * the row this route rewrote. Reading it directly is also what proves the id survived, which
     * is the whole reason the route rewrites instead of deleting.
     */
    const wiped = app.repos.bases.findById(baseId);
    expect(wiped, 'the district row survives the wipe').toBeDefined();
    expect(wiped!.level).toBe(1);
    expect(wiped!.research.technologies).toEqual([]);
    expect(wiped!.inventory).toEqual({});
    expect(wiped!.buildings.map((one) => one.kind).sort()).toEqual(['generator', 'nexus']);
    expect(wiped!.army).toEqual({ scavengers: 8 });
    expect(app.repos.blackMarket.stashFor(baseId), 'the shelf is cleared too').toEqual({});

    // The ground went back to the city rather than staying held by a crew that no longer exists.
    expect(heldRows(), 'nothing is still held by the wiped crew').toBe(0);
    /*
     * ...and the released rows still *read* (maintainer, 2026-09-22: "when I click on clean slate
     * it crashes"). The wipe wrote them back at level 0, one under the schema's floor, and the
     * control table is parsed on every read: the world clock threw on every tick from then on
     * and nothing in this test noticed, because nothing here read the table after the wipe.
     */
    const released = [...app.repos.city.controls().values()];
    expect(released.length, 'the control table is unreadable after the wipe').toBeGreaterThan(0);
    for (const control of released)
      expect(control.level, control.locationId).toBeGreaterThanOrEqual(1);

    // And the ledger, the board and the map forgot the old life.
    expect(app.repos.feats.tallies(baseId), 'no lifetime counts carried over').toEqual({});
    expect(app.repos.feats.claimed(baseId).size, 'no collected rung carried over').toBe(0);
    expect(app.repos.market.openBySeller(baseId), 'no listing still standing').toEqual([]);
    // Closed without the escrow coming home: the stockpile is the starting one, not the starting
    // one plus twenty-five scrap the old life had posted.
    expect(wiped!.resources).toEqual(STARTING_RESOURCES);
    expect(app.repos.city.scouted(baseId).size, 'the map is fogged again').toBe(0);
  });

  /**
   * The other half: picking a character again has to work, and must not mint a second district.
   *
   * Migration 0074 puts a unique index on `bases.owner_id`, so a `POST /overseer` that inserted
   * would fail here rather than quietly duplicating. The route re-attaches to the base the reset
   * emptied, and this is the assertion that says so.
   */
  it('lets the player pick a new character onto the same district', async () => {
    const { app, token, baseId } = await console_();
    await app.inject({
      method: 'POST',
      url: '/api/admin/reset',
      headers: auth(token),
      payload: {},
    });

    const again = await chooseOverseer(app, token);
    expect(again.statusCode, again.body).toBe(201);
    // Whoever the drained pool offered this time, rather than a name: §F6 hands every account a
    // different four, and the one this test dropped a moment ago is back among them.
    const took = again.json<{ overseer: { id: string } }>().overseer;

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    const body = me.json<{
      overseer: { id: string } | null;
      base: { id: string; level: number };
    }>();
    expect(body.overseer?.id, 'the new character took').toBe(took.id);
    expect(body.base.id, 'the same district, not a second one').toBe(baseId);
    expect(body.base.level).toBe(1);
  });
});
