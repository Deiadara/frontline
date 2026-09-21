import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The e2e dev server runs with hot reload off, and both halves of that have to stay.
 *
 * All the agents on this project share one working tree, and `pnpm test` in any workspace runs
 * `pnpm --filter @frontline/shared build` before it does anything else. That build writes about two
 * hundred files into `packages/shared/dist`. A dev server with hot reload on watches every one of
 * them and pushes an update per file at whatever page is open, and React Fast Refresh answers a
 * module that re-exports a shared value by remounting the tree under it. Measured: one `touch` of
 * that directory remounted the game shell 81 times over seventeen seconds.
 *
 * What that costs a Playwright run is every timer on the screen. A remount restarts them, so a
 * one-second clock and a five-second poll that are restarted twice a second never fire at all: the
 * build countdown freezes on the last figure it drew and the district is never re-read, which is
 * how `live.spec.ts` sat for ninety seconds watching a finished structure say "under construction".
 *
 * It is two files, so it can be half-removed: the flag is set in `playwright.config.ts` and read in
 * `vite.config.ts`, and dropping either one puts hot reload back without anything going red. Hence
 * this, which asserts both ends and the off switch between them.
 */

const CLIENT = '../apps/client';

afterEach(() => {
  vi.resetModules();
  delete process.env['E2E_ISOLATED'];
});

/** The vite config as it comes out with `E2E_ISOLATED` set to `value`, or unset for `null`. */
async function viteServer(value: string | null): Promise<Record<string, unknown>> {
  vi.resetModules();
  if (value === null) delete process.env['E2E_ISOLATED'];
  else process.env['E2E_ISOLATED'] = value;
  const loaded = (await import(`${CLIENT}/vite.config`)) as {
    default: { server: Record<string, unknown> };
  };
  return loaded.default.server;
}

describe('the e2e client', () => {
  it('is started with the isolation flag on', async () => {
    const { E2E_ISOLATED } = (await import(`${CLIENT}/vite.config`)) as { E2E_ISOLATED: string };
    const config = (await import(`${CLIENT}/playwright.config`)) as {
      default: { webServer: { command: string; env: Record<string, string> }[] };
    };
    /*
     * Found by `vite` rather than by `dev`, which is what the command used to say.
     *
     * The client server is started through `e2e/vite-orphan-guard.mjs` since 2026-09-20, so that
     * an interrupted run does not leave Vite holding port 5175. `pnpm dev` was the old command and
     * the word `dev` was how this line recognised it; `vite` is in the name of the thing being
     * started either way, which is the part that cannot change without this gate deserving to
     * fail.
     */
    const client = config.default.webServer.find((server) => server.command.includes('vite'));
    expect(client, 'playwright no longer starts a vite dev server').toBeDefined();
    expect(client?.env[E2E_ISOLATED]).toBe('1');
  });

  it('turns hot reload off when it is', async () => {
    expect((await viteServer('1')).hmr).toBe(false);
  });

  /*
   * The other half of the switch, which is the half that makes the first one mean something: with
   * no flag the server has to be the ordinary one a developer works against, hot reload and all.
   * Without this, `hmr: false` written unconditionally would pass the test above and take every
   * save in the repo with it.
   */
  it('leaves hot reload alone for an ordinary dev server', async () => {
    expect((await viteServer(null)).hmr).toBeUndefined();
    expect((await viteServer('0')).hmr).toBeUndefined();
  });
});
