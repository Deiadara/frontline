import { displayNameOf } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * The name a player goes by, read off their id, or `fallback` for an account that is gone.
 *
 * Every screen prints `displayNameOf` since 2026-10-02; the auction bells and bid lists read the
 * login name off the row, so a loser read "went to sable_login" about a crew every other screen
 * calls Sable.
 */
export function shownNameOf<T extends string | null>(
  repos: Repositories,
  userId: string,
  fallback: T,
): string | T {
  const user = repos.users.findById(userId);
  return user ? displayNameOf(user) : fallback;
}
