import { expect, test } from '@playwright/test';
import {
  RESOURCE_ORDER,
  findUnit,
  notorietyUpgradeCost,
  trainingCost,
  trainingRefund,
  type ResourceKey,
} from '@frontline/shared';
import { lateGame, notorious, research, unitsResponse } from './fixtures';
import { installApi, settleFonts } from './harness';

test.use({ viewport: { width: 1600, height: 1000 } });

/**
 * Spending and gaining, said out loud (board request).
 *
 * The rule the figures obey is unit-tested in `src/lib/deltas.test.tsx`. What only a browser
 * answers is whether a real screen, driving a real mutation through the fixture, puts the right
 * figure on the right chip: the diff runs on the HUD's own `/me` reading, which no unit test of
 * the hook exercises end to end.
 */

/** The chips the batch below is charged against, with what each one is charged. */
function billOf(unitId: string, count: number): [ResourceKey, number][] {
  const bill = trainingCost(
    findUnit(unitId)!,
    count,
    unitsResponse.trainingCostReduction,
    unitsResponse.trainingSuppliesReduction ?? 0,
  );
  return RESOURCE_ORDER.flatMap((kind) => {
    const amount = bill[kind] ?? 0;
    return amount > 0 ? [[kind, amount] as [ResourceKey, number]] : [];
  });
}

test('a training order throws a red minus onto every stockpile it is charged against', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/units');
  await expect(page.getByTestId('unit-catalogue')).toBeVisible();
  await page.getByRole('button', { name: 'Rabble' }).click();
  await settleFonts(page);

  const bill = billOf('razors', 1);
  expect(bill.length, 'the fixture must charge for a batch').toBeGreaterThan(1);

  await page.getByTestId('unit-razors').getByRole('button', { name: 'Train' }).click();

  // Asserted while it is still on screen: a figure lives 1.6 seconds, and the loop below takes
  // longer than that between its first and last assertion.
  await expect(page.getByTestId(`delta-${bill[0]![0]}`).getByTestId('delta-spend')).toBeVisible();

  for (const [kind, amount] of bill) {
    const figure = page.getByTestId(`delta-${kind}`).getByTestId('delta-spend');
    await expect(figure, `${kind} must say what it cost`).toHaveAttribute(
      'data-amount',
      String(-amount),
    );
    await expect(figure).toContainText(`-${amount.toLocaleString()}`);
  }
});

test('cancelling a batch throws a green plus for what came back', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/units');
  await expect(page.getByTestId('training-queue')).toBeVisible();
  await settleFonts(page);

  // The one order still inside its window (`bench.spec.ts` pins which, and why).
  const order = unitsResponse.queue.find((entry) => entry.id === 'order-2')!;
  const back = trainingRefund(order);
  const paid = RESOURCE_ORDER.flatMap((kind) =>
    (back[kind] ?? 0) > 0 ? [[kind, back[kind] ?? 0] as [ResourceKey, number]] : [],
  );
  expect(paid.length, 'the fixture must refund something').toBeGreaterThan(0);

  await page.getByTestId(`cancel-${order.id}`).click();

  await expect(page.getByTestId(`delta-${paid[0]![0]}`).getByTestId('delta-gain')).toBeVisible();

  for (const [kind, amount] of paid) {
    const figure = page.getByTestId(`delta-${kind}`).getByTestId('delta-gain');
    await expect(figure, `${kind} must say what came back`).toHaveAttribute(
      'data-amount',
      String(amount),
    );
    await expect(figure).toContainText(`+${amount.toLocaleString()}`);
  }
});

/**
 * The wallet, which behaves the other way round from a stockpile: nothing trickles into it, so
 * every move it makes is announced however small.
 */
test('buying a rank throws a red minus onto the infamy chip', async ({ page }) => {
  await installApi(page, notorious);
  await page.goto('/game');
  await expect(page.getByTestId('infamy-chip')).toBeVisible();
  await settleFonts(page);

  const cost = notorietyUpgradeCost(notorious.base!.economy.notoriety)!;
  await page.getByTestId('infamy-hover').hover();
  const buy = page.getByTestId('upgrade-tier');
  await expect(buy).toBeEnabled();
  await buy.click();

  const figure = page.getByTestId('delta-infamy').getByTestId('delta-spend');
  await expect(figure).toBeVisible();
  await expect(figure).toHaveAttribute('data-amount', String(-cost));
  await expect(figure).toContainText(`-${cost.toLocaleString()}`);
});

/**
 * §C: the board's second named case. Starting a research programme is a click that spends, so it
 * throws the same red figures a training order does.
 *
 * The Lab is worth its own run rather than a second unit test because nothing else on the page
 * moves the stockpile: the response is the Archive, the charge only reaches the HUD through the
 * `me` invalidation `useStartTech` does on `onSettled`, and a version of that hook that forgot it
 * would still turn the rung's clock on and pass every other research assertion in the suite.
 */
test('putting a rung on the bench throws the red figures for what it costs', async ({ page }) => {
  const rung = research.technologies.find((one) => !one.known && one.blocker === null);
  expect(rung, 'the research fixture must offer a startable rung').toBeDefined();
  const bill = RESOURCE_ORDER.flatMap((kind) =>
    (rung!.cost[kind] ?? 0) > 0 ? [[kind, rung!.cost[kind] ?? 0] as [ResourceKey, number]] : [],
  );
  expect(bill.length, 'the fixture must charge for a rung').toBeGreaterThan(0);

  await installApi(page, lateGame);
  await page.goto('/game/research');
  await page.getByTestId(`research-track-${rung!.track}`).click();
  const card = page.getByTestId(`tech-${rung!.id}`);
  await card.scrollIntoViewIfNeeded();
  await settleFonts(page);

  await card.getByRole('button', { name: 'Put them on it' }).click();
  // It really started, so the figures below are a receipt for something rather than for an error.
  await expect(card).toContainText('On the bench');

  await expect(page.getByTestId(`delta-${bill[0]![0]}`).getByTestId('delta-spend')).toBeVisible();
  for (const [kind, amount] of bill) {
    const figure = page.getByTestId(`delta-${kind}`).getByTestId('delta-spend');
    await expect(figure, `${kind} must say what the rung cost`).toHaveAttribute(
      'data-amount',
      String(-amount),
    );
    await expect(figure).toContainText(`-${amount.toLocaleString()}`);
  }
});
