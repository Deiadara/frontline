import { AUTOMATION_RUNGS, type AutomationsResponse } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { lateGame } from './fixtures';
import {
  expectNothingClippedVertically,
  expectNothingOverflowsTheScreen,
  installApi,
  settleFonts,
} from './harness';

/**
 * The Right Hand's standing orders, on the Monitor's third page (§C2b, 2026-09-22).
 *
 * The world clock does the work and a unit test proves it; what a browser can add is the sheet
 * itself: that a crew without the rung meets a shut door naming it, that a crew with it gets a
 * form it can fill and switch on, that the state line reads what the poll says, and that the
 * mission board says whose it is while an order is on.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const NOW = '2026-09-22T12:00:00.000Z';

function response(over: Partial<AutomationsResponse> = {}): AutomationsResponse {
  return {
    powers: {
      unlocked: true,
      slots: 2,
      cooldownMs: 15 * 60_000,
      bestFit: true,
      optimise: true,
      orders: ['missions', 'battles', 'mixed'],
    },
    slots: [
      {
        id: 'auto-0',
        baseId: lateGame.base?.id ?? 'base-1',
        slot: 0,
        kind: 'missions',
        enabled: true,
        order: 'mixed',
        step: 1,
        force: {},
        officerId: null,
        unitSlots: 8,
        optimiseFor: 'caps',
        missionId: null,
        restingSince: new Date(Date.parse(NOW) - 4 * 60_000).toISOString(),
        stalled: null,
      },
    ],
    officers: (lateGame.base?.commanders ?? []).slice(0, 3).map((one) => ({
      id: one.id,
      name: one.name,
      role: one.role,
    })),
    serverNow: NOW,
    ...over,
  };
}

async function open(page: Page, body: AutomationsResponse): Promise<void> {
  await installApi(page, lateGame);
  await page.route('**/api/automations', (route) => route.fulfill({ json: body }));
  await page.goto('/game/actions/automations');
  await settleFonts(page);
}

test('a crew without the rung meets a shut door that names it', async ({ page }) => {
  await open(
    page,
    response({
      powers: {
        unlocked: false,
        slots: 0,
        cooldownMs: 15 * 60_000,
        bestFit: false,
        optimise: false,
        orders: ['missions'],
      },
      slots: [],
    }),
  );
  const door = page.getByTestId('automations-locked');
  await expect(door).toBeVisible();
  await expect(door).toContainText('The Open Door');
  await expect(page.getByTestId('monitor-tab-automations')).toBeVisible();
  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'screenshots/automations/locked.png' });
});

test('a crew with the ladder gets its slots, the ladder, and a live state line', async ({
  page,
}) => {
  await open(page, response());
  await expect(page.getByTestId('automations-ladder')).toBeVisible();
  // Every rung on the strip is a real one, and the earned ones read as earned.
  for (const rung of Object.values(AUTOMATION_RUNGS)) {
    await expect(page.getByTestId(`ladder-${rung}`)).toBeVisible();
  }
  await expect(page.getByTestId(`ladder-${AUTOMATION_RUNGS.open}`)).toHaveAttribute(
    'data-open',
    'yes',
  );

  // Slot one is on and resting: four minutes into a fifteen-minute gap.
  const first = page.getByTestId('automation-0');
  await expect(first).toHaveAttribute('data-enabled', 'yes');
  await expect(first).toContainText(/Resting/i);
  await expect(page.getByTestId('automation-0-off')).toBeVisible();
  // Slot two is untouched and can be filled.
  const second = page.getByTestId('automation-1');
  await expect(second).toHaveAttribute('data-enabled', 'no');
  await expect(page.getByTestId('automation-1-on')).toBeDisabled();

  await expectNothingOverflowsTheScreen(page);
  await expectNothingClippedVertically(page, '[data-testid="automations"]');
  await page.screenshot({ path: 'screenshots/automations/open.png' });
});

test('naming a party and an officer makes the switch pressable, and posts the whole slot', async ({
  page,
}) => {
  await open(page, response({ slots: [] }));
  const posted: unknown[] = [];
  await page.route('**/api/automations', (route) => {
    if (route.request().method() === 'POST') {
      posted.push(route.request().postDataJSON());
      return route.fulfill({ json: response() });
    }
    return route.fulfill({ json: response({ slots: [] }) });
  });

  const slot = page.getByTestId('automation-0');
  await expect(page.getByTestId('automation-0-on')).toBeDisabled();
  const unitInput = slot.locator('[data-testid^="automation-0-unit-"]').first();
  await unitInput.fill('4');
  // The game's own picker: a button that portals a listbox, not a native `<select>`.
  await page.getByTestId('automation-0-officer').click();
  await page.getByRole('option').first().click();
  await expect(page.getByTestId('automation-0-on')).toBeEnabled();
  await page.getByTestId('automation-0-on').click();

  await expect.poll(() => posted.length).toBe(1);
  const body = posted[0] as { slot: number; enabled: boolean; force: Record<string, number> };
  expect(body.slot).toBe(0);
  expect(body.enabled).toBe(true);
  expect(Object.values(body.force)).toEqual([4]);
});

/**
 * The three the maintainer hit in a real browser on 2026-09-23.
 *
 * Every one of them was invisible to the unit tests, which mount the sheet, act and assert inside
 * one tick: the form only lost what had been typed once a five-second poll answered, and "Best
 * fit" only looked broken because that same answer knocked the choice back.
 */
test('a poll landing under the player does not wipe the form', async ({ page }) => {
  await open(page, response({ slots: [] }));
  const slot = page.getByTestId('automation-0');
  await slot.locator('[data-testid^="automation-0-unit-"]').first().fill('4');
  await page.getByTestId('automation-0-officer').click();
  await page.getByRole('option').first().click();
  await expect(page.getByTestId('automation-0-on')).toBeEnabled();

  // Two answers from the five-second poll, which is what used to put it all back to nothing.
  await page.waitForTimeout(11_000);
  await expect(slot.locator('[data-testid^="automation-0-unit-"]').first()).toHaveValue('4');
  await expect(page.getByTestId('automation-0-on')).toBeEnabled();
});

test('best fit stays chosen and shows nothing of what it will send', async ({ page }) => {
  await open(page, response({ slots: [] }));
  await page.getByTestId('automation-0-bestfit').click();
  await expect(page.getByTestId('automation-0-bestfit')).toHaveAttribute('aria-pressed', 'true');
  const sheet = page.getByTestId('automation-0');
  // Unit slots, not units, and the three quick amounts beside the field.
  await expect(sheet).toContainText('Unit slots to send');
  await expect(page.getByTestId('automation-0-size-quarter')).toBeVisible();
  await expect(page.getByTestId('automation-0-size-half')).toBeVisible();
  await expect(page.getByTestId('automation-0-size-all')).toBeVisible();
  // Nothing about who goes: the maintainer's rule is that the player trusts the chair.
  await expect(sheet).not.toContainText(/As things stand|Razors|Scavengers/);
  await expect(page.getByTestId('automation-0-preview')).toHaveCount(0);
  // And it survives the poll that used to send it back to "This party".
  await page.waitForTimeout(11_000);
  await expect(page.getByTestId('automation-0-bestfit')).toHaveAttribute('aria-pressed', 'true');
  // Off the control, so the shot shows the row and not the hover explaining it.
  await page.mouse.move(5, 5);
  await expect(page.getByTestId('tooltip')).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/automations/best-fit.png' });
});

test('every rung on the strip explains itself on hover', async ({ page }) => {
  await open(page, response());
  await page.getByTestId(`ladder-${AUTOMATION_RUNGS.optimise}`).hover();
  const tip = page.getByTestId('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(/per minute/i);
  // The gap is on the rung that buys it rather than on a line of its own in the heading.
  await page.getByTestId(`ladder-${AUTOMATION_RUNGS.fastCooldown}`).hover();
  await expect(page.getByTestId('tooltip')).toContainText(/fifteen minutes to five/i);
  await expect(page.getByTestId('automations-ladder')).not.toContainText(/Gap between parties/i);
});

test('the mission board says whose it is while an order is on', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/automations', (route) => route.fulfill({ json: response() }));
  await page.goto('/game/missions');
  await settleFonts(page);
  await expect(page.getByTestId('board-automated')).toBeVisible();
  // Every send on the board is shut, and says why rather than "no crew free".
  const sends = page.locator('[data-testid^="send-"]');
  await expect(sends.first()).toBeDisabled();
  await expect(sends.first()).toContainText(/Right Hand/i);
  await page.screenshot({ path: 'screenshots/automations/board-locked.png' });
});
