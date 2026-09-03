/**
 * The gates themselves, checked against a bug planted on purpose.
 *
 * Every layout assertion in this suite has the same shape: "this list is empty". A list that is
 * empty because the check is looking in the wrong place is indistinguishable from a list that is
 * empty because the layout is sound, and the suite gets greener the more broken the gate is. That
 * is not hypothetical here: `expectNoDocumentOverflow` measured `document.documentElement`, and
 * every screen root in this app is `h-screen w-screen overflow-hidden` over
 * `html,body,#root{height:100%}`, so the document is pinned to the viewport by construction. A
 * 4000px block dropped into a screen moved it by exactly zero. Twenty-nine call sites were
 * asserting it, and on several screens it was the only overflow check they had.
 *
 * So each gate here is handed a deliberate, gross violation and must report it. These run in a few
 * seconds and they are the only tests in the suite that fail when a *gate* breaks rather than when
 * the app does.
 */
import { expect, test, type Page } from '@playwright/test';
import { me } from './fixtures';
import {
  expectNothingClippedVertically,
  expectNothingOverflowsTheScreen,
  installApi,
  screenOverflows,
  settleFonts,
} from './harness';

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installApi(page, me);
  await page.goto('/game/base');
  await settleFonts(page);
}

/** Drops an oversized block inside the screen, where a real layout bug lives. */
async function plantOverflow(page: Page, width: number, height: number): Promise<void> {
  await page.evaluate(
    ([w, h]) => {
      const screen = document.querySelector('#root')?.firstElementChild;
      const bomb = document.createElement('div');
      bomb.dataset.testid = 'planted-overflow';
      bomb.style.cssText = `width:${w}px;height:${h}px;background:red`;
      screen?.appendChild(bomb);
    },
    [width, height] as const,
  );
  await page.waitForTimeout(120);
}

test.describe('the overflow gate', () => {
  test('passes on a screen that fits', async ({ page }) => {
    await open(page);
    await expectNothingOverflowsTheScreen(page);
  });

  test('reports a block wider than the screen', async ({ page }) => {
    await open(page);
    await plantOverflow(page, 4000, 10);

    const over = await screenOverflows(page);
    expect(over, 'a 4000px block inside the screen was not reported').not.toEqual([]);
    expect(over[0]?.scrollWidth).toBeGreaterThan(over[0]!.clientWidth);
    await expect(expectNothingOverflowsTheScreen(page)).rejects.toThrow(/larger than the screen/);
  });

  test('reports a block taller than the screen', async ({ page }) => {
    await open(page);
    await plantOverflow(page, 10, 4000);

    const over = await screenOverflows(page);
    expect(over, 'a 4000px-tall block inside the screen was not reported').not.toEqual([]);
    expect(over[0]?.scrollHeight).toBeGreaterThan(over[0]!.clientHeight);
  });

  /**
   * And the check it replaced, kept as evidence rather than as a gate.
   *
   * If this ever starts failing it means the app stopped pinning the document to the viewport, and
   * the old measurement would have become meaningful again. Worth knowing; not worth trusting.
   */
  test('the document metrics it used to read still cannot see the same block', async ({ page }) => {
    await open(page);
    const before = await page.evaluate(() => document.documentElement.scrollWidth);
    await plantOverflow(page, 4000, 4000);
    const after = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(after, 'the document now sees screen overflow: revisit the gate').toBe(before);
  });
});

test.describe('the vertical clip gate', () => {
  test('reports text cut in half by a box that hides its overflow', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const screen = document.querySelector('#root')?.firstElementChild;
      // A box half a line tall that hides what does not fit, with the text in a child of it. That
      // is the shape of every cut-text bug in this app, and it is the shape the gate looks for: it
      // measures a text leaf against its *clipping ancestors*, so text directly inside the clipping
      // box itself is not what it is built to catch.
      const box = document.createElement('div');
      box.style.cssText =
        'position:absolute;left:8px;top:120px;width:240px;height:9px;overflow:hidden;z-index:99';
      const line = document.createElement('p');
      line.style.cssText = 'font-size:18px;line-height:18px;margin:0';
      line.textContent = 'This sentence is sliced in half';
      box.appendChild(line);
      screen?.appendChild(box);
    });
    await page.waitForTimeout(120);

    await expect(expectNothingClippedVertically(page)).rejects.toThrow(/sliced by a clipping edge/);
  });
});
