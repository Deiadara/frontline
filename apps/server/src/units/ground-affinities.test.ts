import { findUnit, type UnitsResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * §A4: the chips that say how a unit takes the ground it is standing on (bug pass, 2026-09-19).
 *
 * `groundAffinities` prints only what a sheet says beyond the stat-driven baseline, which is two
 * fields: `affinities` (points per tier) and `immuneTo` (the baseline does not apply). The
 * catalogue is explicit that they compose, on `UnitSpec.immuneTo` itself: *"Labels whose baseline
 * simply does not apply. The affinity, if any, still does."*
 *
 * The card read them as alternatives. A sheet carrying both for one label lost the word "Immune"
 * altogether and was drawn in the green the card reserves for good ground while the figure inside
 * it was negative, which is a chip telling a player to go somewhere their unit is worse.
 *
 * No sheet in the catalogue carries both today, so nothing here can be measured off the shipped
 * content. The state is put on a real sheet for the length of one read and taken off in a
 * `finally`, which is the pattern `battle/marks.test.ts` uses and for the same reason: `/api/units`
 * resolves every row through `findUnit`, so a fabricated sheet never reaches the payload.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

/** Netrunners dislike an eerie room by four points a tier and are immune to nothing. */
const SUBJECT = 'netrunners';
const LABEL = 'eerie';

async function roster(): Promise<UnitsResponse> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'the_reader', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);

  const read = await app.inject({
    method: 'GET',
    url: '/api/units',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(read.statusCode, read.body.slice(0, 300)).toBe(200);
  return read.json<UnitsResponse>();
}

/** Puts `immuneTo` on the real sheet for one read, then takes it off again. */
async function withImmunity<T>(labels: readonly string[], run: () => Promise<T>): Promise<T> {
  const sheet = findUnit(SUBJECT);
  if (!sheet) throw new Error(`${SUBJECT} is not in the catalogue`);
  const writable = sheet as unknown as Record<string, unknown>;
  const had = writable['immuneTo'];
  writable['immuneTo'] = labels;
  try {
    return await run();
  } finally {
    if (had === undefined) delete writable['immuneTo'];
    else writable['immuneTo'] = had;
  }
}

const rowFor = (units: UnitsResponse, unitId: string, id: string) =>
  units.units.find((unit) => unit.id === unitId)?.affinities.find((row) => row.id === id);

/**
 * The clause a modifier tag prints after "Counts" (bug pass, 2026-09-19).
 *
 * It is the context's, which is right for every entry whose only effect is the percentage. One
 * entry does two things: `ambush` carries a +25% in urban ground *and* drives the opening
 * exchange in `battle/engine.ts`, which fires on any ground at all, only for the attacker, and
 * in proportion to how far the side out-stealths the people it is walking into. The card printed
 * a description about that exchange with "Counts in urban ground" under it, so the one line a
 * player reads gave the wrong condition for half of what the tag does.
 */
describe('what a modifier tag says it counts in', () => {
  const tagFor = (units: UnitsResponse, unitId: string, label: string) =>
    units.units.find((unit) => unit.id === unitId)?.modifiers.find((row) => row.label === label);

  it('takes the context clause for an ordinary modifier', async () => {
    expect(tagFor(await roster(), 'razors', 'Urban Bonus')?.when).toBe('in urban ground');
  });

  it('takes the entry own clause for the one that does two things', async () => {
    const tag = tagFor(await roster(), 'scrapers', 'Ambush');
    // Not the bare context clause, which would be a promise the opening exchange does not keep.
    expect(tag?.when).not.toBe('in urban ground');
    expect(tag?.when).toBe('in urban ground, and on any ground at all for the opening exchange');
  });
});

describe('the ground chips on a unit card', () => {
  it('prints an affinity on its own as a rate, coloured by its sign', async () => {
    const row = rowFor(await roster(), SUBJECT, LABEL);
    expect(row?.note).toBe('-4% per tier');
    expect(row?.good).toBe(false);
  });

  it('prints an immunity on its own as the word', async () => {
    // A sheet that is immune to a label it has no opinion about: the Hollow Men, shipped.
    const row = rowFor(await roster(), 'hollow_men', LABEL);
    expect(row?.note).toBe('Immune');
    expect(row?.good).toBe(true);
  });

  it('prints both when a sheet carries both, and lets the affinity pick the colour', async () => {
    const row = await withImmunity([LABEL], async () => rowFor(await roster(), SUBJECT, LABEL));
    // The baseline is off and the sheet's own dislike is not, so the chip has to say both.
    expect(row?.note).toBe('Immune, -4% per tier');
    // ...and it is not a good place to stand. Green here was the half that did real damage.
    expect(row?.good).toBe(false);
  });

  it('keeps a positive affinity good when an immunity joins it', async () => {
    const row = await withImmunity(['crammed'], async () =>
      rowFor(await roster(), SUBJECT, 'crammed'),
    );
    expect(row?.note).toBe('Immune, +5% per tier');
    expect(row?.good).toBe(true);
  });
});
