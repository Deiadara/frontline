/**
 * Every feat in the catalogue is fed by something the game actually runs, and none asks for more
 * than the game's own clocks can pay inside its three months (bug pass, 2026-10-05).
 *
 * `tallies.test.ts` proves that `tally.ts` *names* every tally measure. That is half of it: a
 * `tallyX` function can name a measure perfectly and still never be called, and then the feat on
 * it sits at zero for ever with every gate green. This walks the other half, feat by feat:
 *
 *   * a **crew** measure must come back from `snapshotFor` on a bare crew;
 *   * a **tally** measure must be written by a function in `tally.ts` that some non-test server
 *     file calls, directly or through another function in `tally.ts` that is itself called.
 *
 * Read from the source, for the reason `tallies.test.ts` gives: the question is whether a line of
 * code could ever write the counter, not whether today's tests happened to reach it.
 *
 * The last block holds the ladders whose top rung has a ceiling the game's own tables set, and
 * names the rungs above it. Those rungs are bugs (see bugpass-log.md, pass 3); the list is pinned
 * so a fix has to take a name off it, and a new dead rung has to be added on purpose.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILDING_KINDS,
  FEATS,
  FEAT_MEASURE_SPECS,
  MAX_DECLARE_LEAD_HOURS,
  MIN_DECLARE_LEAD_HOURS,
  MUSTER_MAX_BATCH,
  PLAYER_UNITS,
  featMeasureKey,
  levelCeilingFor,
  musterSecondsFor,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type FeatMeasure,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories } from '../db/repos/index.js';
import { snapshotFor } from './project.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.join(HERE, '..');
const TALLY_FILE = path.join(HERE, 'tally.ts');
const BATTLE_RULES = path.join(HERE, '../../../../packages/shared/src/feats/battle.ts');

/** Source with its comments removed, so a name in prose is neither a writer nor a call. */
const bare = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

const isMeasure = (name: string): name is FeatMeasure => name in FEAT_MEASURE_SPECS;

/** Every function in `tally.ts`, with the measures it names and the functions it calls. */
function tallyFunctions(): Map<string, { measures: Set<FeatMeasure>; calls: Set<string> }> {
  const source = bare(TALLY_FILE);
  const starts = [...source.matchAll(/function\s+([A-Za-z]\w*)\s*\(/g)].map((hit) => ({
    name: hit[1]!,
    at: hit.index,
  }));
  const names = new Set(starts.map((one) => one.name));
  // The seven "what did that fight look like" measures are decided in shared, and reach the
  // database through whichever function here hands its facts to `battleFeatsEarned`.
  const shapeMeasures = [...bare(BATTLE_RULES).matchAll(/'([a-z_]+)'/g)]
    .map((hit) => hit[1]!)
    .filter(isMeasure);

  const functions = new Map<string, { measures: Set<FeatMeasure>; calls: Set<string> }>();
  starts.forEach((start, index) => {
    const body = source.slice(start.at, starts[index + 1]?.at ?? source.length);
    const measures = new Set(
      [...body.matchAll(/'([a-z_]+)'/g)].map((hit) => hit[1]!).filter(isMeasure),
    );
    if (/\bbattleFeatsEarned\(/.test(body)) for (const one of shapeMeasures) measures.add(one);
    const calls = new Set(
      [...body.matchAll(/\b([A-Za-z]\w*)\(/g)]
        .map((hit) => hit[1]!)
        .filter((name) => name !== start.name && names.has(name)),
    );
    functions.set(start.name, { measures, calls });
  });
  return functions;
}

/** Every non-test `.ts` file under `apps/server/src`, `tally.ts` itself left out. */
function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return serverSources(full);
    if (!name.endsWith('.ts') || name.endsWith('.test.ts') || full === TALLY_FILE) return [];
    return [full];
  });
}

/** The functions in `tally.ts` some live code reaches, and the measures they can write. */
function reachableTallies(without: (file: string) => boolean = () => false): {
  functions: Set<string>;
  measures: Set<FeatMeasure>;
} {
  const functions = tallyFunctions();
  const callers = serverSources(SERVER_SRC)
    .filter((file) => !without(file))
    .map(bare)
    .join('\n');
  const reached = new Set(
    [...functions.keys()].filter((name) => new RegExp(`\\b${name}\\(`).test(callers)),
  );
  const queue = [...reached];
  while (queue.length > 0) {
    for (const callee of functions.get(queue.pop()!)?.calls ?? []) {
      if (reached.has(callee)) continue;
      reached.add(callee);
      queue.push(callee);
    }
  }
  const measures = new Set<FeatMeasure>();
  for (const name of reached) for (const one of functions.get(name)!.measures) measures.add(one);
  return { functions: reached, measures };
}

function bareCrewSnapshot(): Readonly<Record<string, number>> {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const repos = createRepositories(db);
  const now = '2026-10-05T12:00:00.000Z';
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES ('owner', 'one', 'x', ?)`,
  ).run(now);
  const base: Base = {
    id: 'base-1',
    ownerId: 'owner',
    name: 'The Yard',
    districtId: 'kettle-row',
    level: 1,
    isBot: false,
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, planks: 0, highQualityMetal: 0 },
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'b-nexus', kind: 'nexus', level: 1, modifications: [] }],
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
  };
  repos.bases.insert(base);
  return snapshotFor(repos, repos.bases.findByOwnerId('owner')!);
}

describe('where every feat gets its number', () => {
  it('reads the source the way it means to', () => {
    const functions = tallyFunctions();
    // Controls: a parser that found nothing would make every check below vacuous.
    expect(functions.size).toBeGreaterThan(30);
    expect(functions.get('tallyMissionHome')?.measures.has('missions_done')).toBe(true);
    expect(functions.get('tallyBattleShape')?.measures.has('battles_won_flawless')).toBe(true);
    expect(functions.get('tallyBattleSide')?.calls.has('tallyBattleResolved')).toBe(true);
    const { functions: reached } = reachableTallies();
    // Reached only through another function in `tally.ts`, never called from outside it.
    expect(reached.has('tallyBattleResolved')).toBe(true);
    expect(reached.has('tallyPagesFound')).toBe(true);
    expect(reached.has('tallyStackhouseWin')).toBe(true);
    // The positive control: take away the one file that calls the Stackhouse's writers and both
    // of its measures must drop out, or the check below could not see a writer nobody calls.
    const { measures: without } = reachableTallies((file) =>
      file.endsWith(path.join('blackmarket', 'stackhouse.ts')),
    );
    expect(without.has('stackhouse_bets')).toBe(false);
    expect(without.has('stackhouse_wins')).toBe(false);
    expect(without.has('missions_done')).toBe(true);
  });

  it('feeds every feat from a crew reading or a tally that live code writes', () => {
    const snapshot = bareCrewSnapshot();
    const { measures: written } = reachableTallies();
    const dead = FEATS.flatMap((feat) => {
      const source = FEAT_MEASURE_SPECS[feat.measure].source;
      if (source === 'crew') {
        const key = featMeasureKey(feat.measure, feat.scope);
        return snapshot[key] === undefined ? [`${feat.id}: crew key ${key} is never read`] : [];
      }
      return written.has(feat.measure)
        ? []
        : [`${feat.id}: nothing outside tally.ts reaches a writer of ${feat.measure}`];
    });
    expect(dead, dead.join('\n')).toEqual([]);
  });
});

/**
 * Ladders whose top has a hard ceiling inside the three-month clock (maintainer, 2026-10-02).
 *
 * Each ceiling is derived from the game's own tables, and each is generous: it assumes the best
 * case at every step, so a rung above it cannot be reached by anybody.
 */
describe('rungs above what ninety days can pay', () => {
  const DAYS = 90;
  const DAY_SECONDS = 86_400;

  /**
   * Units out of the yard. One queue per crew, served in order, so the bench's best day is the
   * fastest sheet in full batches at the speed taper's ceiling, round the clock with no gap.
   * It ignores the beds (no unit is ever disbanded, so every unit past the 2,200 slot ladder has
   * to die first), the bill, and that the queue holds five orders and so empties within the hour.
   */
  const musterCeiling = (): number => {
    const best = Math.max(
      ...PLAYER_UNITS.map(
        (unit) => MUSTER_MAX_BATCH / musterSecondsFor(unit, MUSTER_MAX_BATCH, 1_000_000),
      ),
    );
    return Math.floor(best * DAY_SECONDS * DAYS);
  };

  /**
   * Building levels raised. Nothing knocks a structure down except a Colossus at the home Gate,
   * one level per raid (`battle/wall-breaker.ts`). A raid is a call on the home district, a target
   * holds one unresolved call at a time (`declare.ts`, `alreadyCalled`), and a call lands no
   * sooner than `MIN_DECLARE_LEAD_HOURS` after it is made. So the most levels there ever are to
   * raise are every structure's ceiling once, and one Gate level per raid on top.
   */
  const raisedCeiling = (): number => {
    const standing = BUILDING_KINDS.reduce((total, kind) => total + levelCeilingFor(kind), 0);
    const raidsPerDay = Math.floor(24 / MIN_DECLARE_LEAD_HOURS);
    return standing + raidsPerDay * DAYS;
  };

  const CEILINGS: Partial<Record<FeatMeasure, number>> = {
    units_mustered: musterCeiling(),
    buildings_raised: raisedCeiling(),
  };

  /** The rungs above their ceiling today. Fixing one takes its id off this list. */
  const KNOWN_OVER = ['mustered_10', 'raised_6'];

  it('derives the ceilings from the tables', () => {
    // Pinned by hand, so a retune that moves a ceiling is noticed here rather than absorbed.
    expect(CEILINGS.units_mustered, 'Scavengers in fifties at the taper ceiling').toBe(766_863);
    expect(CEILINGS.buildings_raised, 'two hundred standing levels and three raids a day').toBe(
      470,
    );
    expect(MAX_DECLARE_LEAD_HOURS).toBeGreaterThan(MIN_DECLARE_LEAD_HOURS);
  });

  it('names every rung no crew can reach inside the game', () => {
    const over = FEATS.filter((feat) => {
      const ceiling = CEILINGS[feat.measure];
      return ceiling !== undefined && feat.target > ceiling;
    }).map((feat) => feat.id);
    expect(over.sort()).toEqual([...KNOWN_OVER].sort());
  });
});
