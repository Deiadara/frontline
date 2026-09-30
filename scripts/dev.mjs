/**
 * `pnpm dev`: the API server and the client, and a Ctrl+C that always stops both.
 *
 * This used to be `pnpm --parallel ... dev`, and that runner could be left behind. A first Ctrl+C
 * starts the server's own clean stop, which takes a moment (a last backup, the database closed);
 * a second press while that is in flight ends the outer `pnpm dev` and its shell, and the parallel
 * runner underneath them was reassigned to launchd with its `tsx watch` and Vite still alive.
 * Measured on 2026-09-29: a runner from the day before was still up, with no parent and no
 * terminal of its own, and it restarted the server on every file edit and wrote the log into
 * whatever shell was in front. The rule this file exists for is the one in `CLAUDE.md`: the game
 * can always be stopped by Ctrl+C in the console.
 *
 * Three things make that true here:
 *
 * - Each child is started as its own **process group**, and a stop signals the group, so `tsx
 *   watch`'s server and Vite's esbuild go down with the process that spawned them.
 * - The first Ctrl+C asks (SIGTERM) and gives the children three seconds to close; the second
 *   does not ask (SIGKILL). Either way this runner exits when they are gone, and never before.
 * - The runner watches its own parent, the way `apps/client/e2e/vite-orphan-guard.mjs` does: if
 *   the shell that started it is gone, it stops everything and exits. An orphaned runner cannot
 *   happen, because an orphan is exactly what it stops on.
 *
 * Plain `.mjs` with no workspace imports, so it needs no build to start the build.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_MS = 2_000;
const GRACE_MS = 3_000;
const INIT_PID = 1;

/** The two halves, each run through pnpm so its own `dev` script is the one that runs. */
const CHILDREN = [
  { name: 'server', filter: '@frontline/server' },
  { name: 'client', filter: '@frontline/client' },
];

const running = CHILDREN.map(({ name, filter }) => {
  const child = spawn('pnpm', ['--filter', filter, 'dev'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    // Its own group, so a signal to `-pid` reaches everything it spawned in turn.
    detached: true,
  });
  return { name, child };
});

let stopping = false;
let code = 0;

function signalGroup(entry, signal) {
  if (entry.child.exitCode !== null || entry.child.signalCode !== null) return;
  try {
    process.kill(-entry.child.pid, signal);
  } catch {
    // Already gone.
  }
}

/** Ask once, then insist. One path whatever asked: a key, a signal, a parent that vanished. */
function stop(reason) {
  if (stopping) {
    for (const entry of running) signalGroup(entry, 'SIGKILL');
    return;
  }
  stopping = true;
  process.stderr.write(`\ndev: stopping (${reason})\n`);
  for (const entry of running) signalGroup(entry, 'SIGTERM');
  const hard = setTimeout(() => {
    for (const entry of running) signalGroup(entry, 'SIGKILL');
  }, GRACE_MS);
  hard.unref();
}

function maybeExit() {
  if (running.every(({ child }) => child.exitCode !== null || child.signalCode !== null)) {
    process.exit(code);
  }
}

for (const entry of running) {
  entry.child.on('exit', (exitCode) => {
    // One half going down on its own takes the other with it: half a game is not a game.
    if (!stopping) {
      code = exitCode ?? 0;
      stop(`${entry.name} exited`);
    }
    maybeExit();
  });
}

process.on('SIGINT', () => stop('Ctrl+C'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGHUP', () => stop('the terminal closed'));

const startedUnder = process.ppid;
if (startedUnder !== INIT_PID) {
  const watch = setInterval(() => {
    if (process.ppid === INIT_PID || process.ppid !== startedUnder) stop('the shell is gone');
  }, CHECK_MS);
  watch.unref();
}
