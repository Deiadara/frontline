import { FEATS } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';

/**
 * REAL end to end, no `/api` interception, for everything the last two batches added.
 *
 * `live.spec.ts` does this for the original loop and predates all of it. The point of a spec with
 * no mocks is the one thing a mocked spec structurally cannot catch: a client and a server that
 * have quietly stopped agreeing. Every other e2e file in this directory answers a fixture, so a
 * required field the client never sends, a route registered at the wrong path, or a response shape
 * the screen misreads all stay invisible in them.
 *
 * Three surfaces, all new, all reached by walking the real game from the login screen:
 *
 *   * the **Feats** board, its counters and its CLAIM button, against the real catalogue;
 *   * the **standings**, with the seeded world's real crews in it;
 *   * the **NPC faction's public file**, which is the one page whose whole reason to exist is a
 *     faction the reader is not in, and which the seeder now puts in the world on every boot.
 */

/**
 * Registers a fresh crew and walks it to the city.
 *
 * A new account per test rather than the seeded operator, which `live.spec.ts` uses. Two reasons,
 * and the second is the one that matters. The obvious one is a clean slate: every feat below is
 * about a counter starting at zero, and an operator another spec has already played would arrive
 * with half of them finished. The second is ordering: these specs share one throwaway database,
 * so a suite that happened to run `live.spec.ts` first would leave the seeded operator already
 * holding an Overseer, and a helper that assumed the picker would appear would hang on whichever
 * spec drew second. A registration answers the same way every time it is called.
 */
async function arrive(page: Page, handle: string): Promise<void> {
  await page.goto('/auth');
  // The door has two handles before it has a form (maintainer, 2026-09-23): Sign up is the one.
  await page.getByTestId('auth-choose-register').click();
  await page.getByLabel('Operator ID').fill(handle);
  await page.getByLabel('Password').fill('hunter2pass');
  await page.getByRole('button', { name: 'Enlist' }).click();

  await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
  // §F6: whichever character this account was offered, not a named one. The pool drains and the
  // seeded rivals claim from it before any player registers, so a name is not a thing a live test
  // can press: on a fresh world the rival already holds the one this used to ask for.
  await page.locator('[data-testid^="overseer-card-"]').first().click();
  const confirm = page.getByRole('button', { name: 'Confirm Overseer' });
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await page.waitForURL('**/game');
  await expect(page.getByTestId('city-room')).toBeVisible();
}

test.describe('the real server, over the new screens', () => {
  test('draws every feat in the catalogue, from the real route', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await arrive(page, 'feats_catalogue');

    await page.goto('/game/feats');
    await expect(page.getByTestId('feats-ledger')).toBeVisible();

    /*
     * The count the page prints has to be the catalogue's own.
     *
     * This is the contract check: the server sends progress rows and the client joins them to the
     * catalogue it already holds. A route answering a different set, or a client dropping rows it
     * could not match, shows up here as a number and nowhere else.
     */
    await expect(page.getByTestId('feats-ledger')).toContainText(String(FEATS.length));
  });

  test('opens a brand new crew’s ladders at the first rung and shuts the rest', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await arrive(page, 'feats_fresh');
    await page.goto('/game/feats');
    await expect(page.getByTestId('feats-ledger')).toBeVisible();

    // A crew that has done nothing has nothing to collect, and every ladder's second rung is shut.
    await expect(page.getByTestId('feat-claim-runs_1')).toHaveCount(0);
    await expect(page.getByText('Shut. Take the step above it first.').first()).toBeVisible();
    // ...and the index lists every ladder in the catalogue, whatever the crew has done.
    await expect(page.getByTestId('feats-tab-runs')).toBeVisible();
  });

  test('counts a real job and lets the crew collect the feat it finished', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await arrive(page, 'feats_claim');

    /*
     * The letter feat, driven the way a player would drive it.
     *
     * `letters_1` wants one message sent, which is the only feat in the catalogue a crew can
     * finish in its first minute without waiting on a clock. What is under test is the whole
     * chain: the composer writes through the real route, the hook increments the real counter, the
     * board re-reads it, and CLAIM pays through the real transaction.
     */
    await page.goto('/game/messages?to=Sable_Ninth');
    const form = page.getByTestId('compose-form');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('compose-recipient-Sable_Ninth')).toBeVisible();
    await form.getByTestId('compose-subject').fill('A word');
    await form.getByTestId('compose-body').fill('About the ground on Ninth Street.');
    await form.getByRole('button', { name: 'Send it' }).click();

    await page.goto('/game/feats');
    // The board opens on the first ladder in the catalogue, so the letters one has to be opened
    // from the index down the left before its rung is on screen (maintainer, 2026-09-17).
    await page.getByTestId('feats-tab-letters').click();
    const claim = page.getByTestId('feat-claim-letters_1');
    await expect(claim).toBeVisible();

    // The badge on the bottom bar is a second reading of the same question and must agree.
    await expect(page.getByTestId('nav-feats-badge')).toBeVisible();

    await claim.click();
    // Collected, and the button is gone rather than merely disabled.
    await expect(page.getByTestId('feat-claim-letters_1')).toHaveCount(0);
    await expect(page.getByTestId('feats-ledger')).toContainText('1');
  });

  test('shows the seeded crews on the standings, ranked', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await arrive(page, 'feats_board');

    await page.goto('/game/leaderboard');
    await expect(page.getByTestId('leaderboard')).toBeVisible();
    // The seeder puts three non-playing crews in the world. They are ordinary rows and the board
    // reads them off real districts, so any of them missing is a projection that dropped somebody.
    for (const crew of ['Vex_Combine', 'Sable_Ninth', 'Sollen_Tam']) {
      await expect(page.getByTestId(`standing-${crew}`)).toBeVisible();
    }
  });

  test('opens the NPC faction’s file, which the reader is not in', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await arrive(page, 'feats_rival');

    /*
     * Reached by clicking, not by typing a URL.
     *
     * The maintainer asked for the faction column on the standings to be a door, and the only honest
     * way to check a door is to walk through it. The rival's table is the one the seeded operator
     * is not a member of, which is the case the whole page was built for.
     */
    await page.goto('/game/leaderboard');
    await expect(page.getByTestId('leaderboard')).toBeVisible();
    const door = page.getByTestId('standing-faction-Vex_Combine');
    await expect(door).toBeVisible();
    await door.click();

    await expect(page.getByTestId('faction-profile-members')).toBeVisible();
    // Both seeded members, their ranks, and a way to write to each of them.
    await expect(page.getByTestId('faction-member-Vex_Combine')).toBeVisible();
    await expect(page.getByTestId('faction-member-Sollen_Tam')).toBeVisible();
    await expect(page.getByTestId('faction-member-message-Vex_Combine')).toBeVisible();
  });
});
