import {
  COMBINE_LEADERS,
  COMBINE_UNITS,
  FEATS,
  FEAT_MEASURE_SPECS,
  RESOURCE_KEYS,
  featMeasureKey,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type FeatMeasure,
} from '@frontline/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { tallyCombineFight, tallyMissionHome, tallyResourcesEarned } from './tally.js';

/**
 * The **spelling** of a scoped tally, which neither existing gate covers.
 *
 * `tallies.test.ts` proves every tally measure has a writer, by reading `tally.ts` with its
 * comments stripped and looking for the measure's name in quotes. `snapshot.test.ts` proves every
 * *crew* measure is produced under the scope the catalogue asks for. Between them sits a hole:
 * a **scoped tally**, where the measure name is a literal in `tally.ts` but the scope is a runtime
 * value (an area id, a unit id, a resource key) that no static read can see.
 *
 * So a feat can ask for `combine_kills_of:suppressor` while the hook writes
 * `combine_kills_of:Suppressor`, and both gates stay green while the rung sits at zero for ever.
 * That is the `stock_3` failure this codebase has already shipped once, and the reason
 * `catalog.test.ts` carries a ceiling table.
 *
 * The only way to see it is to run the hook and read the row back, which is what this file does.
 * It drives the real writers against a real database rather than asserting about source text.
 *
 * Five measures are in scope and they are found by asking the catalogue, not by a list kept here:
 * a sixth added tomorrow joins this test without anybody remembering to add it, and fails the
 * first assertion if nothing in here knows how to drive it.
 */

let db: AppDatabase;
let repos: Repositories;

const BASE_ID = 'base-scope';
const OWNER = 'owner-scope';
const T0 = new Date('2026-09-20T12:00:00.000Z');

/*
 * A real crew row, because `record` in `tally.ts` swallows a write that has nowhere to land:
 * "a counter is never worth a failed move". Against a database with no base every assertion below
 * would read `undefined` and this whole file would be a very confident way of measuring nothing.
 */
function makeBase(): Base {
  const now = T0.toISOString();
  return {
    id: BASE_ID,
    ownerId: OWNER,
    name: 'The Yard',
    districtId: 'kettle-row',
    level: 10,
    isBot: false,
    resources: {
      caps: 100,
      supplies: 100,
      oil: 100,
      scrap: 100,
      planks: 100,
      highQualityMetal: 10,
    },
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'b-nexus', kind: 'nexus', level: 5, modifications: [] }],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  repos = createRepositories(db);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, 'scope', 'x', ?)`,
  ).run(OWNER, T0.toISOString());
  repos.bases.insert(makeBase());
});

/** Every scope the catalogue actually asks for, per measure. */
function scopesWanted(measure: FeatMeasure): string[] {
  return [
    ...new Set(
      FEATS.filter((feat) => feat.measure === measure).flatMap((feat) =>
        feat.scope === undefined ? [] : [feat.scope],
      ),
    ),
  ];
}

const SCOPED_TALLY_MEASURES = (Object.keys(FEAT_MEASURE_SPECS) as FeatMeasure[]).filter(
  (measure) => FEAT_MEASURE_SPECS[measure].scoped && FEAT_MEASURE_SPECS[measure].source === 'tally',
);

/** What the counters hold for this crew, by full key. */
const tallies = (): Record<string, number> => repos.feats.tallies(BASE_ID);

describe('a scoped tally is written under the scope the catalogue asks for', () => {
  it('has the five measures this file knows how to drive, and no sixth nobody noticed', () => {
    // The control. If a scoped tally measure is added and nothing below drives it, this fails
    // rather than the file quietly covering four of six.
    expect([...SCOPED_TALLY_MEASURES].sort()).toEqual([
      'combine_kills_of',
      'combine_leaders_slain',
      'missions_in_area',
      'missions_of_kind',
      'resources_earned',
    ]);
  });

  it('spells a mission area and a mission kind the way the catalogue does', () => {
    const areas = scopesWanted('missions_in_area');
    const kinds = scopesWanted('missions_of_kind');
    expect(areas.length).toBeGreaterThan(5);
    expect(kinds.sort()).toEqual(['battle', 'standard']);

    for (const areaId of areas) {
      for (const kind of kinds) {
        tallyMissionHome(repos, BASE_ID, {
          areaId,
          kind: kind as 'battle' | 'standard',
          succeeded: true,
        });
      }
    }
    const held = tallies();
    for (const areaId of areas) {
      const key = featMeasureKey('missions_in_area', areaId);
      expect(held[key], `no counter under ${key}`).toBeGreaterThan(0);
    }
    for (const kind of kinds) {
      const key = featMeasureKey('missions_of_kind', kind);
      expect(held[key], `no counter under ${key}`).toBeGreaterThan(0);
    }
  });

  it('spells every resource the way the catalogue does', () => {
    const wanted = scopesWanted('resources_earned');
    expect(wanted.length).toBeGreaterThan(3);
    for (const key of wanted) {
      expect(RESOURCE_KEYS, `${key} is not a resource`).toContain(key);
    }
    tallyResourcesEarned(repos, BASE_ID, Object.fromEntries(wanted.map((key) => [key, 5])));
    const held = tallies();
    for (const resource of wanted) {
      const key = featMeasureKey('resources_earned', resource);
      expect(held[key], `no counter under ${key}`).toBe(5);
    }
  });

  /**
   * The two the Combine added on 2026-09-19, which are the freshest and therefore the likeliest
   * to be misspelled: their scopes are unit ids passed through a kill map.
   */
  it('spells every Combine unit and leader the way the catalogue does', () => {
    const units = scopesWanted('combine_kills_of');
    const leaders = scopesWanted('combine_leaders_slain');
    expect(units.length).toBe(4);
    expect(leaders.sort()).toEqual([...COMBINE_LEADERS.map((one) => one.unitId)].sort());
    for (const id of [...units, ...leaders]) {
      expect(
        COMBINE_UNITS.map((one) => one.id),
        `${id} is not a Combine unit`,
      ).toContain(id);
    }

    tallyCombineFight(repos, BASE_ID, {
      won: true,
      flawless: false,
      underLeader: true,
      killed: Object.fromEntries([...units, ...leaders].map((id) => [id, 1])),
      turned: 0,
      locationTaken: true,
    });

    const held = tallies();
    for (const id of units) {
      const key = featMeasureKey('combine_kills_of', id);
      expect(held[key], `no counter under ${key}`).toBe(1);
    }
    for (const id of leaders) {
      const key = featMeasureKey('combine_leaders_slain', id);
      expect(held[key], `no counter under ${key}`).toBe(1);
    }
  });

  /**
   * ...and nothing is written under a scope no feat asks for.
   *
   * The mirror of the tests above, and the half that catches a *stray* rather than a miss: a hook
   * that writes `combine_kills_of:razors` is spending rows on a counter no rung reads.
   */
  it('writes no scoped counter that no feat asks for', () => {
    tallyCombineFight(repos, BASE_ID, {
      won: true,
      flawless: true,
      underLeader: false,
      // A player unit among the dead: it is not the Combine's, so it must not be counted.
      killed: { suppressor: 2, razors: 9 },
      turned: 0,
      locationTaken: false,
    });
    const held = tallies();
    expect(held[featMeasureKey('combine_kills_of', 'suppressor')]).toBe(2);
    expect(held[featMeasureKey('combine_kills_of', 'razors')]).toBeUndefined();

    for (const [key, count] of Object.entries(held)) {
      const [measure, scope] = key.split(':') as [FeatMeasure, string | undefined];
      if (!SCOPED_TALLY_MEASURES.includes(measure) || scope === undefined) continue;
      expect(
        scopesWanted(measure),
        `${key} holds ${count} and no feat asks for that scope`,
      ).toContain(scope);
    }
  });
});
