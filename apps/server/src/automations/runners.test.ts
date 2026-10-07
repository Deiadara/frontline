import {
  ALL_DISTRICTS as CITY_DISTRICTS_ALL,
  MISSION_FORCE_REFUSAL_TEXT,
  AUTOMATION_COOLDOWN_MS,
  AUTOMATION_RUNGS,
  CITY_DISTRICTS,
  automationPowers,
  MISC_AREA_ID,
  missionBoardKey,
  missionOffers,
  templateTimings,
  areaIsOpen,
  cityOfDistrict,
  districtsOfCity,
  MAX_ATTRIBUTE,
  RESOURCE_KG,
  TacticalSkirmishEngine,
  bestFitParty,
  carriedHome,
  missionCarry,
  missionRewards,
  areaPayPercent,
  scaledSpoils,
  createCommander,
  makeAttributes,
  boardIsAutomated,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  findMissionTemplate,
  missionOdds,
  composeProfile,
  leaningsFor,
  NO_RIGHT_HAND_TEXT,
  type Automation,
  type Base,
  type Commander,
} from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { STALL_RETRY_MS, candidates, settleAutomations } from './runners.js';
import { enemyForce } from '../missions/enemy.js';
import { areaStatesFor } from '../missions/board.js';
import { tickWorld } from '../live/clock.js';
import { fightChanceFor } from '../missions/fight-leaders.js';
import { liftedOfficerSheet, officerLiftRoom, standingEffectsFor } from '../crew/standing.js';
import { settleWorld } from '../world/settle.js';
import { skirmishOutcome, type SkirmishEngine } from '@frontline/shared';

/**
 * The Right Hand carries out standing orders on the world clock (§C2b, 2026-09-22).
 *
 * What is worth a test here is the part a player cannot watch: the settler runs inside
 * `settleWorld`, which the world clock calls once a second with nobody connected, so these are
 * the assertions that the feature works at all for the person it was built for, who is asleep.
 */
const dbs: AppDatabase[] = [];
const NOW = new Date('2026-09-22T12:00:00.000Z');

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function stack(
  rungs: readonly string[] = [AUTOMATION_RUNGS.open],
  /** Districts the crew holds a location in. Every contested one of Ashfall, unless told less. */
  footholds: readonly string[] = CITY_DISTRICTS.filter((one) => one.kind === 'contested').map(
    (one) => one.id,
  ),
): {
  repos: Repositories;
  base: Base;
} {
  const db = openDatabase(':memory:');
  runMigrations(db);
  dbs.push(db);
  const repos = createRepositories(db);
  const now = NOW.toISOString();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'boss', 'x', ?)`,
  ).run(now);
  const base: Base = {
    id: 'base-1',
    ownerId: 'u1',
    name: 'The Yard',
    districtId: 'kettle-row',
    level: 10,
    isBot: false,
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, planks: 0, highQualityMetal: 0 },
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: { ...startingResearch(), technologies: [...rungs] },
    buildings: [{ id: 'nexus-1', kind: 'nexus', level: 10, modifications: [] }],
    buildQueue: [],
    army: { razors: 40 },
    musterQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    // Two, because a slot names a leader and an officer already out on a run is not free: one
    // officer and two slots is a fixture that stalls the second for a reason this file is not
    // about.
    commanders: [
      createCommander('off-1', 'The Deputy', 'right_hand', makeAttributes(70)),
      createCommander('off-2', 'The Other One', 'field_commander', makeAttributes(70)),
    ],
    createdAt: now,
  };
  repos.bases.insert(base);
  // A place in every district asked for, so every board is open and a stall is never simply "you
  // hold nothing there" (`areaIsOpen`, maintainer 2026-09-29).
  for (const districtId of footholds) holdOneIn(repos, base.id, districtId);
  return { repos, base };
}

/** The crew takes the first location of a district, which is what opens its board. */
function holdOneIn(repos: Repositories, baseId: string, districtId: string): void {
  const location = CITY_DISTRICTS_ALL.find((one) => one.id === districtId)?.locations[0];
  const control = location ? repos.city.control(location.id) : undefined;
  if (!control) throw new Error(`fixture: ${districtId} has no location to hold`);
  repos.city.put({ ...control, holder: { kind: 'crew', baseId } });
}

function slot(repos: Repositories, base: Base, over: Partial<Automation> = {}): Automation {
  const automation: Automation = {
    id: randomUUID(),
    baseId: base.id,
    slot: 0,
    kind: 'missions',
    enabled: true,
    order: 'missions',
    step: 0,
    force: { razors: 4 },
    officerId: 'off-1',
    unitSlots: null,
    optimiseFor: null,
    missionId: null,
    restingSince: null,
    stalled: null,
    ...over,
  };
  repos.automations.put(automation);
  return automation;
}

/**
 * The boards a crew's standing order reads, by the runner's own rule: the misc board and every
 * district of the crew's city the board screen would draw (`areaIsOpen`). A test that priced every
 * district in the city was pricing boards the runner cannot see, and passed only while the best
 * job happened to sit on one it could.
 */
function openAreas(repos: Repositories, base: Base): string[] {
  const states = areaStatesFor(repos, base);
  return [
    MISC_AREA_ID,
    ...districtsOfCity(cityOfDistrict(base.districtId))
      .filter((district) => {
        const state = states.get(district.id);
        return state !== undefined && areaIsOpen(district, state);
      })
      .map((district) => district.id),
  ];
}

/**
 * "Need the officer seated" (maintainer, 2026-09-29): standing orders are the Right Hand's work, so
 * every slot stalls while that chair is empty, its officer benched or in a hospital bed, and runs
 * again the moment somebody fit sits back down. The slot names the Field Commander as its leader,
 * so the leader is never the reason it stalls.
 */
describe("the Right Hand's chair", () => {
  const tomorrow = new Date(NOW.getTime() + 86_400_000).toISOString();
  const without: Record<string, (officers: readonly Commander[]) => Commander[]> = {
    empty: (officers) => officers.filter((one) => one.role !== 'right_hand'),
    benched: (officers) =>
      officers.map((one) => (one.role === 'right_hand' ? { ...one, role: null } : one)),
    hurt: (officers) =>
      officers.map((one) => (one.role === 'right_hand' ? { ...one, injuredUntil: tomorrow } : one)),
  };

  for (const [how, strip] of Object.entries(without)) {
    it(`stalls every order with the chair ${how}, and runs again once it is filled`, () => {
      const { repos, base } = stack();
      repos.bases.updateCommanders(base.id, strip(base.commanders));
      slot(repos, base, { officerId: 'off-2' });
      expect(settleAutomations(repos, NOW)).toBe(0);
      expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(0);
      expect(repos.automations.get(base.id, 0)?.stalled).toBe(NO_RIGHT_HAND_TEXT);

      repos.bases.updateCommanders(base.id, base.commanders);
      expect(settleAutomations(repos, new Date(NOW.getTime() + STALL_RETRY_MS + 1_000))).toBe(1);
    });
  }
});

describe('a standing order on the world clock', () => {
  it('sends a party without anybody being logged in', () => {
    const { repos, base } = stack();
    slot(repos, base);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(0);

    expect(settleAutomations(repos, NOW)).toBe(1);

    const active = repos.missions.listActiveByBaseId(base.id);
    expect(active).toHaveLength(1);
    // The roster moved with the row: a crew that is out is not at home to defend the district.
    expect(repos.bases.findById(base.id)?.army.razors).toBe(36);
    // And the slot is holding that run, so it does not send a second party behind it.
    expect(repos.automations.get(base.id, 0)?.missionId).toBe(active[0]?.mission.id);
  });

  it('sends nobody while its party is still out', () => {
    const { repos, base } = stack();
    slot(repos, base);
    expect(settleAutomations(repos, NOW)).toBe(1);
    // A minute later, and an hour later: still one crew out, not two and not forty.
    expect(settleAutomations(repos, new Date(NOW.getTime() + 60_000))).toBe(0);
    expect(settleAutomations(repos, new Date(NOW.getTime() + 3_600_000))).toBe(0);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(1);
  });

  /**
   * The gap, which is the whole reason a standing order is convenience rather than a better rate.
   */
  it('rests for fifteen minutes after a party walks in, then goes again', () => {
    const { repos, base } = stack();
    const one = slot(repos, base);
    // A slot that came home a moment ago is resting, whatever else is true.
    repos.automations.put({ ...one, restingSince: NOW.toISOString() });
    expect(settleAutomations(repos, new Date(NOW.getTime() + 60_000))).toBe(0);
    expect(settleAutomations(repos, new Date(NOW.getTime() + AUTOMATION_COOLDOWN_MS - 1_000))).toBe(
      0,
    );
    expect(settleAutomations(repos, new Date(NOW.getTime() + AUTOMATION_COOLDOWN_MS + 1_000))).toBe(
      1,
    );
  });

  it('stalls, and says why, when the party it was told to send is not at home', () => {
    const { repos, base } = stack();
    slot(repos, base, { force: { razors: 400 } });
    expect(settleAutomations(repos, NOW)).toBe(0);
    expect(repos.automations.get(base.id, 0)?.stalled).toMatch(/not at home/i);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(0);
  });

  // Every stall read "not at home", so porters named for a fight sat at home under a sentence that
  // blamed their absence (bug pass, 2026-10-02). It now says the launch's own reason.
  // Every city the crew may stand in (maintainer, 2026-10-02): a crew whose ground is all abroad
  // had a Right Hand that only ever read the misc board at home.
  it('reads the boards of every city the crew holds ground in', () => {
    const away = CITY_DISTRICTS_ALL.find(
      (district) =>
        district.kind === 'contested' && district.cityId !== cityOfDistrict('kettle-row'),
    );
    if (!away) throw new Error('fixture: no contested district in another city');
    const { repos, base } = stack([AUTOMATION_RUNGS.open], []);
    holdOneIn(repos, base.id, away.id);
    const boards = new Set(candidates(repos, base, 'mission', NOW).map((one) => one.areaId));
    expect(boards.has(away.id)).toBe(true);
  });

  it('stalls with the real reason when the party it named cannot fight', () => {
    const { repos, base } = stack([AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.battles]);
    repos.bases.updateArmy(base.id, { razors: 40, haulers: 8 }, base.musterQueue);
    slot(repos, base, { order: 'battles', force: { haulers: 8 } });
    expect(settleAutomations(repos, NOW)).toBe(0);
    expect(repos.automations.get(base.id, 0)?.stalled).toBe(
      MISSION_FORCE_REFUSAL_TEXT.needs_fighters,
    );
  });

  it('stalls, and says why, when a raid on home is inside its last hour', () => {
    const { repos, base } = stack();
    slot(repos, base);
    repos.sieges.insert({
      id: 'raid-on-home',
      target: { kind: 'district', districtId: base.districtId },
      attackerBaseId: base.id,
      defender: { kind: 'unoccupied' },
      scheduledFor: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
      declaredAt: NOW.toISOString(),
      resolvedAt: null,
      seed: 'seed',
      holdAfterCapture: true,
      wokeSleepers: false,
    });
    expect(settleAutomations(repos, NOW)).toBe(0);
    expect(repos.automations.get(base.id, 0)?.stalled).toMatch(/raid lands on your district/i);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(0);
  });

  it('stalls when the officer it was told to send is not there', () => {
    const { repos, base } = stack();
    slot(repos, base, { officerId: 'nobody' });
    expect(settleAutomations(repos, NOW)).toBe(0);
    expect(repos.automations.get(base.id, 0)?.stalled).toBe(
      'The officer you named is no longer on your books',
    );
  });

  it('ignores a slot that is switched off', () => {
    const { repos, base } = stack();
    slot(repos, base, { enabled: false });
    expect(settleAutomations(repos, NOW)).toBe(0);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(0);
  });

  /**
   * The ladder is read every tick rather than trusted from when the slot was written.
   *
   * Research can be cancelled and the Console can take a rung away, and a slot that outlived its
   * rung has to stop rather than keep running on a permission the crew no longer holds.
   */
  it('stops a slot whose rung the crew no longer holds', () => {
    const { repos, base } = stack([]);
    slot(repos, base);
    expect(automationPowers(base.research.technologies).unlocked).toBe(false);
    expect(settleAutomations(repos, NOW)).toBe(0);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(0);
  });

  /*
   * ...and every rung the save checks, not only the unlock and the slot count (bug pass,
   * 2026-10-06): a slot saved as a fitted size, an order or a chase the crew no longer holds kept
   * running on it. It stalls with the save's own sentence.
   */
  it('stalls a slot naming a size, an order or a chase past what the crew holds', () => {
    const cases = [
      [{ unitSlots: 4, force: {} }, 'Naming a size instead of a party is a later rung'],
      [{ order: 'battles' as const }, 'You have not earned that order yet'],
      [{ optimiseFor: 'caps' as const }, 'Chasing one resource is a later rung'],
    ] as const;
    for (const [over, words] of cases) {
      const { repos, base } = stack();
      slot(repos, base, over);
      expect(settleAutomations(repos, NOW), words).toBe(0);
      expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(0);
      expect(repos.automations.get(base.id, 0)?.stalled).toBe(words);
    }
  });

  it('will not use a second slot before the seventh rung opens it', () => {
    const { repos, base } = stack();
    slot(repos, base);
    slot(repos, base, { slot: 1 });
    // One went out, not two: the second slot is beyond what this crew has earned.
    expect(settleAutomations(repos, NOW)).toBe(1);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(1);
  });

  it('uses both slots once it has, and never more than two', () => {
    const { repos, base } = stack([AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.secondSlot]);
    slot(repos, base);
    slot(repos, base, { slot: 1, officerId: 'off-2' });
    expect(settleAutomations(repos, NOW)).toBe(2);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(2);
    // Asked again with both out, it sends nobody.
    expect(settleAutomations(repos, new Date(NOW.getTime() + 60_000))).toBe(0);
  });

  /**
   * Through the world tick itself, not through the settler alone.
   *
   * Every other case in this file calls `settleAutomations` directly, and all of them stayed
   * green when the call was deleted out of `settleWorld`: they prove the runner works and prove
   * nothing at all about it ever being reached. This is the one that fails if the feature is
   * unplugged, which is the only failure a player would actually have.
   *
   * `bringCrewsHome` is what marks a pass as the world clock's rather than a page load's, and
   * only the clock passes it, so a reader opening a screen must not send anybody out.
   */
  it('is reached by the world tick, and only by the world tick', () => {
    const engine: SkirmishEngine = {
      resolve: () => skirmishOutcome({ winner: 'attacker', log: [] }),
    };

    const clock = stack();
    slot(clock.repos, clock.base);
    tickWorld(clock.repos, engine, NOW);
    expect(clock.repos.missions.listActiveByBaseId(clock.base.id)).toHaveLength(1);

    const reader = stack();
    slot(reader.repos, reader.base);
    // The same pass without the world clock's own step: a page load settles the world and sends
    // nobody.
    settleWorld(reader.repos, engine, NOW);
    expect(reader.repos.missions.listActiveByBaseId(reader.base.id)).toHaveLength(0);
  });

  /**
   * Admin mode reaches the automated launch (bug pass, 2026-09-22).
   *
   * The manual route passes `app.config.admin` into `launchMission` and every clock in admin mode
   * is flattened: a run becomes one minute with no travel. The world clock had no request to read
   * the flag off, so the runner launched at the real length while a manual launch on the same job
   * took a minute, and the Console could not be used to watch a standing order work at all. The
   * flag is handed to the clock once at startup now and threaded through. Both directions are
   * pinned, because a test that only checked the flattened side would pass if the flag were
   * simply hardcoded on.
   */
  it('runs a party on the flattened clock in admin mode, and on the real one otherwise', () => {
    const flat = stack();
    slot(flat.repos, flat.base);
    expect(settleAutomations(flat.repos, NOW, true)).toBe(1);
    const flattened = flat.repos.missions.listActiveByBaseId(flat.base.id)[0]?.mission;
    expect(flattened?.durationMinutes).toBe(1);
    expect(flattened?.travelMinutes).toBe(0);

    const real = stack();
    slot(real.repos, real.base);
    expect(settleAutomations(real.repos, NOW, false)).toBe(1);
    const unflattened = real.repos.missions.listActiveByBaseId(real.base.id)[0]?.mission;
    expect(unflattened?.durationMinutes).toBeGreaterThan(1);
  });

  /**
   * The whole lifecycle on the world clock, including being stopped and started mid-run.
   *
   * This is what the maintainer asked to see in a browser, done deterministically: out, home,
   * rest, out again; switched off while a party is out, that party still lands and nothing
   * follows it; switched back on, it resumes. Time is the only input, so every step is exact.
   */
  it('cycles out, home, rest, out; stops cleanly mid-run; and resumes', () => {
    const engine: SkirmishEngine = {
      resolve: () => skirmishOutcome({ winner: 'attacker', log: [] }),
    };
    const { repos, base } = stack();
    const at = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1_000);
    const out = (): number => repos.missions.listActiveByBaseId(base.id).length;
    const total = (): number => repos.missions.listByBaseId(base.id).length;
    slot(repos, base);

    // t=0: out. t=30: still out. t=61: home, and the slot is resting.
    tickWorld(repos, engine, at(0), true);
    expect(out()).toBe(1);
    tickWorld(repos, engine, at(30), true);
    expect(out()).toBe(1);
    expect(total()).toBe(1);
    tickWorld(repos, engine, at(61), true);
    expect(out()).toBe(0);
    expect(repos.automations.get(base.id, 0)?.missionId).toBeNull();
    expect(repos.automations.get(base.id, 0)?.restingSince).not.toBeNull();
    // The roster is whole again: the party walked back in.
    expect(repos.bases.findById(base.id)?.army.razors).toBe(40);

    // Resting the real fifteen minutes, admin mode or not: nothing at 14:59 past the landing,
    // the second party at 15:00. The landing is stamped by the tick that settled it (t=61), so
    // the gap ends at t=961.
    tickWorld(repos, engine, at(960), true);
    expect(total()).toBe(1);
    tickWorld(repos, engine, at(961), true);
    expect(total()).toBe(2);
    expect(out()).toBe(1);

    // Switched off with the second party out: it lands on time, and nothing follows it.
    const held = repos.automations.get(base.id, 0);
    if (!held) throw new Error('slot vanished');
    repos.automations.put({ ...held, enabled: false });
    tickWorld(repos, engine, at(990), true);
    expect(out()).toBe(1);
    tickWorld(repos, engine, at(1_021), true);
    expect(out()).toBe(0);
    tickWorld(repos, engine, at(3_000), true);
    expect(total()).toBe(2);

    // Switched back on long after the rest is over: the next tick sends the third party.
    repos.automations.put({ ...(repos.automations.get(base.id, 0) ?? held), enabled: true });
    tickWorld(repos, engine, at(3_001), true);
    expect(total()).toBe(3);
    expect(out()).toBe(1);
  });

  /**
   * Two slots, two clocks (maintainer, 2026-09-23).
   *
   * Both go the moment they are switched on. After that each slot rests from the moment *its own*
   * party walks in, for the full gap, and the other slot's comings and goings do not touch it.
   * Proved on the real clock first, with the gap as the player will live it, then on the world
   * tick in admin mode where the same staggering is watched second by second.
   */
  it("rests each slot from its own party's return, fifteen minutes on the real clock", () => {
    const { repos, base } = stack([AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.secondSlot]);
    const minute = (n: number): Date => new Date(NOW.getTime() + n * 60_000);
    // Slot one came home at t0, slot two four minutes later. Neither is out.
    slot(repos, base, { restingSince: minute(0).toISOString(), officerId: 'off-1' });
    slot(repos, base, { slot: 1, restingSince: minute(4).toISOString(), officerId: 'off-2' });
    // t+14:59: nothing. t+15: slot one only. t+18:59: still only one. t+19: slot two.
    expect(settleAutomations(repos, new Date(minute(15).getTime() - 1))).toBe(0);
    expect(settleAutomations(repos, minute(15))).toBe(1);
    expect(repos.automations.get(base.id, 0)?.missionId).not.toBeNull();
    expect(repos.automations.get(base.id, 1)?.missionId).toBeNull();
    expect(settleAutomations(repos, new Date(minute(19).getTime() - 1))).toBe(0);
    expect(settleAutomations(repos, minute(19))).toBe(1);
    expect(repos.automations.get(base.id, 1)?.missionId).not.toBeNull();
  });

  it('drops the gap to five minutes with the sixth rung, per slot', () => {
    const { repos, base } = stack([
      AUTOMATION_RUNGS.open,
      AUTOMATION_RUNGS.fastCooldown,
      AUTOMATION_RUNGS.secondSlot,
    ]);
    const minute = (n: number): Date => new Date(NOW.getTime() + n * 60_000);
    slot(repos, base, { restingSince: minute(0).toISOString(), officerId: 'off-1' });
    slot(repos, base, { slot: 1, restingSince: minute(2).toISOString(), officerId: 'off-2' });
    expect(settleAutomations(repos, new Date(minute(5).getTime() - 1))).toBe(0);
    expect(settleAutomations(repos, minute(5))).toBe(1);
    expect(settleAutomations(repos, new Date(minute(7).getTime() - 1))).toBe(0);
    expect(settleAutomations(repos, minute(7))).toBe(1);
  });

  it('both go at once when switched on, then each keeps its own clock on the world tick', () => {
    const engine: SkirmishEngine = {
      resolve: () => skirmishOutcome({ winner: 'attacker', log: [] }),
    };
    const { repos, base } = stack([AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.secondSlot]);
    const at = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1_000);
    const outOf = (which: number): boolean =>
      repos.automations.get(base.id, which)?.missionId !== null;
    slot(repos, base, { officerId: 'off-1' });
    slot(repos, base, { slot: 1, officerId: 'off-2' });

    // t=0: both out at once, nobody waits for anybody.
    tickWorld(repos, engine, at(0), true);
    expect(outOf(0)).toBe(true);
    expect(outOf(1)).toBe(true);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(2);

    // Slot two is switched off and on again at t=10 with its party still out: nothing changes,
    // and in particular nothing is sent twice.
    const second = repos.automations.get(base.id, 1);
    if (!second) throw new Error('slot vanished');
    repos.automations.put({ ...second, enabled: false });
    tickWorld(repos, engine, at(10), true);
    repos.automations.put({ ...second, enabled: true });
    tickWorld(repos, engine, at(11), true);
    expect(repos.missions.listByBaseId(base.id)).toHaveLength(2);

    // Both land at t=60 (one-minute admin runs) and rest the real fifteen minutes, admin mode or
    // not; a slot switched off during the rest does not shorten the other's.
    tickWorld(repos, engine, at(61), true);
    expect(outOf(0)).toBe(false);
    expect(outOf(1)).toBe(false);
    tickWorld(repos, engine, at(960), true);
    expect(repos.missions.listByBaseId(base.id)).toHaveLength(2);
    tickWorld(repos, engine, at(961), true);
    expect(outOf(0)).toBe(true);
    expect(outOf(1)).toBe(true);
    expect(repos.missions.listByBaseId(base.id)).toHaveLength(4);
    // Never more parties out than slots, at any point.
    expect(repos.missions.listActiveByBaseId(base.id).length).toBeLessThanOrEqual(2);
  });

  /**
   * A recovered officer is free; a hurt one is not (bug pass, 2026-09-22).
   *
   * `injuredUntil` is stamped when an officer is laid up and never cleared when it passes, so the
   * first version of the runner, which tested the field for truthiness, refused anybody who had
   * ever been hurt for the rest of the game. Both directions, because a check that only proved
   * the recovered case would pass if injury were ignored altogether.
   */
  it('sends an officer whose injury has passed, and not one who is still laid up', () => {
    // The Field Commander rather than the Right Hand: a Right Hand laid up stalls every order for
    // a reason of its own (see "the Right Hand's chair" below).
    const healed = stack();
    const yesterday = new Date(NOW.getTime() - 24 * 3_600_000).toISOString();
    healed.repos.bases.updateCommanders(
      healed.base.id,
      healed.base.commanders.map((one) =>
        one.id === 'off-2' ? { ...one, injuredUntil: yesterday } : one,
      ),
    );
    slot(healed.repos, healed.base, { officerId: 'off-2' });
    expect(settleAutomations(healed.repos, NOW)).toBe(1);

    const hurt = stack();
    const tomorrow = new Date(NOW.getTime() + 24 * 3_600_000).toISOString();
    hurt.repos.bases.updateCommanders(
      hurt.base.id,
      hurt.base.commanders.map((one) =>
        one.id === 'off-2' ? { ...one, injuredUntil: tomorrow } : one,
      ),
    );
    slot(hurt.repos, hurt.base, { officerId: 'off-2' });
    expect(settleAutomations(hurt.repos, NOW)).toBe(0);
    expect(hurt.repos.automations.get(hurt.base.id, 0)?.stalled).toMatch(/is still laid up$/);
  });

  /**
   * The board the Right Hand reads is the board the player reads, and no other.
   *
   * Found in review: the runner walked `areaStatesFor`, which lists districts only, so a crew
   * with no district open had no board at all even though the misc board is always open to it.
   */
  it('reads the misc board when the crew holds nothing anywhere', () => {
    const { repos, base } = stack([AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.optimise], []);
    expect(openAreas(repos, base)).toEqual([MISC_AREA_ID]);
    slot(repos, base, { optimiseFor: 'scrap' });
    expect(settleAutomations(repos, NOW)).toBe(1);
    const sent = repos.missions.listActiveByBaseId(base.id)[0]?.mission;
    expect(sent?.areaId).toBe(MISC_AREA_ID);
  });

  /**
   * A district the crew has lost its last place in drops off the Right Hand's boards on the next
   * tick, the way it drops off the screen (maintainer, 2026-09-29), and the stall says what to do.
   */
  it('stalls with the foothold rule when misc is taken and no district is held', () => {
    const district = CITY_DISTRICTS.find((one) => one.kind === 'contested')!;
    const { repos, base } = stack(
      [AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.secondSlot],
      [district.id],
    );
    expect(openAreas(repos, base)).toEqual([MISC_AREA_ID, district.id]);
    // The place is lost: the district's board goes with it.
    const control = repos.city.control(district.locations[0]!.id)!;
    repos.city.put({ ...control, holder: { kind: 'looters' } });
    expect(openAreas(repos, base)).toEqual([MISC_AREA_ID]);

    slot(repos, base);
    slot(repos, base, { slot: 1 });
    expect(settleAutomations(repos, NOW)).toBe(1);
    expect(repos.missions.listActiveByBaseId(base.id)[0]?.mission.areaId).toBe(MISC_AREA_ID);
    expect(repos.automations.get(base.id, 1)?.stalled).toMatch(
      /^No open board has (work|a fight)\. A district hires only crews that hold a place in it$/,
    );
  });

  /**
   * The feat that measures this mechanic is bumped when the party comes home, and only then (bug
   * pass, 2026-10-02): it was bumped at the send, so a party recalled the moment it left counted.
   */
  it('counts a party sent by standing order towards the orders ladder once it is home', () => {
    const { repos, base } = stack();
    slot(repos, base);
    expect(settleAutomations(repos, NOW)).toBe(1);
    expect(repos.feats.tallies(base.id).automated_parties ?? 0).toBe(0);

    const run = repos.missions.listActiveByBaseId(base.id)[0]!.mission;
    const home = new Date(NOW.getTime() + 60_000);
    repos.missions.markResolved(run.id, {
      outcome: 'success',
      rewards: {},
      spoils: {},
      resolvedAt: home.toISOString(),
    });
    settleAutomations(repos, home);
    expect(repos.feats.tallies(base.id).automated_parties).toBe(1);
  });

  it('does not count a party the crew turned round', () => {
    const { repos, base } = stack();
    slot(repos, base);
    expect(settleAutomations(repos, NOW)).toBe(1);

    const run = repos.missions.listActiveByBaseId(base.id)[0]!.mission;
    const back = new Date(NOW.getTime() + 60_000);
    repos.missions.markRecalled(run.id, NOW.toISOString());
    repos.missions.markResolved(run.id, {
      outcome: 'failure',
      rewards: {},
      spoils: {},
      resolvedAt: back.toISOString(),
    });
    settleAutomations(repos, back);
    expect(repos.feats.tallies(base.id).automated_parties ?? 0).toBe(0);
  });

  it('stops when the rung is taken away mid-run; the party out still lands', () => {
    const engine: SkirmishEngine = {
      resolve: () => skirmishOutcome({ winner: 'attacker', log: [] }),
    };
    const { repos, base } = stack();
    const at = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1_000);
    slot(repos, base);
    tickWorld(repos, engine, at(0), true);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(1);
    // Research cancelled, or the Console took it back: the crew no longer holds the rung.
    repos.bases.updateResearch(base.id, { ...base.research, technologies: [] });
    tickWorld(repos, engine, at(61), true);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(0);
    tickWorld(repos, engine, at(70), true);
    expect(repos.missions.listByBaseId(base.id)).toHaveLength(1);
  });

  it('stalls a second slot that names an officer the first slot has already sent', () => {
    const { repos, base } = stack([AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.secondSlot]);
    slot(repos, base);
    slot(repos, base, { slot: 1, officerId: 'off-1' });
    expect(settleAutomations(repos, NOW)).toBe(1);
    expect(repos.automations.get(base.id, 1)?.stalled).toMatch(/is out leading a run$/);
  });

  /**
   * The eighth rung's rule, exactly as the maintainer stated it: best return per minute in the
   * chosen resource, and nothing else weighed. The expected pick is computed here off the same
   * catalogue the runner reads, so a retune of the misc board moves both sides together.
   */
  /**
   * Two modes (maintainer ruling P5-A, 2026-10-02): any job it can fill at random until Field
   * Promotions, the best job overall from that rung. Told apart by the draw: the same board read
   * with the dice at either end picks two different jobs at random and the same one at its best.
   */
  describe('which job it takes with nothing to chase', () => {
    const pickWith = (rungs: readonly string[], dice: number): string | undefined => {
      const { repos, base } = stack(rungs);
      slot(repos, base, { unitSlots: 4, officerId: null, force: {}, optimiseFor: null });
      const roll = vi.spyOn(Math, 'random').mockReturnValue(dice);
      try {
        expect(settleAutomations(repos, NOW)).toBe(1);
      } finally {
        roll.mockRestore();
      }
      return repos.missions.listActiveByBaseId(base.id)[0]?.mission.templateId;
    };

    it('takes any job it can fill, at random, before Field Promotions', () => {
      const rungs = [AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.bestFit];
      expect(pickWith(rungs, 0)).not.toBe(pickWith(rungs, 0.9999));
    });

    it('takes the same best job whatever the dice say once it is researched', () => {
      const rungs = [AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.bestFit, AUTOMATION_RUNGS.optimise];
      expect(pickWith(rungs, 0)).toBe(pickWith(rungs, 0.9999));
    });
  });

  it('chases one resource by the best rate per minute, ignoring everything else', () => {
    const { repos, base } = stack([
      AUTOMATION_RUNGS.open,
      AUTOMATION_RUNGS.bestFit,
      AUTOMATION_RUNGS.optimise,
    ]);
    // Every board this crew can read (the fixture holds a place in every district), so the
    // expectation is computed over the same set the runner reads.
    const offersOn = (at: Date) =>
      openAreas(repos, base).flatMap((areaId) =>
        missionOffers(areaId, missionBoardKey(areaId, at), base.level).filter(
          (one) => one.template.kind !== 'battle',
        ),
      );
    type Offer = ReturnType<typeof offersOn>[number];
    const minutesOf = (job: Offer): number => templateTimings(job.template, job.grade).totalMinutes;
    // What comes home, as the settle banks it: the card's weights through the reward curve at the
    // grade it was dealt, cut to what the four Razors this slot fills can lift.
    const scrap = (job: Offer): number =>
      carriedHome(
        missionRewards(job.template, 'success', minutesOf(job), job.grade),
        missionCarry({ razors: 4 }),
        RESOURCE_KG,
      ).scrap ?? 0;
    const rate = (job: Offer): number => scrap(job) / minutesOf(job);
    /*
     * The first hour on which the biggest pile of scrap and the best scrap rate are different
     * jobs, which is the only case that tells the rule apart from "take the biggest pile".
     *
     * Searched for rather than pinned. The pinned day has gone red twice: once when the districts
     * took their tags' names and the board dealt a different hand, and again when this rung
     * started ranking on what comes home rather than on the card's weights (2026-09-25), which
     * made that day's biggest pile its best rate as well.
     */
    let day: Date | null = null;
    let best: Offer | null = null;
    for (let hour = 0; hour < 24 * 30 && day === null; hour += 1) {
      const at = new Date(NOW.getTime() + hour * 3_600_000);
      const offers = offersOn(at);
      const byRate = offers.reduce((top, one) => (rate(one) > rate(top) ? one : top));
      const byPile = offers.reduce((top, one) => (scrap(one) > scrap(top) ? one : top));
      if (
        byRate.template.id !== byPile.template.id &&
        scrap(byPile) > scrap(byRate) &&
        rate(byRate) > rate(byPile)
      ) {
        day = at;
        best = byRate;
      }
    }
    expect(day, 'no hour in a month where the biggest pile is not the best rate').not.toBeNull();
    slot(repos, base, { unitSlots: 4, officerId: null, force: {}, optimiseFor: 'scrap' });
    expect(settleAutomations(repos, day!)).toBe(1);
    expect(repos.missions.listActiveByBaseId(base.id)[0]?.mission.templateId).toBe(
      best!.template.id,
    );
  });

  it('does not advance a mixed order on a stall, only on a send', () => {
    const { repos, base } = stack([
      AUTOMATION_RUNGS.open,
      AUTOMATION_RUNGS.battles,
      AUTOMATION_RUNGS.mixedOrders,
    ]);
    slot(repos, base, { order: 'mixed', force: { razors: 900 } });
    expect(settleAutomations(repos, NOW)).toBe(0);
    expect(settleAutomations(repos, new Date(NOW.getTime() + 1_000))).toBe(0);
    expect(repos.automations.get(base.id, 0)?.step).toBe(0);
    const held = repos.automations.get(base.id, 0);
    if (!held) throw new Error('slot vanished');
    repos.automations.put({ ...held, force: { razors: 4 } });
    expect(settleAutomations(repos, new Date(NOW.getTime() + 2_000))).toBe(1);
    expect(repos.automations.get(base.id, 0)?.step).toBe(1);
  });

  it('hands the mission board to the Right Hand the moment any slot is on', () => {
    const { repos, base } = stack();
    expect(boardIsAutomated(repos.automations.forBase(base.id))).toBe(false);
    slot(repos, base);
    expect(boardIsAutomated(repos.automations.forBase(base.id))).toBe(true);
  });
});

/**
 * The bug pass of 2026-09-25: the job, the party and the leader, each chosen on what actually
 * happens rather than on a figure standing in for it.
 */
describe('choosing on what actually happens', () => {
  const plainOffers = (areas: readonly string[], at: Date, level: number) =>
    areas.flatMap((areaId) =>
      missionOffers(areaId, missionBoardKey(areaId, at), level).filter(
        (one) => one.template.kind !== 'battle',
      ),
    );

  /*
   * What the settle banks is the card's weights through the reward curve, cut to what the party
   * lifts. Ranked on the weights, a small party chasing scrap took a job it could carry a fraction
   * of. The day is searched for rather than pinned: it is the first hour on which the two rules
   * name different jobs for a two-Razor party, so a retune of the board moves the day, not the
   * point of the test.
   */
  it('chases what comes home per minute, not what the card lists', () => {
    const { repos, base } = stack([
      AUTOMATION_RUNGS.open,
      AUTOMATION_RUNGS.bestFit,
      AUTOMATION_RUNGS.optimise,
    ]);
    const areas = openAreas(repos, base);
    const carry = missionCarry({ razors: 2 });
    type Offer = ReturnType<typeof plainOffers>[number];
    const minutesOf = (job: Offer): number => templateTimings(job.template, job.grade).totalMinutes;
    const home = (job: Offer) =>
      (carriedHome(
        missionRewards(job.template, 'success', minutesOf(job), job.grade),
        carry,
        RESOURCE_KG,
      ).scrap ?? 0) / minutesOf(job);
    const listed = (job: Offer) => (job.template.spoils.scrap ?? 0) / minutesOf(job);

    let day: Date | null = null;
    let expected = '';
    for (let hour = 0; hour < 24 * 30 && day === null; hour += 1) {
      const at = new Date(NOW.getTime() + hour * 3_600_000);
      const offers = plainOffers(areas, at, base.level);
      const byHome = offers.reduce((top, one) => (home(one) > home(top) ? one : top));
      const byCard = offers.reduce((top, one) => (listed(one) > listed(top) ? one : top));
      if (byHome.template.id !== byCard.template.id && home(byHome) > home(byCard)) {
        day = at;
        expected = byHome.template.id;
      }
    }
    expect(day, 'no hour in a month where carrying changes the pick').not.toBeNull();

    slot(repos, base, { unitSlots: 2, officerId: null, force: {}, optimiseFor: 'scrap' });
    expect(settleAutomations(repos, day!)).toBe(1);
    expect(repos.missions.listActiveByBaseId(base.id)[0]?.mission.templateId).toBe(expected);
  });

  /*
   * Bug pass, 2026-10-02: the rate was the bare template's, so the district's pay premium (9% a
   * point of difficulty) never reached the pick, and the same job on a difficulty-10 board scored
   * the same as on Misc. The day is the first hour on which the premium changes which job wins.
   */
  it('counts the district premium the run is paid, as the card does', () => {
    const { repos, base } = stack([
      AUTOMATION_RUNGS.open,
      AUTOMATION_RUNGS.bestFit,
      AUTOMATION_RUNGS.optimise,
    ]);
    const areas = openAreas(repos, base);
    const carry = missionCarry({ razors: 4 });
    const offersOn = (at: Date) =>
      areas.flatMap((areaId) =>
        missionOffers(areaId, missionBoardKey(areaId, at), base.level)
          .filter((one) => one.template.kind !== 'battle')
          .map((one) => ({ ...one, areaId })),
      );
    type Offer = ReturnType<typeof offersOn>[number];
    const minutesOf = (job: Offer): number => templateTimings(job.template, job.grade).totalMinutes;
    const scrapPer = (job: Offer, premium: number): number =>
      (carriedHome(
        scaledSpoils(missionRewards(job.template, 'success', minutesOf(job), job.grade), premium),
        carry,
        RESOURCE_KG,
      ).scrap ?? 0) / minutesOf(job);
    const bare = (job: Offer) => scrapPer(job, 0);
    const paid = (job: Offer) => scrapPer(job, areaPayPercent(job.areaId));

    let day: Date | null = null;
    let expected: Offer | null = null;
    for (let hour = 0; hour < 24 * 30 && day === null; hour += 1) {
      const at = new Date(NOW.getTime() + hour * 3_600_000);
      const offers = offersOn(at);
      const byPaid = offers.reduce((top, one) => (paid(one) > paid(top) ? one : top));
      const byBare = offers.reduce((top, one) => (bare(one) > bare(top) ? one : top));
      if (
        (byPaid.areaId !== byBare.areaId || byPaid.template.id !== byBare.template.id) &&
        paid(byPaid) > paid(byBare)
      ) {
        day = at;
        expected = byPaid;
      }
    }
    expect(day, 'no hour in a month where the premium changes the pick').not.toBeNull();

    slot(repos, base, { unitSlots: 4, officerId: null, force: {}, optimiseFor: 'scrap' });
    expect(settleAutomations(repos, day!)).toBe(1);
    const sent = repos.missions.listActiveByBaseId(base.id)[0]?.mission;
    expect([sent?.areaId, sent?.templateId]).toEqual([expected!.areaId, expected!.template.id]);
  });

  /** Everybody but the Right Hand, who has to stay fit or every order stalls on the chair. */
  const laidUp = (repos: Repositories, base: Base) =>
    repos.bases.updateCommanders(
      base.id,
      base.commanders.map((one) =>
        one.role === 'right_hand'
          ? one
          : { ...one, injuredUntil: new Date(NOW.getTime() + 86_400_000).toISOString() },
      ),
    );

  /**
   * The Right Hand at work and out leading slot 0's run, so slot 1 has nobody free to send.
   *
   * Since the orders need the chair (2026-09-29), this is the one way left to reach "nobody free to
   * lead" with the orders still running: the chair is filled and busy.
   */
  const rightHandOut = (repos: Repositories, base: Base): Date => {
    slot(repos, base, { officerId: 'off-1' });
    expect(settleAutomations(repos, NOW)).toBe(1);
    return new Date(NOW.getTime() + 1_000);
  };

  /*
   * Every run has a leader (maintainer, 2026-09-28), and the Overseer is the player rather than a
   * standing order's to send. The two rungs that used to let a crew out unled keep their ids and
   * open nothing, so a slot with every officer laid up stalls with them researched as without.
   */
  it('stalls rather than sending nobody at the head of a run, whatever the research', () => {
    const { repos, base } = stack([
      AUTOMATION_RUNGS.open,
      AUTOMATION_RUNGS.secondSlot,
      'tech_unled_runs',
      'tech_unled_runs_free',
    ]);
    const later = rightHandOut(repos, base);
    laidUp(repos, repos.bases.findById(base.id)!);
    slot(repos, base, { slot: 1, officerId: null });
    expect(settleAutomations(repos, later)).toBe(0);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(1);
    expect(repos.automations.get(base.id, 1)?.stalled).toBe('No officer is free to lead');
  });

  it('stalls for want of an officer with nothing researched', () => {
    const { repos, base } = stack([AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.secondSlot]);
    const later = rightHandOut(repos, base);
    laidUp(repos, repos.bases.findById(base.id)!);
    slot(repos, base, { slot: 1, officerId: null });
    expect(settleAutomations(repos, later)).toBe(0);
    expect(repos.automations.get(base.id, 1)?.stalled).toBe('No officer is free to lead');
  });

  it('never sends a named officer’s run without them, whatever the research', () => {
    const { repos, base } = stack([
      AUTOMATION_RUNGS.open,
      'tech_unled_runs',
      'tech_unled_runs_free',
    ]);
    laidUp(repos, base);
    slot(repos, base, { officerId: 'off-2' });
    expect(settleAutomations(repos, NOW)).toBe(0);
    expect(repos.automations.get(base.id, 0)?.stalled).toMatch(/is still laid up$/);
  });

  /*
   * A leader who fits nothing still leads: going unled is not a choice any more, so an officer
   * graded F- for the job is sent rather than the slot stalling on a bad fit.
   */
  it('sends an officer who fits the job badly rather than nobody', () => {
    const { repos, base } = stack();
    repos.bases.updateCommanders(
      base.id,
      base.commanders.map((one) => ({ ...one, attributes: makeAttributes(0) })),
    );
    slot(repos, base, { officerId: null });
    expect(settleAutomations(repos, NOW)).toBe(1);
    expect(repos.missions.listActiveByBaseId(base.id)[0]?.mission.officerId).not.toBeNull();
  });

  /*
   * And a slot choosing for itself takes the best fit on the books, the board's own "best
   * leader". The better one is listed second, so a runner that took the first free officer
   * would send the wrong one.
   */
  it('takes the officer who fits the job best', () => {
    const { repos, base } = stack();
    repos.bases.updateCommanders(base.id, [
      { ...base.commanders[0]!, attributes: makeAttributes(0) },
      { ...base.commanders[1]!, attributes: makeAttributes(MAX_ATTRIBUTE) },
    ]);
    slot(repos, base, { officerId: null });
    expect(settleAutomations(repos, NOW)).toBe(1);
    expect(repos.missions.listActiveByBaseId(base.id)[0]?.mission.officerId).toBe('off-2');
  });

  /*
   * The bench leads nothing (maintainer, 2026-09-28). The same two officers as the test above, with
   * the better one taken out of their chair: the runner has to send the worse one, and the test
   * above is the positive control that it would otherwise have sent off-2.
   */
  it('never sends an officer on the bench, however well they fit', () => {
    const { repos, base } = stack();
    repos.bases.updateCommanders(base.id, [
      { ...base.commanders[0]!, attributes: makeAttributes(0) },
      { ...base.commanders[1]!, role: null, attributes: makeAttributes(MAX_ATTRIBUTE) },
    ]);
    slot(repos, base, { officerId: null });
    expect(settleAutomations(repos, NOW)).toBe(1);
    expect(repos.missions.listActiveByBaseId(base.id)[0]?.mission.officerId).toBe('off-1');
  });

  it('stalls with everybody else on the bench', () => {
    const { repos, base } = stack([AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.secondSlot]);
    const later = rightHandOut(repos, base);
    const sent = repos.bases.findById(base.id)!;
    repos.bases.updateCommanders(
      base.id,
      sent.commanders.map((one) => (one.role === 'right_hand' ? one : { ...one, role: null })),
    );
    slot(repos, base, { slot: 1, officerId: null });
    expect(settleAutomations(repos, later)).toBe(0);
    expect(repos.missions.listActiveByBaseId(base.id)).toHaveLength(1);
    expect(repos.automations.get(base.id, 1)?.stalled).toBe('No officer is free to lead');
  });

  it('stalls a slot that names somebody on the bench rather than sending them', () => {
    const { repos, base } = stack();
    repos.bases.updateCommanders(base.id, [
      base.commanders[0]!,
      { ...base.commanders[1]!, role: null },
    ]);
    slot(repos, base, { officerId: 'off-2' });
    expect(settleAutomations(repos, NOW)).toBe(0);
    // Named, and told what to fix: the order stalls every tick until somebody gives them a chair.
    expect(repos.automations.get(base.id, 0)?.stalled).toBe(
      `${base.commanders[1]!.name} is on the bench. Give them a chair first`,
    );
  });

  /*
   * A fight's party is ranked by the engine against the job's own grade. Measured independently
   * here on seeds the runner never uses: whatever it sends must win at least as often as the
   * catalogue's order (offense plus a fifth of vitality per slot), which fielded twelve Sparks
   * and lost a Fight II every time where two Juggernauts won most of them.
   */
  it('sends a fight party that wins at least as often as the catalogue order would', () => {
    const { repos, base } = stack([
      AUTOMATION_RUNGS.open,
      AUTOMATION_RUNGS.bestFit,
      AUTOMATION_RUNGS.battles,
    ]);
    const yard = { sparks: 30, razors: 30, juggernauts: 4, sleepers: 10, cyber_dogs: 10 };
    repos.bases.updateArmy(base.id, yard, []);
    // A name big enough to field all of it, so the ranking and not the notoriety gate decides.
    repos.bases.updateEconomy(base.id, { ...base.economy, notoriety: 10 });
    slot(repos, base, { order: 'battles', unitSlots: 12, officerId: null, force: {} });
    expect(settleAutomations(repos, NOW)).toBe(1);
    const sent = repos.missions.listActiveByBaseId(base.id)[0]!;
    const grade = sent.mission.grade ?? 'F-';

    const winRate = (party: Record<string, number>) => {
      let won = 0;
      for (let seed = 0; seed < 40; seed += 1) {
        const out = new TacticalSkirmishEngine().resolve({
          seed: `check-${seed}`,
          attackerName: 'A',
          defenderName: 'D',
          locationName: 'job',
          attacking: party,
          defending: enemyForce(grade, `check-${seed}`),
        });
        if (out.winner === 'attacker') won += 1;
      }
      return won / 40;
    };
    const catalogue = bestFitParty(yard, 12, 'battle')!;
    const ours = winRate(sent.mission.force);
    const theirs = winRate(catalogue);
    // Strictly better, unless the catalogue's party already all but always wins: a test that
    // allowed a tie would pass with the ranking taken out, since that sends the catalogue party.
    if (theirs < 0.95) expect(ours).toBeGreaterThan(theirs);
    else expect(ours).toBeGreaterThanOrEqual(0.95);
  });

  /*
   * A stall was re-asked every second of the world clock. It waits `STALL_RETRY_MS` now, unless
   * the order is edited, which is answered on the next tick.
   */
  it('asks a stalled slot again after the wait, or at once when its order changes', () => {
    const { repos, base } = stack();
    const stalled = slot(repos, base, { force: { razors: 400 } });
    expect(settleAutomations(repos, NOW)).toBe(0);

    // Fixed behind its back: still waiting out the retry, so nothing goes yet...
    repos.bases.updateArmy(base.id, { razors: 400 }, []);
    const soon = new Date(NOW.getTime() + STALL_RETRY_MS / 2);
    expect(settleAutomations(repos, soon)).toBe(0);
    // ...and it goes once the wait is over.
    expect(settleAutomations(repos, new Date(NOW.getTime() + STALL_RETRY_MS))).toBe(1);

    // An edit is answered at once.
    const other = stack();
    const edited = slot(other.repos, other.base, { force: { razors: 400 } });
    expect(settleAutomations(other.repos, NOW)).toBe(0);
    other.repos.automations.put({ ...edited, force: { razors: 4 } });
    expect(settleAutomations(other.repos, new Date(NOW.getTime() + 1_000))).toBe(1);
    expect(stalled.id).not.toBe(edited.id);
  });
});

/** Audit, 2026-09-28: a standing order against the crew as it stands, on the odds a hand gets. */
describe('the crew a standing order sends', () => {
  it('fills the party from units that came off the bench since the owner last looked', () => {
    const { repos, base } = stack();
    // Nobody home on the row, and eight Razors whose batch finished an hour before the tick.
    repos.bases.updateArmy(base.id, {}, [
      {
        id: 'batch-1',
        unitId: 'razors',
        count: 8,
        delivered: 0,
        startedAt: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(),
        durationSeconds: 3_600,
        paid: {},
      },
    ]);
    slot(repos, base, { force: { razors: 4 } });
    expect(settleAutomations(repos, NOW)).toBe(1);
    const after = repos.bases.findById(base.id)!;
    expect(after.army.razors).toBe(4);
    expect(after.musterQueue).toEqual([]);
  });

  it('freezes the practice-fight odds on a fight, the figure the hand-sent launch freezes', () => {
    const { repos, base } = stack([AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.battles]);
    // A small party, so the practice fights and the leader's attribute grade disagree and the
    // test can tell which of the two was frozen.
    slot(repos, base, { order: 'battles', force: { razors: 3 } });
    expect(settleAutomations(repos, NOW)).toBe(1);
    const sent = repos.missions.listActiveByBaseId(base.id)[0]!;
    const template = findMissionTemplate(sent.mission.templateId)!;
    expect(template.kind).toBe('battle');
    const deputy = base.commanders[0]!;
    const expected = fightChanceFor({
      base: repos.bases.findById(base.id)!,
      template,
      grade: sent.mission.grade!,
      force: sent.mission.force,
      vehicles: {},
      leader: { id: deputy.id, name: deputy.name, kind: 'officer', attributes: deputy.attributes },
      effects: standingEffectsFor(repos, base, NOW),
    });
    const graded = missionOdds({
      grade: sent.mission.grade!,
      leader: deputy.attributes,
      profile: composeProfile(leaningsFor(template)),
    }).chance;
    expect(expected).not.toBe(graded);
    expect(sent.successChance).toBe(expected);
  });

  /**
   * On the lifted sheet, as the hand-sent launch is (maintainer, 2026-09-29). The Field Commander
   * is lifted by the Right Hand beside them, so their card and the sheet they lead on differ.
   */
  it('prices a standing order on the leader’s lifted sheet', () => {
    const { repos, base } = stack();
    // A middling card, so the odds sit between the floor and the ceiling and a lift shows.
    const officer = { ...base.commanders[1]!, attributes: makeAttributes(20) };
    repos.bases.updateCommanders(base.id, [base.commanders[0]!, officer]);
    slot(repos, base, { officerId: officer.id });
    expect(settleAutomations(repos, NOW)).toBe(1);
    const sent = repos.missions.listActiveByBaseId(base.id)[0]!;
    const template = findMissionTemplate(sent.mission.templateId)!;
    expect(template.kind).toBe('standard');
    const oddsOn = (sheet: Commander['attributes']) =>
      missionOdds({
        grade: sent.mission.grade!,
        leader: sheet,
        profile: composeProfile(leaningsFor(template)),
      }).chance;
    const room = officerLiftRoom(repos, repos.bases.findById(base.id)!, NOW);
    const lifted = liftedOfficerSheet(officer, room).attributes;
    expect(sent.successChance).toBe(oddsOn(lifted));
    expect(sent.successChance).not.toBe(oddsOn(officer.attributes));
  });

  /**
   * The same door as the hand-sent launch (bug pass, 2026-09-29): a crew that puts its porters in
   * the line (`carriers_fight`) may name a party of them for a fight, and one that does not is
   * told that porters do not go in alone.
   */
  it('sends a named party of porters to a fight only for a crew that fields them', () => {
    const rungs = [AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.battles];
    const strict = stack(rungs);
    strict.repos.bases.updateArmy(strict.base.id, { haulers: 12 }, []);
    slot(strict.repos, strict.base, { order: 'battles', force: { haulers: 12 } });
    expect(settleAutomations(strict.repos, NOW)).toBe(0);
    expect(strict.repos.missions.listActiveByBaseId(strict.base.id)).toHaveLength(0);

    const fielded = stack([...rungs, 'tech_everybody_fights']);
    fielded.repos.bases.updateArmy(fielded.base.id, { haulers: 12 }, []);
    slot(fielded.repos, fielded.base, { order: 'battles', force: { haulers: 12 } });
    expect(settleAutomations(fielded.repos, NOW)).toBe(1);
    expect(fielded.repos.missions.listActiveByBaseId(fielded.base.id)[0]?.mission.force).toEqual({
      haulers: 12,
    });
  });
});
