import {
  createCommander,
  itemsInTrack,
  makeAttributes,
  officerRecoveryAt,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type Commander,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { officerFitReader } from './standing.js';
import { startResearch } from '../research/start.js';
import { itemBlocker, researchHead } from '../research/tracks.js';

/**
 * §D4, second half: an injured officer does not vouch for anything either.
 *
 * `workingOfficers` decides who is out, and the 2026-09-23 sweep put it under every chair that
 * sells a *service*: the Fabricator's cut, the Researcher's cut, the track panels. What it
 * did not reach is `officerFitReader.markFor`, which is the chair that **vouches**: the mark a
 * research rung is gated on and the mark a Scrapyard card asks its trade for. So a crew whose
 * Researcher was in a hospital bed read `head: null` on the page and started rungs anyway.
 *
 * The contradiction is inside one response, which is what makes it a defect rather than a tuning
 * call: `researchHead` answers null for the same chair `chairMarksFor` answers a mark for.
 */

const NOW = new Date('2026-09-23T20:00:00.000Z');
const UNTIL = officerRecoveryAt(NOW);

/** The Veteran's first rung: gated on the two chairs being filled and on nothing else. */
const FIRST_MEDIC = itemsInTrack('veteran')[0];
if (!FIRST_MEDIC) throw new Error('the Veteran track has no first rung');

function makeBase(commanders: Commander[]): Base {
  return {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'Test Hold',
    districtId: 'neon-docks',
    level: 1,
    isBot: false,
    resources: {
      caps: 500_000,
      supplies: 9000,
      oil: 9000,
      scrap: 500_000,
      highQualityMetal: 9000,
      planks: 9000,
    },
    economy: startingEconomy(NOW.toISOString()),
    progression: startingProgression(),
    research: startingResearch(),
    // A Lab at its top, so the tier gate (P7-C, 2026-10-02) opens every rung and the chairs are
    // what these tests measure.
    buildings: [{ id: 'lab', kind: 'lab', level: 20, modifications: [] }],
    buildQueue: [],
    army: {},
    gateArmy: {},
    musterQueue: [],
    training: startingTraining(NOW.toISOString()),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders,
    createdAt: NOW.toISOString(),
  };
}

function fakeRepos(): Parameters<typeof startResearch>[0] {
  return {
    bases: {
      updateResearch: () => undefined,
      updateResources: () => undefined,
      updateEconomy: () => undefined,
      updateCommanders: () => undefined,
      updateProgression: () => undefined,
      pendingLevelUp: () => undefined,
      setPendingLevelUp: () => undefined,
      updateAddons: () => undefined,
      updateDistrict: () => undefined,
    },
    overseers: { updateAttributes: () => undefined },
    city: { controls: () => new Map() },
    users: { findById: () => undefined },
    factions: { membershipOf: () => undefined },
    // ...and whether the crew's gate is breached, which zeroes what it gives.
    sieges: { gate: () => undefined },
  } as unknown as Parameters<typeof startResearch>[0];
}

const medic = createCommander('off-medic', 'Medic', 'veteran', makeAttributes(60), []);
const head = createCommander('off-head', 'Head', 'researcher', makeAttributes(60), []);
const hurtHead: Commander = { ...head, injuredUntil: UNTIL };

describe('an injured officer does not vouch for their chair', () => {
  it('reads no mark for a chair whose officer is in a bed', () => {
    const fit = officerFitReader(fakeRepos(), makeBase([medic, hurtHead]), NOW);
    expect(fit.markFor('veteran')).not.toBeNull();
    expect(fit.markFor('researcher')).toBeNull();
  });

  it('puts the mark back the moment the twelve hours are up', () => {
    const better = new Date(Date.parse(UNTIL) + 1000);
    const fit = officerFitReader(fakeRepos(), makeBase([medic, hurtHead]), better);
    expect(fit.markFor('researcher')).not.toBeNull();
  });

  it('is measured against a crew where the same chair does answer when nobody is hurt', () => {
    // The positive control: without it every assertion above would pass on a reader that answered
    // null for every chair.
    const fit = officerFitReader(fakeRepos(), makeBase([medic, head]), NOW);
    expect(fit.markFor('researcher')).not.toBeNull();
  });

  it('refuses the rung the chair gates, and says which chair', () => {
    const base = makeBase([medic, hurtHead]);
    const fit = officerFitReader(fakeRepos(), base, NOW);
    // The page and the gate agree: a chair with nobody working it has no mark to show and no rung
    // to open. It used to read `head: null` beside a rung with no blocker on it.
    expect(researchHead(fakeRepos(), base, fit)).toBeNull();
    expect(itemBlocker(base, FIRST_MEDIC.id, fit)).toBe('Needs a Researcher');

    const refused = startResearch(fakeRepos(), {
      base,
      project: { kind: 'technology', techId: FIRST_MEDIC.id },
      id: 'r-1',
      now: NOW,
    });
    expect(refused).toEqual({ kind: 'refused', reason: 'locked' });
  });

  it('still starts the same rung for a crew whose Head is on their feet', () => {
    const base = makeBase([medic, head]);
    const fit = officerFitReader(fakeRepos(), base, NOW);
    expect(researchHead(fakeRepos(), base, fit)).not.toBeNull();
    expect(itemBlocker(base, FIRST_MEDIC.id, fit)).toBeNull();

    const started = startResearch(fakeRepos(), {
      base,
      project: { kind: 'technology', techId: FIRST_MEDIC.id },
      id: 'r-1',
      now: NOW,
    });
    expect(started.kind).toBe('started');
  });
});
