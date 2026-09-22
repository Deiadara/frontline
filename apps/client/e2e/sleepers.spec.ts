import { expect, test } from '@playwright/test';
import { lateGame } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * §A4: the three screens a Sleeper cell is visible on (maintainer, 2026-09-18).
 *
 * The mechanic is that a crew can put force somewhere **before** it has announced it wants it.
 * Every other unit in the game reaches a fight by being sent to one. The server side is held in
 * `city/sleepers.test.ts`; what only a browser answers is whether a player can find any of it:
 * the door on the location sheet, the rows on the Monitor with their recall, and the census that
 * finally says where everybody is.
 */

test('the location sheet offers a way in that is not a fight', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/city/rustyard');
  await page.getByTestId('site-rustyard-pawn').click();
  await expect(page.getByTestId('location-window')).toBeVisible();
  await settleFonts(page);

  // Beside Call a fight, not instead of it: they are two halves of one decision.
  const call = page.getByTestId('call-rustyard-pawn');
  const send = page.getByTestId('send-sleepers-rustyard-pawn');
  await expect(call).toBeVisible();
  await expect(send).toBeVisible();

  const [a, b] = [await call.boundingBox(), await send.boundingBox()];
  if (!a || !b) throw new Error('a control has no box');
  expect(
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    'not on one line',
  ).toBeGreaterThan(0);

  // ...and it opens a picker that offers only the sheets that can go to ground.
  await send.click();
  const picker = page.getByRole('dialog', { name: /Send Sleepers into/ });
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('Sleepers');
  await expect(picker, 'the picker offered a sheet that cannot be planted').not.toContainText(
    'Razors',
  );
});

/** A crew with no Sleepers is never offered the door, because pressing it could only refuse. */
test('the door is not there for a crew that has none', async ({ page }) => {
  await installApi(page, lateGame);
  /*
   * `/api/me`, not `/api/units`: the location sheet reads the crew's roster off `me.base.army`
   * (`DistrictView`), so overriding the units payload changes nothing this screen looks at. The
   * first version of this test did exactly that and passed on a door that was still there.
   */
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { ...lateGame, base: { ...lateGame.base, army: { razors: 40 } } } }),
  );
  await page.goto('/game/city/rustyard');
  await page.getByTestId('site-rustyard-pawn').click();
  await expect(page.getByTestId('location-window')).toBeVisible();

  await expect(page.getByTestId('call-rustyard-pawn')).toBeVisible();
  await expect(page.getByTestId('send-sleepers-rustyard-pawn')).toHaveCount(0);
});

test('the Monitor lists the cells, in place and on the road, and can pull them out', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/actions');
  await expect(page.getByTestId('road')).toBeVisible();
  await settleFonts(page);

  // The header has to add up to the page under it.
  // Case-insensitive: the span is lower case in the DOM and uppercased in CSS, and
  // `toContainText` reads `textContent` rather than what the screen renders.
  await expect(page.getByTestId('road-counts')).toContainText(/2 planted/i);
  await expect(page.getByTestId('road-counts')).toContainText(/1 posted/i);

  const inPlace = page.getByTestId('cell-cell-1');
  const walking = page.getByTestId('cell-cell-2');
  await expect(inPlace).toContainText(/in place/i);
  // The one row on this page with no countdown: a planted cell has no clock on it, and the row
  // says how long it has been there instead.
  await expect(inPlace).toContainText(/in place for/i);
  await expect(walking).toContainText(/walking in/i);
  await expect(walking).toContainText(/to go/i);

  const posted = await page.getByTestId('stationed').locator('li').count();
  expect(posted, 'nothing posted on held ground').toBeGreaterThan(0);

  const sent = page.waitForRequest(
    (request) => request.url().includes('/api/city/sleepers/recall') && request.method() === 'POST',
  );
  await page.getByTestId('recall-cell-cell-1').click();
  expect((await sent).postDataJSON()).toEqual({ cellId: 'cell-1' });

  await expectNothingOverflowsTheScreen(page);
});

test('the census says how many of everybody there are, and where', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/units');

  // The door is on the quotation's line, which is where the maintainer asked for it.
  const door = page.getByTestId('total-units');
  await expect(door).toBeVisible();
  const quote = page.getByText("It's the suffering that brings us together.");
  const [d, q] = [await door.boundingBox(), await quote.boundingBox()];
  if (!d || !q) throw new Error('the door or the quote has no box');
  expect(
    Math.min(d.y + d.height, q.y + q.height) - Math.max(d.y, q.y),
    'not on the quote line',
  ).toBeGreaterThan(0);

  await door.click();
  // §A4: the census is the Monitor's second page now (maintainer, 2026-09-19), so the roster's
  // door opens that tab rather than a page of its own.
  await expect(page).toHaveURL(/\/game\/actions\/units$/);
  await expect(page.getByTestId('census')).toBeVisible();
  await expect(page.getByTestId('monitor-tab-census')).toHaveAttribute('aria-current', 'page');
  await settleFonts(page);

  /*
   * The four buckets, on the two sheets the fixture actually holds people in.
   *
   * The Razors are the arithmetic: 4 at home, 2 on held ground, 3 committed, and **none**
   * planted. The Sleepers are the other half: 1 still at home and 2 planted, and `abroad`
   * carries the planted two as well, so a census that added instead of subtracting would read
   * 2 out and a total of 5 rather than 3.
   */
  await expect(page.getByTestId('census-home-razors')).toHaveText('4');
  // Five at the door since the split (2026-09-22): a fifth place, and it counts in the total.
  await expect(page.getByTestId('census-gate-razors')).toHaveText('5');
  await expect(page.getByTestId('census-held-razors')).toHaveText('2');
  await expect(page.getByTestId('census-out-razors')).toHaveText('3');
  await expect(page.getByTestId('census-planted-razors')).toHaveText('0');
  await expect(page.getByTestId('census-total-razors')).toHaveText('14');

  await expect(page.getByTestId('census-home-sleepers')).toHaveText('1');
  await expect(page.getByTestId('census-planted-sleepers')).toHaveText('2');
  await expect(
    page.getByTestId('census-out-sleepers'),
    'the planted were counted twice: once as planted and once as out',
  ).toHaveText('0');
  await expect(page.getByTestId('census-total-sleepers')).toHaveText('3');

  await expectNothingOverflowsTheScreen(page);

  /*
   * ...and the strip is the way around, which is what replaced the old Close.
   *
   * The census used to be a page of its own with an X back to the roster. It is a tab now, so the
   * navigation is the other tab: the road is one press away and the census is one press back.
   */
  await page.getByTestId('monitor-tab-road').click();
  await expect(page).toHaveURL(/\/game\/actions$/);
  await expect(page.getByTestId('census')).toBeHidden();

  await page.getByTestId('monitor-tab-census').click();
  await expect(page).toHaveURL(/\/game\/actions\/units$/);
  await expect(page.getByTestId('census')).toBeVisible();
});
