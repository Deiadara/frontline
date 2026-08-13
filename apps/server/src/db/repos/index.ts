import type { AppDatabase } from '../index.js';
import { createBasesRepo, type BasesRepo } from './bases.js';
import { createBattlesRepo, type BattlesRepo } from './battles.js';
import { createMissionsRepo, type MissionsRepo } from './missions.js';
import { createOverseersRepo, type OverseersRepo } from './overseers.js';
import { createUsersRepo, type UsersRepo } from './users.js';

/** The full set of persistence repositories, backed by a single sqlite connection. */
export interface Repositories {
  users: UsersRepo;
  overseers: OverseersRepo;
  bases: BasesRepo;
  battles: BattlesRepo;
  missions: MissionsRepo;
}

export function createRepositories(db: AppDatabase): Repositories {
  return {
    users: createUsersRepo(db),
    overseers: createOverseersRepo(db),
    bases: createBasesRepo(db),
    battles: createBattlesRepo(db),
    missions: createMissionsRepo(db),
  };
}
