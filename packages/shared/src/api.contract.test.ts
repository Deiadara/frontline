/**
 * Every request schema the server enforces, against what the client actually puts on the wire.
 *
 * The failure this exists for is invisible to every other gate. A route gains a required field, the
 * client is not updated, and unit tests pass (they call the reducer), typecheck passes (the client
 * builds its own object literal), and the mocked e2e passes (the fixture answers whatever is
 * asked). The break only shows up against a real server, which is the one place nothing runs on
 * every commit.
 *
 * So this checks that every required key of every request schema is at least *named somewhere in
 * the client source*. Deliberately coarse. A narrower version that looked only at the call site in
 * `api.ts` produced three false alarms immediately, because a body is as often forwarded whole as
 * a typed argument built three components away as it is assembled at the call. What survives is the
 * check with no false positives and one real signal: a field the server insists on that no line of
 * the client has ever heard of.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as api from './api.js';

/** Every line of client source, concatenated. Built once: it is read for every key. */
const CLIENT = (() => {
  const root = new URL('../../../apps/client/src/', import.meta.url);
  const read = (dir: URL): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) return read(child);
      if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) return [];
      return [readFileSync(child, 'utf8')];
    });
  return read(root).join('\n');
})();

/** Every exported `*RequestSchema` that is a plain object, with its required keys. */
function requestSchemas(): { name: string; keys: string[] }[] {
  const out: { name: string; keys: string[] }[] = [];
  for (const [name, value] of Object.entries(api)) {
    if (!name.endsWith('RequestSchema')) continue;
    if (!(value instanceof z.ZodObject)) continue;
    const keys = Object.entries(value.shape as Record<string, z.ZodTypeAny>)
      .filter(([, field]) => !field.isOptional())
      .map(([key]) => key);
    out.push({ name, keys });
  }
  return out;
}

describe('the client sends what the server requires', () => {
  it('found the schemas to check', () => {
    const schemas = requestSchemas();
    expect(
      schemas.length,
      'no request schemas were discovered, so this file proves nothing',
    ).toBeGreaterThan(10);
  });

  it('mentions every required field of every request schema somewhere in the client', () => {
    const missing: string[] = [];
    for (const { name, keys } of requestSchemas()) {
      for (const key of keys) {
        if (!new RegExp(`\\b${key}\\b`).test(CLIENT)) missing.push(`${name}.${key}`);
      }
    }
    expect(missing, 'the server requires these and the client never sends them').toEqual([]);
  });
});
