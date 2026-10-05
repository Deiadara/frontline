import { softCap } from '../battle/soft-cap.js';

/**
 * Five channels that stopped dead at a cap, now bent instead (maintainer, 2026-10-05).
 *
 * Vehicle parts and unit refits at 60, the black market's infamy discount at 50, travel speed at
 * 60, mission speed at 50: each was a `min`, so a level 5 Rail Yard filled the vehicle cap alone and
 * its five levels above that, every perk and every rung on the channel bought nothing. The ruling:
 * keep what extra locations, rungs and perks add, worth having but not overpowering, sized so a
 * realistic mid-game and late-game crew sit near the old bound for their phase and a crew that
 * specialises (every infamy discount location, rung and perk) runs ahead of it, at a cost elsewhere.
 *
 * Each is a taper (`softCap`): face value to the knee, then less for every point, closing on a
 * ceiling it never reaches. Sized off the catalogue's own sources on 2026-10-05, a "late" crew
 * being one main location at level 8, a rung and a perk:
 *
 * | channel       | old cap | knee / ceiling | mid | late | specialist |
 * | vehicle parts | 60      | 30 / 70        | 46  | 64   | ~70        |
 * | refits        | 60      | 30 / 70        | 43  | 62   | ~70        |
 * | black market  | 50      | 25 / 65        | 21  | 56   | ~60        |
 * | travel speed  | 60      | 30 / 75        | 40  | 65   | ~75        |
 * | mission speed | 50      | 25 / 60        | 30  | 53   | ~60        |
 *
 * The figures in and out are the channel's summed points, never negative.
 */
export const VEHICLE_PARTS_KNEE = 30;
export const VEHICLE_PARTS_CEILING = 70;
export const REFIT_DISCOUNT_KNEE = 30;
export const REFIT_DISCOUNT_CEILING = 70;
export const BLACK_MARKET_DISCOUNT_KNEE = 25;
export const BLACK_MARKET_DISCOUNT_CEILING = 65;
export const TRAVEL_SPEED_KNEE = 30;
export const TRAVEL_SPEED_CEILING = 75;
export const MISSION_SPEED_KNEE = 25;
export const MISSION_SPEED_CEILING = 60;

const bent = (points: number, knee: number, ceiling: number): number =>
  points <= 0 ? 0 : softCap(points, knee, ceiling);

/** Percent off a machine's parts, from the summed `vehicle_parts` points. */
export function vehiclePartsCut(points: number): number {
  return bent(points, VEHICLE_PARTS_KNEE, VEHICLE_PARTS_CEILING);
}

/** Percent off a unit modification, from the summed `refit_discount` points. */
export function refitDiscountCut(points: number): number {
  return bent(points, REFIT_DISCOUNT_KNEE, REFIT_DISCOUNT_CEILING);
}

/** Percent off a won black market lot's infamy, from the summed points. */
export function blackMarketDiscountCut(points: number): number {
  return bent(points, BLACK_MARKET_DISCOUNT_KNEE, BLACK_MARKET_DISCOUNT_CEILING);
}

/** Percent off a road's clock that the ground and the crew buy, from the summed points. */
export function travelSpeedCut(points: number): number {
  return bent(points, TRAVEL_SPEED_KNEE, TRAVEL_SPEED_CEILING);
}

/** The divisor bonus on a mission's job clock, from the summed `mission_speed` points. */
export function missionSpeedCut(points: number): number {
  return bent(points, MISSION_SPEED_KNEE, MISSION_SPEED_CEILING);
}
