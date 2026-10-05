/**
 * The weekly cycle, counted (2026-09-24, feats pass 2026-09-25).
 *
 * Two mechanics landed together and neither had a feat on it, which is the failure CLAUDE.md's
 * "Feats move with the game" section is written about: a mechanic with no feat is invisible on the
 * one screen that tells a player what there is to do.
 *
 *   * **Erosion.** Survivors of a gate or district fight are written back to the control rows they
 *     were drawn off (`battle/resolve.ts`, `spendGarrisons`), so the regime's standing army really
 *     does shrink across a week of assaults, and a district can be stripped bare.
 *   * **Regrowth.** Monday 00:00 Athens time puts every plot no crew holds back to its authored
 *     strength (`city/regrowth.ts`), so clearing ground only matters if you then keep it.
 *
 * Both hooks are one line at a site that already knew the answer, which is exactly the kind of hook
 * that goes in on the wrong side of an early return and is never noticed. So these drive the real
 * settle and the real sweep and read the counters afterwards, the way `tally.test.ts` does, rather
 * than calling the tally functions with hand-built arguments.
 */
import {
  COMBINE_LEADERS,
  EVERY_LOCATION,
  combineLeaderAt,
  emptyDeployment,
  skirmishOutcome,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Army,
  type Base,
  type BattleTarget,
  type ScheduledBattle,
  type SkirmishEngine,
  type SkirmishOutcome,
} from '@frontline/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { settleBattles } from '../battle/resolve.js';
import { settleGarrisonRegrowth } from '../city/regrowth.js';

let db: AppDatabase;
let repos: Repositories;

const OWNER = 'owner-week';
const RIVAL_OWNER = 'owner-week-rival';
const ATTACKER = 'base-week';
const RIVAL = 'base-week-rival';

const T0 = new Date('2026-09-20T12:00:00.000Z');
const MARK = new Date('2026-09-21T10:00:00.000Z');
const SETTLE = new Date('2026-09-21T11:00:00.000Z');
/** Monday morning, past the 00:00 Athens boundary the sweep is claimed against. */
const MONDAY = new Date('2026-09-21T09:00:00.000Z');
/** The Monday after it, for the second sweep. */
const NEXT_MONDAY = new Date('2026-09-28T09:00:00.000Z');

/** The cheapest Combine ground in the game, and the only Combine district with no legendary on it. */
const DOCKS = 'neon-docks';
/** Looter ground: the squatters erode and regrow on exactly the same rules. */
const UNDERGRID = 'undergrid';
/** The Syndic's district, and his plot: he is never in a gate fight, so he never falls in one. */
const ANNEXES = 'annexes';
const UPLINK = 'annexes-uplink';

function crew(over: Partial<Base> = {}): Base {
  const now = T0.toISOString();
  return {
    id: ATTACKER,
    ownerId: OWNER,
    name: 'The Yard',
    districtId: 'kettle-row',
    level: 8,
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
    army: { razors: 400 },
    musterQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
    ...over,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  repos = createRepositories(db);
  const users = db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)`,
  );
  users.run(OWNER, 'week', T0.toISOString());
  users.run(RIVAL_OWNER, 'week-rival', T0.toISOString());
  repos.bases.insert(crew());
  repos.bases.insert(
    crew({ id: RIVAL, ownerId: RIVAL_OWNER, name: 'The Other Yard', districtId: 'upper-roofs' }),
  );
  // Materialise every control row, so a reading taken afterwards is the whole map rather than a
  // patch over rows that did not exist yet.
  repos.city.controls();
});

afterEach(() => {
  db.close();
});

const talliesFor = (baseId: string) => repos.feats.tallies(baseId);
const emptied = (baseId = ATTACKER) => talliesFor(baseId)['districts_emptied'] ?? 0;
const kept = (baseId = ATTACKER) => talliesFor(baseId)['plots_held_through_regrowth'] ?? 0;

/** A fight against whoever holds the ground, declared and deployed and nothing else. */
function callFight(target: BattleTarget, defender: ScheduledBattle['defender']): void {
  const id = `week-${target.kind}-${Math.random().toString(36).slice(2, 8)}`;
  repos.sieges.insert({
    id,
    target,
    attackerBaseId: ATTACKER,
    defender,
    scheduledFor: MARK.toISOString(),
    declaredAt: T0.toISOString(),
    resolvedAt: null,
    seed: `seed-${id}`,
    holdAfterCapture: false,
    wokeSleepers: false,
  });
  repos.sieges.putDeployment({
    ...emptyDeployment(id, ATTACKER, 'attacker', T0.toISOString()),
    army: { razors: 400 },
  });
}

/** The door of a district, which is the fight that folds every plot behind it into one line. */
function callGateFight(districtId: string, defender: ScheduledBattle['defender']): void {
  callFight({ kind: 'gate', districtId }, defender);
}

/** An engine that answers with one fixed outcome, so the arithmetic is the test's and not a draw's. */
function fixed(outcome: Partial<SkirmishOutcome>): SkirmishEngine {
  return {
    resolve: (input) =>
      skirmishOutcome({ winner: 'defender', log: [`${input.locationName} decided`], ...outcome }),
  };
}

/** Every body standing on a district's control rows, whoever they answer to. */
function bodiesIn(districtId: string): number {
  let total = 0;
  for (const location of EVERY_LOCATION.filter((one) => one.districtId === districtId)) {
    const control = repos.city.control(location.id);
    for (const count of Object.values(control?.garrison ?? {})) total += count;
  }
  return total;
}

/** Hands this crew a plot, garrison and all, the way a capture would. */
function give(locationId: string, baseId: string, garrison: Army = { razors: 2 }): void {
  const control = repos.city.control(locationId)!;
  repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison });
}

describe('stripping a district bare', () => {
  /**
   * The load-bearing one, and it is a whole-district question rather than a per-plot one.
   *
   * `fixed({ winner: 'attacker' })` leaves nobody standing and nothing fleeing, so one gate fight
   * takes every plot in the Docks to zero at once: the split has no survivors to apportion. That is
   * the same fixture `battle/garrison-erosion.test.ts` uses to prove the write-back happens, read
   * from the feats side.
   */
  it('counts a Combine district whose last garrison this fight took to nothing', () => {
    expect(bodiesIn(DOCKS), 'fixture error: nobody is standing in the Docks').toBeGreaterThan(0);
    expect(emptied()).toBe(0);

    callGateFight(DOCKS, { kind: 'government' });
    settleBattles(repos, fixed({ winner: 'attacker' }), SETTLE);

    expect(bodiesIn(DOCKS), 'the fight left somebody standing').toBe(0);
    expect(emptied()).toBe(1);
  });

  it('counts the squatters the same way it counts the regime', () => {
    expect(bodiesIn(UNDERGRID), 'fixture error: nobody squats the Undergrid').toBeGreaterThan(0);

    callGateFight(UNDERGRID, { kind: 'looters' });
    settleBattles(repos, fixed({ winner: 'attacker' }), SETTLE);

    expect(bodiesIn(UNDERGRID)).toBe(0);
    expect(emptied()).toBe(1);
  });

  /**
   * A fight that left bodies on the ground has not stripped anything.
   *
   * The control that matters most: a counter bumped on every won gate fight would read like this
   * one working while being a `battles_won` under another name.
   */
  it('counts nothing while anybody of theirs is still standing', () => {
    const before = bodiesIn(DOCKS);
    const unit = Object.keys(repos.city.control(`${DOCKS}-tideline`)?.garrison ?? {})[0];
    expect(unit, 'fixture error: the tideline is empty').toBeDefined();

    callGateFight(DOCKS, { kind: 'government' });
    // The defence holds and pays four bodies for it, which is four off the plots and no more.
    settleBattles(repos, fixed({ winner: 'defender', winnerLosses: { [unit!]: 4 } }), SETTLE);

    expect(bodiesIn(DOCKS), 'the fight should have cost the defence something').toBe(before - 4);
    expect(emptied()).toBe(0);
  });

  /**
   * The legendary is the reason a Combine district cannot always be stripped from the door.
   *
   * `withoutTheLeader` holds him out of a gate fight, so his plot is never in the line and never in
   * the write-back: the Annexes keep one body however many times the gate falls. Taking the ladder
   * to him means taking his plot, which is the rule the erosion was written under and which this
   * counter must not quietly undo.
   */
  it('leaves the Annexes standing while the Syndic does', () => {
    const leader = combineLeaderAt(UPLINK);
    expect(leader, 'fixture error: nobody stands on the uplink').toBeDefined();

    callGateFight(ANNEXES, { kind: 'government' });
    settleBattles(repos, fixed({ winner: 'attacker' }), SETTLE);

    expect(repos.city.control(UPLINK)?.garrison).toEqual({ [leader!.unitId]: 1 });
    expect(bodiesIn(ANNEXES), 'only the Syndic is left').toBe(1);
    expect(emptied()).toBe(0);
  });

  /** ...and once his plot is somebody else's, what is left of the district is nothing. */
  it('counts the Annexes once the Syndic’s plot is off the regime', () => {
    give(UPLINK, ATTACKER, {});

    callGateFight(ANNEXES, { kind: 'government' });
    settleBattles(repos, fixed({ winner: 'attacker' }), SETTLE);

    expect(emptied()).toBe(1);
  });

  /**
   * Stripped once is stripped once, however many times the door is knocked down afterwards.
   *
   * Nothing resets this until Monday, so a second fight in the same week has no garrison to spend
   * and must pay no counter. A tally that climbed per fight would make the ladder a fight counter.
   */
  it('counts a district once per stripping and not once per fight', () => {
    callGateFight(DOCKS, { kind: 'government' });
    settleBattles(repos, fixed({ winner: 'attacker' }), SETTLE);
    expect(emptied()).toBe(1);

    callGateFight(DOCKS, { kind: 'government' });
    settleBattles(repos, fixed({ winner: 'attacker' }), new Date(SETTLE.getTime() + 3_600_000));
    expect(emptied()).toBe(1);
  });

  /**
   * Taking the last plot off them is a capture, not a stripping.
   *
   * The one case where the two readings of "emptied" part company, and the reason the counter asks
   * for a plot that is **still theirs** and standing at zero rather than merely for a district with
   * none of them left in it. Clear six plots, take the seventh, and nothing of the regime's is in the
   * district: under the looser reading that pays out, and it pays out on ground that was never worn
   * down at all, because a crew that captures every garrisoned plot in Chrome Row one at a time would
   * collect it too. That is `districts_held_whole` and `locations_captured` wearing this ladder's
   * name, and the rungs are not priced for it.
   */
  it('counts nothing for a district whose last plot was captured rather than stripped', () => {
    const plots = EVERY_LOCATION.filter((one) => one.districtId === DOCKS).map((one) => one.id);
    const last = plots.at(-1)!;
    for (const locationId of plots) {
      if (locationId !== last) repos.city.setGarrison(locationId, {});
    }
    expect(bodiesIn(DOCKS), 'fixture error: the last plot should still be held').toBeGreaterThan(0);

    callFight({ kind: 'location', districtId: DOCKS, locationId: last }, { kind: 'government' });
    settleBattles(repos, fixed({ winner: 'attacker' }), SETTLE);

    expect(repos.city.control(last)?.holder, 'the plot changed hands').toEqual({
      kind: 'crew',
      baseId: ATTACKER,
    });
    // The winners hold the plot (maintainer, 2026-09-28), so its garrison is the attacker's now.
    const ours = Object.values(repos.city.control(last)!.garrison).reduce((a, b) => a + b, 0);
    expect(bodiesIn(DOCKS) - ours, 'nothing of theirs is standing in the Docks').toBe(0);
    expect(emptied()).toBe(0);
  });

  /** A crew's own plot in the district is not the regime's, so it is neither stripped nor a blocker. */
  it('ignores a plot a crew holds, whether or not anybody is standing on it', () => {
    give(`${DOCKS}-tideline`, RIVAL, { razors: 9 });

    callGateFight(DOCKS, { kind: 'government' });
    settleBattles(repos, fixed({ winner: 'attacker' }), SETTLE);

    expect(repos.city.control(`${DOCKS}-tideline`)?.garrison).toEqual({ razors: 9 });
    expect(emptied(), 'the rival’s nine do not hold the district for the regime').toBe(1);
    expect(emptied(RIVAL), 'and the rival did not strip anything').toBe(0);
  });
});

describe('holding ground through the Monday rebuild', () => {
  it('counts every plot a crew still held when the sweep ran', () => {
    give(`${DOCKS}-tideline`, ATTACKER);
    give(`${UNDERGRID}-junction`, ATTACKER);
    expect(kept()).toBe(0);

    settleGarrisonRegrowth(repos, MONDAY);

    expect(kept()).toBe(2);
  });

  it('counts nothing for ground the regime, the squatters or nobody holds', () => {
    settleGarrisonRegrowth(repos, MONDAY);
    expect(kept()).toBe(0);
    expect(kept(RIVAL)).toBe(0);
  });

  it('keeps two crews apart', () => {
    give(`${DOCKS}-tideline`, ATTACKER);
    give(`${DOCKS}-pumphouse`, RIVAL);
    give(`${UNDERGRID}-junction`, RIVAL);

    settleGarrisonRegrowth(repos, MONDAY);

    expect(kept()).toBe(1);
    expect(kept(RIVAL)).toBe(2);
  });

  /**
   * Once a week, not once a tick.
   *
   * `settleWorld` runs about once a second and on every page load besides, and the sweep is guarded
   * by one row per week mark (`repos.regrowth.claim`). A counter written outside that guard would
   * hand a crew holding twenty plots twenty a second, which is the one way this measure could be
   * dishonest and would look exactly like it working.
   */
  it('counts once for the week however many times the sweep is called', () => {
    give(`${DOCKS}-tideline`, ATTACKER);

    settleGarrisonRegrowth(repos, MONDAY);
    settleGarrisonRegrowth(repos, new Date(MONDAY.getTime() + 60_000));
    settleGarrisonRegrowth(repos, new Date(MONDAY.getTime() + 2 * 3_600_000));

    expect(kept()).toBe(1);
  });

  it('counts again the week after, because tenure is what it measures', () => {
    give(`${DOCKS}-tideline`, ATTACKER);

    settleGarrisonRegrowth(repos, MONDAY);
    settleGarrisonRegrowth(repos, NEXT_MONDAY);

    expect(kept()).toBe(2);
  });

  /** Ground lost before the sweep pays nothing: the whole point is that you were still on it. */
  it('counts nothing for a plot handed over before Monday', () => {
    give(`${DOCKS}-tideline`, ATTACKER);
    give(`${DOCKS}-tideline`, RIVAL);

    settleGarrisonRegrowth(repos, MONDAY);

    expect(kept()).toBe(0);
    expect(kept(RIVAL)).toBe(1);
  });

  /** A leader's plot is the regime's, so it is never counted as anybody's tenure. */
  it('never counts the legendaries’ own ground as held', () => {
    expect(COMBINE_LEADERS.length, 'fixture error: no legendaries').toBeGreaterThan(0);
    settleGarrisonRegrowth(repos, MONDAY);
    for (const leader of COMBINE_LEADERS) {
      expect(repos.city.control(leader.locationId)?.holder.kind).toBe('government');
    }
    expect(kept()).toBe(0);
  });
});
