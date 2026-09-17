import {
  MAX_NOTORIETY,
  createCommander,
  makeAttributes,
  notorietyEffects,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { crewEffectsFor, standingEffectsFor } from './standing.js';

/**
 * §D7: a rank reaches a fight.
 *
 * `economy/renown.ts` says what each rung pays and has its own tests. What this file asserts is the
 * half a table cannot: that the grant is **folded into the crew's standing**, which is the one
 * place every consumer in the game reads from. A bonus that exists in a catalogue and never reaches
 * `standingEffectsFor` is the exact shape of the six dead channels this codebase has already found:
 * an authored number with tests, and no engine on the other end of it.
 */

const NOW = new Date('2026-09-16T09:00:00.000Z');

function baseAt(notoriety: number): Base {
  return {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'The Cutting Floor',
    districtId: 'neon-docks',
    level: 30,
    isBot: false,
    resources: {
      caps: 1000,
      supplies: 1000,
      oil: 1000,
      scrap: 1000,
      highQualityMetal: 1000,
      planks: 1000,
    },
    economy: { ...startingEconomy(NOW.toISOString()), notoriety },
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(NOW.toISOString()),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [createCommander('off-1', 'Vasco Renn', 'field_commander', makeAttributes(40))],
    createdAt: NOW.toISOString(),
  };
}

/**
 * Enough of the repos for the standing fold: no ground, no owner, no Overseer, no table.
 *
 * `standingEffectsFor` also reads the faction cards, so a bench without `factions` throws before it
 * reaches the thing under test.
 */
function fakeRepos() {
  return {
    city: { controls: () => new Map() },
    users: { findById: () => undefined },
    overseers: { findById: () => undefined },
    factions: { membershipOf: () => undefined, members: () => [], find: () => undefined },
  } as unknown as Parameters<typeof standingEffectsFor>[0];
}

describe('a rank in the crew’s standing', () => {
  it('reaches the fold every consumer reads, and grows with the rank', () => {
    const nobody = standingEffectsFor(fakeRepos(), baseAt(0), NOW);
    const feared = standingEffectsFor(fakeRepos(), baseAt(8), NOW);
    const top = standingEffectsFor(fakeRepos(), baseAt(MAX_NOTORIETY), NOW);

    expect(feared.intimidationFlat, 'a bought rank bought nothing').toBeGreaterThan(
      nobody.intimidationFlat,
    );
    expect(top.intimidationFlat).toBeGreaterThan(feared.intimidationFlat);
  });

  /** The people-only fold too: a reputation is a fact about the crew, not about the ground. */
  it('reaches the fold that leaves the ground out', () => {
    const nobody = crewEffectsFor(fakeRepos(), baseAt(0), NOW);
    const top = crewEffectsFor(fakeRepos(), baseAt(MAX_NOTORIETY), NOW);
    expect(top.intimidationFlat).toBeGreaterThan(nobody.intimidationFlat);
  });

  /**
   * And what lands is what the table says, added to whatever else was already on the channel.
   *
   * Asserted as a difference rather than a figure: the fold carries perks, ground, the Lab and the
   * Gate as well, and pinning a total here would pin all of them.
   */
  it('adds exactly what the ladder promises', () => {
    const at = MAX_NOTORIETY;
    const nobody = standingEffectsFor(fakeRepos(), baseAt(0), NOW);
    const ranked = standingEffectsFor(fakeRepos(), baseAt(at), NOW);
    const promised = notorietyEffects(at);

    expect(ranked.intimidationFlat - nobody.intimidationFlat).toBe(promised.intimidationFlat);
    expect(ranked.unitOffensePercent - nobody.unitOffensePercent).toBe(promised.unitOffensePercent);
    // The per-tier grants land on the record channel the battle engine reads off `unit.tier`.
    expect(ranked.unitTierPercent['legendary']?.offense ?? 0).toBe(
      promised.unitTierPercent['legendary']?.offense ?? 0,
    );
    expect(ranked.unitTierPercent['legendary']?.offense ?? 0).toBeGreaterThan(0);
  });
});
