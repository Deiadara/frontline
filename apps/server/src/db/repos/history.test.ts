import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../index.js';
import { createRepositories } from './index.js';

/** The trail's housekeeping (maintainer, 2026-10-06): a week of backup lines and no more. */
describe('forgetting old lines of one kind', () => {
  it('drops that kind older than the mark, and nothing else', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const repos = createRepositories(db);
    const line = (kind: 'backup.taken' | 'account.password_changed', at: string) =>
      repos.history.record({ actorId: null, baseId: null, kind, payload: {}, at });
    line('backup.taken', '2026-09-20T00:00:00.000Z');
    line('backup.taken', '2026-10-05T00:00:00.000Z');
    line('account.password_changed', '2026-09-20T00:00:00.000Z');

    repos.history.forgetOlder('backup.taken', '2026-09-29T00:00:00.000Z');

    const left = repos.history.recent(10).map((event) => `${event.kind}@${event.at}`);
    expect(left.sort()).toEqual([
      'account.password_changed@2026-09-20T00:00:00.000Z',
      'backup.taken@2026-10-05T00:00:00.000Z',
    ]);
  });
});
