import { expect, test } from '@playwright/test';
import {
  RESOURCE_ORDER,
  findUnit,
  notorietyUpgradeCost,
  trainingCost,
  supplyBoard,
  trainingRefund,
  type MarketResponse,
  type ResourceKey,
} from '@frontline/shared';
import {
  adminGame,
  lateGame,
  lateGameBase,
  market,
  notorious,
  research,
  unitsResponse,
} from './fixtures';
import { installApi, settleFonts } from './harness';

test.use({ viewport: { width: 1600, height: 1000 } });

/**
 * Spending and gaining, said out loud (maintainer request).
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
 * §C: the maintainer's second named case. Starting a research programme is a click that spends, so it
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

/**
 * Where the figure lands (maintainer request, 2026-09-11).
 *
 * A spend is a receipt and a receipt belongs at the till: under the button that was pressed, not
 * under a chip a screen away. A gain has no button and stays on its chip. Measured, because the
 * anchor is a geometry decision and a figure "near" the wrong thing passes every text assertion.
 */
test('a spend lands under the button that spent it, and a refund stays on its chip', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/units');
  await expect(page.getByTestId('unit-catalogue')).toBeVisible();
  await page.getByRole('button', { name: 'Rabble' }).click();
  await settleFonts(page);

  const bill = billOf('razors', 1);
  const train = page.getByTestId('unit-razors').getByRole('button', { name: 'Train' });
  const button = await train.boundingBox();
  if (!button) throw new Error('the Train button has no box');
  await train.click();

  const float = page.getByTestId(`delta-${bill[0]![0]}`);
  await expect(float).toHaveAttribute('data-anchored', 'press');
  const figure = await float.getByTestId('delta-spend').boundingBox();
  if (!figure) throw new Error('the figure has no box');
  // Under the button, and centred on it: within a lane's height of its foot, and its centre line
  // within the button's own width of the button's centre.
  expect(figure.y).toBeGreaterThanOrEqual(button.y + button.height - 1);
  expect(figure.y - (button.y + button.height)).toBeLessThan(200);
  const centre = figure.x + figure.width / 2;
  expect(Math.abs(centre - (button.x + button.width / 2))).toBeLessThan(button.width);

  // Every stockpile the press charged is in the same column, one row each, none on top of another.
  const tops = new Set<number>();
  for (const [kind] of bill) {
    const box = await page.getByTestId(`delta-${kind}`).getByTestId('delta-spend').boundingBox();
    if (!box) throw new Error(`${kind} has no figure`);
    tops.add(Math.round(box.y));
  }
  expect(tops.size, 'two receipts from one press share a row').toBe(bill.length);
});

/**
 * A figure answers the button that made it, whichever card the button is on (maintainer request,
 * 2026-09-12). Two presses a second apart on two cards used to draw both columns under the first
 * button, because the readout looked up "the last press" once and held it.
 */
test('two presses on two cards draw two columns, each under its own button', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/units');
  await expect(page.getByTestId('unit-catalogue')).toBeVisible();
  await page.getByRole('button', { name: 'Rabble' }).click();
  await settleFonts(page);

  const left = page.getByTestId('unit-razors').getByRole('button', { name: 'Train' });
  const right = page.getByTestId('unit-anodics').getByRole('button', { name: 'Train' });
  const leftBox = await left.boundingBox();
  const rightBox = await right.boundingBox();
  if (!leftBox || !rightBox) throw new Error('a Train button has no box');
  expect(rightBox.x, 'the two cards must sit side by side').toBeGreaterThan(leftBox.x + 200);

  await left.click();
  await expect(page.getByTestId('delta-caps').first()).toHaveAttribute('data-anchored', 'press');
  await right.click();
  // Both presses charge caps, so the caps readout now draws two columns.
  await expect(page.getByTestId('delta-caps')).toHaveCount(2);
  const columns = await page
    .getByTestId('delta-caps')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left));
  const [first, second] = [...columns].sort((a, b) => a - b);
  expect(Math.abs(first! - (leftBox.x + leftBox.width / 2))).toBeLessThan(leftBox.width);
  expect(Math.abs(second! - (rightBox.x + rightBox.width / 2))).toBeLessThan(rightBox.width);
});

test("a refund's figure lands under the Cancel that asked for it", async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/units');
  await expect(page.getByTestId('training-queue')).toBeVisible();
  await settleFonts(page);
  // The one order still inside its window (`bench.spec.ts` pins which, and why).
  const order = unitsResponse.queue.find((entry) => entry.id === 'order-2')!;
  const paid = RESOURCE_ORDER.filter((kind) => (trainingRefund(order)[kind] ?? 0) > 0);
  await page.getByTestId(`cancel-${order.id}`).click();
  const float = page.getByTestId(`delta-${paid[0]!}`);
  await expect(float.getByTestId('delta-gain')).toBeVisible();
  // A gain from a press is a receipt too: it lands at the till, not on the chip. Only a move
  // nobody pressed for (a mission home, a fight settled) hangs off the chip at the top.
  await expect(float).toHaveAttribute('data-anchored', 'press');
});

/**
 * The testing build quotes a bill and does not take it (`admin/mode.ts`), so the stockpile never
 * moves and the diff has nothing to throw. Pressing Train and seeing nothing read as a button that
 * did not work, so the screen announces the bill it quoted, drawn as the spend it would have been.
 */
test('in admin mode a training order still throws its bill', async ({ page }) => {
  await installApi(page, adminGame);
  await page.goto('/game/units');
  await expect(page.getByTestId('unit-catalogue')).toBeVisible();
  await page.getByRole('button', { name: 'Rabble' }).click();
  await settleFonts(page);

  const bill = billOf('razors', 1);
  await page.getByTestId('unit-razors').getByRole('button', { name: 'Train' }).click();

  const first = page.getByTestId(`delta-${bill[0]![0]}`);
  await expect(first.getByTestId('delta-waived')).toBeVisible();
  await expect(first).toHaveAttribute('data-anchored', 'press');
  for (const [kind, amount] of bill) {
    const figure = page.getByTestId(`delta-${kind}`).getByTestId('delta-waived');
    await expect(figure).toHaveAttribute('data-amount', String(-amount));
    await expect(figure).toContainText(`-${amount.toLocaleString()}`);
    // The figure and the currency, nothing else: no word on it.
    await expect(figure).not.toContainText(/[a-z]{3,}/i);
  }
  // And nothing in red: the stockpile did not move, and the figure must not say it did.
  await expect(page.getByTestId('delta-spend')).toHaveCount(0);
});

/**
 * A buy is two receipts, and both land at the till (maintainer request, 2026-09-12): the caps that
 * went out and the units that came in, under Buy It, in one column.
 */
test('buying from the Broker throws the minus and the plus under Buy It', async ({ page }) => {
  await installApi(page, lateGame);
  // The late-game fixture's stores are all full (six-figure stock over level-1 sheds), so the
  // Broker refuses every line. A board with room is what this test is about.
  const roomy: MarketResponse = {
    ...market,
    supply: supplyBoard(lateGameBase.level, lateGameBase.resources, 1_000_000, 0, () => 1_000_000),
  };
  await page.route('**/api/market', (route) => route.fulfill({ json: roomy }));
  await page.goto('/game/market');
  const buy = page.getByTestId('supply-buy');
  await expect(buy).toBeEnabled();
  await settleFonts(page);
  const button = await buy.boundingBox();
  if (!button) throw new Error('the Buy It button has no box');

  await buy.click();

  const spend = page.getByTestId('delta-caps');
  await expect(spend.getByTestId('delta-spend')).toBeVisible();
  await expect(spend).toHaveAttribute('data-anchored', 'press');
  const gain = page.locator('[data-testid^="delta-"][data-anchored="press"]').filter({
    has: page.getByTestId('delta-gain'),
  });
  await expect(gain).toHaveCount(1);
  // Both columns hang off the same button.
  for (const column of [spend, gain]) {
    const box = await column.boundingBox();
    if (!box) throw new Error('a column has no box');
    expect(Math.abs(box.x - (button.x + button.width / 2))).toBeLessThan(button.width);
  }
});
