import type { Movement } from '@frontline/shared';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase, runMigrations } from '../index.js';
import { createRepositories } from './index.js';

/**
 * One column this build cannot read (bug pass, 2026-10-06). The world's "columns arriving" stage
 * reads every arrived column at once, and the first unreadable one threw it whole: no column
 * anywhere landed, and every fight ran without reinforcements that had reached it in time.
 */
describe('a column this build cannot read', () => {
  it('is left out of the columns that have arrived, and the rest land', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = openDatabase(':memory:');
    runMigrations(db);
    // The rows are what is being read, not who sent them: no crew or fight is needed behind them.
    db.pragma('foreign_keys = OFF');
    const repos = createRepositories(db);
    const column = (id: string): Movement => ({
      id,
      baseId: 'b',
      battleId: 'fight',
      side: 'attacker',
      fromDistrictId: 'sector-7',
      toDistrictId: 'steelbelt',
      army: { razors: 3 },
      perimeter: {},
      departedAt: '2026-10-06T10:00:00.000Z',
      arrivesAt: '2026-10-06T10:30:00.000Z',
    });
    repos.movements.put(column('readable'));
    repos.movements.put(column('broken'));
    // A count no army can have, as a NaN written through `JSON.stringify` reads back.
    db.prepare(
      `UPDATE troop_movements SET army_json = '{"razors":null}' WHERE id = 'broken'`,
    ).run();

    const at = '2026-10-06T11:00:00.000Z';
    expect(repos.movements.arrivedBy(at).map((one) => one.id)).toEqual(['readable']);
    expect(repos.movements.forBattle('fight').map((one) => one.id)).toEqual(['readable']);
    vi.restoreAllMocks();
  });
});
