import { OVERSEER_PRESETS, overseerFromPreset } from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../index.js';
import { createRepositories, type Repositories } from './index.js';

/**
 * The file reads the preset's words, not the row's copy.
 *
 * A biography is stamped onto the row when the file is opened, and a preset rewritten since then
 * (every dash came out of them on 2026-09-23) never reached a file already on the shelf: one live
 * row still read "Never fires first, dash, someone always owes him". The row's copy is only what the
 * file says for a preset that has left the pool.
 */

const dbs: AppDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));

function openStack(): { repos: Repositories; db: AppDatabase } {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return { repos: createRepositories(db), db };
}

function keeper(repos: Repositories, userId: string) {
  repos.users.insert({
    id: userId,
    username: userId,
    passwordHash: 'x',
    createdAt: new Date().toISOString(),
  });
}

describe('an overseer read off the shelf', () => {
  it('carries the biography the preset has now, not the one stamped on the row', () => {
    const { repos } = openStack();
    keeper(repos, 'user-1');
    const preset = OVERSEER_PRESETS[0]!;
    const minted = overseerFromPreset(preset, 'overseer-1');
    repos.overseers.insert({
      overseer: { ...minted, bio: 'Never fires first \u2014 someone always owes him.' },
      userId: 'user-1',
      presetId: preset.presetId,
      createdAt: new Date().toISOString(),
    });

    expect(repos.overseers.findById('overseer-1')?.bio).toBe(preset.bio);
  });

  it('falls back to the row for a preset that has left the pool', () => {
    const { repos } = openStack();
    keeper(repos, 'user-1');
    const minted = overseerFromPreset(OVERSEER_PRESETS[0]!, 'overseer-1');
    repos.overseers.insert({
      overseer: { ...minted, bio: 'A face the pool has forgotten.' },
      userId: 'user-1',
      presetId: 'a_preset_that_was_retired',
      createdAt: new Date().toISOString(),
    });

    expect(repos.overseers.findById('overseer-1')?.bio).toBe('A face the pool has forgotten.');
  });
});
