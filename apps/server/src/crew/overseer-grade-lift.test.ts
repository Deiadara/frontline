import {
  ATTRIBUTE_NAMES,
  ATTRIBUTES_BY_GROUP,
  MAX_OFFICER_LIFT,
  MAX_OVERSEER_LIFT,
  MAX_RIGHT_HAND_LIFT,
  OFFICER_MARKS,
  OFFICER_ROLES,
  createCommander,
  makeAttributes,
  markFromPoints,
  markIndex,
  overseerLift,
  rightHandLift,
  seatPoints,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type AttributeName,
  type Attributes,
  type Base,
  type Commander,
  type OfficerRole,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import type { Repositories } from '../db/repos/index.js';
import { projectCrewOfficer } from './roster.js';
import {
  chairLinesFor,
  liftedOfficerSheet,
  liftedOverseerSheet,
  officerFitReader,
  officerLiftRoom,
} from './standing.js';

/**
 * The Overseer's grade lift on a real room (maintainer, 2026-10-04), with every other lift beside
 * it: the ground, the teachers, the Right Hand and the Lab.
 *
 * `passives.test.ts` pins `overseerLift` as a pure function and `lift.test.ts` pins `liftedSheet`.
 * This file pins what the two do once `officerLiftRoom` and `liftedOfficerSheet` wire them up: who
 * takes the grade lift, that nothing it does goes past 100 or eats the teachers' cap, that the
 * order officers are stored in changes no number, and that the mark on the card is the mark the
 * gates read.
 */

const NOW = new Date('2026-10-05T12:00:00.000Z');

function makeBase(commanders: Commander[]): Base {
  return {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'Test Hold',
    districtId: 'neon-docks',
    level: 1,
    isBot: false,
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
    economy: startingEconomy(NOW.toISOString()),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [],
    buildQueue: [],
    army: {},
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

/** Enough of the repos for `officerLiftRoom`: no held ground, and the Overseer when given one. */
function fakeRepos(overseer: Attributes | null): Repositories {
  return {
    city: { controls: () => new Map() },
    users: { findById: () => (overseer ? { id: 'user-1', overseerId: 'ov' } : undefined) },
    overseers: {
      findById: () =>
        overseer ? { id: 'ov', name: 'The Boss', attributes: overseer, perks: [] } : undefined,
    },
    factions: { membershipOf: () => undefined },
    sieges: { gate: () => undefined },
  } as unknown as Repositories;
}

/** A flat Overseer sheet whose grade is `mark`, found by walking the flat ratings. */
function overseerAt(mark: (typeof OFFICER_MARKS)[number]): Attributes {
  for (let rating = 0; rating <= 100; rating += 1) {
    const sheet = makeAttributes(rating);
    if (markFromPoints(seatPoints(sheet, 'overseer')) === mark) return sheet;
  }
  throw new Error(`no flat Overseer sheet grades ${mark}`);
}

/** The Overseer's grade lift, per grade: irreplaceable, then the first and second essential. */
const ROTATION: Readonly<Record<(typeof OFFICER_MARKS)[number], [number, number, number]>> = {
  'F-': [1, 0, 0],
  F: [1, 1, 0],
  'F+': [1, 1, 1],
  'E-': [2, 1, 1],
  E: [2, 2, 1],
  'E+': [2, 2, 2],
  'D-': [3, 2, 2],
  D: [3, 3, 2],
  'D+': [3, 3, 3],
  'C-': [4, 3, 3],
  C: [4, 4, 3],
  'C+': [4, 4, 4],
  'B-': [5, 4, 4],
  B: [5, 5, 4],
  'B+': [5, 5, 5],
  'A-': [6, 5, 5],
  A: [6, 6, 5],
  'A+': [6, 6, 6],
  'S-': [7, 6, 6],
  S: [7, 7, 6],
  'S+': [7, 7, 7],
};

describe("the Overseer's grade lift on a seated officer", () => {
  it('deals one point per grade step, irreplaceable then the essentials in turn, at every grade', () => {
    // A Researcher: analysis irreplaceable, intuition and encyclopedia essential.
    for (const id of ['r-0', 'r-1', 'r-2', 'r-3']) {
      const officer = createCommander(id, id, 'researcher', makeAttributes(40));
      // Which essential this officer takes first, read once off the F grade and held for the rest.
      const firstAtF = Object.keys(overseerLift(15, 'researcher', id)).find(
        (name) => name !== 'analysis',
      ) as AttributeName;
      const second: AttributeName = firstAtF === 'intuition' ? 'encyclopedia' : 'intuition';
      for (const mark of OFFICER_MARKS) {
        const base = makeBase([officer]);
        const room = officerLiftRoom(fakeRepos(overseerAt(mark)), base, NOW);
        expect(markFromPoints(room.overseerPoints ?? 0)).toBe(mark);
        const { attributes } = liftedOfficerSheet(officer, room);
        const [irreplaceable, first, last] = ROTATION[mark];
        expect(attributes.analysis - 40, `${id} ${mark} analysis`).toBe(irreplaceable);
        expect(attributes[firstAtF] - 40, `${id} ${mark} ${firstAtF}`).toBe(first);
        expect(attributes[second] - 40, `${id} ${mark} ${second}`).toBe(last);
        for (const name of ATTRIBUTE_NAMES) {
          if (name === 'analysis' || name === 'intuition' || name === 'encyclopedia') continue;
          expect(attributes[name], `${id} ${mark} ${name}`).toBe(40);
        }
      }
    }
  });

  it('lifts every seated officer on their own chair, and nobody on the bench', () => {
    const roster = [
      ...OFFICER_ROLES.map((role) => createCommander(`o-${role}`, role, role, makeAttributes(30))),
      createCommander('bench', 'bench', null, makeAttributes(30)),
    ];
    // The Right Hand is left out, so the grade lift is the only thing on anybody's sheet.
    const withoutRightHand = roster.filter((one) => one.role !== 'right_hand');
    const room = officerLiftRoom(fakeRepos(overseerAt('C+')), makeBase(withoutRightHand), NOW);
    for (const officer of withoutRightHand) {
      const lifted = liftedOfficerSheet(officer, room).attributes;
      const gained = ATTRIBUTE_NAMES.reduce((sum, name) => sum + lifted[name] - 30, 0);
      // C+ is the twelfth step: 4, 4 and 4, twelve points in all, on the seated only.
      expect(gained, officer.id).toBe(officer.role === null ? 0 : 12);
    }
  });

  it("never reaches the Overseer's own sheet", () => {
    const own = overseerAt('S+');
    const room = officerLiftRoom(fakeRepos(own), makeBase([]), NOW);
    expect(liftedOverseerSheet(own, room)).toEqual(own);
  });

  it('moves with the chair when an officer is reseated', () => {
    const asResearcher = createCommander('x', 'x', 'researcher', makeAttributes(40));
    const asTrader: Commander = { ...asResearcher, role: 'trader' };
    const repos = fakeRepos(overseerAt('F+'));
    const before = liftedOfficerSheet(
      asResearcher,
      officerLiftRoom(repos, makeBase([asResearcher]), NOW),
    );
    const after = liftedOfficerSheet(asTrader, officerLiftRoom(repos, makeBase([asTrader]), NOW));
    expect(before.attributes.analysis).toBe(41);
    expect(before.attributes.intuition).toBe(41);
    expect(before.attributes.encyclopedia).toBe(41);
    // Trader: negotiation irreplaceable, charisma and analysis essential. Nothing stays behind.
    expect(after.attributes.negotiation).toBe(41);
    expect(after.attributes.charisma).toBe(41);
    expect(after.attributes.analysis).toBe(41);
    expect(after.attributes.intuition).toBe(40);
    expect(after.attributes.encyclopedia).toBe(40);
  });
});

describe('the cap on lifts, and the top of the scale', () => {
  // Three War College teachers (+5 mental each, 15 nominal) and a perfect Right Hand (+5 on all).
  const teachers = ['t1', 't2', 't3'].map((id) => ({
    ...createCommander(id, id, 'veteran', makeAttributes(40)),
    role: (['veteran', 'trader', 'fixer'] as const)[Number(id.slice(1)) - 1]!,
    perks: ['war_college'],
  }));
  const rightHand = createCommander('rh', 'rh', 'right_hand', makeAttributes(100));

  it('caps everybody but the Overseer at ten together, and pays the Overseer on top', () => {
    const officer = createCommander('r', 'r', 'researcher', makeAttributes(40));
    const base = makeBase([officer, ...teachers, rightHand]);
    const room = officerLiftRoom(fakeRepos(overseerAt('S+')), base, NOW);
    const { attributes, lift } = liftedOfficerSheet(officer, room);
    expect(MAX_OFFICER_LIFT).toBe(10);
    expect(ATTRIBUTES_BY_GROUP.mental).toContain('analysis');
    // Irreplaceable, mental: 7 from the grade, then the cap's 10 out of the 20 offered.
    expect(attributes.analysis).toBe(40 + 7 + 10);
    // Mental, untagged for a Researcher's grade lift: the cap alone.
    expect(attributes.logic).toBe(40 + 10);
    // Physical: the Right Hand's 5 and nothing else.
    expect(attributes.strength).toBe(40 + MAX_RIGHT_HAND_LIFT);
    // Every receipt line but the grade's adds up to no more than the cap, per attribute.
    for (const name of ATTRIBUTE_NAMES) {
      const capped = lift
        .filter((line) => line.attribute === name && !line.from.endsWith("'s grade"))
        .reduce((sum, line) => sum + line.amount, 0);
      expect(capped, name).toBeLessThanOrEqual(MAX_OFFICER_LIFT);
    }
  });

  it('never lifts anything past 100', () => {
    for (const rating of [90, 95, 99, 100]) {
      const officer = createCommander('r', 'r', 'researcher', makeAttributes(rating));
      const base = makeBase([officer, ...teachers, rightHand]);
      const room = officerLiftRoom(fakeRepos(makeAttributes(100)), base, NOW);
      const { attributes, lift } = liftedOfficerSheet(officer, room);
      for (const name of ATTRIBUTE_NAMES) expect(attributes[name], name).toBeLessThanOrEqual(100);
      expect(attributes.analysis).toBe(100);
      expect(attributes.strength).toBe(Math.min(100, rating + MAX_RIGHT_HAND_LIFT));
      for (const line of lift) expect(line.amount).toBeGreaterThan(0);
    }
  });
});

describe('the order officers are stored in', () => {
  const roster: Commander[] = [
    createCommander('a', 'a', 'researcher', makeAttributes(35, { strategy: 60 })),
    { ...createCommander('b', 'b', 'trader', makeAttributes(45)), perks: ['war_college'] },
    { ...createCommander('c', 'c', 'fixer', makeAttributes(50)), perks: ['masters_table'] },
    { ...createCommander('d', 'd', 'veteran', makeAttributes(30)), perks: ['case_reader'] },
    createCommander('e', 'e', 'right_hand', makeAttributes(70)),
  ];

  function permutations<T>(items: readonly T[]): T[][] {
    if (items.length <= 1) return [[...items]];
    return items.flatMap((item, index) =>
      permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
        item,
        ...rest,
      ]),
    );
  }

  it('changes no lifted sheet and no mark', () => {
    const repos = fakeRepos(overseerAt('B'));
    const sheetsOf = (order: Commander[]) => {
      const base = makeBase(order);
      const room = officerLiftRoom(repos, base, NOW);
      const fit = officerFitReader(repos, base, NOW);
      return Object.fromEntries(
        order.map((officer) => [
          officer.id,
          {
            sheet: liftedOfficerSheet(officer, room).attributes,
            mark: fit.markFor(officer.role as OfficerRole),
          },
        ]),
      );
    };
    const reference = sheetsOf(roster);
    for (const order of permutations(roster)) expect(sheetsOf(order)).toEqual(reference);
  });
});

describe('the Right Hand', () => {
  it('lifts everybody but themselves, sized off their printed sheet', () => {
    const rightHand = createCommander('rh', 'rh', 'right_hand', makeAttributes(55));
    const peer = createCommander('p', 'p', 'trader', makeAttributes(40));
    const base = makeBase([rightHand, peer]);
    const room = officerLiftRoom(fakeRepos(overseerAt('S+')), base, NOW);
    const printed = seatPoints(rightHand.attributes, 'right_hand');
    const lifted = liftedOfficerSheet(rightHand, room);
    // The S+ grade lift is on their sheet, and the room still reads the printed one.
    expect(lifted.attributes.authority).toBe(55 + 7);
    expect(seatPoints(lifted.attributes, 'right_hand')).toBeGreaterThan(printed);
    expect(room.rightHand?.points).toBe(printed);
    // None of their own lift lands on them: only the grade's lines are on their receipt.
    expect(lifted.lift.every((line) => line.from === "The Boss's grade")).toBe(true);
    // A peer takes the printed sheet's lift, rounded onto a whole point.
    const flat = rightHandLift(printed, MAX_RIGHT_HAND_LIFT);
    const peerSheet = liftedOfficerSheet(peer, room).attributes;
    expect(peerSheet.strength).toBe(40 + Math.round(flat));
  });

  it('lifts the Overseer, and only by the Overseer ceiling', () => {
    const rightHand = createCommander('rh', 'rh', 'right_hand', makeAttributes(100));
    const own = makeAttributes(40);
    const room = officerLiftRoom(fakeRepos(own), makeBase([rightHand]), NOW);
    expect(liftedOverseerSheet(own, room)).toEqual(makeAttributes(40 + MAX_OVERSEER_LIFT));
    expect(room.overseerPoints).toBe(
      seatPoints(makeAttributes(40 + MAX_OVERSEER_LIFT), 'overseer'),
    );
  });

  it('lifts nobody, the Overseer included, in the first six hours of the chair', () => {
    const rightHand: Commander = {
      ...createCommander('rh', 'rh', 'right_hand', makeAttributes(100)),
      seatedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    };
    const peer = createCommander('p', 'p', 'trader', makeAttributes(40));
    const own = makeAttributes(40);
    const room = officerLiftRoom(fakeRepos(own), makeBase([rightHand, peer]), NOW);
    expect(room.rightHand).toBeNull();
    expect(liftedOverseerSheet(own, room)).toEqual(own);
    expect(liftedOfficerSheet(peer, room).attributes.strength).toBe(40);
  });
});

describe('one grade per officer', () => {
  it('prints on the card the grade every gate reads, for every working chair', () => {
    const roster: Commander[] = OFFICER_ROLES.map((role, index) => ({
      ...createCommander(`o-${role}`, role, role, makeAttributes(20 + index * 5)),
      perks: index % 4 === 0 ? ['war_college'] : index % 4 === 1 ? ['the_connector'] : [],
    }));
    const repos = fakeRepos(overseerAt('A-'));
    const base = makeBase(roster);
    const room = officerLiftRoom(repos, base, NOW);
    const fit = officerFitReader(repos, base, NOW);
    const lines = chairLinesFor(repos, base, NOW, {
      researchAddsPercent: null,
      marketRates: { worth: 1, markup: 1 },
    }).chairs;
    for (const officer of roster) {
      const role = officer.role as OfficerRole;
      const card = projectCrewOfficer(officer, liftedOfficerSheet(officer, room), undefined, NOW);
      expect(card.mark, role).toBe(fit.markFor(role));
      expect(lines.find((line) => line.role === role)?.mark, role).toBe(card.mark);
      expect(markIndex(card.mark!)).toBeGreaterThanOrEqual(0);
    }
  });
});
