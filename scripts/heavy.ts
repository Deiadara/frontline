import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Whether a slow test file has any reason to run right now (maintainer, 2026-09-21).
 *
 * "Make sure some tests are gated and not run all the time if they are heavy, and we can run them
 * only if needed, if we changed something that they test directly."
 *
 * One file in this repo is a genuine outlier. Measured on 2026-09-21, the whole `@frontline/scripts`
 * suite is 22.4 seconds of test time and `encode-art.test.ts` is 20.5 of it: the next slowest file
 * is 627ms, so that one file is thirty times its nearest neighbour. It decodes, crops, keys and
 * re-encodes real images through `sharp`, which is CPU-bound in a way nothing else here is.
 *
 * That cost is only paid on the wrong days. `pnpm -r test` runs the four workspaces at once, and
 * under that contention the art file has been measured at 283 and 831 seconds, failing on timeouts
 * that have nothing to do with the code: the same file alone passes 91 of 91 in 21 seconds. A gate
 * that reddens for load teaches people to re-run rather than to read, which is worse than no gate.
 *
 * ## What "a reason to run" means
 *
 * The file is skipped only when **all** of these hold:
 *
 *  - `ART_TESTS` is not set. That is the override for running it deliberately.
 *  - `CI` is not set. A pipeline must never silently skip a suite: on a build machine the answer
 *    is always yes, whatever the diff says, because the diff there is usually empty.
 *  - git can answer, and says nothing under the paths the file covers has changed against `HEAD`.
 *
 * Anything that cannot be determined runs the tests. A gate that fails towards silence is a gate
 * that stops being a gate the first time its own plumbing breaks.
 *
 * ## Why against `HEAD` and not a branch point
 *
 * Because what this is for is the edit loop: a developer who has just changed a component and runs
 * the suite should not pay twenty seconds for the art encoder. Once the work is committed the
 * question moves to CI, where `CI` is set and everything runs regardless. Comparing against a merge
 * base would be the right call for a per-pull-request gate and the wrong one for this.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

export interface HeavyGateOptions {
  /** Repo-relative path prefixes this file's subject lives under. */
  readonly covers: readonly string[];
  /** Injected by the test: the real one shells out to git. */
  readonly changed?: () => readonly string[] | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Every path that differs from `HEAD`, tracked and untracked alike, or null if git cannot say.
 *
 * Untracked matters as much as modified here: a newly delivered `.webp` that nothing has committed
 * yet is exactly the change the art gates exist to check, and `git diff` alone would not see it.
 */
export function changedPaths(): readonly string[] | null {
  const run = (args: readonly string[]): string[] =>
    execFileSync('git', [...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  try {
    return [
      ...run(['diff', '--name-only', 'HEAD']),
      ...run(['ls-files', '--others', '--exclude-standard']),
    ];
  } catch {
    // No git, no commits yet, a detached worktree: all of them mean "cannot say", which runs.
    return null;
  }
}

/** Whether this file's tests should be skipped on this run. */
export function skipHeavy(options: HeavyGateOptions): boolean {
  const env = options.env ?? process.env;
  if (env['ART_TESTS'] !== undefined || env['CI'] !== undefined) return false;
  const changed = (options.changed ?? changedPaths)();
  if (changed === null) return false;
  return !changed.some((file) => options.covers.some((prefix) => file.startsWith(prefix)));
}

/** What to print when a file skips itself, so a short run never looks like a passing one. */
export function skipNote(name: string, covers: readonly string[]): string {
  return `${name}: skipped, nothing changed under ${covers.join(', ')}. Run with ART_TESTS=1 to force.`;
}
