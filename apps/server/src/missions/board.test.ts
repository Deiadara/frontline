import {
  CITY_DISTRICTS,
  DEFAULT_BADGE,
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
 * Where a crew may take work (maintainer, 2026-10-07): "you can only do missions in your starting
 * city and only in districts that you or your faction control entirely".
 *
 * It replaced the foothold rule of 2026-09-29, under which one location in a district opened its
 * board. The misc board is outside it and is always there, which is what gives a crew that holds
 * nothing something to do on its first evening.
 *
 * The rule fails the quiet way every board rule does: an area that should be gone keeps posting
 * three jobs a day, or one that should be there never does, and nothing else on the screen says
 * anything is wrong. A plot is never a board, whatever is held: the four residential districts
 * hold no capturable locations at all.
 */
const dbs: AppDatabase[] = [];
const NOW = new Date('2026-09-21T12:00:00.000Z');

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function makeStack(): { repos: Repositories; db: AppDatabase; base: Base } {
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
    musterQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
  };
  repos.bases.insert(base);
  return { repos, db, base };
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

  /**
   * The rule, and the one a foothold used to pass (maintainer, 2026-10-07).
   *
   * Every plot but one is the case that matters: it is where the old rule and the new one disagree,
   * and it is the state a crew is in for as long as it takes to finish a district.
   */
  it('opens a district only on the last plot in it, not on the first', () => {
    const { repos, base } = makeStack();
    const district = CONTESTED[0]!;
    expect(district.locations.length).toBeGreaterThan(1);
    for (const location of district.locations.slice(0, -1)) give(repos, location.id, crew(base));
    expect(boardIds(repos, base)).toEqual([MISC_AREA_ID]);

    give(repos, district.locations.at(-1)!.id, crew(base));
    expect(boardIds(repos, base)).toEqual([MISC_AREA_ID, district.id]);
  });

  it('closes it again the moment one plot is lost', () => {
    const { repos, base } = makeStack();
    const district = CONTESTED[0]!;
    giveWhole(repos, district.id, crew(base));
    expect(boardIds(repos, base)).toContain(district.id);
    give(repos, district.locations[0]!.id, { kind: 'looters' });
    expect(boardIds(repos, base)).not.toContain(district.id);
  });

  /**
   * A table holds a district together (maintainer, 2026-10-07): "districts that you or your
   * faction control entirely". The same sentence the unified bonus and the gate read, through the
   * same function (`districtWholeFor`), so one answer serves all three.
   */
  it("opens on a district a faction mate helps hold, and not on a stranger's half", () => {
    const { repos, db, base } = makeStack();
    const district = CONTESTED[0]!;
    const mate = otherCrew(repos, db, 'u2', 'base-2');
    for (const location of district.locations) give(repos, location.id, crew(base));
    give(repos, district.locations[0]!.id, { kind: 'crew', baseId: mate });
    // Split with somebody at no table of ours: the district is nobody's whole.
    expect(boardIds(repos, base)).not.toContain(district.id);

    atOneTable(repos, base.ownerId, 'u2');
    expect(boardIds(repos, base)).toContain(district.id);
  });

  /** The misc board is outside the rule and is the reason a new crew has anything to do. */
  it('keeps the misc board open to a crew that holds nothing anywhere', () => {
    const { repos, base } = makeStack();
    expect(boardIds(repos, base)).toEqual([MISC_AREA_ID]);
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
    // ...and taking the lot of it off them is what it takes.
    giveWhole(repos, district.id, crew(base));
    expect(boardIds(repos, base)).toContain(district.id);
  });
});

function crew(base: Base): LocationHolder {
  return { kind: 'crew', baseId: base.id };
}

/** A second crew in the same world, to split a district with. Returns its base id. */
function otherCrew(repos: Repositories, db: AppDatabase, userId: string, baseId: string): string {
  const now = NOW.toISOString();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)`,
  ).run(userId, `other-${userId}`, now);
  repos.bases.insert({
    id: baseId,
    ownerId: userId,
    name: 'The Other Yard',
    districtId: 'kettle-row',
    level: 5,
    isBot: false,
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, planks: 0, highQualityMetal: 0 },
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [],
    buildQueue: [],
    army: {},
    musterQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
  });
  return baseId;
}

/** Seats both owners at one table, which is what makes a split district whole for either. */
function atOneTable(repos: Repositories, ...userIds: string[]): void {
  const foundedAt = NOW.toISOString();
  repos.factions.insert({
    id: 'the-table',
    name: 'The Table',
    badge: DEFAULT_BADGE,
    blurb: '',
    foundedAt,
  });
  for (const [at, userId] of userIds.entries()) {
    repos.factions.addMember({
      userId,
      factionId: 'the-table',
      rank: at === 0 ? 'leader' : 'member',
      joinedAt: foundedAt,
    });
  }
}
