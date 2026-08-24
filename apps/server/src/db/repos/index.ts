import type { AppDatabase } from '../index.js';
import { createBarRepo, type BarRepo } from './bar.js';
import { createBasesRepo, type BasesRepo } from './bases.js';
import { createMarketRepo, type MarketRepo } from './market.js';
import { createBlackMarketRepo, type BlackMarketRepo } from './blackmarket.js';
import { createHistoryRepo, type HistoryRepo } from './history.js';
import { createCityRepo, type CityRepo } from './city.js';
import { createBattlesRepo, type BattlesRepo } from './battles.js';
import { createSiegeRepo, type SiegeRepo } from './sieges.js';
import { createMissionsRepo, type MissionsRepo } from './missions.js';
import { createOverseersRepo, type OverseersRepo } from './overseers.js';
import { createUsersRepo, type UsersRepo } from './users.js';

/** The full set of persistence repositories, backed by a single sqlite connection. */
export interface Repositories {
  users: UsersRepo;
  overseers: OverseersRepo;
  bases: BasesRepo;
  battles: BattlesRepo;
  /** Declared battles, the forces moved up for them, gates and traps (GDD §A4). */
  sieges: SiegeRepo;
  missions: MissionsRepo;
  /** The Bar's shared seat turnover and hire log (GDD §H2, §H2b). */
  bar: BarRepo;
  /** Who holds the city, and who has seen it (GDD §A4). */
  city: CityRepo;
  /** The trading board — listings between players. */
  market: MarketRepo;
  /** The back room: slot turnover, receipts, and boosts nobody has spent yet. */
  blackMarket: BlackMarketRepo;
  /** Append-only record of what has happened. Written to, never read by a rule. */
  history: HistoryRepo;
}

export function createRepositories(db: AppDatabase): Repositories {
  return {
    users: createUsersRepo(db),
    overseers: createOverseersRepo(db),
    bases: createBasesRepo(db),
    battles: createBattlesRepo(db),
    sieges: createSiegeRepo(db),
    missions: createMissionsRepo(db),
    bar: createBarRepo(db),
    city: createCityRepo(db),
    market: createMarketRepo(db),
    blackMarket: createBlackMarketRepo(db),
    history: createHistoryRepo(db),
  };
}
