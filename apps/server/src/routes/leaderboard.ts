import {
  DEFAULT_CITY_ID,
  LEADERBOARD_LIMIT,
  cityOf,
  LeaderboardBoardSchema,
  ranked,
  type FactionStanding,
  type LeaderboardResponse,
  type PlayerStanding,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../errors.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * The standings (board request, §J9).
 *
 * One read-only route serving two boards, because they are one screen with two tabs and the scope
 * toggle applies to both. Nothing here settles anything: infamy does not tick, it is only ever
 * written by a fight resolving, so a leaderboard read is a read.
 *
 * ## The scope
 *
 * `localOnly` limits the board to the caller's own **city**. There is one city today, so the two
 * scopes return the same rows, and that is the point rather than a shortcut: the board is adding
 * more cities, and a filter written against a city id now becomes real the day a second one is
 * authored, with no screen to rewrite. The district a crew holds is not the scope; several crews
 * share a district and a per-district board would be a board of one.
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
function standings(repos: Repositories): PlayerStanding[] {
  const factions = new Map(repos.factions.all().map((faction) => [faction.id, faction]));
  return repos.bases.listStandings().flatMap((base) => {
    const user = repos.users.findById(base.ownerId);
    // A half-registered account with no user row is not a player; it is a row nobody can be shown.
    if (!user) return [];
    const held = repos.factions.membershipOf(base.ownerId);
    const faction = held ? factions.get(held.factionId) : undefined;
    return [
      {
        // Filled in by `ranked` once the list is sorted and the scope is applied: a rank computed
        // before filtering would number the local board 3, 7, 12.
        rank: 1,
        userId: base.ownerId,
        username: user.username,
        districtId: base.districtId,
        cityId: cityOf(base.districtId) ?? DEFAULT_CITY_ID,
        districtName: base.name,
        level: base.level,
        infamy: base.infamy,
        notoriety: base.notoriety,
        factionName: faction?.name ?? null,
        factionBadge: faction?.badge ?? null,
        isBot: base.isBot,
      },
    ];
  });
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
      const sorted = [...players].sort(
        (a, b) => b.infamy - a.infamy || b.level - a.level || a.username.localeCompare(b.username),
      );
      // Ranked once. `yourRank` reads off the *whole* list rather than the page, so somebody in
      // 140th place is still told where they are, which is the one number they came for.
      const withRanks = ranked(sorted, (entry) => entry.infamy);
      const you = withRanks.find((entry) => entry.userId === userId);
      return {
        board,
        localOnly: local,
        scope,
        entries: withRanks.slice(0, LEADERBOARD_LIMIT),
        yourRank: you?.rank ?? null,
      };
    }

    const inScope = new Set(players.map((entry) => entry.userId));
    const rows: FactionStanding[] = app.repos.factions.all().flatMap((faction) => {
      const members = app.repos.factions.members(faction.id);
      // Any member in the city puts the faction on the local board. See the note at the top.
      if (local && !members.some((row) => inScope.has(row.userId))) return [];
      const levels = members.map((row) => app.repos.bases.findByOwnerId(row.userId)?.level ?? 0);
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
