/**
 * Runs Vite for the e2e stack and takes it down when whoever started it is gone.
 *
 * Playwright starts each `webServer` **detached**, in a process group of its own, so a Ctrl+C in
 * the terminal reaches Playwright and nothing under it. Killing the servers is then Playwright's
 * own teardown, and an interrupt is exactly the path where that teardown does not finish.
 * Measured on 2026-09-20 by interrupting a real run: both servers outlived it, and since
 * `reuseExistingServer` is false for both, the *next* run refused to start on a port that was
 * "already used".
 *
 * The API server solves this inside itself (`apps/server/src/orphan.ts`), which is the better
 * place when you own the process. Vite is somebody else's program, so it gets a parent whose only
 * job is to notice and to kill it. That is one layer back above the server Playwright spawns,
 * which the 2026-09-04 pass deliberately removed from the API side; the difference is that this
 * layer exists *to* kill what is under it rather than merely to find it.
 *
 * Plain `.mjs` and no imports from the workspace on purpose: Playwright runs this before anything
 * is built, and a wrapper that needs a build step is a wrapper that cannot start the build.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** How often to look. Slow: a backstop, not a heartbeat. Matches `orphan.ts`. */
const CHECK_MS = 2_000;
const INIT_PID = 1;

const here = path.dirname(fileURLToPath(import.meta.url));
const vite = path.join(here, '..', 'node_modules', 'vite', 'bin', 'vite.js');

const child = spawn(process.execPath, [vite, ...process.argv.slice(2)], {
  cwd: path.join(here, '..'),
  stdio: 'inherit',
});

let stopping = false;

/** Take Vite with us, then go. One path, whatever asked. */
function stop(code) {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  // It gets a moment to close its own sockets, then it does not get a choice. Unref'd so this
  // timer is never the reason the wrapper outlives the thing it is waiting for.
  const hard = setTimeout(() => {
    child.kill('SIGKILL');
    process.exit(code);
  }, 3_000);
  hard.unref();
  child.once('exit', () => {
    clearTimeout(hard);
    process.exit(code);
  });
}

const startedUnder = process.ppid;
if (startedUnder !== INIT_PID) {
  const watch = setInterval(() => {
    if (process.ppid === INIT_PID || process.ppid !== startedUnder) stop(0);
  }, CHECK_MS);
  watch.unref();
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
child.on('exit', (code) => {
  if (!stopping) process.exit(code ?? 0);
});
