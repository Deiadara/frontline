import {
  INTER_CITY_MINUTES,
  SCOUTING_RESEARCH_ID,
  TERMINUS_CITY_ID,
  createCommander,
  districtsOfCity,
  findDistrict,
  makeAttributes,
  scoutMinutesFor,
  travelMinutesBetween,
  type Base,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { plantSleepers } from '../city/sleepers.js';
import { planScout, scoutParty } from '../scouting/scouting.js';
import { planSpy } from '../spying/spying.js';
import { travelMsTo } from './movement.js';

/**
 * Every journey that crosses the frontier, on one clock (2026-09-24).
 *
 * `rawMinutesBetween` is where the crossing is priced, and four separate journeys read it: a
 * column marching to a declared fight, a Sleeper cell going to ground, a scout party opening the
 * map and a spy job buying a look. They read it through two functions, `travelMsTo` and
 * `travelMinutesBetween`, and the failure mode this guards is a fifth caller measuring a bare
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
  // Eyes on the line: every door below reads the fog, and the fog is not what is under test.
  for (const district of districtsOfCity(TERMINUS_CITY_ID)) {
    repos.city.markScouted(base.id, district.id, new Date().toISOString());
  }
  return { repos, base: repos.bases.findById(baseId)! };
}

/** The Master of Whispers, with their first rung finished: what a party and a spy job need. */
function hireWhispers(repos: Repositories, base: Base): Base {
  repos.bases.updateCommanders(base.id, [
    ...base.commanders,
    createCommander('o-whispers', 'Wire', 'master_of_whispers', makeAttributes(30), []),
  ]);
  const withChair = repos.bases.findById(base.id)!;
  repos.bases.updateResearch(withChair.id, {
    ...withChair.research,
    technologies: [...withChair.research.technologies, SCOUTING_RESEARCH_ID],
  });
  return repos.bases.findById(base.id)!;
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
    const location = findDistrict(ABROAD)!.locations[0]!;
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
    const column = travelMsTo(repos, base, ABROAD, { vehicles: {}, force: { sleepers: 4 } });
    expect(planted.cell.travelMs).toBe(column);
    expect(planted.cell.travelMs / MINUTE_MS).toBeGreaterThan(longestRoadHome(base));
  });
});

describe('a party sent over the frontier to look', () => {
  it('walks the crossing twice and then spends the time on the ground', async () => {
    const { repos, base } = await world('whisperer');
    const staffed = hireWhispers(repos, base);
    const whispers = scoutParty(staffed)!;
    expect(whispers).toBeDefined();

    const plan = planScout(repos, staffed, ABROAD, whispers, new Date());
    expect(plan).not.toBeNull();
    /*
     * The whole run is the walk there, the looking, and the walk back. Stated from the rule
     * rather than from `scoutRunMinutes`, so the two halves of the clock cannot both drift the
     * same way and stay green.
     */
    expect(plan!.minutes).toBe(plan!.travelMinutes * 2 + scoutMinutesFor(whispers.attributes));
    expect(plan!.travelMinutes).toBeGreaterThan(longestRoadHome(staffed));

    // A run at home for comparison: the frontier is worth more than the whole of Ashfall.
    const nearest = districtsOfCity(findDistrict(staffed.districtId)!.cityId).find(
      (district) => district.id !== staffed.districtId,
    )!;
    const athome = planScout(repos, staffed, nearest.id, whispers, new Date());
    expect(athome!.minutes).toBeLessThan(plan!.minutes);
  });

  it('prices a spy job on the same road, tier and all', async () => {
    const { repos, base } = await world('spymaster');
    const staffed = hireWhispers(repos, base);
    const whispers = scoutParty(staffed)!;
    const walk = planScout(repos, staffed, ABROAD, whispers, new Date());
    /*
     * Every tier buys a better report and none of them buys a different clock: a spy job is a
     * scout party that comes home with a page instead of a map. Pinned because the comment on
     * `spyTotalMs` reads as though the dearest tier were the longest, and it is not.
     */
    for (const tier of ['loose_ears', 'total_intelligence'] as const) {
      const plan = planSpy(repos, staffed, ABROAD, tier, new Date());
      expect(plan, tier).not.toBeNull();
      expect(plan!.minutes, tier).toBe(walk!.minutes);
      expect(plan!.travelMinutes, tier).toBe(walk!.travelMinutes);
    }
    // And the caps are what the tier actually moves.
    const cheap = planSpy(repos, staffed, ABROAD, 'loose_ears', new Date())!;
    const dear = planSpy(repos, staffed, ABROAD, 'total_intelligence', new Date())!;
    expect(dear.caps).toBeGreaterThan(cheap.caps);
  });
});
