import { expect, test, type Page } from '@playwright/test';
import { INSULT_FRACTION, reservationWage } from '@frontline/shared';
import { adminGame, bar, me } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  expectSheetNotWashedOut,
  installApi,
  settleFonts,
} from './harness';

/**
 * The three things this half added that a player can walk into and get stuck on: the wage
 * negotiation, the screens behind a level, and the painted picker that replaced every `<select>`.
 *
 * All three are *interaction*, which is why they are here rather than in the layout sweeps. A
 * window that renders beautifully and cannot be typed into is a worse defect than one that is
 * three pixels out, and no geometry gate can see it.
 */

/** The recruit the Bar fixture leaves un-negotiated, so a conversation starts from nothing. */
const RECRUIT = 'bar-1';

/**
 * Into the Bar, onto the stool, and along to the person these tests are about.
 *
 * The Bar is a room now rather than a list: the recruits are behind the Sit Down control on the
 * empty seat, one at a time, with an arrow either side. So getting to somebody is two steps, and
 * both belong in the helper rather than in seven copies.
 *
 * Stepping until the right card is on screen rather than stepping a fixed number of times: the
 * roster's order is the fixture's business, and a test that hard-coded an index would break the
 * day somebody added a ninth drinker.
 */
async function openBar(page: Page, recruitId: string = RECRUIT): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, adminGame);
  await page.goto('/game/bar');
  await settleFonts(page);
  await page.getByTestId('sit-down').click();
  await expect(page.getByTestId('bar-file')).toBeVisible();

  const card = page.getByTestId(`recruit-${recruitId}`);
  for (let step = 0; step < bar.recruits.length; step += 1) {
    if ((await card.count()) > 0) return;
    await page.getByTestId('seat-on').click();
  }
  throw new Error(`${recruitId} is not at the bar tonight`);
}

test.describe('haggling (§H7)', () => {
  test('opens on what they are asking: never on what they would settle for', async ({ page }) => {
    await openBar(page);
    await page.getByTestId(`negotiate-${RECRUIT}`).click();

    const asking = bar.recruits.find((recruit) => recruit.id === RECRUIT)?.askingWage ?? 0;
    expect(asking).toBeGreaterThan(0);

    // The prefilled offer must be their *opening* number. Prefilling the reservation would hand
    // the player the one figure the whole negotiation exists to make them work out.
    const field = page.getByLabel(/^Offer to /);
    await expect(field).toHaveValue(String(asking));
    expect(Number(await field.inputValue())).toBeGreaterThan(reservationWage(asking));
    await expect(page.getByTestId('negotiation-standing')).toHaveText(asking.toLocaleString());
  });

  test('answers an offer in the character’s own words, and moves the demand', async ({ page }) => {
    await openBar(page);
    await page.getByTestId(`negotiate-${RECRUIT}`).click();

    const asking = bar.recruits.find((recruit) => recruit.id === RECRUIT)?.askingWage ?? 0;
    const opening = await page.getByTestId('negotiation-transcript').innerText();

    // A real offer, below the floor so it is countered rather than accepted.
    await page.getByLabel(/^Offer to /).fill(String(reservationWage(asking) - 1));
    await page.getByTestId('negotiation-say').click();

    // They said something new, the transcript grew, and the demand came down off the opening.
    await expect(page.getByTestId('negotiation-transcript')).not.toHaveText(opening);
    await expect
      .poll(async () =>
        Number((await page.getByTestId('negotiation-standing').innerText()).replace(/\D/g, '')),
      )
      .toBeLessThan(asking);
  });

  test('an offer at the reservation is taken, and closes the conversation', async ({ page }) => {
    await openBar(page);
    await page.getByTestId(`negotiate-${RECRUIT}`).click();

    const asking = bar.recruits.find((recruit) => recruit.id === RECRUIT)?.askingWage ?? 0;
    await page.getByLabel(/^Offer to /).fill(String(reservationWage(asking)));
    await page.getByTestId('negotiation-say').click();

    // The window stops taking offers and turns into the signature.
    await expect(page.getByTestId('negotiation-say')).toHaveCount(0);
    await expect(page.getByTestId('negotiation-sign')).toBeVisible();
    await expect(page.getByTestId('negotiation-window')).toContainText('Agreed at');
  });

  /**
   * The bug this whole path exists to prevent: **they say yes and never join the crew.**
   *
   * Agreeing a wage used to write the number into the card's *counter-offer* slot: the channel for
   * a refusal, so the card announced "Turned it down" the instant somebody accepted, the window
   * offered a Done button that did nothing but close, and the hire was never sent. Every gate in
   * the suite was green, because `/api/bar/hire` had no fixture handler at all: nothing in the
   * tests could tell a signature from silence.
   *
   * So this asserts the request, not the wording: the agreed wage reaches `POST /api/bar/hire`
   * with a role on it, and the window closes behind it.
   */
  test('signing an agreed wage actually sends the hire, and closes the window', async ({
    page,
  }) => {
    await openBar(page);

    const hires: { recruitId: string; role: string; offerWage: number }[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/bar/hire') && request.method() === 'POST') {
        hires.push(
          request.postDataJSON() as { recruitId: string; role: string; offerWage: number },
        );
      }
    });

    await page.getByTestId(`negotiate-${RECRUIT}`).click();
    const asking = bar.recruits.find((recruit) => recruit.id === RECRUIT)?.askingWage ?? 0;
    const struck = reservationWage(asking);
    await page.getByLabel(/^Offer to /).fill(String(struck));
    await page.getByTestId('negotiation-say').click();

    await expect(page.getByTestId('negotiation-sign-confirm')).toBeEnabled();
    await page.getByTestId('negotiation-sign-confirm').click();

    // The hire went out, at the wage that was agreed, with a role attached.
    await expect.poll(() => hires.length).toBe(1);
    expect(hires[0]?.recruitId).toBe(RECRUIT);
    expect(hires[0]?.offerWage).toBe(struck);
    expect(hires[0]?.role).toBeTruthy();

    // ...and the window is gone, rather than sitting open over a deal that already closed.
    await expect(page.getByTestId('negotiation-window')).toBeHidden();
  });

  /**
   * An accepted deal must never be reported as a rejection on the card behind the window.
   *
   * The inline offer field is gone: the window is the only way to hire now, so the card's one job
   * afterwards is to report what happened in it, and the failure this guards against is it
   * reporting the opposite.
   */
  test('the card calls an agreement an agreement', async ({ page }) => {
    await openBar(page);
    await page.getByTestId(`negotiate-${RECRUIT}`).click();

    const asking = bar.recruits.find((recruit) => recruit.id === RECRUIT)?.askingWage ?? 0;
    await page.getByLabel(/^Offer to /).fill(String(reservationWage(asking)));
    await page.getByTestId('negotiation-say').click();
    await expect(page.getByTestId('negotiation-sign')).toBeVisible();

    // Close without signing: the card is now the only thing telling the player where they stand.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('negotiation-window')).toBeHidden();

    const card = page.getByTestId(`recruit-${RECRUIT}`);
    await expect(card).toContainText('Signed at');
    await expect(card).not.toContainText('Turned it down');
  });

  /**
   * Two conversations, one offer each, and the *difference* between them.
   *
   * The first version of this only checked that patience went down after an insult, which it does
   * after any exchange at all, because every exchange costs one. It passed with
   * `INSULT_PATIENCE_COST` set to zero, which is the whole mechanic switched off. A meter that
   * moves is not the claim; a meter that moves *further* is.
   */
  test('an insult burns patience faster than a near miss does', async ({ page }) => {
    const asking = bar.recruits.find((recruit) => recruit.id === RECRUIT)?.askingWage ?? 0;
    const meter = page.getByRole('progressbar', { name: /will sit here/ });

    const patienceAfter = async (offer: number): Promise<number> => {
      await openBar(page);
      await page.getByTestId(`negotiate-${RECRUIT}`).click();
      await page.getByLabel(/^Offer to /).fill(String(offer));
      await page.getByTestId('negotiation-say').click();
      /*
       * Waited on, not slept on.
       *
       * A fixed 150ms pause was enough alone and not enough inside a full suite run, which is the
       * shape of every flake this file has had: the assertion read the *opening* meter, both
       * readings came back at 100, and "an insult costs more" then compared two identical numbers.
       * A conversation that has had a turn is never at full patience, so leaving 100 is the exact
       * signal that the answer has landed.
       */
      await expect(page.getByTestId('negotiation-transcript')).toContainText(/\S/);
      await expect(meter).not.toHaveAttribute('aria-valuenow', '100');
      return Number(await meter.getAttribute('aria-valuenow'));
    };

    const nearMiss = await patienceAfter(reservationWage(asking) - 1);
    const insult = await patienceAfter(
      Math.max(0, Math.floor(reservationWage(asking) * INSULT_FRACTION) - 1),
    );

    expect(insult, 'an insult must cost more patience than a near miss').toBeLessThan(nearMiss);
    await expect(page.getByTestId('negotiation-window')).toContainText(/Insulted|Gone/);
  });

  test('the window is legible and nothing in it is cut off', async ({ page }) => {
    await openBar(page);
    await page.getByTestId(`negotiate-${RECRUIT}`).click();
    await expect(page.getByTestId('negotiation-window')).toBeVisible();
    await expectNothingClippedVertically(page, '[role="dialog"]');
    await expectNoImagesClipped(page, '[role="dialog"]');
  });
});

test.describe('doors behind a level (§I3)', () => {
  test('a locked screen says which level opens it instead of vanishing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // `me` is the starting crew: level 1, so every gated screen is shut.
    await installApi(page, me);
    await page.goto('/game/bar');
    await settleFonts(page);

    // The door is *there*, and it is the screen's own name that is on it.
    await expect(page.getByText('Opens at level 10')).toBeVisible();
    await expect(page.getByText('You are level')).toBeVisible();
    // And the nav still shows the door rather than removing it.
    await expect(page.getByTestId('nav-the-bar')).toBeVisible();
    await expect(page.getByTestId('nav-locked-bar')).toBeVisible();
    await expectNothingClippedVertically(page);
  });

  test('a crew past the level walks straight in', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installApi(page, adminGame);
    await page.goto('/game/bar');
    await settleFonts(page);

    await expect(page.getByText('Opens at level 10')).toHaveCount(0);
    await expect(page.getByTestId('nav-locked-bar')).toHaveCount(0);
    // The room itself, which is what being through the door means. The payroll book used to stand
    // in for it; it is behind a door on the strip now.
    await expect(page.getByTestId('bar-room')).toBeVisible();
  });
});

test.describe('the painted picker', () => {
  test('opens a drawn list, picks with the keyboard, and closes on escape', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await installApi(page, adminGame);
    await page.goto('/game/market');
    await settleFonts(page);

    // The supply run picks its material off painted tiles now, so the page's remaining `Dropdown`
    // is the composer's item slot: it sits near the bottom of a long sheet, which is the position
    // the bug below actually needed.
    await expect(page.getByRole('radiogroup', { name: 'What to buy with caps' })).toBeVisible();

    const trigger = page.getByTestId('offer-item');
    await trigger.click();

    // A real listbox, drawn by us, not the operating system's menu, which no test can see at all.
    const list = page.getByRole('listbox', { name: 'An item to include in the offer' });
    await expect(list).toBeVisible();

    // Positioned against the viewport. This is the bug that shipped first: `.glass-strong` sets
    // `position: relative` and beat the `fixed` class, so on a long page the menu landed a
    // thousand pixels below the fold while every other assertion stayed green.
    const box = await list.boundingBox();
    expect(box, 'the menu must have a box').not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(1100);

    await trigger.press('ArrowDown');
    await trigger.press('Enter');
    await expect(list).toHaveCount(0);

    await trigger.click();
    await trigger.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });

  test('leaves the market sheet readable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await installApi(page, adminGame);
    await page.goto('/game/market');
    await settleFonts(page);
    await expectSheetNotWashedOut(page);
  });
});
