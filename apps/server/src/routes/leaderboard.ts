import {
  DEFAULT_CITY_ID,
  LEADERBOARD_LIMIT,
  PLAYER_LOOKUP_LIMIT,
  PlayerLookupQuerySchema,
  averageLevel,
  cityIsOpen,
  cityOf,
  findLocation,
  LeaderboardBoardSchema,
  notorietySpentTo,
  ranked,
  type FactionStanding,
  type LeaderboardResponse,
  type PlayerLookupResponse,
  type PlayerStanding,
  displayNameOf,
  suggestPlayers,
  featMeasureKey,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../errors.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * The standings (maintainer request, §J9).
 *
 * One read-only route serving two boards, because they are one screen with two tabs and the city
 * picker applies to both. Nothing here settles anything: infamy does not tick, it is written when a
 * fight or a job comes home, and the world clock settles both, so a leaderboard read is a read.
 *
 * ## The city picks the names, never the numbers
 *
 * Maintainer, 2026-10-07: "For leaderboard make it so you can choose a city, (remove my city only)
 * or all cities, but it always shows everything you own its not a per city filter. But if you have
 * only one city picked, it shows all players holding ground in that city, however their stats are
 * global."
 *
 * So `city` shortens the list and touches nothing on a row. Every figure the board prints is that
 * player's across the whole world, which is the only reading that makes two rows comparable: a
 * per-city infamy would rank a crew below somebody it has beaten everywhere.
 *
 * Who is "in" a city is read off the **control rows**, not off where a crew lives. That was the
 * defect in the `localOnly` scope this replaces: it filtered on the reader's home city and on each
 * row's, so a crew holding half of Terminus from an Ashfall address neither read Terminus's board
 * nor appeared on it. Home is beside the point now; one location held is the whole test.
 *
 * A faction is in a city if **any** of its members holds ground there, which is the only reading
 * that survives a faction spread across two of them: a faction has no address of its own, and the
 * board is a list of who you might run into in that city.
 */

const QuerySchema = z.object({
  board: LeaderboardBoardSchema.default('players'),
  /**
   * The city whose holders to list. Absent is every city, which is what the screen opens on.
   *
   * Lenient about a city the world does not have and about one that is not open yet: both are
   * answered with every city, and the response says which city it listed, so a screen holding a
   * stale id draws the world rather than an empty sheet.
   */
  city: z.string().optional(),
});

/**
 * A board row with the crew id it was read off.
 *
 * Ground is held by a crew, not by an account, so `baseId` is the join key the city filter needs.
 * It is not one of the board's columns, and {@link boardRow} takes it off before a row is sent.
 */
export type Standing = PlayerStanding & { baseId: string };

/** Every player's row, before ranking: the shape both boards are derived from. */
export function standings(repos: Repositories): Standing[] {
  /*
   * Three reads for the whole board rather than two per crew (hardening pass, 2026-09-27). Each
   * per-crew read parsed a whole user row, and the board is callable ten times a second per account.
   */
  const factions = new Map(repos.factions.all().map((faction) => [faction.id, faction]));
  const names = new Map(repos.users.names().map((user) => [user.id, user]));
  const memberships = repos.factions.factionOfEveryone();
  const earned = repos.feats.tallyOfEveryone(featMeasureKey('infamy_earned'));
  return repos.bases.listStandings().flatMap((base) => {
    const user = names.get(base.ownerId);
    // A half-registered account with no user row is not a player; it is a row nobody can be shown.
    if (user === undefined) return [];
    const { username } = user;
    const factionId = memberships.get(base.ownerId);
    const faction = factionId ? factions.get(factionId) : undefined;
    return [
      {
        // Filled in by `ranked` once the list is sorted and the city has been applied: a rank
        // computed before filtering would number a one-city board 3, 7, 12.
        rank: 1,
        baseId: base.id,
        userId: base.ownerId,
        username,
        displayName: displayNameOf(user),
        districtId: base.districtId,
        cityId: cityOf(base.districtId) ?? DEFAULT_CITY_ID,
        districtName: base.name,
        level: base.level,
        infamy: base.infamy,
        /*
         * Everything ever paid, spent or not: the gross `infamy_earned` counter every payout bumps.
         * It was the wallet plus the ladder, back when the ladder was the only thing infamy bought;
         * calling fights, boosts and the back room spend it too, and a crew that spent there sank.
         * The old sum stays as a floor for a crew with no counter yet (an older save, or a wallet
         * set from the Console), since it can only undercount.
         */
        totalInfamy: Math.max(
          earned.get(base.id) ?? 0,
          base.infamy + notorietySpentTo(base.notoriety),
        ),
        notoriety: base.notoriety,
        factionId: faction?.id ?? null,
        factionName: faction?.name ?? null,
        factionBadge: faction?.badge ?? null,
        isBot: base.isBot,
      },
    ];
  });
}

/** The row as the board prints it: the join key above is the server's business, not a column. */
function boardRow({ baseId: _crew, ...columns }: Standing): PlayerStanding {
  return columns;
}

/**
 * The crews holding at least one location in `cityId`, by crew id.
 *
 * Read off the live control rows, which is the same source `city/access.ts` reads for the doors to
 * a city's rooms: hold a place there and you are in that city until somebody takes it off you,
 * whatever address your district has. A row naming a location the atlas no longer has is skipped
 * rather than counted against the city it used to be in.
 *
 * `city/stakes.ts` walks the same map to count locations per crew per city for the Bar and the
 * market. Its `holdings` is private to that module and counts what this does not need; if a third
 * caller turns up, that is the one to export.
 */
function crewsHoldingIn(repos: Repositories, cityId: string): Set<string> {
  const held = new Set<string>();
  for (const control of repos.city.controls().values()) {
    if (control.holder.kind !== 'crew') continue;
    const districtId = findLocation(control.locationId)?.districtId;
    if (districtId === undefined || cityOf(districtId) !== cityId) continue;
    held.add(control.holder.baseId);
  }
  /*
   * Living there counts as holding ground (maintainer, 2026-10-07). A home plot is a district on
   * the map and the crew standing on it is in the city whether or not it has taken a location yet,
   * which is also how `city/access.ts` decides who may use the city's rooms. Without this a city's
   * board read empty until somebody took a plot, which looks broken rather than early.
   */
  for (const summary of repos.bases.listSummaries()) {
    if (cityOf(summary.districtId) === cityId) held.add(summary.id);
  }
  return held;
}

/**
 * The players' board in rank order, from whichever rows the caller has scoped.
 *
 * One sort for the board and for a crew's file (`/crews/:id`): a file quoting a rank the standings
 * would not agree with is two screens arguing about one number.
 */
export function rankedPlayers(rows: readonly PlayerStanding[]): PlayerStanding[] {
  const sorted = [...rows].sort(
    (a, b) => b.infamy - a.infamy || b.level - a.level || a.username.localeCompare(b.username),
  );
  return ranked(sorted, (entry) => entry.infamy);
}

export function registerLeaderboardRoutes(app: FastifyInstance): void {
  app.get('/leaderboard', { preHandler: app.authenticate }, (request): LeaderboardResponse => {
    const { board, city } = parseBody(QuerySchema, request.query);
    const userId = request.currentUser.id;
    // A city nobody can play in yet is answered with every city rather than with an empty list: a
    // shut city's rooms are shut to everybody (`canEnterCity`), and an empty leaderboard reads as a
    // broken screen. The caller's own city is not involved in any of this any more.
    const scope = city !== undefined && cityIsOpen(city) ? city : null;

    const all = standings(app.repos);
    const holders = scope === null ? null : crewsHoldingIn(app.repos, scope);
    const listed = holders === null ? all : all.filter((entry) => holders.has(entry.baseId));
    const players = listed.map(boardRow);

    if (board === 'players') {
      // Ranked once. `yourRank` reads off the *whole* list rather than the page, so somebody in
      // 140th place is still told where they are, which is the one number they came for.
      const withRanks = rankedPlayers(players);
      const you = withRanks.find((entry) => entry.userId === userId);
      return {
        board,
        city: scope,
        /*
         * The top hundred by the wallet only. The client's other sorts and its name search work
         * inside these rows, so a crew outside them cannot be found that way. Deliberate for now
         * (maintainer, 2026-09-29): the world is aimed at about twenty players, far inside the
         * window. Rank and cut on the server when that stops being true.
         */
        entries: withRanks.slice(0, LEADERBOARD_LIMIT),
        yourRank: you?.rank ?? null,
      };
    }

    const inScope = new Set(players.map((entry) => entry.userId));
    // Each member's level off the standings already read, rather than a whole base per member.
    const levelOf = new Map(all.map((entry) => [entry.userId, entry.level]));
    // Every seat in one read, grouped here (bug pass, 2026-10-06): it was a query per faction, on a
    // board every open tab refetches on each world broadcast.
    const membersOf = new Map<string, string[]>();
    for (const [userId, factionId] of app.repos.factions.factionOfEveryone()) {
      membersOf.set(factionId, [...(membersOf.get(factionId) ?? []), userId]);
    }
    const rows: FactionStanding[] = app.repos.factions.all().flatMap((faction) => {
      const members = membersOf.get(faction.id) ?? [];
      // Any member holding ground there puts the faction on that city's board. See the note at the
      // top. The figures below are the faction's whole, as the players' rows are.
      if (holders !== null && !members.some((userId) => inScope.has(userId))) return [];
      const levels = members.map((userId) => levelOf.get(userId) ?? 0);
      return [
        {
          rank: 1,
          factionId: faction.id,
          name: faction.name,
          badge: faction.badge,
          members: members.length,
          // Off the faction, not summed over the roster: what a leaver won stays won (§J8).
          infamy: faction.infamyEarned,
          topLevel: levels.length > 0 ? Math.max(...levels) : 0,
          averageLevel: averageLevel(levels),
        },
      ];
    });

    const sorted = rows.sort(
      (a, b) => b.infamy - a.infamy || b.topLevel - a.topLevel || a.name.localeCompare(b.name),
    );
    const withRanks = ranked(sorted, (entry) => entry.infamy);
    const held = app.repos.factions.membershipOf(userId);
    const yours = held ? withRanks.find((entry) => entry.factionId === held.factionId) : undefined;
    return {
      board,
      city: scope,
      entries: withRanks.slice(0, LEADERBOARD_LIMIT),
      yourRank: yours?.rank ?? null,
    };
  });

  /*
   * The letter composer's name lookup (maintainer, 2026-10-06).
   *
   * Out of every player in the game, ranked as the whole board ranks them so the `#` beside a name
   * agrees with the standings. The composer used to match against the board itself, which stops at
   * `LEADERBOARD_LIMIT`, so the exact name of somebody ranked lower read as "no such player".
   */
  app.get('/players/lookup', { preHandler: app.authenticate }, (request): PlayerLookupResponse => {
    const { q } = parseBody(PlayerLookupQuerySchema, request.query);
    const userId = request.currentUser.id;
    const everybody = rankedPlayers(standings(app.repos)).filter(
      (entry) => entry.userId !== userId,
    );
    return { players: suggestPlayers(everybody, q, PLAYER_LOOKUP_LIMIT) };
  });
}
