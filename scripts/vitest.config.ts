import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['*.test.ts'],
    /*
     * Image work, timed against a machine that is doing three other suites at once.
     *
     * These tests key and re-encode real bitmaps through `sharp`: the slowest is the delivery audit
     * at about four seconds on an idle machine, and several sit between one and two. Vitest's
     * default is five, which is fine when this package runs alone and is not when `pnpm -r test`
     * runs all four workspaces in parallel: `keyBackground > cannot see an erasure shorter than the
     * run floor` measures 1.6s on its own and was tipping past five under that contention, so the
     * whole gate went red on a test that had not changed and was not wrong.
     *
     * Thirty rather than "a bit more than five", because the failure this must not have is a
     * *flaky* one: a ceiling set just above the loaded time is a ceiling that goes red again the
     * next time somebody adds a suite. It is still a ceiling, and a genuine hang still fails here,
     * seven to twenty times slower than the work these tests actually do.
     */
    testTimeout: 30_000,
  },
});
