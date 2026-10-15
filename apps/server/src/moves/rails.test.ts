import {
  DEFAULT_BADGE,
  TERMINUS_CITY_ID,
  districtsOfCity,
  featMeasureKey,
  findDistrict,
  railLinkMinutes,
  type MoveQuoteResponse,
  isStation,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { stationsHeldBy } from '../city/railway.js';
import { moveMinutes, railOfferFor, recallMove, sendMove, settleMoves } from './moves.js';

/**
 * Terminus's railway, from the server's side (maintainer, 2026-09-24).
 *
 * `packages/shared/src/city/rails.test.ts` holds the arithmetic. This file holds the half the
 * arithmetic cannot see: that the platforms come off the **live control map**, that a crew holding
 * one platform is not linked, that the machines are left behind, and that the quote offers both
 * clocks so the player is the one who chooses.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

/** The rails out of a platform nobody has worked up. */
const LEVEL_ONE_RIDE = railLinkMinutes(1);

/** Every Station in Terminus, by district, so a test can hand a crew exactly the ones it wants. */
const PLATFORMS = new Map(
  districtsOfCity(TERMINUS_CITY_ID).flatMap((district) => {
    const station = district.locations.find(isStation);
    return station ? [[district.id, station.id] as const] : [];
  }),
);

async function world(): Promise<{
  app: FastifyInstance;
  token: string;
  baseId: string;
}> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'railrider', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  pinOverseer(app, token);
  return { app, token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

/** Hand this crew the named platforms, and stand it in `homeDistrict`. */
function giveStations(
  app: FastifyInstance,
  baseId: string,
  districtIds: readonly string[],
  homeDistrict: string,
): void {
  /*
   * Straight to SQL, and deliberately.
   *
   * `bases.district_id` is written once when a crew is created and there is no repo verb for it:
   * a crew does not move house, which is the maintainer's ruling on how a second city is entered
   * (you march across and take ground). This test needs a crew standing in Terminus anyway, and
   * inventing a relocation verb to get one would be adding a mechanic to make a test convenient.
   */
  app.db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(homeDistrict, baseId);
  for (const districtId of districtIds) {
    const locationId = PLATFORMS.get(districtId);
    expect(locationId, districtId).toBeDefined();
    const control = app.repos.city.control(locationId!);
    expect(control, locationId).toBeDefined();
    app.repos.city.put({ ...control!, holder: { kind: 'crew', baseId }, garrison: {} });
  }
}

describe('which platforms a crew is standing on', () => {
  it('reads them off the live control map rather than off the crew', async () => {
    const { app, baseId } = await world();
    expect(stationsHeldBy(app.repos, app.repos.bases.findById(baseId)!).size).toBe(0);

    giveStations(app, baseId, ['coldwater-halt', 'bonded-row'], 'carriage');
    const held = stationsHeldBy(app.repos, app.repos.bases.findById(baseId)!);
    expect([...held.keys()].sort()).toEqual(['bonded-row', 'coldwater-halt']);

    // Pushed off one, and that node drops out of the line the moment it changes hands.
    const lost = app.repos.city.control(PLATFORMS.get('bonded-row')!)!;
    app.repos.city.put({ ...lost, holder: { kind: 'looters' }, garrison: {} });
    expect([...stationsHeldBy(app.repos, app.repos.bases.findById(baseId)!).keys()]).toEqual([
      'coldwater-halt',
    ]);
  });

  it('reads each platform at the level it has been worked up to', async () => {
    const { app, baseId } = await world();
    giveStations(app, baseId, ['coldwater-halt', 'bonded-row'], 'carriage');
    const halt = app.repos.city.control(PLATFORMS.get('coldwater-halt')!)!;
    app.repos.city.put({ ...halt, level: 3 });
    const held = stationsHeldBy(app.repos, app.repos.bases.findById(baseId)!);
    expect(held.get('coldwater-halt')).toBe(3);
    expect(held.get('bonded-row')).toBe(1);
  });
});

/** A second crew, seated at one table with the first (maintainer, 2026-10-13). */
async function mate(app: FastifyInstance, ownerOf: string): Promise<string> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'railmate', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  pinOverseer(app, token);
  const mateBase = app.repos.bases.findById(chosen.json<{ base: { id: string } }>().base.id)!;
  app.repos.factions.insert({
    id: 'the-line',
    name: 'The Line',
    badge: DEFAULT_BADGE,
    blurb: '',
    foundedAt: '2026-01-01T00:00:00.000Z',
  });
  app.repos.factions.addMember({
    userId: ownerOf,
    factionId: 'the-line',
    rank: 'leader',
    joinedAt: '2026-01-01T00:00:00.000Z',
  });
  app.repos.factions.addMember({
    userId: mateBase.ownerId,
    factionId: 'the-line',
    rank: 'member',
    joinedAt: '2026-01-02T00:00:00.000Z',
  });
  return mateBase.id;
}

describe("the table's platforms (maintainer, 2026-10-13)", () => {
  it('rides between a Station of its own and one a mate at its table holds', async () => {
    const { app, baseId } = await world();
    giveStations(app, baseId, ['coldwater-halt'], 'coldwater-halt');
    const base = app.repos.bases.findById(baseId)!;
    const mateId = await mate(app, base.ownerId);
    const blockhouse = app.repos.city.control(PLATFORMS.get('blockhouse')!)!;
    app.repos.city.put({ ...blockhouse, holder: { kind: 'crew', baseId: mateId }, garrison: {} });

    expect([...stationsHeldBy(app.repos, base).keys()].sort()).toEqual([
      'blockhouse',
      'coldwater-halt',
    ]);
    const offer = railOfferFor(
      app.repos,
      base,
      { kind: 'district' },
      { kind: 'location', locationId: PLATFORMS.get('blockhouse')! },
      { army: { razors: 4 }, vehicles: {} },
    );
    expect(offer).not.toBeNull();
  });

  it('counts nobody outside the table', async () => {
    const { app, baseId } = await world();
    giveStations(app, baseId, ['coldwater-halt'], 'coldwater-halt');
    const base = app.repos.bases.findById(baseId)!;
    const blockhouse = app.repos.city.control(PLATFORMS.get('blockhouse')!)!;
    app.repos.city.put({
      ...blockhouse,
      holder: { kind: 'crew', baseId: 'a-stranger' },
      garrison: {},
    });
    expect([...stationsHeldBy(app.repos, base).keys()]).toEqual(['coldwater-halt']);
  });
});

describe('what the line is worth on a move', () => {
  it('offers nothing on one platform, because a line needs two ends', async () => {
    const { app, baseId } = await world();
    giveStations(app, baseId, ['coldwater-halt'], 'coldwater-halt');
    const base = app.repos.bases.findById(baseId)!;
    const offer = railOfferFor(
      app.repos,
      base,
      { kind: 'district' },
      { kind: 'location', locationId: PLATFORMS.get('coldwater-halt')! },
      { army: { razors: 4 }, vehicles: {} },
    );
    expect(offer).toBeNull();
  });

  it('cuts the length of the city to the rails and a walk', async () => {
    const { app, baseId } = await world();
    giveStations(app, baseId, ['coldwater-halt', 'blockhouse'], 'coldwater-halt');
    const base = app.repos.bases.findById(baseId)!;
    const from = { kind: 'location' as const, locationId: PLATFORMS.get('coldwater-halt')! };
    const to = { kind: 'location' as const, locationId: PLATFORMS.get('blockhouse')! };
    const riding = { army: { razors: 4 }, vehicles: {} };

    const walk = moveMinutes(app.repos, base, from, to, riding);
    const ride = moveMinutes(app.repos, base, from, to, riding, true);
    expect(walk).not.toBeNull();
    expect(ride).not.toBeNull();
    // A guard on the fixture: if walking were already quick this would prove nothing.
    expect(walk!).toBeGreaterThan(LEVEL_ONE_RIDE * 2);
    expect(ride!).toBe(LEVEL_ONE_RIDE);
    expect(ride!).toBeLessThan(walk!);
  });

  it('times the rails off the platform the move leaves from, each way', async () => {
    // Coldwater at level 2, the Blockhouse at 1: out is 13 minutes, back is 15 (maintainer,
    // 2026-10-09).
    const { app, baseId } = await world();
    giveStations(app, baseId, ['coldwater-halt', 'blockhouse'], 'coldwater-halt');
    const halt = app.repos.city.control(PLATFORMS.get('coldwater-halt')!)!;
    app.repos.city.put({ ...halt, level: 2 });
    const base = app.repos.bases.findById(baseId)!;
    const coldwater = { kind: 'location' as const, locationId: PLATFORMS.get('coldwater-halt')! };
    const blockhouse = { kind: 'location' as const, locationId: PLATFORMS.get('blockhouse')! };
    const riding = { army: { razors: 4 }, vehicles: {} };
    expect(moveMinutes(app.repos, base, coldwater, blockhouse, riding, true)).toBe(13);
    expect(moveMinutes(app.repos, base, blockhouse, coldwater, riding, true)).toBe(15);
    expect(railOfferFor(app.repos, base, coldwater, blockhouse, riding)!.ride).toBe(13);
    expect(railOfferFor(app.repos, base, blockhouse, coldwater, riding)!.ride).toBe(15);
  });

  it('leaves the machines behind, so a column taking them walks', async () => {
    const { app, baseId } = await world();
    giveStations(app, baseId, ['coldwater-halt', 'blockhouse'], 'coldwater-halt');
    const base = app.repos.bases.findById(baseId)!;
    const from = { kind: 'location' as const, locationId: PLATFORMS.get('coldwater-halt')! };
    const to = { kind: 'location' as const, locationId: PLATFORMS.get('blockhouse')! };

    const onFoot = { army: { razors: 4 }, vehicles: {} };
    const withMachines = { army: { razors: 4 }, vehicles: { motorcycle: 1 } };
    expect(railOfferFor(app.repos, base, from, to, onFoot)).not.toBeNull();
    expect(railOfferFor(app.repos, base, from, to, withMachines)).toBeNull();
    // And asking for the ride anyway gets the walk rather than a refusal or a wrong clock.
    const asked = moveMinutes(app.repos, base, from, to, withMachines, true);
    const walked = moveMinutes(app.repos, base, from, to, withMachines);
    expect(asked).toBe(walked);
  });

  it('never runs over the frontier', async () => {
    const { app, baseId } = await world();
    giveStations(app, baseId, ['coldwater-halt', 'blockhouse'], 'kettle-row');
    const base = app.repos.bases.findById(baseId)!;
    // Home is in Ashfall, the platforms are in Terminus. A train is a thing inside one city.
    expect(findDistrict('kettle-row')!.cityId).not.toBe(findDistrict('coldwater-halt')!.cityId);
    const offer = railOfferFor(
      app.repos,
      base,
      { kind: 'district' },
      { kind: 'location', locationId: PLATFORMS.get('blockhouse')! },
      { army: { razors: 4 }, vehicles: {} },
    );
    expect(offer).toBeNull();
  });
});

describe('the quote the dialog draws', () => {
  it('carries both clocks, and names the two platforms', async () => {
    const { app, token, baseId } = await world();
    giveStations(app, baseId, ['coldwater-halt', 'blockhouse'], 'coldwater-halt');
    // Standing on the platform the column leaves from: a quote prices only a force that is there.
    const platform = app.repos.city.control(PLATFORMS.get('coldwater-halt')!)!;
    app.repos.city.put({ ...platform, garrison: { razors: 4 } });

    const quoted = await app.inject({
      method: 'POST',
      url: '/api/actions/move/quote',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        from: { kind: 'location', locationId: PLATFORMS.get('coldwater-halt')! },
        to: { kind: 'location', locationId: PLATFORMS.get('blockhouse')! },
        army: { razors: 4 },
        vehicles: {},
      },
    });
    expect(quoted.statusCode, quoted.body.slice(0, 300)).toBe(200);
    const body = quoted.json<MoveQuoteResponse>();
    expect(body.rail).not.toBeNull();
    expect(body.rail!.minutes).toBe(LEVEL_ONE_RIDE);
    expect(body.rail!.minutes).toBeLessThan(body.minutes);
    expect(body.rail!.boardAt).toBe('Coldwater Halt');
    expect(body.rail!.alightAt).toBe('The Blockhouse');
    expect(body.rail!.walkMinutes).toBe(0);
  });

  it('halves the walk at the ends with the Cartographer, as it halves the ride', async () => {
    // The total already took SHORTCUT and the walk did not, so a quote could read "18 min,
    // including 20 on foot at the ends": a part printed larger than its whole.
    const { app, token, baseId } = await world();
    // Bonded Row is the platform nearest the Hill, and Coldwater is the far end of the city.
    giveStations(app, baseId, ['coldwater-halt', 'bonded-row'], 'coldwater-halt');
    // Standing on the Hill, which has no platform, so the ride starts with a walk.
    const hill = findDistrict('telemetry-hill')!.locations[0]!;
    const standing = app.repos.city.control(hill.id)!;
    const quote = async (army: Record<string, number>): Promise<MoveQuoteResponse> => {
      app.repos.city.put({ ...standing, holder: { kind: 'crew', baseId }, garrison: army });
      const quoted = await app.inject({
        method: 'POST',
        url: '/api/actions/move/quote',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          from: { kind: 'location', locationId: hill.id },
          to: { kind: 'location', locationId: PLATFORMS.get('coldwater-halt')! },
          army,
          vehicles: {},
        },
      });
      expect(quoted.statusCode, quoted.body.slice(0, 300)).toBe(200);
      return quoted.json<MoveQuoteResponse>();
    };
    const onFoot = await quote({ razors: 4 });
    const withHer = await quote({ razors: 4, the_cartographer: 1 });
    expect(onFoot.rail).not.toBeNull();
    expect(withHer.rail).not.toBeNull();
    // A guard on the fixture: a walk of a minute halves to itself and would prove nothing.
    expect(onFoot.rail!.walkMinutes).toBeGreaterThan(2);
    expect(withHer.rail!.walkMinutes).toBe(Math.round(onFoot.rail!.walkMinutes / 2));
    expect(withHer.rail!.walkMinutes).toBeLessThanOrEqual(withHer.rail!.minutes);
  });

  it('carries no ride for a crew with no platforms', async () => {
    const { app, token, baseId } = await world();
    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateArmy(base.id, { razors: 4 }, base.musterQueue);
    const quoted = await app.inject({
      method: 'POST',
      url: '/api/actions/move/quote',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        from: { kind: 'district' },
        to: { kind: 'gate' },
        army: { razors: 4 },
        vehicles: {},
      },
    });
    expect(quoted.statusCode, quoted.body.slice(0, 300)).toBe(200);
    expect(quoted.json<MoveQuoteResponse>().rail).toBeNull();
  });
});

/**
 * The offer has to be measured on the same journey the player is buying.
 *
 * A ride replaces the **road** and not the door. `moveMinutes` adds `MOVE_GATE_MINUTES` on top of
 * either one when a leg starts or ends at the crew's own district, so comparing the bare rail leg
 * against a walk that already carries the door counts the door on one side and not the other: a
 * journey whose road is shorter than fifteen minutes but whose road plus door is longer reads as a
 * ride worth taking and is not.
 *
 * Swept over every platform district as home and every district as a destination rather than
 * pinned on the one pair that first showed it. Which pairs fall in the window is a fact about the
 * positions in `city/atlas.ts` and about the column's pace, and both move: at a Razor's 45 the
 * window is a paced road of 10 to 14 minutes, which is four of the fifty-six ordered pairs.
 */
describe('a ride is only offered when it is quicker than walking', () => {
  it('holds for every journey through the crew own door', async () => {
    const { app, baseId } = await world();
    const platformDistricts = [...PLATFORMS.keys()];
    giveStations(app, baseId, platformDistricts, platformDistricts[0]!);
    const riding = { army: { razors: 4 }, vehicles: {} };

    let offers = 0;
    for (const home of platformDistricts) {
      app.db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(home, baseId);
      const base = app.repos.bases.findById(baseId)!;
      for (const district of districtsOfCity(TERMINUS_CITY_ID)) {
        const location = district.locations[0];
        if (!location) continue;
        const there = { kind: 'location' as const, locationId: location.id };
        const gate = { kind: 'district' as const };
        for (const [from, to] of [
          [gate, there],
          [there, gate],
        ] as const) {
          if (railOfferFor(app.repos, base, from, to, riding) === null) continue;
          offers += 1;
          const walk = moveMinutes(app.repos, base, from, to, riding);
          const ride = moveMinutes(app.repos, base, from, to, riding, true);
          expect(ride, `${home} ${from.kind} to ${to.kind} ${location.id}`).toBeLessThan(walk!);
        }
      }
    }
    // A positive control: a sweep that offered nothing anywhere would assert nothing.
    expect(offers).toBeGreaterThan(0);
  });
});

/**
 * The ride on the feats board is counted when the column arrives (audit, 2026-09-28).
 *
 * It was counted when the train was chosen, so a move put on the line and turned round inside its
 * first tenth was home in seconds with a journey banked: the ladder was a pair of buttons.
 */
describe('a journey on the feats board', () => {
  it('counts a ride that arrives, and none for one turned round on the way', async () => {
    const { app, baseId } = await world();
    giveStations(app, baseId, ['coldwater-halt', 'blockhouse'], 'coldwater-halt');
    const from = { kind: 'location' as const, locationId: PLATFORMS.get('coldwater-halt')! };
    const to = { kind: 'location' as const, locationId: PLATFORMS.get('blockhouse')! };
    const platform = app.repos.city.control(from.locationId)!;
    app.repos.city.put({ ...platform, garrison: { razors: 8 } });
    const journeys = () => app.repos.feats.tallies(baseId)[featMeasureKey('rail_journeys')] ?? 0;
    const ride = (now: Date) => {
      const sent = sendMove(app.repos, {
        base: app.repos.bases.findById(baseId)!,
        from,
        to,
        army: { razors: 4 },
        vehicles: {},
        now,
        byRail: true,
      });
      if (sent.kind !== 'sent') throw new Error(`fixture: the ride was refused, ${sent.reason}`);
      return sent.move;
    };

    const T0 = new Date('2026-09-24T12:00:00.000Z');
    const turned = ride(T0);
    expect(journeys(), 'nothing is counted on the platform').toBe(0);
    const recalled = recallMove(
      app.repos,
      app.repos.bases.findById(baseId)!,
      turned.id,
      new Date(T0.getTime() + 30_000),
    );
    expect(recalled.kind).toBe('recalled');
    settleMoves(app.repos, new Date(T0.getTime() + 3_600_000));
    expect(journeys(), 'a ride turned round on the way went nowhere').toBe(0);

    const arrived = ride(new Date(T0.getTime() + 2 * 3_600_000));
    settleMoves(app.repos, new Date(arrived.arrivesAt));
    expect(journeys()).toBe(1);
  });
});
