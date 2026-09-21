import {
  CITY_DISTRICTS,
  MISC_AREA_ID,
  districtHolder,
  findDistrict,
  startingEconomy,
  startingHolder,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type LocationHolder,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { areaStatesFor, projectAreas } from './board.js';

/**
 * Where a crew may take work, and where the gate is shut (maintainer, 2026-09-21).
 *
 * Two rules arrived together and they fail in the same quiet way: an area that should be gone
 * keeps posting three jobs a day, and nothing else on the screen says anything is wrong.
 *
 *   * **A plot is not a job board.** The four residential districts hold no capturable locations
 *     at all, so every open-area condition was vacuously true of them: scouted and not owned
 *     outright, therefore hiring. A rival's hideout posted a scrap run.
 *   * **A district one party holds end to end is shut.** That is what arms its gate, and it used
 *     to close the board only when the party was the *reader*. The Combine Spire, held by the
 *     Combine down to the last plot, was on the board from the moment it was scouted.
 *
 * Measured against the city as it actually starts rather than against a hand-built map: five
 * Combine districts and the Undergrid start shut (`startingHolder`), and that is the shape of the
 * early game this rule is for.
 */
const dbs: AppDatabase[] = [];
const NOW = new Date('2026-09-21T12:00:00.000Z');

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function makeStack(): { repos: Repositories; base: Base } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  dbs.push(db);
  const repos = createRepositories(db);
  const now = NOW.toISOString();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'boarder', 'x', ?)`,
  ).run(now);
  const base: Base = {
    id: 'base-1',
    ownerId: 'u1',
    name: 'The Yard',
    districtId: 'kettle-row',
    level: 5,
    isBot: false,
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, planks: 0, highQualityMetal: 0 },
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'nexus-1', kind: 'nexus', level: 5, modifications: [] }],
    buildQueue: [],
    army: { razors: 20 },
    trainingQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
  };
  repos.bases.insert(base);
  // Eyes on everything, so scouting is never what closes a board below.
  for (const district of CITY_DISTRICTS) repos.city.markScouted(base.id, district.id, now);
  return { repos, base };
}

/** Empties one plot, which is the least that takes a district out of one party's hands. */
function openGate(repos: Repositories, districtId: string): void {
  const first = findDistrict(districtId)?.locations[0];
  if (!first) throw new Error(`${districtId} has nothing in it`);
  const control = repos.city.control(first.id);
  if (!control) throw new Error(`no control row for ${first.id}`);
  repos.city.put({ ...control, holder: { kind: 'unoccupied' }, garrison: {} });
}

/** Hands every plot in a district to one party, which is what arms its gate. */
function shutGate(repos: Repositories, districtId: string, holder: LocationHolder): void {
  for (const location of findDistrict(districtId)?.locations ?? []) {
    const control = repos.city.control(location.id);
    if (!control) throw new Error(`no control row for ${location.id}`);
    repos.city.put({ ...control, holder, garrison: {} });
  }
}

const boardIds = (repos: Repositories, base: Base): string[] =>
  projectAreas(CITY_DISTRICTS, areaStatesFor(repos, base), [], base.level, NOW).map(
    (area) => area.id,
  );

describe('which districts post work', () => {
  it('leaves every plot off the board, scouted or not', () => {
    const { repos, base } = makeStack();
    const plots = CITY_DISTRICTS.filter((district) => district.kind === 'residential');
    expect(plots.length, 'no residential districts to check').toBeGreaterThan(0);

    const ids = boardIds(repos, base);
    for (const plot of plots) expect(ids, `${plot.id} is somebody's plot`).not.toContain(plot.id);
  });

  it('keeps the misc board whatever the map is doing', () => {
    const { repos, base } = makeStack();
    // Every contested district in one party's hands: the whole city is shut.
    for (const district of CITY_DISTRICTS) {
      if (district.kind !== 'contested') continue;
      shutGate(repos, district.id, { kind: 'government' });
    }
    expect(boardIds(repos, base)).toEqual([MISC_AREA_ID]);
  });

  /**
   * The rule reads the ground, not the reader. All four holders are checked because the bug this
   * replaces was exactly the rule being written about one of them.
   */
  const OTHERS: readonly [string, LocationHolder][] = [
    ['the Combine', { kind: 'government' }],
    ['the looters', { kind: 'looters' }],
    ['a rival crew', { kind: 'crew', baseId: 'someone-else' }],
  ];

  it.each(OTHERS)('closes a district %s holds end to end', (_who, holder) => {
    const { repos, base } = makeStack();
    const district = CITY_DISTRICTS.find((one) => one.kind === 'contested')!;

    openGate(repos, district.id);
    expect(boardIds(repos, base)).toContain(district.id);

    shutGate(repos, district.id, holder);
    expect(boardIds(repos, base)).not.toContain(district.id);
  });

  it('closes a district the reader holds end to end, the way it always did', () => {
    const { repos, base } = makeStack();
    const district = CITY_DISTRICTS.find((one) => one.kind === 'contested')!;
    openGate(repos, district.id);
    expect(boardIds(repos, base)).toContain(district.id);

    shutGate(repos, district.id, { kind: 'crew', baseId: base.id });
    expect(boardIds(repos, base)).not.toContain(district.id);
  });

  it('opens a shut district again the moment one plot comes loose', () => {
    const { repos, base } = makeStack();
    const spire = CITY_DISTRICTS.find((one) => one.id === 'combine-spire')!;
    expect(boardIds(repos, base), 'the Combine starts holding the Spire whole').not.toContain(
      spire.id,
    );

    repos.city.put({
      ...repos.city.control(spire.locations[0]!.id)!,
      holder: { kind: 'crew', baseId: base.id },
      garrison: {},
    });
    expect(boardIds(repos, base)).toContain(spire.id);
  });

  /**
   * The city as authored, so the rule's cost is stated rather than implied: two contested
   * districts are open on the first day and six are behind a gate. If a retune of
   * `SQUATTED_PLACES` or `COMBINE_UNOCCUPIED` shuts one of those two, a new crew's board loses a
   * third of its work and nothing else in the suite would say so.
   */
  it('opens Chrome Row and the Glasshouse Fields on the first day, and nothing else', () => {
    const { repos, base } = makeStack();
    const controls = new Map(
      CITY_DISTRICTS.flatMap((district) =>
        district.locations.map((location) => [
          location.id,
          {
            locationId: location.id,
            holder: startingHolder(location, district),
            level: 1,
            upgradingUntil: null,
            fortification: 0,
            fortifyingUntil: null,
            garrison: {},
          },
        ]),
      ),
    );
    const open = CITY_DISTRICTS.filter(
      (district) => district.kind === 'contested' && districtHolder(district, controls) === null,
    ).map((district) => district.id);
    expect(open).toEqual(['chrome-row', 'glasshouse-fields']);
    expect(boardIds(repos, base)).toEqual([MISC_AREA_ID, ...open]);
  });
});
