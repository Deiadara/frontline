import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { unitSlotsUsed } from '@frontline/shared';
import { fightPhase, onTheRoad, roadCounts, roadIsEmpty } from './road';

/**
 * The road is everybody who is not home, from four reads, and the header adds them up.
 *
 * The page listed only columns walking to fights, so an army out on missions read as "nobody is
 * out". The filters are the half that can quietly go wrong: a resolved mission is home, a fight
 * with no muster is a declaration and not a deployment, and a settled fight is a report.
 */
describe('who is on the road', () => {
  const now = new Date(F.BOARD_NOW);

  it('gathers columns, active jobs, manned fights and the scout', () => {
    const road = onTheRoad(F.actionsResponse, F.missionsResponse(now), F.battles);
    expect(road.columns).toHaveLength(F.actionsResponse.movements.length);
    expect(road.jobs.every((job) => job.status === 'active')).toBe(true);
    expect(road.jobs.length).toBeGreaterThan(0);
    // The fixture's press fight has a muster; the Bonefield one has nobody deployed.
    expect(road.fights.map((fight) => fight.battle.id)).toEqual(['press']);
    expect(road.scout?.officerName).toBe('Vesper Kade');
  });

  it('leaves out what is home, what is settled and what has nobody at it', () => {
    const settled = {
      ...F.battles,
      coming: F.battles.coming.map((view) => ({
        ...view,
        battle: { ...view.battle, resolvedAt: F.BOARD_NOW },
      })),
    };
    const home = {
      ...F.missionsResponse(now),
      missions: F.missionsResponse(now).missions.map((mission) => ({
        ...mission,
        status: 'resolved' as const,
      })),
    };
    const road = onTheRoad(
      { ...F.actionsResponse, movements: [], scoutingRun: null },
      home,
      settled,
    );
    expect(roadIsEmpty(road)).toBe(true);
  });

  /**
   * The header prints "unit slots", so the figure has to be unit slots.
   *
   * Summed here off the fixture's own forces through `unitSlotsUsed`, which is a different
   * arithmetic from the `size` the wire carries beside them: `size` is a head count, and a header
   * that added it up told a crew with anything heavy on the road that fewer slots were out than
   * the district was holding open. The head count is asserted as the control, so this cannot pass
   * against a reader that has quietly gone back to it.
   */
  it('counts unit slots across columns, jobs and fights, not heads', () => {
    const road = onTheRoad(F.actionsResponse, F.missionsResponse(now), F.battles);
    const counts = roadCounts(road);
    const press = F.battles.coming.find((view) => view.battle.id === 'press');
    const slotsOf = (army: Readonly<Record<string, number>>) => unitSlotsUsed(army);
    const expected =
      road.columns.reduce(
        (total, column) => total + slotsOf(column.army) + slotsOf(column.perimeter),
        0,
      ) +
      road.jobs.reduce((total, job) => total + slotsOf(job.force), 0) +
      (press?.muster ? slotsOf(press.muster.army) + slotsOf(press.muster.perimeter) : 0);
    expect(counts.unitSlots).toBe(expected);

    // The control: the fixture really does hold something that costs more than one slot, so the
    // two arithmetics give different answers and this test can tell them apart.
    const heads =
      F.actionsResponse.movements.reduce((total, column) => total + column.size, 0) +
      road.jobs.reduce(
        (total, job) => total + Object.values(job.force).reduce((sum, count) => sum + count, 0),
        0,
      ) +
      (press?.muster?.size ?? 0);
    expect(counts.unitSlots).toBeGreaterThan(heads);
    expect(counts.scouts).toBe(1);
  });

  it('says whether a force at a fight is waiting for the mark or in it', () => {
    const press = F.battles.coming.find((view) => view.battle.id === 'press');
    if (!press) throw new Error('fixture: no press fight');
    expect(fightPhase(press, new Date(Date.parse(press.battle.scheduledFor) - 1))).toBe('waiting');
    expect(fightPhase(press, new Date(press.battle.scheduledFor))).toBe('fighting');
  });
});
