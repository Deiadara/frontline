import { CAPTURED_GATE_MAX_LEVEL } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../index.js';
import { createRepositories } from './index.js';

/**
 * A captured gate stored past today's ceiling (bug pass, 2026-10-06). Retuning the ceiling down
 * made the row unparseable, and the holder's city screen, every spy job on the gate and every fight
 * at it threw with it.
 */
describe('a captured gate above the ceiling', () => {
  it('reads as the ceiling', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const repos = createRepositories(db);
    repos.capturedGates.put({
      districtId: 'steelbelt',
      level: 1,
      upgradingTo: 2,
      upgradingUntil: '2026-10-06T12:00:00.000Z',
      upgradingSince: '2026-10-06T10:00:00.000Z',
    });
    db.prepare(
      `UPDATE captured_gates SET level = ?, upgrading_to = ? WHERE district_id = 'steelbelt'`,
    ).run(CAPTURED_GATE_MAX_LEVEL + 5, CAPTURED_GATE_MAX_LEVEL + 6);

    expect(repos.capturedGates.find('steelbelt')?.level).toBe(CAPTURED_GATE_MAX_LEVEL);
    expect(repos.capturedGates.due('2026-10-06T13:00:00.000Z')[0]?.upgradingTo).toBe(
      CAPTURED_GATE_MAX_LEVEL,
    );
  });
});
