import {
  FEATS,
  FEAT_MEASURE_SPECS,
  ITEM_CATALOG,
  createCommander,
  featMeasureKey,
  findFeat,
  makeAttributes,
  mergeFeatRewards,
  unitSlotsUsed,
  type ClaimFeatResponse,
  type FeatReward,
  type FeatsResponse,
  type ItemId,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { districtUnitSlots } from '../district/unit-slots.js';
import { chooseOverseer } from '../testing/overseer.js';

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

async function player(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: PASSWORD },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
  const body = me.json<{ user: { id: string }; base: { id: string } }>();
  return { token, userId: body.user.id, baseId: body.base.id };
}

async function board(app: FastifyInstance, token: string): Promise<FeatsResponse> {
  const response = await app.inject({ method: 'GET', url: '/api/feats', headers: auth(token) });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<FeatsResponse>();
}

const claim = (app: FastifyInstance, token: string, featId: string) =>
  app.inject({
    method: 'POST',
    url: '/api/feats/claim',
    headers: auth(token),
    payload: { featId },
  });

/** The feat every crew can finish first: one letter written. Small, and pays plain caps. */
const LETTER = 'letters_1';

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
    expect(feats.claimed).toBe(0);
  });

  it('shows a brand new crew the head of every ladder and nothing behind it', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_new');

    const feats = await board(app, one.token);
    const byId = new Map(feats.progress.map((row) => [row.id, row]));
    for (const spec of FEATS) {
      expect(byId.get(spec.id)?.state, spec.id).toBe(spec.after === null ? 'open' : 'locked');
    }
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
   * Half of what a feat asks about lands lazily on read: production, builds, training. A crew that
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
    expect(app.repos.feats.tallies(one.baseId)).toEqual({});

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
    give(app, one.baseId, featMeasureKey('messages_sent'), 1);

    const before = app.repos.bases.findByOwnerId(one.userId)!.resources;
    const response = await claim(app, one.token, LETTER);
    expect(response.statusCode, response.body).toBe(200);

    const body = response.json<ClaimFeatResponse>();
    const reward = findFeat(LETTER)!.reward;
    expect(body.featId).toBe(LETTER);
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
    give(app, one.baseId, featMeasureKey('messages_sent'), 1);

    const body = (await claim(app, one.token, LETTER)).json<ClaimFeatResponse>();
    expect(body.feats.progress.find((row) => row.id === LETTER)?.state).toBe('claimed');
    expect(body.feats.claimed).toBe(1);
    expect(body.feats.ready).toBe(0);
  });

  it('opens the next rung of the ladder', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_ladder');
    give(app, one.baseId, featMeasureKey('messages_sent'), 1);

    const before = (await board(app, one.token)).progress;
    /*
     * The second rung wants twenty five letters, so it is not finished. What has changed is that
     * it is no longer **locked**, and that happened the moment the first rung was achieved rather
     * than when it was collected: the ladder follows the work, not the button.
     */
    expect(before.find((row) => row.id === 'letters_1')?.state).toBe('ready');
    expect(before.find((row) => row.id === 'letters_2')?.state).toBe('open');
    expect(before.find((row) => row.id === 'letters_2')?.value).toBe(1);

    // And collecting the first does not shut the second again.
    const body = (await claim(app, one.token, LETTER)).json<ClaimFeatResponse>();
    expect(body.feats.progress.find((row) => row.id === 'letters_2')?.state).toBe('open');
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
   * `queueTraining`, which refuses to *start* training there is no room for. An army can be over
   * capacity today by a garrison coming home or a muster withdrawing, and a feat paying units is
   * the same situation. The reward must arrive whole rather than being quietly trimmed, and the
   * consequence is the ordinary one, that nothing new can be trained until there are beds.
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
   * A reward that overflows the store.
   *
   * The same question for resources, and the answer is already settled by how raid loot behaves:
   * `walk` caps production at `max(what is held, the ceiling)`, so being over the top means
   * production adds nothing and nothing is taken away. A feat paying past the ceiling has to
   * behave the same, or a crew would collect a large reward and watch most of it vanish on their
   * next read of the district.
   */
  it('keeps a reward that overflows the store, the way raid loot is kept', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_overflow');
    give(app, one.baseId, featMeasureKey('messages_sent'), 1);

    const base = app.repos.bases.findByOwnerId(one.userId)!;
    // Far over every ceiling: this crew has no Apothecary, so storage is at its base of 800.
    app.repos.bases.updateResources(base.id, { ...base.resources, scrap: 90_000 });

    expect((await claim(app, one.token, LETTER)).statusCode).toBe(200);
    const paid = app.repos.bases.findByOwnerId(one.userId)!.resources.scrap;
    expect(paid).toBeGreaterThanOrEqual(90_000);

    // And a settle afterwards does not take it back.
    await board(app, one.token);
    expect(app.repos.bases.findByOwnerId(one.userId)!.resources.scrap).toBe(paid);
  });

  it('pays infamy into the ledger and counts it as earned', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_infamy');
    const feat = FEATS.find((spec) => spec.reward.infamy !== undefined && spec.after === null)!;
    give(app, one.baseId, featMeasureKey(feat.measure, feat.scope), feat.target);

    const before = app.repos.bases.findByOwnerId(one.userId)!.economy.infamy;
    expect((await claim(app, one.token, feat.id)).statusCode).toBe(200);

    const after = app.repos.bases.findByOwnerId(one.userId)!.economy.infamy;
    expect(after).toBe(before + (feat.reward.infamy ?? 0));
    // And it is infamy they now have and did not before, so the lifetime ladder counts it too.
    expect(
      app.repos.feats.tallies(one.baseId)[featMeasureKey('infamy_earned')],
    ).toBeGreaterThanOrEqual(feat.reward.infamy ?? 0);
  });

  /**
   * §D8: a feat is a faucet, and `infamy_gain` says it pays on "everything that earns any".
   *
   * Three things in the game pay infamy. A fight scales it by the channel, a job scales it by the
   * channel, and a claimed feat paid the flat catalogue figure, so the Broadcast Tower and the two
   * Logistics perks were worth nothing on the one reward a player collects deliberately. It read as
   * a bug inside `payFeat` twice over: `awardPlayerXp`, a few lines away in the same function,
   * folds `xpGainPercent` into a feat's XP at its own funnel, so the same reward already scaled one
   * of its two currencies and not the other.
   *
   * `gates_1` pays 240, which is large enough that nine percent survives the round to a whole
   * number: a small reward would round back onto the flat figure and prove nothing.
   */
  it('scales a feat’s infamy by the crew’s own infamy_gain, the way a fight’s is', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_infamy_perk');
    const feat = FEATS.find((spec) => spec.id === 'gates_1')!;
    const reward = feat.reward.infamy ?? 0;

    const base = app.repos.bases.findByOwnerId(one.userId)!;
    app.repos.bases.updateCommanders(base.id, [
      {
        ...createCommander('teller', 'The Teller', 'consigliere', makeAttributes(40)),
        perks: ['legend_builder'],
      },
    ]);
    give(app, one.baseId, featMeasureKey(feat.measure, feat.scope), feat.target);

    const before = app.repos.bases.findByOwnerId(one.userId)!.economy.infamy;
    expect((await claim(app, one.token, feat.id)).statusCode).toBe(200);
    const paid = app.repos.bases.findByOwnerId(one.userId)!.economy.infamy - before;

    // +9% off `legend_builder`, the same arithmetic `earnedInfamy` does for a raid.
    expect(paid).toBe(Math.round(reward * 1.09));
    expect(paid, 'the catalogue figure was paid flat').toBeGreaterThan(reward);
    // And the ladder counts what the crew was actually paid, not what the catalogue printed.
    expect(app.repos.feats.tallies(one.baseId)[featMeasureKey('infamy_earned')]).toBeCloseTo(
      reward * 1.09,
      6,
    );
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

    const response = await claim(app, one.token, LETTER);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toBe('not_finished');
  });

  it('refuses a rung whose ladder has not reached it', async () => {
    const app = await makeApp();
    const one = await player(app, 'feats_locked');

    const response = await claim(app, one.token, 'letters_2');
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toBe('locked');
  });

  /**
   * §A1 is a ceiling on a district, and a feat is not an exemption from it.
   *
   * Seven feats pay units straight onto the roster, and the two largest pay 960 unit slots against
   * a finished district's two thousand and a fresh one's twenty-six. Training refuses an order
   * that would not fit and the Garage refuses a machine for the same reason; this was the one door
   * left open, and it let a crew walk out of the feats screen holding an army its district could
   * not house.
   *
   * Refused **without** marking it collected, which is the half that matters: the feat stays ready
   * and the reward is still there once the crew has made room.
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

    const response = await claim(app, one.token, big.id);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toBe('no_unit_slots');

    // Nothing was paid and nothing was spent: the roster is untouched and the feat is collectable
    // the moment there is room for it.
    expect(app.repos.bases.findById(one.baseId)!.army).toEqual(before);
    expect(await stateOf()).toBe('ready');
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
      (await app.inject({ method: 'POST', url: '/api/feats/claim', payload: { featId: LETTER } }))
        .statusCode,
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
    give(app, one.baseId, featMeasureKey('messages_sent'), 1);

    const before = app.repos.bases.findByOwnerId(one.userId)!.resources.caps;
    const first = await claim(app, one.token, LETTER);
    expect(first.statusCode).toBe(200);
    const paid = app.repos.bases.findByOwnerId(one.userId)!.resources.caps;

    for (let press = 0; press < 5; press += 1) {
      const again = await claim(app, one.token, LETTER);
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
    give(app, one.baseId, featMeasureKey('messages_sent'), 1);

    const before = app.repos.bases.findByOwnerId(one.userId)!.resources.caps;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claim(app, one.token, LETTER)),
    );

    expect(results.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(results.filter((response) => response.statusCode === 409)).toHaveLength(7);

    const reward = findFeat(LETTER)!.reward.resources?.caps ?? 0;
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
     * The feats that pay units can run out of district before they run out of ladder (§A1), and
     * being refused leaves them ready, so they are remembered and not offered again: without this
     * the walk below would spend all twenty passes re-pressing the same shut door.
     *
     * That they are refused at all is the point of the whole cap, so it is asserted rather than
     * tolerated silently, and the invariant it exists to keep is checked at the end.
     */
    const noRoom = new Set<string>();
    for (let pass = 0; pass < 20 && collected < BUDGET; pass += 1) {
      const ready = (await board(app, one.token)).progress
        .filter((row) => row.state === 'ready')
        .filter((row) => !noRoom.has(row.id));
      if (ready.length === 0) break;
      for (const row of ready) {
        if (collected >= BUDGET) break;
        const response = await claim(app, one.token, row.id);
        if (response.statusCode === 409) {
          expect(response.json<{ error: { message: string } }>().error.message).toBe(
            'no_unit_slots',
          );
          expect(unitSlotsUsed(findFeat(row.id)?.reward.units ?? {})).toBeGreaterThan(0);
          noRoom.add(row.id);
          continue;
        }
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
    expect(ledger.claimed).toBe(collected);
    expect(app.repos.feats.claimed(one.baseId).size).toBe(collected);

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
    for (const [id, count] of Object.entries(owed.items ?? {})) {
      expect(base.inventory[id as ItemId] ?? 0, id).toBe(count);
    }

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
      ['messages_sent', 40],
      ['missions_done', 500],
      ['missions_won', 300],
      ['battles_fought', 250],
      ['scouting_runs', 200],
      ['units_trained', 2_500],
    ] as const) {
      give(app, one.baseId, featMeasureKey(measure), amount);
    }

    const waiting = (await board(app, one.token)).ready;
    expect(waiting).toBeGreaterThan(10);

    const response = await claimAll(app, one.token);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ featIds: string[]; feats: FeatsResponse }>();

    expect(body.featIds).toHaveLength(waiting);
    expect(body.feats.claimed).toBe(waiting);
    expect(app.repos.feats.claimed(one.baseId).size).toBe(waiting);
    // Every feat that was waiting is now collected, and none of them is waiting any more.
    for (const id of body.featIds) {
      expect(body.feats.progress.find((row) => row.id === id)?.state, id).toBe('claimed');
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
    give(app, one.baseId, featMeasureKey('messages_sent'), 1);

    const spare = districtUnitSlots(app.repos, app.repos.bases.findById(one.baseId)!).spare;
    expect(unitSlotsUsed(big.reward.units ?? {}), 'the top rung must not fit').toBeGreaterThan(
      spare,
    );
    const waiting = (await board(app, one.token)).progress.filter((row) => row.state === 'ready');
    expect(waiting.map((row) => row.id)).toContain(big.id);
    expect(waiting.map((row) => row.id)).toContain(LETTER);

    const response = await claimAll(app, one.token);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ featIds: string[]; feats: FeatsResponse }>();

    // The one that does not fit is left alone; the rest of the backlog is paid.
    expect(body.featIds).not.toContain(big.id);
    expect(body.featIds).toContain(LETTER);
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
   * infamy fills the wallet, one paying units puts bodies on the roster, and `level`, `infamy_held`
   * and `army_units` are all measures other feats are counting. So a backlog collected in one
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
      ['messages_sent', 40],
      ['missions_done', 500],
      ['missions_won', 300],
      ['battles_fought', 250],
      ['units_trained', 2_500],
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
    give(app, one.baseId, featMeasureKey('messages_sent'), 40);
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
    give(app, one.baseId, featMeasureKey('messages_sent'), 40);

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
    expect(app.repos.feats.claimed(one.baseId).size).toBe(seen.size);
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

    give(app, one.baseId, featMeasureKey('messages_sent'), 1);
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
    give(app, one.baseId, featMeasureKey('messages_sent'), 1);

    expect((await board(app, one.token)).ready).toBe(1);
    await claim(app, one.token, LETTER);
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

    give(app, a.baseId, featMeasureKey('messages_sent'), 1);
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
      claim(app, a.token, LETTER),
      claim(app, b.token, 'fights_1'),
    ]);
    expect(claimA.statusCode).toBe(200);
    expect(claimB.statusCode).toBe(200);

    expect(app.repos.feats.claimed(a.baseId)).toEqual(new Set([LETTER]));
    expect(app.repos.feats.claimed(b.baseId)).toEqual(new Set(['fights_1']));
  });

  it('refuses one crew the feat another has collected, on its own merits', async () => {
    const app = await makeApp();
    const a = await player(app, 'feats_merit_a');
    const b = await player(app, 'feats_merit_b');
    give(app, a.baseId, featMeasureKey('messages_sent'), 1);

    expect((await claim(app, a.token, LETTER)).statusCode).toBe(200);
    // B has written no letters, so they are refused for being unfinished rather than for A's claim.
    const refused = await claim(app, b.token, LETTER);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe('not_finished');
  });
});
