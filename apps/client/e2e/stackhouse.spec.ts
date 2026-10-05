import { expect, test, type Page } from '@playwright/test';
import { lateGame, stackhouseBook } from './fixtures';
import { installApi, settleFonts } from './harness';

/**
 * The Stackhouse (maintainer, 2026-10-05): the right half of the Black Market, a private book on
 * fights you or your faction are in. A bet picks a side, a stake up to 5,000, and is locked in by a
 * second press because it cannot be taken back.
 */

async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('h2, p, span, li, button')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 60) ?? ''),
  );
}

async function open(page: Page, width = 1600, height = 900): Promise<void> {
  await page.setViewportSize({ width, height });
  await installApi(page, lateGame);
  await page.goto('/game/market/black');
  await expect(page.getByTestId('stackhouse')).toBeVisible();
  await settleFonts(page);
}

test('sits beside the shelf, as big as it, and lists the fights on the book', async ({ page }) => {
  await open(page);
  const shelf = await page.getByTestId('black-market-shelf').locator('..').boundingBox();
  const book = await page.getByTestId('stackhouse').boundingBox();
  expect(shelf && book).toBeTruthy();
  expect(Math.abs((shelf?.width ?? 0) - (book?.width ?? 0))).toBeLessThan(4);
  expect(Math.abs((shelf?.y ?? 0) - (book?.y ?? 0))).toBeLessThan(4);
  await expect(page.getByTestId('stackhouse-fights').locator('> li')).toHaveCount(
    stackhouseBook.fights.length,
  );
  await expect(page.getByTestId('stackhouse-last')).toContainText('came back as 5,000');
  expect(await overflowing(page)).toEqual([]);
  // No page scroll at a desktop frame: the two halves fit.
  const scrolls = await page.evaluate(() =>
    [...document.querySelectorAll('*')].some(
      (el) =>
        el.scrollHeight > el.clientHeight + 1 &&
        ['auto', 'scroll'].includes(getComputedStyle(el).overflowY),
    ),
  );
  expect(scrolls, 'the Black Market scrolls at 1600x900').toBe(false);
  await page.screenshot({ path: 'e2e-out/stackhouse-book.png' });
});

/**
 * A row's rust stays on the row (bug report, 2026-10-05). `.rusted::before` is absolutely placed, so
 * a stained element that is not positioned spreads its stain over the whole panel, and lifting it on
 * hover pulled the stain back in: the Stackhouse lost its orange every time a fight was pointed at.
 */
test('keeps every rust stain inside its own card or row', async ({ page }) => {
  await open(page);
  const loose = await page.evaluate(() =>
    [...document.querySelectorAll('.rusted')]
      .filter((el) => getComputedStyle(el).position === 'static')
      .map((el) => el.getAttribute('data-testid') ?? el.tagName),
  );
  expect(loose).toEqual([]);
});

test('takes a bet in two presses: a side and a stake, then lock it in', async ({ page }) => {
  await open(page);
  await page.getByTestId('stackhouse-fight-bet-2').click();
  const window = page.getByTestId('stackhouse-window');
  await expect(window).toBeVisible();
  await expect(page.getByTestId('stackhouse-place')).toBeDisabled();
  await page.getByTestId('stackhouse-side-defender').click();
  await page.getByTestId('stackhouse-stake').fill('5000');
  await page.getByTestId('stackhouse-stake').blur();
  await expect(window).toContainText('Pays 10,000');
  expect(await overflowing(page)).toEqual([]);
  await page.screenshot({ path: 'e2e-out/stackhouse-window.png' });

  await page.getByTestId('stackhouse-place').click();
  await expect(page.getByTestId('stackhouse-sure')).toContainText(
    'Put 5,000 caps on Rustline Collective of the Lower Docks?',
  );
  await page.screenshot({ path: 'e2e-out/stackhouse-sure.png' });
  await page.getByTestId('stackhouse-lock-in').click();
  await expect(window).toBeHidden();
  await expect(page.getByTestId('stackhouse-riding')).toContainText('5,000 caps');
  await expect(page.getByTestId('stackhouse-riding')).toContainText(
    'Rustline Collective of the Lower Docks',
  );
  await expect(page.getByTestId('stackhouse-fights')).toHaveCount(0);
});

test('stays shut until the Fixer has opened it', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await installApi(page, lateGame);
  await page.route('**/api/black-market/stackhouse', (route) =>
    route.fulfill({ json: { ...stackhouseBook, unlocked: false, fights: [], lastResult: null } }),
  );
  await page.goto('/game/market/black');
  await settleFonts(page);
  await expect(page.getByTestId('stackhouse-locked')).toContainText(
    'Put Your Money Where Your Mouth Is',
  );
  expect(await overflowing(page)).toEqual([]);
});
