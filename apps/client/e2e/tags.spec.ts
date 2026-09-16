/**
 * What a unit's tags say when you point at them (maintainer request, 2026-09-14).
 *
 * A rule and a modifier are the two chips under a unit's stats, and both used to answer with an
 * `InfoWindow`: the unit's name as an eyebrow, a stamped icon, a tone-coloured header, and the
 * sentence filed under a heading that read "What it does". That is the shape of a panel you open
 * on purpose, not of a label you brushed past on the way somewhere else.
 *
 * They answer on a torn scrap now: the tag's own name, a ruled line, and one line of what it does.
 * What is worth a browser rather than a unit test is the part that is not in the markup: that the
 * headings are gone, that a modifier still says the condition it only counts under, and that a
 * rule which takes something away still reads red.
 */
import { expect, test, type Page } from '@playwright/test';
import { installApi, settleFonts } from './harness';
import { lateGame, unitsResponse } from './fixtures';

async function openRoster(page: Page, tier: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installApi(page, lateGame);
  await page.route('**/api/units', (route) =>
    route.fulfill({
      json: {
        ...unitsResponse,
        units: unitsResponse.units.map((unit) => ({ ...unit, unlocked: true, missing: [] })),
      },
    }),
  );
  await page.goto('/game/units');
  await expect(page.getByTestId('unit-catalogue')).toBeVisible();
  await page.getByTestId(`tier-${tier}`).click();
  await settleFonts(page);
}

/** The floating card, whichever tag opened it. */
const CARD = '[role="tooltip"]';

test('a modifier answers with its name and one line, and keeps the condition', async ({ page }) => {
  await openRoster(page, 'heavy');
  const tag = page.getByText('Dug In', { exact: true }).first();
  await tag.scrollIntoViewIfNeeded();
  await tag.hover();

  const card = page.locator(CARD).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('Dug In');
  await expect(card).toContainText('Worth twice as much behind something');

  // The headings are the thing that went. Both of them, by name.
  await expect(card).not.toContainText('When it happens');
  await expect(card).not.toContainText('What it does');

  /*
   * The condition survived the trim.
   *
   * Reading the ask as "delete everything but the description" would have been the easy version
   * and the wrong one: `Dug In` without "when holding ground" is a flat bonus, and the whole point
   * of a modifier is that it is not one.
   */
  await expect(card).toContainText('when holding ground');

  // A torn scrap, not the window it replaced: the frame is the card's own, with no header bar.
  await expect(card.locator('.scrap')).toHaveCount(0);
  await expect(page.locator(`${CARD}.scrap`)).toBeVisible();
});

test('a rule that takes something away still reads red', async ({ page }) => {
  await openRoster(page, 'legendary');
  /*
   * The Colossus cannot ride, and that is a cost rather than a perk.
   *
   * The tone used to be carried by `InfoWindow`'s coloured header, which is gone. It is on the
   * name now, so this reads the name's own colour rather than trusting a class list: an oxblood
   * token and a brass one are both "some class was applied", and only one of them is right.
   */
  const tag = page.getByText('Too big to ride', { exact: true }).first();
  await tag.scrollIntoViewIfNeeded();
  await tag.hover();

  const card = page.locator(CARD).first();
  await expect(card).toBeVisible();
  const title = card.getByText('Too big to ride', { exact: true });
  const ink = await title.evaluate((el) => getComputedStyle(el).color);
  const [r, g] = ink.match(/\d+/g)!.map(Number) as [number, number, number];
  /*
   * Red against **green**, not against blue.
   *
   * The first cut of this compared red to blue and passed with the title painted brass, which is
   * the bug it was written to catch: brass-100 is `#ffe4ae`, a warm cream whose red also towers
   * over its blue. The two tones are only told apart by the green channel, where brass sits 27
   * below its red and oxblood-300 (`#e05a4a`) sits 134 below. Eighty is the gap between them.
   */
  expect(r - g, `a rule that costs you something is red, got ${ink}`).toBeGreaterThan(80);
});
