import {
  SPY_ACCURACY_RESEARCH_ID,
  SPY_ESTIMATE_RESEARCH_ID,
  BUILD_BOOST_PERCENT,
  BUILD_BOOST_MS,
  BUILDING_MAX_LEVEL,
  CAPTURED_GATE_MAX_LEVEL,
  CAPTURED_GATE_START_LEVEL,
  CITY_DISTRICTS,
  GATE_DEFENSE_PERCENT_PER_LEVEL,
  STARTING_RESOURCES,
  CAPTURED_GATE_PRICE_RISE,
  buildingCost,
  cancelRefund,
  createCommander,
  makeAttributes,
  capturedGateCost,
  capturedGateDefensePercent,
  capturedGateSeconds,
  GATE_BREACH_HOURS,
  breachExpiry,
  findDistrict,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  SPY_GATE_POINTS_PER_LEVEL,
  counterScore,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { ADMIN_ACTION_SECONDS } from '../admin/mode.js';
import {
  cancelGateRaise,
  capturedGatesFor,
  districtsHeldWhole,
  gateFor,
  holdsDistrictWhole,
  raiseCapturedGate,
  resetGateOnDistrictLost,
  settleCapturedGates,
} from './gates.js';
import { composeSpyReport, groundBehind, readGround } from '../spying/spying.js';

/**
 * §B7: the gate on a district a crew has taken whole (maintainer request).
 *
 * The board's words: "whenever you fully capture a district (excluding gate, you cannot really
 * capture that) you get access to its gate, and then you can upgrade it normally as if you would
 * upgrade the gate in your own city. It starts at level 1 and you can get it up to MAX level."
 *
 * Every clause of that is a test below. The exclusion is the interesting one: it is true by
 * construction rather than by a rule, because a gate is its own `BattleTarget` kind and never a
 * location, so the sweep that grants access cannot include it even by accident.
 */

const HOUR = '2026-09-01T12:00:00.000Z';
/** A district with locations in it, picked off the catalogue rather than named. */
const DISTRICT = CITY_DISTRICTS.find((d) => d.locations.length > 1)!;

function stack(): { repos: Repositories; base: Base } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const repos = createRepositories(db);
  repos.users.insert({ id: 'u', username: 'holder', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Yard',
    districtId: 'neon-docks',
    level: 20,
    isBot: false,
    resources: { ...STARTING_RESOURCES, caps: 9e6, scrap: 9e6, planks: 9e6, oil: 9e6 },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [],
    buildQueue: [],
    army: {},
    musterQueue: [],
    training: startingTraining(HOUR),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: HOUR,
  };
  repos.bases.insert(base);
  return { repos, base };
}

/** Hands this crew every location in `districtId`, leaving the rest of the map alone. */
function takeWhole(repos: Repositories, baseId: string, districtId: string): void {
  for (const location of findDistrict(districtId)!.locations) {
    const control = repos.city.control(location.id);
    if (control) repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
  }
}

describe('who gets a gate', () => {
  it('gives one to a crew that holds every location in a district', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);

    expect(holdsDistrictWhole(repos, base.id, DISTRICT.id)).toBe(true);
    expect(districtsHeldWhole(repos, base.id)).toContain(DISTRICT.id);
  });

  /** One location short is no gate: taking the last one is what the mechanic is for. */
  it('gives none to a crew holding all but one', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    const [first] = DISTRICT.locations;
    const control = repos.city.control(first!.id)!;
    repos.city.put({ ...control, holder: { kind: 'looters' }, garrison: {} });

    expect(holdsDistrictWhole(repos, base.id, DISTRICT.id)).toBe(false);
    expect(capturedGatesFor(repos, base, new Date(HOUR))).toEqual([]);
  });

  /**
   * The board's caveat, and it needs no code.
   *
   * A gate is a `BattleTarget` of its own kind, never a location, so the sweep above cannot
   * include it. Asserted against the catalogue so that stays true if somebody ever adds a
   * location that sounds like a gate.
   */
  it('never asks a crew to capture the gate itself', () => {
    for (const district of CITY_DISTRICTS) {
      for (const location of district.locations) {
        expect(location.kind).not.toBe('gate');
      }
    }
  });

  it('starts at level 1', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);

    expect(gateFor(repos, DISTRICT.id).level).toBe(CAPTURED_GATE_START_LEVEL);
    expect(CAPTURED_GATE_START_LEVEL).toBe(1);
  });
});

describe('raising one', () => {
  it('charges the same as the Gate at home and starts a clock', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);

    const result = raiseCapturedGate(repos, base, DISTRICT.id, new Date(HOUR));
    expect(result.kind).toBe('started');
    if (result.kind !== 'started') return;

    // The board: "costs pretty much the same things to upgrade".
    const price = capturedGateCost(2);
    expect(result.base.resources.caps).toBe(base.resources.caps - (price.caps ?? 0));
    expect(result.gate.upgradingTo).toBe(2);
    expect(Date.parse(result.gate.upgradingUntil!)).toBe(
      Date.parse(HOUR) + capturedGateSeconds(2) * 1000,
    );
    // Not raised yet: the level moves when the clock lands, not when the order is placed.
    expect(result.gate.level).toBe(1);
  });

  /** Maintainer, 2026-10-05: the crew's discounts and its Engineer reach a gate, and it runs 10% dearer. */
  it('runs 10% over the Gate at home, and takes a perfect Engineer’s half off', () => {
    const plain = buildingCost('gate', 2, []);
    expect(capturedGateCost(2).caps).toBe(Math.round((plain.caps ?? 0) * CAPTURED_GATE_PRICE_RISE));

    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    const engineer = createCommander('eng', 'Vasso', 'engineer', makeAttributes(100));
    repos.bases.updateCommanders(base.id, [engineer]);
    const withEngineer = repos.bases.findById(base.id)!;
    const result = raiseCapturedGate(repos, withEngineer, DISTRICT.id, new Date(HOUR));
    if (result.kind !== 'started') throw new Error(result.kind);
    const charged = base.resources.caps - result.base.resources.caps;
    expect(charged).toBe(capturedGateCost(2, { engineerPercent: 50 }).caps);
    expect(charged).toBeLessThan(capturedGateCost(2).caps!);
    expect(result.gate.upgradePaid?.caps).toBe(charged);
  });

  it('refunds what the order was charged, not a price read again without the Engineer', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    repos.bases.updateCommanders(base.id, [
      createCommander('eng', 'Vasso', 'engineer', makeAttributes(100)),
    ]);
    const result = raiseCapturedGate(
      repos,
      repos.bases.findById(base.id)!,
      DISTRICT.id,
      new Date(HOUR),
    );
    if (result.kind !== 'started') throw new Error(result.kind);
    const paid = result.gate.upgradePaid!;
    // The Engineer leaves before the cancel: the refund must not grow.
    repos.bases.updateCommanders(base.id, []);
    const before = repos.bases.findById(base.id)!;
    const cancelled = cancelGateRaise(repos, before, DISTRICT.id, new Date(HOUR), true);
    if (cancelled.kind !== 'cancelled') throw new Error(cancelled.kind);
    expect(cancelled.refund).toEqual(cancelRefund(paid));
    expect(cancelled.refund.caps!).toBeLessThan(paid.caps!);
  });

  /*
   * Bug pass, 2026-09-29: the testing build flattened every build clock and waived every bill
   * except this one, which charged in full and ran the real clock.
   */
  it('in admin mode, takes five seconds and nothing, and hands nothing back', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    const broke = { ...base, resources: { ...STARTING_RESOURCES, caps: 0, scrap: 0, planks: 0 } };
    repos.bases.updateResources(base.id, broke.resources);

    const result = raiseCapturedGate(repos, broke, DISTRICT.id, new Date(HOUR), true);
    expect(result.kind).toBe('started');
    if (result.kind !== 'started') return;
    expect(result.base.resources).toEqual(broke.resources);
    expect(Date.parse(result.gate.upgradingUntil!)).toBe(
      Date.parse(HOUR) + ADMIN_ACTION_SECONDS * 1000,
    );

    const cancelled = cancelGateRaise(repos, result.base, DISTRICT.id, new Date(HOUR), true, true);
    expect(cancelled.kind).toBe('cancelled');
    expect(repos.bases.findById(base.id)!.resources).toEqual(broke.resources);
  });

  it('refuses a crew that does not hold the ground', () => {
    const { repos, base } = stack();
    const result = raiseCapturedGate(repos, base, DISTRICT.id, new Date(HOUR));
    expect(result).toEqual({ kind: 'refused', reason: 'not_held' });
  });

  it('refuses a second order while the first is still running', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    const first = raiseCapturedGate(repos, base, DISTRICT.id, new Date(HOUR));
    if (first.kind !== 'started') throw new Error('expected the first to start');

    const second = raiseCapturedGate(repos, first.base, DISTRICT.id, new Date(HOUR));
    expect(second).toEqual({ kind: 'refused', reason: 'already_working' });
  });

  it('refuses a crew that cannot pay', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    const broke = { ...base, resources: { ...STARTING_RESOURCES, caps: 0, scrap: 0, planks: 0 } };

    expect(raiseCapturedGate(repos, broke, DISTRICT.id, new Date(HOUR))).toEqual({
      kind: 'refused',
      reason: 'cannot_afford',
    });
  });

  it('lands the level when the clock runs out, and not before', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    raiseCapturedGate(repos, base, DISTRICT.id, new Date(HOUR));
    const seconds = capturedGateSeconds(2);

    expect(settleCapturedGates(repos, new Date(Date.parse(HOUR) + (seconds - 1) * 1000))).toBe(0);
    expect(gateFor(repos, DISTRICT.id).level).toBe(1);

    expect(settleCapturedGates(repos, new Date(Date.parse(HOUR) + seconds * 1000))).toBe(1);
    const landed = gateFor(repos, DISTRICT.id);
    expect(landed.level).toBe(2);
    expect(landed.upgradingUntil).toBeNull();
    expect(landed.upgradingTo).toBeNull();
    // P8-C: the walls ladder counts the level that landed, for the crew holding the district.
    expect(repos.feats.tallies(base.id)['gate_levels_raised']).toBe(1);
  });

  /** "you can get it up to MAX level", and no further. */
  it('will not go past the ceiling every structure has', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    repos.capturedGates.put({
      districtId: DISTRICT.id,
      level: CAPTURED_GATE_MAX_LEVEL,
      upgradingTo: null,
      upgradingUntil: null,
      upgradingSince: null,
    });

    expect(raiseCapturedGate(repos, base, DISTRICT.id, new Date(HOUR))).toEqual({
      kind: 'refused',
      reason: 'at_ceiling',
    });
    // The same ceiling a Gate at home reaches, which is the maintainer's rule that any gate you fully
    // hold goes to the same place. Pinned against the structure ceiling rather than against 20, so
    // moving one moves both.
    expect(CAPTURED_GATE_MAX_LEVEL).toBe(BUILDING_MAX_LEVEL);
    expect(CAPTURED_GATE_MAX_LEVEL).toBe(20);
  });
});

describe('what one is worth', () => {
  /**
   * The same rate a home Gate pays. Against a spy both are read off the level in the contest
   * (`SPY_GATE_POINTS_PER_LEVEL`), so that half needs no figure of its own.
   */
  it('defends at exactly the home Gate rate', () => {
    expect(capturedGateDefensePercent(8)).toBe(8 * GATE_DEFENSE_PERCENT_PER_LEVEL);
  });

  it('is worth nothing at level zero', () => {
    expect(capturedGateDefensePercent(0)).toBe(0);
  });

  it('is worth more the higher it goes', () => {
    expect(capturedGateDefensePercent(10)).toBeGreaterThan(capturedGateDefensePercent(3));
  });
});

describe('the gate belongs to the ground', () => {
  /**
   * A crew that takes a worked-up district inherits the wall.
   *
   * The alternative, keying it to whoever built it, would mean a level-12 gate vanishing the
   * moment the district changed hands and reappearing if it changed back. A wall is a thing
   * standing in a place.
   */
  it('passes to whoever holds the district next', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    repos.capturedGates.put({
      districtId: DISTRICT.id,
      level: 12,
      upgradingTo: null,
      upgradingUntil: null,
      upgradingSince: null,
    });

    repos.users.insert({ id: 'u2', username: 'raider', passwordHash: 'x', createdAt: HOUR });
    repos.bases.insert({ ...base, id: 'b2', ownerId: 'u2', name: 'The Other Yard' });
    takeWhole(repos, 'b2', DISTRICT.id);

    expect(holdsDistrictWhole(repos, base.id, DISTRICT.id)).toBe(false);
    expect(holdsDistrictWhole(repos, 'b2', DISTRICT.id)).toBe(true);
    expect(gateFor(repos, DISTRICT.id).level).toBe(12);
  });
});

/**
 * §B7: and the two things a gate is actually for.
 *
 * Both asserted through the systems that spend them rather than on the helpers, because the
 * helpers were never the risk. A gate that computes a percentage nothing reads is exactly the bug
 * this whole area has shipped twice: the home Gate's own defence sat unread until integration, and
 * `officerGroupFlat` sat unread for eight perks.
 */
/**
 * §A4: a gate that is down is a gate the holder can still lose (maintainer request).
 *
 * A breach opens the district for {@link GATE_BREACH_HOURS} hours. If the holder loses a single
 * location inside it while that window is open, they no longer hold the district outright and the
 * wall goes back to level 1: whatever they had raised it to is gone with the ground.
 *
 * The negative half is the rule. Losing a location behind a gate that is *standing* takes nothing
 * off the gate, because a gate belongs to the ground and passes to whoever holds it next. Without
 * that arm this is a reset with no condition on it.
 */
describe('losing a district while the gate is down', () => {
  /** Puts this district's gate at `level`, as if the holder had raised it there. */
  function raisedTo(repos: Repositories, districtId: string, level: number): void {
    repos.capturedGates.put({
      districtId,
      level,
      upgradingTo: null,
      upgradingUntil: null,
      upgradingSince: null,
    });
  }

  /** Takes one location off the holder, the way a lost fight does. */
  function loseOne(repos: Repositories, districtId: string): void {
    const first = findDistrict(districtId)!.locations[0]!;
    const control = repos.city.control(first.id)!;
    repos.city.put({ ...control, holder: { kind: 'looters' }, garrison: {} });
  }

  function brokenSince(repos: Repositories, districtId: string, at: string): void {
    repos.sieges.breakGate(districtId, breachExpiry(new Date(at)));
  }

  it('drops the gate to level 1 and takes the district with it', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    raisedTo(repos, DISTRICT.id, 7);
    brokenSince(repos, DISTRICT.id, HOUR);

    const heldWholeBefore = holdsDistrictWhole(repos, base.id, DISTRICT.id);
    expect(heldWholeBefore).toBe(true);
    loseOne(repos, DISTRICT.id);

    const reset = resetGateOnDistrictLost(repos, {
      districtId: DISTRICT.id,
      holderBaseId: base.id,
      heldWholeBefore,
      now: new Date(HOUR),
    });

    expect(reset).toBe(true);
    expect(gateFor(repos, DISTRICT.id).level).toBe(CAPTURED_GATE_START_LEVEL);
    expect(holdsDistrictWhole(repos, base.id, DISTRICT.id)).toBe(false);
    expect(districtsHeldWhole(repos, base.id)).not.toContain(DISTRICT.id);
  });

  it('abandons whatever was being raised on it', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    raisedTo(repos, DISTRICT.id, 7);
    raiseCapturedGate(repos, base, DISTRICT.id, new Date(HOUR));
    brokenSince(repos, DISTRICT.id, HOUR);

    const heldWholeBefore = holdsDistrictWhole(repos, base.id, DISTRICT.id);
    loseOne(repos, DISTRICT.id);
    resetGateOnDistrictLost(repos, {
      districtId: DISTRICT.id,
      holderBaseId: base.id,
      heldWholeBefore,
      now: new Date(HOUR),
    });

    const gate = gateFor(repos, DISTRICT.id);
    expect(gate.level).toBe(CAPTURED_GATE_START_LEVEL);
    expect(gate.upgradingTo).toBeNull();
    expect(gate.upgradingUntil).toBeNull();
  });

  it('takes nothing off a gate that is standing', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    raisedTo(repos, DISTRICT.id, 7);

    const heldWholeBefore = holdsDistrictWhole(repos, base.id, DISTRICT.id);
    loseOne(repos, DISTRICT.id);

    const reset = resetGateOnDistrictLost(repos, {
      districtId: DISTRICT.id,
      holderBaseId: base.id,
      heldWholeBefore,
      now: new Date(HOUR),
    });

    expect(reset).toBe(false);
    expect(gateFor(repos, DISTRICT.id).level).toBe(7);
  });

  /** And nothing at all once the breach has run out: the door is back on its hinges. */
  it('takes nothing off once the breach has expired', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    raisedTo(repos, DISTRICT.id, 7);
    brokenSince(repos, DISTRICT.id, HOUR);

    const heldWholeBefore = holdsDistrictWhole(repos, base.id, DISTRICT.id);
    loseOne(repos, DISTRICT.id);
    const after = new Date(Date.parse(HOUR) + (GATE_BREACH_HOURS + 1) * 3_600_000);

    expect(
      resetGateOnDistrictLost(repos, {
        districtId: DISTRICT.id,
        holderBaseId: base.id,
        heldWholeBefore,
        now: after,
      }),
    ).toBe(false);
    expect(gateFor(repos, DISTRICT.id).level).toBe(7);
  });

  /** A district that was already split has nothing to lose: the holder had not held it whole. */
  it('takes nothing off a district the crew did not hold outright', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    raisedTo(repos, DISTRICT.id, 7);
    brokenSince(repos, DISTRICT.id, HOUR);
    loseOne(repos, DISTRICT.id);

    expect(
      resetGateOnDistrictLost(repos, {
        districtId: DISTRICT.id,
        holderBaseId: base.id,
        heldWholeBefore: false,
        now: new Date(HOUR),
      }),
    ).toBe(false);
    expect(gateFor(repos, DISTRICT.id).level).toBe(7);
  });
});

describe('what a captured gate changes (2026-09-22: read by spies, since nothing is free)', () => {
  const GATE = { kind: 'gate', districtId: DISTRICT.id } as const;

  function rival(repos: Repositories, base: Base): void {
    repos.users.insert({ id: 'u2', username: 'rival', passwordHash: 'x', createdAt: HOUR });
    repos.bases.insert({ ...base, id: 'b2', ownerId: 'u2', name: 'Theirs' });
  }

  function counterOn(repos: Repositories, base: Base): number {
    const looked = groundBehind(repos, base, GATE);
    if (looked.kind !== 'ground') throw new Error(`refused: ${looked.reason}`);
    return counterScore(looked.ground.counter);
  }

  it('makes the gate of the district it stands on harder to read', () => {
    const { repos, base } = stack();
    rival(repos, base);
    takeWhole(repos, 'b2', DISTRICT.id);

    const bare = counterOn(repos, base);
    repos.capturedGates.put({
      districtId: DISTRICT.id,
      level: 10,
      upgradingTo: null,
      upgradingUntil: null,
      upgradingSince: null,
    });
    const walled = counterOn(repos, base);

    expect(walled).toBeGreaterThan(bare);
    expect(walled - bare).toBe((10 - CAPTURED_GATE_START_LEVEL) * SPY_GATE_POINTS_PER_LEVEL);
  });

  // Nobody stands at a gate held from elsewhere between fights (maintainer, 2026-10-02): the
  // report says so, with no accuracy or estimate to dress up an empty that is not a count.
  it('reports a gate held from elsewhere as nobody standing there now, not an accurate empty', () => {
    const { repos, base } = stack();
    rival(repos, base);
    takeWhole(repos, 'b2', DISTRICT.id);
    const looked = groundBehind(repos, base, GATE);
    const heading = { id: 'r1', target: GATE, tier: null, capsPaid: 0, foundOut: false };
    // A reader with both rungs, so a missing figure is the ruling and not the research.
    const reader = {
      ...base,
      research: {
        ...base.research,
        technologies: [SPY_ACCURACY_RESEARCH_ID, SPY_ESTIMATE_RESEARCH_ID],
      },
    };
    const read = composeSpyReport(
      repos,
      reader,
      heading,
      readGround(reader, looked, 500),
      new Date(HOUR),
    );
    expect(read.failed).toBe(false);
    expect(read.heldFromAway).toBe(true);
    expect(read.accuracy).toBeNull();
    expect(read.unseen).toBeNull();
    // A spy who cannot beat the counter still comes back with nothing, as on any empty ground.
    const beaten = composeSpyReport(
      repos,
      reader,
      heading,
      readGround(reader, looked, 0),
      new Date(HOUR),
    );
    expect(beaten.failed).toBe(true);
  });

  it('shuts every location behind it: from outside, the gate is the only thing to read', () => {
    const { repos, base } = stack();
    rival(repos, base);
    takeWhole(repos, 'b2', DISTRICT.id);

    const inside = groundBehind(repos, base, {
      kind: 'location',
      locationId: DISTRICT.locations[0]!.id,
    });
    expect(inside).toEqual({ kind: 'refused', reason: 'not_the_gate' });
  });

  it('is nothing until the district is held whole', () => {
    const { repos, base } = stack();
    rival(repos, base);
    takeWhole(repos, 'b2', DISTRICT.id);
    const [first] = DISTRICT.locations;
    repos.city.put({
      ...repos.city.control(first!.id)!,
      holder: { kind: 'looters' },
      garrison: {},
    });
    repos.capturedGates.put({
      districtId: DISTRICT.id,
      level: 10,
      upgradingTo: null,
      upgradingUntil: null,
      upgradingSince: null,
    });

    // An open district has no gate to read, and a location in it reads as itself.
    expect(groundBehind(repos, base, GATE)).toEqual({ kind: 'refused', reason: 'nothing_there' });
    const inside = groundBehind(repos, base, { kind: 'location', locationId: first!.id });
    expect(inside.kind).toBe('ground');
  });
});

/**
 * §B4: the Generator's burn reaches a captured gate (maintainer request).
 *
 * The burn promises "all building upgrades", and a captured gate is one: same cost curve, same
 * clock, same work. It is not in the district's `buildQueue` though, which is the only thing
 * `boostedQueue` re-times, so without reading the burn here the promise would quietly have meant
 * "all upgrades except the ones on ground you took".
 */
describe('the build burn and a captured gate', () => {
  it('shortens the clock on a gate ordered while it runs', () => {
    const plain = stack();
    takeWhole(plain.repos, plain.base.id, DISTRICT.id);
    const normal = raiseCapturedGate(plain.repos, plain.base, DISTRICT.id, new Date(HOUR));
    if (normal.kind !== 'started') throw new Error('expected a start');

    const burning = stack();
    takeWhole(burning.repos, burning.base.id, DISTRICT.id);
    const boosted = raiseCapturedGate(
      burning.repos,
      {
        ...burning.base,
        economy: {
          ...burning.base.economy,
          buildBoostUntil: new Date(Date.parse(HOUR) + BUILD_BOOST_MS).toISOString(),
        },
      },
      DISTRICT.id,
      new Date(HOUR),
    );
    if (boosted.kind !== 'started') throw new Error('expected a start');

    const plainMs = Date.parse(normal.gate.upgradingUntil!) - Date.parse(HOUR);
    const burntMs = Date.parse(boosted.gate.upgradingUntil!) - Date.parse(HOUR);
    expect(burntMs).toBeLessThan(plainMs);
    // Exactly the burn's percentage, so the gate and the queue are cut by the same knife.
    // Rounded to whole seconds by the order, so compare in seconds rather than milliseconds.
    expect(Math.round(burntMs / 1000)).toBe(
      Math.round((plainMs / 1000) * (1 - BUILD_BOOST_PERCENT / 100)),
    );
  });

  /**
   * ...and says so on the card, which is what a player reads before pressing (bug pass, 2026-09-13).
   *
   * `raiseCapturedGate` takes the burn off the clock it starts, and the card quoted
   * `capturedGateSeconds` bare. So a crew with a Generator running was shown the full clock and
   * given a shorter one: two numbers for one duration, and the one on screen was never the one
   * charged.
   */
  it('quotes the shortened clock on the card while the burn runs', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    const burning: Base = {
      ...base,
      economy: {
        ...base.economy,
        buildBoostUntil: new Date(Date.parse(HOUR) + BUILD_BOOST_MS).toISOString(),
      },
    };
    const now = new Date(HOUR);

    const quoted = capturedGatesFor(repos, burning, now).find(
      (view) => view.districtId === DISTRICT.id,
    );
    expect(quoted?.nextSeconds).toBeDefined();
    // Quoted below the catalogue clock, because the burn is running.
    expect(quoted!.nextSeconds!).toBeLessThan(
      capturedGateSeconds(gateFor(repos, DISTRICT.id).level + 1),
    );

    // ...and it is the clock the raise actually starts, to the second.
    const started = raiseCapturedGate(repos, burning, DISTRICT.id, now);
    if (started.kind !== 'started') throw new Error('expected a start');
    const charged = Math.round(
      (Date.parse(started.gate.upgradingUntil!) - Date.parse(HOUR)) / 1000,
    );
    expect(quoted!.nextSeconds).toBe(charged);
  });

  it('leaves the clock alone when no burn is running', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, DISTRICT.id);
    const started = raiseCapturedGate(repos, base, DISTRICT.id, new Date(HOUR));
    if (started.kind !== 'started') throw new Error('expected a start');

    expect(Date.parse(started.gate.upgradingUntil!) - Date.parse(HOUR)).toBe(
      capturedGateSeconds(2) * 1000,
    );
  });
});
