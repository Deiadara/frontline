import {
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
