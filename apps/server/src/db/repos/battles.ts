import type { BattleWinner, PartialResources } from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/** A completed battle to persist alongside its log and any rewards paid out. */
export interface NewBattle {
  id: string;
  attackerBaseId: string;
  targetDistrictId: string;
  /** The place taken or defended, when the fight was over one. Null for a raid on a district. */
  targetPlaceId: string | null;
  winner: BattleWinner;
  log: string[];
  rewards: PartialResources;
  /** The roll this fight was resolved from: what makes the row replayable. */
  seed: string;
  createdAt: string;
}

export interface BattlesRepo {
  insert(battle: NewBattle): void;
}

export function createBattlesRepo(db: AppDatabase): BattlesRepo {
  const insertStmt = db.prepare(
    `INSERT INTO battles
       (id, attacker_base_id, target_district_id, target_place_id, winner,
        log_json, rewards_json, seed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    insert(battle) {
      insertStmt.run(
        battle.id,
        battle.attackerBaseId,
        battle.targetDistrictId,
        battle.targetPlaceId,
        battle.winner,
        JSON.stringify(battle.log),
        JSON.stringify(battle.rewards),
        battle.seed,
        battle.createdAt,
      );
    },
  };
}
