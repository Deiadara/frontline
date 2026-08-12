import type { BattleWinner, PartialResources } from '@frontline/shared';
import type { AppDatabase } from '../index.js';

/** A completed battle to persist alongside its log and any rewards paid out. */
export interface NewBattle {
  id: string;
  attackerBaseId: string;
  targetDistrictId: string;
  winner: BattleWinner;
  log: string[];
  rewards: PartialResources;
  createdAt: string;
}

export interface BattlesRepo {
  insert(battle: NewBattle): void;
}

export function createBattlesRepo(db: AppDatabase): BattlesRepo {
  const insertStmt = db.prepare(
    `INSERT INTO battles
       (id, attacker_base_id, target_district_id, winner, log_json, rewards_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    insert(battle) {
      insertStmt.run(
        battle.id,
        battle.attackerBaseId,
        battle.targetDistrictId,
        battle.winner,
        JSON.stringify(battle.log),
        JSON.stringify(battle.rewards),
        battle.createdAt,
      );
    },
  };
}
