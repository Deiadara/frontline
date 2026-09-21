import { describe, expect, it } from 'vitest';
import { skipHeavy, skipNote } from './heavy.js';

/**
 * The rule that decides whether a slow file runs (`heavy.ts`).
 *
 * The change list and the environment are both injected, because what is being tested is the
 * decision and not git. A test that shelled out would be measuring the repository's own state on
 * the day it ran, which is the one input that is never the same twice.
 */
const COVERS = ['assets/', 'scripts/encode-art.ts'] as const;
const nothing = () => [] as const;
const art = () => ['assets/unit-syndic.webp'] as const;
const elsewhere = () => ['apps/client/src/features/units/UnitCard.tsx'] as const;

describe('gating a heavy test file', () => {
  it('skips when nothing it covers has changed', () => {
    expect(skipHeavy({ covers: COVERS, changed: nothing, env: {} })).toBe(true);
    expect(skipHeavy({ covers: COVERS, changed: elsewhere, env: {} })).toBe(true);
  });

  it('runs when something it covers has changed', () => {
    expect(skipHeavy({ covers: COVERS, changed: art, env: {} })).toBe(false);
  });

  /** A pipeline must never silently skip a suite: on a build machine the diff is usually empty. */
  it('runs on CI whatever the diff says', () => {
    expect(skipHeavy({ covers: COVERS, changed: nothing, env: { CI: 'true' } })).toBe(false);
    // Even an empty string counts: `CI=` is still a CI saying it is one.
    expect(skipHeavy({ covers: COVERS, changed: nothing, env: { CI: '' } })).toBe(false);
  });

  it('runs when it is asked to', () => {
    expect(skipHeavy({ covers: COVERS, changed: nothing, env: { ART_TESTS: '1' } })).toBe(false);
  });

  /**
   * A gate that fails towards silence stops being a gate the first time its own plumbing breaks.
   * `null` is what `changedPaths` returns when git cannot answer: no repository, no commits yet,
   * a worktree it does not understand.
   */
  it('runs when it cannot tell what changed', () => {
    expect(skipHeavy({ covers: COVERS, changed: () => null, env: {} })).toBe(false);
  });

  it('says so when it skips, so a short run never reads as a passing one', () => {
    const said = skipNote('encode-art.test.ts', COVERS);
    expect(said).toContain('encode-art.test.ts');
    expect(said).toContain('assets/');
    expect(said, 'the note must say how to override it').toContain('ART_TESTS=1');
  });
});
