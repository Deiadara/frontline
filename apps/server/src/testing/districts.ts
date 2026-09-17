import { CITY_DISTRICTS } from '@frontline/shared';

/**
 * A residential district that is not the one given, for a test that needs two crews in two places.
 *
 * New accounts are spread across the four residential districts by `quietestDistrict`
 * (`routes/overseer.ts`, 2026-09-17). Before that every crew was created in
 * `STARTER_DISTRICT_ID`, so a test could plant its victim on a hardcoded neighbour and know
 * the raider was somewhere else. That is no longer true: the first crew in an empty world now lands
 * on whichever residential district is quietest, which in a fresh test stack is the first by id,
 * and several files had hardcoded exactly that one.
 *
 * Derived rather than hardcoded so the next change to placement moves these tests with it instead
 * of failing them one file at a time.
 */
export function elsewhere(notThis: string): string {
  const other = CITY_DISTRICTS.filter(
    (district) => district.kind === 'residential' && district.id !== notThis,
  )[0];
  if (!other) throw new Error(`the map has no residential district besides ${notThis}`);
  return other.id;
}
