import { describe, expect, it } from 'vitest';
import { OFFICER_MARKS, OFFICER_MARK_BAND, OFFICER_MARK_FLOOR, markIndex } from './marks.js';
import {
  CHAIR_SETTLE_HOURS,
  chairIsSettled,
  chairSettlesAt,
  CHAIR_PASSIVE,
  CHAIR_PASSIVE_CAP,
  TRADER_EVEN_POINTS,
  chairPassivePercent,
  overseerLift,
  raidBossBodyTimes,
  seatedPassivePercent,
  traderRates,
} from './passives.js';
import { describeChairPassive, describeOverseerPassive } from './passive-lines.js';
import { OFFICER_ROLES, type OfficerRole } from '../roles.js';
import { roadMinutes } from '../time/speed.js';
import { districtUnitSlotCapacity } from '../building/unit-slots.js';
import { baseUnitSlotBeds } from '../building/production.js';
import { MODIFICATIONS } from '../building/modifications.js';
import type { Building } from '../building/state.js';
import { payrollCapacity } from '../economy/payroll.js';

/**
 * Each chair's one passive (maintainer, 2026-10-04): a straight line on the seat's points, nothing
 * at the F- floor and the whole cap at a perfect sheet.
 */
describe("a chair's passive", () => {
  it('runs in a straight line from nothing at the floor to its cap at a perfect sheet', () => {
    for (const [passive, cap] of Object.entries(CHAIR_PASSIVE_CAP)) {
      const name = passive as keyof typeof CHAIR_PASSIVE_CAP;
      expect(chairPassivePercent(name, OFFICER_MARK_FLOOR), passive).toBe(0);
      expect(chairPassivePercent(name, 0), passive).toBe(0);
      expect(chairPassivePercent(name, 100), passive).toBe(cap);
      expect(chairPassivePercent(name, 150), passive).toBe(cap);
      expect(chairPassivePercent(name, 55), passive).toBeCloseTo(cap / 2, 10);
    }
  });

  it('caps the ones the maintainer named at their figures', () => {
    expect(CHAIR_PASSIVE_CAP).toEqual({
      research_speed: 50,
      payroll: 50,
      unit_slots: 50,
      battle_infamy: 100,
      raid_boss_body: 400,
      scrapyard_cost: 50,
      travel_time: 50,
      muster_cost: 50,
      building_cost: 50,
      mission_xp: 50,
    });
    expect(raidBossBodyTimes(100)).toBe(5);
    expect(raidBossBodyTimes(OFFICER_MARK_FLOOR)).toBe(1);
  });

  it('pays nothing for an empty chair', () => {
    expect(seatedPassivePercent('payroll', null)).toBe(0);
  });

  it('gives every chair but the Master of Whispers and the Right Hand a passive of its own', () => {
    const withPassive = OFFICER_ROLES.filter((role) => CHAIR_PASSIVE[role] !== undefined);
    expect(OFFICER_ROLES.filter((role) => !withPassive.includes(role))).toEqual([
      'master_of_whispers',
      'right_hand',
    ]);
    expect(new Set(withPassive.map((role) => CHAIR_PASSIVE[role])).size).toBe(withPassive.length);
  });

  it('says what every chair does in a sentence, with the figure in it', () => {
    for (const role of OFFICER_ROLES) {
      const line = describeChairPassive(role, 100);
      expect(line, role).toMatch(/^[A-Z0-9].*\.$/);
    }
    expect(describeChairPassive('researcher', 55)).toBe('Makes all research 25% faster.');
    expect(describeChairPassive('fixer', 100)).toBe('Adds 50% to your payroll.');
    expect(describeChairPassive('raid_boss', 100)).toBe(
      'Multiplies his own damage and vitality by 5 in every fight.',
    );
  });
});

/**
 * The Trader (maintainer, 2026-10-04): "around C+ you start having even trades (not losing) and going
 * up from that you start gaining", to 25% at a perfect sheet.
 */
describe("the Trader's rates", () => {
  it('breaks even at the floor of C+', () => {
    expect(TRADER_EVEN_POINTS).toBe(OFFICER_MARK_FLOOR + markIndex('C+') * OFFICER_MARK_BAND);
    expect(traderRates(TRADER_EVEN_POINTS, 0.5, 1.5)).toEqual({ worth: 1, markup: 1 });
  });

  it('gains a quarter both ways at a perfect sheet', () => {
    expect(traderRates(100, 0.5, 1.5)).toEqual({ worth: 1.25, markup: 0.8 });
  });

  it('leaves the market its own rates with nobody in the chair, and never makes them worse', () => {
    expect(traderRates(null, 0.5, 1.5)).toEqual({ worth: 0.5, markup: 1.5 });
    expect(traderRates(0, 0.5, 1.5)).toEqual({ worth: 0.5, markup: 1.5 });
    expect(traderRates(OFFICER_MARK_FLOOR, 0.5, 1.5)).toEqual({ worth: 0.5, markup: 1.5 });
    // A crew whose discount already beats a weak Trader keeps its own rate.
    expect(traderRates(20, 0.9, 1.1).worth).toBeGreaterThanOrEqual(0.9);
    expect(traderRates(20, 0.9, 1.1).markup).toBeLessThanOrEqual(1.1);
  });

  it('climbs every point of the way', () => {
    let last = traderRates(OFFICER_MARK_FLOOR, 0.5, 1.5);
    for (let points = 15; points <= 100; points += 5) {
      const next = traderRates(points, 0.5, 1.5);
      expect(next.worth, `${points}`).toBeGreaterThan(last.worth);
      expect(next.markup, `${points}`).toBeLessThan(last.markup);
      last = next;
    }
  });
});

/**
 * The Overseer's passive, in the maintainer's own words (2026-10-04): F- is one point on the
 * irreplaceable; F adds one on an essential; F+ one on the other; E- a second on the irreplaceable;
 * E a second on the first essential; E+ two on all three; and on like that.
 */
describe("the Overseer's lift", () => {
  const atMark = (mark: (typeof OFFICER_MARKS)[number]): number =>
    OFFICER_MARK_FLOOR + markIndex(mark) * OFFICER_MARK_BAND + 0.5;
  const role: OfficerRole = 'researcher';
  const lift = (mark: (typeof OFFICER_MARKS)[number], id = 'officer-1') =>
    overseerLift(atMark(mark), role, id);
  const sorted = (values: Partial<Record<string, number>>) =>
    Object.values(values).sort((a, b) => (b ?? 0) - (a ?? 0));

  it('deals the steps irreplaceable first, then the essentials in turn', () => {
    expect(lift('F-')).toEqual({ analysis: 1 });
    expect(lift('F').analysis).toBe(1);
    expect(sorted(lift('F'))).toEqual([1, 1]);
    expect(lift('F+')).toEqual({ analysis: 1, intuition: 1, encyclopedia: 1 });
    expect(lift('E-')).toEqual({ analysis: 2, intuition: 1, encyclopedia: 1 });
    expect(lift('E').analysis).toBe(2);
    expect(sorted(lift('E'))).toEqual([2, 2, 1]);
    expect(lift('E+')).toEqual({ analysis: 2, intuition: 2, encyclopedia: 2 });
  });

  it('touches nothing but the irreplaceable and the two essentials, at every grade', () => {
    for (const mark of OFFICER_MARKS) {
      for (const name of Object.keys(lift(mark))) {
        expect(['analysis', 'intuition', 'encyclopedia'], mark).toContain(name);
      }
      const total = Object.values(lift(mark)).reduce((sum, n) => sum + (n ?? 0), 0);
      expect(total, mark).toBe(markIndex(mark) + 1);
    }
  });

  it('picks the first essential off the officer and keeps it', () => {
    const picks = new Set(
      Array.from({ length: 40 }, (_, n) => {
        const one = lift('F', `officer-${n}`);
        return Object.keys(one).find((name) => name !== 'analysis');
      }),
    );
    expect(picks).toEqual(new Set(['intuition', 'encyclopedia']));
    expect(lift('E', 'officer-7')).toEqual(lift('E', 'officer-7'));
  });

  it('says how many points it lifts', () => {
    expect(describeOverseerPassive(atMark('E-'))).toBe(
      'Lifts every seated officer by 4 points, shared over their irreplaceable and essential skills.',
    );
    expect(describeOverseerPassive(atMark('F-'))).toContain('by 1 point,');
  });
});

/** Where three of the passives land, pinned against the maintainer's own wording (2026-10-04). */
describe('where the passives land', () => {
  it("cuts the road's base before the speed bonuses: an hour is half an hour, then the rest", () => {
    // "If the base is 1h, the base will go down to 30 mins for a maxed out Cartographer, and then
    // any speed bonuses are applied to that 30 minute number."
    expect(roadMinutes(60, 0, 0, 50)).toBe(30);
    expect(roadMinutes(60, 0, 20, 50)).toBe(Math.round(30 * 0.8));
    expect(roadMinutes(60, 100, 0, 50)).toBe(Math.round(30 / 2));
    // A perfect sheet is the most it takes, and an empty chair takes nothing.
    expect(roadMinutes(60, 0, 0, 80)).toBe(30);
    expect(roadMinutes(60)).toBe(60);
  });

  it("adds the Steward's share of the base slots only, never of a card's percentage", () => {
    const quarters: Building = { id: 'q', kind: 'quarters', level: 5, modifications: [] };
    const ground = { unitSlotBonus: 40 };
    const base = baseUnitSlotBeds([quarters]) + 40;
    const without = districtUnitSlotCapacity([quarters], ground);
    expect(districtUnitSlotCapacity([quarters], ground, 50)).toBe(without + Math.floor(base * 0.5));
    // A housing card adds its own share on top; the Steward's figure is the same with or without.
    const carded: Building = {
      ...quarters,
      modifications: MODIFICATIONS.filter((card) => card.effect === 'housing_percent')
        .slice(0, 1)
        .map((card) => card.id),
    };
    const cardedWithout = districtUnitSlotCapacity([carded], ground);
    expect(cardedWithout).toBeGreaterThan(without);
    expect(districtUnitSlotCapacity([carded], ground, 50) - cardedWithout).toBe(
      Math.floor(base * 0.5),
    );
  });

  it("puts the Fixer's share on the whole book, the bought expansions included", () => {
    expect(payrollCapacity(10, 20, 0, 50)).toBe(Math.round(payrollCapacity(10, 20) * 1.5));
    expect(payrollCapacity(10, 20, 0, 0)).toBe(payrollCapacity(10, 20));
  });
});

describe('settling into a chair (maintainer, 2026-10-05)', () => {
  const seatedAt = '2026-10-05T12:00:00.000Z';
  const at = (hours: number): Date => new Date(Date.parse(seatedAt) + hours * 3_600_000);

  it('gives nothing for six hours and everything from the sixth on', () => {
    expect(CHAIR_SETTLE_HOURS).toBe(6);
    expect(chairSettlesAt({ seatedAt }, at(0))?.toISOString()).toBe('2026-10-05T18:00:00.000Z');
    expect(chairIsSettled({ seatedAt }, at(5.99))).toBe(false);
    expect(chairIsSettled({ seatedAt }, at(6))).toBe(true);
    expect(chairSettlesAt({ seatedAt }, at(6))).toBe(null);
  });

  it('reads an officer seated before the clock existed as settled', () => {
    expect(chairIsSettled({}, at(0))).toBe(true);
    expect(chairIsSettled({ seatedAt: null }, at(0))).toBe(true);
  });
});

describe("the Right Hand's line (bug pass, 2026-10-05)", () => {
  it('prints the whole points the sheets are moved by, never a fraction', () => {
    for (let points = 10; points <= 100; points += 0.5) {
      const line = describeChairPassive('right_hand', points);
      expect(line, String(points)).toMatch(/by \d+ points? in every skill/);
    }
  });
});
