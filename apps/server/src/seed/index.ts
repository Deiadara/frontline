import { randomUUID } from 'node:crypto';
import {
  BOT_DISTRICT_ID,
  findOverseerPreset,
  OVERSEER_PRESETS,
  type OverseerPreset,
  startingEconomy,
  startingProgression,
  startingResearch,
  type Base,
  startingTraining,
  overseerFromPreset,
  isReservedDistrictName,
  sameDistrictName,
} from '@frontline/shared';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import type { AppDatabase } from '../db/index.js';
import type { Repositories } from '../db/repos/index.js';
import {
  ALLY_DISTRICT_ID,
  ARCA_RIVAL_DISTRICT_ID,
  type BotBlueprint,
  MVP_ARCA_RIVAL,
  MVP_ALLY,
  MVP_BOT,
  MVP_FACTION,
  MVP_PLAYER,
  MVP_RIVAL_FACTION,
  MVP_RIVAL_SECOND,
  MVP_TERMINUS_RIVAL,
  RIVAL_SECOND_DISTRICT_ID,
  TERMINUS_RIVAL_DISTRICT_ID,
} from './constants.js';
import { CITY_DISTRICTS, slotAtOrAfter } from '@frontline/shared';

const BCRYPT_COST = 10;

export interface SeedMvpWorldOptions {
  db: AppDatabase;
  repos: Repositories;
  /**
   * A production boot seeds no dev operator (2026-09-28). Its password is committed to this
   * repository, so on a public server it is an account anybody can sign in to.
   */
  production?: boolean;
}

/** What this boot actually created: logged by `index.ts`. */
export interface MvpSeedSummary {
  playerUsername: string;
  createdPlayer: boolean;
  botUsername: string;
  botBaseName: string;
  botDistrictId: string;
  createdBot: boolean;
  /** The neighbour who fights beside you, and the faction they lead. */
  allyUsername: string;
  allyDistrictId: string;
  createdAlly: boolean;
  /** The rival's second, and the faction the two of them hold. */
  rivalSecondUsername: string;
  rivalSecondDistrictId: string;
  createdRivalFaction: boolean;
  /** The crew who lives in the second city, so it is somebody's rather than empty. */
  terminusRivalUsername: string;
  terminusRivalDistrictId: string;
  createdTerminusRival: boolean;
  /** And the one in the third (2026-10-07), for the same reason. */
  arcaRivalUsername: string;
  arcaRivalDistrictId: string;
  createdArcaRival: boolean;
}

/**
 * Runs one seed step as a single write-locked transaction, so a concurrently booting
 * process cannot slip between the step's existence check and its inserts.
 *
 * A UNIQUE-constraint failure is not fatal here: it means another process already wrote
 * the row this step wanted to write, so the world is seeded and this boot simply did not
 * create it. Every other error is a real failure and propagates.
 */
function seedStep(db: AppDatabase, step: () => boolean): boolean {
  try {
    return db.transaction(step).immediate();
  } catch (error) {
    if (error instanceof Database.SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return false;
    }
    throw error;
  }
}

/**
 * Seeds the MVP world: the hardcoded dev operator plus the single AI rival base.
 *
 * Idempotent by design: it only ever inserts rows that are missing, so restarting the
 * server never resets progress, rewrites a password or duplicates the rival. It also
 * repairs a half-seeded world rather than assuming an all-or-nothing previous run.
 */
export async function seedMvpWorld({
  db,
  repos,
  production = false,
}: SeedMvpWorldOptions): Promise<MvpSeedSummary> {
  const createdPlayer = production ? false : await seedDevPlayer(db, repos);
  /*
   * TODO(before launch): seed no bots in production, and remove the ones a dev-era database holds
   * (maintainer, 2026-09-28). They are development furniture. At launch every home plot starts
   * empty and closed: with nobody living there it has no gate
   * to call (`no_gate`) and nothing to raid (`nothing_to_break`), until a player claims it.
   */
  const createdBot = await seedBot(db, repos);
  // The neighbour on your side, and the table you share with them.
  const createdAlly = await seedAlly(db, repos);
  // The table on the other side. Runs after the rival, because it seats them.
  const createdRivalFaction = await seedRivalFaction(db, repos);
  // And somebody at the far end of the line, so the second city is a city (2026-09-24).
  const createdTerminusRival = await seedTerminusRival(db, repos);
  // And in the cathedral city, the day it opened (2026-10-07).
  const createdArcaRival = await seedArcaRival(db, repos);

  return {
    playerUsername: MVP_PLAYER.username,
    createdPlayer,
    botUsername: MVP_BOT.username,
    botBaseName: MVP_BOT.baseName,
    botDistrictId: BOT_DISTRICT_ID,
    createdBot,
    allyUsername: MVP_ALLY.username,
    allyDistrictId: ALLY_DISTRICT_ID,
    createdAlly,
    rivalSecondUsername: MVP_RIVAL_SECOND.username,
    rivalSecondDistrictId: RIVAL_SECOND_DISTRICT_ID,
    createdRivalFaction,
    terminusRivalUsername: MVP_TERMINUS_RIVAL.username,
    terminusRivalDistrictId: TERMINUS_RIVAL_DISTRICT_ID,
    createdTerminusRival,
    arcaRivalUsername: MVP_ARCA_RIVAL.username,
    arcaRivalDistrictId: ARCA_RIVAL_DISTRICT_ID,
    createdArcaRival,
  };
}

/**
 * Whether the dev operator still signs in with the password committed to this repository.
 *
 * A production boot refuses while it does (`index.ts`): the seed no longer creates the account in
 * production, but a database first booted in development would still carry it.
 */
export async function devOperatorStillOpen(repos: Repositories): Promise<boolean> {
  const user = repos.users.findByUsername(MVP_PLAYER.username);
  return user !== undefined && bcrypt.compare(MVP_PLAYER.password, user.passwordHash);
}

/**
 * Inserts the dev operator if absent. No overseer and no base: the player still picks an
 * overseer on first login, which is what settles their base in the starter district.
 */
async function seedDevPlayer(db: AppDatabase, repos: Repositories): Promise<boolean> {
  // ~100ms of bcrypt, hashed before the transaction opens and thrown away if the row is
  // already there: the sqlite write lock must never be held across an await.
  const passwordHash = await bcrypt.hash(MVP_PLAYER.password, BCRYPT_COST);

  return seedStep(db, () => {
    if (repos.users.findByUsername(MVP_PLAYER.username)) return false;

    repos.users.insert({
      id: randomUUID(),
      username: MVP_PLAYER.username,
      passwordHash,
      createdAt: new Date().toISOString(),
    });
    return true;
  });
}

/**
 * `wanted`, or the first numbered variation of it nobody in this city is using.
 *
 * Shares the rule with `routes/base.ts` through `sameDistrictName` and `isReservedDistrictName`
 * rather than re-deriving it: what counts as "the same name" is a decision, and two copies of it
 * would be two decisions.
 */
function freeName(repos: Repositories, wanted: string): string {
  const taken = repos.bases.listSummaries();
  const isFree = (candidate: string): boolean =>
    !isReservedDistrictName(candidate) &&
    !taken.some((summary) => sameDistrictName(summary.name, candidate));
  if (isFree(wanted)) return wanted;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${wanted} ${n}`;
    if (isFree(candidate)) return candidate;
  }
  return `${wanted} ${randomUUID().slice(0, 8)}`;
}

/**
 * The character a seeded crew takes, given that the pool can be picked clean by players (§F6).
 *
 * The four NPCs name a preset apiece in `seed/constants.ts`, and before the pool that was the
 * whole story: nothing else claimed one, so the constant always worked. Migration 0095 made
 * `preset_id` unique, and the failure mode that opened is genuinely nasty rather than merely
 * inconvenient. `repos.overseers.insert` throws `SQLITE_CONSTRAINT_UNIQUE`, {@link seedStep}
 * reads any unique failure as "another boot already wrote this row", reports the world seeded,
 * and returns without creating the rival. The district is empty, the faction has one member, and
 * **nothing is logged**: the one shape of bug that cannot be found from the outside.
 *
 * So the constant is a preference rather than a requirement. A seeded crew takes the character it
 * is named for when that character is free, and otherwise the first one nobody holds. Deterministic
 * either way, because the pool is ordered, so two boots of the same world seed the same rival.
 *
 * Null means every one of the thirty is spoken for, which needs thirty accounts and is the one
 * case where there is genuinely no character left to give. The caller logs and skips rather than
 * throwing: a world that cannot seed a new rival is still a world every existing player can play.
 */
function freePreset(repos: Repositories, preferredId: string): OverseerPreset | null {
  const claimed = repos.overseers.claimedPresetIds();
  const preferred = findOverseerPreset(preferredId);
  if (preferred === undefined) {
    throw new Error(`A seeded crew references an unknown overseer preset: ${preferredId}`);
  }
  if (!claimed.has(preferred.presetId)) return preferred;
  return OVERSEER_PRESETS.find((one) => !claimed.has(one.presetId)) ?? null;
}

/**
 * Puts one non-playing crew's base in `districtId` if it is not there, minting whatever part of
 * that crew is missing. Keyed on the account, so deleting the base row restores them on the next
 * boot instead of leaving the district empty forever.
 *
 * One function for the rival and for the Terminus rival, because the two differ in a blueprint and
 * an address and in nothing else. Copying it for the second city would have copied the account
 * keying below with it, which is the part that has already gone wrong once in a real database.
 */
async function seedCrewIn(
  db: AppDatabase,
  repos: Repositories,
  crew: BotBlueprint,
  districtId: string,
): Promise<boolean> {
  const preset = freePreset(repos, crew.overseerPresetId);
  if (preset === null) return false;

  // Nobody can ever log in as the bot: the plaintext is a fresh UUID that is hashed and
  // then dropped on the floor, so no credential for this account exists anywhere. Hashed
  // outside the transaction for the same reason as the dev operator's.
  const passwordHash = await bcrypt.hash(randomUUID(), BCRYPT_COST);

  return seedStep(db, () => {
    const now = new Date().toISOString();
    const existing = repos.users.findByUsername(crew.username);
    /*
     * Keyed on the *account*, not on the district.
     *
     * The guard was `findBotByDistrictId(BOT_DISTRICT_ID)`, which asks "is the rival standing
     * here", and the answer is no the moment `BOT_DISTRICT_ID` changes or the rival is moved. Every
     * boot after such a change minted a second base for the same user: a real database had three,
     * in three districts, dated to the three occasions the constant moved. Each ghost sat on the
     * leaderboard, counted in the city-level average that prices the Bar and the black market, held
     * a name against the uniqueness scan and occupied ground, while `findByOwnerId` returned only
     * one of them so nothing could ever settle the others.
     *
     * One base per account is the rule the database now enforces with a unique index, and this is
     * the same rule said once, before the insert. Deleting the base row still restores the rival on
     * the next boot, which is what the district-keyed version was reaching for.
     */
    if (existing && repos.bases.findByOwnerId(existing.id)) return false;
    if (plotTaken(repos, districtId)) return false;

    const userId = existing?.id ?? randomUUID();
    if (!existing) {
      repos.users.insert({ id: userId, username: crew.username, passwordHash, createdAt: now });
    }
    if (!existing?.overseerId) {
      const overseer = overseerFromPreset(preset, randomUUID());
      repos.overseers.insert({ overseer, userId, presetId: preset.presetId, createdAt: now });
      repos.users.setOverseerId(userId, overseer.id);
    }

    const base: Base = {
      id: randomUUID(),
      ownerId: userId,
      /*
       * Through the same collision check every other crew goes through.
       *
       * This is the third door that creates a crew, after registration and the rename route, and a
       * rule enforced at two of three doors is not a rule. In practice the seeder runs on a fresh
       * database before any player exists and takes its authored name unchanged; what this stops is
       * the one ordering where it does not.
       */
      name: freeName(repos, crew.baseName),
      districtId,
      level: crew.level,
      isBot: true,
      resources: crew.resources,
      economy: startingEconomy(now),
      progression: startingProgression(),
      research: startingResearch(),
      buildings: crew.buildings,
      buildQueue: [],
      army: crew.army,
      musterQueue: [],
      training: startingTraining(now),
      inventory: {},
      fittedUpgrades: [],
      unitLoadouts: {},
      fleet: {},
      commanders: crew.commanders,
      createdAt: now,
    };
    repos.bases.insert(base);
    return true;
  });
}

/**
 * Whether anybody lives on a home plot already. A plot is one crew's (maintainer, 2026-09-28:
 * "there should be no bots seated on players' locations"), so a bot is never seeded onto one a
 * player has moved onto, whichever step is doing the seeding.
 */
function plotTaken(repos: Repositories, districtId: string): boolean {
  return repos.bases.listSummaries().some((home) => home.districtId === districtId);
}

/** The rival a player fights, in Ashfall, at `BOT_DISTRICT_ID`. */
async function seedBot(db: AppDatabase, repos: Repositories): Promise<boolean> {
  return seedCrewIn(db, repos, MVP_BOT, BOT_DISTRICT_ID);
}

/**
 * The crew who lives in Terminus (2026-09-24).
 *
 * The second city is playable and nobody was in it, which is two problems rather than one. There
 * is nobody to raid, and `calibreOf` (`city/stakes.ts`) has nobody to weigh: with no stake in a
 * city it falls back to the average level of every base in the world, so the Bar, the market and
 * the black market there were stocked against a number from another city entirely. A resident is a
 * stake, so both answers come right at once.
 *
 * They sit on `signalrow`, the plot `docs/DISTRICTS.md` names as the rival's, under the
 * Blockhouse and at the opposite end of the line from the starter plot. Seeded through the same
 * function as the Ashfall rival, so they are idempotent in the same way and one fix reaches both.
 *
 * No faction: the two tables in the world are Ashfall's and a third seeded one would put a table
 * on the screen before anybody has a reason to care whose it is.
 */
async function seedTerminusRival(db: AppDatabase, repos: Repositories): Promise<boolean> {
  return seedCrewIn(db, repos, MVP_TERMINUS_RIVAL, TERMINUS_RIVAL_DISTRICT_ID);
}

async function seedArcaRival(db: AppDatabase, repos: Repositories): Promise<boolean> {
  return seedCrewIn(db, repos, MVP_ARCA_RIVAL, ARCA_RIVAL_DISTRICT_ID);
}

/**
 * The ally, their district, and the faction they lead.
 *
 * One crew a player fights *beside*, so the faction screen is populated from the first minute
 * rather than being an empty frame with a "found one" button. They are seeded exactly like the
 * rival, through the same base insert and the same name-collision check, because everything the
 * faction screen reads about them (army, level, standing, fights) is read off a real district by
 * the same code that reads a live member's. A fixture that was special-cased anywhere would be a
 * fixture that stopped proving the screen works.
 *
 * The ally is the **only** seeded member. Everybody, the dev operator included, joins by accepting
 * an invitation sent when they pick an Overseer (`routes/overseer.ts`), so there is exactly one way
 * into a faction and it is the one players use.
 *
 * Seating the dev account directly was tried and was wrong: that account exists from the first boot
 * but has no district until somebody logs in and picks an Overseer, and a member with no district
 * is invisible on the roster while still counting against the five-person cap and still receiving
 * every faction message. A phantom member is worse than an empty seat.
 */
async function seedAlly(db: AppDatabase, repos: Repositories): Promise<boolean> {
  const preset = freePreset(repos, MVP_ALLY.overseerPresetId);
  if (preset === null) return false;
  // No credential for this account exists anywhere: same treatment as the rival.
  const passwordHash = await bcrypt.hash(randomUUID(), BCRYPT_COST);

  return seedStep(db, () => {
    if (plotTaken(repos, ALLY_DISTRICT_ID)) return false;

    const now = new Date().toISOString();
    const existing = repos.users.findByUsername(MVP_ALLY.username);
    const userId = existing?.id ?? randomUUID();
    if (!existing) {
      repos.users.insert({ id: userId, username: MVP_ALLY.username, passwordHash, createdAt: now });
    }
    if (!existing?.overseerId) {
      const overseer = overseerFromPreset(preset, randomUUID());
      repos.overseers.insert({ overseer, userId, presetId: preset.presetId, createdAt: now });
      repos.users.setOverseerId(userId, overseer.id);
    }

    repos.bases.insert({
      id: randomUUID(),
      ownerId: userId,
      name: freeName(repos, MVP_ALLY.baseName),
      districtId: ALLY_DISTRICT_ID,
      level: MVP_ALLY.level,
      isBot: true,
      resources: MVP_ALLY.resources,
      economy: startingEconomy(now),
      progression: startingProgression(),
      research: startingResearch(),
      buildings: MVP_ALLY.buildings,
      buildQueue: [],
      army: MVP_ALLY.army,
      musterQueue: [],
      training: startingTraining(now),
      inventory: {},
      fittedUpgrades: [],
      unitLoadouts: {},
      fleet: {},
      commanders: MVP_ALLY.commanders,
      createdAt: now,
    });

    // The faction, founded by them. Guarded on the name so a half-seeded world repairs rather
    // than throwing on the UNIQUE index.
    if (!repos.factions.findByName(MVP_FACTION.name)) {
      const factionId = randomUUID();
      repos.factions.insert({
        id: factionId,
        name: MVP_FACTION.name,
        badge: MVP_FACTION.badge,
        blurb: MVP_FACTION.blurb,
        foundedAt: now,
      });
      repos.factions.addMember({ userId, factionId, rank: 'leader', joinedAt: now });
    }

    /*
     * A fight of theirs, twelve hours out.
     *
     * So the faction screen has something on it from the first minute: an ally's battle a player
     * can read and reinforce, which is the whole point of the screen and cannot be demonstrated by
     * a roster alone. Declared through the ordinary row rather than a special one, so it settles,
     * pays out and disappears exactly like any other fight, and the screen is looking at the same
     * table it always looks at.
     *
     * Twelve hours because the declaration window is eight to twenty-four (`battle/schedule.ts`),
     * and the slot is snapped because fights are called on the half hour.
     */
    const ally = repos.bases.findBotByDistrictId(ALLY_DISTRICT_ID);
    const contested = CITY_DISTRICTS.find((district) => district.kind === 'contested');
    const location = contested?.locations[0];
    if (ally && contested && location) {
      const mark = slotAtOrAfter(new Date(Date.parse(now) + 12 * 3_600_000));
      repos.sieges.insert({
        id: randomUUID(),
        target: { kind: 'location', districtId: contested.id, locationId: location.id },
        attackerBaseId: ally.id,
        defender: { kind: 'government' },
        scheduledFor: mark.toISOString(),
        declaredAt: now,
        resolvedAt: null,
        seed: randomUUID(),
        holdAfterCapture: false,
        wokeSleepers: false,
      });
    }
    return true;
  });
}

/**
 * The NPC faction: the rival's second, and the table the two of them hold (maintainer request).
 *
 * Seated after `seedBot`, because the rival is its leader and a faction cannot be led by an
 * account that does not exist yet. If the rival is somehow missing this step does nothing and
 * returns false rather than founding a table with one person at it: the next boot runs `seedBot`
 * again and then this, which is the repair path every other step here uses.
 *
 * Why there is a second NPC crew at all: a faction of one is not a faction to read. The public
 * profile this exists to fill shows a roster with ranks on it, and a single row proves nothing
 * about a screen that has to draw a leader and everybody under them.
 */
async function seedRivalFaction(db: AppDatabase, repos: Repositories): Promise<boolean> {
  const preset = freePreset(repos, MVP_RIVAL_SECOND.overseerPresetId);
  if (preset === null) return false;
  // No credential for this account exists anywhere: same treatment as the rival and the ally.
  const passwordHash = await bcrypt.hash(randomUUID(), BCRYPT_COST);

  return seedStep(db, () => {
    const leader = repos.users.findByUsername(MVP_BOT.username);
    if (!leader) return false;

    const now = new Date().toISOString();
    let wrote = false;

    // The second crew, if it is not standing yet and its plot is free. A player on the plot keeps
    // it, and the table is not founded around a member with nowhere to live.
    const standing = repos.users.findByUsername(MVP_RIVAL_SECOND.username);
    const housed = standing !== undefined && repos.bases.findByOwnerId(standing.id) !== undefined;
    if (!housed && plotTaken(repos, RIVAL_SECOND_DISTRICT_ID)) return false;
    // Keyed on the account like the rival's, so deleting the base row restores the crew rather
    // than leaving a seated member with no district.
    const existing = repos.users.findByUsername(MVP_RIVAL_SECOND.username);
    const secondId = existing?.id ?? randomUUID();
    if (!existing || !repos.bases.findByOwnerId(secondId)) {
      if (!existing) {
        repos.users.insert({
          id: secondId,
          username: MVP_RIVAL_SECOND.username,
          passwordHash,
          createdAt: now,
        });
      }
      if (!repos.users.findById(secondId)?.overseerId) {
        const overseer = overseerFromPreset(preset, randomUUID());
        repos.overseers.insert({
          overseer,
          userId: secondId,
          presetId: preset.presetId,
          createdAt: now,
        });
        repos.users.setOverseerId(secondId, overseer.id);
      }
      repos.bases.insert({
        id: randomUUID(),
        ownerId: secondId,
        name: freeName(repos, MVP_RIVAL_SECOND.baseName),
        districtId: RIVAL_SECOND_DISTRICT_ID,
        level: MVP_RIVAL_SECOND.level,
        isBot: true,
        resources: MVP_RIVAL_SECOND.resources,
        economy: startingEconomy(now),
        progression: startingProgression(),
        research: startingResearch(),
        buildings: MVP_RIVAL_SECOND.buildings,
        buildQueue: [],
        army: MVP_RIVAL_SECOND.army,
        musterQueue: [],
        training: startingTraining(now),
        inventory: {},
        fittedUpgrades: [],
        unitLoadouts: {},
        fleet: {},
        commanders: MVP_RIVAL_SECOND.commanders,
        createdAt: now,
      });
      wrote = true;
    }

    // The table. Guarded on the name, the way the ally's is, so a half-seeded world repairs
    // rather than throwing on the UNIQUE index.
    let factionId = repos.factions.findByName(MVP_RIVAL_FACTION.name)?.id;
    if (!factionId) {
      factionId = randomUUID();
      repos.factions.insert({
        id: factionId,
        name: MVP_RIVAL_FACTION.name,
        badge: MVP_RIVAL_FACTION.badge,
        blurb: MVP_RIVAL_FACTION.blurb,
        foundedAt: now,
      });
      wrote = true;
    }

    // Seated one at a time and only if they are not already somewhere: a crew that a live player
    // somehow recruited stays where it is rather than being pulled back every boot.
    for (const [userId, rank] of [
      [leader.id, 'leader'],
      [secondId, 'chief'],
    ] as const) {
      if (repos.factions.membershipOf(userId)) continue;
      repos.factions.addMember({ userId, factionId, rank, joinedAt: now });
      wrote = true;
    }

    return wrote;
  });
}

/** The faction the ally leads, for the routes that want to offer it to a new player. */
export function seededFactionId(repos: Repositories): string | undefined {
  return repos.factions.findByName(MVP_FACTION.name)?.id;
}
