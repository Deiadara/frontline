import { CITIES } from '@frontline/shared';
import { afterAll, beforeAll } from 'vitest';

/**
 * Shuts an open city for the length of one test file (2026-10-07).
 *
 * The closed-city doors (`city_closed` on the move, the plant, the spy and the declaration, and the
 * boot sweep that hands ground back) only bite on a city that has ground in the atlas and is not
 * open. Arca was that city until it opened, and today no shut city has any ground: Redline and
 * Deepcut are a name and a sentence. The doors stay for the next city authored before it opens,
 * so the tests that hold them borrow Arca's ground and shut it here.
 *
 * Every reader asks `cityIsOpen` at call time, so flipping the row is the whole of it. Vitest
 * isolates each file, and the row is put back afterwards regardless.
 */
export function shutCityForThisFile(cityId: string): void {
  const city = CITIES.find((one) => one.id === cityId);
  if (!city) throw new Error(`fixture: no city ${cityId}`);
  const was = city.open;
  beforeAll(() => {
    city.open = false;
  });
  afterAll(() => {
    city.open = was;
  });
}
