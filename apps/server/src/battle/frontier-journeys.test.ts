import {
  ALL_DISTRICTS,
  INTER_CITY_MINUTES,
  createCommander,
  districtHolder,
  districtsOfCity,
  findCity,
  findDistrict,
  makeAttributes,
  spyLookMinutesFor,
  travelMinutesBetween,
  type Base,
  type District,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { plantSleepers } from '../city/sleepers.js';
import { planSpy, whispersAtWork } from '../spying/spying.js';
import { travelMsTo } from './movement.js';

/**
 * Every journey that crosses the frontier, on one clock (2026-09-24).
 *
 * `rawMinutesBetween` is where the crossing is priced, and three separate journeys read it: a
 * column marching to a declared fight, a Sleeper cell going to ground and a spy job buying a look.
 * They read it through two functions, `travelMsTo` and
 * `travelMinutesBetween`, and the failure mode this guards is a fourth caller measuring a bare
 * `mapDistance` instead: the two maps are both normalised 0 to 1, so that answer is not merely
 * wrong, it is the two-minute floor, and a column that teleports across the world reads on the
 * screen as a column that is simply quick.
 */

const MINUTE_MS = 60_000;
const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

/** The far end of the world from an Ashfall plot: the seat of Combine power in Terminus. */
const ABROAD = 'last-platform';

async function world(username: string): Promise<{ repos: Repositories; base: Base }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  pinOverseer(app, token);
  const repos = createRepositories(db);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const base = repos.bases.findById(baseId)!;
  repos.bases.updateArmy(base.id, { razors: 10, sleepers: 10 }, base.trainingQueue);
  return { repos, base: repos.bases.findById(baseId)! };
}

/** The Master of Whispers in the chair: all a spy job needs. */
function hireWhispers(repos: Repositories, base: Base): Base {
  repos.bases.updateCommanders(base.id, [
    ...base.commanders,
    createCommander('o-whispers', 'Wire', 'master_of_whispers', makeAttributes(30), []),
  ]);
  return repos.bases.findById(base.id)!;
}

/**
 * A district in another open city that nobody holds end to end.
 *
 * A cell cannot be planted behind a shut district's gate (`district_shut`, maintainer 2026-09-29),
 * and the Combine holds {@link ABROAD} whole, so the cell needs ground of its own abroad. Found off
 * the live control table rather than named, so a reseeded map cannot quietly shut it.
 */
function openGroundAbroad(repos: Repositories, base: Base): District {
  const home = findDistrict(base.districtId)!;
  const controls = repos.city.controls();
  const open = ALL_DISTRICTS.find(
    (district) =>
      district.cityId !== home.cityId &&
      findCity(district.cityId)?.open === true &&
      district.locations.length > 0 &&
      districtHolder(district, controls) === null,
  );
  if (!open) throw new Error('fixture: no open ground in any other city');
  return open;
}

/** The longest road inside the crew's own city: what a crossing has to cost more than. */
function longestRoadHome(base: Base): number {
  const home = findDistrict(base.districtId)!;
  return districtsOfCity(home.cityId).reduce(
    (worst, district) => Math.max(worst, travelMinutesBetween(home, district)),
    0,
  );
}

describe('a column marching over the frontier', () => {
  it('is charged the crossing rather than the overlap of two maps', async () => {
    const { repos, base } = await world('marcher');
    const home = findDistrict(base.districtId)!;
    const away = findDistrict(ABROAD)!;
    expect(home.cityId).not.toBe(away.cityId);

    const abroad = travelMsTo(repos, base, ABROAD, { vehicles: {}, force: { razors: 10 } });
    expect(abroad).not.toBeNull();
    /*
     * Two independent bounds rather than one exact figure.
     *
     * Below: the crossing has to beat the longest road at home, which is the sentence the
     * frontier term exists to make true and the one a bare `mapDistance` answered with two
     * minutes. Above: the party is walking at a Razor's pace with no holdings, so the whole
     * journey cannot come to less than the frontier term halved, whatever the two ends are.
     */
    const minutes = abroad! / MINUTE_MS;
    expect(minutes).toBeGreaterThan(longestRoadHome(base));
    expect(minutes).toBeGreaterThan(INTER_CITY_MINUTES / 2);
  });

  it('prices a cell going to ground abroad on that same road', async () => {
    const { repos, base } = await world('planter');
    const abroad = openGroundAbroad(repos, base);
    const location = abroad.locations[0]!;
    const planted = plantSleepers(repos, {
      base,
      locationId: location.id,
      army: { sleepers: 4 },
      now: new Date(),
    });
    expect(planted.kind, JSON.stringify(planted)).toBe('ok');
    if (planted.kind !== 'ok') return;

    // The cell walks, so its frozen clock is the column's clock for the same party and the same
    // ground: one road, read once, and not a second copy that could drift from it.
    const column = travelMsTo(repos, base, abroad.id, { vehicles: {}, force: { sleepers: 4 } });
    expect(planted.cell.travelMs).toBe(column);
    expect(planted.cell.travelMs / MINUTE_MS).toBeGreaterThan(longestRoadHome(base));
  });
});

describe('runners sent over the frontier to look', () => {
  it('walk the crossing twice and then spend the time on the ground', async () => {
    const { repos, base } = await world('whisperer');
    const staffed = hireWhispers(repos, base);
    const whispers = whispersAtWork(staffed)!;
    expect(whispers).toBeDefined();

    const plan = planSpy(repos, staffed, ABROAD, 'loose_ears', new Date());
    expect(plan).not.toBeNull();
    /*
     * The whole job is the walk there, the looking, and the walk back. Stated from the rule
     * rather than from `spyJobMinutes`, so the two halves of the clock cannot both drift the same
     * way and stay green.
     */
    expect(plan!.minutes).toBe(plan!.travelMinutes * 2 + spyLookMinutesFor(whispers.attributes));
    expect(plan!.travelMinutes).toBeGreaterThan(longestRoadHome(staffed));

    // A job at home for comparison: the frontier is worth more than the whole of Ashfall.
    const nearest = districtsOfCity(findDistrict(staffed.districtId)!.cityId).find(
      (district) => district.id !== staffed.districtId,
    )!;
    const athome = planSpy(repos, staffed, nearest.id, 'loose_ears', new Date());
    expect(athome!.minutes).toBeLessThan(plan!.minutes);
  });

  it('take the same clock at every tier, and only the caps move', async () => {
    const { repos, base } = await world('spymaster');
    const staffed = hireWhispers(repos, base);
    /*
     * Every tier buys a better report and none of them buys a different clock. Pinned because the
     * comment on `spyTotalMs` once read as though the dearest tier were the longest, and it is not.
     */
    const cheap = planSpy(repos, staffed, ABROAD, 'loose_ears', new Date())!;
    const dear = planSpy(repos, staffed, ABROAD, 'total_intelligence', new Date())!;
    expect(dear.minutes).toBe(cheap.minutes);
    expect(dear.travelMinutes).toBe(cheap.travelMinutes);
    expect(dear.caps).toBeGreaterThan(cheap.caps);
  });
});
