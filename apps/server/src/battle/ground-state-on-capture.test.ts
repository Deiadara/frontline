import { groundStateOf } from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PLOT,
  closeWorlds,
  declare,
  holdPlot,
  makeWorld,
  register,
  runTheFight,
} from '../testing/fight-world.js';

/**
 * What a capture does to the ground state on the plot it writes (bug pass, 2026-10-07).
 *
 * The switch on the Tolling Tower, the pins on the Pamphlet Wall and the count on the Trophy Hall
 * are the *holder's*, so `putControl` clears them when a plot changes hands and leaves them alone
 * when it does not. Which branch runs is its decision, and the settle used to hand it a bare
 * object literal rather than the row it had just read: on the branch that keeps the row as given,
 * that literal took the switch, the pins and the trophies off ground whose holder had not changed.
 *
 * Both branches are pinned here, because a fix to either one of them is a fix that can break the
 * other: a spread that carries the row through must not carry a beaten crew's trophies to whoever
 * took the plot off them.
 */
afterEach(closeWorlds);

/** Long enough ago that a stamp written by the settle cannot be mistaken for this one. */
const ONCE = '2026-01-02T03:04:05.000Z';

const HELD_STATE = {
  switchedOn: true,
  switchedAt: ONCE,
  pamphlets: ['razors'],
  pamphletsPinnedAt: 2,
  pamphletsSwappedAt: ONCE,
  trophies: { razors: 7 },
  trophiesSince: ONCE,
};

describe('a won location fight', () => {
  /**
   * The caller standing on its own target at the mark.
   *
   * `declare` refuses a crew's own ground and `alreadyCalled` allows one pending fight per plot,
   * so ordinary play cannot reach this. The Console can: `grantFootholds` hands a crew a plot
   * without looking at the fights called on it. The fight still runs against whoever was named at
   * the call, because `battle.defender` was written then, and the settle reads the holder live.
   */
  it('leaves the ground state alone on a plot that did not change hands', async () => {
    const world = await makeWorld('attacker');
    const ana = await register(world, 'ana', { razors: 12 });
    const bex = await register(world, 'bex', { razors: 2 });
    holdPlot(world, bex, { razors: 2 });
    const fight = await declare(world, ana);

    const control = world.app.repos.city.control(PLOT)!;
    world.app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: ana.baseId },
      garrison: {},
      level: 3,
      ...HELD_STATE,
    });

    runTheFight(world, fight);

    const after = world.app.repos.city.control(PLOT)!;
    expect(after.holder).toEqual({ kind: 'crew', baseId: ana.baseId });
    expect(after.level, 'the work on the plot went with the write').toBe(3);
    const state = groundStateOf(after);
    expect(state.switchedOn, 'the tower was switched off by a fight it was not in').toBe(true);
    expect(state.switchedAt).toBe(ONCE);
    expect(state.pamphlets, 'the pins came down on ground nobody took').toEqual(['razors']);
    expect(state.pamphletsPinnedAt).toBe(2);
    expect(state.pamphletsSwappedAt).toBe(ONCE);
    expect(state.trophies, 'the hall forgot kills it still holds the ground for').toEqual({
      razors: 7,
    });
    expect(state.trophiesSince).toBe(ONCE);
  });

  it('clears the beaten crew’s ground state on a plot that did change hands', async () => {
    const world = await makeWorld('attacker');
    const ana = await register(world, 'ana', { razors: 12 });
    const bex = await register(world, 'bex', { razors: 2 });
    holdPlot(world, bex, { razors: 2 });
    const control = world.app.repos.city.control(PLOT)!;
    world.app.repos.city.put({ ...control, level: 3, ...HELD_STATE });
    const fight = await declare(world, ana);

    runTheFight(world, fight);

    const after = world.app.repos.city.control(PLOT)!;
    expect(after.holder).toEqual({ kind: 'crew', baseId: ana.baseId });
    // §A4: the level is the prize and carries. Nothing the beaten crew did on the plot does.
    expect(after.level).toBe(3);
    const state = groundStateOf(after);
    expect(state.switchedOn, 'the taker inherited the tower’s switch').toBe(false);
    expect(state.switchedAt).toBeNull();
    expect(state.pamphlets, 'the taker inherited the wall’s pins').toEqual([]);
    expect(state.pamphletsPinnedAt).toBe(0);
    expect(state.pamphletsSwappedAt).toBeNull();
    expect(state.trophies, 'the taker inherited the beaten crew’s kills').toEqual({});
    expect(
      Date.parse(state.trophiesSince ?? ''),
      'the count starts at the capture',
    ).toBeGreaterThan(Date.parse(ONCE));
  });
});
