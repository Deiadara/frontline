/**
 * A district's difficulty means one thing whoever holds it (maintainer, 2026-09-29).
 *
 * Combine ground was sized in unit slots on `combineSlotBudget` and looter ground in heads on a
 * flatter line of its own, so the ladder did not climb across allegiances: measured on the real
 * engine before the change, 20 Razors took the Undergrid (looters, 5) and Chrome Row (looters, 4)
 * while the Glasshouse's Berm (Combine, 3) wanted 40. Both parties now stand on the same budget,
 * each with its own mix, and this file walks the map to show the ladder climbs.
 *
 * The walk is the real settle: an in-memory world, a fight inserted on the hardest ordinary plot
 * of every garrisoned district in an open city, the NPC muster the declaration would add, and
 * `settleBattles` with the default engine. The reading is the smallest Razor column on a
 * `LADDER` rung of about a root of two apart that takes the plot at least 9 fights in 12. The
 * three legendaries are taken off the map first: their shadow is a second, deliberate climb on
 * top of the garrison (the district screen names it), and this file is about the garrison.
 *
 * Measured 2026-09-29 with this file's own walk, on the engine as it stood that evening, and again
 * 2026-10-01 after the Combine retune (Greycoat offense 122 to 112, Suppressor 372 to 400): the
 * Glasshouse's Greycoats fell from 29 to 24 and the Blacksite's Suppressors rose from 161 to 192,
 * and nothing else moved. The Glasshouse at 24 against the Yards at 34 is two rungs, the edge of
 * what the same-difficulty test below allows.
 *
 * Measured again 2026-10-02, when being outnumbered started counting unit slots (P10-B) and Last
 * Stand started ramping with the odds (P10-A). A Razor column no longer frightens a Suppressor by
 * outnumbering it four heads to one, so everything from difficulty 6 up rose, and the Blacksite's
 * half-Suppressor mix rose past the CCS's. The two top mixes were re-shared to keep the climb:
 * 7 and 8 went from half and half to 60% Enforcers and 40% Suppressors, and 9 and 10 from a
 * quarter Greycoats, 35% Enforcers and 40% Suppressors to 10%, 35% and 55%.
 *
 * | District          | Holder, difficulty | Plot                          | Razors |
 * | ----------------- | ------------------ | ----------------------------- | ------ |
 * | Neon Docks        | Combine, 1         | `neon-docks-cranegate`        | 10     |
 * | Coldwater Halt    | looters, 1         | `coldwater-halt-signal`       | 14     |
 * | Steelbelt         | Combine, 2         | `steelbelt-bonefield`         | 20     |
 * | Ironmouth         | looters, 2         | `ironmouth-arches`            | 20     |
 * | Glasshouse Fields | Combine, 3         | `glasshouse-fields-berm`      | 24     |
 * | Marshalling Yards | looters, 3         | `marshalling-yards-signalbox` | 34     |
 * | Chrome Row        | looters, 4         | `chrome-row-cathode`          | 48     |
 * | Bonded Row        | looters, 4         | `bonded-row-crated`           | 57     |
 * | Undergrid         | looters, 5         | `undergrid-lair`              | 68     |
 * | Telemetry Hill    | Combine, 6         | `telemetry-hill-array`        | 114    |
 * | Annexes           | Combine, 6         | `annexes-scaffold`            | 114    |
 * | Viaduct           | Combine, 7         | `viaduct-archnineteen`        | 228    |
 * | Blacksite         | Combine, 8         | `blacksite-pile`              | 272    |
 * | Last Platform     | Combine, 9         | `last-platform-armoury`       | 272    |
 * | Blockhouse        | Combine, 10        | `blockhouse-chapel`           | 384    |
 * | CCS               | Combine, 10        | `ccs-armory`                  | 323    |
 *
 * With the looter garrisons put back on the old head count and nothing else changed, the same walk
 * read 10 at Coldwater, 12 at Ironmouth, 17 on the Yards, 24 and 29 on Chrome and Bonded Row and
 * 34 on the Undergrid: Ironmouth at 2 under two thirds of the Steelbelt at 2, and Chrome Row at 4
 * under the Glasshouse at 3. That is the mutation the same-difficulty test below refuses.
 */
import {
  ALL_DISTRICTS,
  isContested,
  COMBINE_LEADERS,
  LOCATION_CATALOG,
  combineLeaderAt,
  defaultSkirmishEngine,
  emptyDeployment,
  findCity,
  findUnit,
  startingControl,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Army,
  type Base,
  type District,
  type Location,
  type ScheduledBattle,
} from '@frontline/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { npcMuster } from '../battle/npc.js';
import { defenderOf } from '../battle/ground.js';
import { settleBattles } from '../battle/resolve.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';

const LADDER: readonly number[] = Array.from({ length: 30 }, (_, rung) =>
  Math.round(3 * 2 ** (rung / 4)),
);
const TRIALS = 12;
const TAKES = 9;

const OWNER = 'owner-ladder';
const ATTACKER = 'base-ladder';
const T0 = new Date('2026-09-20T12:00:00.000Z');

let db: AppDatabase;
let repos: Repositories;
let clock = T0.getTime() + 24 * 3600_000;
let fights = 0;

function crew(): Base {
  const now = T0.toISOString();
  return {
    id: ATTACKER,
    ownerId: OWNER,
    name: 'The Ladder',
    districtId: 'kettle-row',
    level: 20,
    isBot: false,
    resources: {
      caps: 500,
      supplies: 500,
      oil: 500,
      scrap: 500,
      planks: 500,
      highQualityMetal: 50,
    },
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'nexus-1', kind: 'nexus', level: 5, modifications: [] }],
    buildQueue: [],
    // A reserve no column dents, so every fight is sent at the size it was asked for.
    army: { razors: 1_000_000 },
    musterQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
  };
}

beforeAll(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  repos = createRepositories(db);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, 'ladder', 'x', ?)`,
  ).run(OWNER, T0.toISOString());
  repos.bases.insert(crew());
  repos.city.controls();
  // The legendaries off the map, so no district fights under a leader's shadow.
  for (const leader of COMBINE_LEADERS) {
    const plot = repos.city.control(leader.locationId)!;
    repos.city.put({ ...plot, holder: { kind: 'unoccupied' }, garrison: {} });
  }
});

afterAll(() => {
  db.close();
});

const baseDefense = (location: Location) => LOCATION_CATALOG[location.kind].baseDefense;

/** The hardest plot the district's own garrison stands on, leaving out a leader's. */
function hardestPlot(district: District): Location | undefined {
  return district.locations
    .filter(
      (location) =>
        startingControl(location, district).holder.kind !== 'unoccupied' &&
        !combineLeaderAt(location.id),
    )
    .sort((a, b) => baseDefense(b) - baseDefense(a) || a.id.localeCompare(b.id))[0];
}

/** One real fight on a freshly garrisoned plot: whether `razors` took it. */
function takes(district: District, location: Location, razors: number, trial: number): boolean {
  repos.city.put(startingControl(location, district));
  clock += 60_000;
  fights += 1;
  const target = { kind: 'location', districtId: district.id, locationId: location.id } as const;
  const defender = defenderOf(repos, target, district);
  const battle: ScheduledBattle = {
    id: `ladder-${fights}`,
    target,
    attackerBaseId: ATTACKER,
    defender,
    scheduledFor: new Date(clock).toISOString(),
    declaredAt: new Date(clock - 9 * 3600_000).toISOString(),
    resolvedAt: null,
    seed: `ladder-${location.id}-${razors}-${trial}`,
    holdAfterCapture: true,
    wokeSleepers: false,
  };
  repos.sieges.insert(battle);
  repos.sieges.putDeployment({
    ...emptyDeployment(battle.id, ATTACKER, 'attacker', battle.declaredAt),
    army: { razors },
  });
  repos.sieges.putDeployment({
    ...emptyDeployment(battle.id, null, 'defender', battle.declaredAt),
    army: npcMuster(defender, district, battle.seed),
  });
  settleBattles(repos, defaultSkirmishEngine, new Date(clock + 1000));
  const taken = repos.city.control(location.id)?.holder.kind === 'crew';
  // Handed straight back, or the plot's hold bonus would ride into every later fight and the
  // reading would depend on the order the map is walked in.
  repos.city.put(startingControl(location, district));
  return taken;
}

/** The index of the smallest `LADDER` rung that takes the plot `TAKES` times in `TRIALS`. */
function rungThatTakes(district: District, location: Location): number {
  const holds = (rung: number) => {
    let won = 0;
    for (let trial = 0; trial < TRIALS; trial += 1) {
      if (takes(district, location, LADDER[rung]!, trial)) won += 1;
    }
    return won >= TAKES;
  };
  let low = 0;
  let high = LADDER.length - 1;
  if (!holds(high)) return LADDER.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (holds(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

interface Reading {
  id: string;
  difficulty: number;
  holder: string;
  /** Index into `LADDER` of the smallest column that takes the plot. */
  rung: number;
}

const describePair = (a: Reading, b: Reading) =>
  `${a.id} (${a.holder} ${a.difficulty}, ${LADDER[a.rung]}) vs ${b.id} (${b.holder} ${b.difficulty}, ${LADDER[b.rung]})`;

describe('the difficulty ladder, across allegiances', () => {
  const walked = ALL_DISTRICTS.filter(isContested)
    .filter((district) => findCity(district.cityId)?.open)
    .flatMap((district) => {
      const plot = hardestPlot(district);
      return plot ? [{ district, plot }] : [];
    });
  let walk: Reading[] = [];

  beforeAll(() => {
    walk = walked.map(({ district, plot }) => ({
      id: plot.id,
      difficulty: district.difficulty,
      holder: startingControl(plot, district).holder.kind,
      rung: rungThatTakes(district, plot),
    }));
  }, 120_000);

  it('walks both parties’ ground at the same difficulties', () => {
    const shared = (holder: string) =>
      new Set(walk.filter((one) => one.holder === holder).map((one) => one.difficulty));
    const looters = shared('looters');
    const both = [...shared('government')].filter((difficulty) => looters.has(difficulty));
    expect(both.length, 'no difficulty is held by both parties').toBeGreaterThanOrEqual(2);
  });

  /*
   * A quarter-octave rung either way is the noise of a dozen fights, and a whole difficulty step
   * near the top is only one or two rungs (7, 8 and 9 read 272, 323 and 323 on 2026-10-05: the
   * Blacksite and the Last Platform land on the same rung, which the one-rung allowance covers;
   * the CCS Armory at 10 reads 384). Two steps apart is
   * a climb the reading has to show.
   */
  it('asks for more force the higher the difficulty', () => {
    for (const lower of walk) {
      for (const higher of walk) {
        if (higher.difficulty <= lower.difficulty) continue;
        expect(higher.rung, describePair(lower, higher)).toBeGreaterThanOrEqual(lower.rung - 1);
        if (higher.difficulty - lower.difficulty >= 2) {
          expect(higher.rung, describePair(lower, higher)).toBeGreaterThan(lower.rung);
        }
      }
    }
  });

  /*
   * The ruling itself: the Combine and the looters at the same number are the same fight, within
   * a root of two (two rungs). On the old head count the looters at 2 fell to half what the
   * Combine at 2 wanted, which is four rungs.
   */
  it('reads the same difficulty the same whoever holds it', () => {
    for (const combine of walk.filter((one) => one.holder === 'government')) {
      for (const looters of walk.filter((one) => one.holder === 'looters')) {
        if (looters.difficulty !== combine.difficulty) continue;
        expect(
          Math.abs(looters.rung - combine.rung),
          describePair(combine, looters),
        ).toBeLessThanOrEqual(2);
      }
    }
  });
});

/**
 * The muster a declaration meets is on the same curve as the garrison. The looters turned out
 * `1.6 * difficulty` heads where the Combine turned out half its slot budget, so the fight a
 * crew called on looter ground was lighter than the number on the district said.
 */
describe('the muster, across allegiances', () => {
  const slotsOf = (army: Army) =>
    Object.entries(army).reduce(
      (total, [unitId, count]) => total + count * (findUnit(unitId)?.unitSlots ?? NaN),
      0,
    );

  it('turns the looters out on the slots the Combine would at the same difficulty', () => {
    const looterGround = ALL_DISTRICTS.filter((district) =>
      district.locations.some(
        (location) => startingControl(location, district).holder.kind === 'looters',
      ),
    );
    expect(looterGround.length).toBeGreaterThan(3);
    for (const district of looterGround) {
      for (let seed = 0; seed < 20; seed += 1) {
        const looters = npcMuster({ kind: 'looters' }, district, `muster-${seed}`);
        const combine = npcMuster({ kind: 'government' }, district, `muster-${seed}`);
        expect(slotsOf(looters), `${district.id} ${seed}`).toBeGreaterThan(0);
        expect(slotsOf(looters), `${district.id} ${seed}`).toBe(slotsOf(combine));
        expect(Object.keys(looters).sort()).toEqual(['razors', 'scrapers']);
      }
    }
  });
});
