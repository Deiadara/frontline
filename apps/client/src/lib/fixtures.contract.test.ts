import { describe, expect, it } from 'vitest';
import * as S from '@frontline/shared';
import * as F from '../../e2e/fixtures';

/**
 * Every e2e fixture, checked against the schema of the response it stands in for.
 *
 * The whole visual and layout suite runs against these objects rather than against the server, so
 * **the fixture is the contract**. A field the server started sending, a shape that changed, a
 * required key added to a schema: none of it reaches the e2e suite, because the e2e suite is
 * looking at this file. The screens stay green while the real client breaks against the real
 * server, which is the worst failure a mocked suite has, since it is silent.
 *
 * The tail of this file is the other half: shape is not coverage. A fixture can satisfy every
 * schema in the package and still describe a game with none of the current content in it.
 */
describe('the e2e fixtures still describe what the server sends', () => {
  const PAIRS: readonly [string, unknown, { safeParse: (v: unknown) => { success: boolean } }][] = [
    ['me', F.me, S.MeResponseSchema],
    ['meNoOverseer', F.meNoOverseer, S.MeResponseSchema],
    ['lateGame', F.lateGame, S.MeResponseSchema],
    ['notorious', F.notorious, S.MeResponseSchema],
    ['adminGame', F.adminGame, S.MeResponseSchema],
    ['paidMe', F.paidMe, S.MeResponseSchema],
    ['city', F.city, S.CityResponseSchema],
    ['baseDetail', F.baseDetail, S.BaseDetailResponseSchema],
    ['districtDetail', F.districtDetail, S.DistrictDetailResponseSchema],
    ['unitsResponse', F.unitsResponse, S.UnitsResponseSchema],
    ['battle', F.battle, S.BattleResponseSchema],
    ['createOverseerResponse', F.createOverseerResponse, S.CreateOverseerResponseSchema],
    ['authResponse', F.authResponse, S.AuthResponseSchema],
    ['bar', F.bar, S.BarResponseSchema],
    ['research', F.research, S.ResearchResponseSchema],
    ['crewStart', F.crewStart, S.CrewResponseSchema],
    ['crewFat', F.crewFat, S.CrewResponseSchema],
    ['trainingResponse', F.trainingResponse, S.TrainingResponseSchema],
    ['crewStanding', F.crewStanding, S.CrewStandingResponseSchema],
    ['market', F.market, S.MarketResponseSchema],
    ['workshop', F.workshop, S.WorkshopResponseSchema],
    ['blackMarket', F.blackMarket, S.BlackMarketResponseSchema],
    ['blackMarketSpent', F.blackMarketSpent, S.BlackMarketResponseSchema],
    ['settings', F.settings, S.SettingsResponseSchema],
    ['battles', F.battles, S.BattlesResponseSchema],
    ['actionsResponse', F.actionsResponse, S.ActionsResponseSchema],
  ];

  it('covers a fixture for most of the response schemas in the package', () => {
    // Guards the guard: a renamed export would silently shrink this list to nothing.
    expect(PAIRS.length).toBeGreaterThanOrEqual(20);
    for (const [name, , schema] of PAIRS) expect(schema, name).toBeDefined();
  });

  it.each(PAIRS.map(([name, value, schema]) => [name, value, schema] as const))(
    '%s parses as its own response schema',
    (_name, value, schema) => {
      expect(schema.safeParse(value).success).toBe(true);
    },
  );

  /**
   * Shape is not coverage.
   *
   * The roster fixture is what every screen in the visual suite reads, so a unit missing from it is
   * a unit no gate has ever drawn. This is the check that would have caught the roster fixture
   * being three units behind the catalogue.
   */
  it('offers every unit in the catalogue on the roster fixture', () => {
    const offered = new Set(F.unitsResponse.units.map((unit) => unit.id));
    const missing = S.UNIT_CATALOG.filter((unit) => !offered.has(unit.id)).map((unit) => unit.id);
    expect(missing, 'units in the catalogue that no e2e screen has ever drawn').toEqual([]);
  });

  it('names every district in the city fixture', () => {
    const seen = new Set(F.city.districts.map((district) => district.district.id));
    const missing = S.CITY_DISTRICTS.filter((d) => !seen.has(d.id)).map((d) => d.id);
    expect(missing, 'districts the city fixture never shows').toEqual([]);
  });
});
