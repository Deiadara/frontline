import { declarationWindow } from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auth,
  closeWorlds,
  declare,
  holdPlot,
  makeWorld,
  register,
  runTheFight,
  type Crew,
  type World,
} from '../testing/fight-world.js';
import { settleBattles } from './resolve.js';

/**
 * What the bell says about a fight, to each side of it (bug pass, 2026-09-29).
 *
 * `battle_report` is one of the two kinds a player cannot switch off, so a wrong word on it is read
 * by everybody who fought, and a missing one is the fight vanishing from a board they were told
 * to watch.
 */

afterEach(closeWorlds);

const bells = (world: World, crew: Crew) =>
  world.app.repos.social.notifications(crew.userId, 50).map((bell) => bell.title);

describe('the report bell', () => {
  it.each(['attacker', 'defender'] as const)(
    'tells each side its own result when the %s wins',
    async (winner) => {
      const world = await makeWorld(winner);
      const attacker = await register(world, 'attacker', { razors: 20 });
      const defender = await register(world, 'defender', { razors: 5 });
      holdPlot(world, defender, { razors: 5 });
      runTheFight(world, await declare(world, attacker));

      const won = 'A fight was won';
      const lost = 'A fight was lost';
      expect(bells(world, attacker)).toContain(winner === 'attacker' ? won : lost);
      expect(bells(world, defender)).toContain(winner === 'defender' ? won : lost);
      expect(bells(world, defender)).not.toContain(winner === 'defender' ? lost : won);
    },
  );
});

describe('a raid called off at the mark', () => {
  /*
   * The resident has no row on a raid until they deploy, so a call-off that told "everybody with a
   * row" told the raider and nobody else, while the resident still had the `district_attacked`
   * bell from the call and a fight gone from their board.
   */
  it('tells the crew it was called on, not only the one that called it', async () => {
    const world = await makeWorld('attacker');
    const raider = await register(world, 'raider', { razors: 20 });
    const resident = await register(world, 'resident', { razors: 5 });
    const HOME = 'ashen-terraces';
    world.db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, resident.baseId);
    world.app.repos.sieges.breakGate(HOME, new Date(Date.now() + 24 * 3_600_000).toISOString());
    const called = await world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(raider.token),
      payload: {
        target: { kind: 'district', districtId: HOME },
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(called.statusCode, called.body.slice(0, 200)).toBe(200);
    const [battle] = world.app.repos.sieges.pending();
    // The positive control: the resident was told at the call, and has no row on the fight.
    expect(world.app.repos.social.notifications(resident.userId, 10).map((b) => b.kind)).toContain(
      'district_attacked',
    );
    expect(
      world.app.repos.sieges.deployments(battle!.id).some((row) => row.baseId === resident.baseId),
    ).toBe(false);

    // The gate goes back up before the mark.
    world.app.repos.sieges.breakGate(HOME, new Date(Date.now() - 120_000).toISOString());
    world.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), battle!.id);
    expect(settleBattles(world.app.repos, world.engine, new Date())).toHaveLength(0);

    expect(bells(world, raider)).toContain('The gate was back up in time');
    expect(bells(world, resident)).toContain('The gate was back up in time');
  });
});
