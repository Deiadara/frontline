import { expect, test, type Page } from '@playwright/test';
import { officerPortraitId, type TrainingResponse } from '@frontline/shared';
import { lateGame, trainingResponse } from './fixtures';
import { expectNothingClippedHorizontally, installApi, settleFonts } from './harness';

/**
 * The Training tab's faces, their marks, and the line the cancel lives on (maintainer, 2026-10-04).
 *
 * Three claims a browser has to answer. Every person on the rail wears a painted face, the bench
 * included: the tab once drew a benched officer through the Overseer's frame and got a blank
 * silhouette. A seated officer's mark sits on their portrait's corner without leaving the row.
 * And the title bar is one height whether the person is free, on a drill, or on a drill they can
 * still call off, so the floor under it lands on the same pixel in all three.
 */

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const;

/** The fixture plus somebody on the bench, with a face off the pool like everybody else. */
function withTheBench(training: TrainingResponse): TrainingResponse {
  const officer = training.subjects[1]!;
  return {
    ...training,
    subjects: [
      ...training.subjects,
      {
        ...officer,
        id: 'officer-bench',
        name: 'Nadia Ferrand',
        role: 'Bench',
        officerRole: null,
        mark: null,
        portraitId: officerPortraitId('officer-bench'),
        injuredUntil: null,
        session: null,
      },
    ],
  };
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} has no box`);
  return box;
}

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;

  test.describe(`training faces at ${tag}`, () => {
    test.use({ viewport: size });

    test('everybody on the rail wears a painted face, the bench included', async ({ page }) => {
      await installApi(page, lateGame);
      // After the harness, so this answers the board first.
      await page.route('**/api/training', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ json: withTheBench(trainingResponse) })
          : route.fallback(),
      );
      await page.goto('/game/training');
      await expect(page.getByTestId('training-subject-officer-bench')).toBeVisible();
      await settleFonts(page);

      const faces = await page
        .getByTestId('training-subjects')
        .locator('[data-testid^="training-subject-"]')
        .evaluateAll((rows) =>
          rows.map((row) => {
            const img = row.querySelector('img');
            return {
              who: row.getAttribute('data-testid'),
              painted: img !== null && img.complete && img.naturalWidth > 0,
              frame: row.querySelector('[data-face]')?.getAttribute('data-face'),
            };
          }),
        );
      expect(faces).toHaveLength(3);
      for (const face of faces) expect(face.painted, `${face.who} has no face`).toBe(true);
      expect(faces.find((face) => face.who === 'training-subject-officer-bench')?.frame).toBe(
        'officer',
      );

      await page.getByTestId('training-subject-officer-bench').click();
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/training-faces/bench-${tag}.png` });
    });

    test("a seated officer's mark sits on their portrait's corner, inside the row", async ({
      page,
    }) => {
      await installApi(page, lateGame);
      await page.goto('/game/training');
      await expect(page.getByTestId('training-subjects')).toBeVisible();
      await settleFonts(page);

      const row = page.getByTestId('training-subject-officer-1');
      const stamp = row.getByTestId('mark-stamp-C+');
      await expect(stamp).toBeVisible();
      // The Overseer is graded on their own seat (2026-10-04), so their row carries a stamp too,
      // inside the row and on the top half of their face.
      const overseerRow = page.getByTestId('training-subject-overseer');
      const overseerStamp = overseerRow.getByTestId('mark-stamp-B-');
      await expect(overseerStamp).toBeVisible();
      const overseerRowBox = await overseerRow.boundingBox();
      const overseerStampBox = await overseerStamp.boundingBox();
      if (!overseerRowBox || !overseerStampBox) throw new Error("the Overseer's row lost a box");
      expect(overseerStampBox.x).toBeGreaterThanOrEqual(overseerRowBox.x);
      expect(overseerStampBox.x + overseerStampBox.width).toBeLessThanOrEqual(
        overseerRowBox.x + overseerRowBox.width,
      );
      expect(overseerStampBox.y + overseerStampBox.height).toBeLessThanOrEqual(
        overseerRowBox.y + overseerRowBox.height,
      );

      const rowBox = await row.boundingBox();
      const stampBox = await stamp.boundingBox();
      const faceBox = await row.getByTestId('training-face-officer-1').boundingBox();
      if (!rowBox || !stampBox || !faceBox) throw new Error('the row lost a box');
      // Inside the row it is drawn on.
      expect(stampBox.x).toBeGreaterThanOrEqual(rowBox.x);
      expect(stampBox.y).toBeGreaterThanOrEqual(rowBox.y);
      expect(stampBox.x + stampBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
      expect(stampBox.y + stampBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
      // In the top right corner of the face, where the painting is background: its centre is
      // right of the face's middle and above the eyes, which sit about two fifths down.
      expect(stampBox.x + stampBox.width / 2).toBeGreaterThan(faceBox.x + faceBox.width * 0.75);
      expect(stampBox.y + stampBox.height / 2).toBeLessThan(faceBox.y + faceBox.height * 0.25);
      // Small beside the face it marks.
      expect(stampBox.width).toBeLessThan(faceBox.width * 0.6);

      // The banner wears it too, wherever the screen is tall enough to draw the banner's face.
      await row.click();
      const stamps = page.getByTestId('mark-stamp-C+');
      await expect(stamps).toHaveCount(2);
      if (size.height > 820) await expect(stamps.nth(1)).toBeVisible();
      await page.screenshot({ path: `screenshots/training-faces/mark-${tag}.png` });
    });

    test('the floor lands on the same pixel free, on a drill, and with the X', async ({ page }) => {
      // A minute into the hour: the X is live on the Overseer's drill.
      const startedAt = new Date(Date.parse(trainingResponse.serverNow) - 60_000).toISOString();
      await installApi(page, lateGame, { underWay: { drill: { startedAt } } });
      await page.goto('/game/training');
      await expect(page.getByTestId('cancel-drill')).toBeVisible();
      await settleFonts(page);
      const withX = await boxOf(page, 'training-floor');
      const drillWithX = await boxOf(page, 'training-in-flight');
      await page.screenshot({ path: `screenshots/training-faces/cancel-${tag}.png` });

      // Called off, which leaves the same person free. The same person on purpose: the Overseer's
      // face is 3:4 and an officer's 4:5, so on a screen tall enough to draw it the banner is a
      // few pixels taller for the Overseer whatever the drill is doing.
      await page.getByTestId('cancel-drill').click();
      await expect(page.getByTestId('training-in-flight')).toHaveCount(0);
      // Gone once the fade is over, not before.
      await expect(page.getByTestId('cancel-drill')).toHaveCount(0);
      const free = await boxOf(page, 'training-floor');
      await page.screenshot({ path: `screenshots/training-faces/free-${tag}.png` });

      // The standing fixture: twenty minutes in, past the window, so no X.
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await installApi(page, lateGame);
      await page.goto('/game/training');
      await expect(page.getByTestId('training-in-flight')).toBeVisible();
      await expect(page.getByTestId('cancel-drill')).toHaveCount(0);
      await settleFonts(page);
      const noX = await boxOf(page, 'training-floor');
      const drillNoX = await boxOf(page, 'training-in-flight');
      await page.screenshot({ path: `screenshots/training-faces/drill-${tag}.png` });

      expect.soft(free, 'the floor moved when the person was free').toEqual(withX);
      expect.soft(noX, 'the floor moved when the X went').toEqual(withX);
      // Nor does the drill's own line slide sideways: the countdowns read 59m 1s and 40m 1s, the
      // same width in tabular figures, so the line sits on the same pixel both times.
      expect.soft(drillNoX.x, 'the drill line slid when the X went').toBeCloseTo(drillWithX.x, 1);
      expect.soft(drillNoX.y, 'the drill line moved when the X went').toBeCloseTo(drillWithX.y, 1);
    });
  });
}
