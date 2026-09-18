import type { ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Overridable so the e2e stack can run on its own ports beside a live dev stack.
const clientPort = Number(process.env.CLIENT_PORT ?? 5173);
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

/**
 * The name of the flag `playwright.config.ts` sets on the dev server it starts for a run.
 *
 * Exported so the pairing is one symbol rather than two copies of a string: the Playwright config
 * imports this and puts it in the server's environment, and `scripts/e2e-isolation.test.ts` fails
 * if either half goes missing.
 */
export const E2E_ISOLATED = 'E2E_ISOLATED';

/**
 * Whether this dev server is the one a Playwright run started, in which case **hot reload is off**.
 *
 * Several agents share one working tree, and `pnpm test` in any workspace runs
 * `pnpm --filter @frontline/shared build` first. A build writes about two hundred files into
 * `packages/shared/dist`, the dev server watches every one of them, and the page under test is
 * handed a hot update per file. React Fast Refresh cannot preserve state across a module that
 * re-exports a shared value, so it remounts the game shell instead: measured at 81 remounts of
 * `GameScreen` from a single `touch` of that directory, over seventeen seconds.
 *
 * A remount restarts every timer the screen owns before it can fire. `useServerClock` ticks once a
 * second and the district polls every five, so at two remounts a second neither ever runs: the
 * build countdown freezes on the figure it last drew and `GET /base/:id` is never re-read, which
 * leaves a finished structure reading "under construction" for as long as the rebuild lasts. That
 * is what failed `live.spec.ts` at the ninety-second wait, and nothing about it is a fault in the
 * game: the page is fine, it is being rebuilt underneath itself.
 *
 * The run does not need hot reload. Nothing edits the client between `page.goto` and the last
 * assertion, so the only thing the channel can deliver is somebody else's build.
 */
const isolated = process.env[E2E_ISOLATED] === '1';

/**
 * What the dev proxy says when the API is not answering (maintainer report, 2026-09-17).
 *
 * `pnpm dev` runs the API under `tsx watch`, so every save on the server restarts it, and for the
 * second or two that takes every request the page has in flight is refused. The default handler
 * prints an `AggregateError [ECONNREFUSED]` with a Node internals stack per request, which reads
 * like a crash, buries whatever else is in the terminal, and says nothing about what to do.
 *
 * Two things instead. The terminal gets one line naming the target, and the **browser** gets a 503
 * carrying the error shape `apiFetch` already parses, so a screen caught mid-restart draws its own
 * refusal strip rather than "Failed to fetch" or, worse, a proxy HTML page through `res.json()`.
 *
 * Deliberately not a retry. A restart is over in a second and the client polls, but an API that is
 * genuinely down should look down: swallowing this into a silent retry is how a stack sits broken
 * for ten minutes with a quiet console.
 */
function explainProxyFailure(error: Error, response: ServerResponse | undefined): void {
  const refused = 'code' in error && (error as { code?: string }).code === 'ECONNREFUSED';
  console.warn(
    refused
      ? `[api] ${apiTarget} is not answering. It is probably restarting; if not, start it with pnpm dev.`
      : `[api] proxy error against ${apiTarget}: ${error.message}`,
  );
  // `undefined` on a websocket upgrade, where there is no response to write to.
  if (response === undefined || response.headersSent) return;
  response.writeHead(503, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      error: {
        code: 'API_DOWN',
        message: 'The server is not answering. If it is restarting, this clears on its own.',
      },
    }),
  );
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: clientPort,
    strictPort: true,
    // Off for the e2e stack, on everywhere else. See `E2E_ISOLATED`.
    ...(isolated ? { hmr: false as const } : {}),
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (error, _request, response) => {
            // A websocket upgrade hands a socket here rather than a response, and a socket has
            // nothing to write a status onto.
            explainProxyFailure(error, 'writeHead' in response ? response : undefined);
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
