/**
 * Boot survives whatever is in `localStorage`.
 *
 * Whether this browser is signed in is the one piece of client state that outlives a reload, so it
 * is the one piece that can be *wrong* when the app starts: half-written by a tab that was closed
 * mid-save, left behind by an older shape of this store, hand-edited, or truncated by a browser
 * reclaiming space. A
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
import { SESSION_STORAGE_KEY, type useSession as UseSession } from './session';

/** A store that hydrates *now*, from whatever the case has just put in storage. */
const freshStore = async (): Promise<{ useSession: typeof UseSession }> => {
  vi.resetModules();
  return import('./session');
};

const USER = { id: 'u1', username: 'operator' } as never;

beforeEach(() => localStorage.clear());

describe('rehydrating the session', () => {
  it('remembers a sign-in from a previous visit', async () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ state: { signedIn: true }, version: 0 }),
    );
    const { useSession } = await freshStore();
    expect(useSession.getState().signedIn).toBe(true);
  });

  it('starts logged out rather than throwing when the stored value is not JSON', async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, 'not json at all {{{');
    const { useSession } = await freshStore();
    expect(useSession.getState().signedIn).toBe(false);
  });

  it('starts logged out when the stored value is JSON of the wrong shape', async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(['an', 'array']));
    const { useSession } = await freshStore();
    expect(useSession.getState().signedIn).toBe(false);
  });

  it('starts logged out on anything but a real true', async () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ state: { signedIn: 'yes' }, version: 0 }),
    );
    const { useSession } = await freshStore();
    expect(useSession.getState().signedIn).toBe(false);
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
      expect(useSession.getState().signedIn).toBe(false);
      // And the store is still usable: a session in memory is better than no app.
      useSession.getState().login(USER);
      expect(useSession.getState().signedIn).toBe(true);
    } finally {
      blocked.mockRestore();
    }
  });
});

/** The token lives in an httpOnly cookie now (security pass, 2026-09-30), and nowhere else. */
describe('what the browser keeps', () => {
  it('writes whether it is signed in, and nothing else', async () => {
    const { useSession } = await freshStore();
    useSession.getState().login(USER);
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!)).toEqual({
      state: { signedIn: true },
      version: 0,
    });
  });

  it('clears a token an older build left in storage', async () => {
    localStorage.setItem(
      'frontline.token',
      JSON.stringify({ state: { token: 'a-real-token' }, version: 0 }),
    );
    await freshStore();
    expect(localStorage.getItem('frontline.token')).toBeNull();
  });
});

/** Bug pass, 2026-10-06: the waste dialog sits outside the sign-in gate and outlived the session. */
describe('signing out with a question open', () => {
  it('declines the open waste question, so nothing is resent for the old account', async () => {
    const { useSession } = await freshStore();
    // The same module registry the fresh store was built against.
    const { askToWaste, useWasteConfirm } = await import('./wasteConfirm');
    useSession.getState().login(USER);
    const answered = askToWaste({ caps: 10 });
    expect(useWasteConfirm.getState().question).not.toBeNull();
    useSession.getState().logout();
    await expect(answered).resolves.toBe(false);
    expect(useWasteConfirm.getState().question).toBeNull();
  });
});
