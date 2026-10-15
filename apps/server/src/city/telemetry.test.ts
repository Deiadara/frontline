import {
  STARTING_RESOURCES,
  TRAINING_SECONDS,
  applyGain,
  createCommander,
  drillBonusRoll,
  findDistrict,
  findUnit,
  makeAttributes,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  featMeasureKey,
  type Base,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { announceDrills, bankTrainingFor } from '../crew/training.js';
import { travelMsTo } from '../battle/movement.js';
import { moveMinutes } from '../moves/moves.js';
import { musterRatesFor, ratesForUnit } from '../units/muster.js';

/**
 * Telemetry Hill's remainder at the server (maintainer, 2026-10-09): SHORTCUT on every road that
 * reads one, the Bunkroom's extra point off a finished drill, and the Hill held whole on the
 * Wonders' muster.
 */

const HOUR = '2026-09-01T12:00:00.000Z';
const NOW = new Date(HOUR);

function stack(): { repos: Repositories; base: Base } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const repos = createRepositories(db);
  repos.users.insert({ id: 'u', username: 'holder', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Yard',
    districtId: 'south-quay',
    level: 20,
    isBot: false,
    resources: { ...STARTING_RESOURCES },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'nexus', kind: 'nexus', level: 10, modifications: [] }],
    buildQueue: [],
    army: {},
    musterQueue: [],
    training: startingTraining(HOUR),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [createCommander('o', 'Vasso', 'engineer', makeAttributes(20))],
    createdAt: HOUR,
  };
  repos.bases.insert(base);
  return { repos, base };
}

function take(repos: Repositories, baseId: string, locationId: string, level = 1): void {
  const control = repos.city.control(locationId);
  if (!control) throw new Error(`fixture: no ${locationId}`);
  repos.city.put({ ...control, holder: { kind: 'crew', baseId }, level, garrison: {} });
}

describe('SHORTCUT on the roads', () => {
  const plot = findDistrict('steelbelt')!.locations[0]!.id;

  it('halves a move with the Cartographer in it, door and all, and nobody else’s', () => {
    const { repos, base } = stack();
    const from = { kind: 'location' as const, locationId: plot };
    const home = { kind: 'district' as const };
    const plain = moveMinutes(repos, base, from, home, { army: { razors: 4 }, vehicles: {} })!;
    const led = moveMinutes(repos, base, from, home, {
      army: { razors: 4, the_cartographer: 1 },
      vehicles: {},
    })!;
    // Her own pace is 70 against the Razors' 45, so the column is still held to theirs.
    expect(plain).toBeGreaterThan(2);
    expect(led).toBe(Math.max(1, Math.round(plain / 2)));
  });

  it('halves a column’s march to a fight', () => {
    const { repos, base } = stack();
    const plain = travelMsTo(repos, base, 'steelbelt', { vehicles: {}, force: { razors: 4 } })!;
    const led = travelMsTo(repos, base, 'steelbelt', {
      vehicles: {},
      force: { razors: 4, the_cartographer: 1 },
    })!;
    expect(led).toBeCloseTo(plain / 2, 6);
  });
});

describe('the Technicians’ Bunkroom', () => {
  /** A session id the roll at `percent` answers as asked, so both branches are pinned. */
  const sessionRolling = (percent: number, wanted: boolean): string => {
    for (let at = 0; ; at += 1) {
      if (drillBonusRoll(`drill-${at}`, percent) === wanted) return `drill-${at}`;
    }
  };

  const drilled = (level: number, sessionId: string) => {
    const { repos, base } = stack();
    if (level > 0) take(repos, base.id, 'telemetry-hill-bunkroom', level);
    const training = {
      ...base.training,
      sessions: [
        {
          id: sessionId,
          subjectId: 'o',
          attribute: 'logic' as const,
          startedAt: HOUR,
          durationSeconds: TRAINING_SECONDS,
        },
      ],
    };
    repos.bases.updateTraining(base.id, training, base.commanders);
    const done = new Date(NOW.getTime() + (TRAINING_SECONDS + 60) * 1000).toISOString();
    const settled = bankTrainingFor(repos, { ...base, training }, done);
    const plain = applyGain(makeAttributes(20), { subjectId: 'o', attribute: 'logic' }).logic;
    return { logic: settled.base.commanders[0]!.attributes.logic, plain, settled, repos };
  };

  it('pays one point more when the session’s roll comes up, and counts it for the feat', () => {
    const lucky = drilled(5, sessionRolling(50, true));
    expect(lucky.logic).toBe(lucky.plain + 1);
    expect(lucky.settled.gains[0]?.extra).toBe(1);
    expect(lucky.repos.feats.tallies('b')[featMeasureKey('drill_bonus_points')]).toBe(1);
    // ...and the receipt says so, rather than the sheet moving one more without a word.
    announceDrills(lucky.repos, lucky.settled.base, lucky.settled);
    expect(lucky.repos.social.notifications('u', 5)[0]?.body).toContain(
      'The Bunkroom paid 1 extra point.',
    );
  });

  it('pays the plain gain when it does not, and nothing extra without the Bunkroom', () => {
    const unlucky = drilled(5, sessionRolling(50, false));
    expect(unlucky.logic).toBe(unlucky.plain);
    // The same id that would have rolled at level 5 rolls nothing for a crew without the ground.
    const without = drilled(0, sessionRolling(50, true));
    expect(without.logic).toBe(without.plain);
  });
});

describe('Telemetry Hill held whole', () => {
  it('musters Wonders 10% faster and 10% cheaper, and nobody else', () => {
    const { repos, base } = stack();
    const kites = findUnit('kite_crews')!;
    const razors = findUnit('razors')!;
    const before = musterRatesFor(repos, base, NOW);
    for (const location of findDistrict('telemetry-hill')!.locations) {
      take(repos, base.id, location.id);
    }
    const after = musterRatesFor(repos, base, NOW);
    expect(ratesForUnit(after, kites).costPercent - ratesForUnit(before, kites).costPercent).toBe(
      10,
    );
    expect(ratesForUnit(after, kites).speedPercent - ratesForUnit(before, kites).speedPercent).toBe(
      10,
    );
    expect(ratesForUnit(after, razors).speedPercent).toBe(
      ratesForUnit(before, razors).speedPercent,
    );
    expect(ratesForUnit(after, razors).costPercent).toBe(ratesForUnit(before, razors).costPercent);
  });
});
