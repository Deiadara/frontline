/**
 * The Sounds bar on the settings screen.
 *
 * Three things here can only be answered by a browser. The bar is painted rather than a native
 * `<input type="range">`, so the thing a keyboard user gets is a div with `role="slider"` on it and
 * arrow handlers written by hand: whether that is actually operable is not a question jsdom can
 * settle. The save is a round trip. And the audio unlock is a real user gesture, which is the one
 * event Playwright can produce and a unit test cannot.
 *
 * What is deliberately *not* asserted is that a noise came out. Nothing in a headless browser can
 * hear, and a test that stubbed `AudioContext` and then asserted the stub was called would be
 * testing itself. `data-sound-ready` is the honest half: the gesture arrived, the context was
 * built, and the buffers were asked for. The rest is the board's ears.
 */
import { expect, test, type Page } from '@playwright/test';
import { me } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

/** The three the maintainer reads the filter panel at (2026-09-15). */
const PANEL_VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

type Size = { readonly width: number; readonly height: number };

/** What the fixture opens on: `DEFAULT_SOUND_VOLUME`, through `me.user`. */
const START = me.user.soundVolume;

async function openSettings(page: Page, size: Size = VIEWPORTS[1]): Promise<void> {
  await page.setViewportSize(size);
  await installApi(page, me);
  await page.goto('/game/settings');
  await expect(page.getByTestId('settings-sounds-panel')).toBeVisible();
  await settleFonts(page);
}

const bar = (page: Page) => page.getByTestId('settings-sound-volume');

test('the bar is drawn at the account’s level, and it is not a native range input', async ({
  page,
}) => {
  await openSettings(page);

  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveAttribute('aria-valuenow', String(START));
  await expect(bar(page)).toHaveAttribute('aria-valuemin', '0');
  await expect(bar(page)).toHaveAttribute('aria-valuemax', '100');
  await expect(page.getByTestId('settings-sound-percent')).toHaveText(`${START}%`);

  // The whole reason this control is hand-drawn. A native range brings three vendors' shadow DOM
  // with it and looks like a browser widget dropped onto a painted screen.
  await expect(page.locator('input[type="range"]')).toHaveCount(0);

  // The fill is a real fraction of the track rather than a full bar with a knob parked on it.
  const filled = await page.evaluate(() => {
    const track = document.querySelector('[data-testid="settings-sound-volume"] div');
    const fill = track?.firstElementChild;
    if (!track || !fill) return null;
    return fill.getBoundingClientRect().width / track.getBoundingClientRect().width;
  });
  expect(filled).not.toBeNull();
  expect(filled!).toBeCloseTo(START / 100, 1);
});

test('the bar takes the keyboard', async ({ page }) => {
  await openSettings(page);

  await bar(page).focus();
  await expect(bar(page)).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(bar(page)).toHaveAttribute('aria-valuenow', String(START + 5));
  await expect(page.getByTestId('settings-sound-percent')).toHaveText(`${START + 5}%`);

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(bar(page)).toHaveAttribute('aria-valuenow', String(START - 5));

  // Both ends are reachable without holding an arrow down for twenty seconds, and neither runs off.
  await page.keyboard.press('End');
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '100');
  await page.keyboard.press('ArrowRight');
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '100');

  await page.keyboard.press('Home');
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('ArrowLeft');
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '0');

  await page.keyboard.press('PageUp');
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '20');
});

test('the bar moves under the pointer', async ({ page }) => {
  await openSettings(page);

  const box = await bar(page).boundingBox();
  expect(box).not.toBeNull();
  /*
   * `locator.click` with an offset, never `page.mouse.click` at the box's coordinates.
   *
   * The settings sheet scrolls and the bottom nav is fixed over the foot of the window, so the
   * coordinates a `boundingBox()` returns for a panel further down the page are a point the player
   * cannot reach and, worse, one the nav is sitting on. Clicking there navigated to the city and
   * the failure read as the whole screen vanishing. The locator scrolls the bar into view, checks
   * it actually receives the pointer, and takes the offset from where the element ended up.
   *
   * A quarter of the way along, and the assertion is a band rather than a percent, because the
   * track is inset from the box by its own padding.
   */
  await bar(page).click({ position: { x: box!.width * 0.25, y: box!.height / 2 } });

  const now = Number(await bar(page).getAttribute('aria-valuenow'));
  expect(now).toBeGreaterThan(15);
  expect(now).toBeLessThan(35);
});

test('saving sends the new level and the screen keeps it', async ({ page }) => {
  await openSettings(page);

  const patch = page.waitForRequest(
    (request) => request.url().includes('/api/settings/profile') && request.method() === 'PATCH',
  );

  await bar(page).focus();
  await page.keyboard.press('End');
  await page.getByTestId('settings-sounds-panel').getByRole('button', { name: /save/i }).click();

  // The body carries the volume and nothing else: this panel is one transaction, and a Save here
  // must not quietly rewrite the clock or the glyph the other panels are holding.
  const body = (await patch).postDataJSON() as Record<string, unknown>;
  expect(body).toEqual({ soundVolume: 100 });

  await expect(page.getByTestId('settings-sounds-panel').getByRole('status')).toHaveText('Saved.');
  // Read back off the record the stubbed route now answers with, so a save that landed in the
  // request and nowhere else would still fail here.
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByTestId('settings-sound-percent')).toHaveText('100%');
});

test('the first gesture unlocks the audio context', async ({ page }) => {
  await openSettings(page);

  // Nothing may be built before the player touches the page: a context created on load starts
  // suspended, and Chrome logs a warning about it on every visit.
  await expect(page.locator('html')).not.toHaveAttribute('data-sound-ready', '');

  // On the panel heading rather than on a control, so this measures the gesture and not a click
  // handler somewhere doing the work.
  await page.getByTestId('settings-sounds-panel').getByText('Sounds').click();
  await expect(page.locator('html')).toHaveAttribute('data-sound-ready', '');
});

for (const size of VIEWPORTS) {
  test(`the clock and sounds panels lay out cleanly at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await openSettings(page, size);

    await expect(page.getByTestId('settings-clock-panel')).toBeVisible();
    await expect(page.getByTestId('settings-sounds-panel')).toBeVisible();
    await expectNothingOverflowsTheScreen(page);

    // The knob hangs half its own width past each end of the track by design, so what matters is
    // that it stays inside the bar's own box at both ends of the travel.
    for (const key of ['Home', 'End']) {
      await bar(page).focus();
      await page.keyboard.press(key);
      const inside = await page.evaluate(() => {
        const box = document.querySelector('[data-testid="settings-sound-volume"]');
        const knob = box?.querySelector('span[aria-hidden]');
        if (!box || !knob) return null;
        const outer = box.getBoundingClientRect();
        const at = knob.getBoundingClientRect();
        return at.left >= outer.left - 0.5 && at.right <= outer.right + 0.5;
      });
      expect(inside, `the knob escapes its bar at ${key}`).toBe(true);
    }
  });
}

/**
 * The page says what the maintainer asked it to say (2026-09-15), in a real browser: the unit test
 * pins the same strings, and this is the copy the screenshots below are read against.
 */
test('the sheet opens on the city line, names its panels, and carries no standing note', async ({
  page,
}) => {
  await openSettings(page);

  await expect(page.getByText('The only part that the city allows you to control')).toBeVisible();
  await expect(page.getByTestId('info-note')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Sound Preferences' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Password' })).toBeVisible();
  await expect(page.getByText(/passphrase/i)).toHaveCount(0);
});

/**
 * The filter panel's contents stay inside its frame.
 *
 * `NotificationFilters` used to be handed the panel's whole box, with none of the `p-4` the other
 * three panels inset their bodies by, so its lead line and its rows ran flush against the drawn
 * edge and read as outside it (maintainer report, 2026-09-15). Nothing was geometrically outside
 * the panel, which is why `expectNothingOverflowsTheScreen` never said a word: the failure is a
 * body that ignores the panel's own gutter. So the measure is the head's gutter. The heading is
 * set `px-4` from the frame, and every element in the body has to sit inside the same margins,
 * left and right, and inside the panel top to bottom. Take the `p-4` off the body and this goes
 * red at every size.
 */
for (const size of PANEL_VIEWPORTS) {
  test(`the Sound Preferences panel keeps its rows inside its frame at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await openSettings(page, size);

    const panel = page.getByTestId('settings-notify-panel');
    await expect(panel.getByRole('heading', { name: 'Sound Preferences' })).toBeVisible();
    await expect(page.getByTestId('notification-settings')).toBeVisible();
    await expectNothingOverflowsTheScreen(page);

    const escaped = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="settings-notify-panel"]');
      const body = document.querySelector<HTMLElement>('[data-testid="settings-notify-body"]');
      const head = panel?.querySelector('h2')?.parentElement;
      if (!panel || !body || !head) return ['the panel, its head or its body is missing'];
      const frame = panel.getBoundingClientRect();
      const headBox = head.getBoundingClientRect();
      const headStyle = getComputedStyle(head);
      const gutter = {
        left: headBox.left + parseFloat(headStyle.paddingLeft),
        right: headBox.right - parseFloat(headStyle.paddingRight),
      };
      return [...body.querySelectorAll<HTMLElement>('*')]
        .filter((el) => el.getClientRects().length > 0)
        .flatMap((el) => {
          const r = el.getBoundingClientRect();
          const faults: string[] = [];
          if (r.left < gutter.left - 0.5)
            faults.push(`left by ${(gutter.left - r.left).toFixed(1)}px`);
          if (r.right > gutter.right + 0.5)
            faults.push(`right by ${(r.right - gutter.right).toFixed(1)}px`);
          if (r.top < frame.top - 0.5)
            faults.push(`above the frame by ${(frame.top - r.top).toFixed(1)}px`);
          if (r.bottom > frame.bottom + 0.5)
            faults.push(`below the frame by ${(r.bottom - frame.bottom).toFixed(1)}px`);
          return faults.length === 0
            ? []
            : [
                `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" ${faults.join(', ')}`,
              ];
        });
    });
    expect(escaped, `content escapes the panel's gutter at ${size.width}`).toEqual([]);
  });
}
