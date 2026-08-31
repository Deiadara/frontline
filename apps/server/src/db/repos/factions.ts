import {
  BadgeSchema,
  FACTION_RANKS,
  MAX_FACTION_MEMBERS,
  type Faction,
  type FactionRank,
} from '@frontline/shared';
import type { AppDatabase } from '../index.js';
import { readJson } from '../json.js';

/**
 * Factions and who is in them.
 *
 * The five-person cap is checked in the route through {@link FactionsRepo.memberCount}, not here: a
 * repo answers questions about rows and a cap is a rule about the game. What this file does own is
 * that a player is in **at most one** faction, and that is enforced by the schema (`user_id` is the
 * primary key of `faction_members`) rather than by anything remembering to check.
 */

export interface FactionMemberRow {
  userId: string;
  factionId: string;
  rank: FactionRank;
  joinedAt: string;
  /**
   * Infamy this member has earned **since joining**, which is the faction's rather than theirs.
   *
   * Never decreases: spending infamy on notoriety is a thing the player does with what they hold,
   * and this is a record of what they brought in. See migration `0050`.
   */
  infamyEarned: number;
}

export interface FactionInviteRow {
  id: string;
  factionId: string;
  invitedUserId: string;
  invitedByUserId: string;
  sentAt: string;
}

export interface FactionsRepo {
  /**
   * Founds one. Deliberately cannot carry `infamyEarned`: a new faction has won nothing, and a
   * signature that accepted a figure would be a way to mint a record nobody fought for.
   */
  insert(faction: Omit<Faction, 'infamyEarned'>): void;
  find(id: string): Faction | undefined;
  findByName(name: string): Faction | undefined;
  all(): Faction[];
  /** Name and badge: the leader's to change. */
  setIdentity(id: string, name: string, badge: Faction['badge']): void;
  /** The recruiting pitch, which a chief keeps current too. */
  setDescription(id: string, blurb: string): void;
  disband(id: string): void;

  /** The faction this player sits in, or nothing. */
  membershipOf(userId: string): FactionMemberRow | undefined;
  members(factionId: string): FactionMemberRow[];
  memberCount(factionId: string): number;
  /**
   * Seats somebody. Deliberately cannot carry `infamyEarned`: a new member starts at zero, and a
   * signature that accepted a figure would be a way to hand a faction a record it did not earn.
   */
  addMember(row: Omit<FactionMemberRow, 'infamyEarned'>): void;
  setRank(userId: string, rank: FactionRank): void;
  removeMember(userId: string): void;
  /**
   * Credits a fight's infamy to the faction the winner was in, and to their own row in it.
   *
   * Two writes, one call, because they are one fact recorded at two grains: the faction's total is
   * append-only and outlives anybody leaving (`0051`), and the member's figure is their share of it
   * while they are at the table. Ignores somebody in no faction.
   */
  addInfamyEarned(userId: string, amount: number): void;

  invite(row: FactionInviteRow): void;
  invitesFor(userId: string): FactionInviteRow[];
  invitesFrom(factionId: string): FactionInviteRow[];
  findInvite(id: string): FactionInviteRow | undefined;
  deleteInvite(id: string): void;
  /** Everything still open for this player, cleared the moment they join anywhere. */
  clearInvitesFor(userId: string): void;
}

interface Row {
  id: string;
  name: string;
  infamy_earned: number;
  /** The badge, as the JSON `BadgeSchema` describes. Re-parsed rather than cast: see `toFaction`. */
  badge: string;
  blurb: string;
  founded_at: string;
}

interface MemberRow {
  user_id: string;
  faction_id: string;
  rank: string;
  joined_at: string;
  infamy_earned: number;
}

interface InviteRow {
  id: string;
  faction_id: string;
  invited_user_id: string;
  invited_by_user_id: string;
  sent_at: string;
}

/**
 * A stored badge is re-parsed through the shared schema on the way out.
 *
 * It is a JSON blob in a column, so it is the one field in this table that a bad write, a
 * hand-edited database or a future migration could leave in a shape the game cannot draw. Parsing
 * here means the failure surfaces as a parse error naming the column, rather than as a badge that
 * renders as nothing three layers away in the client.
 */
const toFaction = (row: Row): Faction => ({
  id: row.id,
  name: row.name,
  badge: BadgeSchema.parse(readJson(row.badge)),
  blurb: row.blurb,
  infamyEarned: row.infamy_earned,
  foundedAt: row.founded_at,
});

/** A stored rank the catalogue no longer knows reads as an ordinary member rather than throwing. */
const toRank = (value: string): FactionRank =>
  (FACTION_RANKS as readonly string[]).includes(value) ? (value as FactionRank) : 'member';

const toMember = (row: MemberRow): FactionMemberRow => ({
  userId: row.user_id,
  factionId: row.faction_id,
  rank: toRank(row.rank),
  joinedAt: row.joined_at,
  infamyEarned: row.infamy_earned,
});

const toInvite = (row: InviteRow): FactionInviteRow => ({
  id: row.id,
  factionId: row.faction_id,
  invitedUserId: row.invited_user_id,
  invitedByUserId: row.invited_by_user_id,
  sentAt: row.sent_at,
});

export function createFactionsRepo(db: AppDatabase): FactionsRepo {
  const insertStmt = db.prepare(
    'INSERT INTO factions (id, name, badge, blurb, founded_at) VALUES (?, ?, ?, ?, ?)',
  );
  const findStmt = db.prepare('SELECT * FROM factions WHERE id = ?');
  const byNameStmt = db.prepare('SELECT * FROM factions WHERE name = ? COLLATE NOCASE');
  const allStmt = db.prepare('SELECT * FROM factions ORDER BY founded_at');
  const identityStmt = db.prepare('UPDATE factions SET name = ?, badge = ? WHERE id = ?');
  const describeStmt = db.prepare('UPDATE factions SET blurb = ? WHERE id = ?');
  const disbandStmt = db.prepare('DELETE FROM factions WHERE id = ?');
  const dropMembersStmt = db.prepare('DELETE FROM faction_members WHERE faction_id = ?');
  const dropInvitesStmt = db.prepare('DELETE FROM faction_invites WHERE faction_id = ?');

  const membershipStmt = db.prepare('SELECT * FROM faction_members WHERE user_id = ?');
  const membersStmt = db.prepare(
    'SELECT * FROM faction_members WHERE faction_id = ? ORDER BY joined_at',
  );
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM faction_members WHERE faction_id = ?');
  const addMemberStmt = db.prepare(
    'INSERT INTO faction_members (user_id, faction_id, rank, joined_at) VALUES (?, ?, ?, ?)',
  );
  const setRankStmt = db.prepare('UPDATE faction_members SET rank = ? WHERE user_id = ?');
  const removeMemberStmt = db.prepare('DELETE FROM faction_members WHERE user_id = ?');
  const creditMemberStmt = db.prepare(
    'UPDATE faction_members SET infamy_earned = infamy_earned + ? WHERE user_id = ?',
  );
  const creditFactionStmt = db.prepare(
    `UPDATE factions SET infamy_earned = infamy_earned + ?
      WHERE id = (SELECT faction_id FROM faction_members WHERE user_id = ?)`,
  );

  const inviteStmt = db.prepare(
    `INSERT INTO faction_invites (id, faction_id, invited_user_id, invited_by_user_id, sent_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (faction_id, invited_user_id) DO NOTHING`,
  );
  const invitesForStmt = db.prepare(
    'SELECT * FROM faction_invites WHERE invited_user_id = ? ORDER BY sent_at',
  );
  const invitesFromStmt = db.prepare(
    'SELECT * FROM faction_invites WHERE faction_id = ? ORDER BY sent_at',
  );
  const findInviteStmt = db.prepare('SELECT * FROM faction_invites WHERE id = ?');
  const deleteInviteStmt = db.prepare('DELETE FROM faction_invites WHERE id = ?');
  const clearInvitesStmt = db.prepare('DELETE FROM faction_invites WHERE invited_user_id = ?');

  return {
    insert(faction) {
      insertStmt.run(
        faction.id,
        faction.name,
        JSON.stringify(faction.badge),
        faction.blurb,
        faction.foundedAt,
      );
    },
    find(id) {
      const row = findStmt.get(id) as Row | undefined;
      return row ? toFaction(row) : undefined;
    },
    findByName(name) {
      const row = byNameStmt.get(name.trim()) as Row | undefined;
      return row ? toFaction(row) : undefined;
    },
    all() {
      return (allStmt.all() as Row[]).map(toFaction);
    },
    setIdentity(id, name, badge) {
      identityStmt.run(name, JSON.stringify(badge), id);
    },
    setDescription(id, blurb) {
      describeStmt.run(blurb, id);
    },
    disband(id) {
      // Members and invitations go with it. `ON DELETE CASCADE` is on the tables, but SQLite only
      // honours it with `foreign_keys` on, and this does not depend on a pragma being set.
      dropInvitesStmt.run(id);
      dropMembersStmt.run(id);
      disbandStmt.run(id);
    },

    membershipOf(userId) {
      const row = membershipStmt.get(userId) as MemberRow | undefined;
      return row ? toMember(row) : undefined;
    },
    members(factionId) {
      return (membersStmt.all(factionId) as MemberRow[]).map(toMember);
    },
    memberCount(factionId) {
      return (countStmt.get(factionId) as { n: number }).n;
    },
    addMember(row) {
      addMemberStmt.run(row.userId, row.factionId, row.rank, row.joinedAt);
    },
    setRank(userId, rank) {
      setRankStmt.run(rank, userId);
    },
    addInfamyEarned(userId, amount) {
      // A player in no faction has no row and the subquery finds no faction, so both statements are
      // no-ops rather than a branch at every caller.
      if (amount <= 0) return;
      creditFactionStmt.run(amount, userId);
      creditMemberStmt.run(amount, userId);
    },
    removeMember(userId) {
      removeMemberStmt.run(userId);
    },

    invite(row) {
      inviteStmt.run(row.id, row.factionId, row.invitedUserId, row.invitedByUserId, row.sentAt);
    },
    invitesFor(userId) {
      return (invitesForStmt.all(userId) as InviteRow[]).map(toInvite);
    },
    invitesFrom(factionId) {
      return (invitesFromStmt.all(factionId) as InviteRow[]).map(toInvite);
    },
    findInvite(id) {
      const row = findInviteStmt.get(id) as InviteRow | undefined;
      return row ? toInvite(row) : undefined;
    },
    deleteInvite(id) {
      deleteInviteStmt.run(id);
    },
    clearInvitesFor(userId) {
      clearInvitesStmt.run(userId);
    },
  };
}

/** Re-exported so a caller checking the cap does not have to reach past the repo for it. */
export { MAX_FACTION_MEMBERS };
