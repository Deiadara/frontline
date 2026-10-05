import {
  DEFAULT_CITY_ID,
  LEADERBOARD_LIMIT,
  averageLevel,
  cityOf,
  LeaderboardBoardSchema,
  notorietySpentTo,
  ranked,
  type FactionStanding,
  type LeaderboardResponse,
  type PlayerStanding,
  displayNameOf,
  featMeasureKey,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../errors.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * The standings (maintainer request, §J9).
 *
 * One read-only route serving two boards, because they are one screen with two tabs and the scope
 * toggle applies to both. Nothing here settles anything: infamy does not tick, it is written when a
 * fight or a job comes home, and the world clock settles both, so a leaderboard read is a read.
 *
 * ## The scope
 *
 * `localOnly` limits the board to the caller's own **city**. When this was written there was one
 * city and the two scopes returned the same rows, which was the point rather than a shortcut: a
 * filter written against a city id became real the day a second one was authored, with no screen
 * to rewrite. The district a crew lives on is not the scope; a plot holds one crew, so a
 * per-district board would be a board of one.
 *
 * A faction is in a city if **any** of its members is, which is the only reading that survives a
 * faction spread across two of them.
 */

const QuerySchema = z.object({
  board: LeaderboardBoardSchema.default('players'),
  /** Query strings carry text, so the checkbox arrives as `'true'`. */
  localOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(false)
    .transform((value) => value === true || value === 'true'),
});

/** Every player's row, before ranking: the shape both boards are derived from. */
export function standings(repos: Repositories): PlayerStanding[] {
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
        // Filled in by `ranked` once the list is sorted and the scope is applied: a rank computed
        // before filtering would number the local board 3, 7, 12.
        rank: 1,
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
    const { board, localOnly } = parseBody(QuerySchema, request.query);
    const userId = request.currentUser.id;
    const mine = app.repos.bases.findByOwnerId(userId);
    const city = mine ? (cityOf(mine.districtId) ?? null) : null;
    // Asking for a local board with no city of your own is answered with every city rather than
    // with an empty list: an empty leaderboard reads as a broken screen.
    const local = localOnly && city !== null;
    const scope = local ? city : null;

    const all = standings(app.repos);
    const players = local ? all.filter((entry) => entry.cityId === city) : all;

    if (board === 'players') {
      // Ranked once. `yourRank` reads off the *whole* list rather than the page, so somebody in
      // 140th place is still told where they are, which is the one number they came for.
      const withRanks = rankedPlayers(players);
      const you = withRanks.find((entry) => entry.userId === userId);
      return {
        board,
        localOnly: local,
        scope,
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
    const rows: FactionStanding[] = app.repos.factions.all().flatMap((faction) => {
      const members = app.repos.factions.members(faction.id);
      // Any member in the city puts the faction on the local board. See the note at the top.
      if (local && !members.some((row) => inScope.has(row.userId))) return [];
      const levels = members.map((row) => levelOf.get(row.userId) ?? 0);
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
      localOnly: local,
      scope,
      entries: withRanks.slice(0, LEADERBOARD_LIMIT),
      yourRank: yours?.rank ?? null,
    };
  });
}
