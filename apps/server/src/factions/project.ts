import {
  MAX_FACTION_MEMBERS,
  deployedSize,
  isBattleDue,
  supplyUsed,
  type AllyArmy,
  type AllyBattle,
  type Base,
  type Faction,
  type FactionInvite,
  type FactionMember,
  type FactionResponse,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { residentOf, targetName } from '../battle/ground.js';
import { sideOf } from '../battle/deploy.js';

/**
 * What the faction screen is made of.
 *
 * All of it is derived: a faction owns a name, a tag and a list of user ids, and everything the
 * screen shows about a member (their district, their army, their fights) is read off the district
 * that member already has. Storing any of it on the membership row would be a second copy of a
 * number that changes every time somebody trains a unit.
 */

/** One member's row, assembled from their account and their district. */
function projectMember(
  repos: Repositories,
  userId: string,
  rank: FactionMember['rank'],
  joinedAt: string,
  infamyEarned: number,
): FactionMember | null {
  const user = repos.users.findById(userId);
  const base = repos.bases.findByOwnerId(userId);
  // A member with no district cannot happen in play (an Overseer is chosen before anything else),
  // but a half-registered account would otherwise crash the whole screen for everybody else.
  if (!user || !base) return null;

  const army = base.army;
  return {
    userId,
    baseId: base.id,
    username: user.username,
    districtName: base.name,
    districtId: base.districtId,
    rank,
    joinedAt,
    level: base.level,
    infamy: base.economy.infamy,
    infamyEarned,
    armySize: Object.values(army).reduce((total, count) => total + count, 0),
    supplyUsed: supplyUsed(army),
    isBot: base.isBot,
  };
}

export function membersOf(repos: Repositories, factionId: string): FactionMember[] {
  return repos.factions
    .members(factionId)
    .flatMap(
      (row) => projectMember(repos, row.userId, row.rank, row.joinedAt, row.infamyEarned) ?? [],
    );
}

function projectInvite(
  repos: Repositories,
  row: {
    id: string;
    factionId: string;
    invitedUserId: string;
    invitedByUserId: string;
    sentAt: string;
  },
): FactionInvite | null {
  const faction = repos.factions.find(row.factionId);
  const by = repos.users.findById(row.invitedByUserId);
  if (!faction || !by) return null;
  return {
    id: row.id,
    factionId: faction.id,
    factionName: faction.name,
    factionBadge: faction.badge,
    invitedBy: by.username,
    invitedUserId: row.invitedUserId,
    sentAt: row.sentAt,
  };
}

/**
 * Every fight an ally is in that this player could still help with.
 *
 * "Could still help" is three conditions and they are all the server's: the fight has not resolved,
 * its mark has not passed, and it is somebody else's. The last one matters more than it looks: your
 * own battles are on the Battles screen, and listing them here again would make the faction page a
 * duplicate of it rather than a window onto other people.
 */
function allyBattles(
  repos: Repositories,
  members: readonly FactionMember[],
  selfUserId: string,
  now: Date,
): AllyBattle[] {
  const out: AllyBattle[] = [];
  // Queried once rather than per member: it has no base filter, so every member was walking every
  // unresolved declaration in the city and issuing three queries and a full `bases` scan per pair.
  const pending = repos.sieges.pending().filter((battle) => battle.resolvedAt === null);
  // ...and the district's resident is looked up once per district rather than once per pair, which
  // is where the scan and the whole-base parse actually were.
  const residents = new Map<string, Base | undefined>();
  const residentIn = (districtId: string): Base | undefined => {
    if (!residents.has(districtId)) residents.set(districtId, residentOf(repos, districtId));
    return residents.get(districtId);
  };

  for (const member of members) {
    if (member.userId === selfUserId) continue;
    for (const battle of pending) {
      /*
       * Which side they are actually on, asked the way the deployment path asks it.
       *
       * The side used to be derived from "is this member the declarer", while *membership* was
       * derived from a row on either side. So an ally who reinforced somebody else's attack, which
       * is the entire point of the reinforcement feature, was listed as **defending**, and
       * `committed` was then summed over the enemy's rows: the other side's exact deployed
       * strength, perimeter included, served as an integer to everybody in the faction. The battle
       * screen blurs that number through `observedForceSize` with the holder's counter-intel
       * against the reader's own, and for an NPC defence it is otherwise unobservable at all.
       */
      const side = sideOf(repos, battle, member.baseId);
      if (side === null) continue;

      const sideRows = repos.sieges.side(battle.id, side);
      const committed = sideRows.reduce((total, row) => total + deployedSize(row), 0);
      const mine = sideRows.find((row) => {
        const base = row.baseId ? repos.bases.findById(row.baseId) : undefined;
        return base?.ownerId === selfUserId;
      });

      out.push({
        battleId: battle.id,
        memberUserId: member.userId,
        memberName: member.username,
        districtName: member.districtName,
        targetName: targetName(battle.target, residentIn(battle.target.districtId)),
        districtLabel: battle.target.districtId,
        scheduledFor: battle.scheduledFor,
        side,
        committed,
        yourContribution: mine ? deployedSize(mine) : 0,
        // The mark is the deadline for everybody, reinforcements included: a column that would
        // arrive after the fight is a column that never fought.
        canReinforce: !isBattleDue(battle, now),
      });
    }
  }
  return out.sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
}

/** What each ally can field, which is the question "who could help me" is really asking. */
function allyArmies(
  repos: Repositories,
  members: readonly FactionMember[],
  selfUserId: string,
): AllyArmy[] {
  return members
    .filter((member) => member.userId !== selfUserId)
    .flatMap((member) => {
      const base = repos.bases.findById(member.baseId);
      if (!base) return [];
      return [
        {
          memberUserId: member.userId,
          memberName: member.username,
          army: base.army,
          size: member.armySize,
        },
      ];
    });
}

/** The whole faction screen in one payload. */
export function projectFaction(repos: Repositories, userId: string, now: Date): FactionResponse {
  const membership = repos.factions.membershipOf(userId);
  const serverNow = now.toISOString();
  const invites = repos.factions
    .invitesFor(userId)
    .flatMap((row) => projectInvite(repos, row) ?? []);

  if (!membership) {
    return {
      faction: null,
      members: [],
      rank: null,
      invites,
      pending: [],
      battles: [],
      armies: [],
      serverNow,
    };
  }

  const faction: Faction | undefined = repos.factions.find(membership.factionId);
  if (!faction) {
    // The membership row outlived its faction, which nothing should be able to do. Reported as
    // "no faction" rather than thrown: a broken row must not take the screen down with it.
    return {
      faction: null,
      members: [],
      rank: null,
      invites,
      pending: [],
      battles: [],
      armies: [],
      serverNow,
    };
  }

  const members = membersOf(repos, faction.id);
  return {
    faction,
    members,
    rank: membership.rank,
    invites,
    pending: repos.factions
      .invitesFrom(faction.id)
      .flatMap((row) => projectInvite(repos, row) ?? []),
    battles: allyBattles(repos, members, userId, now),
    armies: allyArmies(repos, members, userId),
    serverNow,
  };
}

/** Whether one more person fits, read off the live count rather than off anything stored. */
export function hasRoom(repos: Repositories, factionId: string): boolean {
  return repos.factions.memberCount(factionId) < MAX_FACTION_MEMBERS;
}
