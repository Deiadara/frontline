import {
  BUILD_BOOST_PERCENT,
  BUILD_BOOST_MS,
  BUILDING_MAX_LEVEL,
  CAPTURED_GATE_MAX_LEVEL,
  CAPTURED_GATE_START_LEVEL,
  CITY_DISTRICTS,
  GATE_DEFENSE_PERCENT_PER_LEVEL,
  GATE_INTEL_RESISTANCE_PER_LEVEL,
  STARTING_RESOURCES,
  capturedGateCost,
  capturedGateDefensePercent,
  capturedGateIntelResistancePercent,
  capturedGateSeconds,
  GATE_BREACH_HOURS,
  breachExpiry,
  findDistrict,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import {
  capturedGatesFor,
  districtsHeldWhole,
  gateFor,
  holdsDistrictWhole,
  raiseCapturedGate,
  resetGateOnDistrictLost,
  settleCapturedGates,
} from './gates.js';
import { cityContextFor } from './view.js';

/**
 * §B7: the gate on a district a crew has taken whole (board request).
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
    trainingQueue: [],
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
    });

    expect(raiseCapturedGate(repos, base, DISTRICT.id, new Date(HOUR))).toEqual({
      kind: 'refused',
      reason: 'at_ceiling',
    });
    // The same ceiling a Gate at home reaches, which is the board's rule that any gate you fully
    // hold goes to the same place. Pinned against the structure ceiling rather than against 20, so
    // moving one moves both.
    expect(CAPTURED_GATE_MAX_LEVEL).toBe(BUILDING_MAX_LEVEL);
    expect(CAPTURED_GATE_MAX_LEVEL).toBe(20);
  });
});

describe('what one is worth', () => {
  /** The same rates a home Gate pays, which is the board's rule for both halves. */
  it('defends and blurs at exactly the home Gate rates', () => {
    expect(capturedGateDefensePercent(8)).toBe(8 * GATE_DEFENSE_PERCENT_PER_LEVEL);
    expect(capturedGateIntelResistancePercent(8)).toBe(8 * GATE_INTEL_RESISTANCE_PER_LEVEL);
  });

  it('is worth nothing at level zero', () => {
    expect(capturedGateDefensePercent(0)).toBe(0);
    expect(capturedGateIntelResistancePercent(0)).toBe(0);
  });

  it('is worth more the higher it goes', () => {
    expect(capturedGateDefensePercent(10)).toBeGreaterThan(capturedGateDefensePercent(3));
    expect(capturedGateIntelResistancePercent(10)).toBeGreaterThan(
      capturedGateIntelResistancePercent(3),
    );
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
 * §A4: a gate that is down is a gate the holder can still lose (board request).
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
    repos.capturedGates.put({ districtId, level, upgradingTo: null, upgradingUntil: null });
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

describe('what a captured gate changes', () => {
  it('makes the district it stands on harder to read', () => {
    const { repos, base } = stack();
    repos.users.insert({ id: 'u2', username: 'rival', passwordHash: 'x', createdAt: HOUR });
    repos.bases.insert({ ...base, id: 'b2', ownerId: 'u2', name: 'Theirs' });
    takeWhole(repos, 'b2', DISTRICT.id);

    const bare = cityContextFor(repos, base).gateBlurOn(DISTRICT.id, 'b2');
    repos.capturedGates.put({
      districtId: DISTRICT.id,
      level: 10,
      upgradingTo: null,
      upgradingUntil: null,
    });
    const walled = cityContextFor(repos, base).gateBlurOn(DISTRICT.id, 'b2');

    expect(walled).toBeGreaterThan(bare);
    expect(walled).toBe(capturedGateIntelResistancePercent(10));
  });

  /** Only the district it stands on: a wall in the Rustyard hides nothing in the Undergrid. */
  it('hides nothing anywhere else', () => {
    const { repos, base } = stack();
    repos.users.insert({ id: 'u2', username: 'rival', passwordHash: 'x', createdAt: HOUR });
    repos.bases.insert({ ...base, id: 'b2', ownerId: 'u2', name: 'Theirs' });
    takeWhole(repos, 'b2', DISTRICT.id);
    repos.capturedGates.put({
      districtId: DISTRICT.id,
      level: 10,
      upgradingTo: null,
      upgradingUntil: null,
    });

    const elsewhere = CITY_DISTRICTS.find((d) => d.id !== DISTRICT.id)!;
    expect(cityContextFor(repos, base).gateBlurOn(elsewhere.id, 'b2')).toBe(0);
  });

  /** And nothing at all while the district is still split. */
  it('hides nothing until the district is held whole', () => {
    const { repos, base } = stack();
    repos.users.insert({ id: 'u2', username: 'rival', passwordHash: 'x', createdAt: HOUR });
    repos.bases.insert({ ...base, id: 'b2', ownerId: 'u2', name: 'Theirs' });
    repos.capturedGates.put({
      districtId: DISTRICT.id,
      level: 10,
      upgradingTo: null,
      upgradingUntil: null,
    });

    expect(cityContextFor(repos, base).gateBlurOn(DISTRICT.id, 'b2')).toBe(0);
  });
});

/**
 * §B4: the Generator's burn reaches a captured gate (board request).
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
