import { describe, expect, it } from 'vitest';
import {
  MAX_ATTRIBUTE,
  MAX_RECRUITMENT_ATTRIBUTE,
  makeAttributes,
  type Attributes,
} from '../attributes.js';
import {
  INSULT_FRACTION,
  MAX_PATIENCE,
  MIN_PATIENCE,
  NEGOTIATION_MOODS,
  negotiate,
  negotiationLine,
  negotiationTemper,
  negotiationVoice,
  NEGOTIATION_VOICES,
  openNegotiation,
  type Negotiation,
} from './negotiation.js';
import { assessJoin } from './join.js';
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

  /* A middling sheet: neither a pushover nor a professional. */
  const SHEET = makeAttributes(20);
  /* Holds the line, and does this for a living: the hardest sit-down the model produces. */
  const HARD = {
    ...makeAttributes(20),
    composure: MAX_RECRUITMENT_ATTRIBUTE,
    negotiation: MAX_RECRUITMENT_ATTRIBUTE,
  };
  /* Rattles, and has never haggled before. */
  const SOFT = { ...makeAttributes(20), composure: 0, negotiation: 0 };

  const open = (attributes: Attributes = SHEET) => openNegotiation(ASKING, attributes);

  const say = (negotiation: Negotiation, offer: number, attributes: Attributes = SHEET) =>
    negotiate({ negotiation, offer, asking: ASKING, attributes });

  it('opens at the asking price with the whole of their patience', () => {
    const started = open();
    expect(started.standing).toBe(ASKING);
    expect(started.rounds).toBe(0);
    expect(started.closed).toBe(false);
    expect(started.patience).toBe(negotiationTemper(SHEET).patience);
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
    let state = open(SOFT);
    let walked = false;
    for (let round = 0; round < 20 && !walked; round++) {
      const turn = say(state, 1, SOFT);
      state = turn.negotiation;
      walked = turn.walkedAway;
    }
    expect(walked, 'a stream of insulting offers has to end the conversation').toBe(true);
    expect(state.closed).toBe(true);
    expect(state.mood).toBe('walked');

    // And a further offer changes nothing at all, however good it is.
    const after = say(state, ASKING * 10, HARD);
    expect(after.accepted).toBe(false);
    expect(after.negotiation).toEqual(state);
  });

  /*
   * The temper is read off the sheet now, and this is the property that makes that worth doing:
   * the card the player is looking at *predicts the haggle*. Composure is how long they sit there;
   * Negotiation is how little they give up. Both are printed before you decide to sit down.
   */
  it('makes a composed professional a harder sit-down than somebody who rattles', () => {
    expect(negotiationTemper(HARD).patience).toBeGreaterThan(negotiationTemper(SOFT).patience);
    expect(negotiationTemper(SOFT).concession).toBeGreaterThan(negotiationTemper(HARD).concession);
  });

  it('keeps every temper inside the bounds the model promises, across the whole scale', () => {
    for (let composure = 0; composure <= MAX_ATTRIBUTE; composure += 1) {
      for (const negotiation of [0, MAX_RECRUITMENT_ATTRIBUTE, MAX_ATTRIBUTE]) {
        const temper = negotiationTemper({ ...makeAttributes(20), composure, negotiation });
        expect(temper.patience).toBeGreaterThanOrEqual(MIN_PATIENCE);
        expect(temper.patience).toBeLessThanOrEqual(MAX_PATIENCE);
        expect(temper.concession).toBeGreaterThan(0);
        expect(temper.concession).toBeLessThanOrEqual(0.7);
      }
    }
  });

  /** Four written voices, and a recruit always sounds like the same one. */
  it('gives a recruit one voice and keeps them in it', () => {
    for (const id of ['recruit-1', 'recruit-2', 'someone-else']) {
      expect(negotiationVoice(id)).toBe(negotiationVoice(id));
      expect(NEGOTIATION_VOICES).toContain(negotiationVoice(id));
    }
    const voices = new Set(
      Array.from({ length: 200 }, (_, index) => negotiationVoice(`recruit-${index}`)),
    );
    expect(voices.size, 'every recruit sounds the same').toBeGreaterThan(1);
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
    const turn = say(open(), 10);
    const line = negotiationLine('ruthless', turn.negotiation.mood, turn.negotiation.rounds);
    expect(line.length).toBeGreaterThan(0);
    expect(negotiationLine('ruthless', turn.negotiation.mood, turn.negotiation.rounds)).toBe(line);
    // Four voices, not one bank with a name on it.
    expect(negotiationLine('idealist', 'insulted', 0)).not.toBe(
      negotiationLine('ruthless', 'insulted', 0),
    );
  });

  it('has a line for every mood a conversation can actually reach', () => {
    for (const compass of NEGOTIATION_VOICES) {
      for (const mood of NEGOTIATION_MOODS) {
        expect(negotiationLine(compass, mood, 0).length).toBeGreaterThan(0);
        expect(negotiationLine(compass, mood, 7).length).toBeGreaterThan(0);
      }
    }
  });
});
