import type { AppDatabase } from '../index.js';
import { createBarRepo, type BarRepo } from './bar.js';
import { createBasesRepo, type BasesRepo } from './bases.js';
import { createMarketRepo, type MarketRepo } from './market.js';
import { createBlackMarketRepo, type BlackMarketRepo } from './blackmarket.js';
import { createCapturedGatesRepo, type CapturedGatesRepo } from './gates.js';
import { createHistoryRepo, type HistoryRepo } from './history.js';
import { createCityRepo, type CityRepo } from './city.js';
import { createMovementRepo, type MovementRepo } from './movements.js';
import { createBattlesRepo, type BattlesRepo } from './battles.js';
import { createSiegeRepo, type SiegeRepo } from './sieges.js';
import { createMissionsRepo, type MissionsRepo } from './missions.js';
import { createOverseersRepo, type OverseersRepo } from './overseers.js';
import { createUsersRepo, type UsersRepo } from './users.js';
import { createFactionsRepo, type FactionsRepo } from './factions.js';
import { createSocialRepo, type SocialRepo } from './social.js';
import { createScoutingRepo, type ScoutingRepo } from './scouting.js';

/** The full set of persistence repositories, backed by a single sqlite connection. */
export interface Repositories {
  users: UsersRepo;
  /** Teams of up to five players, and the invitations that are the only way in. */
  factions: FactionsRepo;
  /** The mailbox and the bell: both per-player lists with a read flag. */
  social: SocialRepo;
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
  movements: MovementRepo;
  /** The trading board: listings between players. */
  market: MarketRepo;
  /** The back room: slot turnover, receipts, and boosts nobody has spent yet. */
  blackMarket: BlackMarketRepo;
  /** §B7: the gates on districts crews have taken whole. Keyed by ground, not by crew. */
  capturedGates: CapturedGatesRepo;
  /** Append-only record of what has happened. Written to, never read by a rule. */
  history: HistoryRepo;
  /** §A4: officers out casing a district, and the ground they have opened. */
  scouting: ScoutingRepo;
  /**
   * Runs `work` so that either all of its writes land or none of them do.
   *
   * Here rather than passed around as a database handle because the things that need it are the
   * settle functions, and those take repositories: handing them a `Database` as well would make
   * every one of their signatures carry a second way to reach the same rows.
   *
   * Nests safely. better-sqlite3 turns an inner `transaction` into a savepoint, so a settle that
   * uses this inside a route that has already opened one is still a single atomic unit.
   */
  tx<T>(work: () => T): T;
}

export function createRepositories(db: AppDatabase): Repositories {
  return {
    users: createUsersRepo(db),
    factions: createFactionsRepo(db),
    social: createSocialRepo(db),
    overseers: createOverseersRepo(db),
    bases: createBasesRepo(db),
    battles: createBattlesRepo(db),
    sieges: createSiegeRepo(db),
    missions: createMissionsRepo(db),
    bar: createBarRepo(db),
    city: createCityRepo(db),
    movements: createMovementRepo(db),
    market: createMarketRepo(db),
    blackMarket: createBlackMarketRepo(db),
    capturedGates: createCapturedGatesRepo(db),
    history: createHistoryRepo(db),
    scouting: createScoutingRepo(db),
    tx: (work) => db.transaction(work)(),
  };
}
