import { CITY_DISTRICTS } from '@frontline/shared';

/**
 * A residential district that is not the one given, for a test that needs two crews in two places.
 *
 * A plot holds one crew, and a new account is seated on a free one (`newHome` in
 * `routes/overseer.ts`): `STARTER_DISTRICT_ID` while it is free, otherwise a free plot drawn at
 * random. Before 2026-09-17 every crew was created in `STARTER_DISTRICT_ID`, so a test
 * could plant its victim on a hardcoded neighbour and know the raider was somewhere else, and
 * several files had hardcoded exactly that one. A later account's plot is a draw, so no test can
 * name it.
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
