import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import {
  CITY_DISTRICTS,
  MISC_AREA_ID,
  STARTING_RESOURCES,
  TERMINUS_CITY_ID,
  cityOfDistrict,
  declarationWindow,
  findMissionTemplate,
  randomBadge,
} from '@frontline/shared';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { postOffer } from '../market/board.js';
import { chooseOverseer } from '../testing/overseer.js';
import { settleMoves } from '../moves/moves.js';
import { settleWorld } from '../world/settle.js';
import { unitsAbroad } from '../district/unit-slots.js';
import { launchMission } from '../missions/launch.js';
import { settleAndResolveMissions } from '../missions/resolve.js';

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

async function console_(cityId?: string): Promise<{
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
  districtId: string;
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
  const chosen = await chooseOverseer(app, token, cityId);
  const base = chosen.json<{ base: { id: string; districtId: string } }>().base;
  return { app, db, token, baseId: base.id, districtId: base.districtId };
}

describe('the console wipes a crew', () => {
  it('empties a crew that has already played, and hands back its ground', async () => {
    const { app, db, token, baseId } = await console_();

    /*
     * Play first. This is the whole point of the test.
     *
     * The End game preset is the heaviest thing the console can do to a crew: it maxes every
     * structure, finishes all thirteen programmes, fills the inventory with every document and part,
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
    // Thirteen chairs, ten rungs each, since the chair rework (2026-10-04).
    expect(played.research.technologies.length).toBe(130);

    /*
     * The ground, counted in the table rather than off `/api/city`.
     *
     * The table is the thing under test: the first cut of this read the city route, which then
     * hid districts the crew had not seen, read zero before the wipe and passed the one after it
     * for entirely the wrong reason.
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
     * Put the crew on a location first, because creation does not: a new crew owns nothing in the
     * city. The first cut of this assumed otherwise and asserted "holds ground before the wipe"
     * against a crew that never had any, which would have passed the release assertion afterwards
     * no matter what the route did.
     */
    const somewhere = CITY_DISTRICTS.flatMap((one) => one.locations)[0]!;
    const control = app.repos.city.control(somewhere.id)!;
    app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
    expect(heldRows(), 'the crew holds ground before the wipe').toBeGreaterThan(0);

    /*
     * The three things keyed on the id that no cascade reaches, because the row is never deleted.
     *
     * Feats: a lifetime counter and a collected rung. Without the wipe the fresh crew opened its
     * feats screen on "units mustered: 5" and a rung it could not collect twice. The market: a
     * standing listing whose escrow, on the ordinary close, would have been credited to the fresh
     * stockpile two days later.
     */
    app.repos.feats.bump(baseId, 'units_mustered', 5);
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
    // And goods the board is holding for the old life (2026-09-28): claimed after the wipe, they
    // would land in the fresh stockpile exactly as the listing's escrow would have.
    app.repos.market.insertClaim({
      id: 'held-for-the-old-life',
      baseId,
      offer: listed.offer!,
      reason: 'expired',
      goods: { resources: { scrap: 25 }, items: {} },
      takenBy: null,
      createdAt: new Date().toISOString(),
      claimUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });
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
    expect(app.repos.market.claimsFor(baseId), 'the board holds nothing for the old life').toEqual(
      [],
    );

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

    // And the ledger and the board forgot the old life.
    expect(app.repos.feats.tallies(baseId), 'no lifetime counts carried over').toEqual({});
    expect(app.repos.feats.claimed(baseId).size, 'no collected rung carried over').toBe(0);
    expect(app.repos.market.openBySeller(baseId), 'no listing still standing').toEqual([]);
    // Closed without the escrow coming home: the stockpile is the starting one, not the starting
    // one plus twenty-five scrap the old life had posted.
    expect(wiped!.resources).toEqual(STARTING_RESOURCES);
  });

  /**
   * The old life's people, standing or walking anywhere but home (bug pass, 2026-09-29).
   *
   * Posted units, a planted Sleeper cell and a column on the way to held ground were none of them
   * on the base row, so the rewrite left all three. They drew beds off the fresh crew, and the
   * column re-took the released location on arrival: the ground came back after the ground was
   * handed back. The standing orders named the old crew's officers.
   */
  it('takes the old life off the map as well as off the base', async () => {
    const { app, token, baseId } = await console_();
    const [held, posted, planted] = CITY_DISTRICTS.flatMap((one) => one.locations);
    const now = new Date();
    const soon = new Date(now.getTime() + 60_000).toISOString();
    const control = app.repos.city.control(held!.id)!;
    app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });

    app.repos.alliedGarrisons.set(posted!.id, baseId, { razors: 30 });
    app.repos.sleepers.insert({
      id: 'old-life-cell',
      baseId,
      locationId: planted!.id,
      army: { sleepers: 4 },
      phase: 'waiting',
      departedAt: now.toISOString(),
      arrivesAt: now.toISOString(),
      travelMs: 0,
    });
    app.repos.moves.insert({
      id: 'old-life-column',
      baseId,
      from: { kind: 'district' },
      to: { kind: 'location', locationId: held!.id },
      army: { razors: 12 },
      vehicles: {},
      departedAt: now.toISOString(),
      arrivesAt: soon,
      travelMinutes: 1,
      recalledAt: null,
    });
    app.repos.automations.put({
      id: 'old-life-order',
      baseId,
      slot: 0,
      kind: 'missions',
      enabled: true,
      order: 'missions',
      step: 0,
      force: { razors: 5 },
      officerId: null,
      unitSlots: null,
      optimiseFor: null,
      missionId: null,
      restingSince: null,
      stalled: null,
    });
    expect(Object.keys(unitsAbroad(app.repos, app.repos.bases.findById(baseId)!))).toEqual(
      expect.arrayContaining(['razors', 'sleepers']),
    );

    const reset = await app.inject({
      method: 'POST',
      url: '/api/admin/reset',
      headers: auth(token),
      payload: {},
    });
    expect(reset.statusCode, reset.body).toBe(200);

    const wiped = app.repos.bases.findById(baseId)!;
    expect(unitsAbroad(app.repos, wiped), 'nothing of the old life draws beds').toEqual({});
    expect(app.repos.alliedGarrisons.forBase(baseId)).toEqual([]);
    expect(app.repos.sleepers.forBase(baseId)).toEqual([]);
    expect(app.repos.automations.forBase(baseId)).toEqual([]);

    // The column's arrival time passes and the released ground stays released.
    settleMoves(app.repos, new Date(Date.parse(soon) + 1_000));
    expect(app.repos.city.control(held!.id)?.holder).toEqual({ kind: 'unoccupied' });
  });

  /*
   * Bug pass, 2026-09-29: a fight called on the old crew's ground outlived the reset and landed on
   * the fresh crew, which was then credited with defending and winning it, feats and XP included.
   */
  it('calls off the fights the old life was in, and tells the other side', async () => {
    const { app, token, baseId } = await console_();
    const rival = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'caller', password: 'hunter2pass' },
    });
    await chooseOverseer(app, rival.json<{ token: string }>().token);
    const called = await app.inject({
      method: 'POST',
      url: '/api/admin/mock-battle',
      headers: auth(token),
      payload: {},
    });
    expect(called.statusCode, called.body.slice(0, 200)).toBe(200);
    const mine = () =>
      app.repos.sieges
        .pending()
        .filter(
          (battle) =>
            battle.attackerBaseId === baseId ||
            (battle.defender.kind === 'crew' && battle.defender.baseId === baseId),
        );
    const [fight] = mine();
    expect(fight, 'the console called a fight on the crew').toBeDefined();

    const reset = await app.inject({
      method: 'POST',
      url: '/api/admin/reset',
      headers: auth(token),
      payload: {},
    });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(mine()).toEqual([]);

    // Well past the mark: nothing lands on the fresh crew.
    settleWorld(
      app.repos,
      app.skirmishEngine,
      new Date(Date.parse(fight!.scheduledFor) + 3_600_000),
    );
    expect(app.repos.sieges.resolvedFor(baseId, 10).filter((row) => row.analysis !== null)).toEqual(
      [],
    );
    expect(app.repos.feats.tallies(baseId)).not.toHaveProperty('battles_fought');
    const told = app.repos.social.notifications(
      app.repos.bases.findById(fight!.attackerBaseId)!.ownerId,
      20,
    );
    expect(told.map((note) => note.title)).toContain('The fight was called off');
  });

  /*
   * Bug pass, 2026-09-29: a raid names no crew on its defending row, so the reset saw neither a
   * raid on the old crew's home (it was left standing and landed on the fresh crew) nor, when the
   * old crew was the raider, the resident it was called on (who was never told it was off).
   */
  describe('a raid', () => {
    const AWAY = 'ashen-terraces';

    async function raidWorld() {
      const world = await console_();
      expect(world.districtId, 'the reviewer must live somewhere else').not.toBe(AWAY);
      const registered = await world.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'neighbour', password: 'hunter2pass' },
      });
      const rivalToken = registered.json<{ token: string }>().token;
      const chosen = await chooseOverseer(world.app, rivalToken);
      const rivalBase = chosen.json<{ base: { id: string } }>().base.id;
      world.db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(AWAY, rivalBase);
      const rival = world.app.repos.bases.findById(rivalBase)!;
      return { ...world, rivalToken, rival };
    }

    async function raid(app: FastifyInstance, token: string, districtId: string) {
      app.repos.sieges.breakGate(districtId, new Date(Date.now() + 24 * 3_600_000).toISOString());
      const called = await app.inject({
        method: 'POST',
        url: '/api/battles/declare',
        headers: auth(token),
        payload: {
          target: { kind: 'district', districtId },
          scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
        },
      });
      expect(called.statusCode, called.body.slice(0, 300)).toBe(200);
    }

    const reset = (app: FastifyInstance, token: string) =>
      app.inject({ method: 'POST', url: '/api/admin/reset', headers: auth(token), payload: {} });

    it('the old life called is called off, and the resident is told who started over', async () => {
      const { app, token, baseId, rival } = await raidWorld();
      await raid(app, token, AWAY);
      const crewName = app.repos.bases.findById(baseId)!.name;

      expect((await reset(app, token)).statusCode).toBe(200);

      expect(app.repos.sieges.pending()).toEqual([]);
      const told = app.repos.social.notifications(rival.ownerId, 20);
      const off = told.find((note) => note.title === 'The fight was called off');
      expect(off?.body).toContain(`${crewName} started over from nothing`);
    });

    it('on the old life’s home is called off rather than landing on the fresh crew', async () => {
      const { app, token, districtId, rivalToken, rival } = await raidWorld();
      await raid(app, rivalToken, districtId);
      expect(app.repos.sieges.pending()).toHaveLength(1);

      expect((await reset(app, token)).statusCode).toBe(200);

      expect(app.repos.sieges.pending()).toEqual([]);
      const told = app.repos.social.notifications(rival.ownerId, 20);
      expect(told.map((note) => note.title)).toContain('The fight was called off');
    });
  });

  /**
   * Forfeit everything (maintainer ruling, 2026-09-29): a mission out, a spy job out, a seat at a
   * faction's table and a side in somebody else's fight all belonged to the old life, and each one
   * used to reach the fresh crew: the run came home with its haul and its people, the spies wrote
   * their report, the account stayed at the table (as its leader), and the ally's fight paid the
   * fresh crew for a battle it never saw.
   */
  describe('forfeits what the old life had in flight', () => {
    const reset = (app: FastifyInstance, token: string) =>
      app.inject({ method: 'POST', url: '/api/admin/reset', headers: auth(token), payload: {} });

    async function another(app: FastifyInstance, username: string) {
      const registered = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username, password: 'hunter2pass' },
      });
      const { token, user } = registered.json<{ token: string; user: { id: string } }>();
      const chosen = await chooseOverseer(app, token);
      return { token, userId: user.id, baseId: chosen.json<{ base: { id: string } }>().base.id };
    }

    it('a mission and a spy job out come home to nobody, with nothing found', async () => {
      const { app, token, baseId } = await console_();
      const base = app.repos.bases.findById(baseId)!;
      const overseer = app.repos.overseers.findById(
        app.repos.users.findById(base.ownerId)!.overseerId!,
      )!;
      // A scrap run rather than a fight: nobody dies on it, so every one of the nine would walk in.
      const template = findMissionTemplate('scrap-run')!;
      const now = new Date();
      app.repos.missions.insert(
        launchMission({
          id: 'old-life-run',
          base: { ...base, army: { razors: 9 } },
          template,
          areaId: MISC_AREA_ID,
          force: { razors: 9 },
          now,
          leader: { kind: 'overseer', id: overseer.id, attributes: overseer.attributes },
          grade: template.grades[0],
        }),
      );
      app.repos.spying.insert({
        id: 'old-life-spies',
        baseId,
        target: { kind: 'gate', districtId: 'blacksite' },
        tier: 'loose_ears',
        capsPaid: 100,
        departedAt: now.toISOString(),
        returnsAt: new Date(now.getTime() + 60_000).toISOString(),
        travelMinutes: 1,
        recalledAt: null,
        chairPoints: null,
        intelPercent: null,
      });
      expect(app.repos.missions.listActiveByBaseId(baseId)).toHaveLength(1);
      expect(app.repos.spying.activeFor(baseId)).toHaveLength(1);

      expect((await reset(app, token)).statusCode).toBe(200);
      expect(app.repos.missions.listActiveByBaseId(baseId)).toEqual([]);
      expect(app.repos.spying.activeFor(baseId)).toEqual([]);

      /*
       * The player picks again and the day moves on, when both would long since have come home.
       * The world clock skips a crew with no character, so the settle is asked for directly too.
       */
      expect((await chooseOverseer(app, token)).statusCode).toBe(201);
      const later = new Date(now.getTime() + 24 * 3_600_000);
      settleWorld(app.repos, app.skirmishEngine, later);
      settleAndResolveMissions(app.repos, app.repos.bases.findById(baseId)!, later);
      const fresh = app.repos.bases.findById(baseId)!;
      expect(fresh.army, 'nobody walked in from the old run').toEqual({ scavengers: 8 });
      expect(fresh.inventory, 'no salvage').toEqual({});
      expect(app.repos.missions.listByBaseId(baseId), 'no report on the missions screen').toEqual(
        [],
      );
      expect(app.repos.spying.reportsFor(baseId, 10), 'no spy report').toEqual([]);
      const tallies = app.repos.feats.tallies(baseId);
      for (const measure of ['missions_done', 'spy_jobs_returned', 'spy_reports']) {
        expect(tallies, `no ${measure} credited`).not.toHaveProperty(measure);
      }
    });

    it('a member walks out of the faction, and the table is told', async () => {
      const { app, token } = await console_();
      const leader = await another(app, 'founder');
      const me = app.repos.users.findByUsername('reviewer')!;
      const factionId = 'the-old-table';
      const at = new Date().toISOString();
      app.repos.factions.insert({
        id: factionId,
        name: 'The Old Table',
        badge: randomBadge(3),
        blurb: '',
        foundedAt: at,
      });
      app.repos.factions.addMember({
        userId: leader.userId,
        factionId,
        rank: 'leader',
        joinedAt: at,
      });
      app.repos.factions.addMember({ userId: me.id, factionId, rank: 'member', joinedAt: at });

      expect((await reset(app, token)).statusCode).toBe(200);

      expect(app.repos.factions.membershipOf(me.id)).toBeUndefined();
      expect(app.repos.factions.members(factionId).map((row) => row.userId)).toEqual([
        leader.userId,
      ]);
      const told = app.repos.social.notifications(leader.userId, 20).map((note) => note.title);
      expect(told).toContain('reviewer has left the faction');
    });

    it('a leader walking out takes the faction with them, as leaving always has', async () => {
      const { app, token } = await console_();
      const member = await another(app, 'follower');
      const me = app.repos.users.findByUsername('reviewer')!;
      const factionId = 'the-led-table';
      const at = new Date().toISOString();
      app.repos.factions.insert({
        id: factionId,
        name: 'The Led Table',
        badge: randomBadge(5),
        blurb: '',
        foundedAt: at,
      });
      app.repos.factions.addMember({ userId: me.id, factionId, rank: 'leader', joinedAt: at });
      app.repos.factions.addMember({
        userId: member.userId,
        factionId,
        rank: 'chief',
        joinedAt: at,
      });

      expect((await reset(app, token)).statusCode).toBe(200);

      expect(
        app.repos.factions.membershipOf(me.id),
        'no fresh crew leads a faction',
      ).toBeUndefined();
      expect(app.repos.factions.membershipOf(member.userId)).toBeUndefined();
      expect(app.repos.factions.all().map((faction) => faction.id)).not.toContain(factionId);
      const told = app.repos.social.notifications(member.userId, 20).map((note) => note.title);
      expect(told).toContain('reviewer disbanded the faction');
    });

    /** Maintainer, 2026-09-30: Clean slate takes the same successor the Leave door does. */
    it('a leader who names a successor leaves the faction standing under them', async () => {
      const { app, token } = await console_();
      const member = await another(app, 'follower');
      const me = app.repos.users.findByUsername('reviewer')!;
      const factionId = 'the-handed-table';
      const at = new Date().toISOString();
      app.repos.factions.insert({
        id: factionId,
        name: 'The Handed Table',
        badge: randomBadge(7),
        blurb: '',
        foundedAt: at,
      });
      app.repos.factions.addMember({ userId: me.id, factionId, rank: 'leader', joinedAt: at });
      app.repos.factions.addMember({
        userId: member.userId,
        factionId,
        rank: 'member',
        joinedAt: at,
      });

      const wiped = await app.inject({
        method: 'POST',
        url: '/api/admin/reset',
        headers: auth(token),
        payload: { successorId: member.userId },
      });
      expect(wiped.statusCode, wiped.body.slice(0, 200)).toBe(200);

      expect(app.repos.factions.membershipOf(me.id)).toBeUndefined();
      expect(app.repos.factions.membershipOf(member.userId)?.rank).toBe('leader');
      const told = app.repos.social.notifications(member.userId, 20).map((note) => note.title);
      expect(told).toContain('You lead the faction now');
      expect(told).not.toContain('reviewer disbanded the faction');
    });

    it('its people leave a fight it joined as an ally, and the fight goes on without them', async () => {
      const { app, db, token, baseId } = await console_();
      const caller = await another(app, 'caller');
      const holder = await another(app, 'holder');
      // The Console calls the fight on whoever asks, with a bot as the caller when there is one.
      db.prepare('UPDATE bases SET is_bot = 1 WHERE id = ?').run(caller.baseId);
      const called = await app.inject({
        method: 'POST',
        url: '/api/admin/mock-battle',
        headers: auth(holder.token),
        payload: {},
      });
      expect(called.statusCode, called.body.slice(0, 200)).toBe(200);
      const [fight] = app.repos.sieges.pending();
      expect(fight?.attackerBaseId, 'fixture: the caller called it').toBe(caller.baseId);
      const theirs = app.repos.sieges.deployment(fight!.id, 'attacker', caller.baseId)!;
      app.repos.sieges.putDeployment({ ...theirs, baseId, army: { razors: 6 } });
      expect(app.repos.sieges.deploymentsFor(baseId)).toHaveLength(1);

      expect((await reset(app, token)).statusCode).toBe(200);

      expect(app.repos.sieges.deploymentsFor(baseId)).toEqual([]);
      expect(
        app.repos.sieges.pending().map((one) => one.id),
        'the fight is the ally’s',
      ).toEqual([fight!.id]);
      const told = app.repos.social.notifications(caller.userId, 20).map((note) => note.title);
      expect(told).toContain('An ally left the fight');

      // The player picks again, the fight runs, and a day later everybody is long home.
      expect((await chooseOverseer(app, token)).statusCode).toBe(201);
      const mark = Date.parse(fight!.scheduledFor);
      settleWorld(app.repos, app.skirmishEngine, new Date(mark + 3_600_000));
      settleMoves(app.repos, new Date(mark + 24 * 3_600_000));
      settleWorld(app.repos, app.skirmishEngine, new Date(mark + 24 * 3_600_000));
      expect(app.repos.bases.findById(baseId)!.army).toEqual({ scavengers: 8 });
      expect(app.repos.sieges.resolvedFor(baseId, 10), 'not in the fresh crew’s reports').toEqual(
        [],
      );
      expect(app.repos.feats.tallies(baseId)).not.toHaveProperty('battles_fought');
    });
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

  /**
   * ...and the same district means the same *address*.
   *
   * `POST /overseer` says in as many words that "a reset crew keeps its old address", and it is
   * right to: the plot it is standing on is still its own, and moving would mean vacating one city
   * and racing for a plot in another to arrive back at the same starting state. The reset did not
   * keep it. `startingBase` defaults `districtId` to {@link STARTER_DISTRICT_ID} and this route
   * passed none, so Clean slate teleported every crew in the world to Kettle Row: a Terminus
   * player lost the city they picked at the character screen, and if somebody already lived on
   * Kettle Row the two ended up on one plot, where `residentOf` answers for one of them and the
   * other's home cannot be called or defended.
   */
  it('leaves the crew standing in the city it picked', async () => {
    const { app, token, districtId } = await console_(TERMINUS_CITY_ID);
    expect(cityOfDistrict(districtId), 'fixture error: not in Terminus').toBe(TERMINUS_CITY_ID);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/admin/reset',
      headers: auth(token),
      payload: {},
    });
    expect(reset.statusCode, reset.body).toBe(200);

    await chooseOverseer(app, token);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(me.json<{ base: { districtId: string } }>().base.districtId).toBe(districtId);
  });
});
