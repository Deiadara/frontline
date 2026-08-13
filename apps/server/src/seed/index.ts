import { randomUUID } from 'node:crypto';
import {
  BOT_DISTRICT_ID,
  findOverseerPreset,
  startingEconomy,
  startingProgression,
  startingResearch,
  type Base,
  type Overseer,
} from '@frontline/shared';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import type { AppDatabase } from '../db/index.js';
import type { Repositories } from '../db/repos/index.js';
import { MVP_BOT, MVP_PLAYER } from './constants.js';

const BCRYPT_COST = 10;

export interface SeedMvpWorldOptions {
  db: AppDatabase;
  repos: Repositories;
}

/** What this boot actually created — logged by `index.ts`. */
export interface MvpSeedSummary {
  playerUsername: string;
  createdPlayer: boolean;
  botUsername: string;
  botBaseName: string;
  botDistrictId: string;
  createdBot: boolean;
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
 * Idempotent by design — it only ever inserts rows that are missing, so restarting the
 * server never resets progress, rewrites a password or duplicates the rival. It also
 * repairs a half-seeded world rather than assuming an all-or-nothing previous run.
 */
export async function seedMvpWorld({ db, repos }: SeedMvpWorldOptions): Promise<MvpSeedSummary> {
  const createdPlayer = await seedDevPlayer(db, repos);
  const createdBot = await seedBot(db, repos);

  return {
    playerUsername: MVP_PLAYER.username,
    createdPlayer,
    botUsername: MVP_BOT.username,
    botBaseName: MVP_BOT.baseName,
    botDistrictId: BOT_DISTRICT_ID,
    createdBot,
  };
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
 * Puts the rival's base in `BOT_DISTRICT_ID` if it is not there, minting whatever part of
 * the rival is missing. Keyed on the base rather than the user, so deleting the base row
 * restores the rival on the next boot instead of leaving the district empty forever.
 */
async function seedBot(db: AppDatabase, repos: Repositories): Promise<boolean> {
  const preset = findOverseerPreset(MVP_BOT.overseerPresetId);
  if (!preset) {
    throw new Error(`MVP bot references an unknown overseer preset: ${MVP_BOT.overseerPresetId}`);
  }

  // Nobody can ever log in as the bot: the plaintext is a fresh UUID that is hashed and
  // then dropped on the floor, so no credential for this account exists anywhere. Hashed
  // outside the transaction for the same reason as the dev operator's.
  const passwordHash = await bcrypt.hash(randomUUID(), BCRYPT_COST);

  return seedStep(db, () => {
    if (repos.bases.findBotByDistrictId(BOT_DISTRICT_ID)) return false;

    const now = new Date().toISOString();
    const existing = repos.users.findByUsername(MVP_BOT.username);
    const userId = existing?.id ?? randomUUID();
    if (!existing) {
      repos.users.insert({ id: userId, username: MVP_BOT.username, passwordHash, createdAt: now });
    }
    if (!existing?.overseerId) {
      const overseer: Overseer = {
        id: randomUUID(),
        name: preset.name,
        archetype: preset.archetype,
        portraitId: preset.portraitId,
        bio: preset.bio,
        attributes: preset.attributes,
        traits: preset.traits,
      };
      repos.overseers.insert({ overseer, userId, presetId: preset.presetId, createdAt: now });
      repos.users.setOverseerId(userId, overseer.id);
    }

    const base: Base = {
      id: randomUUID(),
      ownerId: userId,
      name: MVP_BOT.baseName,
      districtId: BOT_DISTRICT_ID,
      level: MVP_BOT.level,
      isBot: true,
      resources: MVP_BOT.resources,
      economy: startingEconomy(now),
      progression: startingProgression(),
      research: startingResearch(),
      buildings: MVP_BOT.buildings,
      commanders: MVP_BOT.commanders,
      createdAt: now,
    };
    repos.bases.insert(base);
    return true;
  });
}
