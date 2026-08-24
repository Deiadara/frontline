import { describe, expect, it } from 'vitest';
import {
  buildingEffectiveness,
  damageBuilding,
  repairedByTime,
  repairedDistrict,
  REPAIR_HOURS,
} from './damage.js';
import type { Building } from './state.js';

/**
 * §A4: a wrecked structure repairs itself, and a bad night stops being a permanent tax.
 *
 * The rule the board asked for is "buildings automatically repair after 24 hours", and the shape it
 * is built in is the one every other clock in this game uses: a rate, a stored timestamp, and no
 * scheduler. A district nobody has looked at for a week owes exactly the same repair whenever it is
 * next read.
 *
 * The property worth guarding is **idempotence under re-reading**, and it is the reason the clock
 * moves up by the hours it paid for rather than to `now`. A client polling a page once a second
 * settles the same district thousands of times an hour, and the naive spelling rounds a fraction of
 * a point up to a whole one on every one of those reads, which repairs a gutted district in under
 * a minute, on a build where every other assertion is green.
 */

const NOON = new Date('2026-08-16T12:00:00.000Z');

const at = (hoursFromNoon: number): Date => new Date(NOON.getTime() + hoursFromNoon * 3_600_000);

const structure = (damage: number, damagedAt: string | null = NOON.toISOString()): Building => ({
  id: 'b1',
  kind: 'greenhouse',
  level: 4,
  modifications: [],
  damage,
  damagedAt,
  garrisons: 0,
});

describe('a structure putting itself right (§A4)', () => {
  it('starts the clock when it is hit, and stops it when it is whole', () => {
    const hit = damageBuilding(structure(0, null), 40, NOON.toISOString());
    expect(hit.damage).toBe(40);
    expect(hit.damagedAt).toBe(NOON.toISOString());

    // Damage of zero carries no clock: there is nothing left for the crew to be working on.
    expect(damageBuilding(structure(0, null), 0, NOON.toISOString()).damagedAt).toBeNull();
  });

  it('restarts the clock whole on a second strike', () => {
    const first = damageBuilding(structure(0, null), 30, NOON.toISOString());
    const second = damageBuilding(first, 30, at(6).toISOString());
    expect(second.damage).toBe(60);
    // Not the original mark. A district must not get cheaper to wreck the more often it is wrecked.
    expect(second.damagedAt).toBe(at(6).toISOString());
  });

  it('clears a total wreck in exactly the hours the board asked for', () => {
    const wrecked = structure(100);
    expect(repairedByTime(wrecked, at(REPAIR_HOURS - 1)).damage).toBeGreaterThan(0);
    expect(repairedByTime(wrecked, at(REPAIR_HOURS)).damage).toBe(0);
    expect(repairedByTime(wrecked, at(REPAIR_HOURS)).damagedAt).toBeNull();
    // ...and it is back to doing its whole job, which is the thing a player actually notices.
    expect(buildingEffectiveness(repairedByTime(wrecked, at(REPAIR_HOURS)))).toBe(1);
  });

  it('clears a lighter strike sooner, because the same crew are working on less', () => {
    // A rate, not a countdown. A scratch and a gutting costing the same day is the one thing that
    // would make the size of a raid stop mattering.
    expect(repairedByTime(structure(25), at(REPAIR_HOURS / 4)).damage).toBe(0);
    expect(repairedByTime(structure(100), at(REPAIR_HOURS / 4)).damage).toBeGreaterThan(0);
  });

  it('repairs the same amount however many times it is read', () => {
    const wrecked = structure(96);

    const once = repairedByTime(wrecked, at(12));

    // The same twelve hours, settled minute by minute. Seven hundred and twenty reads.
    let stepped = wrecked;
    for (let minute = 1; minute <= 12 * 60; minute += 1) {
      stepped = repairedByTime(stepped, at(minute / 60));
    }

    expect(stepped.damage).toBe(once.damage);
    // And the figure itself, written down rather than derived: twelve hours at 100 points per
    // twenty-four is fifty points, so 96 comes back to 46. Re-deriving it from the constants would
    // make this assertion agree with whatever the code currently does.
    expect(once.damage).toBe(46);
  });

  it('does not repair a fraction of a point into a whole one', () => {
    // One second is worth 0.00069 of a point. Rounding that up is the bug that repairs a gutted
    // district in a minute of polling, and it leaves the row untouched instead.
    const wrecked = structure(80);
    const blink = repairedByTime(wrecked, new Date(NOON.getTime() + 1000));
    expect(blink.damage).toBe(80);
    expect(blink.damagedAt).toBe(NOON.toISOString());
  });

  it('leaves an intact structure and a clock-less one alone', () => {
    const intact = structure(0, null);
    expect(repairedByTime(intact, at(48))).toBe(intact);
    // A row from before the clock existed: damaged, no timestamp. Nothing to settle from, and it
    // must not be invented: the alternative is repairing it from the epoch, which is instant.
    const legacy = structure(60, null);
    expect(repairedByTime(legacy, at(48)).damage).toBe(60);
  });

  it('never runs backwards on a clock that is somehow in the future', () => {
    expect(repairedByTime(structure(50, at(5).toISOString()), NOON).damage).toBe(50);
  });

  it('settles a whole district in one pass', () => {
    const district = [structure(100), { ...structure(10), id: 'b2', kind: 'lab' as const }];
    const settled = repairedDistrict(district, at(REPAIR_HOURS));
    expect(settled.map((building) => building.damage)).toEqual([0, 0]);
  });
});
