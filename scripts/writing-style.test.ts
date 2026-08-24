import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The board's writing rule, enforced rather than remembered (CLAUDE.md, "Writing style").
 *
 * No em dashes, no en dashes, no double hyphens standing in for punctuation. Anywhere: comments,
 * doc blocks, copy on the screen, Markdown. A rule about register cannot be checked by a machine,
 * but this half of it is exactly the kind of thing a machine should be checking, and it is the half
 * that had four thousand violations in the tree the day it was written.
 *
 * Runs over `git ls-files`, so it covers everything tracked and nothing generated into `dist/`.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const EM_DASH = '—';
const EN_DASH = '–';

/**
 * Files whose text is not ours to edit.
 *
 * The vendored font licences. Rewriting punctuation inside a licence is the one place where
 * following a house style would be a real mistake.
 */
const NOT_OURS = /^apps\/client\/public\/fonts\/(OFL|LICENSE)/;

/** Binary and image files, which `readFileSync` would hand back as mojibake. */
const BINARY = /\.(png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|mp3|ogg|wav|zip|pdf|db)$/i;

function tracked(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path !== '' && !NOT_OURS.test(path) && !BINARY.test(path));
}

/** Every offending line, as `path:line`, so a failure says where to go rather than how many. */
function offenders(needle: RegExp): string[] {
  const found: string[] = [];
  for (const path of tracked()) {
    let text: string;
    try {
      text = readFileSync(resolve(REPO, path), 'utf8');
    } catch {
      continue;
    }
    if (!needle.test(text)) continue;
    text.split('\n').forEach((line, index) => {
      if (needle.test(line)) found.push(`${path}:${index + 1}`);
    });
  }
  return found;
}

describe('the writing rule (CLAUDE.md)', () => {
  it('has no em dash anywhere in the tree', () => {
    expect(offenders(new RegExp(EM_DASH))).toEqual([]);
  });

  it('has no en dash anywhere in the tree', () => {
    expect(offenders(new RegExp(EN_DASH))).toEqual([]);
  });

  /**
   * A double hyphen between words is a typewriter em dash and is banned with the real one. A
   * command-line flag is not punctuation, so `--dry-run` and `--check` are untouched: the pattern
   * asks for whitespace on both sides, which a flag never has on its left.
   */
  it('has no typewriter em dash standing in for punctuation', () => {
    expect(offenders(/\S\s--\s\S/)).toEqual([]);
  });

  /** The guard has to be able to fail, or a clean tree proves nothing about it. */
  it('would catch one if it were there', () => {
    expect(new RegExp(EM_DASH).test(`a ${EM_DASH} b`)).toBe(true);
    expect(/\S\s--\s\S/.test('a -- b')).toBe(true);
    expect(/\S\s--\s\S/.test('pnpm test --run')).toBe(false);
  });
});
