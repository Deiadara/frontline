import type Database from 'better-sqlite3';

/**
 * Side effects held until the write they describe has committed (maintainer, 2026-09-29).
 *
 * The live nudges are why this exists. `notify` publishes straight after its insert, inside
 * whatever transaction its caller holds, so a route that settled a crew and then refused rolled the
 * receipt back after the chime had already gone out. The next read settled the same build again
 * and chimed a second time. The rule is "chime after commit": a publish made inside a transaction
 * waits for the outermost commit and is dropped if anything rolls it back.
 *
 * One stack for the process. better-sqlite3 runs a transaction synchronously from start to finish,
 * so nothing else can run while one is open, and a transaction opened inside another is a
 * savepoint, which is a stack as well: each level holds its own work, hands it to the level below
 * when it releases, and throws it away when it rolls back.
 */
const held: (() => void)[][] = [];

/** Runs `work` now when no transaction is open, or once the one that is open has committed. */
export function afterCommit(work: () => void): void {
  const open = held.at(-1);
  if (open) open.push(work);
  else work();
}

function holdUntilCommit<T>(run: () => T): T {
  held.push([]);
  let result: T;
  try {
    result = run();
  } catch (error) {
    // Rolled back, savepoint or whole transaction: what it announced did not happen.
    held.pop();
    throw error;
  }
  const done = held.pop() ?? [];
  const outer = held.at(-1);
  if (outer) outer.push(...done);
  else for (const work of done) work();
  return result;
}

/**
 * Makes every transaction on this handle hold {@link afterCommit} work until it commits.
 *
 * Done once, where the handle is opened, rather than at every place that opens a transaction: a
 * route written tomorrow gets it without knowing it exists. All four variants are
 * wrapped, because `.immediate()` is how the seed opens its own.
 */
export function holdEffectsUntilCommit(db: Database.Database): void {
  const open = db.transaction.bind(db);
  db.transaction = ((fn: (...params: unknown[]) => unknown) => {
    const tx = open(fn);
    // No `this` is threaded through: nothing in this server writes a transaction that reads one.
    const holding =
      (variant: (...params: unknown[]) => unknown) =>
      (...params: unknown[]) =>
        holdUntilCommit(() => variant(...params));
    return Object.assign(holding(tx), {
      default: holding((...params) => tx.default(...params)),
      deferred: holding((...params) => tx.deferred(...params)),
      immediate: holding((...params) => tx.immediate(...params)),
      exclusive: holding((...params) => tx.exclusive(...params)),
    });
  }) as Database.Database['transaction'];
}
