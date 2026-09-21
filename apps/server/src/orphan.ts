/**
 * Stop when whoever started this process is gone (maintainer, 2026-09-20: "Ctrl+C still does not
 * kill the game").
 *
 * ## What actually happens
 *
 * Playwright starts its `webServer` entries **detached**, in a process group of their own, so a
 * Ctrl+C in the terminal reaches Playwright and nothing under it. Killing them is then Playwright's
 * own teardown, and an interrupt is exactly the path where that teardown does not finish.
 * Measured on 2026-09-20 by interrupting a real run: the API server survived on port 4010 with its
 * parent reassigned to launchd (`ppid` 1), and the Vite server survived on 5175. `reuseExistingServer`
 * is false for both, so the *next* run then fails to start at all: "http://localhost:4010/health is
 * already used".
 *
 * The 2026-09-04 pass fixed the shape of the command, so the process Playwright kills is the server
 * rather than a shell above it (`playwright.config.ts` still records that, and it is still right).
 * What it could not fix is a teardown that never runs. This is the other half: rather than trusting
 * the parent to kill the child, the child notices the parent is gone.
 *
 * ## Why `ppid` and not something better
 *
 * There is no portable "die with your parent" on macOS (`PR_SET_PDEATHSIG` is Linux only). Watching
 * the pipe would work where a parent gives one, and Playwright's webServer stdio is not something
 * this process gets to depend on. `process.ppid` is in Node's core API, costs a read every few
 * seconds, and becomes 1 the moment the parent dies: that is the whole signal.
 *
 * ## Why this cannot fire on a real deployment
 *
 * Because it does not arm unless it is asked to, by {@link EXIT_WITH_PARENT} in the environment,
 * and the only thing that sets it is `playwright.config.ts`.
 *
 * Opting in rather than reading the shape of the process tree, and that is a correction rather
 * than caution. Measured on 2026-09-20: "a launcher started the server and then exited" is the
 * *same* shape whether the launcher was Playwright or a shell that a developer backgrounded a
 * server from, and this cannot tell them apart. It also raced: a launcher that exited before the
 * server finished booting left `process.ppid` already 1 at arm time, so the watch never armed and
 * the very case it exists for slipped through. An environment flag has neither problem, and the
 * question it replaces ("should a backgrounded server die with its launcher?") is one this file
 * has no business answering on anybody's behalf.
 *
 * `pnpm dev` is unaffected either way and always was: Ctrl+C there reaches the whole process group
 * and the server's own SIGINT handler stops it in about a tenth of a second. That was measured
 * twice, before and after this file existed. The only thing that ever survived was a `webServer`
 * Playwright had started detached.
 */

/** The environment flag that turns this on. Set by `playwright.config.ts` and by nothing else. */
export const EXIT_WITH_PARENT = 'EXIT_WITH_PARENT';

/** How often to look. Slow: this is a backstop, not a heartbeat, and the check is a syscall. */
export const ORPHAN_CHECK_MS = 2_000;

/** The pid every orphan is reassigned to. */
const INIT_PID = 1;

export interface OrphanWatchOptions {
  /** Called once, when the parent is gone. Expected to shut the process down. */
  onOrphaned: () => void;
  /** Injected by the test: the real one is `() => process.ppid`. */
  parentPid?: () => number;
  /** Injected by the test: the real one is `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  everyMs?: number;
}

/**
 * Starts the watch, and hands back the way to stop it.
 *
 * Returns a no-op stopper when there is nothing to watch, so a caller never has to ask which case
 * it got. The timer is `unref`'d: a backstop must never be the reason a process that is otherwise
 * finished stays alive, which would be this file causing the exact bug it exists to prevent.
 */
export function watchForOrphaning(options: OrphanWatchOptions): () => void {
  const env = options.env ?? process.env;
  // Off unless asked. See the note above: the shape of the process tree cannot tell a dead test
  // runner from a dead login shell, and only one of those means this server should stop.
  if (env[EXIT_WITH_PARENT] !== 'true') return () => undefined;

  const read = options.parentPid ?? (() => process.ppid);
  const started = read();
  // Already an orphan, so there is no parent whose death could mean anything.
  if (started === INIT_PID) return () => undefined;

  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    const now = read();
    // `!== started` as well as `=== INIT_PID`: on macOS an orphan is reparented to launchd, which
    // is pid 1, and this way the watch is also right on a system that reparents somewhere else.
    if (now === INIT_PID || now !== started) {
      fired = true;
      options.onOrphaned();
    }
  }, options.everyMs ?? ORPHAN_CHECK_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
