import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_WITH_PARENT, ORPHAN_CHECK_MS, watchForOrphaning } from './orphan.js';

/**
 * The backstop that stops a server nobody is left to stop (`orphan.ts`).
 *
 * The parent pid is injected rather than reparented for real, because a test that forked a process
 * and killed its parent would be measuring the operating system's scheduler as much as this file.
 * What this file decides is: arm or not, and fire once when the number changes.
 */
describe('stopping when the parent is gone', () => {
  let parent = 4242;
  const read = () => parent;
  /** The environment a Playwright `webServer` runs in: the flag on. */
  const asked = { [EXIT_WITH_PARENT]: 'true' };

  beforeEach(() => {
    vi.useFakeTimers();
    parent = 4242;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once the parent is replaced by init, and only once', () => {
    const onOrphaned = vi.fn();
    watchForOrphaning({ onOrphaned, parentPid: read, env: asked });

    vi.advanceTimersByTime(ORPHAN_CHECK_MS * 3);
    expect(onOrphaned, 'fired while the parent was still there').not.toHaveBeenCalled();

    parent = 1;
    vi.advanceTimersByTime(ORPHAN_CHECK_MS);
    expect(onOrphaned).toHaveBeenCalledTimes(1);

    // A shutdown is in flight from here; a second call would be a second `process.kill`.
    vi.advanceTimersByTime(ORPHAN_CHECK_MS * 5);
    expect(onOrphaned).toHaveBeenCalledTimes(1);
  });

  /**
   * A supervised server is started *by* the supervisor, so its parent is pid 1 from the first
   * instant. Arming there would be a server that shuts itself down on a timer for no reason, which
   * is a worse bug than the one this file is for.
   */
  it('does not arm at all when it was already an orphan at boot', () => {
    const onOrphaned = vi.fn();
    parent = 1;
    const stop = watchForOrphaning({ onOrphaned, parentPid: read, env: asked });
    vi.advanceTimersByTime(ORPHAN_CHECK_MS * 10);
    expect(onOrphaned).not.toHaveBeenCalled();
    expect(() => stop(), 'the no-op stopper must still be callable').not.toThrow();
  });

  /** Reparenting anywhere counts, not only to pid 1: the claim is "not who started me". */
  it('fires when the parent changes to anything else', () => {
    const onOrphaned = vi.fn();
    watchForOrphaning({ onOrphaned, parentPid: read, env: asked });
    parent = 99;
    vi.advanceTimersByTime(ORPHAN_CHECK_MS);
    expect(onOrphaned).toHaveBeenCalledTimes(1);
  });

  /**
   * The flag is the whole of the arming decision (maintainer, 2026-09-20).
   *
   * "A launcher started me and then exited" is the same shape whether the launcher was Playwright
   * or a shell somebody backgrounded a server from, and this file cannot tell them apart. So it
   * does not try: it arms when it is asked to and never otherwise, which is why a deployment
   * cannot be caught by it however its parent behaves.
   */
  it('does not arm at all without the flag, whatever the parent does', () => {
    const onOrphaned = vi.fn();
    for (const env of [{}, { [EXIT_WITH_PARENT]: 'false' }, { [EXIT_WITH_PARENT]: '1' }]) {
      const stop = watchForOrphaning({ onOrphaned, parentPid: read, env });
      parent = 1;
      vi.advanceTimersByTime(ORPHAN_CHECK_MS * 10);
      expect(onOrphaned, JSON.stringify(env)).not.toHaveBeenCalled();
      stop();
      parent = 4242;
    }
    // ...and the same parent death with the flag on does fire, so the loop above is not vacuous.
    watchForOrphaning({ onOrphaned, parentPid: read, env: asked });
    parent = 1;
    vi.advanceTimersByTime(ORPHAN_CHECK_MS);
    expect(onOrphaned).toHaveBeenCalledTimes(1);
  });

  it('stops looking once it is told to', () => {
    const onOrphaned = vi.fn();
    const stop = watchForOrphaning({ onOrphaned, parentPid: read, env: asked });
    stop();
    parent = 1;
    vi.advanceTimersByTime(ORPHAN_CHECK_MS * 10);
    expect(onOrphaned).not.toHaveBeenCalled();
  });

  /**
   * The timer must never be the reason a finished process stays up, which would be this file
   * causing the exact bug it exists to prevent.
   */
  it('does not hold the event loop open', () => {
    const unref = vi.fn();
    const spy = vi.spyOn(global, 'setInterval').mockReturnValue({ unref } as never);
    watchForOrphaning({ onOrphaned: vi.fn(), parentPid: read, env: asked });
    expect(unref).toHaveBeenCalled();
    spy.mockRestore();
  });
});
