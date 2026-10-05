import { startingResearch, startingTraining } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { startingBase } from '../crew/starting.js';
import { openDatabase, runMigrations } from '../db/index.js';
import type { BaseWork } from '../db/repos/bases.js';
import { createRepositories } from '../db/repos/index.js';
import { workDue } from './finished.js';

/**
 * Which crews the clock's finished-work sweep loads (maintainer ruling, 2026-09-29). One test per
 * clock, each one second either side of its end, so a sweep that forgot a clock or read the wrong
 * field fails here rather than on a standings screen a day stale.
 */
const NOW = new Date('2026-09-29T12:00:00.000Z');
const endingAt = (offsetSeconds: number, durationSeconds = 60) => ({
  startedAt: new Date(NOW.getTime() + (offsetSeconds - durationSeconds) * 1000).toISOString(),
  durationSeconds,
});

const idle: BaseWork = {
  id: 'crew',
  buildQueue: [],
  musterQueue: [],
  research: startingResearch(),
  training: startingTraining(NOW.toISOString()),
};

describe('workDue', () => {
  it('is false for a crew with nothing under way', () => {
    expect(workDue(idle, NOW)).toBe(false);
  });

  it.each([
    [
      'a build',
      (ends: number): BaseWork => ({
        ...idle,
        buildQueue: [{ id: 'b', kind: 'nexus', level: 2, ...endingAt(ends), paid: {}, parts: {} }],
      }),
    ],
    [
      'a batch of units',
      (ends: number): BaseWork => ({
        ...idle,
        musterQueue: [
          { id: 't', unitId: 'razors', count: 1, ...endingAt(ends) },
        ] as unknown as BaseWork['musterQueue'],
      }),
    ],
    [
      'a Lab rung',
      (ends: number): BaseWork => ({
        ...idle,
        research: {
          ...idle.research,
          active: {
            id: 'r',
            startedAt: endingAt(ends, 120).startedAt,
            durationMinutes: 2,
          } as unknown as BaseWork['research']['active'],
        },
      }),
    ],
    [
      'a drill',
      (ends: number): BaseWork => ({
        ...idle,
        training: {
          ...idle.training,
          sessions: [{ id: 'd', subjectId: 'overseer', attribute: 'strength', ...endingAt(ends) }],
        },
      }),
    ],
  ])('is true once %s has finished, and not a second before', (_what, withClock) => {
    expect(workDue(withClock(1), NOW)).toBe(false);
    expect(workDue(withClock(0), NOW)).toBe(true);
    expect(workDue(withClock(-1), NOW)).toBe(true);
  });
});

/**
 * The candidates come off a SQL filter before `workDue` sees them, so each clock has to pass that
 * filter too: a crew whose only work is a drill or a Lab rung was otherwise never looked at.
 */
describe('listWorkInFlight', () => {
  it('names every crew with one clock running, and no idle crew', () => {
    const db = openDatabase(':memory:');
    try {
      runMigrations(db);
      const repos = createRepositories(db);
      const at = NOW.toISOString();
      for (const id of ['idle', 'building', 'mustering', 'researching', 'drilling']) {
        repos.users.insert({
          id: `u-${id}`,
          username: `u_${id}`,
          passwordHash: 'x',
          createdAt: at,
        });
        repos.bases.insert(startingBase({ id, ownerId: `u-${id}`, name: `Crew ${id}`, now: at }));
      }
      const building = repos.bases.findById('building')!;
      repos.bases.updateDistrict('building', building.buildings, [
        { id: 'b', kind: 'nexus', level: 2, ...endingAt(0), paid: {}, parts: {} },
      ]);
      const mustering = repos.bases.findById('mustering')!;
      repos.bases.updateArmy('mustering', mustering.army, [
        { id: 't', unitId: 'razors', count: 1, ...endingAt(0) },
      ] as unknown as BaseWork['musterQueue']);
      const researching = repos.bases.findById('researching')!;
      repos.bases.updateResearch('researching', {
        ...researching.research,
        active: {
          id: 'r',
          project: { kind: 'technology', techId: 'x' },
          startedAt: at,
          durationMinutes: 2,
          paid: {},
        },
      });
      const drilling = repos.bases.findById('drilling')!;
      repos.bases.updateTraining(
        'drilling',
        {
          ...drilling.training,
          sessions: [{ id: 'd', subjectId: 'overseer', attribute: 'strength', ...endingAt(0) }],
        },
        drilling.commanders,
      );

      expect(
        repos.bases
          .listWorkInFlight()
          .map((work) => work.id)
          .sort(),
      ).toEqual(['building', 'drilling', 'mustering', 'researching']);
    } finally {
      db.close();
    }
  });
});
