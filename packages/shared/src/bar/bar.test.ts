import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_NAMES,
  MAX_ATTRIBUTE,
  makeAttributes,
  type AttributeName,
} from '../attributes.js';
import { PAY_WEEK_MS, proratedFirstWage, startOfPayWeek } from '../economy/payroll.js';
import { LIVE_REPUTATION_LABELS, REPUTATION_LABELS } from '../economy/reputation.js';
import {
  INSULT_FRACTION,
  MAX_PATIENCE,
  MIN_PATIENCE,
  NEGOTIATION_MOODS,
  negotiate,
  negotiationLine,
  negotiationTemper,
  openNegotiation,
  type Negotiation,
} from './negotiation.js';
import {
  ALIGNMENT_BANDS,
  ALIGNMENT_BONUS_ATTRIBUTES,
  ALIGNMENT_BONUS_THRESHOLD,
  ALIGNMENT_HALF_LIFE_MS,
  ALIGNMENT_LEAVE_THRESHOLD,
  ALIGNMENT_MAX,
  ALIGNMENT_MIN,
  ALIGNMENT_PER_STANCE,
  ALIGNMENT_START,
  AMBITIONS,
  MORAL_COMPASSES,
  STANCE_MAX,
  STANCE_MIN,
  alignedAttributes,
  alignmentBand,
  alignmentBonusAttributes,
  alignmentSkillBonus,
  alignmentTarget,
  reputationStance,
  settleAlignment,
  threatensToLeave,
  type Ambition,
  type Disposition,
  type MoralCompass,
} from './disposition.js';
import { JOIN_REFUSAL_STANCE, assessJoin } from './join.js';
import {
  CHARACTER_LEVEL_AUTO_POINTS,
  CHARACTER_LEVEL_MIN,
  CHARACTER_LEVEL_PLAYER_POINTS,
  CHARACTER_LEVEL_POINTS,
  applyCharacterXp,
  autoAllocatedAttributes,
  characterXpToNextLevel,
  spendCharacterPoint,
} from './level.js';
import { WAGE_RESERVATION_FRACTION, askingWage, negotiateWage, reservationWage } from './wage.js';

const EVERY_DISPOSITION: Disposition[] = AMBITIONS.flatMap((ambition) =>
  MORAL_COMPASSES.map((moralCompass) => ({ ambition, moralCompass })),
);

describe('§H4 — reading the crew off its reputation word', () => {
  it('never scores outside the stance band, for any character against any word', () => {
    for (const disposition of EVERY_DISPOSITION) {
      for (const reputation of REPUTATION_LABELS) {
        const stance = reputationStance(disposition, reputation);
        expect(stance).toBeGreaterThanOrEqual(STANCE_MIN);
        expect(stance).toBeLessThanOrEqual(STANCE_MAX);
        expect(Number.isInteger(stance)).toBe(true);
      }
    }
  });

  it('reads the same word differently depending on who is reading it', () => {
    // The whole point of §H4: identical crew, opposite answers.
    expect(reputationStance({ ambition: 'notoriety', moralCompass: 'ruthless' }, 'Feared')).toBe(2);
    expect(reputationStance({ ambition: 'knowledge', moralCompass: 'ruthless' }, 'Cautious')).toBe(
      0,
    );
    expect(
      reputationStance({ ambition: 'knowledge', moralCompass: 'pragmatist' }, 'Reckless'),
    ).toBe(-2);
  });

  it('spreads over every label a live mechanic can currently produce', () => {
    // A table that scored 0 everywhere would pass the band check above and mean nothing. Each
    // reachable word has to move *somebody*, in both directions. Read off
    // `LIVE_REPUTATION_LABELS` rather than listed, so a label a later mechanic makes reachable is
    // covered on the day it lands instead of quietly dropping out of this check.
    expect(LIVE_REPUTATION_LABELS.length).toBeGreaterThan(0);
    for (const reputation of LIVE_REPUTATION_LABELS) {
      const stances = EVERY_DISPOSITION.map((d) => reputationStance(d, reputation));
      expect(Math.max(...stances), `nobody is drawn to a ${reputation} crew`).toBeGreaterThan(0);
      expect(Math.min(...stances), `nobody objects to a ${reputation} crew`).toBeLessThan(0);
    }
  });
});

describe('§H3 + §H4 — who will talk to you', () => {
  const anyone: Disposition = { ambition: 'wealth', moralCompass: 'pragmatist' };

  it('shuts the door on a crew below the infamy the character demands (§H3)', () => {
    const gated = assessJoin(anyone, { minInfamy: 40 }, { infamy: 39, reputation: 'Cautious' });
    expect(gated.meetsRequirement).toBe(false);
    expect(gated.interested).toBe(false);
    expect(gated.blockers).toContain('infamy');

    const cleared = assessJoin(anyone, { minInfamy: 40 }, { infamy: 40, reputation: 'Cautious' });
    expect(cleared.meetsRequirement).toBe(true);
    expect(cleared.interested).toBe(true);
    expect(cleared.blockers).toEqual([]);
  });

  it('refuses on reputation alone, with every number in order (§H4)', () => {
    // Ambition and compass both against you: a crew that clears the §H3 gate outright and is still
    // turned down. This is the case a purely numeric gate cannot express.
    const hostile: Disposition = { ambition: 'knowledge', moralCompass: 'pragmatist' };
    const assessment = assessJoin(
      hostile,
      { minInfamy: 0 },
      { infamy: 100, reputation: 'Reckless' },
    );
    expect(assessment.meetsRequirement).toBe(true);
    expect(assessment.stance).toBe(JOIN_REFUSAL_STANCE);
    expect(assessment.interested).toBe(false);
    expect(assessment.blockers).toEqual(['reputation']);
  });

  it('reports both gates when both are shut', () => {
    const hostile: Disposition = { ambition: 'knowledge', moralCompass: 'pragmatist' };
    expect(
      assessJoin(hostile, { minInfamy: 50 }, { infamy: 0, reputation: 'Reckless' }).blockers,
    ).toEqual(['infamy', 'reputation']);
  });

  it('lets a single objection through — refusal takes both halves of §H4', () => {
    const half: Disposition = { ambition: 'knowledge', moralCompass: 'idealist' };
    const assessment = assessJoin(half, { minInfamy: 0 }, { infamy: 0, reputation: 'Reckless' });
    expect(assessment.stance).toBe(-1);
    expect(assessment.interested).toBe(true);
  });
});

describe('§H5 — the alignment meter', () => {
  it('threatens to leave at the low threshold and not one point above it', () => {
    expect(threatensToLeave(ALIGNMENT_LEAVE_THRESHOLD)).toBe(true);
    expect(alignmentBand(ALIGNMENT_LEAVE_THRESHOLD)).toBe('leaving');
    expect(threatensToLeave(ALIGNMENT_LEAVE_THRESHOLD + 1)).toBe(false);
    expect(alignmentBand(ALIGNMENT_LEAVE_THRESHOLD + 1)).toBe('unsettled');
    expect(threatensToLeave(ALIGNMENT_START)).toBe(false);
  });

  it('pays no bonus below the threshold and a growing one above it', () => {
    expect(alignmentSkillBonus(ALIGNMENT_BONUS_THRESHOLD - 1)).toBe(0);
    expect(alignmentSkillBonus(ALIGNMENT_BONUS_THRESHOLD)).toBe(0);
    expect(alignmentSkillBonus(90)).toBe(3);
    expect(alignmentSkillBonus(ALIGNMENT_MAX)).toBe(5);
  });

  it('lands the bonus on the few attributes they are already best at, and nowhere else', () => {
    const attributes = makeAttributes(20, { stealth: 38, logic: 34, hacking: 30, medicine: 8 });
    const best = alignmentBonusAttributes(attributes);
    expect(best).toEqual(['stealth', 'logic', 'hacking']);
    expect(best).toHaveLength(ALIGNMENT_BONUS_ATTRIBUTES);

    const boosted = alignedAttributes(attributes, ALIGNMENT_MAX);
    expect(boosted.stealth).toBe(43);
    expect(boosted.logic).toBe(39);
    expect(boosted.hacking).toBe(35);
    // "Some skills", not the sheet: everything else is untouched.
    const untouched = ATTRIBUTE_NAMES.filter((name) => !best.includes(name));
    for (const name of untouched) expect(boosted[name]).toBe(attributes[name]);
  });

  it('leaves the sheet alone below the bonus threshold, and never mutates the input', () => {
    const attributes = makeAttributes(20, { stealth: 38 });
    const before = { ...attributes };
    expect(alignedAttributes(attributes, ALIGNMENT_LEAVE_THRESHOLD)).toEqual(attributes);
    alignedAttributes(attributes, ALIGNMENT_MAX);
    expect(attributes).toEqual(before);
  });

  it('holds the 0..100 ceiling for an already-elite sheet', () => {
    const attributes = makeAttributes(10, { stealth: MAX_ATTRIBUTE });
    expect(alignedAttributes(attributes, ALIGNMENT_MAX).stealth).toBe(MAX_ATTRIBUTE);
  });

  it('drifts towards what the character makes of the crew, and stops there', () => {
    // A stance of -2 targets a value below the leave threshold, which is what makes "too low →
    // they threaten to leave" reachable at all rather than a band nothing can enter.
    const doomed = alignmentTarget(STANCE_MIN);
    expect(doomed).toBeLessThan(ALIGNMENT_LEAVE_THRESHOLD);
    expect(alignmentTarget(STANCE_MAX)).toBeGreaterThan(ALIGNMENT_BONUS_THRESHOLD);
    expect(alignmentTarget(0)).toBe(ALIGNMENT_START);

    const oneHalfLife = settleAlignment(ALIGNMENT_START, doomed, ALIGNMENT_HALF_LIFE_MS);
    expect(oneHalfLife).toBeCloseTo((ALIGNMENT_START + doomed) / 2, 6);
    // Long enough and they are simply where they were always heading.
    expect(settleAlignment(ALIGNMENT_START, doomed, 60 * ALIGNMENT_HALF_LIFE_MS)).toBeCloseTo(
      doomed,
      6,
    );
    expect(
      threatensToLeave(settleAlignment(ALIGNMENT_START, doomed, 30 * ALIGNMENT_HALF_LIFE_MS)),
    ).toBe(true);
  });

  it('does not move on a zero-length or backwards step', () => {
    expect(settleAlignment(ALIGNMENT_START, 0, 0)).toBe(ALIGNMENT_START);
    expect(settleAlignment(ALIGNMENT_START, 0, -PAY_WEEK_MS)).toBe(ALIGNMENT_START);
  });

  it('stays inside the meter for every stance', () => {
    for (let stance = STANCE_MIN; stance <= STANCE_MAX; stance++) {
      const target = alignmentTarget(stance);
      expect(target).toBeGreaterThanOrEqual(ALIGNMENT_MIN);
      expect(target).toBeLessThanOrEqual(ALIGNMENT_MAX);
    }
  });

  it('leaves no band and no bonus tier that a live officer cannot reach', () => {
    // The band cuts and the bonus scale are written against ALIGNMENT_MAX, which is a *schema*
    // bound; what an officer can actually reach is `alignmentTarget(STANCE_MAX)`. When those two
    // came apart, `devoted` and the top of the bonus scale were states no play could enter and
    // every test still passed, because each one was asserted against a hand-written value rather
    // than a drifted one. This walks the only inputs the game can produce.
    expect(ALIGNMENT_PER_STANCE).toBe(25);
    expect(alignmentTarget(STANCE_MAX)).toBe(ALIGNMENT_MAX);
    expect(alignmentTarget(STANCE_MIN)).toBe(ALIGNMENT_MIN);

    const bands = new Set<string>();
    const bonuses = new Set<number>();
    for (let stance = STANCE_MIN; stance <= STANCE_MAX; stance++) {
      const target = alignmentTarget(stance);
      // A year of daily reads is a tenure the game plainly supports.
      for (let day = 0; day <= 365; day++) {
        const alignment = settleAlignment(ALIGNMENT_START, target, day * 24 * 60 * 60 * 1000);
        bands.add(alignmentBand(alignment));
        bonuses.add(alignmentSkillBonus(alignment));
      }
    }

    expect([...ALIGNMENT_BANDS].every((band) => bands.has(band))).toBe(true);
    // ...and the scale is entered at every step, not just at its ends.
    const topBonus = alignmentSkillBonus(ALIGNMENT_MAX);
    expect(topBonus).toBe(5);
    for (let bonus = 0; bonus <= topBonus; bonus++) expect(bonuses).toContain(bonus);
  });

  it('pays a durable bonus only where both halves of §H4 approve', () => {
    // Entered at every step (above) and *rested* at only two: `alignmentTarget(1)` is exactly
    // ALIGNMENT_BONUS_THRESHOLD, so a stance +1 officer settles on the first alignment that pays
    // nothing and stays there. That is the decision, not an accident of the constants — asserted
    // across the stance range so that moving either constant has to come back through it.
    for (let stance = STANCE_MIN; stance < STANCE_MAX; stance++) {
      expect(alignmentSkillBonus(alignmentTarget(stance))).toBe(0);
    }
    expect(alignmentSkillBonus(alignmentTarget(STANCE_MAX))).toBeGreaterThan(0);
    // What +1 buys instead: the band the Bar prints against their name.
    expect(alignmentBand(alignmentTarget(1))).toBe('settled');
    expect(alignmentBand(alignmentTarget(0))).toBe('unsettled');

    // And the 1..4 steps are the decay ramp that makes losing a +2 word cost a week rather than
    // five attribute points on the spot.
    const day = 24 * 60 * 60 * 1000;
    const descending = (days: number) =>
      alignmentSkillBonus(settleAlignment(ALIGNMENT_MAX, alignmentTarget(1), days * day));
    expect(descending(6)).toBeGreaterThan(0);
    expect(descending(7)).toBe(0);
  });
});

describe('§H6/§H6a — the character level', () => {
  const sheet = makeAttributes(18, { stealth: 34, logic: 30, hacking: 28, medicine: 9 });
  const fresh = {
    level: CHARACTER_LEVEL_MIN,
    xpIntoLevel: 0,
    unspentPoints: 0,
    attributes: sheet,
  };

  it('splits the grant 2 by hand and 3 along affinity, totalling 5 (§H6a)', () => {
    expect(CHARACTER_LEVEL_PLAYER_POINTS + CHARACTER_LEVEL_AUTO_POINTS).toBe(
      CHARACTER_LEVEL_POINTS,
    );

    const advanced = applyCharacterXp(fresh, characterXpToNextLevel(CHARACTER_LEVEL_MIN));
    expect(advanced.levelsGained).toBe(1);
    expect(advanced.level).toBe(CHARACTER_LEVEL_MIN + 1);
    expect(advanced.unspentPoints).toBe(CHARACTER_LEVEL_PLAYER_POINTS);

    const spent = ATTRIBUTE_NAMES.reduce(
      (total, name) => total + advanced.attributes[name] - sheet[name],
      0,
    );
    expect(spent, 'auto-allocation spends exactly the non-player share').toBe(
      CHARACTER_LEVEL_AUTO_POINTS,
    );
  });

  it('auto-allocates along the strengths already on the sheet (§H6a)', () => {
    expect(autoAllocatedAttributes(sheet)).toEqual(['stealth', 'logic', 'hacking']);
    const advanced = applyCharacterXp(fresh, characterXpToNextLevel(CHARACTER_LEVEL_MIN));
    expect(advanced.attributes.stealth).toBe(35);
    expect(advanced.attributes.logic).toBe(31);
    expect(advanced.attributes.hacking).toBe(29);
    expect(advanced.attributes.medicine).toBe(9);
  });

  it('banks a level it did not reach, and carries the remainder', () => {
    const threshold = characterXpToNextLevel(CHARACTER_LEVEL_MIN);
    const short = applyCharacterXp(fresh, threshold - 1);
    expect(short.levelsGained).toBe(0);
    expect(short.level).toBe(CHARACTER_LEVEL_MIN);
    expect(short.xpIntoLevel).toBe(threshold - 1);
    expect(short.attributes).toEqual(sheet);

    expect(applyCharacterXp(short, 1).level).toBe(CHARACTER_LEVEL_MIN + 1);
    expect(applyCharacterXp(short, 5).xpIntoLevel).toBe(4);
  });

  it('pays every level a single large award crossed', () => {
    const twoLevels =
      characterXpToNextLevel(CHARACTER_LEVEL_MIN) + characterXpToNextLevel(CHARACTER_LEVEL_MIN + 1);
    const advanced = applyCharacterXp(fresh, twoLevels);
    expect(advanced.levelsGained).toBe(2);
    expect(advanced.unspentPoints).toBe(2 * CHARACTER_LEVEL_PLAYER_POINTS);
    expect(advanced.xpIntoLevel).toBe(0);
  });

  it('is worth the same split across awards as in one lump', () => {
    const total = 3 * characterXpToNextLevel(CHARACTER_LEVEL_MIN);
    const lump = applyCharacterXp(fresh, total);
    let split = fresh as ReturnType<typeof applyCharacterXp>;
    for (let i = 0; i < total; i += 37) split = applyCharacterXp(split, Math.min(37, total - i));
    expect(split.level).toBe(lump.level);
    expect(split.xpIntoLevel).toBe(lump.xpIntoLevel);
    expect(split.unspentPoints).toBe(lump.unspentPoints);
  });

  it('ignores a negative award rather than clawing progress back', () => {
    expect(applyCharacterXp({ ...fresh, xpIntoLevel: 50 }, -1000).xpIntoLevel).toBe(50);
  });

  it('spends a banked point, and refuses when there are none', () => {
    const banked = { ...fresh, unspentPoints: 2 };
    const spent = spendCharacterPoint(banked, 'medicine');
    expect(spent?.unspentPoints).toBe(1);
    expect(spent?.attributes.medicine).toBe(10);
    expect(banked.attributes.medicine, 'the input sheet is not mutated').toBe(9);
    expect(spendCharacterPoint(fresh, 'medicine')).toBeNull();
  });

  it('holds the attribute ceiling when a point is spent at the top of the scale', () => {
    const maxed = {
      ...fresh,
      unspentPoints: 1,
      attributes: makeAttributes(18, { medicine: MAX_ATTRIBUTE }),
    };
    expect(spendCharacterPoint(maxed, 'medicine')?.attributes.medicine).toBe(MAX_ATTRIBUTE);
  });

  it('costs strictly more at every level — "characters evolve slowly" (§H6)', () => {
    for (let level = CHARACTER_LEVEL_MIN; level < 20; level++) {
      expect(characterXpToNextLevel(level + 1)).toBeGreaterThan(characterXpToNextLevel(level));
    }
    expect(characterXpToNextLevel(0), 'a malformed level clamps rather than throwing').toBe(
      characterXpToNextLevel(CHARACTER_LEVEL_MIN),
    );
  });
});

describe('§H7 — negotiating a salary', () => {
  const ordinary = makeAttributes(18);
  const excellent = makeAttributes(18, { stealth: 38, logic: 36, hacking: 34, deception: 32 });

  it('prices a better sheet higher', () => {
    expect(askingWage(excellent, 0)).toBeGreaterThan(askingWage(ordinary, 0));
  });

  it('charges a crew they dislike more, and one they like less', () => {
    const neutral = askingWage(excellent, 0);
    expect(askingWage(excellent, STANCE_MIN)).toBeGreaterThan(neutral);
    expect(askingWage(excellent, STANCE_MAX)).toBeLessThan(neutral);
  });

  it('takes an offer at or above the reservation, and counters below it', () => {
    const asking = askingWage(excellent, 0);
    const floor = reservationWage(asking);
    expect(floor).toBe(Math.ceil(asking * WAGE_RESERVATION_FRACTION));

    expect(negotiateWage(asking, asking)).toEqual({ accepted: true, wage: asking });
    expect(negotiateWage(floor, asking)).toEqual({ accepted: true, wage: floor });
    // Haggling well is worth caps: they sign for what was offered, not for what they asked.
    expect(negotiateWage(floor, asking).wage).toBeLessThan(asking);

    const lowball = negotiateWage(1, asking);
    expect(lowball.accepted).toBe(false);
    expect(lowball.wage).toBeGreaterThanOrEqual(floor);
    expect(lowball.wage).toBeLessThanOrEqual(asking);
  });

  it('counters closer to the asking price the closer the offer was', () => {
    const asking = askingWage(excellent, 0);
    const floor = reservationWage(asking);
    const near = negotiateWage(floor - 1, asking);
    const far = negotiateWage(0, asking);
    expect(near.accepted).toBe(false);
    expect(near.wage).toBeGreaterThanOrEqual(far.wage);
  });

  it('never asks less than the floor wage, however poor the sheet', () => {
    expect(askingWage(makeAttributes(0), STANCE_MAX)).toBeGreaterThan(0);
  });
});

describe('§H7 — the first payment covers the rest of the week', () => {
  // W2's payroll engine owns the arithmetic; what W5 has to get right is *which* clock it hands
  // over. These pin the two boundaries the issue calls out by name.
  const MONDAY = new Date('2026-08-10T00:00:00.000Z');

  it('costs a full week when the ink dries exactly on the boundary', () => {
    expect(startOfPayWeek(MONDAY).getTime()).toBe(MONDAY.getTime());
    expect(proratedFirstWage(140, MONDAY)).toBe(140);
  });

  it('costs an hour when there is an hour left', () => {
    const hourLeft = new Date(MONDAY.getTime() + PAY_WEEK_MS - 60 * 60 * 1000);
    expect(proratedFirstWage(168, hourLeft)).toBe(1);
  });

  it('charges the whole of the next week to someone hired a moment after rollover', () => {
    const justAfter = new Date(MONDAY.getTime() + PAY_WEEK_MS + 1);
    expect(proratedFirstWage(140, justAfter)).toBe(140);
  });
});

describe('the shared package keeps no role-shaped data', () => {
  it('prices a wage off the visible sheet only, never off a role', () => {
    // A wage that tracked role fit would put the hidden table on the wire with a price on it
    // (§B8a, INTERFACES R4). Two sheets with the same ratings in different *attributes* must
    // therefore cost exactly the same.
    const first = makeAttributes(18, { stealth: 38, logic: 30 });
    const second = makeAttributes(18, { medicine: 38, diplomacy: 30 });
    expect(askingWage(first, 0)).toBe(askingWage(second, 0));
  });

  it('auto-allocates by rating, not by role', () => {
    const swap = (a: AttributeName, b: AttributeName) =>
      autoAllocatedAttributes(makeAttributes(18, { [a]: 38, [b]: 30 }));
    expect(swap('stealth', 'logic')).toEqual(['stealth', 'logic', ATTRIBUTE_NAMES[0]]);
    expect(swap('medicine', 'diplomacy')).toEqual(['medicine', 'diplomacy', ATTRIBUTE_NAMES[0]]);
  });
});

/**
 * The conversation (§H7).
 *
 * `negotiateWage` answered one question the same way for everybody; this is the part that makes
 * hiring feel like hiring a person. Every property below is one a Football Manager negotiation has
 * and this one had to grow: a floor that does not move, a demand that does, a personality behind
 * both, patience that runs out, and a door.
 */
describe('haggling with somebody who has an opinion about you (§H7)', () => {
  const ASKING = 100;
  const FLOOR = reservationWage(ASKING); // 80

  const open = (ambition: Ambition = 'wealth', compass: MoralCompass = 'pragmatist') =>
    openNegotiation(ASKING, ambition, compass);

  const say = (
    negotiation: Negotiation,
    offer: number,
    ambition: Ambition = 'wealth',
    moralCompass: MoralCompass = 'pragmatist',
  ) => negotiate({ negotiation, offer, asking: ASKING, ambition, moralCompass });

  it('opens at the asking price with the whole of their patience', () => {
    const started = open();
    expect(started.standing).toBe(ASKING);
    expect(started.rounds).toBe(0);
    expect(started.closed).toBe(false);
    expect(started.patience).toBe(negotiationTemper('wealth', 'pragmatist').patience);
  });

  it('takes an offer at the reservation value, and not one cap under it', () => {
    expect(say(open(), FLOOR).accepted).toBe(true);
    expect(say(open(), FLOOR - 1).accepted).toBe(false);
  });

  it('agrees at the number offered — haggling well is worth caps', () => {
    const turn = say(open(), FLOOR);
    expect(turn.negotiation.lastOffer).toBe(FLOOR);
    expect(turn.negotiation.standing).toBe(FLOOR);
    expect(turn.negotiation.closed).toBe(true);
  });

  it('knows the difference between agreeing and being overpaid', () => {
    expect(say(open(), FLOOR).negotiation.mood).toBe('agreed');
    expect(say(open(), ASKING + 20).negotiation.mood).toBe('overpaid');
  });

  it('comes down when you move up, and never below the floor', () => {
    let state = open();
    let previous = state.standing;
    for (const offer of [40, 55, 65, 72, 76]) {
      const turn = say(state, offer);
      if (turn.negotiation.closed) break;
      expect(turn.negotiation.standing).toBeLessThanOrEqual(previous);
      expect(turn.negotiation.standing).toBeGreaterThanOrEqual(FLOOR);
      previous = turn.negotiation.standing;
      state = turn.negotiation;
    }
    expect(previous).toBeLessThan(ASKING);
  });

  it('gives almost nothing to a player who repeats themselves', () => {
    const first = say(open(), 60);
    const movedOn = say(first.negotiation, 70);
    const repeated = say(first.negotiation, 60);

    const concededByMoving = first.negotiation.standing - movedOn.negotiation.standing;
    const concededByRepeating = first.negotiation.standing - repeated.negotiation.standing;
    expect(concededByRepeating).toBeLessThan(concededByMoving);
    // And it costs more patience than moving does, which is what makes stubbornness a bad plan.
    expect(repeated.negotiation.patience).toBeLessThan(movedOn.negotiation.patience);
    expect(repeated.negotiation.mood).toBe('stonewalled');
  });

  it('treats a lowball as an insult and burns patience for it', () => {
    const insulting = say(open(), Math.floor(FLOOR * INSULT_FRACTION) - 1);
    const merelyLow = say(open(), FLOOR - 1);
    expect(insulting.negotiation.mood).toBe('insulted');
    expect(insulting.negotiation.patience).toBeLessThan(merelyLow.negotiation.patience);
  });

  it('walks away when patience runs out, and stays gone', () => {
    let state = open('notoriety', 'ruthless');
    let walked = false;
    for (let round = 0; round < 20 && !walked; round++) {
      const turn = say(state, 1, 'notoriety', 'ruthless');
      state = turn.negotiation;
      walked = turn.walkedAway;
    }
    expect(walked, 'a stream of insulting offers has to end the conversation').toBe(true);
    expect(state.closed).toBe(true);
    expect(state.mood).toBe('walked');

    // And a further offer changes nothing at all, however good it is.
    const after = say(state, ASKING * 10, 'notoriety', 'ruthless');
    expect(after.accepted).toBe(false);
    expect(after.negotiation).toEqual(state);
  });

  it('gives the impatient less room than the patient — the personality is the point', () => {
    const grinder = negotiationTemper('wealth', 'pragmatist');
    const shortFuse = negotiationTemper('notoriety', 'ruthless');
    expect(grinder.patience).toBeGreaterThan(shortFuse.patience);
    // Somebody here to belong is embarrassed to be haggling and gives ground to end it.
    expect(negotiationTemper('belonging', 'idealist').concession).toBeGreaterThan(
      negotiationTemper('wealth', 'opportunist').concession,
    );
  });

  it('keeps every temper inside the bounds the model promises', () => {
    for (const ambition of AMBITIONS) {
      for (const compass of MORAL_COMPASSES) {
        const temper = negotiationTemper(ambition, compass);
        expect(temper.patience).toBeGreaterThanOrEqual(MIN_PATIENCE);
        expect(temper.patience).toBeLessThanOrEqual(MAX_PATIENCE);
        expect(temper.concession).toBeGreaterThan(0);
        expect(temper.concession).toBeLessThanOrEqual(0.7);
      }
    }
  });

  it('agrees on exactly the number the hire gate would accept', () => {
    // The one invariant that stops the conversation being theatre: `negotiateWage` is what
    // `/bar/hire` enforces, and it must never disagree with what the character just said yes to.
    for (let offer = 0; offer <= ASKING + 40; offer++) {
      expect(say(open(), offer).accepted).toBe(negotiateWage(offer, ASKING).accepted);
    }
  });

  it('says something in character, and says the same thing twice', () => {
    const turn = say(open('wealth', 'ruthless'), 10, 'wealth', 'ruthless');
    const line = negotiationLine('ruthless', turn.negotiation.mood, turn.negotiation.rounds);
    expect(line.length).toBeGreaterThan(0);
    expect(negotiationLine('ruthless', turn.negotiation.mood, turn.negotiation.rounds)).toBe(line);
    // Four voices, not one bank with a name on it.
    expect(negotiationLine('idealist', 'insulted', 0)).not.toBe(
      negotiationLine('ruthless', 'insulted', 0),
    );
  });

  it('has a line for every mood a conversation can actually reach', () => {
    for (const compass of MORAL_COMPASSES) {
      for (const mood of NEGOTIATION_MOODS) {
        expect(negotiationLine(compass, mood, 0).length).toBeGreaterThan(0);
        expect(negotiationLine(compass, mood, 7).length).toBeGreaterThan(0);
      }
    }
  });
});
