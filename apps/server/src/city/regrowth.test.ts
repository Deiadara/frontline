/**
 * The regime is rebuilt once a week, on ground nobody took off it.
 *
 * The maintainer's ruling (2026-09-24): *"The army of combine erodes during the week but sunday
 * night at midnight (before monday starts) they are all regenerated on whichever locations a
 * player does not hold. Legendaries regen only if you dont hold their location."*
 *
 * Erosion is `battle/resolve.ts`; this is the other half, and without it the first half turns the
 * city into a resource that runs out. The two properties worth measuring are the ones a clock gets
 * wrong: it must happen **once** per week however many times the tick runs, and it must happen on
 * the first tick **after** the mark rather than only on a tick that lands on it, because a server
 * that was down over midnight on Sunday still owes the world its Monday.
 */
import {
  COMBINE_LEADERS,
  findDistrict,
  findLocation,
  startingGarrison,
  type Army,
} from '@frontline/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { settleGarrisonRegrowth } from './regrowth.js';

let db: AppDatabase;
let repos: Repositories;

/** Monday 00:00 in Athens, which is what "Sunday night at midnight" is as an instant. */
const MARK = new Date('2026-09-20T21:00:00.000Z');
/** An hour before it: still last week. */
const SUNDAY = new Date('2026-09-20T20:00:00.000Z');
/** Monday morning, on the near side of the mark. */
const MONDAY = new Date('2026-09-21T09:00:00.000Z');
/** ...and the week after that, for the server that was switched off over a mark. */
const NEXT_WEEK = new Date('2026-09-30T09:00:00.000Z');

/** A Combine plot with nobody famous on it. */
const DOCKS_PLOT = 'neon-docks-tideline';
/** A looter plot: the regrowth is the regime's and the squatters' alike. */
const UNDERGRID_PLOT = 'undergrid-junction';
const SYNDIC = COMBINE_LEADERS.find((leader) => leader.unitId === 'syndic')!;

function authored(locationId: string): Army {
  const location = findLocation(locationId);
  const district = location ? findDistrict(location.districtId) : undefined;
  if (!location || !district) throw new Error(`fixture error: no ${locationId}`);
  return startingGarrison(location, district);
}

function garrisonAt(locationId: string): Army {
  return repos.city.control(locationId)?.garrison ?? {};
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  repos = createRepositories(db);
  // Every control row as the world boots with it, so what a test writes afterwards is a change
  // rather than a first draft.
  repos.city.controls();
});

afterEach(() => {
  db.close();
});

describe('the weekly regrowth', () => {
  it('puts an eroded garrison back to its authored strength', () => {
    expect(authored(DOCKS_PLOT), 'fixture error: nobody stands here').not.toEqual({});
    repos.city.setGarrison(DOCKS_PLOT, {});
    settleGarrisonRegrowth(repos, MONDAY);
    expect(garrisonAt(DOCKS_PLOT)).toEqual(authored(DOCKS_PLOT));
  });

  it('rebuilds the squatters as well as the regime', () => {
    const before = authored(UNDERGRID_PLOT);
    expect(before, 'fixture error: nobody squats here').not.toEqual({});
    repos.city.setGarrison(UNDERGRID_PLOT, {});
    settleGarrisonRegrowth(repos, MONDAY);
    expect(garrisonAt(UNDERGRID_PLOT)).toEqual(before);
  });

  it('leaves a plot a crew holds alone, because that garrison is theirs', () => {
    const control = repos.city.control(DOCKS_PLOT)!;
    const theirs: Army = { razors: 3 };
    repos.city.put({ ...control, holder: { kind: 'crew', baseId: 'b-holder' }, garrison: theirs });

    settleGarrisonRegrowth(repos, MONDAY);

    const after = repos.city.control(DOCKS_PLOT)!;
    expect(after.holder).toEqual({ kind: 'crew', baseId: 'b-holder' });
    expect(after.garrison).toEqual(theirs);
  });

  it('brings the legendary back onto ground the regime still holds', () => {
    const plot = SYNDIC.locationId;
    // She fell defending her own plot and the attack was turned back: the regime kept the ground
    // and lost her, which is the one way she dies without the plot changing hands.
    const { [SYNDIC.unitId]: _dead, ...rest } = garrisonAt(plot);
    repos.city.setGarrison(plot, rest);
    expect(garrisonAt(plot)[SYNDIC.unitId] ?? 0).toBe(0);

    settleGarrisonRegrowth(repos, MONDAY);

    expect(garrisonAt(plot)[SYNDIC.unitId]).toBe(1);
  });

  it('leaves the legendary dead while a crew holds her plot', () => {
    const plot = SYNDIC.locationId;
    const control = repos.city.control(plot)!;
    repos.city.put({ ...control, holder: { kind: 'crew', baseId: 'b-holder' }, garrison: {} });

    settleGarrisonRegrowth(repos, MONDAY);

    expect(garrisonAt(plot)).toEqual({});
  });

  it('happens once a week, whatever the tick does in between', () => {
    // The first tick of the week claims it, whether or not there was anything to rebuild.
    settleGarrisonRegrowth(repos, MONDAY);
    repos.city.setGarrison(DOCKS_PLOT, {});

    // Every later tick inside the same week is a tick that has already run.
    expect(settleGarrisonRegrowth(repos, new Date(MONDAY.getTime() + 1_000))).toBe(0);
    expect(settleGarrisonRegrowth(repos, new Date('2026-09-26T23:00:00.000Z'))).toBe(0);
    expect(garrisonAt(DOCKS_PLOT)).toEqual({});

    // ...and the next week's mark is a different week.
    expect(settleGarrisonRegrowth(repos, new Date('2026-09-28T09:00:00.000Z'))).toBeGreaterThan(0);
    expect(garrisonAt(DOCKS_PLOT)).toEqual(authored(DOCKS_PLOT));
  });

  it('does not grow anything back before the mark', () => {
    settleGarrisonRegrowth(repos, new Date('2026-09-15T09:00:00.000Z'));
    repos.city.setGarrison(DOCKS_PLOT, {});

    // 23:00 on the Sunday in Athens: the week has an hour left to run.
    expect(settleGarrisonRegrowth(repos, SUNDAY)).toBe(0);
    expect(garrisonAt(DOCKS_PLOT)).toEqual({});

    // The mark itself is inside the new week, so the tick that lands on it is the one that runs.
    expect(settleGarrisonRegrowth(repos, MARK)).toBeGreaterThan(0);
    expect(garrisonAt(DOCKS_PLOT)).toEqual(authored(DOCKS_PLOT));
  });

  it('runs on the first tick after a server was down over the mark', () => {
    settleGarrisonRegrowth(repos, new Date('2026-09-15T09:00:00.000Z'));
    repos.city.setGarrison(DOCKS_PLOT, {});

    // Nothing ticks for a fortnight. The world still owes the regime both Mondays, and pays it
    // once: the mark is a week, not an alarm that has to be heard when it goes off.
    expect(settleGarrisonRegrowth(repos, NEXT_WEEK)).toBeGreaterThan(0);
    expect(garrisonAt(DOCKS_PLOT)).toEqual(authored(DOCKS_PLOT));
    expect(settleGarrisonRegrowth(repos, new Date(NEXT_WEEK.getTime() + 1_000))).toBe(0);
  });

  it('counts only the plots it actually changed', () => {
    repos.city.setGarrison(DOCKS_PLOT, {});
    repos.city.setGarrison(UNDERGRID_PLOT, {});
    expect(settleGarrisonRegrowth(repos, MONDAY)).toBe(2);
  });
});
