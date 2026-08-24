import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontStacks } from './theme/tokens';

/*
 * A font URL is the one kind of reference nothing else in this repo checks.
 *
 * Swapping the interface font left `index.html` preloading `/fonts/orbitron-latin.woff2` after
 * that file was deleted, and every other gate passed on it: typecheck, lint, the unit suite and
 * the whole Playwright matrix. A 404 on a preload is silent, the page still renders, and the
 * geometry gates only assert that *some* face of the display family loaded, which a different
 * weight satisfies. It was caught by hand, which is not a control. The cost would have been paid
 * by the player, whose first paint fetches a file that is not there.
 *
 * These are string-to-file checks, so they run in the unit suite rather than needing a browser.
 */

/* Vitest runs with the client package as its root, so paths resolve against it. A wrong cwd
   throws out of `readFileSync` rather than passing vacuously. */
const read = (relative: string): string => readFileSync(resolve(relative), 'utf8');

const shipped = new Set(
  readdirSync(resolve('public/fonts')).filter((name) => name.endsWith('.woff2')),
);

const referenced = (source: string): string[] =>
  [...source.matchAll(/\/fonts\/([\w-]+\.woff2)/g)].flatMap((match) => match[1] ?? []);

const cssRefs = referenced(read('src/fonts.css'));
const htmlRefs = referenced(read('index.html'));

/** The families `fontStacks` expects `fonts.css` to declare, ignoring generic CSS keywords. */
const declaredFamilies = new Set(
  [...read('src/fonts.css').matchAll(/font-family:\s*'([^']+)'/g)].flatMap((m) => m[1] ?? []),
);
const vendoredFamilies = [...new Set(Object.values(fontStacks).flat())].filter(
  (family) => !family.startsWith('ui-') && !['system-ui', 'sans-serif'].includes(family),
);

describe('vendored webfonts', () => {
  it('declares an @font-face for every family fontStacks names', () => {
    expect(vendoredFamilies.length).toBeGreaterThan(0);
    for (const family of vendoredFamilies) expect([...declaredFamilies]).toContain(family);
  });

  it('only ever names a file that is actually shipped', () => {
    expect(cssRefs.length).toBeGreaterThan(0);
    expect(htmlRefs.length).toBeGreaterThan(0);
    for (const file of [...cssRefs, ...htmlRefs]) expect([...shipped]).toContain(file);
  });

  it('ships no .woff2 that nothing references', () => {
    expect([...shipped].filter((file) => !cssRefs.includes(file))).toEqual([]);
  });
});
