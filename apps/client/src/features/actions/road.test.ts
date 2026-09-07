import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
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

  it('counts bodies across columns, jobs and fights', () => {
    const road = onTheRoad(F.actionsResponse, F.missionsResponse(now), F.battles);
    const counts = roadCounts(road);
    const columns = F.actionsResponse.movements.reduce((total, column) => total + column.size, 0);
    const press = F.battles.coming.find((view) => view.battle.id === 'press');
    const jobs = road.jobs.reduce(
      (total, job) => total + Object.values(job.force).reduce((sum, count) => sum + count, 0),
      0,
    );
    expect(counts.bodies).toBe(columns + jobs + (press?.muster?.size ?? 0));
    expect(counts.scouts).toBe(1);
  });

  it('says whether a force at a fight is waiting for the mark or in it', () => {
    const press = F.battles.coming.find((view) => view.battle.id === 'press');
    if (!press) throw new Error('fixture: no press fight');
    expect(fightPhase(press, new Date(Date.parse(press.battle.scheduledFor) - 1))).toBe('waiting');
    expect(fightPhase(press, new Date(press.battle.scheduledFor))).toBe('fighting');
  });
});
