import { randomUUID } from 'node:crypto';
import {
  BattleRequestSchema,
  DEFAULT_ATTRIBUTES,
  districtDefense,
  raidLootBonus,
  addResources,
  adjustMeter,
  findDistrict,
  infamyForRaidWon,
  isDistrictAttackable,
  raidTargetOf,
  recordRaidOutcome,
  type Base,
  type BattleResponse,
  type District,
  type EconomyState,
  type PlayerXpAward,
  type Resources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody } from '../errors.js';
import { awardPlayerXp, levelUpFrom } from '../progression/award.js';

/**
 * Taking a site by force is the loudest *infamous* action in the game (GDD §D7) — anti-government
 * missions move the meter too, but by less (`MISSION_INFAMY_DELTA`). Losing still goes on the
 * books: a crew that keeps throwing people at doors that do not open earns the `Reckless` label
 * for it.
 *
 * The district comes in whole rather than just its winner, because §A3 makes *whose* ground it was
 * part of the record: a site taken off the Combine is anti-government action, and one of its two
 * seats of power is a step towards replacing it. `raidTargetOf` is the shared reading of that, so
 * the map is the only place the answer is authored.
 */
function recordRaid(
  economy: EconomyState,
  district: District,
  winner: 'attacker' | 'defender',
  now: Date,
): EconomyState {
  const target = raidTargetOf(district);
  return {
    ...economy,
    infamy:
      winner === 'attacker'
        ? adjustMeter(
            economy.infamy,
            infamyForRaidWon({
              fromTheState: target.faction === 'government',
              seatOfPower: target.isSeatOfPower,
            }),
          )
        : economy.infamy,
    reputationTally: recordRaidOutcome(economy.reputationTally, { winner, target }, now),
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
    const base = settleBase(app.repos, owned, now).base;

    const district = findDistrict(targetDistrictId);
    if (!district || !isAttackable(app, district, base)) {
      throw new AppError('INVALID_TARGET', 'That district cannot be attacked');
    }

    // The raid is led with the player's own sheet (§F1), so the Overseer is read here and the
    // engine weighs it against the district. A base cannot exist without one, but a read path
    // must not 500 on a broken row: the recruitment mean stands in, which is a weak crew, not a
    // free win.
    const overseer = request.currentUser.overseerId
      ? app.repos.overseers.findById(request.currentUser.overseerId)
      : undefined;

    // §A1 — what the defender built. Only a rival *base* has structures; a plain map district is
    // bare ground and contributes nothing but its own difficulty, which the engine already reads.
    const garrison = app.repos.bases.findBotByDistrictId(district.id);
    const defenderDefense = garrison ? districtDefense(garrison.buildings) : 0;

    // Minted here and persisted below, so the fight replays from its row rather than from a clock.
    const seed = randomUUID();
    const result = app.battleEngine.simulate({
      attackerBaseId: base.id,
      attackerBaseName: base.name,
      targetDistrictId: district.id,
      attackerAttributes: overseer?.attributes ?? DEFAULT_ATTRIBUTES,
      defenderDefense,
      attackerLootBonus: raidLootBonus(base.buildings),
      seed,
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
          seed,
          createdAt: now.toISOString(),
        });
        app.repos.bases.updateEconomy(
          base.id,
          recordRaid(base.economy, district, result.winner, now),
        );
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
