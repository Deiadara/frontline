import { type CityResponse, type DistrictDetailResponse } from '@frontline/shared';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { battles, city, districtDetailFor, lateGame, me } from './fixtures';
import { expectNothingClippedHorizontally, installApi, settleFonts } from './harness';

/**
 * The Combine's and the looters' marks, everywhere either party is named as holding ground or
 * fighting (maintainer, 2026-09-30): the city map's tags, a district's leader tag and Garrison row,
 * the holder plate in a location window and a sign's hover card, the Battles board, a battle
 * report and a spy report. The landing screen's promise is in `auth-pitch.spec.ts`.
 *
 * Each placement is screenshotted at 1024 and 1280, and measured: a mark is small, sits inside the
 * box it was put in, and does not make that box any taller than its neighbours.
 */
const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
] as const;

/** Whole districts held by one party, so the map has both marks to draw. */
const HELD: Readonly<Record<string, 'government' | 'looters'>> = {
  ccs: 'government',
  blacksite: 'government',
  annexes: 'government',
  undergrid: 'looters',
};

async function cityWithHolders(page: Page): Promise<void> {
  const held: CityResponse = {
    ...city,
    districts: city.districts.map((row) => {
      const kind = HELD[row.district.id];
      // `wholeBy` as well as the holder (maintainer, 2026-10-07): a tag wears a party's mark only
      // where that party holds every plot in the district, and the looters and the Combine are
      // both "enemy" from the viewer's side of the table. The holder alone used to draw the mark,
      // which is why this fixture carried only half of what the map now reads.
      return kind === undefined ? row : { ...row, holder: { kind }, wholeBy: 'enemy' as const };
    }),
  };
  await page.route('**/api/city', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(held) }),
  );
}

/** The Annexes with the Combine back on two of its plots, so its window has both parties in it. */
async function annexesWithTheCombine(page: Page): Promise<DistrictDetailResponse> {
  const detail = districtDetailFor('annexes');
  const locations = detail.locations.map((view, index) =>
    index === 1 || index === 3
      ? { ...view, holder: { kind: 'government' as const }, holderName: 'The Combine' }
      : view,
  );
  const answer = { ...detail, locations };
  await page.route('**/api/city/annexes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }),
  );
  return answer;
}

/** A mark is inside `box`, no taller than 20px, and square. */
async function expectMarkInside(mark: Locator, box: Locator): Promise<void> {
  await expect(mark).toBeVisible();
  const inner = await mark.boundingBox();
  const outer = await box.boundingBox();
  if (!inner || !outer) throw new Error('no box to measure');
  expect(inner.height).toBeLessThanOrEqual(20);
  expect(Math.abs(inner.width - inner.height)).toBeLessThanOrEqual(0.5);
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
}

for (const viewport of VIEWPORTS) {
  test.describe(`the insignia at ${viewport.width}`, () => {
    test.use({ viewport });

    test('on the city map, beside the name of ground one party holds whole', async ({ page }) => {
      await installApi(page, me);
      await cityWithHolders(page);
      await page.goto('/game');
      await expect(page.getByTestId('city-room')).toBeVisible();
      await settleFonts(page);

      for (const [id, kind] of Object.entries(HELD)) {
        const tag = page.getByTestId(`district-tag-${id}`);
        await expectMarkInside(tag.getByTestId(`insignia-${kind}`), tag);
      }
      // Split ground and a crew's home carry no mark.
      await expect(
        page.getByTestId('district-tag-chrome-row').locator('[data-testid^="insignia-"]'),
      ).toHaveCount(0);
      await expect(
        page.getByTestId('district-tag-kettle-row').locator('[data-testid^="insignia-"]'),
      ).toHaveCount(0);

      // A mark does not make its tag any taller than a tag without one.
      const marked = await page.getByTestId('district-tag-ccs').boundingBox();
      const plain = await page.getByTestId('district-tag-chrome-row').boundingBox();
      expect(marked?.height).toBeCloseTo(plain?.height ?? 0, 0);

      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/insignia/city-map-${viewport.width}.png` });
    });

    test('in a district: the leader tag, the Garrison row, the holder plate and the sign card', async ({
      page,
    }) => {
      await installApi(page, me);
      await annexesWithTheCombine(page);
      await page.goto('/game/city/annexes');
      await settleFonts(page);

      // The district header: "Under the Syndic" wears the regime's mark.
      const leader = page.getByTestId('combine-leader');
      await expectMarkInside(leader.getByTestId('insignia-government'), leader);
      // The district screen never says how hard the ground is (maintainer, 2026-09-30).
      await expect(page.getByText(/difficulty/i)).toHaveCount(0);

      // The Garrison row names both parties and draws both marks.
      await page.getByTestId('district-standing-toggle').click();
      const row = page.getByTestId('hold-insignia');
      await expect(row.getByTestId('insignia-government')).toBeVisible();
      await expect(row.getByTestId('insignia-looters')).toBeVisible();
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/insignia/district-header-${viewport.width}.png` });
      await page.getByTestId('district-standing-toggle').click();

      // The sign's hover card: "Held by" and the mark beside the name.
      const detail = districtDetailFor('annexes');
      const looterPlot = detail.locations[4];
      if (!looterPlot) throw new Error('fixture error: the Annexes have too few locations');
      await page.getByTestId(`site-${looterPlot.location.id}`).hover();
      const card = page.getByRole('tooltip').filter({ hasText: 'Held by' });
      await expect(card).toBeVisible();
      await expectMarkInside(card.getByTestId('insignia-looters'), card);
      await page.screenshot({ path: `screenshots/insignia/sign-card-${viewport.width}.png` });

      // The location window's holder plate, on a plot the Combine holds.
      const combinePlot = detail.locations[1];
      if (!combinePlot) throw new Error('fixture error: the Annexes have too few locations');
      await page.mouse.move(0, 0);
      await page.getByTestId(`site-${combinePlot.location.id}`).click();
      const plate = page.getByTestId(`holder-${combinePlot.location.id}`);
      await expect(page.getByTestId('location-window')).toBeVisible();
      await expectMarkInside(plate.getByTestId('insignia-government'), plate);
      await page.screenshot({ path: `screenshots/insignia/holder-plate-${viewport.width}.png` });
    });

    test('on the Battles board, in a battle report and in a spy report', async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/battles');
      await settleFonts(page);

      // The rail row and the open fight's "Against" figure, for a fight on the looters' ground.
      const press = battles.coming[0];
      if (!press || press.battle.defender.kind !== 'looters') {
        throw new Error('fixture error: the first coming fight is not against the looters');
      }
      const row = page.getByTestId(`battle-${press.battle.id}`);
      await expectMarkInside(row.getByTestId('insignia-looters'), row);
      const detail = page.getByTestId(`battle-detail-${press.battle.id}`);
      await expect(detail.getByTestId('insignia-looters')).toBeVisible();
      // A fight the crew is defending is against a crew, which has no mark.
      const bonefield = battles.coming[1];
      if (!bonefield) throw new Error('fixture error: no second fight');
      await expect(
        page.getByTestId(`battle-${bonefield.battle.id}`).locator('[data-testid^="insignia-"]'),
      ).toHaveCount(0);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/insignia/battles-${viewport.width}.png` });

      // The reports list, and the looters' side of a report.
      await page.getByTestId('battles-tab-reports').click();
      await expect(page.getByTestId('read-fight-3').getByTestId('insignia-looters')).toBeVisible();
      await expect(
        page.getByTestId('read-fight-4').getByTestId('insignia-government'),
      ).toBeVisible();
      await page.screenshot({ path: `screenshots/insignia/battle-reports-${viewport.width}.png` });
      await page.getByTestId('read-fight-3').click();
      const theirs = page.getByTestId('report-side-theirs');
      await expectMarkInside(theirs.getByTestId('insignia-looters'), theirs);
      await expect(
        page.getByTestId('report-side-mine').locator('[data-testid^="insignia-"]'),
      ).toHaveCount(0);
      await page.screenshot({ path: `screenshots/insignia/battle-report-${viewport.width}.png` });
      await page.keyboard.press('Escape');

      // The spy reports list, and the head of a report on the Combine's gate.
      await page.getByTestId('battles-tab-spies').click();
      await expect(
        page.getByTestId('read-spy-spy-report-2').getByTestId('insignia-government'),
      ).toBeVisible();
      await expect(
        page.getByTestId('read-spy-spy-report-3').getByTestId('insignia-looters'),
      ).toBeVisible();
      await page.screenshot({ path: `screenshots/insignia/spy-reports-${viewport.width}.png` });
      await page.getByTestId('read-spy-spy-report-2').click();
      const head = page.getByTestId('spy-report-head');
      await expectMarkInside(head.getByTestId('insignia-government'), head);
      await page.screenshot({ path: `screenshots/insignia/spy-report-${viewport.width}.png` });
    });
  });
}
