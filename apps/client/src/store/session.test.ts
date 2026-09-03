/**
 * Boot survives whatever is in `localStorage`.
 *
 * The token is the one piece of client state that outlives a reload, so it is the one piece that
 * can be *wrong* when the app starts: half-written by a tab that was closed mid-save, left behind
 * by an older shape of this store, hand-edited, or truncated by a browser reclaiming space. A
 * `JSON.parse` on the boot path with no answer for that is the difference between a stale login and
 * an app that shows a blank page and never recovers, because clearing the bad value requires
 * devtools the player does not have.
 *
 * `persist` does handle it. That is a fact about a dependency rather than about this code, which is
 * exactly why it is pinned here: a zustand upgrade that changed it would otherwise be found by a
 * player in a private window rather than by us.
 *
 * Each case resets the module registry before importing. `persist` hydrates once, at module
 * evaluation, so a shared import would read whatever the first case happened to write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_STORAGE_KEY, type useSession as UseSession } from './session';

/** A store that hydrates *now*, from whatever the case has just put in storage. */
const freshStore = async (): Promise<{ useSession: typeof UseSession }> => {
  vi.resetModules();
  return import('./session');
};

beforeEach(() => localStorage.clear());

describe('rehydrating the session', () => {
  it('brings back a token written by a previous visit', async () => {
    localStorage.setItem(
      TOKEN_STORAGE_KEY,
      JSON.stringify({ state: { token: 'a-real-token' }, version: 0 }),
    );
    const { useSession } = await freshStore();
    expect(useSession.getState().token).toBe('a-real-token');
  });

  it('starts logged out rather than throwing when the stored value is not JSON', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'not json at all {{{');
    const { useSession } = await freshStore();
    expect(useSession.getState().token).toBeNull();
  });

  it('starts logged out when the stored value is JSON of the wrong shape', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(['an', 'array']));
    const { useSession } = await freshStore();
    expect(useSession.getState().token).toBeNull();
  });

  /**
   * Safari in a private window, and any browser set to block site data, throw on *touching*
   * `localStorage` rather than returning null from it. Reading it at module scope without an answer
   * for that takes the whole bundle down before React mounts.
   */
  it('still creates the store when localStorage cannot be reached at all', async () => {
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    try {
      const { useSession } = await freshStore();
      expect(useSession.getState().token).toBeNull();
      // And the store is still usable: a session in memory is better than no app.
      useSession.getState().login('in-memory', { id: 'u1', email: 'a@b.c' } as never);
      expect(useSession.getState().token).toBe('in-memory');
    } finally {
      blocked.mockRestore();
    }
  });
});
