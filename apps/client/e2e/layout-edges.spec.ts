import { expect, test, type Page } from '@playwright/test';
import {
  expectNothingClippedHorizontally,
  expectNothingOverflowsTheScreen,
  installApi,
  settleFonts,
} from './harness';
import { adminGame, bar, blackMarket, featsMe, fullQueue, lateGame, market, me } from './fixtures';

/**
 * Three layouts that only change at the edge that needed them (maintainer, 2026-09-29).
 *
 * "Make sure the normal screens we test now are not changed or affected at all." Each case below
 * pins both halves: the edge gets its fix, and a frame just outside it is drawn as it was. The
 * screenshots of the ordinary frames are compared pixel for pixel against a run from before the
 * change, which is where "not at all" is actually measured; these are what keep it true.
 */

// --- the bottom bar ---

/** The row, as the bar draws it: which links sit on which line, and any label wider than its door. */
async function readBar(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Places"]')!;
    const links = [...nav.querySelectorAll<HTMLElement>('a[data-testid^="nav-"]')];
    return {
      compact: nav.dataset.compact === 'true',
      height: nav.getBoundingClientRect().height,
      lines: new Set(links.map((link) => Math.round(link.getBoundingClientRect().top))).size,
      doors: links.length,
      // The layout width, not the painted one: the lit door is scaled up by a transform.
      tile: document.querySelector<HTMLElement>('[data-testid="nav-city"] .door-tile')!.offsetWidth,
      wideLabels: links
        .filter((link) => {
          const label = link.lastElementChild!.getBoundingClientRect();
          return label.width > link.getBoundingClientRect().width + 0.5;
        })
        .map((link) => link.textContent),
    };
  });
}

/*
 * Thirteen doors need 1040px, so at 1024 the ordinary crew's bar tightens; with the fight mark it
 * needs 1118px, so a frame 1100 wide tightens too. A thirteen-door row at 1100 fits and is drawn as
 * it always was, which the case after this one holds.
 */
for (const [label, fixture, widths] of [
  ['thirteen doors', me, [1024]],
  ['the fight mark as well', featsMe, [1024, 1100]],
] as const) {
  for (const width of widths) {
    test(`the bottom bar keeps ${label} on one row at ${width} wide, smaller`, async ({ page }) => {
      await page.setViewportSize({ width, height: 768 });
      await installApi(page, fixture);
      await page.goto('/game');
      await expect(page.getByTestId('nav-city')).toBeVisible();
      await settleFonts(page);

      const bar = await readBar(page);
      expect(bar.doors).toBeGreaterThanOrEqual(13);
      expect(bar.lines, 'the row wrapped').toBe(1);
      expect(bar.wideLabels, 'a label wider than its door').toEqual([]);
      // Tightened: the doors came down with the gaps, and the bar is one row tall again.
      expect(bar.compact).toBe(true);
      expect(bar.tile).toBeLessThan(52);
      expect(bar.height).toBeLessThan(100);
      await expectNothingOverflowsTheScreen(page);
      await page.screenshot({
        path: `screenshots/layout-edges/bar-${width}-${label.replace(/ /g, '-')}.png`,
      });
    });
  }
}

for (const [width, fixture] of [
  [1100, me],
  [1280, featsMe],
  [1440, featsMe],
  [1920, featsMe],
] as const) {
  test(`the bottom bar is drawn at full size where it fits, at ${width} wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await installApi(page, fixture);
    await page.goto('/game');
    await expect(page.getByTestId('nav-city')).toBeVisible();
    await settleFonts(page);
    const bar = await readBar(page);
    expect(bar.compact).toBe(false);
    expect(bar.tile).toBe(52);
    expect(bar.lines).toBe(1);
    expect(await page.locator('nav[aria-label="Places"]').getAttribute('style')).toBeNull();
  });
}

// --- the build strip ---

test('a full build strip at 1024 wide fades at its edge and says there is more', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await installApi(page, fullQueue);
  await page.goto('/game/base');
  await expect(page.getByTestId('build-rail')).toHaveAttribute('data-layout', 'strip');
  await settleFonts(page);

  const orders = page.getByTestId('build-rail-orders');
  await expect(page.getByTestId('build-rail-more-end')).toBeVisible();
  await expect(page.getByTestId('build-rail-more-start')).toHaveCount(0);
  expect(await orders.evaluate((node) => getComputedStyle(node).maskImage)).toContain('gradient');
  await page.screenshot({ path: 'screenshots/layout-edges/build-strip-1024-full.png' });

  // A press brings the next order in, and the near edge now has something past it too.
  await page.getByTestId('build-rail-more-end').click();
  await expect(page.getByTestId('build-rail-more-start')).toBeVisible();
  expect(await orders.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);

  // And at the far end the far arrow goes: nothing is past it.
  await orders.evaluate((node) => node.scrollTo({ left: node.scrollWidth }));
  await expect(page.getByTestId('build-rail-more-end')).toHaveCount(0);
  await expectNothingOverflowsTheScreen(page);
  await expectNothingClippedHorizontally(page);
  await page.screenshot({ path: 'screenshots/layout-edges/build-strip-1024-end.png' });
});

test('a build strip that fits draws no hint at all', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await installApi(page, lateGame);
  await page.goto('/game/base');
  await expect(page.getByTestId('build-rail')).toHaveAttribute('data-layout', 'strip');
  await settleFonts(page);
  await expect(page.getByTestId('build-rail-quarters')).toBeVisible();
  await expect(page.getByTestId('build-rail-more-end')).toHaveCount(0);
  await expect(page.getByTestId('build-rail-more-start')).toHaveCount(0);
  expect(await page.getByTestId('build-rail-orders').getAttribute('style')).toBeNull();
});

test('the column the rail becomes on a wide frame draws no strip hint', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installApi(page, fullQueue);
  await page.goto('/game/base');
  await expect(page.getByTestId('build-rail')).toHaveAttribute('data-layout', 'column');
  await expect(page.getByTestId('build-rail-more-end')).toHaveCount(0);
});

// --- the Runner's plates ---

/** Every plate on the barrow: its drawing, whether the second line shows, and what is cut. */
async function readBarrow(page: Page) {
  return page.evaluate(() => {
    const stock = document.querySelector<HTMLElement>('[data-testid="vendor-stock"]')!;
    const plates = [...stock.querySelectorAll<HTMLElement>(':scope > li')];
    return {
      stall: stock.parentElement!.getBoundingClientRect().height,
      rows: new Set(plates.map((plate) => Math.round(plate.getBoundingClientRect().top))).size,
      drawings: [
        ...new Set(
          plates.map(
            (plate) =>
              plate.querySelector<HTMLElement>('.icon-tile')?.getBoundingClientRect().height,
          ),
        ),
      ],
      secondLines: plates.filter((plate) => {
        const line = plate.querySelector<HTMLElement>('span.uppercase.opacity-80');
        return line !== null && line.getBoundingClientRect().height > 0;
      }).length,
      cut: [...stock.querySelectorAll<HTMLElement>('*')]
        .filter(
          (el) =>
            el.childElementCount === 0 &&
            getComputedStyle(el).display !== 'none' &&
            el.scrollWidth > el.clientWidth + 1,
        )
        .map((el) => el.textContent),
      // The stock tag in each corner against the drawing under it.
      tagOnDrawing: plates.filter((plate) => {
        const tag = plate
          .querySelector<HTMLElement>(':scope > span.absolute')!
          .getBoundingClientRect();
        const tile = plate.querySelector<HTMLElement>('.icon-tile')!.getBoundingClientRect();
        return !(
          tag.right <= tile.left ||
          tag.left >= tile.right ||
          tag.bottom <= tile.top ||
          tag.top >= tile.bottom
        );
      }).length,
      spill: plates.filter((plate) => {
        const box = plate.getBoundingClientRect();
        return [...plate.querySelectorAll<HTMLElement>('*')].some((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.bottom > box.bottom + 0.5 || r.right > box.right + 0.5);
        });
      }).length,
    };
  });
}

for (const [width, height] of [
  [1100, 860],
  [1280, 900],
  [1440, 900],
  [1280, 940],
]) {
  test(`the barrow's one row at ${width}x${height} draws the middle plate`, async ({ page }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await installApi(page, lateGame);
    await page.goto('/game/market');
    await expect(page.getByTestId('vendor-stock')).toBeVisible();
    await settleFonts(page);

    const barrow = await readBarrow(page);
    // The band this is for: taller than the thumbnail's, too short for two rows.
    expect(barrow.stall).toBeGreaterThanOrEqual(250);
    expect(barrow.stall).toBeLessThan(342);
    expect(barrow.rows).toBe(1);
    expect(barrow.drawings, 'the drawing is the full plate’s 56px').toEqual([56]);
    expect(barrow.secondLines).toBe(6);
    expect(barrow.cut).toEqual([]);
    expect(barrow.tagOnDrawing, 'a stock tag over a drawing').toBe(0);
    expect(barrow.spill).toBe(0);
    await page.screenshot({ path: `screenshots/layout-edges/barrow-${width}x${height}.png` });
  });
}

for (const [width, height, drawing, rows] of [
  [1280, 800, 32, 1],
  [1280, 720, 32, 1],
  [1920, 1080, 56, 2],
] as const) {
  test(`the barrow outside that band is the plate it was, at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await installApi(page, lateGame);
    await page.goto('/game/market');
    await expect(page.getByTestId('vendor-stock')).toBeVisible();
    await settleFonts(page);
    const barrow = await readBarrow(page);
    expect(barrow.rows).toBe(rows);
    expect(barrow.drawings).toEqual([drawing]);
    expect(barrow.secondLines).toBe(rows === 2 ? 6 : 0);
  });
}

// --- "bid / you pay" ---

/*
 * Maintainer, 2026-09-29: a bid shows what the crew would pay after its discount beside it. The
 * fixtures carry no discount, so the ordinary screenshots are untouched; these give the crew one
 * and hold the window to the same layout gates at the narrowest and the widest frame.
 */
for (const [width, height] of [
  [1024, 768],
  [1920, 1080],
] as const) {
  test(`the barrow's bid and what it costs share the row at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await installApi(page, lateGame);
    await page.route('**/api/market', (route) =>
      route.fulfill({ json: { ...market, marketDiscountPercent: 25 } }),
    );
    await page.goto('/game/market');
    await expect(page.getByTestId('vendor-stock')).toBeVisible();
    const open = market.vendor.stock.find((offer) => offer.auction !== null)!;
    await page.getByTestId(`bid-${open.line.id}`).click();
    await expect(page.getByTestId('lot-window')).toBeVisible();
    await settleFonts(page);
    await expect(page.getByTestId('lot-you-pay')).toBeVisible();
    await expectBidRowWhole(page, 'lot-amount', 'lot-you-pay');
    await expectNothingOverflowsTheScreen(page);
    await expectNothingClippedHorizontally(page);
    await page.screenshot({
      path: `screenshots/layout-edges/you-pay-barrow-${width}x${height}.png`,
    });
  });

  test(`the fence's bid and what it costs share the row at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await installApi(page, lateGame);
    await page.route('**/api/black-market*', (route) =>
      route.fulfill({ json: { ...blackMarket, infamy: 10_000_000, discountPercent: 20 } }),
    );
    await page.goto('/game/market/black');
    await page.getByTestId('black-bid-0').click();
    await expect(page.getByTestId('black-lot-window')).toBeVisible();
    await settleFonts(page);
    await expect(page.getByTestId('lot-you-pay')).toBeVisible();
    await expectBidRowWhole(page, 'lot-amount', 'lot-you-pay');
    await expectNothingOverflowsTheScreen(page);
    await expectNothingClippedHorizontally(page);
    await page.screenshot({
      path: `screenshots/layout-edges/you-pay-fence-${width}x${height}.png`,
    });
  });
}

for (const [width, height] of [
  [1024, 768],
  [1920, 1080],
] as const) {
  test(`a table's bid and what the book pays share the row at ${width}x${height}`, async ({
    page,
  }) => {
    // The open table this crew is losing, so the live bid field is the one on screen.
    const recruitId = 'bar-6';
    await page.setViewportSize({ width, height });
    await installApi(page, adminGame);
    await page.route('**/api/bar*', (route) =>
      route.fulfill({ json: { ...bar, wageDiscountPercent: 20 } }),
    );
    await page.goto('/game/bar');
    await settleFonts(page);
    await page.getByTestId('sit-down').click();
    const card = page.getByTestId(`recruit-${recruitId}`);
    for (let step = 0; step < bar.recruits.length && (await card.count()) === 0; step += 1) {
      await page.getByTestId('seat-on').click();
    }
    await page.getByTestId(`bid-${recruitId}`).click();
    await expect(page.getByTestId('auction-window')).toBeVisible();
    await expect(page.getByTestId('bid-you-pay')).toBeVisible();
    await expectBidRowWhole(page, 'bid-amount', 'bid-you-pay');
    await expectNothingOverflowsTheScreen(page);
    await expectNothingClippedHorizontally(page);
    await page.screenshot({ path: `screenshots/layout-edges/you-pay-bar-${width}x${height}.png` });
  });
}

/** The field and the second figure on one line, neither cut, inside the window. */
async function expectBidRowWhole(page: Page, field: string, pay: string): Promise<void> {
  const [a, b] = await Promise.all([
    page.getByTestId(field).boundingBox(),
    page.getByTestId(pay).boundingBox(),
  ]);
  expect(a && b, 'the bid row did not draw').toBeTruthy();
  // One line: the second figure is beside the field, not wrapped under it.
  expect(Math.abs(a!.y + a!.height / 2 - (b!.y + b!.height / 2))).toBeLessThan(4);
  expect(b!.x).toBeGreaterThanOrEqual(a!.x + a!.width);
  const cut = await page
    .getByTestId(pay)
    .evaluate((node) => node.scrollWidth > node.clientWidth + 1);
  expect(cut, 'the second figure is cut').toBe(false);
}
