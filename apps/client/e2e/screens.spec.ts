import { CITY_DISTRICTS } from '@frontline/shared';
import { expect, test } from '@playwright/test';
import { me, meNoOverseer, overseer } from './fixtures';
import { installApi, settleFonts } from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

test('character select renders all presets', async ({ page }) => {
  await installApi(page, meNoOverseer);
  await page.goto('/overseer');

  await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
  await page.getByText(overseer.name).click();
  await expect(page.getByRole('button', { name: 'Confirm Overseer' })).toBeEnabled();

  // Both assertions below are geometry, so they are only meaningful once Orbitron has swapped
  // in — the fallback is narrower and would hide exactly the clipping they exist to catch.
  await settleFonts(page);

  // The radar's axis labels sit outside the plotted rings, so a viewBox that is too tight
  // silently clips them mid-word ("TEC" renders as "C"). Assert each label's rendered box is
  // fully inside its svg rather than trusting the geometry constants to stay in agreement.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('svg[aria-label="Attribute radar"]')].flatMap((svg) => {
      const box = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('text')]
        .filter((label) => {
          const at = label.getBoundingClientRect();
          return (
            at.left < box.left - 0.5 ||
            at.right > box.right + 0.5 ||
            at.top < box.top - 0.5 ||
            at.bottom > box.bottom + 0.5
          );
        })
        .map((label) => label.textContent ?? '');
    }),
  );
  expect(clipped, 'radar axis labels must not be clipped by the viewBox').toEqual([]);

  // Nothing in a card may be cut off horizontally either.
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll('h3, p, span')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 40) ?? ''),
  );
  expect(overflowing, 'card text must not overflow its column').toEqual([]);

  await page.screenshot({ path: 'screenshots/character-select.png', fullPage: false });
});

test('game shell renders the city map', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game');

  await expect(page.getByText(overseer.name)).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(700);

  await page.screenshot({ path: 'screenshots/game.png', fullPage: false });
});

test('base panel lists structures', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game/base');

  await expect(page.getByRole('heading', { name: "Operator's Foothold" })).toBeVisible();
  await expect(page.getByText('Command Center')).toBeVisible();
  await expect(page.getByText('Fusion Reactor')).toBeVisible();

  await page.screenshot({ path: 'screenshots/base.png', fullPage: false });
});

test('battle result modal opens after an attack', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(700);

  const undergrid = CITY_DISTRICTS.find((d) => d.id === 'undergrid');
  if (!undergrid) throw new Error('missing undergrid district');
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(
    box.x + undergrid.position.x * box.width,
    box.y + undergrid.position.y * box.height,
  );

  await page.getByRole('button', { name: 'Launch Attack' }).click();
  await expect(page.getByRole('heading', { name: 'VICTORY' })).toBeVisible();

  await page.screenshot({ path: 'screenshots/battle.png', fullPage: false });
});
