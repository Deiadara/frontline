import {
  averageLevel,
  displayNameOf,
  type FactionProfileMember,
  type FactionProfileResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { settleWorld } from '../world/settle.js';

/**
 * A faction's file, readable by anybody in the city (maintainer request, 2026-09-12).
 *
 * The faction answer to `/crews/:id`, and deliberately a separate route from `/factions`, which is
 * the screen for the table you sit at. That one carries ally armies, ally battles and open
 * invitations, and all three are the point of membership: a rival reading them would be scouting
 * five crews with one request. This one carries what the standings already print, plus who is at
 * the table, so a player can decide whether to pick a fight with it or ask it for a seat.
 *
 * Same page for your own faction as for anybody else's. `isYours` decides which doors the client
 * offers (there is nobody to message on your own roster, and the faction screen is one click away),
 * never what the page is allowed to say.
 */
export function registerFactionProfileRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/factions/:id/profile',
    { preHandler: app.authenticate },
    (request): FactionProfileResponse => {
      const now = new Date();
      const userId = request.currentUser.id;
      // Levels and infamy are both settle-on-read, and this page prints a member's own numbers
      // beside the faction's: a file quoting a level the crew's own screen would not agree with is
      // two screens arguing about one number.
      settleWorld(app.repos, app.skirmishEngine, now);

      const faction = app.repos.factions.find(request.params.id);
      if (!faction) throw new AppError('NOT_FOUND', 'No such faction');

      const rows = app.repos.factions.members(faction.id);
      const members = rows.flatMap((row): FactionProfileMember[] => {
        const user = app.repos.users.findById(row.userId);
        const base = app.repos.bases.findByOwnerId(row.userId);
        // A seated member with no account or no district cannot be reached in play. Skipped rather
        // than thrown on, so one half-registered row cannot take the whole page down.
        if (!user || !base) return [];
        const overseer = user.overseerId
          ? app.repos.overseers.findById(user.overseerId)
          : undefined;
        return [
          {
            userId: row.userId,
            username: displayNameOf(user),
            // The login name as well as the name on screen: the mail door addresses by the one
            // `POST /messages` can resolve, and the two differ for anybody with a display name.
            handle: user.username,
            rank: row.rank,
            level: base.level,
            infamy: base.economy.infamy,
            infamyEarned: row.infamyEarned,
            districtName: base.name,
            joinedAt: row.joinedAt,
            isBot: base.isBot,
            isYou: row.userId === userId,
            portraitId: overseer?.portraitId ?? null,
            overseerName: overseer?.name ?? null,
          },
        ];
      });

      return {
        isYours: rows.some((row) => row.userId === userId),
        faction,
        members,
        // Off the roster on every read, so it moves the moment somebody joins or leaves and there
        // is no stored copy to go stale.
        averageLevel: averageLevel(members.map((member) => member.level)),
        rank: factionRank(app, faction.id),
        serverNow: now.toISOString(),
      };
    },
  );
}

/**
 * Where this faction sits on the factions' board.
 *
 * Ranked here rather than read off `/leaderboard` so the file can be opened without loading the
 * standings, and sorted by the same two keys that route sorts by: what the badge has won, then the
 * best crew under it. Ties share a place there and here, because they are one number.
 */
function factionRank(app: FastifyInstance, factionId: string): number | null {
  const rows = app.repos.factions.all().map((faction) => ({
    id: faction.id,
    infamy: faction.infamyEarned,
  }));
  rows.sort((a, b) => b.infamy - a.infamy);
  const mine = rows.find((row) => row.id === factionId);
  if (!mine) return null;
  return rows.filter((row) => row.infamy > mine.infamy).length + 1;
}
