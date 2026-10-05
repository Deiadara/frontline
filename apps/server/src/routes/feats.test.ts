import {
  FEATS,
  FEAT_MEASURE_SPECS,
  ITEM_CATALOG,
  createCommander,
  featMeasureKey,
  findFeat,
  MAX_LOCATION_LEVEL,
  RESOURCE_KEYS,
  makeAttributes,
  mergeFeatRewards,
  storageCapacity,
  storageCapacityFor,
  unitSlotsUsed,
  type ClaimFeatResponse,
  type FeatReward,
  type FeatsResponse,
  type ItemId,
  type Resources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { districtUnitSlots } from '../district/unit-slots.js';
import { featClaimRoom } from '../feats/room.js';
import { crewEffectsFor, standingEffectsFor } from '../crew/standing.js';
import { chooseOverseer } from '../testing/overseer.js';

/** The one plot in the whole city whose kind pays `infamy_gain` for being held. */
const GRAVEYARD = 'ccs-martyrs';

/**
 * Feats over HTTP: reading the board, and collecting one (maintainer request, 2026-09-13).
 *
 * What is worth pinning here is the money. The evaluator is tested exhaustively in `@frontline/
 * shared` against hand-built ladders, so these are about the things only a real server can be
 * wrong about: that a claim pays into the right stores, that it pays **once**, that pressing the
 * button twice or from two tabs cannot pay twice, and that a refusal says which door is shut.
 */

const PASSWORD = 'hunter2pass';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app: open, db } of instances.splice(0)) {
    await open.close();
    db.close();
  }
});

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * A registered crew with an empty board, which is what every case below was written against.
 *
 * Picking a character finishes `overseer_taken` (`feats/tally.ts`), so since 2026-09-18 a crew
 * arrives with one rung already waiting and five Scavengers behind it. That is the opening
 * working, and `crew/opening.test.ts` is where it is pinned; here it is noise on every count of
 * what is ready, so it is collected on the way in and these tests go on being about the
 * machinery. Two assertions below still see it, and both say so.
 */
async function player(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: PASSWORD },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  const opening = await claim(app, token, OPENING);
  expect(opening.statusCode, opening.body.slice(0, 200)).toBe(200);
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
  const body = me.json<{ user: { id: string }; base: { id: string } }>();
  return { token, userId: body.user.id, baseId: body.base.id };
}

async function board(app: FastifyInstance, token: string): Promise<FeatsResponse> {
  const response = await app.inject({ method: 'GET', url: '/api/feats', headers: auth(token) });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<FeatsResponse>();
}

/**
 * One claim, agreeing by default to lose whatever does not fit.
 *
 * `acceptWaste` defaults to **true** here because almost every case below is about the till and
 * not about the dialog: a fresh district holds 800 scrap and a great many rewards pay more than
 * that, so a helper that left the flag off would have most of these tests measuring the warning.
 * The cases that *are* about the warning pass `false` and say so.
 */
const claim = (app: FastifyInstance, token: string, featId: string, acceptWaste = true) =>
  app.inject({
    method: 'POST',
    url: '/api/feats/claim',
    headers: auth(token),
    payload: { featId, acceptWaste },
  });

/** The feat every crew can finish first: one letter written. Small, and pays plain caps. */
const FIRST_RUNG = 'long_odds_1';

/** The one rung that is finished by the act of starting: picking a character. */
const OPENING = 'overseer_taken';

/**
 * Rungs already in the ledger before a test has done anything, because `player` collects them.
 *
 * Named rather than written as a bare `+ 1` at each site, so the day a second rung is finished by
 * the act of starting there is one number to move.
 */
const ALREADY_COLLECTED = 1;

/** Moves a tally straight, which is what a whole evening of play would otherwise be needed for. */
function give(app: FastifyInstance, baseId: string, measure: string, amount: number): void {
  app.repos.feats.bump(baseId, measure, amount);
}

describe('GET /feats', () => {
  it('answers with a row for every feat in the catalogue', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_reader');

    const feats = await board(app, one.token);

    expect(feats.progress).toHaveLength(FEATS.length);
    expect(new Set(feats.progress.map((row) => row.id)).size).toBe(FEATS.length);
    expect(feats.ready).toBe(0);
    expect(feats.claimed).toBe(ALREADY_COLLECTED);
  });

  it('shows a brand new crew the head of every ladder and nothing behind it', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_new');

    const feats = await board(app, one.token);
    const byId = new Map(feats.progress.map((row) => [row.id, row]));
    for (const spec of FEATS) {
      // ...with one exception: picking a character is a thing this crew has already done, so the
      // opening rung is collected rather than open. Everything else is untouched.
      if (spec.id === OPENING) continue;
      expect(byId.get(spec.id)?.state, spec.id).toBe(spec.after === null ? 'open' : 'locked');
    }
    expect(byId.get(OPENING)?.state).toBe('claimed');
  });

  it('counts what the crew has actually done', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_counting');
    give(app, one.baseId, featMeasureKey('missions_done'), 3);

    const row = (await board(app, one.token)).progress.find((entry) => entry.id === 'runs_1');
    expect(row?.value).toBe(3);
    expect(row?.target).toBe(5);
    expect(row?.state).toBe('open');
    expect(row?.progress).toBeCloseTo(0.6);
  });

  /**
   * The screen has to settle first.
   *
   * Half of what a feat asks about lands lazily on read: production, builds, musters. A crew that
   * has been away sees the board as of their last visit unless the route settles them, and the
   * badge on `/me` would then disagree with the page.
   */
  it('settles the crew before answering, so time that has passed counts', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_settling');
    const base = app.repos.bases.findByOwnerId(one.userId)!;

    /*
     * A district that actually makes something.
     *
     * A new crew starts with a Nexus and a Generator and neither produces, so the obvious version
     * of this test wound the clock back a day and measured nothing moving. Caps are the wrong
     * thing to look for either way: nothing farms them (`building/production.ts`), which is why
     * the lifetime-caps ladder is fed by jobs and trades rather than by waiting.
     */
    app.repos.bases.updateDistrict(
      base.id,
      [
        ...base.buildings,
        { id: 'test-greenhouse', kind: 'greenhouse', level: 3, modifications: [] },
        { id: 'test-scrapyard', kind: 'scrapyard', level: 3, modifications: [] },
      ],
      base.buildQueue,
    );
    // Nothing has been counted but the character this account picked to get here.
    expect(app.repos.feats.tallies(one.baseId)).toEqual({ [OPENING]: 1 });

    // Wind the production clock back a day and read the board. The settle banks the interval and
    // the lifetime counters move with it, with nobody touching the district screen.
    const producing = app.repos.bases.findByOwnerId(one.userId)!;
    app.repos.bases.updateEconomy(producing.id, {
      ...producing.economy,
      productionSettledAt: new Date(Date.now() - 24 * 3_600_000).toISOString(),
    });
    await board(app, one.token);

    const tallies = app.repos.feats.tallies(one.baseId);
    expect(tallies[featMeasureKey('resources_earned', 'scrap')]).toBeGreaterThan(0);
    expect(tallies[featMeasureKey('resources_earned', 'supplies')]).toBeGreaterThan(0);
  });
});

/**
 * The two measures that read somebody's sheet rather than the crew row.
 *
 * Both are board examples ("an officer with at least a D mark", "three skills above 50"), and both
 * reach through a second lookup: the Overseer lives on the account, and an officer's mark is a fit
 * score against a role table that is server-side only. A wrong field name in either would be a feat
 * that sits at zero forever with nothing else in the tree noticing.
 */
describe('the sheets', () => {
  it('counts the Overseer’s skills at the threshold the feat asks for', () => {
    return (async () => {
      const app = await makeApp();
      const one = await player(app, 'feats_overseer');

      const before = (await board(app, one.token)).progress.find((row) => row.id === 'overseer_1');
      // A fresh sheet starts around fifteen, so nothing is at fifty.
      expect(before?.value).toBe(0);
      expect(before?.state).toBe('open');

      const user = app.repos.users.findById(one.userId)!;
      const overseer = app.repos.overseers.findById(user.overseerId!)!;
      app.repos.overseers.updateAttributes(overseer.id, {
        ...overseer.attributes,
        leadership: 60,
        stealth: 55,
        logistics: 51,
      });

      const after = (await board(app, one.token)).progress.find((row) => row.id === 'overseer_1');
      expect(after?.value).toBe(3);
      expect(after?.state).toBe('ready');
      // And the best-skill ladder reads the same sheet.
      const peak = (await board(app, one.token)).progress.find((row) => row.id === 'peak_1');
      expect(peak?.value).toBe(60);
    })();
  });

  it('counts the best mark on the books', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_mark');

    const before = (await board(app, one.token)).progress.find((row) => row.id === 'mark_1');
    expect(before?.value).toBe(0);

    /*
     * One officer, good enough at their chair to mark well.
     *
     * A hundred in everything rather than a careful sheet: what is under test is that the measure
     * reaches the officer and reads a mark at all, and pinning a particular set of attributes to a
     * particular letter would be pinning the role requirement table through a feat test.
     */
    const base = app.repos.bases.findByOwnerId(one.userId)!;
    const attributes = Object.fromEntries(
      Object.keys(
        app.repos.overseers.findById(app.repos.users.findById(one.userId)!.overseerId!)!.attributes,
      ).map((name) => [name, 100]),
    );
    app.repos.bases.updateCommanders(base.id, [
      {
        id: 'officer-1',
        name: 'Somebody Good',
        role: 'raid_boss',
        attributes: attributes as never,
        perks: [],
        weeklyWage: 100,
        injuredUntil: null,
        portraitId: null,
      },
    ]);

    const after = (await board(app, one.token)).progress.find((row) => row.id === 'mark_1');
    expect(after?.value).toBe(after?.target);
    expect(after?.state).toBe('ready');
  });

  /**
   * And the same officer with nobody to be.
   *
   * `crew/roster.ts` shows no mark for somebody with no chair, which is right on a card about a
   * seat, and this measure read that absence as a zero: a crew whose one good officer was waiting
   * for a room to open sat at nothing on the whole mark ladder. The feat asks what the crew
   * *has*, so a benched officer is read at the best of any role they could sit in.
   */
  it('counts an officer who is between chairs', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_benched');

    const base = app.repos.bases.findByOwnerId(one.userId)!;
    const attributes = Object.fromEntries(
      Object.keys(
        app.repos.overseers.findById(app.repos.users.findById(one.userId)!.overseerId!)!.attributes,
      ).map((name) => [name, 100]),
    );
    app.repos.bases.updateCommanders(base.id, [
      {
        id: 'officer-benched',
        name: 'Waiting For A Room',
        // No chair. The whole of the difference from the test above it.
        role: null,
        attributes: attributes as never,
        perks: [],
        weeklyWage: 100,
        injuredUntil: null,
        portraitId: null,
      },
    ]);

    const row = (await board(app, one.token)).progress.find((entry) => entry.id === 'mark_1');
    expect(row?.value).toBe(row?.target);
    expect(row?.state).toBe('ready');
  });
});

describe('collecting one', () => {
  it('pays what the catalogue says, into the stockpile', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_paid');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    const before = app.repos.bases.findByOwnerId(one.userId)!.resources;
    const response = await claim(app, one.token, FIRST_RUNG);
    expect(response.statusCode, response.body).toBe(200);

    const body = response.json<ClaimFeatResponse>();
    const reward = findFeat(FIRST_RUNG)!.reward;
    expect(body.featId).toBe(FIRST_RUNG);
    expect(body.paid).toEqual(reward);

    const after = app.repos.bases.findByOwnerId(one.userId)!.resources;
    for (const [key, amount] of Object.entries(reward.resources ?? {})) {
      expect(after[key as keyof typeof after], key).toBe(
        (before[key as keyof typeof before] ?? 0) + (amount ?? 0),
      );
    }
  });

  it('hands back the refreshed board, with the feat marked collected', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_refresh');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    const body = (await claim(app, one.token, FIRST_RUNG)).json<ClaimFeatResponse>();
    expect(body.feats.progress.find((row) => row.id === FIRST_RUNG)?.state).toBe('claimed');
    expect(body.feats.claimed).toBe(1 + ALREADY_COLLECTED);
    expect(body.feats.ready).toBe(0);
  });

  it('opens the next rung of the ladder', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_ladder');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    const before = (await board(app, one.token)).progress;
    /*
     * The second rung wants twenty five letters, so it is not finished. What has changed is that
     * it is no longer **locked**, and that happened the moment the first rung was achieved rather
     * than when it was collected: the ladder follows the work, not the button.
     */
    expect(before.find((row) => row.id === 'long_odds_1')?.state).toBe('ready');
    expect(before.find((row) => row.id === 'long_odds_2')?.state).toBe('open');
    expect(before.find((row) => row.id === 'long_odds_2')?.value).toBe(1);

    // And collecting the first does not shut the second again.
    const body = (await claim(app, one.token, FIRST_RUNG)).json<ClaimFeatResponse>();
    expect(body.feats.progress.find((row) => row.id === 'long_odds_2')?.state).toBe('open');
  });

  // P8-A (2026-10-02): the mid game pays "a random page", drawn on the claim.
  it('draws a random page on the claim and names it on the receipt', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_pages');
    const feat = FEATS.find((spec) => spec.reward.pages !== undefined)!;
    expect(feat, 'no feat pays a random page').toBeDefined();
    give(app, one.baseId, featMeasureKey(feat.measure, feat.scope), feat.target);

    const before = app.repos.bases.findByOwnerId(one.userId)!.inventory;
    const response = await claim(app, one.token, feat.id);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ClaimFeatResponse>();
    expect(body.paid.pages, 'the receipt still says "random"').toBeUndefined();

    const pagesOf = (inventory: Record<string, number | undefined>) =>
      Object.entries(inventory)
        .filter(([id]) => ITEM_CATALOG[id as ItemId]?.kind === 'page')
        .reduce((total, [, count]) => total + (count ?? 0), 0);
    const after = app.repos.bases.findByOwnerId(one.userId)!.inventory;
    expect(pagesOf(after) - pagesOf(before)).toBe(feat.reward.pages);
    expect(pagesOf(body.paid.items ?? {})).toBe(feat.reward.pages);
  });

  it('pays a feat that grants units straight onto the roster', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_units');
    const feat = FEATS.find((spec) => spec.reward.units !== undefined && spec.after === null)!;
    give(app, one.baseId, featMeasureKey(feat.measure, feat.scope), feat.target);

    const before = app.repos.bases.findByOwnerId(one.userId)!.army;
    expect((await claim(app, one.token, feat.id)).statusCode).toBe(200);
    const after = app.repos.bases.findByOwnerId(one.userId)!.army;

    for (const [unitId, count] of Object.entries(feat.reward.units ?? {})) {
      expect(after[unitId] ?? 0, unitId).toBe((before[unitId] ?? 0) + (count ?? 0));
    }
  });

  /**
   * A reward that does not fit.
   *
   * Nothing in the game clamps an army that is already over its beds: the only bed check is at
   * `queueMuster`, which refuses to *start* a muster there is no room for. An army can be over
   * capacity today by a garrison coming home or a muster withdrawing, and a feat paying units is
   * the same situation. The reward must arrive whole rather than being quietly trimmed, and the
   * consequence is the ordinary one, that nothing new can be mustered until there are beds.
   */
  it('hands over units even when there is nowhere to put them', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_no_beds');
    const feat = FEATS.find((spec) => spec.reward.units !== undefined && spec.after === null)!;
    give(app, one.baseId, featMeasureKey(feat.measure, feat.scope), feat.target);

    // Strip the district back to a Nexus, so there are no Quarters and no spare beds at all.
    const base = app.repos.bases.findByOwnerId(one.userId)!;
    app.repos.bases.updateDistrict(
      base.id,
      base.buildings.filter((building) => building.kind === 'nexus'),
      [],
    );

    expect((await claim(app, one.token, feat.id)).statusCode).toBe(200);
    const after = app.repos.bases.findByOwnerId(one.userId)!.army;
    for (const [unitId, count] of Object.entries(feat.reward.units ?? {})) {
      expect(after[unitId] ?? 0, unitId).toBeGreaterThanOrEqual(count ?? 0);
    }
  });

  /**
   * A reward that overflows the store, paid up to the ceiling (maintainer ruling, 2026-09-23).
   *
   * Since 2026-09-28 every credit is clamped this way (`district/stores.ts`); a feat has its own
   * dialog because it can also lose units, which the stores' `WOULD_WASTE` does not carry.
   *
   * `long_odds_1` pays 240 caps, 40 scrap, 40 planks and 20 oil. The scrap shelf is left with room
   * for ten, so exactly ten land and thirty are burned, and the other three channels are
   * untouched: a bundle is clamped line by line and not refused whole.
   */
  it('pays a claim up to the ceiling and discards the rest', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_overflow');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    const base = app.repos.bases.findByOwnerId(one.userId)!;
    // Off the route's own fold rather than off the structures, because the §F2 storage bonus raises the
    // shelf and a test that read the bare figure would leave room the claim can see and it cannot.
    const ceiling =
      base.resources.scrap + featClaimRoom(app.repos, base, new Date()).resources.scrap;
    const room = 10;
    app.repos.bases.updateResources(base.id, { ...base.resources, scrap: ceiling - room });
    const before = app.repos.bases.findByOwnerId(one.userId)!.resources;

    const response = await claim(app, one.token, FIRST_RUNG);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ClaimFeatResponse & { wasted?: { resources?: Resources } }>();

    const after = app.repos.bases.findByOwnerId(one.userId)!.resources;
    // Exactly to the top of the shelf, and no further.
    expect(after.scrap).toBe(ceiling);
    const owed = findFeat(FIRST_RUNG)!.reward.resources!;
    expect(body.wasted?.resources?.scrap).toBe((owed.scrap ?? 0) - room);
    expect(body.paid).toMatchObject({ resources: { scrap: room } });

    // The channels with room take the whole of what they were promised.
    expect(after.caps).toBe(before.caps + (owed.caps ?? 0));
    expect(after.planks).toBe(before.planks + (owed.planks ?? 0));
  });

  /**
   * The same claim with nothing said, which is the state the screen is in before the dialog.
   *
   * Refused, and **nothing written**: the rung stays ready, the stockpile does not move, and the
   * claim row is not there, so pressing yes afterwards still pays. The confirmation has to reach
   * the server because the discard happens on this side of the wire, and a route that clamped
   * silently would burn a reward for anybody on a client that had never heard of the dialog.
   */
  it('refuses a claim that would waste something until the player agrees to it', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_unconfirmed');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    const base = app.repos.bases.findByOwnerId(one.userId)!;
    app.repos.bases.updateResources(base.id, {
      ...base.resources,
      scrap: base.resources.scrap + featClaimRoom(app.repos, base, new Date()).resources.scrap,
    });
    const before = app.repos.bases.findByOwnerId(one.userId)!.resources;

    const refused = await claim(app, one.token, FIRST_RUNG, false);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe('would_waste');
    expect(app.repos.bases.findByOwnerId(one.userId)!.resources).toEqual(before);
    expect(app.repos.feats.claimed(one.baseId).has(FIRST_RUNG)).toBe(false);
    expect((await board(app, one.token)).progress.find((row) => row.id === FIRST_RUNG)?.state).toBe(
      'ready',
    );

    // And saying yes then pays, which is what makes the refusal a question rather than a wall.
    expect((await claim(app, one.token, FIRST_RUNG)).statusCode).toBe(200);
    expect(app.repos.feats.claimed(one.baseId).has(FIRST_RUNG)).toBe(true);
  });

  /**
   * The figure the screen is drawn from, against the figure the till discards.
   *
   * The dialog is built from `FeatsResponse.waste`, which is quoted on the read; the claim
   * recomputes the split against the state it writes against. Those are two calls to the same
   * function in two places, and the test that matters is that they agree, because a warning that
   * overstates the loss teaches players to ignore it.
   */
  it('quotes on the board exactly what the claim goes on to discard', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_quote');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    const base = app.repos.bases.findByOwnerId(one.userId)!;
    app.repos.bases.updateResources(base.id, {
      ...base.resources,
      scrap: base.resources.scrap + featClaimRoom(app.repos, base, new Date()).resources.scrap - 10,
    });

    const quoted = (await board(app, one.token)).waste[FIRST_RUNG];
    expect(quoted, 'the board quoted no waste on a rung that cannot be paid in full').toBeDefined();

    const response = await claim(app, one.token, FIRST_RUNG);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ wasted?: unknown }>().wasted).toEqual(quoted);
  });

  /**
   * A reward that fits is untouched, and says nothing.
   *
   * The control on both of the cases above: with room in every store the board quotes no waste,
   * the response carries no `wasted`, and the payout is the catalogue's own figure. Without this
   * a split that wrongly reported a loss on every feat would pass everything else here.
   */
  it('pays a reward that fits in full, and quotes no waste for it', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_fits');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    const before = app.repos.bases.findByOwnerId(one.userId)!.resources;
    expect((await board(app, one.token)).waste[FIRST_RUNG]).toBeUndefined();

    const response = await claim(app, one.token, FIRST_RUNG, false);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ClaimFeatResponse & { wasted?: unknown }>();
    expect(body.wasted).toBeUndefined();
    expect(body.paid).toEqual(findFeat(FIRST_RUNG)!.reward);

    const after = app.repos.bases.findByOwnerId(one.userId)!.resources;
    for (const [key, amount] of Object.entries(findFeat(FIRST_RUNG)!.reward.resources ?? {})) {
      expect(after[key as keyof Resources], key).toBe(
        before[key as keyof Resources] + (amount ?? 0),
      );
    }
  });

  /**
   * Feats pay no infamy (maintainer, 2026-09-29), to anybody, however much `infamy_gain` they carry.
   *
   * `gates_1` paid 24 infamy until the ruling and pays caps and experience now. The crew is set up
   * the way the old tests set it up to prove the channel was scaled: an officer with
   * `legend_builder` and the Graveyard held, which are the people half and the ground half of
   * `infamy_gain`. Both folds are read first, so a fixture that stopped raising the channel fails as
   * a fixture rather than passing as a clean bill of health. With the channel up from both sides, a
   * claim still moves the ledger by nothing and puts nothing on the `infamy_earned` ladder, which
   * measures a name made in fights and nowhere else.
   */
  it('pays no infamy, even to a crew whose infamy_gain is up from people and ground', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_no_infamy');
    const feat = FEATS.find((spec) => spec.id === 'gates_1')!;

    const control = app.repos.city.control(GRAVEYARD);
    if (!control) throw new Error(`fixture: no control row for ${GRAVEYARD}`);
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: one.baseId },
      level: MAX_LOCATION_LEVEL,
      garrison: {},
    });
    const base = app.repos.bases.findByOwnerId(one.userId)!;
    app.repos.bases.updateCommanders(base.id, [
      {
        ...createCommander('teller', 'The Teller', 'professor', makeAttributes(40)),
        perks: ['legend_builder'],
      },
    ]);
    const held = app.repos.bases.findByOwnerId(one.userId)!;
    expect(crewEffectsFor(app.repos, held).infamyGainPercent, 'legend_builder').toBeGreaterThan(0);
    expect(
      standingEffectsFor(app.repos, held).infamyGainPercent,
      'the Graveyard stopped paying infamy_gain',
    ).toBeGreaterThan(crewEffectsFor(app.repos, held).infamyGainPercent);

    give(app, one.baseId, featMeasureKey(feat.measure, feat.scope), feat.target);
    const before = held.economy.infamy;
    const response = await claim(app, one.token, feat.id);
    expect(response.statusCode, response.body).toBe(200);

    expect(response.json<ClaimFeatResponse>().paid).not.toHaveProperty('infamy');
    expect(app.repos.bases.findByOwnerId(one.userId)!.economy.infamy).toBe(before);
    expect(app.repos.feats.tallies(one.baseId)[featMeasureKey('infamy_earned')] ?? 0).toBe(0);
    // It still pays: the value moved to another channel rather than disappearing.
    expect(feat.reward.resources?.caps ?? 0).toBeGreaterThan(0);
    expect(feat.reward.xp ?? 0).toBeGreaterThan(0);
  });

  it('pays experience through the one writer of level', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_xp');
    const feat = FEATS.find((spec) => spec.reward.xp !== undefined && spec.after === null)!;
    give(app, one.baseId, featMeasureKey(feat.measure, feat.scope), feat.target);

    const before = app.repos.bases.findByOwnerId(one.userId)!;
    expect((await claim(app, one.token, feat.id)).statusCode).toBe(200);
    const after = app.repos.bases.findByOwnerId(one.userId)!;

    // Either the bar moved or the level did. Which one depends on the size of the award against
    // the curve, and pinning the exact split here would be pinning the curve.
    const moved =
      after.level > before.level || after.progression.xpIntoLevel > before.progression.xpIntoLevel;
    expect(moved).toBe(true);
  });

  /**
   * A feat that pays blueprint pages counts them as pages found, and rings.
   *
   * The `pages` chain is itself measured on `pages_found` and its first rung is paid in a page, so
   * a payout that did not count meant collecting rung one handed over a document that did not move
   * the crew one step towards rung two. Every other door a page comes through (a mission, the
   * fence, the Runner, the Lab, either side of an offer) both counts it and tells the player; this
   * one did neither, and a page landing silently in an eighteen-line inventory is a page nobody
   * knows they have.
   */
  it('counts a page a feat paid, and tells the player it arrived', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_pages');
    const feat = FEATS.find((spec) =>
      Object.keys(spec.reward.items ?? {}).some(
        (id) => ITEM_CATALOG[id as ItemId]?.kind === 'page',
      ),
    )!;
    give(app, one.baseId, featMeasureKey(feat.measure, feat.scope), feat.target);

    const before = app.repos.feats.tallies(one.baseId)[featMeasureKey('pages_found')] ?? 0;
    expect((await claim(app, one.token, feat.id)).statusCode).toBe(200);

    const paidPages = Object.entries(feat.reward.items ?? {}).reduce(
      (total, [id, count]) =>
        ITEM_CATALOG[id as ItemId]?.kind === 'page' ? total + (count ?? 0) : total,
      0,
    );
    expect(paidPages).toBeGreaterThan(0);
    expect(app.repos.feats.tallies(one.baseId)[featMeasureKey('pages_found')]).toBe(
      before + paidPages,
    );
    expect(
      app.repos.social.notifications(one.userId, 20).some((note) => note.kind === 'page_found'),
    ).toBe(true);
  });

  it('puts a boost into the same stash the back room fills', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_boost');
    const feat = FEATS.find((spec) => spec.reward.boosts !== undefined)!;
    give(app, one.baseId, featMeasureKey(feat.measure, feat.scope), feat.target);
    // The chain this sits in may have a rung in front of it; give it enough for every rung.
    const response = await claim(app, one.token, feat.id);
    expect(response.statusCode, response.body).toBe(200);

    const stash = app.repos.blackMarket.stashFor(one.baseId);
    for (const goodId of feat.reward.boosts ?? []) {
      expect(stash[goodId] ?? 0, goodId).toBeGreaterThan(0);
    }
  });
});

describe('a claim that cannot be paid', () => {
  it('refuses a feat that is not finished', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_unfinished');

    const response = await claim(app, one.token, FIRST_RUNG);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toBe('not_finished');
  });

  it('refuses a rung whose ladder has not reached it', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_locked');

    const response = await claim(app, one.token, 'long_odds_2');
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toBe('locked');
  });

  /**
   * §A1 is a ceiling on a district, and a feat is not an exemption from it.
   *
   * Seven feats pay units straight onto the roster, and the two largest pay 960 unit slots against
   * a finished district's two thousand and a fresh one's twenty-six. Mustering refuses an order
   * that would not fit and the Garage refuses a machine for the same reason; this was the one door
   * left open, and it let a crew walk out of the feats screen holding an army its district could
   * not house.
   *
   * Beds went through the same door as the shelves on 2026-09-23. An unconfirmed claim is refused
   * **without** marking it collected, which is the half that matters: the feat stays ready and the
   * reward is still there once the crew has made room. Saying yes fills the beds and loses the
   * rest, which is the second case below.
   */
  it('refuses a feat whose units the district cannot house, and leaves it ready', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_no_room');
    const big = findFeat('deployed_3')!;
    const asking = unitSlotsUsed(big.reward.units ?? {});
    const spare = districtUnitSlots(app.repos, app.repos.bases.findById(one.baseId)!).spare;
    // The precondition: this reward genuinely does not fit a fresh district. Read off the
    // catalogue and the fold rather than written as a number, so retuning either moves with it.
    expect(asking).toBeGreaterThan(spare);

    const before = app.repos.bases.findById(one.baseId)!.army;

    give(app, one.baseId, big.measure, big.target);
    const stateOf = async () =>
      (await board(app, one.token)).progress.find((row) => row.id === big.id)?.state;
    expect(await stateOf()).toBe('ready');

    const response = await claim(app, one.token, big.id, false);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toBe('would_waste');

    // Nothing was paid and nothing was spent: the roster is untouched and the feat is collectable
    // the moment there is room for it.
    expect(app.repos.bases.findById(one.baseId)!.army).toEqual(before);
    expect(await stateOf()).toBe('ready');
    // And the board says which rung it was and what it would cost to take it anyway.
    expect((await board(app, one.token)).waste[big.id]?.units).toBeDefined();
  });

  /**
   * The same feat, confirmed: the district fills to its last bed and the rest of the army is gone.
   *
   * Units are taken **whole** and in the order the reward lists them, because half a Juggernaut is
   * not a thing the roster can hold. What is pinned is the invariant the ceiling exists for, that
   * the district still houses everything it holds, plus that something actually arrived: a clamp
   * that paid nothing would satisfy the ceiling and fail the player.
   */
  it('fills the beds it has and discards the units it cannot house, once confirmed', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_partial_beds');
    const big = findFeat('deployed_3')!;
    give(app, one.baseId, big.measure, big.target);

    const spare = districtUnitSlots(app.repos, app.repos.bases.findById(one.baseId)!).spare;
    expect(unitSlotsUsed(big.reward.units ?? {}), 'the reward must not fit').toBeGreaterThan(spare);

    const before = app.repos.bases.findById(one.baseId)!.army;
    const response = await claim(app, one.token, big.id);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ paid: FeatReward; wasted?: { units?: Record<string, number> } }>();

    // Something landed, and the district still houses everything it holds.
    expect(unitSlotsUsed(body.paid.units ?? {})).toBeGreaterThan(0);
    expect(unitSlotsUsed(body.paid.units ?? {})).toBeLessThanOrEqual(spare);
    const housed = districtUnitSlots(app.repos, app.repos.bases.findById(one.baseId)!);
    expect(housed.total).toBeLessThanOrEqual(housed.capacity);

    // The roster moved by exactly what the receipt says, and the rest is on the receipt as lost.
    const after = app.repos.bases.findById(one.baseId)!.army;
    for (const [unitId, count] of Object.entries(body.paid.units ?? {})) {
      expect((after[unitId] ?? 0) - (before[unitId] ?? 0), unitId).toBe(count);
    }
    for (const [unitId, count] of Object.entries(big.reward.units ?? {})) {
      const paid = body.paid.units?.[unitId] ?? 0;
      expect((body.wasted?.units?.[unitId] ?? 0) + paid, unitId).toBe(count);
    }
  });

  it('refuses a feat that does not exist', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_unknown');

    const response = await claim(app, one.token, 'not-a-feat');
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toBe('unknown_feat');
  });

  it('refuses anybody without a token', async () => {
    const app = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/feats' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/feats/claim',
          payload: { featId: FIRST_RUNG },
        })
      ).statusCode,
    ).toBe(401);
  });

  /**
   * The one that costs a player something if it is wrong.
   *
   * Two presses of the same button. The claim row is written first and `INSERT OR IGNORE` reports
   * whether it was this call that wrote it, so the second press finds the row, is told so, and
   * pays nothing. Checked on the stockpile rather than on the response, because a route that
   * refused and paid anyway would still look right in the body.
   */
  it('pays once however many times the button is pressed', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_twice');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    const before = app.repos.bases.findByOwnerId(one.userId)!.resources.caps;
    const first = await claim(app, one.token, FIRST_RUNG);
    expect(first.statusCode).toBe(200);
    const paid = app.repos.bases.findByOwnerId(one.userId)!.resources.caps;

    for (let press = 0; press < 5; press += 1) {
      const again = await claim(app, one.token, FIRST_RUNG);
      expect(again.statusCode).toBe(409);
      expect(again.json<{ error: { message: string } }>().error.message).toBe('already_claimed');
    }

    expect(app.repos.bases.findByOwnerId(one.userId)!.resources.caps).toBe(paid);
    expect(paid).toBeGreaterThan(before);
  });

  /**
   * Eight requests fired without awaiting in between.
   *
   * What this proves and what it does not is worth being exact about. Fastify's `inject` plus a
   * synchronous sqlite driver means each request runs to completion before the next starts, so
   * these do **not** interleave: the second one is caught by the `already_claimed` check, and
   * mutating away the write guard underneath it leaves this test green. It was written as the
   * race test and could not fail, which is how that was found.
   *
   * It is kept because it is still the load test the maintainer asked for, a button pressed eight times
   * as fast as the client can manage, and because it pins that the refusal path pays nothing. The
   * actual interleaving guard is `repos.feats.claim` reporting what it wrote, and that is tested
   * where it can fail, in `db/repos/feats.test.ts`.
   */
  it('pays once when the button is hammered, and refuses the rest', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_race');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    const before = app.repos.bases.findByOwnerId(one.userId)!.resources.caps;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claim(app, one.token, FIRST_RUNG)),
    );

    expect(results.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(results.filter((response) => response.statusCode === 409)).toHaveLength(7);

    const reward = findFeat(FIRST_RUNG)!.reward.resources?.caps ?? 0;
    expect(app.repos.bases.findByOwnerId(one.userId)!.resources.caps).toBe(before + reward);
  });
});

/**
 * Collecting the whole board, one press after another.
 *
 * The maintainer asked for a small load test, and the useful version of it is not eight presses of one
 * button (that is above, under the hammering case): it is every feat a crew can reach, paid out in
 * sequence through one till. `payFeat` writes six channels into five stores and a reward shape
 * that only one feat in the catalogue uses would otherwise be exercised by nothing.
 *
 * It walks rather than iterating the catalogue, because collecting changes the answer: a feat that
 * pays caps moves the lifetime-caps ladder, one that pays a page moves the pages ladder, one that
 * pays experience moves the level, and every rung collected opens the one behind it. The loop ends
 * when a pass collects nothing, which is the only honest fixed point.
 */
describe('the whole board, collected', () => {
  it('pays a hundred feats in a row without losing its place', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_everything');

    // Every lifetime counter the catalogue asks about, moved past the top of its own ladder. The
    // crew measures (level, buildings, ground held) are deliberately left alone: what is under
    // test is the till, not the city.
    const reach = new Map<string, number>();
    for (const feat of FEATS) {
      if (FEAT_MEASURE_SPECS[feat.measure].source !== 'tally') continue;
      const key = featMeasureKey(feat.measure, feat.scope);
      reach.set(key, Math.max(reach.get(key) ?? 0, feat.target));
    }
    for (const [key, target] of reach) give(app, one.baseId, key, target);

    /*
     * Capped at a hundred presses, because the write limiter takes 120 an account a minute
     * (`limits/rules.ts`) and a test that walks into a 429 is measuring the limiter rather than
     * the till. See the note in the report: a crew with a backlog bigger than that cannot collect
     * it all in one sitting, and there is no collect-everything route.
     */
    const BUDGET = 100;
    let collected = 0;
    /*
     * Every press agrees to the waste, so nothing here is ever refused: the feats that pay units
     * run out of district long before they run out of ladder (§A1) and the stores are a fraction
     * of what the deep rungs pay, so a walk that declined would stall on the same shut doors for
     * all twenty passes. What that buys is the strongest form of the invariant this test exists
     * for, checked at the end: a hundred confirmed claims, every one of them clamped, and the
     * district still houses everything it holds.
     */
    for (let pass = 0; pass < 20 && collected < BUDGET; pass += 1) {
      const ready = (await board(app, one.token)).progress.filter((row) => row.state === 'ready');
      if (ready.length === 0) break;
      for (const row of ready) {
        if (collected >= BUDGET) break;
        const response = await claim(app, one.token, row.id);
        expect(response.statusCode, `${row.id}: ${response.body}`).toBe(200);
        collected += 1;
      }
    }

    // The invariant the cap exists for: whatever the till paid out, the district still houses it.
    const housed = districtUnitSlots(app.repos, app.repos.bases.findById(one.baseId)!);
    expect(housed.total).toBeLessThanOrEqual(housed.capacity);

    // The ledger agrees with the claim table rather than with the counter above.
    expect(collected).toBeGreaterThan(60);
    const ledger = await board(app, one.token);
    expect(ledger.claimed).toBe(collected + ALREADY_COLLECTED);
    expect(app.repos.feats.claimed(one.baseId).size).toBe(collected + ALREADY_COLLECTED);

    // And nothing came out of the stockpile sideways on the way through.
    const base = app.repos.bases.findByOwnerId(one.userId)!;
    for (const [key, amount] of Object.entries(base.resources)) {
      expect(Number.isFinite(amount), key).toBe(true);
      expect(amount, key).toBeGreaterThanOrEqual(0);
    }

    /*
     * The inventory, against the sum of what was collected.
     *
     * Resources would be the obvious thing to add up and are the wrong one: production settles on
     * every read, so the stockpile has a second author. Nothing in this test puts an item in the
     * inventory except a feat, so the inventory is the channel where a hundred payouts can be checked
     * against a hundred receipts and the arithmetic has to come out exactly.
     */
    const owed = mergeFeatRewards(
      [...app.repos.feats.claimed(one.baseId)].map((featId) => findFeat(featId)!.reward),
    );
    const isPage = (id: string) => ITEM_CATALOG[id as ItemId]?.kind === 'page';
    for (const [id, count] of Object.entries(owed.items ?? {})) {
      // A random page can land on a sheet a feat also names, so pages are counted as a whole.
      if (isPage(id)) continue;
      expect(base.inventory[id as ItemId] ?? 0, id).toBe(count);
    }
    const pagesHeld = Object.entries(base.inventory)
      .filter(([id]) => isPage(id))
      .reduce((total, [, count]) => total + (count ?? 0), 0);
    const pagesOwed =
      Object.entries(owed.items ?? {})
        .filter(([id]) => isPage(id))
        .reduce((total, [, count]) => total + (count ?? 0), 0) + (owed.pages ?? 0);
    expect(pagesHeld, 'pages, named and drawn').toBe(pagesOwed);

    // A second press on any of them refuses, and none of them pays again.
    const caps = base.resources.caps;
    for (const featId of [...app.repos.feats.claimed(one.baseId)].slice(0, 5)) {
      const again = await claim(app, one.token, featId);
      expect(again.statusCode, featId).toBe(409);
      expect(again.json<{ error: { message: string } }>().error.message).toBe('already_claimed');
    }
    expect(app.repos.bases.findByOwnerId(one.userId)!.resources.caps).toBe(caps);
  });
});

describe('collecting the whole backlog at once', () => {
  const claimAll = (app: FastifyInstance, token: string) =>
    app.inject({ method: 'POST', url: '/api/feats/claim-all', headers: auth(token) });

  /**
   * The reason this route exists.
   *
   * A ladder unlocks on achievement rather than on collection, so a crew arriving at this screen
   * with a lot of history behind it is handed a great many rungs at once. Pressing CLAIM per rung
   * would run into the write limiter, 120 a minute per account, and be told 429 by a guard that
   * knows nothing about feats.
   */
  it('collects everything waiting in one write', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_all');
    // Enough history to finish a good spread of ladders at once.
    for (const [measure, amount] of [
      ['jobs_won_long_odds', 40],
      ['missions_done', 500],
      ['missions_won', 300],
      ['battles_fought', 250],
      ['spy_jobs_returned', 200],
      ['units_mustered', 2_500],
    ] as const) {
      give(app, one.baseId, featMeasureKey(measure), amount);
    }

    const waiting = (await board(app, one.token)).ready;
    expect(waiting).toBeGreaterThan(10);

    const response = await claimAll(app, one.token);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ featIds: string[]; skipped: string[]; feats: FeatsResponse }>();

    /*
     * Everything waiting is accounted for: collected, or passed over for want of room.
     *
     * Not `featIds.length === waiting` any more (maintainer, 2026-09-23). Collect-all leaves a
     * rung ready when its reward has nowhere to go, which this fixture triggers in bulk: a fresh
     * crew's Apothecary is small and nineteen ladders at once pay more scrap and planks than it
     * can hold. The invariant that matters is that none of them is lost.
     */
    expect(body.featIds.length + body.skipped.length).toBe(waiting);
    expect(body.featIds.length, 'nothing was collected at all').toBeGreaterThan(0);
    expect(new Set([...body.featIds, ...body.skipped]).size).toBe(waiting);
    expect(body.feats.claimed).toBe(body.featIds.length + ALREADY_COLLECTED);
    expect(app.repos.feats.claimed(one.baseId).size).toBe(body.featIds.length + ALREADY_COLLECTED);
    // Every feat that was collected is now collected, and every one passed over is still ready.
    for (const id of body.featIds) {
      expect(body.feats.progress.find((row) => row.id === id)?.state, id).toBe('claimed');
    }
    for (const id of body.skipped) {
      expect(body.feats.progress.find((row) => row.id === id)?.state, id).toBe('ready');
    }
  });

  /**
   * A full store leaves a rung ready rather than swallowing what it pays (maintainer, 2026-09-23).
   *
   * `addResources` has no ceiling and the settle clamps on the next tick, so a feat paying more
   * scrap than the Apothecary can hold used to be collected and the overflow simply vanished. The
   * teeth here are the pair: the same feat is passed over with the store full and collected once
   * there is room, so the test cannot pass by never collecting anything.
   */
  it('passes over a feat whose pay has nowhere to go, and collects it once there is room', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_full');
    give(app, one.baseId, featMeasureKey('missions_done'), 500);

    const firstBoard = await board(app, one.token);
    const before = firstBoard.ready;
    expect(before, 'the fixture finished no ladders').toBeGreaterThan(0);
    const readyAtFirst = new Set(
      firstBoard.progress.filter((row) => row.state === 'ready').map((row) => row.id),
    );

    // Every store filled past its own ceiling, so anything paying a resource has nowhere to go.
    // Ten times over rather than exactly to it: the claim settles first, and a build finishing in
    // between on a loaded machine raised the ceiling under an exact fill and left room (flaky in
    // the full suite). A store above its ceiling has no room whatever the ceiling moves to.
    const base = app.repos.bases.findByOwnerId(one.userId)!;
    const bulk = storageCapacity(base.buildings);
    // Caps are left where they are: their ceiling is Infinity, because the currency has no
    // ceiling, and the repo refuses to write a non-finite figure. That is also why a feat paying
    // caps is never passed over.
    const brimming = Object.fromEntries(
      RESOURCE_KEYS.map((key) => {
        const ceiling = storageCapacityFor(base.buildings, key, bulk);
        return [key, Number.isFinite(ceiling) ? ceiling * 10 : base.resources[key]];
      }),
    ) as Resources;
    app.repos.bases.updateHoldings(base.id, brimming, base.inventory);

    const full = await claimAll(app, one.token);
    const fullBody = full.json<{ featIds: string[]; skipped: string[] }>();
    expect(
      fullBody.skipped.length,
      'nothing was passed over with every store brimming',
    ).toBeGreaterThan(0);

    // Emptied, and the rungs that were passed over are collectable.
    const drained = app.repos.bases.findById(base.id)!;
    app.repos.bases.updateHoldings(
      base.id,
      Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 0])) as Resources,
      drained.inventory,
    );
    const room = await claimAll(app, one.token);
    const roomBody = room.json<{ featIds: string[]; skipped: string[] }>();
    /*
     * The teeth: rungs passed over with the stores full are collected now they are empty. Not
     * *every* one of them, because a feat can also be passed over for want of unit slots and
     * emptying a store does nothing about that, so what is pinned is that the set shrank and that
     * the collection this time is drawn from what was skipped last time.
     */
    expect(roomBody.skipped.length).toBeLessThan(fullBody.skipped.length);
    const wasSkipped = new Set(fullBody.skipped);
    expect(
      roomBody.featIds.filter((id) => wasSkipped.has(id)).length,
      'the emptied store collected nothing it had passed over',
    ).toBeGreaterThan(0);
    // Anything else it collected was not ready the first time: the caps the first press paid out
    // finished `caps_1`, which is earned, not passed over.
    for (const id of roomBody.featIds) {
      expect(wasSkipped.has(id) || !readyAtFirst.has(id), id).toBe(true);
    }
  });

  /**
   * §A1 against the backlog, which is where the batch differs from a single press.
   *
   * `claim-all` folds every waiting reward into one payment, so the ceiling has to be spent down
   * across the run rather than checked once: a feat that would fit on its own does not fit after
   * the one before it has taken the room. A reward too big for the district is left **ready**, and
   * the rest of the backlog is still paid, because the caps and pages behind the other feats have
   * nothing to do with the roster.
   */
  it('pays the backlog it can house and leaves the rest ready', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_backlog_room');
    const big = findFeat('deployed_3')!;

    // A ladder whose top rung pays more units than any fresh district can hold, plus one feat that
    // pays no units at all, so the run has something to collect either way.
    give(app, one.baseId, big.measure, big.target);
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    const spare = districtUnitSlots(app.repos, app.repos.bases.findById(one.baseId)!).spare;
    expect(unitSlotsUsed(big.reward.units ?? {}), 'the top rung must not fit').toBeGreaterThan(
      spare,
    );
    const waiting = (await board(app, one.token)).progress.filter((row) => row.state === 'ready');
    expect(waiting.map((row) => row.id)).toContain(big.id);
    expect(waiting.map((row) => row.id)).toContain(FIRST_RUNG);

    const response = await claimAll(app, one.token);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ featIds: string[]; feats: FeatsResponse }>();

    // The one that does not fit is left alone; the rest of the backlog is paid.
    expect(body.featIds).not.toContain(big.id);
    expect(body.featIds).toContain(FIRST_RUNG);
    expect(body.feats.progress.find((row) => row.id === big.id)?.state).toBe('ready');
    expect(app.repos.feats.claimed(one.baseId).has(big.id)).toBe(false);

    // And the run never put the district over its ceiling on the way through.
    const housed = districtUnitSlots(app.repos, app.repos.bases.findById(one.baseId)!);
    expect(housed.total).toBeLessThanOrEqual(housed.capacity);
  });

  /**
   * Collecting can finish other feats, and that is right rather than a leak.
   *
   * The first version of the test above asserted the board came back with nothing waiting and
   * found eight. The rewards are the reason: a feat paying experience raises the level, one paying
   * units puts bodies on the roster, and `level` and `army_units` are both measures other feats are
   * counting. (Infamy was a third until feats stopped paying it, 2026-09-29.) So a backlog collected in one
   * press can leave a smaller one behind it.
   *
   * Nothing is paid twice for it, because each of those is a different feat with its own claim
   * row. What it means is that a player pressing the button twice in a row may be paid twice, for
   * two different things, which is the system working.
   */
  it('can leave a smaller backlog behind, because rewards finish feats too', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_all_cascade');
    for (const [measure, amount] of [
      ['jobs_won_long_odds', 40],
      ['missions_done', 500],
      ['missions_won', 300],
      ['battles_fought', 250],
      ['units_mustered', 2_500],
    ] as const) {
      give(app, one.baseId, featMeasureKey(measure), amount);
    }

    const first = (await claimAll(app, one.token)).json<{ featIds: string[] }>();
    const second = (await claimAll(app, one.token)).json<{ featIds: string[] }>();

    expect(second.featIds.length).toBeGreaterThan(0);
    // The two passes share nothing: a feat collected in the first is not collected again.
    expect(first.featIds.filter((id) => second.featIds.includes(id))).toEqual([]);
  });

  /**
   * The folded reward is the sum of the parts, and it is paid once.
   *
   * `payFeat` reads the crew once and writes each store once, so paying a hundred feats by calling
   * it a hundred times against one copy would have every call overwrite the last and bank only the
   * final feat's caps. This is the check that the fold is doing its job.
   */
  it('pays the whole backlog, not just the last of it', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_all_paid');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 40);
    give(app, one.baseId, featMeasureKey('missions_done'), 500);

    const before = app.repos.bases.findByOwnerId(one.userId)!.resources.caps;
    const body = (await claimAll(app, one.token)).json<{ featIds: string[]; paid: FeatReward }>();

    const expected = mergeFeatRewards(body.featIds.map((id) => findFeat(id)!.reward));
    expect(body.paid).toEqual(expected);
    const after = app.repos.bases.findByOwnerId(one.userId)!.resources.caps;
    expect(after).toBe(before + (expected.resources?.caps ?? 0));
  });

  it('is a quiet success when there is nothing to collect', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_all_empty');

    const response = await claimAll(app, one.token);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ featIds: string[] }>().featIds).toEqual([]);
  });

  it('pays nothing a second time, however many times it is pressed', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_all_twice');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 40);

    const first = (await claimAll(app, one.token)).json<{ featIds: string[] }>();
    expect(first.featIds.length).toBeGreaterThan(0);
    const paid = app.repos.bases.findByOwnerId(one.userId)!.resources.caps;

    /*
     * Pressed until it settles, then checked.
     *
     * Not "the second press collects nothing": a reward can finish another feat (see the cascade
     * test above), so a second press may legitimately pay for something new. What must never
     * happen is the same feat paying twice, which is what the claim ledger is checked for.
     */
    const seen = new Set(first.featIds);
    for (let press = 0; press < 5; press += 1) {
      const again = (await claimAll(app, one.token)).json<{ featIds: string[] }>();
      for (const id of again.featIds) {
        expect(seen.has(id), `${id} was collected twice`).toBe(false);
        seen.add(id);
      }
    }
    expect(app.repos.feats.claimed(one.baseId).size).toBe(seen.size + ALREADY_COLLECTED);
    expect(app.repos.bases.findByOwnerId(one.userId)!.resources.caps).toBeGreaterThanOrEqual(paid);
  });

  it('refuses anybody without a token', async () => {
    const app = await makeApp();
    expect((await app.inject({ method: 'POST', url: '/api/feats/claim-all' })).statusCode).toBe(
      401,
    );
  });
});

describe('the badge on the bottom bar', () => {
  it('counts what is waiting, and agrees with the screen', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_badge');

    const quiet = await app.inject({ method: 'GET', url: '/api/me', headers: auth(one.token) });
    expect(quiet.json<{ unread: { featsReady: number } }>().unread.featsReady).toBe(0);

    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);
    give(app, one.baseId, featMeasureKey('missions_done'), 5);

    const loud = await app.inject({ method: 'GET', url: '/api/me', headers: auth(one.token) });
    const count = loud.json<{ unread: { featsReady: number } }>().unread.featsReady;
    expect(count).toBe(2);
    // The badge and the page are two readings of one question and must never differ.
    expect((await board(app, one.token)).ready).toBe(count);
  });

  it('falls as feats are collected', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_badge_falls');
    give(app, one.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    expect((await board(app, one.token)).ready).toBe(1);
    await claim(app, one.token, FIRST_RUNG);
    const after = await app.inject({ method: 'GET', url: '/api/me', headers: auth(one.token) });
    expect(after.json<{ unread: { featsReady: number } }>().unread.featsReady).toBe(0);
  });
});

describe('one crew’s feats are their own', () => {
  /**
   * Two players acting at once, which is the maintainer's own ask.
   *
   * Feats are per crew and every counter is keyed by base, so the thing worth proving is that
   * nothing leaks sideways: one crew finishing something must not move the other's board, and one
   * crew collecting must not spend the other's claim.
   */
  it('keeps two crews apart while both are working', async () => {
    const app = await makeApp();
    const a = await player(app, 'feats_crew_a');
    const b = await player(app, 'feats_crew_b');

    give(app, a.baseId, featMeasureKey('jobs_won_long_odds'), 1);
    give(app, a.baseId, featMeasureKey('missions_done'), 40);
    give(app, b.baseId, featMeasureKey('battles_fought'), 1);

    const boardA = await board(app, a.token);
    const boardB = await board(app, b.token);

    expect(boardA.progress.find((row) => row.id === 'runs_1')?.state).toBe('ready');
    expect(boardB.progress.find((row) => row.id === 'runs_1')?.state).toBe('open');
    expect(boardB.progress.find((row) => row.id === 'fights_1')?.state).toBe('ready');
    expect(boardA.progress.find((row) => row.id === 'fights_1')?.state).toBe('open');

    // Both collect at once. Each is paid their own and neither is refused.
    const [claimA, claimB] = await Promise.all([
      claim(app, a.token, FIRST_RUNG),
      claim(app, b.token, 'fights_1'),
    ]);
    expect(claimA.statusCode).toBe(200);
    expect(claimB.statusCode).toBe(200);

    expect(app.repos.feats.claimed(a.baseId)).toEqual(new Set([OPENING, FIRST_RUNG]));
    expect(app.repos.feats.claimed(b.baseId)).toEqual(new Set([OPENING, 'fights_1']));
  });

  it('refuses one crew the feat another has collected, on its own merits', async () => {
    const app = await makeApp();
    const a = await player(app, 'feats_merit_a');
    const b = await player(app, 'feats_merit_b');
    give(app, a.baseId, featMeasureKey('jobs_won_long_odds'), 1);

    expect((await claim(app, a.token, FIRST_RUNG)).statusCode).toBe(200);
    // B has written no letters, so they are refused for being unfinished rather than for A's claim.
    const refused = await claim(app, b.token, FIRST_RUNG);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe('not_finished');
  });
});
