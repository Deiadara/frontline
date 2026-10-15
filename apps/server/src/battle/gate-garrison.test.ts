import { findDistrict } from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aDayAfter,
  closeWorlds,
  declare,
  holdPlot,
  makeWorld,
  register,
  runTheFight,
  type Crew,
  type World,
} from '../testing/fight-world.js';

/**
 * Ironmouth held whole pays at a gate and nowhere else (maintainer, 2026-10-09). The gate half
 * is `gate-defence.test.ts`; this is the other half: a crew holding the district and defending a
 * plot it holds elsewhere fights at its ordinary figures.
 */

afterEach(closeWorlds);

function holdIronmouth(world: World, crew: Crew): void {
  for (const location of findDistrict('ironmouth')!.locations) {
    const control = world.app.repos.city.control(location.id)!;
    world.app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: crew.baseId },
      garrison: {},
    });
  }
}

/**
 * The holder's fold in two fights on its plot, the district taken between them. One world rather
 * than two compared, because each account is offered its own overseer.
 */
async function twoPlotFights() {
  const world = await makeWorld('defender');
  const caller = await register(world, 'caller', { razors: 3 });
  const holder = await register(world, 'holder');
  holdPlot(world, holder, { razors: 5 });
  const first = await declare(world, caller);
  runTheFight(world, first);
  const without = world.seen().defenderTerritory!;
  holdIronmouth(world, holder);
  // A day on, or the caller who lost could not call the plot again (2026-10-05).
  aDayAfter(world, first);
  runTheFight(world, await declare(world, caller));
  return { without, withIt: world.seen().defenderTerritory! };
}

describe('Ironmouth held whole, away from a gate', () => {
  it('adds nothing to a fight over a plot', async () => {
    const { without, withIt } = await twoPlotFights();
    expect(without.gateFightPercent).toBe(0);
    expect(withIt.gateFightPercent).toBe(5);
    expect(withIt.unitOffensePercent).toBe(without.unitOffensePercent);
    expect(withIt.unitVitalityPercent).toBe(without.unitVitalityPercent);
  });
});
