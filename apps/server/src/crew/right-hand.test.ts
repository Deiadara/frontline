import {
  CITY_DISTRICTS,
  MAX_OVERSEER_LIFT,
  MAX_RIGHT_HAND_LIFT,
  createCommander,
  makeAttributes,
  rightHandLift,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { liftedOfficerSheet, liftedOverseerSheet, officerLiftRoom } from './standing.js';

/**
 * The Right Hand lifts the room (§C2b, maintainer 2026-09-22).
 *
 * Two channels off one chair: every other officer's sheet, and the Overseer's own. Both were
 * nothing before this; the chair's sheet reached only its own research track. What is pinned is
 * the shape: continuous on fit, capped below the room's ceiling so teachers still matter, never
 * on themselves, and the Overseer touched by this one source and no other.
 */
const dbs: AppDatabase[] = [];
const NOW = new Date('2026-09-22T12:00:00.000Z');

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function stack(rightHandRating: number | null): { repos: Repositories; base: Base } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  dbs.push(db);
  const repos = createRepositories(db);
  const now = NOW.toISOString();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'boss', 'x', ?)`,
  ).run(now);
  const commanders = [createCommander('peer', 'The Peer', 'trader', makeAttributes(40))];
  if (rightHandRating !== null) {
    commanders.push(
      createCommander('rh', 'The Deputy', 'right_hand', makeAttributes(rightHandRating)),
    );
  }
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
    army: {},
    trainingQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders,
    createdAt: now,
  };
  repos.bases.insert(base);
  for (const district of CITY_DISTRICTS) repos.city.markScouted(base.id, district.id, now);
  return { repos, base };
}

describe('the curve', () => {
  it('pays nothing at the floor and the whole ceiling at the top, continuously between', () => {
    expect(rightHandLift(10, MAX_RIGHT_HAND_LIFT)).toBe(0);
    expect(rightHandLift(100, MAX_RIGHT_HAND_LIFT)).toBe(MAX_RIGHT_HAND_LIFT);
    expect(rightHandLift(55, MAX_RIGHT_HAND_LIFT)).toBe(MAX_RIGHT_HAND_LIFT / 2);
    expect(rightHandLift(100, MAX_OVERSEER_LIFT)).toBe(MAX_OVERSEER_LIFT);
  });

  it('keeps the officer lift under half the room cap, so teachers still matter', () => {
    expect(MAX_RIGHT_HAND_LIFT * 2).toBeLessThanOrEqual(10);
  });
});

describe('what the Right Hand does to the room', () => {
  it('lifts every other officer on every attribute, and names themselves on the receipt', () => {
    const { repos, base } = stack(100);
    const room = officerLiftRoom(repos, base, NOW);
    const peer = base.commanders.find((one) => one.id === 'peer');
    if (!peer) throw new Error('fixture');
    const { attributes, lift } = liftedOfficerSheet(peer, room);
    expect(attributes.strength).toBe(40 + MAX_RIGHT_HAND_LIFT);
    expect(attributes.cryptography).toBe(40 + MAX_RIGHT_HAND_LIFT);
    expect(lift.some((line) => line.from === 'The Deputy')).toBe(true);
  });

  it('lifts nobody with the chair empty, and nobody with a Right Hand at the floor', () => {
    const empty = stack(null);
    const peer = empty.base.commanders[0];
    if (!peer) throw new Error('fixture');
    expect(
      liftedOfficerSheet(peer, officerLiftRoom(empty.repos, empty.base, NOW)).attributes.strength,
    ).toBe(40);

    const weak = stack(10);
    const weakPeer = weak.base.commanders.find((one) => one.id === 'peer');
    if (!weakPeer) throw new Error('fixture');
    expect(
      liftedOfficerSheet(weakPeer, officerLiftRoom(weak.repos, weak.base, NOW)).attributes.strength,
    ).toBe(40);
  });

  it('never lifts the Right Hand themselves', () => {
    const { repos, base } = stack(100);
    const room = officerLiftRoom(repos, base, NOW);
    const rh = base.commanders.find((one) => one.id === 'rh');
    if (!rh) throw new Error('fixture');
    const { attributes, lift } = liftedOfficerSheet(rh, room);
    expect(attributes.strength).toBe(100);
    expect(lift.some((line) => line.from === 'The Deputy')).toBe(false);
  });

  it('lifts the Overseer by the smaller ceiling, and by nothing else', () => {
    const { repos, base } = stack(100);
    const room = officerLiftRoom(repos, base, NOW);
    const own = makeAttributes(50);
    const lifted = liftedOverseerSheet(own, room);
    expect(lifted.strength).toBe(50 + MAX_OVERSEER_LIFT);
    expect(lifted.diplomacy).toBe(50 + MAX_OVERSEER_LIFT);
    // No Right Hand, no lift: the Overseer takes nothing from teachers.
    const alone = stack(null);
    expect(liftedOverseerSheet(own, officerLiftRoom(alone.repos, alone.base, NOW))).toEqual(own);
  });
});
