import { describe, expect, it } from 'vitest';
import {
  bestFitParty,
  unitSlotsAtHome,
  AUTOMATION_COOLDOWN_MS,
  AUTOMATION_FAST_COOLDOWN_MS,
  AUTOMATION_RUNGS,
  ORDER_SEQUENCES,
  automationPowers,
  boardIsAutomated,
  isResting,
  nextJobKind,
  type Automation,
} from './automations.js';
import { RESEARCH_ITEMS } from '../research/tracks.js';

/**
 * The Right Hand's ladder (§C2b, maintainer 2026-09-22).
 *
 * Six steps on one research track, each opening one thing. The ladder is the whole design, so it
 * is worth holding every rung against the catalogue as well as against itself: a rung id that
 * stops existing would silently close the feature rather than fail anywhere.
 */
describe('what the Right Hand may do', () => {
  const upTo = (step: number): string[] =>
    RESEARCH_ITEMS.filter((item) => item.track === 'right_hand' && item.step <= step).map(
      (item) => item.id,
    );

  it('names rungs the research catalogue actually has, on the Right Hand track', () => {
    for (const [name, id] of Object.entries(AUTOMATION_RUNGS)) {
      const rung = RESEARCH_ITEMS.find((item) => item.id === id);
      expect(rung, `${name} -> ${id}`).toBeDefined();
      expect(rung?.track, name).toBe('right_hand');
    }
  });

  it('opens nothing at all before the third rung', () => {
    for (const step of [0, 1, 2]) {
      const powers = automationPowers(upTo(step));
      expect(powers.unlocked, `step ${step}`).toBe(false);
      expect(powers.slots, `step ${step}`).toBe(0);
    }
  });

  it('opens one slot at the third, on the long cooldown, with no choices yet', () => {
    const powers = automationPowers(upTo(3));
    expect(powers.unlocked).toBe(true);
    expect(powers.slots).toBe(1);
    expect(powers.cooldownMs).toBe(AUTOMATION_COOLDOWN_MS);
    expect(powers.bestFit).toBe(false);
    expect(powers.optimise).toBe(false);
    // Non-fight work only, which is what keeps infamy off a standing order until the ninth.
    expect(powers.orders).toEqual(['missions']);
  });

  it('walks the rest of the ladder in the order the maintainer set', () => {
    expect(automationPowers(upTo(5)).bestFit).toBe(true);
    expect(automationPowers(upTo(6)).cooldownMs).toBe(AUTOMATION_FAST_COOLDOWN_MS);
    expect(automationPowers(upTo(7)).slots).toBe(2);
    expect(automationPowers(upTo(8)).optimise).toBe(true);
    expect(automationPowers(upTo(9)).orders).toContain('battles');
    expect(automationPowers(upTo(10)).orders).toEqual(['missions', 'battles', 'mixed']);
  });

  /**
   * A mixed order is meaningless without battles, and the tenth rung can be reached without the
   * ninth only by a Console that grants one rung at a time. It still must not produce a sequence
   * naming a kind the crew may not take.
   */
  it('refuses a mixed order to a crew that has not earned battles', () => {
    const mixedOnly = [AUTOMATION_RUNGS.open, AUTOMATION_RUNGS.mixedOrders];
    expect(automationPowers(mixedOnly).orders).toEqual(['missions']);
  });
});

describe('what a slot owes next', () => {
  const slot = (order: Automation['order'], step: number): Pick<Automation, 'order' | 'step'> => ({
    order,
    step,
  });

  it('repeats the one kind for the two plain orders', () => {
    expect(nextJobKind(slot('missions', 0))).toBe('mission');
    expect(nextJobKind(slot('missions', 7))).toBe('mission');
    expect(nextJobKind(slot('battles', 3))).toBe('battle');
  });

  it('alternates the mixed order, a mission then a fight, and wraps', () => {
    expect(ORDER_SEQUENCES.mixed).toEqual(['mission', 'battle']);
    expect([0, 1, 2, 3, 4].map((step) => nextJobKind(slot('mixed', step)))).toEqual([
      'mission',
      'battle',
      'mission',
      'battle',
      'mission',
    ]);
  });
});

describe('filling a size, most suitable unit first (the fifth rung)', () => {
  /*
   * Off the catalogue as it stands: Razors carry 25 a slot and hit 175 a slot; Haulers carry 15
   * a slot over two slots and do not fight; Scavengers carry 10 and do not fight; Breakers hit
   * 125 a slot over two; Ironsides 46 over three; a Juggernaut 71 over six.
   */
  it('takes all of the best carrier first for a plain job, then the next, to the slot', () => {
    const party = bestFitParty({ razors: 3, haulers: 2, scavengers: 3 }, 8, 'standard');
    // Three Razors (3), then both Haulers (4), then one Scavenger for the slot left.
    expect(party).toEqual({ razors: 3, haulers: 2, scavengers: 1 });
    expect(unitSlotsAtHome(party!)).toBe(8);
  });

  it('sends only fighters to a fight, hardest hitter per slot first', () => {
    const party = bestFitParty({ scavengers: 20, haulers: 5, razors: 4, breakers: 2 }, 6, 'battle');
    expect(party).toEqual({ razors: 4, breakers: 1 });
  });

  it('skips a unit too big for the room left rather than overfilling', () => {
    // The Juggernaut ranks above the Ironside and takes six slots; asked for three, it is
    // passed over and the Ironside fills them exactly.
    expect(bestFitParty({ juggernauts: 1, ironsides: 1 }, 3, 'battle')).toEqual({ ironsides: 1 });
  });

  it('refuses a size the yard cannot fill to the slot', () => {
    expect(bestFitParty({ razors: 3 }, 4, 'standard')).toBeNull();
    expect(bestFitParty({ haulers: 1 }, 1, 'standard')).toBeNull();
    expect(bestFitParty({}, 1, 'standard')).toBeNull();
    // Carriers alone cannot fill a fight at all.
    expect(bestFitParty({ scavengers: 9 }, 2, 'battle')).toBeNull();
  });

  it('counts the slots at home in the same currency', () => {
    expect(unitSlotsAtHome({ razors: 3, haulers: 2, juggernauts: 1 })).toBe(3 + 4 + 6);
  });
});

describe('the gap between one party and the next', () => {
  const NOW = new Date('2026-09-22T12:00:00.000Z');
  const resting = (minutesAgo: number): Pick<Automation, 'restingSince'> => ({
    restingSince: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  });

  it('holds a slot for fifteen minutes after its party walks in', () => {
    expect(isResting(resting(14), AUTOMATION_COOLDOWN_MS, NOW)).toBe(true);
    expect(isResting(resting(16), AUTOMATION_COOLDOWN_MS, NOW)).toBe(false);
  });

  it('holds it for five once the sixth rung is in', () => {
    expect(isResting(resting(4), AUTOMATION_FAST_COOLDOWN_MS, NOW)).toBe(true);
    expect(isResting(resting(6), AUTOMATION_FAST_COOLDOWN_MS, NOW)).toBe(false);
  });

  it('does not hold a slot that has never sent anybody', () => {
    expect(isResting({ restingSince: null }, AUTOMATION_COOLDOWN_MS, NOW)).toBe(false);
  });
});

/**
 * The board lock, which is the strong rule: any slot on and the whole board is the Right Hand's.
 */
describe('who owns the mission board', () => {
  const at = (enabled: boolean): Automation => ({ enabled }) as Automation;

  it('is the player until a slot is switched on', () => {
    expect(boardIsAutomated([])).toBe(false);
    expect(boardIsAutomated([at(false), at(false)])).toBe(false);
  });

  it('is the Right Hand the moment any slot is on, even with the other one off', () => {
    expect(boardIsAutomated([at(true)])).toBe(true);
    expect(boardIsAutomated([at(false), at(true)])).toBe(true);
  });
});
