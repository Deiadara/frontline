import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_NAMES,
  MAX_ATTRIBUTE,
  makeAttributes,
  type AttributeName,
  type Attributes,
} from '../attributes.js';
import { AttributesSchema } from '../attributes.js';
import { noTerritoryEffects } from '../city/index.js';
import {
  ATTRIBUTE_EFFECTS,
  EFFECT_CHANNELS,
  attributesDriving,
  combineEffects,
  contributionOf,
  crewEffects,
  crewSheet,
  effectsOfSheet,
  noCrewEffects,
  speedMultiplier,
  peakUplift,
  IMPORTANCE_SHARE,
  type CrewMember,
} from './effects.js';
import { findPerk } from './perks.js';
import { importanceOf } from './importance.js';
import type { OfficerRole } from '../roles.js';
import {
  OVERSEER_SUBJECT,
  TRAINABLE_ATTRIBUTES,
  TRAINING_DRILLS,
  TRAINING_HALF_GAIN_FROM,
  TRAINING_SECONDS,
  TRAININGS_PER_DAY,
  applyGain,
  beginTraining,
  drillProgressAt,
  drillRemainingMs,
  rollDay,
  sessionFor,
  settleTraining,
  startingTraining,
  trainingBlocker,
  trainingsLeft,
  type TrainingSession,
  type TrainingState,
} from './training.js';

const NOW = '2026-08-16T09:00:00.000Z';
const later = (seconds: number): string => new Date(Date.parse(NOW) + seconds * 1000).toISOString();

describe('what a crew is worth', () => {
  it('gives every attribute somewhere to land', () => {
    for (const name of ATTRIBUTE_NAMES) {
      expect(ATTRIBUTE_EFFECTS[name], name).toBeDefined();
      expect(EFFECT_CHANNELS, name).toContain(ATTRIBUTE_EFFECTS[name].channel);
    }
  });

  /**
   * Every channel is driven by something.
   *
   * A channel nobody drives is a lever the game reads and no player can ever move: the exact
   * failure this whole module exists to end, reintroduced one field at a time.
   */
  it('leaves no channel without a driver', () => {
    for (const channel of EFFECT_CHANNELS) {
      expect(attributesDriving(channel), channel).not.toHaveLength(0);
    }
  });

  it('says something specific about each attribute rather than restating the number', () => {
    for (const name of ATTRIBUTE_NAMES) {
      const summary = ATTRIBUTE_EFFECTS[name].summary;
      expect(summary.length, name).toBeGreaterThan(30);
      expect(summary, name).not.toMatch(/%/);
    }
  });

  it('is worth nothing at zero and something real at the ceiling', () => {
    expect(effectsOfSheet(makeAttributes(0))).toEqual(noCrewEffects());
    const maxed = effectsOfSheet(makeAttributes(MAX_ATTRIBUTE));
    for (const channel of EFFECT_CHANNELS) {
      expect(maxed[channel], channel).toBeGreaterThan(0);
    }
  });

  /** A channel two attributes drive is worth twice as much as one only one drives. */
  it('adds up the attributes sharing a channel', () => {
    const sheet = makeAttributes(40);
    const effects = effectsOfSheet(sheet);
    for (const channel of EFFECT_CHANNELS) {
      expect(effects[channel], channel).toBe(
        attributesDriving(channel).length * contributionOf(40),
      );
    }
  });

  describe('best-of across the room', () => {
    /** The player. No seat, so everything they know is available all the time. */
    const overseer = (over: Partial<Attributes> = {}, base = 10): CrewMember => ({
      attributes: makeAttributes(base, over),
      role: null,
      perks: [],
    });
    /*
     * An officer in a real chair.
     *
     * These used to spell their duties out inline, because which skills a seat used was a
     * server-side table this package could not reach. `ROLE_IMPORTANCE` is public now (the board's
     * call: the sheet draws it as coloured borders), so the tests name the chair and read the same
     * table the game does, which is the version that fails when the table changes.
     */
    const officer = (role: OfficerRole, over: Partial<Attributes> = {}, base = 10): CrewMember => ({
      attributes: makeAttributes(base, over),
      role,
      perks: [],
    });

    /**
     * What one rating is worth in one chair, uplift and all: the rule, restated for the reader.
     *
     * Rounded, because `crewSheet` rounds: the sheet is an `Attributes` and that is integers.
     */
    const worth = (member: CrewMember, name: AttributeName): number =>
      Math.round(
        member.attributes[name] *
          IMPORTANCE_SHARE[importanceOf(member.role as OfficerRole, name)] *
          peakUplift(member),
      );

    it('takes the highest rating anybody has, attribute by attribute', () => {
      const engineer = officer('lead_engineer', { engineering: 70 });
      const spy = officer('head_spy', { stealth: 65 });
      const sheet = crewSheet([engineer, spy]);
      // Engineering is the Lead Engineer's irreplaceable skill and Stealth is the Head Spy's, so
      // each is paid in full, lifted by whatever their peaks are worth.
      expect(sheet.engineering).toBeCloseTo(worth(engineer, 'engineering'), 5);
      expect(sheet.stealth).toBeCloseTo(worth(spy, 'stealth'), 5);
      // Neither chair rates Medicine at all, so the best on offer is a quarter of somebody's 10.
      expect(sheet.medicine).toBeCloseTo(
        Math.max(worth(engineer, 'medicine'), worth(spy, 'medicine')),
        5,
      );
      expect(sheet.medicine).toBeLessThan(10);
    });

    /**
     * Hiring somebody can never make the crew worse.
     *
     * The reason best-of was chosen over a mean, stated as a property: a mean punishes a player
     * for hiring a specialist, and a game where the correct move is to hire nobody has no Bar.
     */
    it('never drops a channel when another person joins', () => {
      const before = crewEffects([overseer({}, 30)]);
      const after = crewEffects([overseer({}, 30), officer('head_spy', { hacking: 80 }, 4)]);
      for (const channel of EFFECT_CHANNELS) {
        expect(after[channel], channel).toBeGreaterThanOrEqual(before[channel]);
      }
    });

    it('counts the Overseer as one of the people in the room', () => {
      const alone = crewEffects([overseer({ cryptography: 90 })]);
      const hired = crewEffects([overseer(), officer('head_spy', { cryptography: 90 })]);
      expect(alone.intelResistancePercent).toBeGreaterThanOrEqual(hired.intelResistancePercent);
    });

    /**
     * §C2: the seat is half the hire.
     *
     * The rule the whole assignment layer stands on: the same person, hired at the same wage, is
     * worth their full Cryptography in a seat that reads cipher traffic and a third of it in one
     * that kicks doors. Before this, the two were numerically identical and the §G screen changed
     * nothing at all.
     */
    it('pays a person their full rating only in the job they are actually doing', () => {
      // The Head Spy rates Cryptography as useful; the Raid Boss does not rate it at all.
      const rightChair = officer('head_spy', { cryptography: 90 });
      const wrongChair = officer('raid_boss', { cryptography: 90 });
      const onDuty = crewSheet([rightChair]);
      const off = crewSheet([wrongChair]);
      expect(onDuty.cryptography).toBeCloseTo(worth(rightChair, 'cryptography'), 5);
      expect(off.cryptography).toBeCloseTo(worth(wrongChair, 'cryptography'), 5);
      expect(off.cryptography).toBeLessThan(onDuty.cryptography);
    });

    /** And it is a real ordering, not a rounding: the right ordinary person beats the wrong star. */
    it('lets an ordinary officer in the right seat beat a brilliant one in the wrong seat', () => {
      const star = crewSheet([officer('raid_boss', { stealth: 95 })]);
      const journeyman = crewSheet([officer('head_spy', { stealth: 50 })]);
      expect(journeyman.stealth).toBeGreaterThan(star.stealth);
    });

    /** The Overseer is exempt, and that is the point of being the one who is not an employee. */
    it('never discounts the Overseer, whatever the attribute', () => {
      const sheet = crewSheet([overseer({ demolition: 80 })]);
      expect(sheet.demolition).toBe(80);
    });
  });

  describe('territory and crew together', () => {
    it('adds the two rather than multiplying them', () => {
      const territory = { ...noTerritoryEffects(), defensePercent: 20 };
      const crew = { ...noCrewEffects(), defensePercent: 20 };
      expect(combineEffects(territory, crew).defensePercent).toBe(40);
    });

    it('keeps the crew-only channels the territory has never heard of', () => {
      const crew = { ...noCrewEffects(), intelResistancePercent: 17 };
      expect(combineEffects(noTerritoryEffects(), crew).intelResistancePercent).toBe(17);
    });

    it('sums the hourly yield rather than dropping one side of it', () => {
      const territory = { ...noTerritoryEffects(), perHour: { scrap: 10, oil: 2 } };
      const crew = { ...noCrewEffects(), perHour: { scrap: 5 } };
      expect(combineEffects(territory, crew).perHour).toEqual({ scrap: 15, oil: 2 });
    });
  });

  it('never lets a stack of penalties take an output to zero', () => {
    expect(speedMultiplier(-500)).toBe(0.25);
    expect(speedMultiplier(0)).toBe(1);
    expect(speedMultiplier(20)).toBeCloseTo(1.2);
  });
});

/**
 * Perks (§B7): what an officer brings, as opposed to what they are rated at.
 *
 * The two halves of `crewEffects` compose differently on purpose, and that is the whole design of
 * the hiring layer. An attribute is **best-of**: one specialist is enough, so a second cryptographer
 * adds nothing and the interesting question is "who is your best X". A perk **sums**: it is a thing
 * a person brought with them, so two officers who each know a foundry manager know two of them, and
 * filling nineteen chairs is worth the wage bill.
 *
 * Getting that backwards in either direction breaks something real. Best-of perks would make the
 * roster a search for one good hire and the other eighteen chairs decoration; summed attributes
 * would make hiring anybody strictly better and turn the sheet into a headcount.
 */
describe('what an officer brings (§B7)', () => {
  const plain = (perks: string[] = []): CrewMember => ({
    attributes: makeAttributes(10),
    role: null,
    perks,
  });

  it('lands a perk on the channel it names', () => {
    const withPerk = crewEffects([plain(['drill_sergeant'])]);
    const without = crewEffects([plain()]);
    const perk = findPerk('drill_sergeant');
    expect(perk?.bonus).toEqual({ kind: 'unit_offense', percent: 4 });
    expect(withPerk.unitOffensePercent - without.unitOffensePercent).toBe(4);
  });

  it('adds up across the roster rather than taking the best of them', () => {
    const one = crewEffects([plain(['drill_sergeant'])]);
    const three = crewEffects([
      plain(['drill_sergeant']),
      plain(['drill_sergeant']),
      plain(['drill_sergeant']),
    ]);
    const base = crewEffects([plain()]).unitOffensePercent;
    expect(one.unitOffensePercent - base).toBe(4);
    expect(
      three.unitOffensePercent - base,
      'perks are what a person brought, so three of them are three',
    ).toBe(12);
  });

  it('reaches the crew-only channels no location can grant', () => {
    const clerk = crewEffects([plain(['payroll_clerk'])]);
    expect(clerk.wageDiscountPercent).toBeGreaterThan(crewEffects([plain()]).wageDiscountPercent);
    const ledger = crewEffects([plain(['ledger_hand'])]);
    expect(ledger.payrollStepDiscountPercent).toBe(5);
  });

  it('scopes a tier-scoped bonus to that tier and no other', () => {
    const effects = crewEffects([plain(['ironmonger'])]);
    expect(effects.unitTierPercent.heavy?.armor).toBe(3);
    expect(effects.unitTierPercent.rabble?.armor).toBeUndefined();
    // And the global armour channel is untouched: a tier bonus is not a quiet global one.
    expect(effects.unitArmorPercent).toBe(0);
  });

  it('ignores an id the catalogue no longer carries instead of throwing', () => {
    expect(() => crewEffects([plain(['a_perk_that_was_retired'])])).not.toThrow();
    expect(crewEffects([plain(['a_perk_that_was_retired'])])).toEqual(crewEffects([plain()]));
  });

  it('leaves the attribute half of the sheet alone', () => {
    // The hazard the trait system had: a keyword that moved the carrier's own attributes made a
    // stored sheet ambiguous about whether the bonus was already in it. A perk cannot, because it
    // never touches the sheet at all.
    const sheet = makeAttributes(10);
    expect(crewSheet([{ attributes: sheet, role: null, perks: ['hard_trainer'] }])).toEqual(
      crewSheet([{ attributes: sheet, role: null, perks: [] }]),
    );
  });
});

describe('drilling', () => {
  const sheet = makeAttributes(20);
  const session = (over: Partial<TrainingSession> = {}): TrainingSession => ({
    id: 'session-1',
    subjectId: OVERSEER_SUBJECT,
    attribute: 'stamina',
    startedAt: NOW,
    durationSeconds: TRAINING_SECONDS,
    ...over,
  });

  it('opens with the whole allowance and nothing on the board', () => {
    const state = startingTraining(NOW);
    expect(trainingsLeft(state, NOW)).toBe(TRAININGS_PER_DAY);
    expect(state.sessions).toHaveLength(0);
  });

  it('spends one session per start', () => {
    const state = beginTraining(startingTraining(NOW), session(), NOW);
    expect(trainingsLeft(state, NOW)).toBe(TRAININGS_PER_DAY - 1);
    expect(sessionFor(state, OVERSEER_SUBJECT)).toBeDefined();
  });

  it('refuses a sixth session in one day', () => {
    let state = startingTraining(NOW);
    const names: AttributeName[] = ['stamina', 'strength', 'stamina', 'strength', 'stamina'];
    names.forEach((attribute, index) => {
      state = beginTraining(
        state,
        session({ id: `s${index}`, subjectId: `officer-${index}`, attribute }),
        NOW,
      );
    });
    expect(trainingsLeft(state, NOW)).toBe(0);
    expect(trainingBlocker(state, 'officer-9', 'logic', sheet, NOW)).toBe('No sessions left today');
  });

  it('hands the allowance back when the day rolls, and does not bank it', () => {
    let state = startingTraining(NOW);
    state = beginTraining(state, session(), NOW);
    const tomorrow = '2026-08-17T01:00:00.000Z';
    expect(trainingsLeft(state, tomorrow)).toBe(TRAININGS_PER_DAY);
    expect(rollDay(state, tomorrow).used).toBe(0);
  });

  describe('the no-repeat rule', () => {
    it('refuses the same attribute twice running for the same person', () => {
      const state = beginTraining(startingTraining(NOW), session(), NOW);
      const settled = settleTraining(state, later(TRAINING_SECONDS)).state;
      expect(trainingBlocker(settled, OVERSEER_SUBJECT, 'stamina', sheet, NOW)).toBe(
        'Trained that last time',
      );
    });

    it('allows it again once something else has been done in between', () => {
      let state = beginTraining(startingTraining(NOW), session(), NOW);
      state = settleTraining(state, later(TRAINING_SECONDS)).state;
      state = beginTraining(state, session({ id: 's2', attribute: 'logic' }), NOW);
      state = settleTraining(state, later(TRAINING_SECONDS * 2)).state;
      expect(trainingBlocker(state, OVERSEER_SUBJECT, 'stamina', sheet, NOW)).toBeNull();
    });

    /** Per person. One officer's drill must not lock the same drill out for everybody else. */
    it("does not spread one person's last drill across the crew", () => {
      const state = beginTraining(startingTraining(NOW), session(), NOW);
      expect(trainingBlocker(state, 'officer-1', 'stamina', sheet, NOW)).toBeNull();
    });
  });

  it('lets one person do only one thing at a time', () => {
    const state = beginTraining(startingTraining(NOW), session(), NOW);
    expect(trainingBlocker(state, OVERSEER_SUBJECT, 'logic', sheet, NOW)).toBe(
      'Already in a session',
    );
  });

  it('has nothing to teach an attribute already at the ceiling', () => {
    const maxed = makeAttributes(20, { logic: MAX_ATTRIBUTE });
    expect(trainingBlocker(startingTraining(NOW), OVERSEER_SUBJECT, 'logic', maxed, NOW)).toBe(
      'Nothing left to learn here',
    );
  });

  describe('settling', () => {
    it('pays nothing out before the hour is up', () => {
      const state = beginTraining(startingTraining(NOW), session(), NOW);
      const { gains, state: after } = settleTraining(state, later(TRAINING_SECONDS - 1));
      expect(gains).toHaveLength(0);
      expect(after.sessions).toHaveLength(1);
    });

    it('pays the gain out once and takes the session off the board', () => {
      const state = beginTraining(startingTraining(NOW), session(), NOW);
      const first = settleTraining(state, later(TRAINING_SECONDS));
      expect(first.gains).toEqual([{ subjectId: OVERSEER_SUBJECT, attribute: 'stamina' }]);
      expect(settleTraining(first.state, later(TRAINING_SECONDS * 10)).gains).toHaveLength(0);
    });

    /**
     * A session is worth two points in the first half of a skill and one in the second.
     *
     * The back half of a skill is meant to cost more, so five hours a day buys less the further a
     * character is already taken. All three cases are pinned, including the boundary: 49 is still
     * the cheap side and 50 is not, and an off-by-one there is a rule that reads as working.
     */
    it('pays two points below the halfway mark and one at or above it, clamped at the ceiling', () => {
      const gain = { subjectId: OVERSEER_SUBJECT, attribute: 'logic' as const };
      expect(applyGain(makeAttributes(20), gain).logic).toBe(22);
      expect(applyGain(makeAttributes(20, { logic: 49 }), gain).logic).toBe(51);
      expect(applyGain(makeAttributes(20, { logic: TRAINING_HALF_GAIN_FROM }), gain).logic).toBe(
        TRAINING_HALF_GAIN_FROM + 1,
      );
      expect(applyGain(makeAttributes(20, { logic: 80 }), gain).logic).toBe(81);
      expect(applyGain(makeAttributes(20, { logic: MAX_ATTRIBUTE }), gain).logic).toBe(
        MAX_ATTRIBUTE,
      );
    });

    it('still rolls the day when nothing finished', () => {
      const state = beginTraining(startingTraining(NOW), session(), NOW);
      expect(settleTraining(state, '2026-08-18T00:00:00.000Z').state.used).toBe(0);
    });
  });

  it('reads a progress bar off the clock', () => {
    const one = session();
    const half = Date.parse(NOW) + (TRAINING_SECONDS * 1000) / 2;
    expect(drillProgressAt(one, half)).toBeCloseTo(0.5);
    expect(drillRemainingMs(one, half)).toBe((TRAINING_SECONDS * 1000) / 2);
    expect(drillRemainingMs(one, Date.parse(NOW) + TRAINING_SECONDS * 5000)).toBe(0);
  });

  describe('the drills themselves', () => {
    it('names one for every attribute a player can pick', () => {
      expect(TRAINABLE_ATTRIBUTES).toEqual(ATTRIBUTE_NAMES);
      for (const name of ATTRIBUTE_NAMES) {
        expect(TRAINING_DRILLS[name], name).toBeDefined();
      }
    });

    /** Thirty-five of them exist so the tab does not repeat itself. Duplicates undo that. */
    it('gives no two attributes the same drill', () => {
      const titles = ATTRIBUTE_NAMES.map((name) => TRAINING_DRILLS[name].title);
      expect(new Set(titles).size).toBe(titles.length);
      const details = ATTRIBUTE_NAMES.map((name) => TRAINING_DRILLS[name].detail);
      expect(new Set(details).size).toBe(details.length);
    });

    it('keeps every title short enough to sit on a card', () => {
      for (const name of ATTRIBUTE_NAMES) {
        expect(TRAINING_DRILLS[name].title.length, name).toBeLessThanOrEqual(24);
        expect(TRAINING_DRILLS[name].detail.length, name).toBeGreaterThan(20);
      }
    });
  });
});

describe('a training state parses back out of storage', () => {
  it('survives a round trip through JSON', () => {
    const state: TrainingState = beginTraining(
      startingTraining(NOW),
      {
        id: 'x',
        subjectId: 'officer-3',
        attribute: 'cryptography',
        startedAt: NOW,
        durationSeconds: TRAINING_SECONDS,
      },
      NOW,
    );
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

/**
 * The sheet best-of hands back is an `Attributes`, and that type is integers 0..100.
 *
 * It goes on the wire as part of `crewStanding`, where `AttributesSchema` rejects a non-integer,
 * and the failure has no symptom a developer would recognise: the client's query never resolves
 * and the Overseer's own file sits on "Reading the file…" with nothing in the console. The shares
 * and the peak uplift are both fractional multipliers, so this is not a theoretical concern.
 */
describe('the sheet best-of hands back', () => {
  const everyone: CrewMember[] = [
    { attributes: makeAttributes(37, { stealth: 91, deception: 63 }), role: 'head_spy', perks: [] },
    { attributes: makeAttributes(29, { medicine: 88 }), role: 'chief_medic', perks: [] },
    { attributes: makeAttributes(41, { intimidation: 77 }), role: 'raid_boss', perks: [] },
    { attributes: makeAttributes(23), role: null, perks: [] },
  ];

  it('is a whole number in every attribute, and inside the scale', () => {
    const sheet = crewSheet(everyone);
    for (const name of ATTRIBUTE_NAMES) {
      expect(Number.isInteger(sheet[name]), `${name} = ${sheet[name]}`).toBe(true);
      expect(sheet[name], name).toBeGreaterThanOrEqual(0);
      expect(sheet[name], name).toBeLessThanOrEqual(MAX_ATTRIBUTE);
    }
  });

  /** And the schema agrees, which is the thing that actually broke. */
  it('parses as the schema the wire uses', () => {
    expect(AttributesSchema.safeParse(crewSheet(everyone)).success).toBe(true);
  });
});
