import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No module may import its own package barrel, and no new import cycle may appear (2026-09-24).
 *
 * A barrel re-exports every sibling, so a module that imports one pulls in the whole folder and
 * closes a loop through itself. ESM tolerates a loop right up until something is read at module
 * **initialisation** time across it, and then the const reads as `undefined` with no error at the
 * point of the mistake. It surfaces later, somewhere else, as a `ReferenceError` or as an empty
 * array quietly folded into a catalogue.
 *
 * Three of those loops were live when this was written: `building/unit-slots.ts`, `units/catalog.ts`
 * and `units/unlocks.ts` each imported `building/index.js` or `./index.js` for symbols that live in
 * a named sibling. All three were fixed by importing from the module that defines the symbol, which
 * is the rule this file now holds.
 *
 * The loop that remains is a genuine mutual dependency between siblings and is listed by name
 * below. Nothing in it reads across the loop at module scope, which is what makes it survivable,
 * and the list is a ratchet: it may shrink, and a new entry has to be argued for.
 *
 * Reaching a *sibling* folder through its barrel is not banned, and a first cut of this file did
 * ban it: twenty-seven modules do it, it is the house convention, and it is harmless right up until
 * it closes a loop. The loop is the thing that hurts, so the loop is the thing that is gated. What
 * stays banned outright is a module importing the barrel of the folder it is already in, which can
 * never be anything but a loop through itself.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Cycles that exist, are understood, and are read only from inside function bodies. */
const KNOWN_CYCLES: readonly string[][] = [
  ['units/catalog.ts', 'units/upgrades.ts', 'units/modifications.ts'],
];

interface Module {
  readonly file: string;
  readonly imports: readonly string[];
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) found.push(full);
  }
  return found;
}

/** Value imports only: a `import type` is erased and cannot close a runtime loop. */
function valueImports(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const match of src.matchAll(
    /^\s*(?:import|export)\s+(type\s+)?[^'"]*from\s+'(\.[^']*)'/gm,
  )) {
    if (match[1]) continue;
    let target = path.normalize(path.join(path.dirname(file), match[2]!.replace(/\.js$/, '.ts')));
    if (!fs.existsSync(target)) {
      const asFolder = target.replace(/\.ts$/, '/index.ts');
      if (fs.existsSync(asFolder)) target = asFolder;
    }
    if (fs.existsSync(target)) out.push(target);
  }
  return out;
}

const MODULES: Module[] = sourceFiles(HERE).map((file) => ({
  file,
  imports: valueImports(file),
}));

const shown = (file: string) => path.relative(HERE, file);

describe('how the modules import one another', () => {
  it('sweeps a real number of files, so a broken walk cannot pass by finding nothing', () => {
    expect(MODULES.length).toBeGreaterThan(100);
    expect(MODULES.some((one) => one.imports.length > 0)).toBe(true);
  });

  it('never imports the barrel of the folder it is already in', () => {
    const offenders = MODULES.filter((one) =>
      one.imports.some(
        (target) =>
          target.endsWith(`${path.sep}index.ts`) &&
          path.dirname(target) === path.dirname(one.file) &&
          path.basename(one.file) !== 'index.ts',
      ),
    ).map((one) => shown(one.file));
    expect(offenders, 'these import their own folder barrel').toEqual([]);
  });

  it('grows no import cycle that is not already on the list', () => {
    const graph = new Map(MODULES.map((one) => [one.file, one.imports]));
    const state = new Map<string, 'open' | 'done'>();
    const found: string[][] = [];

    const walk = (node: string, stack: string[]): void => {
      if (state.get(node) === 'done') return;
      if (state.get(node) === 'open') {
        found.push(stack.slice(stack.indexOf(node)).map(shown));
        return;
      }
      state.set(node, 'open');
      stack.push(node);
      for (const next of graph.get(node) ?? []) if (graph.has(next)) walk(next, stack);
      stack.pop();
      state.set(node, 'done');
    };
    for (const node of graph.keys()) walk(node, []);

    const key = (cycle: readonly string[]) => [...cycle].sort().join(' + ');
    const allowed = new Set(KNOWN_CYCLES.map(key));
    const fresh = [...new Set(found.map(key))].filter((one) => !allowed.has(one));
    expect(fresh, 'new import cycles').toEqual([]);

    // The list is a ratchet: an entry that has been fixed has to come off it, or the next one
    // added goes unnoticed behind it.
    const live = new Set(found.map(key));
    expect(
      [...allowed].filter((one) => !live.has(one)),
      'cycles listed but gone',
    ).toEqual([]);
  });
});
