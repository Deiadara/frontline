import { randomUUID } from 'node:crypto';
import {
  BattleRequestSchema,
  INFAMY_PER_RAID_WON,
  addResources,
  adjustMeter,
  findDistrict,
  isDistrictAttackable,
  recordRaidOutcome,
  type Base,
  type BattleResponse,
  type District,
  type EconomyState,
  type PlayerXpAward,
  type Resources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleBaseEconomy } from '../economy/settle.js';
import { AppError, parseBody } from '../errors.js';
import { awardPlayerXp, levelUpFrom } from '../progression/award.js';

/**
 * Taking a site by force is the one *infamous* action the game can currently perform (GDD §D7),
 * so it is the only live driver of the infamy meter and the reputation tally (§D8). Losing still
 * goes on the books — a crew that keeps throwing people at doors that do not open earns the
 * `Reckless` label for it.
 */
function recordRaid(
  economy: EconomyState,
  winner: 'attacker' | 'defender',
  now: Date,
): EconomyState {
  return {
    ...economy,
    infamy:
      winner === 'attacker' ? adjustMeter(economy.infamy, INFAMY_PER_RAID_WON) : economy.infamy,
    reputationTally: recordRaidOutcome(economy.reputationTally, winner, now),
  };
}

/** Reads the district's occupancy out of the database and applies the shared rule. */
function isAttackable(app: FastifyInstance, district: District, attacker: Base): boolean {
  return isDistrictAttackable(district, {
    isOwnBase: attacker.districtId === district.id,
    hasBotBase: app.repos.bases.findBotByDistrictId(district.id) !== undefined,
  });
}

export function registerBattleRoutes(app: FastifyInstance): void {
  app.post('/battle', { preHandler: app.authenticate }, (request): BattleResponse => {
    const { targetDistrictId } = parseBody(BattleRequestSchema, request.body);

    const owned = app.repos.bases.findByOwnerId(request.currentUser.id);
    if (!owned) {
      throw new AppError('NO_BASE', 'You must establish a base before launching an attack');
    }
    // Wages and upkeep come off the stockpile before the raid pays into it, so a player cannot
    // outrun an overdue payroll by spending the caps first.
    const now = new Date();
    const base = settleBaseEconomy(app.repos, owned, now);

    const district = findDistrict(targetDistrictId);
    if (!district || !isAttackable(app, district, base)) {
      throw new AppError('INVALID_TARGET', 'That district cannot be attacked');
    }

    const result = app.battleEngine.simulate({
      attackerBaseId: base.id,
      attackerBaseName: base.name,
      targetDistrictId: district.id,
    });

    // The award stays *inside* the transaction and is lifted out with the resources: a raid that
    // banks XP and then fails to commit must not have announced a level-up for it.
    const { resources, award } = app.db.transaction(
      (): {
        resources: Resources;
        award: PlayerXpAward;
      } => {
        app.repos.battles.insert({
          id: randomUUID(),
          attackerBaseId: base.id,
          targetDistrictId: district.id,
          winner: result.winner,
          log: result.log,
          rewards: result.rewards,
          createdAt: now.toISOString(),
        });
        app.repos.bases.updateEconomy(base.id, recordRaid(base.economy, result.winner, now));
        // §I1 pays XP for *fighting* other players, not for winning — a loss is worth less, not zero.
        const { award } = awardPlayerXp(
          app.repos,
          base,
          result.winner === 'attacker' ? 'raidWon' : 'raidLost',
        );
        if (result.winner === 'attacker') {
          const updated = addResources(base.resources, result.rewards);
          app.repos.bases.updateResources(base.id, updated);
          return { resources: updated, award };
        }
        return { resources: base.resources, award };
      },
    )();

    return { result, resources, levelUp: levelUpFrom([award]) };
  });
}
