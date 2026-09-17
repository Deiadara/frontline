import {
  OFFICER_MARK_BAND,
  createCommander,
  makeAttributes,
  markFromPoints,
  markIndex,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type Commander,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { projectCrewOfficer } from './roster.js';
import { officerFitReader, liftedOfficerSheet, officerLiftRoom } from './standing.js';
import { chairMarksFor, researchHead, trackStatuses } from '../research/tracks.js';
import { roleFit } from '../roles/requirements.js';

/**
 * One sheet, one mark (§B7, §C1b).
 *
 * An officer has two sheets: the one printed on their card and the one they actually have, after
 * the Overseer's teaching perks, their peers' teaching perks, the ground's `officer_group` and the
 * Lab's rungs have lifted it. Everything that asks "how good is this person" must ask the same one,
 * and until this file existed only the Scrapyard did. `crew/roster.ts` drew the lifted bars and
 * printed the unlifted mark under them, and the Lab gated every rung on the unlifted number, so a
 * crew that finished Field Promotions watched the research screen refuse the officer it had just
 * promoted.
 *
 * The lift is not small enough to ignore. A mark band is `OFFICER_MARK_BAND` points wide, a single
 * `officer_group` perk is worth five points to a whole group, and `roleFit` is a weighted mean, so
 * one teacher moves a Head of Research most of a band on their own.
 *
 * ## The fixture
 *
 * A flat sheet at `RAW`, which scores exactly `RAW` in any chair, and one peer carrying
 * `war_college`: +5 to every mental attribute. `head_of_research` weighs analysis 5, intuition 3
 * and composure 2 (all mental) against encyclopedia 2 and chemistry 1 (technical), so the lifted
 * score is `RAW + 5 * 10 / 13`, and `RAW` is chosen so that lands on the far side of a band edge.
 */

const NOW = new Date('2026-09-16T09:00:00.000Z');

/** Flat at 24: `markFromPoints(24)` is one band below `markFromPoints(27.8)`. */
const RAW = 24;

/** What one `officer_group` teacher is worth to a Head of Research. See the fixture note. */
const TAUGHT = RAW + (5 * 10) / 13;

const head: Commander = createCommander('h', 'Officer h', 'head_of_research', makeAttributes(RAW));
const medic: Commander = createCommander('m', 'Officer m', 'chief_medic', makeAttributes(RAW));
const teacher: Commander = {
  ...createCommander('t', 'Officer t', 'field_commander', makeAttributes(RAW)),
  perks: ['war_college'],
};

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
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(NOW.toISOString()),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders,
    createdAt: NOW.toISOString(),
  };
}

/** Enough of the repos for {@link officerLiftRoom}: no owner, so no Overseer and no held ground. */
function fakeRepos() {
  return {
    city: { controls: () => new Map() },
    users: { findById: () => undefined },
    overseers: { findById: () => undefined },
  } as unknown as Parameters<typeof officerFitReader>[0];
}

describe('the sheet a mark is measured on', () => {
  /**
   * The anchor, and the reason every assertion below is worth making.
   *
   * If a teacher did not move the score across a band edge there would be nothing here to catch:
   * the lifted and unlifted answers would agree and reverting the fix would keep the file green.
   * Asserted rather than assumed, because it depends on a perk's magnitude and a role's weights,
   * and either could be retuned.
   */
  it('has a teacher worth a whole mark to the officer beside them', () => {
    const room = officerLiftRoom(fakeRepos(), makeBase([head, teacher]), NOW);
    const { attributes } = liftedOfficerSheet(head, room);

    expect(roleFit(attributes, 'head_of_research')).toBeCloseTo(TAUGHT, 6);
    expect(roleFit(head.attributes, 'head_of_research')).toBe(RAW);
    expect(TAUGHT - RAW).toBeLessThan(OFFICER_MARK_BAND);
    expect(markIndex(markFromPoints(TAUGHT))).toBe(markIndex(markFromPoints(RAW)) + 1);
  });

  it('reads the chair off the lifted sheet, not the printed one', () => {
    const alone = officerFitReader(fakeRepos(), makeBase([head]), NOW);
    const taught = officerFitReader(fakeRepos(), makeBase([head, teacher]), NOW);

    expect(alone.markFor('head_of_research')).toBe(markFromPoints(RAW));
    expect(taught.markFor('head_of_research')).toBe(markFromPoints(TAUGHT));
    expect(taught.pointsFor(head, 'head_of_research')).toBeCloseTo(TAUGHT, 6);
  });

  /**
   * The two halves of one card agreeing.
   *
   * `lifted` is what the bars draw and `mark` is the letter under them. Measured off different
   * sheets they contradicted each other on every card in the game that had a teacher in the room.
   */
  it('prints the mark for the bars the same card draws', () => {
    const room = officerLiftRoom(fakeRepos(), makeBase([head, teacher]), NOW);
    const card = projectCrewOfficer(head, liftedOfficerSheet(head, room));

    expect(card.mark).toBe(markFromPoints(roleFit(card.lifted, 'head_of_research')));
    expect(card.mark).toBe(markFromPoints(TAUGHT));
    // The control: the printed sheet is still on the card, and it is a different mark.
    expect(markFromPoints(roleFit(card.attributes, 'head_of_research'))).not.toBe(card.mark);
  });

  /**
   * The Lab, which is the gate the lift was bought for.
   *
   * `chairMarksFor` is what `researchItemRefusal` compares a rung's `requiresMark` against, so this
   * is the difference between a rung being offered and refused.
   */
  it('gates research on the lifted mark', () => {
    const alone = makeBase([head, medic]);
    const taught = makeBase([head, medic, teacher]);

    expect(chairMarksFor('head_of_research', officerFitReader(fakeRepos(), alone, NOW))).toEqual({
      trackMark: markFromPoints(RAW),
      headMark: markFromPoints(RAW),
    });
    expect(chairMarksFor('head_of_research', officerFitReader(fakeRepos(), taught, NOW))).toEqual({
      trackMark: markFromPoints(TAUGHT),
      headMark: markFromPoints(TAUGHT),
    });
  });

  /**
   * And the two figures the research screen prints beside it.
   *
   * The Head's time cut and the track officer's price cut are both monotone in the same score, so
   * a lift that reaches the gate and not the cut would put a mark on the screen that the numbers
   * under it disagree with.
   */
  it('shortens the clock and the bill by the lifted score', () => {
    const alone = researchHead(
      makeBase([head]),
      officerFitReader(fakeRepos(), makeBase([head]), NOW),
    );
    const taughtBase = makeBase([head, teacher]);
    const taught = researchHead(taughtBase, officerFitReader(fakeRepos(), taughtBase, NOW));

    expect(taught?.mark).toBe(markFromPoints(TAUGHT));
    expect(taught?.timeCutPercent ?? 0).toBeGreaterThan(alone?.timeCutPercent ?? 0);

    const medicAlone = makeBase([medic]);
    const medicTaught = makeBase([medic, teacher]);
    const cutAlone = trackStatuses(medicAlone, officerFitReader(fakeRepos(), medicAlone, NOW)).find(
      (entry) => entry.role === 'chief_medic',
    );
    const cutTaught = trackStatuses(
      medicTaught,
      officerFitReader(fakeRepos(), medicTaught, NOW),
    ).find((entry) => entry.role === 'chief_medic');

    // The Chief Medic weighs composure 3 and intuition 1 out of 13, both mental, so a smaller lift
    // than the Head gets and still a real one.
    expect(cutTaught?.costCutPercent ?? 0).toBeGreaterThan(cutAlone?.costCutPercent ?? 0);
  });
});
