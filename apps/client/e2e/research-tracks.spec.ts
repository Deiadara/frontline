/**
 * §C: the research page, rebuilt as nineteen trades on a rail under a strip of three tabs.
 *
 * What only a browser answers is the geometry and the ink. Four things are asserted here that a
 * unit test cannot see: the three tabs sit side by side across the top, the rail sits beside the
 * ten rungs rather than above them, nothing on the densest track is cut off or pushed past the
 * frame at any of the sizes the game supports, and the track sigils actually draw. A sigil that
 * failed to render is invisible in every green unit test and is the whole of §C4b.
 */
import { expect, test, type Page } from '@playwright/test';
import { OFFICER_ROLES, RESEARCH_TRACK_STEPS } from '@frontline/shared';
import { lateGame, research } from './fixtures';
import {
  expectNoImagesClipped,
  growPastTheFold,
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
  await expect(page.getByTestId('research-tabs')).toBeVisible();
  await page.getByTestId('research-tab-programmes').click();
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

/**
 * The strip, across the top, with the workspace under the whole of it.
 *
 * The rail of doors this replaced took 17rem off the left of the frame at every width. Measured
 * rather than counted: three tabs stacked into a column would still be three tabs, and the sheet
 * would still say Programmes.
 */
test('puts three tabs side by side over the workspace', async ({ page }) => {
  await openTracks(page);

  const tabs = page.getByTestId('research-tabs').getByRole('link');
  await expect(tabs).toHaveCount(3);
  const strip = await tabs.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: Math.round(rect.top), left: Math.round(rect.left) };
    }),
  );
  expect(
    [...new Set(strip.map((tab) => tab.top))],
    'the tabs wrapped onto more than one line',
  ).toHaveLength(1);
  expect(strip.map((tab) => tab.left)).toEqual(
    [...strip.map((tab) => tab.left)].sort((a, b) => a - b),
  );

  const workspace = await box(page, 'research-workspace');
  const first = strip[0];
  if (!first) throw new Error('no tabs');
  expect(workspace.y).toBeGreaterThan(first.top);
  // The workspace starts at the left edge of the strip: nothing is holding a column beside it.
  expect(Math.abs(workspace.x - first.left)).toBeLessThanOrEqual(2);
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
    await page.screenshot({ path: `screenshots/research-tracks-${tag}.png` });

    /*
     * Grown until nothing is over its own fold, and only then swept for a sliced drawing.
     *
     * Both columns carry their own scroller now (maintainer, 2026-09-17), so at any scroll offset
     * the last visible row of either is half past its edge, sigil and rung disc included, and
     * `expectNoImagesClipped` cannot tell a list being scrolled from a box drawn too small. Growing
     * the window until every scroller fits removes the ambiguity rather than working around it: what
     * is left over is a real clipping edge. The picture is filed before the window moves, or it
     * would be a picture of a viewport nobody has.
     */
    await growPastTheFold(page);
    await expectNoImagesClipped(page, '[data-testid="tech-track-head_of_growth"]');
    await expectNoImagesClipped(page, '[data-testid="research-tracks"]');
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
  await page.getByTestId('research-tab-programmes').click();
  await expect(page.getByText('Every track on every trade is shut without one.')).toBeVisible();
});
