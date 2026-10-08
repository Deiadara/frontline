import {
  CHAIR_PASSIVE_CAP,
  TRAP_CATALOG,
  brokerRate,
  scrapyardPrice,
  supplyMarkup,
  supplyPrice,
  TRADER_EVEN_POINTS,
  baseUnitSlotBeds,
  buildingCost,
  buildingLevel,
  cancelRefund,
  chairPassiveOf,
  createCommander,
  findLocation,
  makeAttributes,
  markFromPoints,
  salvageRefundCut,
  musterCost,
  findUnit,
  RESEARCH_ITEMS,
  officerBattleStats,
  officerSheetBonusFor,
  roadMinutes,
  upgradeCost,
  type Base,
  type Commander,
  type OfficerMark,
  type OfficerRole,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { ledgerFor } from '../bar/hire.js';
import { cancelUpgrade, startUpgrade } from '../city/upgrade.js';
import { buildQuotesFor } from '../district/build.js';
import { districtUnitSlots } from '../district/unit-slots.js';
import { professorXpPercent } from '../progression/award.js';
import { musterRatesFor } from '../units/muster.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import {
  crewEffectsFor,
  liftedOfficerSheet,
  officerFitReader,
  officerLiftRoom,
  standingEffectsFor,
} from './standing.js';
import { minutesFor, researchHead } from '../research/tracks.js';
import { refundFor } from '../battle/resolve.js';
import { moveMinutes } from '../moves/moves.js';
import { projectScrapyard } from '../district/scrapyard.js';
import { barter, buySupply } from '../market/board.js';

/**
 * Every chair's passive on the server path that spends it (maintainer, 2026-10-04).
 *
 * `passives.test.ts` in shared holds the line itself. This holds the other half: that the seat's
 * points the fold reads reach the consumer and come out as the line says, at four grades, and that
 * nothing reaches it from an empty, injured or wrong chair. The expected figures are computed here
 * from the maintainer's words (nothing at 10 points, the cap at 100) rather than from
 * `chairPassivePercent`, so a change to the line under the consumer shows here.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

let accounts = 0;

async function crewWith(officers: Commander[]): Promise<{ app: FastifyInstance; base: Base }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  accounts += 1;
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: `chair_line_${accounts}`, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  // One character for every run (bug pass, 2026-10-05): which of the thirty an account is offered
  // is a hash of its id, and the Overseer's grade lifts every chair, so an unpinned crew moved the
  // C+ Trader into B- on some runs and not others.
  pinOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const fresh = app.repos.bases.findById(baseId)!;
  // Only the officers under test sit in a chair, so no starting hand moves a figure.
  app.repos.bases.updateCommanders(baseId, [
    ...fresh.commanders.map((one) => ({ ...one, role: null })),
    ...officers,
  ]);
  return { app, base: app.repos.bases.findById(baseId)! };
}

/** The maintainer's line, written out again: nothing at 10 points, the whole cap at 100. */
function expectedPercent(cap: number, points: number): number {
  return (Math.max(0, Math.min(100, points) - 10) / 90) * cap;
}

/**
 * Uniform sheets that land in the four grades the bug pass asks about, once the Overseer's own lift
 * is on them. The grade is asserted, so a retuned lift that moves one shows here first.
 */
const GRADES: readonly { sheet: number; mark: OfficerMark }[] = [
  { sheet: 0, mark: 'F-' },
  { sheet: 54, mark: 'C+' },
  { sheet: 76, mark: 'A' },
  { sheet: 100, mark: 'S+' },
];

const seated = (role: OfficerRole, sheet: number, extra: Partial<Commander> = {}): Commander => ({
  ...createCommander(`${role}-${sheet}`, `${role} ${sheet}`, role, makeAttributes(sheet)),
  ...extra,
});

/** The seat's points the fold pays the chair on, asserted into the grade it was picked for. */
async function crewAtGrade(
  role: OfficerRole,
  grade: (typeof GRADES)[number],
): Promise<{ app: FastifyInstance; base: Base; points: number }> {
  const { app, base } = await crewWith([seated(role, grade.sheet)]);
  const points = crewEffectsFor(app.repos, base).chairPoints[role];
  expect(points, `${role} at ${grade.mark}`).toBeTypeOf('number');
  expect(markFromPoints(points!), `${role} at ${grade.mark}`).toBe(grade.mark);
  return { app, base, points: points! };
}

describe('each chair, from its seat points to where it is spent', () => {
  for (const grade of GRADES) {
    describe(`at ${grade.mark}`, () => {
      it('Fixer: grows the whole payroll book by the line', async () => {
        const { app, base, points } = await crewAtGrade('fixer', grade);
        const effects = crewEffectsFor(app.repos, base);
        const book = ledgerFor(base, { ...effects, chairPoints: {} }).capacity;
        expect(ledgerFor(base, effects).capacity).toBe(
          Math.round(book * (1 + expectedPercent(50, points) / 100)),
        );
      });

      it('Steward: adds the line as a share of the base beds, the ground flat slots included', async () => {
        const { app, base, points } = await crewAtGrade('steward', grade);
        const standing = standingEffectsFor(app.repos, base);
        const without = districtUnitSlots(app.repos, { ...base, commanders: [] }).capacity;
        const beds = baseUnitSlotBeds(base.buildings) + Math.max(0, standing.unitSlotBonus);
        expect(districtUnitSlots(app.repos, base).capacity - without).toBe(
          Math.floor((beds * expectedPercent(50, points)) / 100),
        );
      });

      it('Engineer: takes the line off what the build taper left', async () => {
        const { app, base, points } = await crewAtGrade('engineer', grade);
        const effects = standingEffectsFor(app.repos, base);
        const quotes = buildQuotesFor(app.repos, base);
        const kind = 'quarters' as const;
        const level = buildingLevel(base.buildings, kind) + 1;
        const crewPoints = effects.buildCostPercent + (effects.buildingCostPercent[kind] ?? 0);
        const plain = buildingCost(kind, level, base.buildings, crewPoints);
        const engineered = buildingCost(
          kind,
          level,
          base.buildings,
          crewPoints,
          expectedPercent(50, points),
        );
        expect(quotes[kind]).toEqual(engineered);
        if (grade.mark === 'F-') expect(quotes[kind]).toEqual(plain);
        else expect(quotes[kind]).not.toEqual(plain);
      });

      it('Engineer: takes the line off a held location', async () => {
        const { app, base, points } = await crewAtGrade('engineer', grade);
        const id = 'steelbelt-bonefield';
        const location = findLocation(id)!;
        const control = app.repos.city.control(id)!;
        app.repos.city.put({ ...control, holder: { kind: 'crew', baseId: base.id }, garrison: {} });
        app.repos.bases.updateResources(base.id, {
          ...base.resources,
          planks: 1e6,
          scrap: 1e6,
          highQualityMetal: 1e6,
          caps: 1e6,
          oil: 1e6,
          supplies: 1e6,
        });
        const rich = app.repos.bases.findById(base.id)!;
        const started = startUpgrade(app.repos, {
          base: rich,
          location,
          control: app.repos.city.control(id)!,
          now: new Date(),
        });
        expect(started.kind).toBe('started');
        if (started.kind !== 'started') return;
        expect(started.control.upgradePaid).toEqual(
          upgradeCost(location.kind, control.level, expectedPercent(50, points)),
        );

        // A row from before the price was kept refunds off the same cut, not the full price
        // (bug pass, 2026-10-06).
        app.repos.city.put({ ...started.control, upgradePaid: null });
        const cancelled = cancelUpgrade(app.repos, {
          base: app.repos.bases.findById(base.id)!,
          location,
          control: app.repos.city.control(id)!,
          now: new Date(),
          acceptWaste: true,
        });
        expect(cancelled.kind).toBe('cancelled');
        if (cancelled.kind !== 'cancelled') return;
        expect(cancelled.refund).toEqual(
          cancelRefund(upgradeCost(location.kind, control.level, expectedPercent(50, points))!),
        );
      });

      it('Veteran: hands the muster bill the line', async () => {
        const { app, base, points } = await crewAtGrade('veteran', grade);
        expect(musterRatesFor(app.repos, base).veteranPercent).toBeCloseTo(
          expectedPercent(50, points),
          9,
        );
      });

      it('Professor: adds the line to mission XP', async () => {
        const { app, base, points } = await crewAtGrade('professor', grade);
        expect(professorXpPercent(app.repos, base)).toBeCloseTo(expectedPercent(50, points), 9);
      });

      it('Cartographer: cuts the line off a road before the pace divides it', async () => {
        const { app, base, points } = await crewAtGrade('cartographer', grade);
        const cut = chairPassiveOf(
          standingEffectsFor(app.repos, base),
          'cartographer',
          'travel_time',
        );
        expect(cut).toBeCloseTo(expectedPercent(50, points), 9);
        // An hour's road at pace 50 and 20% off: the base is shortened first, then divided.
        const road = 60 * (1 - expectedPercent(50, points) / 100);
        expect(roadMinutes(60, 50, 20, cut)).toBe(Math.round((road / 1.5) * 0.8));
      });

      it('Field Commander: hands the fight settle the line', async () => {
        const { app, base, points } = await crewAtGrade('field_commander', grade);
        const standing = standingEffectsFor(app.repos, base);
        expect(chairPassiveOf(standing, 'field_commander', 'battle_infamy')).toBeCloseTo(
          expectedPercent(100, points),
          9,
        );
      });

      it('Researcher: publishes the line as the cut off every research clock', async () => {
        const { app, base, points } = await crewAtGrade('researcher', grade);
        const head = researchHead(app.repos, base, officerFitReader(app.repos, base));
        expect(head?.timeCutPercent).toBe(Math.round(expectedPercent(50, points) * 10) / 10);
      });

      it('Salvager: takes the line off the scrap and HQ metal of a yard bill, and nothing else', async () => {
        const { app, base, points } = await crewAtGrade('salvager', grade);
        const yard = projectScrapyard(app.repos, base);
        const cut = expectedPercent(50, points);
        expect(yard.salvagerCutPercent).toBe(Math.round(cut * 10) / 10);
        const trap = TRAP_CATALOG.find((spec) => spec.cost.scrap !== undefined)!;
        const row = yard.entries.find((entry) => entry.id === trap.id)!;
        expect(row.cost).toEqual(scrapyardPrice(trap.cost, yard.scrapyardLevel, cut));
        // The lines the Salvager does not touch stay at the yard's own price.
        const plain = scrapyardPrice(trap.cost, yard.scrapyardLevel, 0);
        for (const key of ['caps', 'planks', 'oil', 'supplies'] as const) {
          expect(row.cost[key], key).toBe(plain[key]);
        }
      });

      it('Trader: moves the broker and the supply run by the line', async () => {
        const { app, base, points } = await crewAtGrade('trader', grade);
        const discount = standingEffectsFor(app.repos, base).marketDiscountPercent;
        const plainMarkup = supplyMarkup(discount, null);
        const plainWorth = brokerRate(base.level, discount, null);
        const even = TRADER_EVEN_POINTS;
        // The maintainer's words: the market's own rates at F-, even at C+, 25% over at S+.
        const along = points <= even ? (points - 10) / (even - 10) : (points - even) / (100 - even);
        const worth = points <= even ? plainWorth + (1 - plainWorth) * along : 1 + 0.25 * along;
        const markup =
          points <= even ? plainMarkup + (1 - plainMarkup) * along : 1 / (1 + 0.25 * along);
        expect(brokerRate(base.level, discount, points)).toBeCloseTo(
          Math.max(plainWorth, worth),
          6,
        );
        expect(supplyMarkup(discount, points)).toBeCloseTo(Math.min(plainMarkup, markup), 6);
        // And the till reads the same seat: ten metal off the supply run.
        app.repos.bases.updateResources(base.id, { ...base.resources, caps: 100_000 });
        const before = app.repos.bases.findById(base.id)!;
        const bought = buySupply(app.repos, before, 'scrap', 10, new Date(), true);
        expect(bought.kind).toBe('done');
        if (bought.kind !== 'done') return;
        expect(before.resources.caps - bought.base.resources.caps).toBe(
          supplyPrice('scrap', 10, discount, points),
        );
      });

      it('Raid Boss: multiplies his own damage and vitality, and nobody else', async () => {
        const { app, base, points } = await crewAtGrade('raid_boss', grade);
        const effects = standingEffectsFor(app.repos, base);
        const times = 1 + expectedPercent(400, points) / 100;
        const own = officerSheetBonusFor(effects, 'raid_boss', 'battle');
        expect(own.offenseTimes).toBeCloseTo(times, 9);
        expect(own.vitalityTimes).toBeCloseTo(times, 9);
        // The same fold, read for a different chair, carries none of it.
        const other = officerSheetBonusFor(effects, 'field_commander', 'battle');
        expect([other.offenseTimes, other.vitalityTimes]).toEqual([1, 1]);
        const sheet = makeAttributes(50);
        expect(officerBattleStats(sheet, own).vitality).toBe(
          Math.max(1, Math.round(officerBattleStats(sheet).vitality * times)),
        );
      });
    });
  }
});

describe('what the line is never paid from', () => {
  const hourAgo = (): string => new Date(Date.now() - 3_600_000).toISOString();
  const tomorrow = (): string => new Date(Date.now() + 24 * 3_600_000).toISOString();

  it('pays nothing from a chair taken in the last few hours, an injured officer or the bench', async () => {
    for (const extra of [{ seatedAt: hourAgo() }, { injuredUntil: tomorrow() }, { role: null }]) {
      const { app, base } = await crewWith(
        (
          [
            'fixer',
            'steward',
            'engineer',
            'veteran',
            'professor',
            'cartographer',
            'field_commander',
            'raid_boss',
            'trader',
          ] as const
        ).map((role) => seated(role, 100, extra)),
      );
      const effects = standingEffectsFor(app.repos, base);
      expect(effects.chairPoints, JSON.stringify(extra)).toEqual({});
      expect(musterRatesFor(app.repos, base).veteranPercent).toBe(0);
      expect(professorXpPercent(app.repos, base)).toBe(0);
      expect(ledgerFor(base, effects).capacity).toBe(
        ledgerFor(base, { ...effects, chairPoints: {} }).capacity,
      );
    }
  });

  it('reads each passive off its own chair only', async () => {
    // A perfect sheet in every chair but the one each consumer reads: nothing moves.
    const { app, base } = await crewWith([
      seated('trader', 100),
      seated('right_hand', 100),
      seated('master_of_whispers', 100),
    ]);
    const effects = standingEffectsFor(app.repos, base);
    for (const [role, passive] of [
      ['fixer', 'payroll'],
      ['steward', 'unit_slots'],
      ['engineer', 'building_cost'],
      ['veteran', 'muster_cost'],
      ['professor', 'mission_xp'],
      ['cartographer', 'travel_time'],
      ['field_commander', 'battle_infamy'],
    ] as const) {
      expect(chairPassiveOf(effects, role, passive), role).toBe(0);
    }
    expect(officerSheetBonusFor(effects, 'raid_boss', 'battle').offenseTimes).toBe(1);
  });

  it('lets a perfect Trader profit only inside the supply run ration', async () => {
    const { app, base } = await crewWith([seated('trader', 100)]);
    const now = new Date();
    app.repos.bases.updateResources(base.id, { ...base.resources, caps: 10_000 });
    let held = app.repos.bases.findById(base.id)!;
    // Caps in, goods, caps out: never ahead, at any size.
    for (const want of ['scrap', 'planks', 'oil', 'supplies', 'highQualityMetal'] as const) {
      for (const amount of [7, 13, 100, 999]) {
        const start = held.resources.caps;
        const bought = barter(
          app.repos,
          held,
          { give: 'caps', want, amount, acceptWaste: true },
          1,
          now,
        );
        if (bought.kind !== 'done') continue;
        const got = bought.base.resources[want] - held.resources[want];
        const sold = barter(
          app.repos,
          bought.base,
          { give: want, want: 'caps', amount: got, acceptWaste: true },
          1,
          now,
        );
        held = sold.kind === 'done' ? sold.base : bought.base;
        expect(held.resources.caps, `${want} x${amount}`).toBeLessThanOrEqual(start);
      }
    }
    // The supply run and the broker: ahead on every lap, and stopped by the day's ration.
    let laps = 0;
    for (; laps < 1000; laps += 1) {
      const bought = buySupply(app.repos, held, 'scrap', 10, now, true);
      if (bought.kind !== 'done') {
        expect(bought.reason).toBe('over_allowance');
        break;
      }
      const sold = barter(
        app.repos,
        bought.base,
        { give: 'scrap', want: 'caps', amount: 10, acceptWaste: true },
        1,
        now,
      );
      expect(sold.kind).toBe('done');
      if (sold.kind === 'done') held = sold.base;
    }
    expect(laps).toBeGreaterThan(0);
    expect(laps).toBeLessThan(1000);
  });

  it('never runs past its cap, below zero, or to NaN on a sheet outside the scale', () => {
    for (const [passive, cap] of Object.entries(CHAIR_PASSIVE_CAP)) {
      const name = passive as keyof typeof CHAIR_PASSIVE_CAP;
      for (const points of [-50, 0, 10, 100, 100.00000000000003, 1e9]) {
        const percent = chairPassiveOf({ chairPoints: { fixer: points } }, 'fixer', name);
        expect(percent, `${passive} at ${points}`).toBeGreaterThanOrEqual(0);
        expect(percent, `${passive} at ${points}`).toBeLessThanOrEqual(cap);
      }
      expect(chairPassiveOf({ chairPoints: {} }, 'fixer', name)).toBe(0);
    }
  });
});

/**
 * Bug pass, 2026-10-05: the fixes this file's own sweep turned up, each pinned where it is spent.
 */
describe('what the first pass of the definitive bug pass fixed', () => {
  const hoursAgo = (hours: number): string =>
    new Date(Date.now() - hours * 3_600_000).toISOString();

  it('gives the Researcher no speed until they have settled in, and the gate at once', async () => {
    const rung = RESEARCH_ITEMS[0]!;
    const empty = await crewWith([]);
    const emptyMinutes = minutesFor(
      empty.app.repos,
      empty.base,
      rung,
      officerFitReader(empty.app.repos, empty.base),
    );
    const fresh = await crewWith([seated('researcher', 100, { seatedAt: hoursAgo(1) })]);
    const fit = officerFitReader(fresh.app.repos, fresh.base);
    expect(minutesFor(fresh.app.repos, fresh.base, rung, fit)).toBe(emptyMinutes);
    const head = researchHead(fresh.app.repos, fresh.base, fit);
    expect(head?.mark).toBe('S+');
    expect(head?.timeCutPercent).toBe(0);
    const settled = await crewWith([seated('researcher', 100, { seatedAt: hoursAgo(7) })]);
    const settledFit = officerFitReader(settled.app.repos, settled.base);
    expect(minutesFor(settled.app.repos, settled.base, rung, settledFit)).toBeLessThan(
      emptyMinutes,
    );
  });

  it('gives the Salvager no cut until they have settled in', async () => {
    const fresh = await crewWith([seated('salvager', 100, { seatedAt: hoursAgo(1) })]);
    expect(projectScrapyard(fresh.app.repos, fresh.base).salvagerCutPercent).toBe(0);
    const settled = await crewWith([seated('salvager', 100, { seatedAt: hoursAgo(7) })]);
    expect(projectScrapyard(settled.app.repos, settled.base).salvagerCutPercent).toBe(50);
  });

  it("gives an injured officer none of the Overseer's grade, as it gives them no lesson", async () => {
    const hurt = seated('engineer', 40, {
      injuredUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const { app, base } = await crewWith([hurt]);
    const { lift } = liftedOfficerSheet(hurt, officerLiftRoom(app.repos, base));
    expect(lift.filter((line) => line.from.endsWith("'s grade"))).toEqual([]);
    const fit = seated('engineer', 40);
    const healthy = await crewWith([fit]);
    const lifted = liftedOfficerSheet(fit, officerLiftRoom(healthy.app.repos, healthy.base));
    expect(lifted.lift.some((line) => line.from.endsWith("'s grade"))).toBe(true);
  });

  it('refunds a dead unit off what it cost this crew, so a Veteran cannot turn losses into caps', () => {
    const unit = findUnit('wardens')!;
    const perfectVeteran = {
      costPercent: 0,
      suppliesPercent: 0,
      veteranPercent: 50,
      speedPercent: 0,
      locationLevels: new Map(),
      costPercentByTier: {},
    };
    const paid = musterCost(unit, 10, 0, 0, 50).caps ?? 0;
    expect(paid).toBeLessThan((unit.cost.caps ?? 0) * 10);
    // At the deepest salvage stack the catalogue price used to refund 89% of 1,300 against 650 paid.
    // Off what was paid, and through the salvage curve (2026-10-05): 89 points pay about 77%.
    expect(refundFor({ wardens: 10 }, 89, perfectVeteran).caps).toBe(
      Math.floor((paid * salvageRefundCut(89)) / 100),
    );
    expect(salvageRefundCut(89)).toBeCloseTo(77.1, 1);
    // However deep the sources stack, a refund never reaches what was spent.
    expect(refundFor({ wardens: 10 }, 155, perfectVeteran).caps).toBeLessThan(paid);
    expect(refundFor({ wardens: 10 }, 0, perfectVeteran)).toEqual({});
  });

  it('reads the Professor at the instant it is asked about, not the wall clock', async () => {
    const { app, base } = await crewWith([seated('professor', 100, { seatedAt: hoursAgo(1) })]);
    expect(professorXpPercent(app.repos, base)).toBe(0);
    const later = new Date(Date.now() + 6 * 3_600_000);
    expect(professorXpPercent(app.repos, base, later)).toBe(50);
  });
});

/** Maintainer, 2026-10-05: the Steward's base is the buildings' beds and the ground's slots only. */
describe("the Steward's base", () => {
  it('leaves research flat slots unmultiplied: Open Intake adds its twenty, not thirty', async () => {
    const steward = seated('steward', 100);
    const { app, base } = await crewWith([steward]);
    const before = districtUnitSlots(app.repos, base).capacity;
    app.repos.bases.updateResearch(base.id, {
      ...base.research,
      technologies: [...base.research.technologies, 'tech_open_intake'],
    });
    const after = districtUnitSlots(app.repos, app.repos.bases.findById(base.id)!).capacity;
    expect(after - before).toBe(20);
  });
});

/** Maintainer, 2026-10-05: the Cartographer shortens roads, not the wait at a gate. */
describe('the Cartographer and the gate leg', () => {
  it('leaves a move between the district and its gate at the same clock', async () => {
    const riding = { army: { razors: 2 }, vehicles: {} };
    const plain = await crewWith([]);
    const mapped = await crewWith([seated('cartographer', 100)]);
    const legOf = (world: { app: FastifyInstance; base: Base }) =>
      moveMinutes(world.app.repos, world.base, { kind: 'district' }, { kind: 'gate' }, riding);
    expect(legOf(mapped)).toBe(legOf(plain));
  });
});
