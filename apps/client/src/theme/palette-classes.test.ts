import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chrome, palette, ramps } from './tokens';

/*
 * Tailwind silently drops a class it cannot resolve, so a colour utility naming a shade the theme
 * does not define is invisible to every other gate in this repo.
 *
 * `tsc` sees a string. `eslint` sees a string. The component renders, the element gets the class
 * attribute, and the browser finds no rule for it, so the element falls back to whatever it
 * inherits or to Tailwind's preflight default. That default is `#e5e7eb` for a border and
 * `rgb(59 130 246 / .5)` for a ring, neither of which is in this palette at all.
 *
 * The review that prompted this found five such classes across seventeen files. The worst was
 * `bg-oxblood-400` on the unread-message dot: unread painted nothing and read painted grey, so the
 * signal ran backwards. Nothing caught it because there was nothing that could.
 *
 * This is a source-string gate rather than a rendering one on purpose: the fault is that the class
 * never becomes CSS, so the only place to catch it is where the string is written.
 */

/** Every colour family Tailwind is given, mapped to the numeric shades it defines. */
const SHADES: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries({ ...palette, ...ramps, ...chrome }).map(([family, value]) => [
    family,
    new Set(typeof value === 'string' ? [] : Object.keys(value).filter((key) => /^\d+$/.test(key))),
  ]),
);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

/* Vitest runs with the client package as its root, so a wrong cwd throws rather than passing on an
   empty file list. The count assertion below is the second half of that guard. */
const SELF = resolve('src/theme/palette-classes.test.ts');
const files = sourceFiles(resolve('src')).filter((path) => path !== SELF);

/* `-` and `:` may precede a family (`text-brass-300`, `hover:bg-oxblood-300`); a letter may not,
   so `debrass-200` is not a hit. A shade runs to the end of the segment or to an opacity slash. */
const FAMILY_SHADE = /(?<!\w)([a-z]+)-(\d{2,3})(?![\w-])/g;

/** `path:line  class` for every colour utility whose shade the theme does not define. */
const undefinedShades = files.flatMap((path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      [...line.matchAll(FAMILY_SHADE)].flatMap(([, family, shade]) => {
        const defined = SHADES.get(family ?? '');
        if (defined === undefined || defined.has(shade ?? '')) return [];
        return [`${path}:${index + 1}  ${family}-${shade}`];
      }),
    ),
);

/** Opacity on `currentColor` is not something Tailwind can compute, so `ring-current/30` is dropped. */
const alphaOnCurrent = files.flatMap((path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      /(?<![\w-])(?:bg|text|border|ring|fill|stroke|divide|outline|shadow)(?:-[a-z]+)?-current\/\d/.test(
        line,
      )
        ? [`${path}:${index + 1}`]
        : [],
    ),
);

describe('colour utilities name shades the palette defines', () => {
  it('scans the whole client source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  /* An anchor written out rather than derived: if `tokens.ts` ever loses a family the scan above
     stops looking at it, and this is what notices. These four were the families the review's dead
     classes were drawn from. */
  it('pins the stops the chrome families actually have', () => {
    expect([...(SHADES.get('brass') ?? [])].sort()).toEqual(['100', '300', '500', '700']);
    expect([...(SHADES.get('oxblood') ?? [])].sort()).toEqual(['100', '300', '500', '700']);
    expect([...(SHADES.get('iris') ?? [])].sort()).toEqual(['100', '300', '500', '700']);
    expect([...(SHADES.get('ferrite') ?? [])].sort()).toEqual(['100', '300', '500', '700', '950']);
  });

  it('has no utility naming a shade the theme does not define', () => {
    expect(undefinedShades).toEqual([]);
  });

  it('has no opacity modifier on currentColor', () => {
    expect(alphaOnCurrent).toEqual([]);
  });
});
