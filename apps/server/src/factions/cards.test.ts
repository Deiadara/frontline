import {
  FACTION_SEAT_ONBOARDING_MS,
  FOUND_FACTION_PLAYER_LEVEL,
  DEFAULT_ATTRIBUTES,
  cardMark,
  cardValue,
  createCommander,
  describeCardBonus,
  makeAttributes,
  randomBadge,
  type Attributes,
  type FactionResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { overseerSheetAsFielded } from '../crew/overseer-lift.js';
import { standingEffectsFor } from '../crew/standing.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The table's cards pay the whole table, off each holder's Overseer as the crew fields them.
 *
 * Every card pays every member of the faction (maintainer, 2026-10-15), and nothing while its seat
 * is Onboarding: twelve hours from the moment its holder changed. Pinned here: the screen says the
 * card, the mark and the figure the fold pays (one dealer, two readers), a member who trained
 * nothing collects what the holder's sheet is worth, and a seat in Onboarding pays nothing and
 * cannot be moved.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const LATER = () => new Date(Date.now() + FACTION_SEAT_ONBOARDING_MS + 60_000);

async function register(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode).toBe(201);
  const userId = registered.json<{ user: { id: string } }>().user.id;
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  // Established enough to found and join a table: the faction routes gate on standing.
  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('fixture: no base');
  app.repos.bases.updateProgression(baseId, FOUND_FACTION_PLAYER_LEVEL, base.progression);
  app.repos.bases.updateBuildings(
    baseId,
    base.buildings.map((building) =>
      building.kind === 'nexus' ? { ...building, level: 5 } : building,
    ),
  );
  return { token, userId, baseId };
}

/** A leader and a mate at one table, the leader's Overseer at `sheet`. */
async function table(
  sheet: Attributes,
  beforeFounding?: (app: FastifyInstance, leaderBaseId: string) => void,
  mateSheet?: Attributes,
) {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const leader = await register(app, 'the_leader');
  const mate = await register(app, 'the_mate');
  const owner = app.repos.users.findById(leader.userId);
  const overseer = owner?.overseerId ? app.repos.overseers.findById(owner.overseerId) : undefined;
  if (!overseer) throw new Error('fixture: the leader has no overseer');
  app.repos.overseers.updateAttributes(overseer.id, sheet);
  if (mateSheet) {
    const mateOverseer = app.repos.users.findById(mate.userId)?.overseerId;
    if (mateOverseer) app.repos.overseers.updateAttributes(mateOverseer, mateSheet);
  }
  beforeFounding?.(app, leader.baseId);
  const alone = app.repos.bases.findById(mate.baseId)!;
  const before = standingEffectsFor(app.repos, alone, LATER());

  const founded = await app.inject({
    method: 'POST',
    url: '/api/factions',
    headers: auth(leader.token),
    payload: { name: 'The Ninth Street Crew', badge: randomBadge(9), blurb: '' },
  });
  expect(founded.statusCode, founded.body.slice(0, 200)).toBe(200);
  await app.inject({
    method: 'POST',
    url: '/api/factions/invite',
    headers: auth(leader.token),
    payload: { username: 'the_mate' },
  });
  const asked = await app.inject({
    method: 'GET',
    url: '/api/factions',
    headers: auth(mate.token),
  });
  const inviteId = asked.json<FactionResponse>().invites[0]?.id;
  if (!inviteId) throw new Error('fixture: no invitation for the mate');
  await app.inject({
    method: 'POST',
    url: '/api/factions/answer',
    headers: auth(mate.token),
    payload: { inviteId, accept: true },
  });
  const screen = async () =>
    (
      await app.inject({ method: 'GET', url: '/api/factions', headers: auth(mate.token) })
    ).json<FactionResponse>().members;
  const mateNow = (at: Date) =>
    standingEffectsFor(app.repos, app.repos.bases.findById(mate.baseId)!, at);
  return { app, leader, mate, before, screen, mateNow };
}

/** Every seat at a table as though its Onboarding were long over. */
function settleSeats(app: FastifyInstance, factionId: string): void {
  for (const [card, holder] of app.repos.factions.cardHolders(factionId)) {
    app.repos.factions.setCardHolder(factionId, card, {
      userId: holder.userId,
      since: '2020-01-01T00:00:00.000Z',
    });
  }
}

describe('the cards at the table', () => {
  it('pays the Ace on every member once its seat has onboarded, as the screen says', async () => {
    // 70 in each of the three the ace reads is a B+.
    const sheet: Attributes = { ...DEFAULT_ATTRIBUTES, strength: 70, strategy: 70, authority: 70 };
    const { leader, mate, before, screen, mateNow } = await table(sheet);

    const members = await screen();
    const ace = members.find((member) => member.userId === leader.userId);
    expect(ace?.card).toBe('ace_spades');
    expect(ace?.cardMark).toBe('B+');
    expect(members.find((member) => member.userId === mate.userId)?.card).toBe('king_diamonds');
    // The founder took the seat today, so it is Onboarding and pays nothing yet.
    expect(ace?.onboardingUntil).not.toBeNull();
    expect(mateNow(new Date()).tableAttackOffensePercent).toBe(before.tableAttackOffensePercent);

    // Twelve hours on: the mate, who trained nothing, hits harder going in for the leader's ace,
    // by the figure the screen prints.
    const paid = mateNow(LATER()).tableAttackOffensePercent - before.tableAttackOffensePercent;
    expect(paid).toBe(cardValue('ace_spades', 'B+'));
    expect(describeCardBonus('ace_spades', 'B+')).toBe(`+${paid}% damage when attacking`);
    expect(paid).toBeGreaterThan(0);
  });

  /*
   * The mark reads the Overseer as the crew fields them (maintainer, 2026-10-15): their own sheet
   * lifted by a seated Right Hand, the sheet the crew screen prints. The leader's three are set
   * where the lift crosses a mark, found rather than typed so a retuned scale cannot leave the
   * test proving nothing, and the screen and the fold must both read the lifted mark.
   */
  it('reads the Overseer as their Right Hand lifts them, on the screen and in the fold', async () => {
    const rightHand = createCommander('rh', 'The Second', 'right_hand', makeAttributes(100));
    const now = new Date();
    const sheetAt = (value: number): Attributes => ({
      ...DEFAULT_ATTRIBUTES,
      strength: value,
      strategy: value,
      authority: value,
    });
    const lifted = (value: number) =>
      cardMark('ace_spades', overseerSheetAsFielded(sheetAt(value), [rightHand], now));
    const crossing = Array.from({ length: 60 }, (_, index) => 30 + index).find(
      (value) => cardMark('ace_spades', sheetAt(value)) !== lifted(value),
    );
    if (crossing === undefined) throw new Error('fixture: the lift crosses no mark');

    const { leader, before, screen, mateNow } = await table(sheetAt(crossing), (app, baseId) => {
      const base = app.repos.bases.findById(baseId)!;
      app.repos.bases.updateCommanders(baseId, [...base.commanders, rightHand]);
    });
    const dealt = (await screen()).find((member) => member.userId === leader.userId);
    expect(dealt?.card).toBe('ace_spades');
    expect(dealt?.cardMark).toBe(lifted(crossing));
    expect(dealt?.cardMark).not.toBe(cardMark('ace_spades', sheetAt(crossing)));
    expect(mateNow(LATER()).tableAttackOffensePercent - before.tableAttackOffensePercent).toBe(
      cardValue('ace_spades', lifted(crossing)),
    );
  });

  it('pays the King, the Queen, the Jack and the Joker on their own channels', async () => {
    // 70 in every attribute: a B+ on every card.
    const { app, leader, mate, before, screen, mateNow } = await table(makeAttributes(70));
    // Fill the other three seats by reseating: the leader to each card in turn reads each card.
    const read = (card: Parameters<typeof cardValue>[0]) => cardValue(card, 'B+');
    for (const card of ['queen_hearts', 'jack_clubs', 'joker'] as const) {
      // Every seat onboarded, so the reseat is allowed, then the leader moved there.
      settleSeats(app, app.repos.factions.membershipOf(leader.userId)!.factionId);
      const seated = await app.inject({
        method: 'POST',
        url: '/api/factions/seat',
        headers: auth(leader.token),
        payload: { userId: leader.userId, card },
      });
      expect(seated.statusCode, seated.body.slice(0, 200)).toBe(200);
      const paid = mateNow(LATER());
      if (card === 'queen_hearts') {
        expect(paid.missionSpoilsPercent - before.missionSpoilsPercent).toBe(read(card));
        expect(paid.missionXpPercent - before.missionXpPercent).toBe(read(card));
      }
      if (card === 'jack_clubs') {
        expect(paid.tableBattleInfamyPercent).toBe(read(card));
      }
      if (card === 'joker') expect(paid.dropLuck).toBe(read(card));
    }
    // The mate has held the King all along, at their own mark: vitality when defending.
    const kingMark = (await screen()).find((member) => member.userId === mate.userId)?.cardMark;
    expect(kingMark).toBeDefined();
    expect(mateNow(LATER()).tableDefenceVitalityPercent).toBe(
      cardValue('king_diamonds', kingMark!),
    );
  });

  it('locks a seat for twelve hours once its holder changes, and pays nothing meanwhile', async () => {
    const { app, leader, mate, screen, mateNow } = await table(
      makeAttributes(70),
      undefined,
      makeAttributes(70),
    );
    const factionId = app.repos.factions.membershipOf(leader.userId)!.factionId;
    // Both seats are Onboarding: the founder's and the mate's.
    const refused = await app.inject({
      method: 'POST',
      url: '/api/factions/seat',
      headers: auth(leader.token),
      payload: { userId: mate.userId, card: 'queen_hearts' },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('seat_onboarding');

    // Twelve hours on (the record moved back), the reseat goes through and starts the clock again
    // on both seats it moved: the King the mate left and the Queen they took.
    settleSeats(app, factionId);
    expect((await screen()).every((member) => member.onboardingUntil === null)).toBe(true);
    expect(mateNow(new Date()).tableAttackOffensePercent).toBeGreaterThan(0);
    const moved = await app.inject({
      method: 'POST',
      url: '/api/factions/seat',
      headers: auth(leader.token),
      payload: { userId: mate.userId, card: 'queen_hearts' },
    });
    expect(moved.statusCode, moved.body.slice(0, 200)).toBe(200);
    const after = await screen();
    const mateSeat = after.find((member) => member.userId === mate.userId);
    expect(mateSeat?.card).toBe('queen_hearts');
    expect(mateSeat?.onboardingUntil).not.toBeNull();
    // The Queen pays nothing until the mate's Onboarding is over; the leader's Ace still pays.
    expect(mateNow(new Date()).missionXpPercent).toBe(0);
    expect(mateSeat?.cardMark).toBe('B+');
    expect(mateNow(LATER()).missionXpPercent).toBe(cardValue('queen_hearts', 'B+'));
    expect(mateNow(new Date()).tableAttackOffensePercent).toBeGreaterThan(0);
  });
});
