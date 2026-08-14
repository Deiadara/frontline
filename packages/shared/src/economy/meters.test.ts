import { describe, expect, it } from 'vitest';
import { MISSION_INFAMY_DELTA } from '../missions.js';
import { MISSION_STANCES } from '../factions.js';
import {
  INFAMY_PER_GOVERNMENT_SEAT,
  INFAMY_PER_GOVERNMENT_SITE,
  INFAMY_PER_RAID_WON,
  METER_MAX,
  METER_MIN,
  adjustMeter,
  clampMeter,
  infamyForRaidWon,
} from './meters.js';

describe('the meter range', () => {
  it('holds anything inside the range unchanged', () => {
    for (const value of [METER_MIN, 1, 50, METER_MAX]) expect(clampMeter(value)).toBe(value);
  });

  it('clamps rather than wrapping at either end', () => {
    expect(clampMeter(METER_MIN - 40)).toBe(METER_MIN);
    expect(clampMeter(METER_MAX + 40)).toBe(METER_MAX);
    expect(adjustMeter(2, -10)).toBe(METER_MIN);
    expect(adjustMeter(METER_MAX - 2, 10)).toBe(METER_MAX);
  });
});

describe('infamyForRaidWon (§D7, §A3)', () => {
  const street = { fromTheState: false, seatOfPower: false };
  const outpost = { fromTheState: true, seatOfPower: false };
  const seat = { fromTheState: true, seatOfPower: true };

  it('pays the flat rate for taking ground off a rival crew', () => {
    expect(infamyForRaidWon(street)).toBe(INFAMY_PER_RAID_WON);
  });

  it('pays more for Combine ground, and more again for a seat of its power', () => {
    expect(infamyForRaidWon(outpost)).toBe(INFAMY_PER_RAID_WON + INFAMY_PER_GOVERNMENT_SITE);
    expect(infamyForRaidWon(seat)).toBe(
      INFAMY_PER_RAID_WON + INFAMY_PER_GOVERNMENT_SITE + INFAMY_PER_GOVERNMENT_SEAT,
    );
  });

  /** The ordering is the whole point — stated directly so a retune cannot quietly invert it. */
  it('ranks a seat above an outpost above the street', () => {
    expect(infamyForRaidWon(seat)).toBeGreaterThan(infamyForRaidWon(outpost));
    expect(infamyForRaidWon(outpost)).toBeGreaterThan(infamyForRaidWon(street));
  });

  it('never pays a raid nothing', () => {
    for (const target of [street, outpost, seat]) {
      expect(infamyForRaidWon(target)).toBeGreaterThan(0);
    }
  });
});

describe('MISSION_INFAMY_DELTA (§D7, §A3)', () => {
  it('covers every stance the mission board can author', () => {
    expect(Object.keys(MISSION_INFAMY_DELTA).sort()).toEqual([...MISSION_STANCES].sort());
  });

  it('is loud only for anti-government work that actually landed', () => {
    expect(MISSION_INFAMY_DELTA.against_government.success).toBeGreaterThan(0);
    expect(MISSION_INFAMY_DELTA.against_government.failure).toBe(0);
  });

  it('says nothing about working for the Combine, or about neutral work', () => {
    // Collaboration is a §D8 reputation matter; being useful to the state does not make the
    // street afraid of you, and it must not quietly buy infamy either.
    expect(MISSION_INFAMY_DELTA.for_government).toEqual({ success: 0, failure: 0 });
    expect(MISSION_INFAMY_DELTA.unaligned).toEqual({ success: 0, failure: 0 });
  });

  it('never lowers infamy — there is no mechanic that takes a name back', () => {
    for (const stance of MISSION_STANCES) {
      for (const outcome of ['success', 'failure'] as const) {
        expect(MISSION_INFAMY_DELTA[stance][outcome]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('costs less than the raid that takes the same ground', () => {
    // A job against the state is a blow; taking the site itself is the louder thing.
    expect(MISSION_INFAMY_DELTA.against_government.success).toBeLessThan(
      infamyForRaidWon({ fromTheState: true, seatOfPower: false }),
    );
  });
});
