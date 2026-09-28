import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from './index.js';

/**
 * The one query the world tick runs every second must not scan (2026-09-24).
 *
 * `basesWithActiveRuns` asks which crews have a run out, sixty times a minute, for ever. Nothing
 * ever deletes a mission, so before `idx_missions_status_base` the best plan was a SCAN of a
 * covering index: the table was never touched, but every mission any crew had ever run was read on
 * every tick. The cost of a tick grew with the age of the world.
 *
 * Asserted on the query plan rather than on a clock, because the behaviour is correct either way
 * and only the cost moved. A plan assertion is the honest shape of that test: it fails if somebody
 * drops the index, and it fails if somebody rewrites the query into something the index cannot
 * serve.
 */
describe('the query the world tick runs every second', () => {
  it('searches the index rather than scanning it', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const plan = db
      .prepare("EXPLAIN QUERY PLAN SELECT DISTINCT base_id FROM missions WHERE status = 'active'")
      .all() as { detail: string }[];
    const detail = plan.map((row) => row.detail).join(' | ');
    expect(detail, `plan was: ${detail}`).toContain('SEARCH');
    expect(detail, `plan was: ${detail}`).not.toContain('SCAN');
    db.close();
  });
});
