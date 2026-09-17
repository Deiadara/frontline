/**
 * What a unit's tags say when you point at them (maintainer request, 2026-09-14).
 *
 * A rule and a modifier are the two chips under a unit's stats, and both used to answer with an
 * `InfoWindow`: the unit's name as an eyebrow, a stamped icon, a tone-coloured header, and the
 * sentence filed under a heading that read "What it does". That is the shape of a panel you open
 * on purpose, not of a label you brushed past on the way somewhere else.
 *
 * They answer on a torn scrap now: the tag's own name, a ruled line, and one line of what it does.
 * What is worth a browser rather than a unit test is the part that is not in the markup: that the
 * headings are gone, that a modifier still says the condition it only counts under, and that a
 * rule which takes something away still reads red.
 */
import { expect, test, type Page } from '@playwright/test';
import { findUnit, trainingCost, trainingSeconds } from '@frontline/shared';
import { formatDuration } from '../src/features/base/format';
import { installApi, settleFonts } from './harness';
import { lateGame, unitsResponse } from './fixtures';

async function openRoster(page: Page, tier: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installApi(page, lateGame);
  await page.route('**/api/units', (route) =>
    route.fulfill({
      json: {
        ...unitsResponse,
        units: unitsResponse.units.map((unit) => ({ ...unit, unlocked: true, missing: [] })),
      },
    }),
  );
  await page.goto('/game/units');
  await expect(page.getByTestId('unit-catalogue')).toBeVisible();
  await page.getByTestId(`tier-${tier}`).click();
  await settleFonts(page);
}

/** The floating card, whichever tag opened it. */
const CARD = '[role="tooltip"]';

test('a modifier answers with its name and one line, and keeps the condition', async ({ page }) => {
  await openRoster(page, 'heavy');
  const tag = page.getByText('Dug In', { exact: true }).first();
  await tag.scrollIntoViewIfNeeded();
  await tag.hover();

  const card = page.locator(CARD).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('Dug In');
  await expect(card).toContainText('Worth twice as much behind something');

  // The headings are the thing that went. Both of them, by name.
  await expect(card).not.toContainText('When it happens');
  await expect(card).not.toContainText('What it does');

  /*
   * The condition survived the trim.
   *
   * Reading the ask as "delete everything but the description" would have been the easy version
   * and the wrong one: `Dug In` without "when holding ground" is a flat bonus, and the whole point
   * of a modifier is that it is not one.
   */
  await expect(card).toContainText('when holding ground');

  // A torn scrap, not the window it replaced: the frame is the card's own, with no header bar.
  await expect(card.locator('.scrap')).toHaveCount(0);
  await expect(page.locator(`${CARD}.scrap`)).toBeVisible();
});

test('a rule that takes something away still reads red', async ({ page }) => {
  await openRoster(page, 'legendary');
  /*
   * The Colossus cannot ride, and that is a cost rather than a perk.
   *
   * The tone used to be carried by `InfoWindow`'s coloured header, which is gone. It is on the
   * name now, so this reads the name's own colour rather than trusting a class list: an oxblood
   * token and a brass one are both "some class was applied", and only one of them is right.
   */
  const tag = page.getByText('Too big to ride', { exact: true }).first();
  await tag.scrollIntoViewIfNeeded();
  await tag.hover();

  const card = page.locator(CARD).first();
  await expect(card).toBeVisible();
  const title = card.getByText('Too big to ride', { exact: true });
  const ink = await title.evaluate((el) => getComputedStyle(el).color);
  const [r, g] = ink.match(/\d+/g)!.map(Number) as [number, number, number];
  /*
   * Red against **green**, not against blue.
   *
   * The first cut of this compared red to blue and passed with the title painted brass, which is
   * the bug it was written to catch: brass-100 is `#ffe4ae`, a warm cream whose red also towers
   * over its blue. The two tones are only told apart by the green channel, where brass sits 27
   * below its red and oxblood-300 (`#e05a4a`) sits 134 below. Eighty is the gap between them.
   */
  expect(r - g, `a rule that costs you something is red, got ${ink}`).toBeGreaterThan(80);
});

/**
 * And the three figures on the roster's head, which now answer for themselves.
 *
 * "In units where it says -24% cost, -70% training time etc, when you hover over these make a hand
 * drawn page come up that breaks down where they are from (e.g. 20% from X officer, 10% from
 * gauntlet)" (maintainer, 2026-09-17).
 *
 * The load-bearing assertion is the total. The lines are assembled by a second walk of the same
 * contributors the fold uses (`units/breakdown.ts`), and `breakdown.test.ts` pins their sum on the
 * server; what only a browser answers is whether the page a player actually opens carries that sum
 * to the screen beside the chip it came off, rather than a rounded or re-derived figure.
 */
test('breaks the three training figures down into where they came from', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installApi(page, lateGame);
  await page.goto('/game/units');
  await expect(page.getByTestId('unit-catalogue')).toBeVisible();
  await settleFonts(page);

  const chips = [
    { id: 'training-bonus-cost', total: '10%', names: ['Unit Costing'] },
    { id: 'training-bonus-supplies', total: '22%', names: ['The Greenhouse'] },
    {
      id: 'training-bonus-speed',
      total: '33%',
      // The two the maintainer named: a person, and the structure that drills for everybody.
      names: ['Ola Nkemdirim', 'The Gauntlet'],
    },
  ];

  for (const chip of chips) {
    await page.getByTestId(chip.id).hover();
    const sheet = page.getByTestId('bonus-breakdown');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('bonus-breakdown-total')).toHaveText(chip.total);
    // `.first()`: a structure can be both a payer on one line and the note beside a card fitted
    // into it on the next, which is the page working rather than a duplicate.
    for (const name of chip.names) {
      await expect(sheet.getByText(name, { exact: false }).first()).toBeVisible();
    }
    // A raid takes its cut back off the crew's half, and it reads as a subtraction rather than as
    // one more saving: the sign is the whole difference between the two.
    await expect(sheet.getByText('-', { exact: false }).first()).toBeVisible();
    await page.mouse.move(2, 2);
  }

  await page.getByTestId(chips[2]!.id).hover();
  await expect(page.getByTestId('bonus-breakdown')).toBeVisible();
  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/training-breakdown.png' });
});

/**
 * And the tag on each unit, which answers for that unit rather than for the district.
 *
 * "A little info tag on each unit called Bonuses that analyzes what is given for that particular
 * unit, including the global ones and its private ones" (maintainer, 2026-09-17).
 *
 * The private half is §A4 and is the reason the tag exists: the crew-wide chips at the top of the
 * screen could not account for the discount a Cyberhound's own card was quoting, because the
 * Doghouse pays that unit and no other. So the assertion that matters is the pair: the Doghouse is
 * on the Cyberhounds' page, and it is *not* on a unit that does not call it home.
 */
test('gives every unit a Bonuses tag carrying the crew-wide lines and its own', async ({
  page,
}) => {
  await openRoster(page, 'wonder');

  await page.getByTestId('bonuses-cyber_dogs').hover();
  const hounds = page.getByTestId('unit-bonuses-cyber_dogs');
  await expect(hounds).toBeVisible();
  // The global half, which comes off the response once.
  await expect(hounds.getByText('Unit Costing')).toBeVisible();
  await expect(hounds.getByText('The Gauntlet').first()).toBeVisible();
  // ...and the private half, which rides on this row alone.
  await expect(hounds.getByText('The Doghouse').first()).toBeVisible();
  // 10 crew-wide off the bill plus the Doghouse's own 10.
  await expect(page.getByTestId('unit-bonuses-total-cost')).toHaveText('20%');
  await page.mouse.move(2, 2);

  await openRoster(page, 'rabble');
  await page.getByTestId('bonuses-razors').hover();
  const razors = page.getByTestId('unit-bonuses-razors');
  await expect(razors).toBeVisible();
  await expect(razors.getByText('Unit Costing')).toBeVisible();
  await expect(razors.getByText('The Doghouse')).toHaveCount(0);
  // The crew-wide 10 and nothing else: no private ground, so no private line.
  await expect(page.getByTestId('unit-bonuses-total-cost')).toHaveText('10%');
  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/unit-bonuses.png' });
});

/**
 * The price box says what pressing the button will actually cost (maintainer, 2026-09-17).
 *
 * It did not. `unit.cost` and `unit.trainSeconds` come off the catalogue, so every discount a crew
 * had bought, the Gauntlet, the Greenhouse, the Lab, a chemist in the right chair, the unit's own
 * ground, was invisible on the one box where the decision is made: a crew reading 40 caps and 45
 * seconds was charged 30 caps and waited 28. The figures are computed with `trainingCost` and
 * `trainingSeconds`, which are the route's own functions, so the box and the bill cannot round
 * apart.
 *
 * Checked against the arithmetic rather than against a pinned string: a retuned discount should
 * move both sides of this together, and a test pinned to "30" would be a test of the fixture.
 */
test('quotes the discounted price and clock, not the catalogue ones', async ({ page }) => {
  await openRoster(page, 'rabble');
  const card = page.getByTestId('unit-razors');
  const spec = findUnit('razors')!;

  const discount = unitsResponse.trainingCostReduction;
  const supplies = unitsResponse.trainingSuppliesReduction ?? 0;
  const speed = unitsResponse.trainingSpeedBonus;
  // The premise: there is a discount to be hidden. Without one this passes on the catalogue price.
  expect(discount + supplies + speed).toBeGreaterThan(0);

  // Scoped to the price itself: the sheet two inches above it prints `Morale 40`, and the
  // catalogue price is 40 caps, so a card-wide match answers about the wrong number.
  const line = card.getByTestId('cost-line');
  const one = trainingCost(spec, 1, discount, supplies);
  await expect(line).toContainText(String(one.caps));
  await expect(line, 'the box is still quoting the catalogue price').not.toContainText(
    String(spec.cost.caps),
  );
  await expect(card).toContainText(formatDuration(trainingSeconds(spec, 1, speed)));

  // ...and it follows the count, because the count is what the order will be.
  // The testid is on the input itself, not a wrapper around it.
  await card.getByTestId('count-razors').fill('3');
  const three = trainingCost(spec, 3, discount, supplies);
  await expect(line).toContainText(String(three.caps));
  await expect(card).toContainText(formatDuration(trainingSeconds(spec, 3, speed)));
});
