/**
 * §C: the research page, rebuilt as nineteen trades on a rail.
 *
 * What only a browser answers is the geometry and the ink. Three things are asserted here that a
 * unit test cannot see: the rail sits beside the ten rungs rather than above them, nothing on the
 * densest track is cut off or pushed past the frame at any of the sizes the game supports, and the
 * track sigils actually draw. A sigil that failed to render is invisible in every green unit test
 * and is the whole of §C4b.
 */
import { expect, test, type Page } from '@playwright/test';
import { OFFICER_ROLES, RESEARCH_TRACK_STEPS } from '@frontline/shared';
import { lateGame, research } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingOverflowsTheScreen,
  installApi,
  settleFonts,
} from './harness';

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

type Size = (typeof VIEWPORTS)[number];

const FIRST_TRACK = OFFICER_ROLES[0];
if (!FIRST_TRACK) throw new Error('no officer roles');

async function openTracks(page: Page, size: Size = VIEWPORTS[3]): Promise<void> {
  await page.setViewportSize(size);
  await installApi(page, lateGame);
  await page.goto('/game/research');
  await expect(page.getByTestId('research-sections')).toBeVisible();
  await page.getByTestId('research-section-programmes').click();
  await expect(page.getByTestId('research-tracks')).toBeVisible();
  await settleFonts(page);
}

const box = async (page: Page, testId: string) => {
  const at = await page.getByTestId(testId).boundingBox();
  if (!at) throw new Error(`${testId} has no box`);
  return at;
};

test('lists all nineteen trades, beside the rungs rather than above them', async ({ page }) => {
  await openTracks(page);

  const rail = page.getByTestId('research-tracks');
  for (const role of OFFICER_ROLES) {
    await expect(rail.getByTestId(`research-track-${role}`)).toHaveCount(1);
  }

  const railBox = await box(page, 'research-tracks');
  const panelBox = await box(page, `tech-track-${FIRST_TRACK}`);
  expect(railBox.x + railBox.width).toBeLessThanOrEqual(panelBox.x + 1);
  expect(panelBox.width).toBeGreaterThan(railBox.width);
});

test('opens on the first trade and swaps the whole panel for another', async ({ page }) => {
  await openTracks(page);

  await expect(page.getByTestId(`tech-track-${FIRST_TRACK}`)).toBeVisible();
  await expect(page.getByTestId('tech-track-scout')).toHaveCount(0);

  await page.getByTestId('research-track-scout').click();
  await expect(page.getByTestId('tech-track-scout')).toBeVisible();
  await expect(page.getByTestId(`tech-track-${FIRST_TRACK}`)).toHaveCount(0);

  const rungs = research.technologies.filter((tech) => tech.track === 'scout');
  expect(rungs).toHaveLength(RESEARCH_TRACK_STEPS);
  for (const rung of rungs) {
    await expect(page.getByTestId(`tech-${rung.id}`)).toHaveCount(1);
  }
});

test('draws a sigil for every trade, and none of them collapses', async ({ page }) => {
  await openTracks(page);

  // Rendered size rather than presence: an `<svg>` with no intrinsic size lays out at 0x0, is
  // "visible" to Playwright, and is the failure mode a sigil is most likely to have.
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="research-track-"] svg')].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        paths: node.querySelectorAll('path').length,
      };
    }),
  );
  expect(sizes.length).toBe(OFFICER_ROLES.length);
  for (const size of sizes) {
    expect(size.w).toBeGreaterThan(8);
    expect(size.h).toBeGreaterThan(8);
    expect(size.paths).toBeGreaterThan(0);
  }
});

for (const size of VIEWPORTS) {
  const tag = `${size.width}x${size.height}`;
  test(`reads without cut text or overflow at ${tag}`, async ({ page }) => {
    await openTracks(page, size);

    // The deepest track in the fixture, which carries the longest blockers and the widest prices.
    await page.getByTestId('research-track-head_of_growth').click();
    await expect(page.getByTestId('tech-track-head_of_growth')).toBeVisible();
    await settleFonts(page);

    const cut = await page.evaluate<string[]>(() =>
      [...document.querySelectorAll<HTMLElement>('span, p, h3, h4, button')]
        .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
        .map((el) => `"${el.textContent?.trim()}" (${el.scrollWidth}>${el.clientWidth}px)`),
    );
    expect(cut, `cut text on the tracks: ${cut.join(' | ')}`).toEqual([]);

    await expectNothingOverflowsTheScreen(page);
    /*
     * Scoped to the rungs rather than run over the page.
     *
     * The rail is nineteen rows in a scroller, so at any scroll offset its last visible row is
     * half past the edge, sigil included, and `expectNoImagesClipped` cannot tell a list being
     * scrolled from a box drawn too small. That distinction does not arise inside the detail
     * panel, which lays out rather than scrolls, so that is where the gate has teeth. The sigils
     * themselves are proved whole by their own box in the test above.
     */
    await expectNoImagesClipped(page, '[data-testid="tech-track-head_of_growth"]');
    await page.screenshot({ path: `screenshots/research-tracks-${tag}.png` });
  });
}

test('says why a rung is shut, in the words the server sent', async ({ page }) => {
  await openTracks(page);
  await page.getByTestId('research-track-scout').click();

  const shut = research.technologies.find(
    (tech) => tech.track === 'scout' && tech.blocker !== null && !tech.known,
  );
  if (!shut?.blocker) throw new Error('the fixture has no shut scout rung');
  const card = page.getByTestId(`tech-${shut.id}`);
  await expect(card).toContainText(shut.blocker);
  await expect(card.getByRole('button')).toBeDisabled();

  // The three states a rung has, in one frame: finished, startable and shut.
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/research-tracks-shut.png' });
});

test('draws a track nobody is standing on as shut rather than as empty', async ({ page }) => {
  await openTracks(page);
  await page.getByTestId('research-track-field_commander').click();
  const panel = page.getByTestId('tech-track-field_commander');
  await expect(panel).toContainText('Nothing on this track moves until somebody is in the chair.');
  await expect(panel.getByTestId('tech-tech_order_of_march')).toContainText(
    'Needs a Field Commander',
  );
  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/research-tracks-empty-chair.png' });
});

test('shuts every trade at once when nobody holds the research post', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS[3]);
  await installApi(page, lateGame);
  await page.route('**/api/research', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...research, head: null }),
    }),
  );
  await page.goto('/game/research');
  await page.getByTestId('research-section-programmes').click();
  await expect(page.getByText('Every track on every trade is shut without one.')).toBeVisible();
});
