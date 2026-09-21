import {
  BATTLE_TIERS,
  bareBattlefield,
  enemyStrength,
  fieldStrength,
  findUnit,
  findUnitModification,
  makeAttributes,
  MAX_ATTRIBUTE,
  TacticalSkirmishEngine,
  type Army,
  type BattleTier,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import {
  ENEMY_MIX_VARIANCE,
  ENEMY_STRENGTH_TOLERANCE,
  ENEMY_TIER_ROSTERS,
  enemyForce,
} from './enemy.js';
import { fightMissionBattle } from './battle.js';

/**
 * What a battle job fields, and what happens when a crew walks into it (maintainer, 2026-09-10).
 *
 * Two properties carry the whole feature. The force has to weigh what the tier says it weighs, or
 * the band on the card is a lie; and it has to be the same force twice, or a player who reloads
 * gets a different fight from the one their crew was in.
 */

const total = (army: Army) => Object.values(army).reduce((sum, count) => sum + count, 0);

describe('the force waiting at a battle job', () => {
  it('names only units the catalogue still carries', () => {
    for (const tier of BATTLE_TIERS) {
      for (const draw of ENEMY_TIER_ROSTERS[tier]) {
        expect(findUnit(draw.unitId), `${tier}: ${draw.unitId}`).toBeDefined();
      }
      const shares = ENEMY_TIER_ROSTERS[tier].reduce((sum, draw) => sum + draw.share, 0);
      expect(shares, tier).toBeCloseTo(1, 10);
    }
  });

  it('weighs what the tier says it weighs, at every level', () => {
    for (const tier of BATTLE_TIERS) {
      for (const level of [1, 5, 20, 40]) {
        for (let seed = 0; seed < 25; seed += 1) {
          const target = enemyStrength(tier, level);
          const built = fieldStrength(enemyForce(tier, level, `run-${seed}`));
          expect(
            Math.abs(built - target) / target,
            `${tier} at level ${level}, seed ${seed}: ${built} against ${target}`,
          ).toBeLessThanOrEqual(ENEMY_STRENGTH_TOLERANCE);
        }
      }
    }
  });

  it('is the same force twice from the same seed, and a different one from another', () => {
    expect(enemyForce('fight', 3, 'seed-a')).toEqual(enemyForce('fight', 3, 'seed-a'));
    expect(enemyForce('fight', 3, 'seed-a')).not.toEqual(enemyForce('fight', 3, 'seed-b'));
    // ...and the level moves it, which is what makes the same job harder as a crew grows.
    expect(fieldStrength(enemyForce('fight', 20, 'seed-a'))).toBeGreaterThan(
      fieldStrength(enemyForce('fight', 1, 'seed-a')),
    );
  });

  it('fields every line on the roster, however the mix rolled', () => {
    for (const tier of BATTLE_TIERS) {
      for (let seed = 0; seed < 20; seed += 1) {
        const force = enemyForce(tier, 1, `mix-${seed}`);
        for (const draw of ENEMY_TIER_ROSTERS[tier]) {
          expect(force[draw.unitId] ?? 0, `${tier}/${draw.unitId}/${seed}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('mixes differently from job to job rather than dealing one order of battle', () => {
    const drawn = new Set(
      Array.from({ length: 30 }, (_, seed) => JSON.stringify(enemyForce('siege', 1, `s${seed}`))),
    );
    expect(drawn.size, 'the roll is not moving the composition').toBeGreaterThan(5);
    expect(ENEMY_MIX_VARIANCE).toBeGreaterThan(0);
  });

  it('gets heavier from a skirmish to a siege', () => {
    const weights = BATTLE_TIERS.map((tier: BattleTier) =>
      fieldStrength(enemyForce(tier, 1, 'ladder')),
    );
    expect(weights[0]).toBeLessThan(weights[1] as number);
    expect(weights[1]).toBeLessThan(weights[2] as number);
  });
});

describe('a crew in a battle job', () => {
  const bigCrew: Army = { razors: 60, wardens: 20 };
  const doomedCrew: Army = { razors: 1 };

  it('holds the field with a force worth several times the job, and comes home', () => {
    const fought = fightMissionBattle({
      seed: 7,
      jobName: 'Foundry Raid',
      force: bigCrew,
      vehicles: {},
      tier: 'skirmish',
      level: 1,
      anyRide: false,
    });
    expect(fought.outcome).toBe('success');
    expect(total(fought.home)).toBeGreaterThan(0);
    // Everybody the engine did not kill: the two lists are the force, exactly.
    expect(total(fought.home) + total(fought.lost)).toBe(total(bigCrew));
  });

  /**
   * §D7: the job pays a name for the enemy's dead, so the fight has to say who they were.
   *
   * The crew fields nothing the skirmish roster does (`ENEMY_TIER_ROSTERS.skirmish` is Razors and
   * Scrapers; this crew is all Wardens), so the two casualty lists cannot share a unit id and the
   * engine's two lists cannot be confused for one another: a `killed` that named a Warden would
   * be our own dead under the wrong heading. Bounded by who was waiting, per unit, because a list
   * that named more than the tier fielded would be paying for a kill that did not happen.
   */
  it('names the enemy dead, and never more of them than were waiting', () => {
    const wardens: Army = { wardens: 30 };
    for (const draw of ENEMY_TIER_ROSTERS.skirmish) expect(draw.unitId).not.toBe('wardens');
    const fought = fightMissionBattle({
      seed: 7,
      jobName: 'Foundry Raid',
      force: wardens,
      vehicles: {},
      tier: 'skirmish',
      level: 1,
      anyRide: false,
    });
    expect(total(fought.killed)).toBeGreaterThan(0);
    expect(fought.killed.wardens).toBeUndefined();
    for (const [unitId, count] of Object.entries(fought.killed)) {
      expect(fought.enemy[unitId], unitId).toBeDefined();
      expect(count, unitId).toBeLessThanOrEqual(fought.enemy[unitId] ?? 0);
    }
  });

  it('loses, and the loss is units rather than an empty bag', () => {
    const fought = fightMissionBattle({
      seed: 11,
      jobName: 'Refinery Assault',
      force: { razors: 4 },
      vehicles: {},
      tier: 'siege',
      level: 1,
      anyRide: false,
    });
    expect(fought.outcome).toBe('failure');
    expect(total(fought.lost)).toBeGreaterThan(0);
  });

  /**
   * §D1: the leader is in the line, and their sheet is worth something in it.
   *
   * The engine takes one officer per side and folds their attributes into eleven combat numbers,
   * which is what "the leader matters" has to mean once a battle job is a real fight rather than a
   * roll. A crew balanced on the edge is the measurement: send too many and nothing a person does
   * shows up, send too few and nothing saves them.
   */
  it('fights differently with somebody at the head of it', () => {
    const force: Army = { razors: 9 };
    const args = {
      seed: 4,
      jobName: 'Convoy Ambush',
      force,
      vehicles: {},
      tier: 'skirmish' as const,
      level: 1,
      anyRide: false,
    };
    const alone = fightMissionBattle(args);
    const led = fightMissionBattle({
      ...args,
      leader: {
        officerId: 'off-1',
        name: 'Halvard Nyx',
        attributes: makeAttributes(MAX_ATTRIBUTE),
      },
    });
    expect(led).not.toEqual(alone);
    expect(total(led.lost)).toBeLessThan(total(alone.lost));
  });

  /**
   * The yard's cards reach a battle job (maintainer, 2026-09-15: modifications fold onto every
   * sheet the engine reads).
   *
   * The battle settler hands the engine `attacker.unitLoadouts`; this path handed it nothing, so
   * Taped Grips on the Razors fought on a declared battle and did nothing on a job. Sixteen
   * points of damage on a crew balanced on the edge is the measurement, and it is asserted as
   * fewer dead rather than as "a different fight": a different fight is any change to the
   * stream, and fewer dead is the card doing what its face says.
   */
  it('fights with what the yard bolted on, and loses fewer people for it', () => {
    const force: Army = { razors: 9 };
    const grips = findUnitModification('taped_grips');
    expect(grips?.effect.offense ?? 0).toBeGreaterThan(0);
    const fewerDead = [];
    const moreDead = [];
    for (let seed = 1; seed <= 40; seed += 1) {
      const args = {
        seed,
        jobName: 'Convoy Ambush',
        force,
        vehicles: {},
        tier: 'skirmish' as const,
        level: 1,
        anyRide: false,
      };
      const bare = fightMissionBattle(args);
      const fitted = fightMissionBattle({ ...args, loadouts: { razors: ['taped_grips'] } });
      if (total(fitted.lost) < total(bare.lost)) fewerDead.push(seed);
      if (total(fitted.lost) > total(bare.lost)) moreDead.push(seed);
    }
    // Most seeds, not one lucky one: a card worth sixteen damage has to show on a crew this size.
    // Measured 2026-09-21 over a hundred seeds: fewer dead on 45, more dead on 1. That one is a
    // fight the extra damage re-timed rather than one it lost, and it is tallied rather than
    // forbidden, because "never worse on any seed" is a claim about the stream and not the card.
    expect(fewerDead.length, `fewer dead on ${fewerDead.length} of 40`).toBeGreaterThan(12);
    expect(moreDead.length, `more dead on seeds ${moreDead.join(', ')}`).toBeLessThanOrEqual(2);
  });

  it('is the same fight twice from the same row', () => {
    const args = {
      seed: 99,
      jobName: 'Convoy Ambush',
      force: bigCrew,
      vehicles: {},
      tier: 'fight' as const,
      level: 2,
      anyRide: false,
    };
    expect(fightMissionBattle(args)).toEqual(fightMissionBattle(args));
  });

  /**
   * The rule the maintainer asked for in as many words: nothing is waiting on the way out.
   *
   * A ring is what turns a rout into an extermination (`battle/perimeter.ts`), and a mission job
   * sets none on either side. The control is the same fight with a ring on the enemy: it catches
   * people, which is what makes this an assertion about the mission rather than about a fight
   * nobody could have escaped anyway.
   */
  it('lets whoever broke and ran come home, because nothing pursues them', () => {
    const force: Army = { razors: 12 };
    const seed = 5;
    const fought = fightMissionBattle({
      seed,
      jobName: 'Refinery Assault',
      force,
      vehicles: {},
      tier: 'siege',
      level: 1,
      anyRide: false,
    });
    expect(fought.outcome).toBe('failure');
    expect(total(fought.home), 'nobody got clear, so this measures nothing').toBeGreaterThan(0);

    const ringed = new TacticalSkirmishEngine().resolve({
      seed: `${seed}:battle`,
      attackerName: 'Your crew',
      defenderName: 'Whoever was waiting',
      locationName: 'Refinery Assault',
      battlefield: bareBattlefield('Refinery Assault'),
      attacking: force,
      defending: enemyForce('siege', 1, String(seed)),
      defenderPerimeter: { razors: 40 },
    });
    expect(total(ringed.fled)).toBeLessThan(total(fought.home));
  });

  /**
   * The porters are never on either list, so they always walk back.
   *
   * `standsInLine` keeps `combat: false` sheets out of the line, which means the rout never counts
   * them and the winner's casualties never do either. The consequence the settle depends on is
   * that `force` less `lost` still holds every bag that went: a crew whose fighters were all
   * killed still has somebody to bring the report home, so `reported` stays true.
   */
  it('never kills a porter, whichever way the fight went', () => {
    const force: Army = { razors: 4, scavengers: 7 };
    let sawTheLineDie = false;
    for (const tier of BATTLE_TIERS) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const fought = fightMissionBattle({
          seed,
          jobName: 'Refinery Assault',
          force,
          vehicles: {},
          tier,
          level: 1,
          anyRide: false,
        });
        expect(fought.lost.scavengers ?? 0, `${tier}/${seed}`).toBe(0);
        expect(fought.home.scavengers, `${tier}/${seed}`).toBe(7);
        expect(total(fought.home) + total(fought.lost), `${tier}/${seed}`).toBe(total(force));
        if ((fought.home.razors ?? 0) === 0) sawTheLineDie = true;
      }
    }
    expect(sawTheLineDie, 'no fight killed the line, so this measures nothing').toBe(true);
  });

  it('loses a machine whose riders all died, and keeps the ones nobody was in', () => {
    // Two seats' worth of trouble: one bike carrying the crew, one parked with nobody in it.
    const fought = fightMissionBattle({
      seed: 11,
      jobName: 'Refinery Assault',
      force: doomedCrew,
      vehicles: { motorcycle: 2 },
      tier: 'siege',
      level: 1,
      anyRide: false,
    });
    expect(total(fought.home)).toBe(0);
    expect(fought.wreckedVehicles).toEqual({ motorcycle: 1 });
    expect(fought.vehicles).toEqual({ motorcycle: 1 });
  });
});
