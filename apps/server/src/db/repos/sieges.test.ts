import { CONTESTED_DISTRICTS, type BattleTarget } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../index.js';
import { createRepositories } from './index.js';

/**
 * One pending fight this build cannot read (bug pass, 2026-10-06).
 *
 * `due()` and `pending()` threw on it, which stopped every fight in the world resolving and
 * answered 500 on the battle board for everybody. They now leave it out and serve the rest, as the
 * history reader already did.
 */
describe('a pending fight this build cannot read', () => {
  it('is left out of the pending and due reads, and the rest are served', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    // The rows are what is being read, not who called them: no crew is needed behind the id.
    db.pragma('foreign_keys = OFF');
    const repos = createRepositories(db);
    const district = CONTESTED_DISTRICTS[0]!;
    const target: BattleTarget = {
      kind: 'location',
      districtId: district.id,
      locationId: district.locations[0]!.id,
    };
    const at = '2026-10-06T10:00:00.000Z';
    const fight = (id: string) =>
      repos.sieges.insert({
        id,
        target,
        attackerBaseId: 'b',
        defender: { kind: 'government' },
        scheduledFor: at,
        declaredAt: '2026-10-06T00:00:00.000Z',
        resolvedAt: null,
        seed: id,
        holdAfterCapture: true,
        wokeSleepers: false,
      });
    fight('readable');
    fight('broken');
    // A defender kind this build has never heard of, as a retired one would read.
    db.prepare('UPDATE scheduled_battles SET defender_json = ? WHERE id = ?').run(
      JSON.stringify({ kind: 'retired_party' }),
      'broken',
    );

    expect(repos.sieges.pending().map((battle) => battle.id)).toEqual(['readable']);
    expect(repos.sieges.due('2026-10-06T11:00:00.000Z').map((battle) => battle.id)).toEqual([
      'readable',
    ]);
  });
});
