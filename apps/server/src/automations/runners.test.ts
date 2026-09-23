import {
  AUTOMATION_COOLDOWN_MS,
  AUTOMATION_RUNGS,
  CITY_DISTRICTS,
  automationPowers,
  MISC_AREA_ID,
  missionBoardKey,
  missionOffers,
  templateTimings,
  createCommander,
  makeAttributes,
  boardIsAutomated,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Automation,
  type Base,
} from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { settleAutomations } from './runners.js';
import { tickWorld } from '../live/clock.js';
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
  scouted: readonly string[] = CITY_DISTRICTS.map((one) => one.id),
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
    trainingQueue: [],
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
  // Eyes on the whole map, so a stall is never simply "you have not looked there".
  for (const districtId of scouted) repos.city.markScouted(base.id, districtId, now);
  return { repos, base };
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

  it('stalls when the officer it was told to send is not there', () => {
    const { repos, base } = stack();
    slot(repos, base, { officerId: 'nobody' });
    expect(settleAutomations(repos, NOW)).toBe(0);
    expect(repos.automations.get(base.id, 0)?.stalled).toMatch(/not free/i);
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
    const healed = stack();
    const yesterday = new Date(NOW.getTime() - 24 * 3_600_000).toISOString();
    healed.repos.bases.updateCommanders(
      healed.base.id,
      healed.base.commanders.map((one) =>
        one.id === 'off-1' ? { ...one, injuredUntil: yesterday } : one,
      ),
    );
    slot(healed.repos, healed.base);
    expect(settleAutomations(healed.repos, NOW)).toBe(1);

    const hurt = stack();
    const tomorrow = new Date(NOW.getTime() + 24 * 3_600_000).toISOString();
    hurt.repos.bases.updateCommanders(
      hurt.base.id,
      hurt.base.commanders.map((one) =>
        one.id === 'off-1' ? { ...one, injuredUntil: tomorrow } : one,
      ),
    );
    slot(hurt.repos, hurt.base);
    expect(settleAutomations(hurt.repos, NOW)).toBe(0);
    expect(hurt.repos.automations.get(hurt.base.id, 0)?.stalled).toMatch(/not free/i);
  });

  /**
   * The board the Right Hand reads is the board the player reads, and no other.
   *
   * Found in review: the runner walked `areaStatesFor`, which lists districts only, so a crew
   * with nothing scouted had no board at all even though the misc board is always open to it,
   * and a residential district (which the screen never draws) was fair game once scouted.
   */
  it('reads the misc board with nothing scouted, and never a residential district', () => {
    // Eyes on the residential districts only, which the screen never offers work in.
    const residential = CITY_DISTRICTS.filter((one) => one.kind === 'residential');
    expect(residential.length).toBeGreaterThan(0);
    const { repos, base } = stack(
      [AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.optimise],
      residential.map((one) => one.id),
    );
    // Chasing scrap makes the pick deterministic, and on this day a residential board pays it
    // twenty times better than the misc board does: the only way misc wins is by being the
    // only board there is.
    slot(repos, base, { optimiseFor: 'scrap' });
    expect(settleAutomations(repos, NOW)).toBe(1);
    const sent = repos.missions.listActiveByBaseId(base.id)[0]?.mission;
    expect(sent?.areaId).toBe(MISC_AREA_ID);
  });

  /** The feat that measures this mechanic is bumped where the party leaves, and only there. */
  it('counts a party sent by standing order towards the orders ladder', () => {
    const { repos, base } = stack();
    slot(repos, base);
    expect(repos.feats.tallies(base.id).automated_parties ?? 0).toBe(0);
    expect(settleAutomations(repos, NOW)).toBe(1);
    expect(repos.feats.tallies(base.id).automated_parties).toBe(1);
    // A stall sends nobody and counts nothing.
    expect(settleAutomations(repos, new Date(NOW.getTime() + 1_000))).toBe(0);
    expect(repos.feats.tallies(base.id).automated_parties).toBe(1);
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
    expect(repos.automations.get(base.id, 1)?.stalled).toMatch(/not free/i);
  });

  /**
   * The eighth rung's rule, exactly as the maintainer stated it: best return per minute in the
   * chosen resource, and nothing else weighed. The expected pick is computed here off the same
   * catalogue the runner reads, so a retune of the misc board moves both sides together.
   */
  it('chases one resource by the best rate per minute, ignoring everything else', () => {
    const { repos, base } = stack([
      AUTOMATION_RUNGS.open,
      AUTOMATION_RUNGS.bestFit,
      AUTOMATION_RUNGS.optimise,
    ]);
    // Every board this crew can see (the fixture scouts the whole map), so the expectation is
    // computed over the same set the runner reads. The day is one where the richest scrap job
    // and the best scrap rate are different jobs, which is the only case that tells the rule
    // apart from "take the biggest pile": scrap-run pays 34 in 13 minutes, rail-cut 51 in 105.
    const day = new Date('2026-09-25T12:00:00.000Z');
    const offers = [MISC_AREA_ID, ...CITY_DISTRICTS.map((one) => one.id)].flatMap((areaId) =>
      missionOffers(areaId, missionBoardKey(areaId, day)).filter((one) => one.kind !== 'battle'),
    );
    const scrap = (template: (typeof offers)[number]): number => template.spoils.scrap ?? 0;
    const rate = (template: (typeof offers)[number]): number =>
      scrap(template) / templateTimings(template).totalMinutes;
    const best = offers.reduce((top, one) => (rate(one) > rate(top) ? one : top));
    const richest = offers.reduce((top, one) => (scrap(one) > scrap(top) ? one : top));
    expect(best.id).toBe('scrap-run');
    expect(richest.id).toBe('rail-cut');
    slot(repos, base, { unitSlots: 4, officerId: null, force: {}, optimiseFor: 'scrap' });
    expect(settleAutomations(repos, day)).toBe(1);
    expect(repos.missions.listActiveByBaseId(base.id)[0]?.mission.templateId).toBe(best.id);
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
