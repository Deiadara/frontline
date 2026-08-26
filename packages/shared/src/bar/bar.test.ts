import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_NAMES,
  MAX_ATTRIBUTE,
  makeAttributes,
  type AttributeName,
} from '../attributes.js';
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
  ALIGNMENT_BONUS_ATTRIBUTES,
  ALIGNMENT_BONUS_THRESHOLD,
  ALIGNMENT_LEAVE_THRESHOLD,
  ALIGNMENT_MAX,
  ALIGNMENT_MIN,
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
  contractStance,
  settleAlignment,
  threatensToLeave,
  type Ambition,
  type MoralCompass,
} from './disposition.js';
import { assessJoin } from './join.js';
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
import {
  RECRUIT_BASE_WAGE,
  WAGE_RESERVATION_FRACTION,
  WALKOUT_MARKUP,
  askingWage,
  reservationWage,
} from './wage.js';

describe('§H3, who will talk to you', () => {
  const crew = (notoriety: number, level: number) => ({ notoriety, level });

  it('shuts the door on a crew below the rank the character demands', () => {
    const wants = { minNotoriety: 3, minLevel: 1 };
    expect(assessJoin(wants, crew(2, 40)).interested).toBe(false);
    expect(assessJoin(wants, crew(2, 40)).blockers).toEqual(['notoriety']);
    expect(assessJoin(wants, crew(3, 1)).interested).toBe(true);
  });

  it('shuts it on a crew that has not been around long enough, whatever its rank', () => {
    const wants = { minNotoriety: 0, minLevel: 12 };
    expect(assessJoin(wants, crew(9, 11)).blockers).toEqual(['level']);
    expect(assessJoin(wants, crew(0, 12)).interested).toBe(true);
  });

  it('reports both doors when both are shut, rank first', () => {
    const assessment = assessJoin({ minNotoriety: 4, minLevel: 20 }, crew(1, 3));
    expect(assessment.blockers).toEqual(['notoriety', 'level']);
    expect(assessment.meetsNotoriety).toBe(false);
    expect(assessment.meetsLevel).toBe(false);
  });

  it('lets an open door through for a crew with nothing at all', () => {
    expect(assessJoin({ minNotoriety: 0, minLevel: 1 }, crew(0, 1)).interested).toBe(true);
  });
});

describe('§H5: the alignment meter', () => {
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

  it('drifts towards what the officer made of their contract, and stops there', () => {
    for (const stance of [STANCE_MIN, -1, 0, 1, STANCE_MAX]) {
      const target = alignmentTarget(stance);
      let alignment = ALIGNMENT_START;
      // 90 days is thirty half-lives: whatever is left is below the meter's own rounding.
      for (let day = 0; day < 90; day += 1) {
        alignment = settleAlignment(alignment, target, 24 * 60 * 60 * 1000);
      }
      expect(alignment, `stance ${stance}`).toBeCloseTo(target, 4);
      expect(alignment, `stance ${stance}`).toBeGreaterThanOrEqual(ALIGNMENT_MIN);
      expect(alignment, `stance ${stance}`).toBeLessThanOrEqual(ALIGNMENT_MAX);
    }
  });

  it('does not move on a zero-length or backwards step', () => {
    expect(settleAlignment(40, 90, 0)).toBe(40);
    expect(settleAlignment(40, 90, -5000)).toBe(40);
  });

  /**
   * The one number that decides an officer's opinion of the crew: what fraction of their asking
   * price they actually signed for. Their asking price is `+2`, nine tenths of it is neutral, and
   * their reservation, which is the lowest they would ever take, is `-2`.
   */
  it('reads a contract at the asking price as the best it can be, and the floor as the worst', () => {
    expect(contractStance(100, 100)).toBe(STANCE_MAX);
    expect(contractStance(90, 100)).toBe(0);
    expect(contractStance(80, 100)).toBe(STANCE_MIN);
    expect(contractStance(120, 100)).toBe(STANCE_MAX);
    expect(contractStance(10, 0)).toBe(0);
  });

  it('is monotone: every cap squeezed at the table costs goodwill', () => {
    const readings = [80, 85, 90, 95, 100].map((fee) => contractStance(fee, 100));
    expect(readings).toEqual([...readings].sort((a, b) => a - b));
  });
});

describe('§H6/§H6a: the character level', () => {
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

  it('costs strictly more at every level: "characters evolve slowly" (§H6)', () => {
    for (let level = CHARACTER_LEVEL_MIN; level < 20; level++) {
      expect(characterXpToNextLevel(level + 1)).toBeGreaterThan(characterXpToNextLevel(level));
    }
    expect(characterXpToNextLevel(0), 'a malformed level clamps rather than throwing').toBe(
      characterXpToNextLevel(CHARACTER_LEVEL_MIN),
    );
  });
});

describe('§H7: what a contract costs', () => {
  const sheet = (value: number) => makeAttributes(value);

  it('prices a better sheet higher', () => {
    expect(askingWage(sheet(35))).toBeGreaterThan(askingWage(sheet(20)));
  });

  it('never asks less than the floor wage, however poor the sheet', () => {
    expect(askingWage(sheet(0))).toBe(RECRUIT_BASE_WAGE);
  });

  /**
   * The whole cost of haggling badly. The six-hour standoff is a delay; this is the part that
   * persists, and it is what makes an opening lowball a decision rather than a free roll.
   */
  it('marks the price up ten percent for every conversation they walked out of', () => {
    const flat = askingWage(sheet(30));
    const once = askingWage(sheet(30), 1);
    const twice = askingWage(sheet(30), 2);
    expect(once).toBeGreaterThan(flat);
    expect(twice).toBeGreaterThan(once);
    expect(once / flat).toBeCloseTo(1 + WALKOUT_MARKUP, 1);
  });

  it('puts the floor at a fixed share of the asking price', () => {
    for (const asking of [12, 40, 137]) {
      expect(reservationWage(asking)).toBe(Math.ceil(asking * WAGE_RESERVATION_FRACTION));
      expect(reservationWage(asking)).toBeLessThan(asking);
    }
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

  it('agrees at the number offered: haggling well is worth caps', () => {
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

  it('gives the impatient less room than the patient: the personality is the point', () => {
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
    // The one invariant that stops the conversation being theatre: `/bar/hire` re-checks the
    // agreed figure against `reservationWage`, and that must never disagree with what the
    // character just said yes to across the table.
    for (let offer = 0; offer <= ASKING + 40; offer++) {
      expect(say(open(), offer).accepted).toBe(offer >= reservationWage(ASKING));
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
