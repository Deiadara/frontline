import { CITY_DISTRICTS } from '@frontline/shared';
import { expect, test } from '@playwright/test';
import { me, meNoOverseer, overseer } from './fixtures';
import { installApi } from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

test('character select renders all presets', async ({ page }) => {
  await installApi(page, meNoOverseer);
  await page.goto('/overseer');

  await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
  await page.getByText(overseer.name).click();
  await expect(page.getByRole('button', { name: 'Confirm Overseer' })).toBeEnabled();

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
