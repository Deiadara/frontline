import { CONTESTED_DISTRICTS } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories } from '../db/repos/index.js';
import { settleLocationUpgrades } from './actions.js';

/**
 * An upgrade and a fight on the same ground, both due when the world next settles (bug pass,
 * 2026-10-06). Upgrades settle first, so after a restart over both the work banked its level ahead
 * of a capture that came first and should have taken it.
 */
describe('an upgrade due after a fight on the same ground', () => {
  const district = CONTESTED_DISTRICTS[0]!;
  const location = district.locations[0]!;
  const doneAt = '2026-10-06T21:05:00.000Z';
  const now = new Date('2026-10-06T22:00:00.000Z');

  const world = (fightAt: string) => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    // The rows are what is being read, not who called them: no crew is needed behind the ids.
    db.pragma('foreign_keys = OFF');
    const repos = createRepositories(db);
    const control = repos.city.control(location.id)!;
    repos.city.put({
      ...control,
      upgradingUntil: doneAt,
    });
    repos.sieges.insert({
      id: 'fight',
      target: { kind: 'location', districtId: district.id, locationId: location.id },
      attackerBaseId: 'b',
      defender: control.holder,
      scheduledFor: fightAt,
      declaredAt: '2026-10-06T00:00:00.000Z',
      resolvedAt: null,
      seed: 'fight',
      holdAfterCapture: true,
      wokeSleepers: false,
    });
    return { repos, before: control.level };
  };

  it('waits for a fight marked before the work finished', () => {
    const { repos, before } = world('2026-10-06T21:00:00.000Z');
    settleLocationUpgrades(repos, now);
    const after = repos.city.control(location.id)!;
    expect(after.level).toBe(before);
    expect(after.upgradingUntil).toBe(doneAt);
  });

  it('banks as before when the fight comes after the work', () => {
    const { repos, before } = world('2026-10-06T21:30:00.000Z');
    settleLocationUpgrades(repos, now);
    const after = repos.city.control(location.id)!;
    expect(after.level).toBe(before + 1);
    expect(after.upgradingUntil).toBeNull();
  });
});
