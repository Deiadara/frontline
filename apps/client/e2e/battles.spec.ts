import { expect, test } from '@playwright/test';
import {
  effectiveStats,
  findUnit,
  labelText,
  noTerritoryEffects,
  type StatKey,
} from '@frontline/shared';
import { battles, lateGame } from './fixtures';
import {
  growPastTheFold,
  expectNoImagesClipped,
  expectNothingClippedVertically,
  installApi,
  settleFonts,
} from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

/**
 * The Battles page (§A4, battle rework), through the browser.
 *
 * The unit tests already pin the rules. What only a browser can answer is whether the screen a
 * player actually gets **says** what the rules mean: that a fight you called and a fight you are
 * defending read as different things, that an enemy force you cannot count reads as unknown rather
 * than as zero, and that the report is a document somebody would read rather than a wall of
 * numbers. All three are things a green unit suite has shipped wrong before.
 *
 * The page is a list and a detail now, so the browser is also the only place that can say the two
 * halves agree: picking a row has to change what the detail is about.
 */

test('the list scans, and opening a fight says what is on the ground', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  await expect(page.getByRole('heading', { name: 'Battles' })).toBeVisible();
  await expect(page.getByTestId('board-infamy')).toHaveText(
    `${battles.infamy.toLocaleString()} infamy`,
  );

  const coming = page.getByTestId('coming-battles');
  await expect(coming.getByText('Kessler Press')).toBeVisible();
  await expect(coming.getByText('The Bonefield')).toBeVisible();

  // The first fight opens by default, so the page never lands on an empty column.
  const mine = battles.coming[0]!;
  const detail = page.getByTestId(`battle-detail-${mine.battle.id}`);
  await expect(detail).toBeVisible();

  // The board's own request: what you have there, unit by unit, rather than one body count.
  const forces = page.getByTestId('battle-forces');
  for (const unitId of Object.keys(mine.muster!.army)) {
    await expect(forces.getByTestId(`force-${unitId}`)).toBeVisible();
  }

  /*
   * §A4: the location characteristics, on the fight, with their tiers.
   *
   * They decide a real share of every outcome and this screen said nothing about any of them: a
   * player could only learn that the Press is Crammed by walking into the district, opening the
   * location and remembering. Read off the fixture's own battlefield rather than typed, so the row
   * is asserted against what the server would send rather than against four words in this file.
   */
  const row = detail.getByTestId('battle-characteristics');
  await expect(row).toContainText('Characteristics');
  expect(mine.battlefield.labels.length, 'the fixture must carry some').toBeGreaterThan(1);
  for (const label of mine.battlefield.labels) {
    const chip = row.getByTestId(`label-${label.id}`);
    await expect(chip, label.id).toHaveText(labelText(label));
    await expect(chip, label.id).toHaveAttribute('data-tier', String(label.tier));
  }
  /*
   * The row's own shot, taken before anything is hovered.
   *
   * Order matters here: `hover()` scrolls its target into view, and the detail column is a
   * scroller taller than the frame, so a shot taken after the hover below is a shot of a pane
   * scrolled past its own heading. That is an artefact of the test rather than of the layout, and
   * it is exactly the kind of thing a screenshot gate goes on to enshrine.
   */
  await settleFonts(page);
  await page.screenshot({ path: 'e2e-out/battles-characteristics.png' });

  /*
   * The forecast, which is the number a player most needs before committing anybody.
   *
   * It runs `battle/forecast.ts` against the ground the fight will actually happen on, which is why
   * `BattleView` carries a battlefield at all. The feature existed and was tested for a long time
   * while being wired only into the garrison picker, where there is never an enemy: computed,
   * correct, and on no screen anybody could reach.
   */
  const odds = detail.getByTestId('battle-odds');
  await expect(odds).toBeVisible();
  await expect(odds).toContainText('runs of the real thing');
  await expect(odds).toContainText('%');

  /*
   * §A4: hovering a unit in the muster says what it will fight as *here*.
   *
   * The row above says the Press is Crammed II and Wet II. This is the other half: what those cost
   * a Sniper and what they buy a Razor, from `battle/effects.ts`, which is the function the fight
   * itself runs. A player could read both halves before and had no way to put them together.
   *
   * The expectation is computed rather than typed, and the assertion demands a *difference*: a card
   * that quietly printed the sheet twice would satisfy every "is it visible" check ever written.
   */
  const unitId = 'razors';
  const spec = findUnit(unitId)!;
  const effective = effectiveStats(
    spec,
    mine.battlefield,
    { defending: mine.side === 'defender', outnumbered: false },
    noTerritoryEffects(),
  );
  const key: StatKey = 'offense';
  const here = Math.round(effective.offense);
  expect(here, 'the ground must actually move this unit, or the gate proves nothing').not.toEqual(
    spec.stats[key],
  );

  await forces.getByTestId(`force-${unitId}`).hover();
  const sheetRow = page.getByTestId(`effective-${unitId}-${key}`);
  await expect(sheetRow).toBeVisible();
  await expect(sheetRow).toContainText(String(spec.stats[key]));
  await expect(sheetRow).toContainText(String(here));
  // And the reason it moved, in the words the report uses.
  await expect(page.getByTestId(`effective-${unitId}`)).toBeVisible();

  await page.screenshot({ path: 'e2e-out/battles-effective.png' });
  await page.mouse.move(0, 0);
  await expect(sheetRow).toBeHidden();

  // The one they are defending: the other side is running dark, so it says so rather than "0".
  const theirs = battles.coming[1]!;
  await page.getByTestId(`battle-${theirs.battle.id}`).click();
  const other = page.getByTestId(`battle-detail-${theirs.battle.id}`);
  await expect(other).toBeVisible();
  await expect(other.getByText('Unknown')).toBeVisible();
  await expect(other.getByText('Nothing. They are running dark.')).toBeVisible();

  // ...and with nothing counted there is no forecast, rather than a confident number built on air.
  await expect(other.getByTestId('odds-none')).toBeVisible();

  await settleFonts(page);
  /*
   * The fold taken out of the way first.
   *
   * This screen's scroll lives inside the sheet, and the fold of a scroller cuts its last row by
   * design: the detail column is taller than a laptop and is meant to be. Growing the viewport to
   * the height of the content is what lets the sweep measure the *layout* rather than how far down
   * the page happened to be, and it is what the market's and the district's sweeps already do.
   */
  await page.setViewportSize({ width: 1280, height: 2000 });
  await settleFonts(page);
  await expectNothingClippedVertically(page, '[data-testid="coming-battles"]');
  await expectNothingClippedVertically(page, '[data-testid="name-buys"]');
  await expectNoImagesClipped(page, 'main section');
  await page.screenshot({ path: 'e2e-out/battles-board.png', fullPage: true });
});

/**
 * §D7: what a name buys, and what it refuses to sell.
 *
 * The fixture's crew has finished no research and has one officer, so most of the shelf is on the
 * table only in the sense of being visible. That is the state worth pinning: a boost you cannot see
 * is a boost you never go and earn.
 */
test('the boost picker prices one fight, and says who has not offered the rest', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  const buys = page.getByTestId('name-buys');
  await expect(buys).toBeVisible();
  await expect(page.getByTestId('buy-boost')).toBeDisabled();

  await page.getByTestId('boost-picker').click();
  const open = battles.coming[0]!.boosts.find((option) => option.available)!;
  const shut = battles.coming[0]!.boosts.find((option) => !option.available)!;
  await expect(page.getByRole('option', { name: new RegExp(open.name) })).toBeVisible();
  await expect(page.getByRole('option', { name: new RegExp(shut.name) })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  await page.getByRole('option', { name: new RegExp(open.name) }).click();
  await expect(buys.getByText(open.effect)).toBeVisible();
  await expect(page.getByTestId('buy-boost')).toBeEnabled();

  await settleFonts(page);
  // Past the fold before sweeping. The Upcoming tab is one fixed frame now, so the detail column
  // is a scroller and the boost panel sits at the bottom of it: a scroller cutting its last row is
  // the fold's doing rather than the layout's, exactly as in the gate test below.
  await growPastTheFold(page);
  await expectNothingClippedVertically(page, '[data-testid="name-buys"]');
  await page.screenshot({ path: 'e2e-out/battles-boost.png', fullPage: true });
});

/** The reports and your own ground are behind the switch now, so the switch has to work. */
test('the tabs move between what is coming, what came back and what you hold', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  await page.getByTestId('battles-tab-reports').click();
  await expect(page.getByTestId('battle-reports')).toBeVisible();

  await page.getByTestId('battles-tab-ground').click();
  await expect(page.getByTestId('structures')).toBeVisible();

  await page.getByTestId('battles-tab-coming').click();
  await expect(page.getByTestId('coming-battles')).toBeVisible();
});

/**
 * Picking another fight starts that fight's page at the top of it.
 *
 * The detail is the only scrolling region on this screen and it used to keep its offset across a
 * change of subject, so a player who had scrolled to the boost on one fight and then pressed
 * another row landed halfway down the new one, with the ground, the odds and the leader above the
 * fold. Nothing about the screen said anything had moved.
 *
 * Driven by setting `scrollTop` rather than by a wheel gesture: the pane is the third scroller on
 * the page and a wheel lands on whatever is under the pointer, which made the same assertion pass
 * against a pane that had never scrolled at all.
 */
test('opening another fight scrolls its page back to the top', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');
  await expect(page.getByTestId('coming-battles')).toBeVisible();

  const pane = page.getByTestId('battle-detail-pane');
  const scrollTop = () => pane.evaluate((el) => Math.round(el.scrollTop));
  await pane.evaluate((el) => {
    el.scrollTop = 400;
  });
  // The control: a pane that cannot scroll would make the assertion below vacuous.
  expect(await scrollTop(), 'the detail pane did not scroll, so this proves nothing').toBe(400);

  const other = battles.coming.find((view) => view.side === 'defender')!.battle.id;
  await page.getByTestId(`battle-${other}`).click();
  await expect(page.getByTestId(`battle-detail-${other}`)).toBeVisible();
  expect(await scrollTop(), 'the new fight opened part-way down its own page').toBe(0);
});

test('a report reads as a document, and a silent one says so instead of showing an empty table', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  await page.getByTestId('battles-tab-reports').click();
  await page.getByTestId('read-fight-3').click();
  const report = page.getByTestId('battle-report');
  await expect(report).toBeVisible();
  // The header states the outcome, the ground and how long it took. The round count was on the
  // analysis from the start and drawn nowhere, so a one-round rout and a five-round grind read the
  // same.
  await expect(report.getByText('Held · Ninth Street Pawn · 5 rounds')).toBeVisible();
  // The things the board asked a report to answer, on screen at once.
  await expect(page.getByText('Snipers').first()).toBeVisible();
  await expect(page.getByText('61%')).toBeVisible();

  /*
   * The template: both ledgers carry the same rows, in the same order.
   *
   * Each row used to be written `{side.infamy > 0 && <Row/>}`, one condition per side, so the two
   * columns grew different rows and stopped lining up exactly where a reader wants to compare them.
   * On this fixture only the attacker banked infamy, took anybody on the ring or was cowed, so under
   * the old rule this assertion fails on three separate rows.
   */
  const dialog = page.getByRole('dialog');
  const labelsOf = (tone: 'mine' | 'theirs') =>
    dialog.getByTestId(`report-side-${tone}`).locator('dl dt').allTextContents();
  const mine = await labelsOf('mine');
  expect(mine, 'the ledger lost its rows').toContain('Caught by the ring');
  expect(mine).toContain('Infamy earned');
  // §D3: intimidation is settled before the first shot and was never drawn anywhere at all.
  expect(mine, 'the cowed are still invisible').toContain('Too cowed to fire');
  // A ring is a fight now, so what it paid is a number the report has to carry.
  expect(mine).toContain('Lost holding the ring');
  expect(await labelsOf('theirs'), 'the two ledgers do not line up').toEqual(mine);

  /*
   * Each side is headed by the crew it is about, in full.
   *
   * The heading was `truncate`, and at 0.2em of tracking in a 300px column that cut every
   * full-length crew name mid-word: the fixture's own read "Yours · The Ninth Street Reclamation
   * Comp…". Measured as scroll width against client width rather than by matching the string,
   * because a truncated line's `textContent` is the whole name and reads as correct in the DOM.
   */
  const cutHeadings = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid^="report-side-"] h3')]
      .filter((heading) => heading.scrollWidth > heading.clientWidth + 1)
      .map((heading) => heading.textContent?.trim() ?? ''),
  );
  expect(cutHeadings, `a side of the report is cut: ${cutHeadings.join(' | ')}`).toEqual([]);

  // §D1: who led and what came of them. On the analysis since officers could lead, drawn nowhere.
  await expect(dialog.getByTestId('report-officer-mine')).toContainText('led, and put out 940');
  // The ring held on this fixture, and that is different information from who it caught.
  await expect(dialog.getByText('The ring held, and the withdrawal broke on it.')).toBeVisible();

  await settleFonts(page);
  /*
   * Grown past the fold before the clipping sweep.
   *
   * The sweep treats any ancestor with a non-visible `overflow-y` as a clipping edge, and it is
   * right to: it cannot tell a reader who will scroll from one who will never see the row. The
   * report's body is a scroller, so on a short window its last table row is legitimately under the
   * fold and the sweep calls it cut. That made the gate a knife edge on this screen: the report fit
   * by a few pixels, and adding the round count, the officer line and two ledger rows put it over,
   * which is a red for growing the document rather than for cutting anything.
   */
  await growPastTheFold(page);
  await expectNothingClippedVertically(page, '[role="dialog"]');
  await page.screenshot({ path: 'e2e-out/battles-report.png', fullPage: true });

  await page.keyboard.press('Escape');
  await page.getByTestId('read-fight-4').click();
  await expect(page.getByTestId('battle-report-silent')).toBeVisible();
  await expect(page.getByText(/stayed out there/)).toBeVisible();
});

/**
 * §K2 to K5: two buttons, two windows, and one column in each.
 *
 * The line and the ring used to be two steppers on the same row of the same dialog, which put the
 * whole line-or-ring decision in front of somebody who had pressed a button that already said
 * where they were going. They are separate windows now, and what only a browser can say is that
 * each one carries the stepper it is for and *not* the other one: both write into the same state
 * and the same request, so a mode wired to the wrong half draws an identical screen.
 */
test('the line and the ring are two windows, each with one column and its own Half and Max', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  const fight = battles.coming[0]!.battle.id;
  await page.getByTestId(`deploy-open-${fight}`).click();
  await expect(page.getByTestId('deploy-rows')).toBeVisible();

  // The line, on its own. The ring's stepper is not in this window at all.
  await expect(page.getByTestId('line-razors')).toBeVisible();
  await expect(page.getByTestId('ring-razors')).toHaveCount(0);

  // Half and Max against the stepper, so a crew with a roster at home is not pressing a chevron
  // forty times. Half of what is at home, and everybody, both read back off the field.
  const home = lateGame.base!.army.razors!;
  await page.getByTestId('deploy-half-razors').click();
  await expect(page.getByTestId('line-razors')).toHaveValue(String(Math.floor(home / 2)));
  await page.getByTestId('deploy-max-razors').click();
  await expect(page.getByTestId('line-razors')).toHaveValue(String(home));

  // §K3: the name opens the roster's own card, portrait, sheet and marks, in the window where a
  // player is choosing who to send.
  await page
    .getByTestId('deploy-razors')
    .getByRole('button', { name: 'Razors', exact: true })
    .hover();
  const card = page.getByTestId('unit-razors');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('marks-razors')).toBeVisible();
  await expect(card).toBeInViewport();

  await settleFonts(page);
  await expectNothingClippedVertically(page, '[role="dialog"]');
  await page.screenshot({ path: 'e2e-out/battles-deploy.png', fullPage: true });

  // The ring, behind its own button, with the same controls over the other half of the request.
  await page.keyboard.press('Escape');
  await page.getByTestId(`perimeter-open-${fight}`).click();
  await expect(page.getByTestId('perimeter-dialog')).toBeVisible();
  await expect(page.getByTestId('ring-razors')).toBeVisible();
  await expect(page.getByTestId('line-razors')).toHaveCount(0);
  await page.getByTestId('deploy-max-razors').click();
  await expect(page.getByTestId('ring-razors')).toHaveValue(String(home));
  // A window that will not send what it just took is worse than no window: the confirm reads the
  // ring's deltas, and it used to read a state the ring never wrote to. The opacity is the same
  // assertion made in paint: the button fades up from its disabled state over 100ms, and a
  // screenshot taken inside that window shows a live control looking dead.
  await expect(page.getByTestId('deploy-confirm')).toBeEnabled();
  await expect(page.getByTestId('deploy-confirm')).toHaveCSS('opacity', '1');

  await settleFonts(page);
  await expectNothingClippedVertically(page, '[role="dialog"]');
  await page.screenshot({ path: 'e2e-out/battles-periphery.png', fullPage: true });
});

test('a district that is held end to end offers the gate and nothing else', async ({ page }) => {
  await installApi(page, lateGame);
  // `chrome-row` is the shut district in the fixture; the district page reads its gate off the
  // board rather than working it out from who holds what. It is a painted district now, so the
  // gate is a sign on the painting and clicking it is how a fight at the gate is called: there is
  // no `call-gate` button on a contested district, that one is the residential raid.
  await page.goto('/game/city/chrome-row');
  const gate = page.getByTestId('site-gate-chrome-row');
  await expect(gate).toBeVisible();
  await settleFonts(page);

  // The ground behind it is this crew's own in the fixture, so a location's window says so and
  // offers the work you do on your own ground, never a fight: the gate is the only thing here
  // that opens a caller.
  const anyLocation = page.locator('[data-testid^="site-chrome-row-"]').first();
  await expect(anyLocation).toBeVisible();
  await anyLocation.click();
  const window = page.getByTestId('location-window');
  await expect(window).toBeVisible();
  await expect(window.getByText(/yours/i).first()).toBeVisible();
  await expect(window.getByRole('button', { name: /Call a fight/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(window).toHaveCount(0);

  // And the gate is the one thing that does offer one.
  await gate.click();
  const caller = page.getByRole('dialog');
  await expect(caller).toBeVisible();
  await expect(caller.getByTestId('declare-confirm')).toBeVisible();
  await page.keyboard.press('Escape');

  await expectNothingClippedVertically(page, '[data-testid="district-painting-chrome-row"]');
  await page.screenshot({ path: 'e2e-out/battles-gate.png', fullPage: true });
});

/**
 * The red mark (board request, 2026-09-08): a fight called on your ground is a mark on the left
 * of the bottom bar on every screen, and pressing it opens the board.
 */
test('a fight called on you is a red mark on the bar that opens the board', async ({ page }) => {
  await installApi(page, {
    ...lateGame,
    unread: { messages: 0, notifications: 0, fightsOnYou: 2 },
  });
  await page.goto('/game/units');
  const mark = page.getByTestId('nav-fights');
  await expect(mark).toBeVisible();
  await expect(page.getByTestId('nav-fights-count')).toHaveText('2');
  await mark.click();
  await expect(page).toHaveURL(/\/game\/battles$/);
});

test('a quiet day draws no mark', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/units');
  await expect(page.getByTestId('nav-units')).toBeVisible();
  await expect(page.getByTestId('nav-fights')).toHaveCount(0);
});
