import { expect, test, type Page } from '@playwright/test';
import {
  MAX_MUSTER_QUEUE,
  UNIT_CATALOG,
  musterCost,
  type MusterOrder,
  type ResearchResponse,
} from '@frontline/shared';
import { activeResearch, fullQueue, lateGame, trainingResponse, unitsResponse } from './fixtures';
import { expectNothingClippedHorizontally, installApi, settleFonts } from './harness';

/**
 * Every queue holds still (maintainer, 2026-10-08).
 *
 * A queue draws its places as boxes of a fixed size, and the X that calls an entry off lives in a
 * cell inside the entry's own box: the cell keeps its room after the window shuts and the X has
 * faded out of it. So ordering something, a window shutting and an order landing all leave the
 * page where it was. These are the measurements that say so, at every viewport the game is played
 * at, and the screenshots a reviewer looks at.
 */

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

/** The longest names the catalogue has, so a slot is measured at its widest. */
const LONG_NAMED = [...Object.values(UNIT_CATALOG)]
  // Units a crew pays for: an order with nothing paid has nothing to refund and wears no X.
  .filter((unit) => Object.keys(musterCost(unit, 1)).length > 0)
  .sort((a, b) => b.name.length - a.name.length)
  .slice(0, MAX_MUSTER_QUEUE);

/**
 * `count` orders on the bench, chained the way the server queues them off the fixture's clock.
 * The first is ten seconds into a ten-minute batch, inside its tenth, so it wears the X.
 */
function benchOf(count: number): MusterOrder[] {
  const now = Date.parse(unitsResponse.serverNow);
  let startsAt = now - 10_000;
  return LONG_NAMED.slice(0, count).map((unit, index) => {
    const durationSeconds = 600;
    const order: MusterOrder = {
      id: `q-${index + 1}`,
      unitId: unit.id,
      count: 10,
      delivered: 0,
      paid: musterCost(unit, 10),
      startedAt: new Date(startsAt).toISOString(),
      durationSeconds,
    };
    startsAt += durationSeconds * 1000;
    return order;
  });
}

async function box(page: Page, testId: string) {
  const found = await page.getByTestId(testId).boundingBox();
  if (!found) throw new Error(`${testId} has no box`);
  return found;
}

for (const viewport of VIEWPORTS) {
  const tag = `${viewport.width}x${viewport.height}`;

  test.describe(`queues at ${tag}`, () => {
    test.use({ viewport });

    test('the bench is the same size empty, part-full and full, and the roster never moves', async ({
      page,
    }) => {
      await installApi(page, lateGame);
      const seen: { height: number; rosterTop: number }[] = [];
      for (const orders of [0, 2, MAX_MUSTER_QUEUE]) {
        await page.route('**/api/units', (route) =>
          route.fulfill({ json: { ...unitsResponse, queue: benchOf(orders) } }),
        );
        await page.goto('/game/units');
        await expect(page.getByTestId('muster-queue')).toBeVisible();
        await settleFonts(page);
        await expect(page.getByTestId('muster-queue').getByRole('listitem')).toHaveCount(
          MAX_MUSTER_QUEUE,
        );
        // Every batch on the bench can be called off: the first in its tenth, the rest queued.
        for (let place = 1; place <= orders; place += 1) {
          await expect(page.getByTestId(`cancel-q-${place}`)).toBeVisible();
        }
        await expectNothingClippedHorizontally(page);
        // Nothing in a place runs past its edge or is cut short with an ellipsis.
        const spilled = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[data-testid="muster-queue"] > li')].flatMap(
            (place) => {
              const edge = place.getBoundingClientRect();
              return [...place.querySelectorAll<HTMLElement>('span')]
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  return (
                    el.scrollWidth > el.clientWidth + 1 ||
                    r.top < edge.top - 0.5 ||
                    r.bottom > edge.bottom + 0.5 ||
                    r.right > edge.right + 0.5
                  );
                })
                .map((el) => el.textContent ?? '');
            },
          ),
        );
        expect(spilled).toEqual([]);
        // The X floats in a corner, so it must land on no text and leave the bar full width.
        const covered = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[data-testid^="cell-cancel-q-"]')].flatMap(
            (cell) => {
              const c = cell.getBoundingClientRect();
              const place = cell.closest('li');
              return [...(place?.querySelectorAll<HTMLElement>('span') ?? [])]
                .filter((el) => !cell.contains(el) && el.childElementCount === 0)
                .filter((el) => (el.textContent ?? '').trim() !== '')
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  return (
                    r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top
                  );
                })
                .map((el) => el.textContent ?? '');
            },
          ),
        );
        expect(covered).toEqual([]);
        const bench = await box(page, 'muster-queue');
        const roster = await page.getByTestId('tier-vehicles').boundingBox();
        seen.push({ height: bench.height, rosterTop: roster?.y ?? -1 });
        await page.screenshot({ path: `screenshots/visual/queue-bench-${orders}-${tag}.png` });
        await page.unroute('**/api/units');
      }
      for (const one of seen) expect(one).toEqual(seen[0]);
    });

    test('only the batch being worked counts down; the one behind it holds its time', async ({
      page,
    }) => {
      await installApi(page, lateGame);
      await page.route('**/api/units', (route) =>
        route.fulfill({ json: { ...unitsResponse, queue: benchOf(2) } }),
      );
      await page.goto('/game/units');
      await expect(page.getByTestId('bench-q-2')).toBeVisible();
      const clock = (id: string) =>
        page.getByTestId(`bench-${id}`).locator('.text-brass-300').first().textContent();
      const before = { first: await clock('q-1'), second: await clock('q-2') };
      expect(before.second).toBe('10m');
      await expect.poll(() => clock('q-1'), { timeout: 5_000 }).not.toBe(before.first);
      expect(await clock('q-2')).toBe(before.second);
      await expect(page.getByTestId('cancel-q-2-window')).toHaveText('queued');
    });

    test('every order on the district rail is the same plate, X or no X', async ({ page }) => {
      await installApi(page, fullQueue);
      await page.goto('/game/base');
      await expect(page.getByTestId('build-rail-orders')).toBeVisible();
      await settleFonts(page);
      const plates = page.getByTestId('build-rail-orders').locator('[data-testid^="build-rail-"]');
      await expect(plates).toHaveCount(fullQueue.base!.buildQueue.length);
      const heights = new Set<number>();
      const widths = new Set<number>();
      for (const plate of await plates.all()) {
        const measured = await plate.boundingBox();
        if (!measured) continue;
        heights.add(Math.round(measured.height));
        widths.add(Math.round(measured.width));
      }
      expect([...heights]).toHaveLength(1);
      expect([...widths]).toHaveLength(1);
      // The order being worked is past its tenth and the last one, which nothing behind it leans
      // on, is not: the plates above compare a shut cell with an open one.
      await expect(page.getByTestId('cancel-build-bq-full-1')).toHaveCount(0);
      await expect(page.getByTestId('cancel-build-bq-full-5')).toBeVisible();
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/queue-district-${tag}.png` });
    });

    test('the plot window keeps its size when the order under way is called off', async ({
      page,
    }) => {
      await installApi(page, lateGame);
      await page.goto('/game/base');
      await page.getByTestId('plot-greenhouse').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('structure-under-way-greenhouse')).toBeVisible();
      await settleFonts(page);
      await page.screenshot({ path: `screenshots/visual/queue-plot-busy-${tag}.png` });
      const busy = await dialog.boundingBox();

      await dialog.getByTestId('structure-cancel-bq-2').click();
      await expect(dialog.getByTestId('structure-under-way-greenhouse')).toHaveCount(0);
      await expect(dialog.getByText('Nothing under way')).toBeVisible();
      await page.screenshot({ path: `screenshots/visual/queue-plot-idle-${tag}.png` });
      const idle = await dialog.boundingBox();
      expect(idle).toEqual(busy);
      // The whole price on one line.
      const line = await dialog.getByTestId('cost-line').boundingBox();
      expect(line?.height ?? 99).toBeLessThan(24);
    });

    test("a crew's X sits in the card's corner and the card runs full width", async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/missions');
      await expect(page.getByTestId('crews-in-flight')).toBeVisible();
      await settleFonts(page);
      const x = page.getByTestId('recall-mission-m-1');
      await expect(x).toBeVisible();
      const card = page.locator('li', { has: x }).first();
      const edge = await card.boundingBox();
      const track = await page.getByTestId('mission-track-m-1').boundingBox();
      // The readout is as wide as the card: no column held back for the X.
      expect(Math.abs((track?.width ?? 0) - (edge?.width ?? 0))).toBeLessThanOrEqual(2);
      const mark = await x.boundingBox();
      expect(
        (edge?.y ?? 0) + (edge?.height ?? 0) - ((mark?.y ?? 0) + (mark?.height ?? 0)),
      ).toBeLessThan(30);
      // ...and lands on nothing: no line of the card runs under the X or its countdown.
      const under = await page.evaluate(() => {
        const cell = document.querySelector('[data-testid="cell-recall-mission-m-1"]');
        const card = cell?.closest('li');
        if (!cell || !card) return ['no cell'];
        const c = cell.getBoundingClientRect();
        return [...card.querySelectorAll<HTMLElement>('span, p')]
          .filter((el) => !cell.contains(el) && el.childElementCount === 0)
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.left < c.right &&
              r.right > c.left &&
              r.top < c.bottom &&
              r.bottom > c.top
            );
          })
          .map((el) => el.textContent ?? '');
      });
      expect(under).toEqual([]);
      await page.screenshot({ path: `screenshots/visual/queue-missions-${tag}.png` });
    });

    test('the training floor is the same height empty and full', async ({ page }) => {
      const heights: number[] = [];
      for (const floor of [0, 3]) {
        await installApi(page, lateGame, floor === 0 ? {} : { underWay: { floor } });
        if (floor === 0) {
          // Nobody on the floor: the fixture's one drill is taken off.
          await page.route('**/api/training', (route) =>
            route.fulfill({
              json: {
                ...trainingResponse,
                queueSlots: 3,
                subjects: trainingResponse.subjects.map((one) => ({ ...one, session: null })),
              },
            }),
          );
        }
        await page.goto('/game/training');
        await expect(page.getByTestId('training-underway')).toBeVisible();
        await settleFonts(page);
        heights.push((await box(page, 'training-underway')).height);
        await expectNothingClippedHorizontally(page);
        await page.screenshot({ path: `screenshots/visual/queue-training-${floor}-${tag}.png` });
        await page.unrouteAll();
      }
      expect(heights[1]).toBe(heights[0]);
    });

    test('the research cancel is a box of its own, the same size open and shut', async ({
      page,
    }) => {
      await installApi(page, lateGame);
      const sizes: { width: number; height: number }[] = [];
      for (const into of [0.01, 0.5]) {
        const live = activeResearch();
        const minutes = live.active!.durationMinutes;
        const now = Date.now();
        const body: ResearchResponse = {
          ...live,
          serverNow: new Date(now).toISOString(),
          active: {
            ...live.active!,
            startedAt: new Date(now - into * minutes * 60_000).toISOString(),
          },
        };
        await page.route('**/api/research', (route) => route.fulfill({ json: body }));
        await page.goto('/game/research');
        await expect(page.getByTestId('research-progress')).toBeVisible();
        await settleFonts(page);
        if (into < 0.1) await expect(page.getByTestId('cancel-research')).toBeVisible();
        else await expect(page.getByTestId('closed-cancel-research')).toBeVisible();
        const measured = await box(page, 'box-cancel-research');
        sizes.push({ width: measured.width, height: measured.height });
        await page.screenshot({
          path: `screenshots/visual/queue-research-${into < 0.1 ? 'open' : 'shut'}-${tag}.png`,
        });
        await page.unroute('**/api/research');
      }
      expect(sizes[1]).toEqual(sizes[0]);
    });
  });
}

/**
 * The Carriers tab fits on one screen (maintainer, 2026-10-08): the bench and the gaps above the
 * roster were tightened for it. Pinned at the sizes it fits at; below about 1728x1000 the two cards
 * are taller than the window and the page scrolls, which the maintainer chose to keep.
 */
for (const viewport of [
  { width: 1728, height: 1000 },
  { width: 1920, height: 1080 },
] as const) {
  test.describe(`the Carriers tab at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('fits without a scrollbar', async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/units');
      await expect(page.getByTestId('muster-queue')).toBeVisible();
      await settleFonts(page);
      const hidden = await page.getByTestId('bench').evaluate((bench) => {
        let el: HTMLElement | null = bench.parentElement;
        while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
        return el ? el.scrollHeight - el.clientHeight : 0;
      });
      expect(hidden).toBeLessThanOrEqual(1);
    });
  });
}
