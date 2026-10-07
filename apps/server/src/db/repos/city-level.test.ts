import { CONTESTED_DISTRICTS, MAX_LOCATION_LEVEL } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../index.js';
import { createRepositories } from './index.js';

/**
 * A location stored above today's ceiling (2026-10-06). Retuning the ceiling down made the row
 * unparseable, and every settle reads every control row: one row was the whole world's settle.
 */
describe('a location level above the ceiling', () => {
  it('reads as the ceiling, in the map and on its own', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const repos = createRepositories(db);
    const location = CONTESTED_DISTRICTS[0]!.locations[0]!;
    repos.city.control(location.id);
    db.prepare('UPDATE location_control SET level = ? WHERE location_id = ?').run(
      MAX_LOCATION_LEVEL + 3,
      location.id,
    );
    expect(repos.city.control(location.id)?.level).toBe(MAX_LOCATION_LEVEL);
    expect(repos.city.controls().get(location.id)?.level).toBe(MAX_LOCATION_LEVEL);
  });
});
