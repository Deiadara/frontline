import {
  BUILDING_CATALOG,
  EVERY_LOCATION,
  LOCATION_CATALOG,
  displayNameOf,
  findDistrict,
  type Base,
  type CrewProfileResponse,
  type ProfileHolding,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { sideOf } from '../battle/deploy.js';
import { REPORT_HISTORY } from '../battle/view.js';
import { districtsHeldWhole } from '../city/gates.js';
import type { Repositories } from '../db/repos/index.js';
import { AppError } from '../errors.js';
import { settleWorld } from '../world/settle.js';
import { rankedPlayers, standings } from './leaderboard.js';

/**
 * A crew's file, readable by anybody in the city (maintainer request, 2026-09-11).
 *
 * The one page that is the same for you and for the crew across the road: a location's window and
 * the standings both link here, and a player clicking their own name lands on exactly the page
 * their rivals see, which is the only honest way to show somebody what they are publishing.
 *
 * `:id` is a crew's id **or its owner's**. The map and the location rows know crews by base id;
 * the standings and the faction roster know players by user id, and a page that only answered one
 * of those would leave half the links in the game with nowhere to go.
 *
 * What it says is what the city already says elsewhere: see `CrewProfileResponseSchema` for the
 * line between public and owner-only, and why the attribute sheet is on the far side of it.
 */
export function registerCrewProfileRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/crews/:id',
    { preHandler: app.authenticate },
    (request): CrewProfileResponse => {
      const now = new Date();
      const viewer = app.repos.bases.findByOwnerId(request.currentUser.id);
      if (!viewer) throw new AppError('NO_BASE', 'You do not have a base yet');
      // A fight whose mark has passed may have moved half of what this file lists.
      settleWorld(app.repos, app.skirmishEngine, now, undefined, app.config.admin);

      const crew =
        app.repos.bases.findById(request.params.id) ??
        app.repos.bases.findByOwnerId(request.params.id);
      if (!crew) throw new AppError('NOT_FOUND', 'No such crew');
      const user = app.repos.users.findById(crew.ownerId);
      if (!user) throw new AppError('NOT_FOUND', 'No such crew');

      return projectCrewProfile(app.repos, { crew, user, viewer, now });
    },
  );
}

interface ProfileInput {
  crew: Base;
  user: NonNullable<ReturnType<Repositories['users']['findById']>>;
  /** The crew doing the reading, which decides whether the file is its own. */
  viewer: Base;
  now: Date;
}

export function projectCrewProfile(
  repos: Repositories,
  { crew, user, viewer, now }: ProfileInput,
): CrewProfileResponse {
  const overseer = user.overseerId ? repos.overseers.findById(user.overseerId) : undefined;
  const home = findDistrict(crew.districtId);

  const controls = repos.city.controls();
  /*
   * Every location in the world (2026-09-24): a crew's file lists what it holds, and ground held in
   * a second city is ground it holds. All of it, whoever is reading: the whole city is visible
   * (maintainer, 2026-09-29), so what the map says about who holds what, the file says too.
   */
  const holdings: ProfileHolding[] = EVERY_LOCATION.filter((location) => {
    const holder = controls.get(location.id)?.holder;
    return holder?.kind === 'crew' && holder.baseId === crew.id;
  }).map((location) => ({
    locationId: location.id,
    name: location.name,
    kind: LOCATION_CATALOG[location.kind].label,
    districtId: location.districtId,
    districtName: findDistrict(location.districtId)?.name ?? location.districtId,
    level: controls.get(location.id)?.level ?? 1,
  }));

  const fights = repos.sieges.resolvedFor(crew.id, REPORT_HISTORY).reduce(
    (tally, { battle, analysis }) => {
      const side = sideOf(repos, battle, crew.id);
      if (side === null) return tally;
      return analysis.winner === side
        ? { ...tally, won: tally.won + 1 }
        : { ...tally, lost: tally.lost + 1 };
    },
    { won: 0, lost: 0 },
  );

  const membership = repos.factions.membershipOf(crew.ownerId);
  const faction = membership ? repos.factions.find(membership.factionId) : undefined;

  return {
    isYou: crew.ownerId === viewer.ownerId,
    crew: {
      id: crew.id,
      ownerId: crew.ownerId,
      name: crew.name,
      districtId: crew.districtId,
      level: crew.level,
      isBot: crew.isBot,
    },
    player: {
      userId: user.id,
      name: displayNameOf(user),
      handle: user.username,
      since: user.createdAt,
    },
    overseer: overseer
      ? {
          name: overseer.name,
          archetype: overseer.archetype,
          portraitId: overseer.portraitId,
          bio: overseer.bio,
          perks: overseer.perks,
        }
      : null,
    standing: {
      level: crew.level,
      infamy: crew.economy.infamy,
      notoriety: crew.economy.notoriety,
      rank:
        rankedPlayers(standings(repos)).find((row) => row.userId === crew.ownerId)?.rank ?? null,
      fights,
    },
    faction:
      faction && membership
        ? {
            id: faction.id,
            name: faction.name,
            badge: faction.badge,
            rank: membership.rank,
            infamyEarned: faction.infamyEarned,
          }
        : null,
    home: {
      districtId: crew.districtId,
      districtName: home?.name ?? crew.districtId,
      buildings: crew.buildings
        .filter((building) => BUILDING_CATALOG[building.kind] !== undefined)
        .map((building) => ({ kind: building.kind, level: building.level })),
    },
    holdings,
    districtsHeldWhole: districtsHeldWhole(repos, crew.id).map((districtId) => ({
      districtId,
      name: findDistrict(districtId)?.name ?? districtId,
    })),
    serverNow: now.toISOString(),
  };
}
