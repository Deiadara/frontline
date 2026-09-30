import {
  RAIL_LINK_MINUTES,
  TERMINUS_CITY_ID,
  createCommander,
  districtsOfCity,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { settleMoves } from '../moves/moves.js';
import {
  columnMinutesTo,
  railColumnOffer,
  sendColumn,
  settleMovements,
  turnRound,
} from './movement.js';

/**
 * A battle column rides Terminus's line, not only a unit move (maintainer, 2026-09-24).
 *
 * The ruling was that the railway carries "moving units around **or to send them somewhere for
 * battle**". Only the first half was built: a crew holding the whole line rode between its own
 * places and marched to a declared fight, which is the half of the trait that decides whether the
 * platforms are worth holding.
 */

const MINUTE_MS = 60_000;

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

/** Every Terminus Station, by the district it stands in. */
const PLATFORMS = new Map(
  districtsOfCity(TERMINUS_CITY_ID).flatMap((district) => {
    const station = district.locations.find((one) => one.kind === 'rail_station');
    return station ? [[district.id, station.id] as const] : [];
  }),
);

async function crewOnTheLine(platforms: readonly string[], home: string) {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'railhead', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 300)).toBe(201);
  pinOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  app.db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(home, baseId);
  for (const districtId of platforms) {
    const locationId = PLATFORMS.get(districtId)!;
    const control = app.repos.city.control(locationId)!;
    app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
  }
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateArmy(base.id, { razors: 8 }, base.trainingQueue);
  // A movement row names the fight it is walking to, so the fight has to exist. Two of them,
  // because the march and the ride are sent separately and a column is keyed by battle.
  for (const id of ['battle-foot', 'battle-rail']) {
    app.repos.sieges.insert({
      id,
      attackerBaseId: baseId,
      target: { kind: 'gate', districtId: 'blockhouse' },
      defender: { kind: 'government' },
      declaredAt: new Date('2026-09-24T11:00:00.000Z').toISOString(),
      scheduledFor: new Date('2026-09-25T11:00:00.000Z').toISOString(),
      resolvedAt: null,
      seed: `${id}-seed`,
      holdAfterCapture: false,
      wokeSleepers: false,
    });
  }
  return { app, baseId, base: app.repos.bases.findById(baseId)! };
}

const walked = (
  app: FastifyInstance,
  base: ReturnType<typeof Object>,
  to: string,
  byRail: boolean,
) =>
  sendColumn(app.repos, {
    base: base as never,
    battleId: `battle-${byRail ? 'rail' : 'foot'}`,
    side: 'attacker',
    toDistrictId: to,
    army: { razors: 4 },
    perimeter: {},
    now: new Date('2026-09-24T12:00:00.000Z'),
    byRail,
  });

const minutesOf = (movement: { departedAt: string; arrivesAt: string }) =>
  Math.round((Date.parse(movement.arrivesAt) - Date.parse(movement.departedAt)) / MINUTE_MS);

describe('a column on its way to a declared fight', () => {
  it('rides the line when the crew holds both platforms and asks for it', async () => {
    const { app, base } = await crewOnTheLine(['coldwater-halt', 'blockhouse'], 'coldwater-halt');
    const march = minutesOf(walked(app, base, 'blockhouse', false));
    const ride = minutesOf(walked(app, base, 'blockhouse', true));
    // A guard on the fixture: if the march were already short this would prove nothing.
    expect(march).toBeGreaterThan(RAIL_LINK_MINUTES * 2);
    expect(ride).toBe(RAIL_LINK_MINUTES);
    expect(ride).toBeLessThan(march);
  });

  it('marches when it was not asked for, which is the default', async () => {
    const { app, base } = await crewOnTheLine(['coldwater-halt', 'blockhouse'], 'coldwater-halt');
    expect(minutesOf(walked(app, base, 'blockhouse', false))).toBeGreaterThan(RAIL_LINK_MINUTES);
  });

  it('marches on one platform, because a line needs two ends', async () => {
    const { app, base } = await crewOnTheLine(['coldwater-halt'], 'coldwater-halt');
    const march = minutesOf(walked(app, base, 'blockhouse', false));
    expect(minutesOf(walked(app, base, 'blockhouse', true))).toBe(march);
  });

  /**
   * §D5: the officer leading shortens the two walks, because they are roads like any other.
   *
   * Only the fifteen minutes in the middle is a rule nothing speeds up. `railColumnOffer` folded
   * the standing effects and never `leading()`, while the march it is compared against folded both,
   * so a crew with an officer on the job was offered a ride priced without them and judged against
   * a march priced with them: the comparison leaned towards marching for exactly the crews that had
   * paid for the perk.
   *
   * Telemetry Hill is the destination because it has no platform of its own, which is what makes
   * `fromPlatform` a real walk. On two platform districts both legs are zero and there is nothing
   * for a perk to take off.
   */
  it('takes the leader’s minutes off a ride’s walk legs, and off nothing else', async () => {
    const { app, base } = await crewOnTheLine(['coldwater-halt', 'blockhouse'], 'coldwater-halt');
    app.repos.bases.updateCommanders(base.id, [
      {
        ...createCommander('off-1', 'Vasco Renn', 'field_commander', {
          strength: 60,
          toughness: 60,
          dexterity: 50,
          resolve: 60,
          reflexes: 55,
        }),
        perks: ['short_way'],
      },
    ]);
    const crew = app.repos.bases.findById(base.id)!;
    const riding = { army: { razors: 4 }, vehicles: {} };
    const road = columnMinutesTo(app.repos, crew, 'telemetry-hill', riding);
    expect(road).not.toBeNull();

    const alone = railColumnOffer(app.repos, crew, 'telemetry-hill', riding, road!, false);
    const led = railColumnOffer(app.repos, crew, 'telemetry-hill', riding, road!, true);
    if (!alone || !led) throw new Error('fixture: no ride was offered on a line the crew holds');

    // A guard on the fixture: a leg of nought is a leg no perk can shorten.
    expect(alone.fromPlatform).toBeGreaterThan(0);
    expect(led.fromPlatform).toBeLessThan(alone.fromPlatform);
    // And the rails themselves are untouched, which is the other half of the rule.
    expect(led.minutes).toBe(RAIL_LINK_MINUTES + led.toPlatform + led.fromPlatform);
    expect(alone.minutes - led.minutes).toBe(alone.fromPlatform - led.fromPlatform);
  });

  /**
   * Counted when the column gets there (audit, 2026-09-28).
   *
   * It was counted at the platform, so a column put on the train and turned round in its first
   * tenth came home in seconds with a journey banked, and a crew could press the pair for as long as
   * it liked.
   */
  it('counts the journey when the column arrives, and none for one turned round', async () => {
    const { app, baseId, base } = await crewOnTheLine(
      ['coldwater-halt', 'blockhouse'],
      'coldwater-halt',
    );
    const journeys = () => app.repos.feats.tallies(baseId)['rail_journeys'] ?? 0;
    const turned = walked(app, base, 'blockhouse', true);
    expect(journeys(), 'nothing is counted at the platform').toBe(0);
    turnRound(app.repos, turned, new Date(Date.parse(turned.departedAt) + 30_000));
    settleMoves(app.repos, new Date(Date.parse(turned.arrivesAt) + 3_600_000));
    expect(journeys(), 'a column turned round on the way rode nowhere').toBe(0);

    const ride = walked(app, base, 'blockhouse', true);
    settleMovements(app.repos, new Date(ride.arrivesAt));
    expect(journeys()).toBe(1);
    // And a march counts nothing when it lands, or the ladder would climb on foot.
    const march = walked(app, base, 'blockhouse', false);
    settleMovements(app.repos, new Date(march.arrivesAt));
    expect(journeys()).toBe(1);
  });
});
