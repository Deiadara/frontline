import { BUILDING_KINDS, type Building } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { lateGame, lateGameBase, meNoOverseer } from './fixtures';
import { installApi } from './harness';

/**
 * A panel has to render at the colour it declares (maintainer, 2026-09-22).
 *
 * `.grain` is the film tooth laid over the game's paper. It used to put the noise in the
 * element's own `background-image` and set `mix-blend-mode: overlay` **on the element**, and a
 * blend mode on an element blends all of it, background, text, pictures and children, with
 * whatever is painted behind. Overlay against a dark backdrop is a multiply, so every panel
 * carrying the class on the game's darkest grounds came out at a fraction of its own material.
 *
 * It was reported three times as "the menus are still dark", and twice the answer was to lighten
 * the material, which the blend then ate: `.card-paper-lit` was mixed specially for the structure
 * windows and arrived on screen darker than the ink-black sheet it replaced. Measured at the
 * time: the overseer's file 9.7 mean luminance against 64.4 with the class removed, the panels
 * inside a structure window 19.7 against 72.4.
 *
 * Two assertions, because they fail for different reasons. The structural one names the exact
 * mechanism and cannot drift with the art. The measured one is the thing a player complained
 * about, and would catch a different route to the same darkness (a scrim, an opacity, a filter).
 */

/** Mean relative luminance of an element as actually painted, 0..255. */
async function meanLuma(page: Page, shot: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let index = 0; index < data.length; index += 4) {
      sum += 0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]!;
    }
    return sum / (data.length / 4);
  }, shot.toString('base64'));
}

/**
 * Nothing that *holds content* blends itself into its backdrop.
 *
 * The tooth belongs on a layer over the element (`.grain::before`), never on the element. This
 * walks the whole document rather than the panels alone, so the same mistake made with a
 * different class is caught by the same test.
 *
 * An **empty** element is allowed to blend, and several deliberately do: `.patina` is a single
 * grease-and-scratch pane stretched over the viewport to tie the windows together, and the
 * character screen lays a bare `.grain` sheet over its splash. A layer with nothing inside it
 * blends only itself, which is what a layer is for. The bug is a panel with words and pictures
 * in it doing the same thing to all of them.
 */
async function expectNothingBlendsItself(page: Page): Promise<void> {
  const offenders = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('*')]
      .filter((node) => {
        const blend = getComputedStyle(node).mixBlendMode;
        if (blend === 'normal' || blend === '') return false;
        return node.childElementCount > 0 || (node.textContent ?? '').trim().length > 0;
      })
      .map((node) => `${node.tagName}.${node.className.toString().slice(0, 70)}`)
      .slice(0, 10),
  );
  expect(offenders, 'an element with content is blending itself into the page behind it').toEqual(
    [],
  );
}

test('the overseer file is drawn at the colour of its own paper', async ({ page }) => {
  await installApi(page, meNoOverseer);
  await page.goto('/overseer');
  await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
  await page
    .getByTestId(/^overseer-card-/)
    .first()
    .click();

  const sheet = page.getByTestId(/^overseer-sheet-/).first();
  await expect(sheet).toBeVisible();
  await expectNothingBlendsItself(page);

  /*
   * 40 is a floor with room under the measured 64 for art and copy to change, and it is far
   * above the 9.7 the bug produced. A threshold rather than a pin: this is a painted screen and
   * pinning its exact luminance would redden on any change to a portrait.
   */
  expect(await meanLuma(page, await sheet.screenshot())).toBeGreaterThan(40);
});

test('the panels inside a structure window are lit paper, not holes', async ({ page }) => {
  const buildings: Building[] = BUILDING_KINDS.map((kind, index) => ({
    id: `b${index + 1}`,
    kind,
    level: 19,
    modifications: [],
  }));
  await installApi(page, { ...lateGame, base: { ...lateGameBase, level: 19, buildings } });
  await page.goto('/game/base');
  await page.getByRole('button', { name: /^The Quarters,/ }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expectNothingBlendsItself(page);

  // Every lit panel in the window, not just the first: the maintainer's note is that the windows
  // are dark at *any* level, so a single panel passing would not answer it.
  const panels = dialog.locator('.card-paper-lit');
  const count = await panels.count();
  expect(count, 'the window should be built out of lit panels').toBeGreaterThan(1);
  for (let index = 0; index < count; index += 1) {
    const panel = panels.nth(index);
    if (!(await panel.isVisible())) continue;
    expect(
      await meanLuma(page, await panel.screenshot()),
      `panel ${index} of the structure window`,
    ).toBeGreaterThan(40);
  }
});
