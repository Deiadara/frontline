import { describe, expect, it } from 'vitest';
import {
  BLACK_MARKET_DISCOUNT_CEILING,
  BLACK_MARKET_DISCOUNT_KNEE,
  MISSION_SPEED_CEILING,
  MISSION_SPEED_KNEE,
  REFIT_DISCOUNT_CEILING,
  REFIT_DISCOUNT_KNEE,
  TRAVEL_SPEED_CEILING,
  TRAVEL_SPEED_KNEE,
  VEHICLE_PARTS_CEILING,
  VEHICLE_PARTS_KNEE,
  blackMarketDiscountCut,
  missionSpeedCut,
  refitDiscountCut,
  travelSpeedCut,
  vehiclePartsCut,
} from './soft-bounds.js';

/**
 * The five channels that used to stop dead (maintainer, 2026-10-05): bent so a realistic mid and
 * late crew sit near the old bound for their phase, and a specialist runs ahead of it.
 */
const CHANNELS = [
  {
    name: 'vehicle parts',
    cut: vehiclePartsCut,
    knee: VEHICLE_PARTS_KNEE,
    ceiling: VEHICLE_PARTS_CEILING,
    oldCap: 60,
    mid: 50,
    late: 108,
    specialist: 263,
  },
  {
    name: 'refits',
    cut: refitDiscountCut,
    knee: REFIT_DISCOUNT_KNEE,
    ceiling: REFIT_DISCOUNT_CEILING,
    oldCap: 60,
    mid: 46,
    late: 96,
    specialist: 556,
  },
  {
    name: 'black market',
    cut: blackMarketDiscountCut,
    knee: BLACK_MARKET_DISCOUNT_KNEE,
    ceiling: BLACK_MARKET_DISCOUNT_CEILING,
    oldCap: 50,
    mid: 21,
    late: 86,
    specialist: 110,
  },
  {
    name: 'travel speed',
    cut: travelSpeedCut,
    knee: TRAVEL_SPEED_KNEE,
    ceiling: TRAVEL_SPEED_CEILING,
    oldCap: 60,
    mid: 41,
    late: 100,
    specialist: 453,
  },
  {
    name: 'mission speed',
    cut: missionSpeedCut,
    knee: MISSION_SPEED_KNEE,
    ceiling: MISSION_SPEED_CEILING,
    oldCap: 50,
    mid: 30,
    late: 80,
    specialist: 305,
  },
] as const;

describe('the five bent channels', () => {
  for (const channel of CHANNELS) {
    it(`${channel.name}: face value to the knee, always more, never the ceiling`, () => {
      expect(channel.cut(-5)).toBe(0);
      expect(channel.cut(channel.knee)).toBe(channel.knee);
      let last = channel.cut(channel.knee);
      for (let points = channel.knee + 1; points <= 600; points += 1) {
        const cut = channel.cut(points);
        expect(cut, `${channel.name} at ${points}`).toBeGreaterThan(last);
        expect(cut, `${channel.name} at ${points}`).toBeLessThan(channel.ceiling);
        last = cut;
      }
    });

    it(`${channel.name}: a late crew lands near the old bound, a specialist past it`, () => {
      // Within ten points of the old cap for a realistic late crew, a mid crew under it, and the
      // crew holding every source ahead of the old cap.
      expect(Math.abs(channel.cut(channel.late) - channel.oldCap)).toBeLessThanOrEqual(10);
      expect(channel.cut(channel.mid)).toBeLessThan(channel.oldCap);
      expect(channel.cut(channel.specialist)).toBeGreaterThan(channel.oldCap);
    });
  }
});
