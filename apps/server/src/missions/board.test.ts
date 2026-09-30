import {
  CITY_DISTRICTS,
  MISC_AREA_ID,
  findDistrict,
  startingEconomy,
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
 * Where a crew may take work (maintainer, 2026-09-29): "in order to do missions in a district you
 * still need to hold at least one location in that district, or you can do the misc ones".
 *
 * The rule fails the quiet way every board rule does: an area that should be gone keeps posting
 * three jobs a day, or one that should be there never does, and nothing else on the screen says
 * anything is wrong. A plot is never a board, whatever the counts say: the four residential
 * districts hold no capturable locations at all.
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
  return { repos, base };
}

/** Hands one location of a district to a party. */
function give(repos: Repositories, locationId: string, holder: LocationHolder): void {
  const control = repos.city.control(locationId);
  if (!control) throw new Error(`no control row for ${locationId}`);
  repos.city.put({ ...control, holder, garrison: {} });
}

/** Hands every plot in a district to one party. */
function giveWhole(repos: Repositories, districtId: string, holder: LocationHolder): void {
  for (const location of findDistrict(districtId)?.locations ?? [])
    give(repos, location.id, holder);
}

const boardIds = (repos: Repositories, base: Base): string[] =>
  projectAreas(CITY_DISTRICTS, areaStatesFor(repos, base), [], base, NOW).map((area) => area.id);

const CONTESTED = CITY_DISTRICTS.filter((district) => district.kind === 'contested');

describe('which districts post work', () => {
  it('shows a crew that holds nothing the misc board and nothing else', () => {
    const { repos, base } = makeStack();
    expect(boardIds(repos, base)).toEqual([MISC_AREA_ID]);
  });

  it('never puts a plot on the board', () => {
    const { repos, base } = makeStack();
    const plots = CITY_DISTRICTS.filter((district) => district.kind === 'residential');
    expect(plots.length, 'no residential districts to check').toBeGreaterThan(0);
    for (const district of CONTESTED) give(repos, district.locations[0]!.id, crew(base));
    const ids = boardIds(repos, base);
    for (const plot of plots) expect(ids, `${plot.id} is somebody's plot`).not.toContain(plot.id);
  });

  it('opens a district on the first location the crew takes in it', () => {
    const { repos, base } = makeStack();
    const district = CONTESTED[0]!;
    expect(boardIds(repos, base)).not.toContain(district.id);
    give(repos, district.locations[0]!.id, crew(base));
    expect(boardIds(repos, base)).toEqual([MISC_AREA_ID, district.id]);
  });

  /** Held whole by the crew keeps the board: it is their ground and its people still hire. */
  it('keeps it open with every location held', () => {
    const { repos, base } = makeStack();
    const district = CONTESTED[0]!;
    giveWhole(repos, district.id, crew(base));
    expect(boardIds(repos, base)).toContain(district.id);
  });

  it('closes it again the moment the last place is lost', () => {
    const { repos, base } = makeStack();
    const district = CONTESTED[0]!;
    const first = district.locations[0]!.id;
    give(repos, first, crew(base));
    expect(boardIds(repos, base)).toContain(district.id);
    give(repos, first, { kind: 'looters' });
    expect(boardIds(repos, base)).not.toContain(district.id);
  });

  /** The rule reads the reader's holdings: somebody else's ground opens nothing, whole or split. */
  const OTHERS: readonly [string, LocationHolder][] = [
    ['the Combine', { kind: 'government' }],
    ['the looters', { kind: 'looters' }],
    ['a rival crew', { kind: 'crew', baseId: 'someone-else' }],
    ['nobody', { kind: 'unoccupied' }],
  ];

  it.each(OTHERS)('opens nothing on ground %s holds', (_who, holder) => {
    const { repos, base } = makeStack();
    const district = CONTESTED[0]!;
    giveWhole(repos, district.id, holder);
    expect(boardIds(repos, base)).not.toContain(district.id);
    // ...and one place of the reader's among them is all it takes.
    give(repos, district.locations[0]!.id, crew(base));
    expect(boardIds(repos, base)).toContain(district.id);
  });
});

function crew(base: Base): LocationHolder {
  return { kind: 'crew', baseId: base.id };
}
