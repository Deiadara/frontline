import { expect, test } from '@playwright/test';
import {
  TRAINING_CANCEL_WINDOW,
  findUnit,
  maxTrainable,
  trainingCancellable,
} from '@frontline/shared';
import { actionsResponse, lateGame, unitsResponse } from './fixtures';
import { installApi, settleFonts } from './harness';

test.use({ viewport: { width: 1440, height: 900 } });

/**
 * The bench (§A5): ordering more than one, and taking it back.
 *
 * The rules are pinned in `packages/shared`; what only a browser answers is whether the two
 * controls a player uses to reach them are actually there and wired to the right body. **Max** in
 * particular is a number the client works out and the server then judges, so the one thing worth
 * asserting is that they agree.
 */

test('orders a batch, and Max asks for what the crew can actually afford and house', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/units');
  await expect(page.getByTestId('unit-catalogue')).toBeVisible();
  // The catalogue opens on the carriers now; this is a test about the Razors' stepper.
  await page.getByRole('button', { name: 'Rabble' }).click();
  await settleFonts(page);

  const card = page.getByTestId('unit-razors');
  const stepper = card.getByRole('spinbutton');
  await expect(stepper).toHaveValue('1');

  // More than one, by hand.
  await stepper.fill('7');
  await expect(stepper).toHaveValue('7');

  // ...and by the button, which must land on the same number the shared rule computes.
  const expected = maxTrainable(
    findUnit('razors')!,
    unitsResponse.resources,
    Math.max(0, unitsResponse.supplyCap - unitsResponse.supplyUsed),
    unitsResponse.trainingCostReduction,
  );
  expect(expected, 'the fixture must leave room for a batch').toBeGreaterThan(1);
  await card.getByTestId('max-razors').click();
  await expect(stepper).toHaveValue(String(expected));

  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/units/train') && request.method() === 'POST') {
      sent.push(request.postData() ?? '');
    }
  });
  await card.getByRole('button', { name: 'Train' }).click();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  expect(sent[0]).toContain(`"count":${expected}`);
});

/**
 * Cancel is drawn only inside the window, which is a tenth of the batch's own clock. The fixture
 * has one order past it and one before it, so this asserts both halves at once: the control is
 * absent where it should be and present where it should be.
 */
test('offers Cancel only on a batch still inside its window, and sends the order id', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/units');
  await expect(page.getByTestId('training-queue')).toBeVisible();
  await settleFonts(page);

  const now = new Date(unitsResponse.serverNow);
  const open = unitsResponse.queue.filter((order) => trainingCancellable(order, now));
  const shut = unitsResponse.queue.filter((order) => !trainingCancellable(order, now));
  expect(open.length, 'the fixture needs a cancellable order').toBeGreaterThan(0);
  expect(shut.length, 'and one past its window').toBeGreaterThan(0);
  expect(TRAINING_CANCEL_WINDOW).toBe(0.1);

  for (const order of shut) {
    await expect(page.getByTestId(`cancel-${order.id}`)).toHaveCount(0);
  }

  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/units/cancel') && request.method() === 'POST') {
      sent.push(request.postData() ?? '');
    }
  });
  await page.getByTestId(`cancel-${open[0]!.id}`).click();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  expect(sent[0]).toContain(open[0]!.id);
});

/**
 * §A4: the Actions screen, which exists because a force is no longer where it was the moment you
 * press send. What only a browser answers is whether the third place units can be in is legible:
 * who is walking, from where to what, and how long is left.
 */
test('lists what is on the road, and offers to turn back only what is still close to home', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/actions');
  await expect(page.getByTestId('movements')).toBeVisible();
  await settleFonts(page);

  const [early, late] = actionsResponse.movements;
  expect(early?.recallable, 'the fixture needs a column still in its window').toBe(true);
  expect(late?.recallable, 'and one past it').toBe(false);

  // The picture, not a generic figure: the roster's own art, wherever a force is listed.
  for (const unitId of Object.keys(early!.army)) {
    await expect(page.getByTestId(`walking-${unitId}`)).toBeVisible();
  }
  await expect(page.getByText(early!.targetName)).toBeVisible();
  await expect(page.getByText(late!.targetName)).toBeVisible();

  await expect(page.getByTestId(`recall-${late!.id}`)).toHaveCount(0);

  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/actions/recall') && request.method() === 'POST') {
      sent.push(request.postData() ?? '');
    }
  });
  await page.getByTestId(`recall-${early!.id}`).click();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  expect(sent[0]).toContain(early!.id);
});
