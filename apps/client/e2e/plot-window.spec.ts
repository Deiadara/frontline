import { expect, test, type Locator, type Page } from '@playwright/test';
import { BUILDING_KINDS, MODIFICATIONS, type Base } from '@frontline/shared';
import { districtWithAddons, lateGame } from './fixtures';
import { installApi, settleFonts } from './harness';

/**
 * The plot window is one shape (maintainer, 2026-10-08).
 *
 * The order top left and what the level gives top right, at one fixed height, and the three
 * brackets across the whole window under them, as cards of one fixed size. So every plot opens at
 * the same size whatever its price, parts, clock or brackets, and nothing inside it is cut.
 */

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

/** Every leaf of text in the window that runs past its own box or out of the panel it is in. */
async function cutInside(dialog: Locator): Promise<string[]> {
  return dialog.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('span, p, h3, h4, button, dt, dd')]
      .filter((el) => el.childElementCount === 0 && (el.textContent ?? '').trim() !== '')
      .filter((el) => !el.closest('.sr-only'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        const panel = el.closest('section, li')?.getBoundingClientRect();
        const spills =
          panel !== undefined &&
          (box.right > panel.right + 0.5 ||
            box.bottom > panel.bottom + 0.5 ||
            box.left < panel.left - 0.5);
        return el.scrollWidth > el.clientWidth + 1 || spills;
      })
      .map((el) => (el.textContent ?? '').trim()),
  );
}

async function openPlot(page: Page, kind: string): Promise<Locator> {
  await page.getByTestId(`plot-${kind}`).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('structure-deck')).toBeVisible();
  return dialog;
}

const sizeOf = async (dialog: Locator) => {
  const box = await dialog.boundingBox();
  return { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
};

for (const viewport of VIEWPORTS) {
  const tag = `${viewport.width}x${viewport.height}`;

  test.describe(`the plot window at ${tag}`, () => {
    test.use({ viewport });

    test('opens at one size for every structure, and cuts nothing', async ({ page }) => {
      await installApi(page, { ...lateGame, base: districtWithAddons });
      await page.goto('/game/base');
      await settleFonts(page);
      const sizes = new Map<string, { width: number; height: number }>();
      for (const kind of BUILDING_KINDS) {
        const dialog = await openPlot(page, kind);
        await settleFonts(page);
        sizes.set(kind, await sizeOf(dialog));
        expect(await cutInside(dialog), kind).toEqual([]);
        // The whole window on screen, with no scroll inside it.
        const hidden = await dialog.getByTestId('structure-deck').evaluate((deck) => {
          const body = deck.parentElement!;
          return body.scrollHeight - body.clientHeight;
        });
        expect(hidden, `${kind}: px under the fold`).toBeLessThanOrEqual(1);
        if (kind === 'nexus' || kind === 'lab') {
          await page.screenshot({ path: `screenshots/visual/plot-${kind}-${tag}.png` });
        }
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
      }
      const first = [...sizes.values()][0];
      for (const [kind, size] of sizes) expect(size, kind).toEqual(first);
    });
  });
}

/**
 * Every card in the catalogue, three at a time in the Nexus's brackets, at the narrowest frame:
 * the longest name and the longest effect line have to sit inside a card of the fixed size.
 */
test.describe('every modification fits its card', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('at 1024x768', async ({ page }) => {
    test.setTimeout(300_000);
    const ids = MODIFICATIONS.map((spec) => spec.id);
    for (let at = 0; at < ids.length; at += 3) {
      const fitted = ids.slice(at, at + 3);
      const base: Base = {
        ...districtWithAddons,
        buildings: districtWithAddons.buildings.map((building) =>
          building.kind === 'nexus' ? { ...building, level: 20, modifications: fitted } : building,
        ),
        addons: { researched: [], built: fitted },
      };
      await page.unrouteAll();
      await installApi(page, { ...lateGame, base });
      await page.goto('/game/base');
      const dialog = await openPlot(page, 'nexus');
      await settleFonts(page);
      expect(await cutInside(dialog.getByTestId('slots-nexus')), fitted.join(', ')).toEqual([]);
    }
  });
});
