import { CITY_DISTRICTS, STARTING_RESOURCES } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import {
  adminGame,
  bar,
  city,
  lateGame,
  me,
  meNoOverseer,
  overseer,
  paidBase,
  missionsResponse,
  paidMe,
  settlingMissions,
  settlingResearch,
} from './fixtures';
import { OFFICER_ROLES } from '@frontline/shared';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  installApi,
  settleFonts,
  walkBoards,
} from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

test('character select renders all presets', async ({ page }) => {
  await installApi(page, meNoOverseer);
  await page.goto('/overseer');

  await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
  await page.getByText(overseer.name).click();
  await expect(page.getByRole('button', { name: 'Confirm Overseer' })).toBeEnabled();

  // Both assertions below are geometry, so they are only meaningful once Roboto Condensed has
  // swapped in: the fallback has different metrics and would hide the clipping they exist to catch.
  await settleFonts(page);

  // The radar's axis labels sit outside the plotted rings, so a viewBox that is too tight
  // silently clips them mid-word ("TEC" renders as "C"). Assert each label's rendered box is
  // fully inside its svg rather than trusting the geometry constants to stay in agreement.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('svg[aria-label="Attribute radar"]')].flatMap((svg) => {
      const box = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('text')]
        .filter((label) => {
          const at = label.getBoundingClientRect();
          return (
            at.left < box.left - 0.5 ||
            at.right > box.right + 0.5 ||
            at.top < box.top - 0.5 ||
            at.bottom > box.bottom + 0.5
          );
        })
        .map((label) => label.textContent ?? '');
    }),
  );
  expect(clipped, 'radar axis labels must not be clipped by the viewBox').toEqual([]);

  // Nothing in a card may be cut off horizontally either.
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll('h3, p, span')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 40) ?? ''),
  );
  expect(overflowing, 'card text must not overflow its column').toEqual([]);

  // ...nor may the roster's scroll viewport end part-way down a card, slicing the attribute
  // rows through the digits. Every card the player can see must be whole.
  await expectNothingClippedVertically(page);

  // The same question for the pictures on this screen: the painted portraits and the radar rings
  // are `<svg>`/`<img>`, so the text guard above steps straight over both.
  await expectNoImagesClipped(page);

  await page.screenshot({ path: 'screenshots/character-select.png', fullPage: false });
});

/**
 * The crew chart (GDD §C1, §C2).
 *
 * Nineteen chairs, filled or empty, each drawn as a card whose top two thirds is the officer's
 * portrait. What this pins is that the chart shows *people*: a face at a size worth painting, the
 * four attribute peaks under it, and what they carry. It used to pin a row of pips and a §G7
 * percentage on every card, and both went with the assignee pool.
 */
test('the crew chart draws every chair, and a face on the filled ones', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/crew');

  // The crew screen opens on a quotation rather than its own name: the scenery switcher already
  // carries the word, lit, at the bottom of the frame. What identifies the screen is its content.
  await expect(page.getByTestId('crew-books')).toBeVisible();

  // Every position is drawn, filled or not: the point of the chart is that a player can see the
  // holes as well as the people.
  await expect(page.locator('[data-testid^="seat-"]')).toHaveCount(OFFICER_ROLES.length);
  await expect(page.getByText('Vacant').first()).toBeVisible();

  // A filled chair carries the person rather than a body count: their face, their name, and what
  // they bring. The portrait is the card, so its absence is the failure this screen could most
  // easily have shipped.
  const seat = page.getByTestId('seat-instructor_of_the_young');
  await expect(seat.locator('img, svg').first()).toBeVisible();
  await expect(seat.getByText('The Ghost of Sector Nine')).toBeVisible();
  // §B7: the keyword line is what the card leads with under the picture. The four group averages
  // that used to sit here were the same narrow band on all nineteen cards.
  await expect(seat.getByText('Wire Tap')).toBeVisible();

  // Opening a chair shows the whole sheet, what they cost, and the way to the training floor.
  await seat.click();
  const card = page.getByTestId('crew-detail');
  await expect(card).toBeVisible();
  await expect(card.getByText('On the books')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Training' })).toBeVisible();
  await expect(card.getByText('Cryptography')).toBeVisible();

  await settleFonts(page);

  // Officer names and role labels are the long strings here; nothing may ellipsise or spill.
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll('p, span')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 40) ?? ''),
  );
  expect(overflowing, 'officer names must not overflow their column').toEqual([]);
  // No vertical clipping gate: nineteen cards are taller than the sheet, so the last visible row
  // is always half-cut by the fold. That is what a scroller does.

  await page.screenshot({ path: 'screenshots/crew.png', fullPage: false });

  // And it closes again, which is the half of a drill-down that is easy to forget to build.
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card).toHaveCount(0);
});

test('the crew chart explains itself before anybody is hired', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game/crew');

  await expect(page.getByText('Nineteen positions, nobody in any of them yet')).toBeVisible();
  // Every position still drawn, all of them vacant: the chart is the explanation.
  await expect(page.getByText('Vacant')).toHaveCount(OFFICER_ROLES.length);
  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/crew-empty.png', fullPage: false });
});

test('game shell renders the city, with a way into every district', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game');

  await expect(
    page.getByRole('link', { name: new RegExp(`^${overseer.name}, Overseer`) }),
  ).toBeVisible();
  await expect(page.getByTestId('city-room')).toBeVisible();

  // Derived from the city rather than listed: a district added to `CITY_DISTRICTS` with no mark on
  // the painting is a place with no way in, and that is exactly the failure this catches.
  for (const district of CITY_DISTRICTS) {
    await expect(
      page.getByTestId(`district-tag-${district.id}`),
      `${district.name} has no tag on the painting`,
    ).toBeVisible();
  }

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/game.png', fullPage: false });
});

test('the hideout stands its structures on clickable plots', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game/base');

  await expect(page.getByTestId('faction-plaque')).toContainText('The Ninth Street Crew');
  // §A1: the structures are plots in a place now, not rows in a list, so they are found by the
  // control you click rather than by a name printed somewhere on the page.
  await expect(page.getByRole('button', { name: /^The Nexus,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^The Generator,/ })).toBeVisible();

  await page.screenshot({ path: 'screenshots/base.png', fullPage: false });
});

/**
 * The Bar (GDD §H). The roster sits inside the page's own scroller, so `fullPage` would not reach
 * the cards below the fold. They are scrolled to and re-checked instead (MOU-162).
 *
 * Installed against `lateGame`, not `me`: the `bar` fixture is a level-12 crew with 13 slots, a
 * `Feared` street and six figures of caps, and serving it over a starting session put "STREET
 * READS FEARED" directly under a HUD reading `Cautious` / infamy 0: the half-fixture MOU-207 was
 * filed about, visible only in the screenshot. The two now describe the same save.
 */
test('the bar lists tonight’s roster and the crew already signed', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/bar');

  // The room is the page, and the seat is the way into it.
  await expect(page.getByTestId('sit-down')).toBeVisible();
  await page.getByTestId('sit-down').click();
  await expect(page.getByTestId('recruit-name')).toHaveText('Dorotea "The Undergrid Ghost"');

  /*
   * §H3 refusals say which door is shut rather than just greying the card out, and there are two:
   * the rank the city has given the crew, and how long the crew has been at it. Both are on the
   * dossier of the person they apply to, so the seat is stepped along until each turns up.
   */
  const refusals = ['Your name is not big enough', 'Wants a crew that has been doing this longer'];
  for (const refusal of refusals) {
    let found = false;
    for (let step = 0; step < bar.recruits.length; step += 1) {
      if ((await page.getByTestId('bar-file').getByText(refusal).count()) > 0) {
        found = true;
        break;
      }
      // The arrow goes dead at the end of the roster rather than wrapping, so the walk stops
      // there too: clicking a disabled button would spend the timeout instead of the assertion.
      if (await page.getByTestId('seat-on').isDisabled()) break;
      await page.getByTestId('seat-on').click();
    }
    expect(found, `nobody at the bar is refused with "${refusal}"`).toBe(true);
  }
  await page.keyboard.press('Escape');

  /* Who is already on the books, and what each of them brings. This used to check §H5's two ends,
     a walkout warning and an earned skill bonus; that mechanic is gone and what a player needs from
     this list is now the keyword line and the wage. Behind the crew door either way. */
  await page.getByTestId('open-crew').click();
  await expect(page.getByText('The Ghost of Sector Nine')).toBeVisible();
  await expect(page.getByText('Wire Tap')).toBeVisible();
  await expect(page.getByText('caps/wk').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // §H7: the book is the constraint every offer on this screen answers to, one click away.
  await page.getByTestId('open-payroll').click();
  await expect(page.getByTestId('payroll-book')).toBeVisible();
  await expect(page.getByTestId('increase-payroll')).toBeVisible();
  await page.keyboard.press('Escape');

  await settleFonts(page);

  // Fixed copy that ellipsises is invisible to a document-overflow gate, so authored text is
  // measured directly. This is the defect class that shipped `ROUND TRI…` on the missions page.
  const truncated = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('h1, h2, h3, p, span, li, option')]
      .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 40) ?? ''),
  );
  expect(truncated, 'no authored label on the Bar may be cut off').toEqual([]);

  // The room itself, which is the page.
  await page.screenshot({ path: 'screenshots/bar.png', fullPage: false });

  /*
   * Back onto the stool, and one step the other way.
   *
   * Two things are pinned here. The seat **resumes** where it was left rather than snapping back
   * to the first drinker, which is what you want after ducking out to check the payroll; and the
   * back arrow walks the roster in the opposite direction from the forward one.
   *
   * It used to scroll a name into view, because the roster was a column of cards. There is no
   * column any more, so scrolling to a name waits for something that never happens: that is what
   * this test spent two minutes doing before it failed.
   */
  await page.getByTestId('sit-down').click();
  const resumed = (await page.getByTestId('recruit-name').textContent()) ?? '';
  const at = bar.recruits.findIndex((recruit) => recruit.name === resumed);
  expect(at, 'the seat reopened on somebody who is not in the room').toBeGreaterThanOrEqual(0);

  expect(
    at,
    'the walk through the refusals should have left the seat past the first drinker',
  ).toBeGreaterThan(0);
  await page.getByTestId('seat-back').click();
  await expect(page.getByTestId('recruit-name')).toHaveText(bar.recruits[at - 1]?.name ?? '');
  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/bar-scrolled.png', fullPage: false });
});

/**
 * The roster is a row of stools, not a carousel (MOU-172).
 *
 * Stepping used to wrap, so a player who had read to the last drinker and pressed on once more was
 * put back in front of the first as though they had missed them, with nothing on screen saying the
 * row had ended. Both arrows now go dead at their end, and they have to *look* dead: an arrow that
 * silently does nothing is indistinguishable from one that is broken.
 */
test('the bar’s seat screen stops at both ends of the roster', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/bar');
  await page.getByTestId('sit-down').click();
  await expect(page.getByTestId('bar-file')).toBeVisible();

  const first = bar.recruits[0]?.name ?? '';
  const last = bar.recruits[bar.recruits.length - 1]?.name ?? '';

  // It opens on the first drinker, so there is nobody behind them.
  await expect(page.getByTestId('recruit-name')).toHaveText(first);
  await expect(page.getByTestId('seat-back')).toBeDisabled();
  await expect(page.getByTestId('seat-on')).toBeEnabled();

  // The keyboard obeys the same stop as the arrow, since it is the same step.
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('recruit-name')).toHaveText(first);

  for (let step = 0; step < bar.recruits.length - 1; step += 1) {
    await page.getByTestId('seat-on').click();
  }

  await expect(page.getByTestId('recruit-name')).toHaveText(last);
  await expect(page.getByTestId('seat-on')).toBeDisabled();
  await expect(page.getByTestId('seat-back')).toBeEnabled();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('recruit-name')).toHaveText(last);
});

/**
 * Every standing note opens where it can be read.
 *
 * `HoverCard` places its card below the chip by default and used to clamp only the horizontal
 * axis, so a chip standing on the floor of a screen hung its card off the bottom of the window:
 * the Bar's was reported that way, and the Training and Black Market notes sit in the same corner.
 * The placement is shared, so it is measured across every screen that carries a note rather than
 * on the one that was reported.
 *
 * Run at the shortest viewport in the matrix, which is where a downward card runs out of room
 * first. The satchel's note only exists while the satchel is empty and this fixture's is not, so
 * eight of the nine are reachable: the count is asserted, because a sweep that quietly found
 * nothing would pass just as green as one that checked everything.
 */
/**
 * The gold, silver and blue edges, on **both** screens that draw them.
 *
 * They are one table (`lib/importance.ts`) read by two screens written a day apart, which is exactly
 * how the second one ends up a shade off the first or quietly loses the marks altogether. Asserted
 * as counts per tier rather than as "some row is marked": a rule that paints everything gold would
 * pass the weaker version.
 *
 * The Instructor of the Young is the fixture's officer, and their chair rates one skill
 * irreplaceable, two essential and three useful. That is the shape both screens have to show.
 */
test('an officer sheet edges every skill by what their chair wants, on crew and on training', async ({
  page,
}) => {
  await installApi(page, lateGame);

  const tally = async (): Promise<Record<string, number>> =>
    page.evaluate(() => {
      const out: Record<string, number> = {};
      for (const row of document.querySelectorAll('[data-importance]')) {
        const key = row.getAttribute('data-importance') ?? '?';
        out[key] = (out[key] ?? 0) + 1;
      }
      return out;
    });

  await page.goto('/game/crew');
  await page.getByTestId('seat-instructor_of_the_young').click();
  await expect(page.getByTestId('crew-detail')).toBeVisible();
  await settleFonts(page);
  const crew = await tally();
  expect(crew, 'the crew sheet lost its importance edges').toMatchObject({
    irreplaceable: 1,
    essential: 2,
    useful: 3,
  });

  // ...and the same officer on the training tab, where the drilling decision is actually made.
  await page.goto('/game/training');
  await settleFonts(page);
  await page.getByTestId('training-subjects').getByRole('button').nth(1).click();
  await expect(page.getByTestId('training-sheet')).toBeVisible();
  const training = await tally();
  expect(training.irreplaceable, 'the training tab lost its importance edges').toBeGreaterThan(0);
  expect(training.essential).toBeGreaterThan(0);
  expect(training.useful).toBeGreaterThan(0);

  // The Overseer sits in no chair, so their sheet is drawn plain rather than all-insignificant.
  await page.getByTestId('training-subjects').getByRole('button').first().click();
  await expect(page.getByTestId('training-sheet')).toBeVisible();
  expect(await tally()).toEqual({});
});

test('a standing note opens fully on screen, on every screen that has one', async ({ page }) => {
  const size = { width: 1280, height: 720 };
  await page.setViewportSize(size);
  await installApi(page, adminGame);

  const routes = [
    '/game/settings',
    '/game/workshop',
    '/game/market',
    '/game/market/black',
    '/game/bar',
    '/game/overseer',
    '/game/training',
    '/game/admin',
  ];

  const offScreen: string[] = [];
  let checked = 0;
  for (const route of routes) {
    await page.goto(route);
    const chip = page.getByTestId('info-note').first();
    await expect(chip, `${route} should carry a standing note`).toBeVisible();
    await settleFonts(page);
    await chip.hover();

    const card = page.getByRole('tooltip').first();
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    if (!box) throw new Error(`${route}: the note's card has no box`);
    checked += 1;

    const over = [
      box.y < 0 ? `${Math.round(-box.y)}px off the top` : '',
      box.y + box.height > size.height
        ? `${Math.round(box.y + box.height - size.height)}px off the bottom`
        : '',
      box.x < 0 ? `${Math.round(-box.x)}px off the left` : '',
      box.x + box.width > size.width
        ? `${Math.round(box.x + box.width - size.width)}px off the right`
        : '',
    ].filter(Boolean);
    if (over.length > 0) offScreen.push(`${route}: ${over.join(', ')}`);
  }

  expect(checked, 'the sweep must actually reach every note').toBe(routes.length);
  expect(offScreen, `standing notes opened off screen: ${offScreen.join(' | ')}`).toEqual([]);
});

/**
 * Walks into a district the way a player does: one click on its tag on the painting.
 *
 * It used to take two, on a Pixi canvas: click the district to select it, then `Enter the
 * district` in the panel that appeared. The city is a painting with a tag over each district now
 * and the tag is the door, so selecting and entering are the same gesture.
 */
async function enterDistrict(page: Page, id: string): Promise<void> {
  if (!CITY_DISTRICTS.some((district) => district.id === id)) {
    throw new Error(`missing ${id} district`);
  }
  await expect(page.getByTestId('city-room')).toBeVisible();
  await page.getByTestId(`district-tag-${id}`).click();
}

/**
 * Where each tag on the city goes, which is the whole of what this screen does.
 *
 * Nine of the ten lead to the district screen, which is for reading ground you do not hold: who is
 * on it, what it would take. The tenth is your own, and there the thing you actually want is the
 * hideout, so it leads there instead. That asymmetry is the one rule on this screen worth pinning,
 * and it is invisible in a screenshot.
 */
test('the city leads to the district screen, except on your own ground', async ({ page }) => {
  await installApi(page, me);
  const home = city.homeDistrictId;
  const away = CITY_DISTRICTS.find((district) => district.id !== home);
  if (!away) throw new Error('fixture error: the city has only one district');

  await page.goto('/game');
  await expect(page.getByTestId('city-room')).toBeVisible();
  await page.getByTestId(`district-tag-${home}`).click();
  await expect(page).toHaveURL(/\/game\/base$/);
  // The hideout, not a district screen dressed as one.
  await expect(page.getByTestId('faction-plaque')).toBeVisible();

  await page.goto('/game');
  await expect(page.getByTestId('city-room')).toBeVisible();
  await page.getByTestId(`district-tag-${away.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/game/city/${away.id}$`));
  // And it is *that* district, not whichever one the route happens to answer with.
  await expect(page.getByRole('heading', { name: away.name })).toBeVisible();
});

/**
 * A district whose name is initials says what they stand for, on the screen with room to say it.
 *
 * The city map draws `name` because a tag on a painting has room for three letters. `CCS` alone is
 * not a place a player can learn, so the district screen carries `formalName` under the heading.
 * Both halves are asserted: the sector shows it, and a district that has no formal name does not
 * grow an empty line where one would be.
 */
test('a district named in initials spells itself out on its own screen', async ({ page }) => {
  await installApi(page, lateGame);

  await page.goto('/game/city/combine-spire');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('CCS');
  await expect(page.getByTestId('district-formal-name')).toHaveText('Civic Command Sector');

  // Steelbelt is not an abbreviation, so it carries no second line at all.
  await page.goto('/game/city/rustyard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Steelbelt');
  await expect(page.getByTestId('district-formal-name')).toHaveCount(0);
});

test('the district view shows what is inside a scouted district (§A4)', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game');
  await enterDistrict(page, 'rustyard');
  await expect(page.getByTestId('locations')).toBeVisible();
  // Ground this crew holds reads differently from ground it does not, and offers different moves.
  await expect(page.getByText('Yours').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Call a fight' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dig in' })).toBeVisible();

  await page.screenshot({ path: 'screenshots/district-locations.png', fullPage: false });
});

/*
 * "Taking a place opens the report" was here, and it went with the instant-attack route (board,
 * battle rework). A place is taken by calling a fight and turning up to it now, which is
 * `e2e/battles.spec.ts`, and the report it opens is written when the settler runs, hours later,
 * rather than when a button is pressed.
 */

/*
 * MOU-227's report test went with it, for the same reason: §I1 still pays XP for a fight win or
 * lose, and the response that carries a level it bought is now the *build* response and the battle
 * settlement rather than an attack call. `District.test.tsx` covers the build half against a real
 * `fetch`; `battle/battle.test.ts` covers the settlement half.
 */

/** `brass-300` (#f0ad4c) as the browser reports it: the selected tier tab's painted colour. */
const ACTIVE_TAB_COLOR = 'rgb(240, 173, 76)';

test('the unit roster shows what is fielded and what is still locked (§A5)', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game/units');

  await expect(page.getByTestId('unit-catalogue')).toBeVisible();
  await expect(page.getByTestId('supply')).toBeVisible();
  await expect(page.getByTestId('unit-razors')).toBeVisible();

  // A locked tier says *what it is waiting on* rather than simply being absent.
  await page.getByRole('button', { name: 'Legendary' }).click();
  await expect(
    page.getByTestId('unit-the-colossus').or(page.getByTestId('unit-the_colossus')),
  ).toBeVisible();
  // The Colossus is assembled standing up now, on the only crane in the city (§A4).
  //
  // "Hold The", not "hold a": five of the location labels carry the article already, so the old
  // template produced "hold a The Doghouse", and the fix is the definite article everywhere. The
  // regex is anchored on the article for exactly that reason: a check for the place's name alone
  // would pass over the bug this wording exists to fix.
  await expect(page.getByText(/Hold The Construction Site/i)).toBeVisible();

  // The tier tabs carry `transition-colors`, and React flips the class a frame before the paint
  // catches up, so a screenshot taken the instant the cards change shows *Rabble* still lit over a
  // grid of legendaries. Nothing is wrong with the page; the artefact is what lies. Waiting on the
  // painted colour rather than on a duration makes the shot deterministic and asserts the highlight
  // actually follows the selection.
  await expect(page.getByRole('button', { name: 'Legendary' })).toHaveCSS(
    'color',
    ACTIVE_TAB_COLOR,
  );
  await expect(page.getByRole('button', { name: 'Rabble' })).not.toHaveCSS(
    'color',
    ACTIVE_TAB_COLOR,
  );

  await page.screenshot({ path: 'screenshots/units.png', fullPage: false });
});

/*
 * MOU-162 §E5: a crew lands while the player is watching it, and the payout reaches the HUD.
 *
 * This is the one path on which a stockpile moves with no player action behind it: missions settle
 * on the poll, and the missions page mounts no `me` observer of its own, so nothing refetches
 * unless the settling poll asks it to. The static board fixture cannot reach it: every mission
 * there is born active or born resolved, which is how a payout that never reached the HUD passed
 * 726 unit tests and 43 e2e ones.
 *
 * The wait is real: `MISSION_POLL_MS` is 15s, and the poll is the event under test.
 */
test('a crew that lands while the page is open pays the HUD', async ({ page }) => {
  const { pending, settled } = settlingMissions();
  const AFTER_POLL = 30_000;
  let landed = false;

  await installApi(page, me);
  // Registered after `installApi`, so these take precedence: Playwright tries the most recently
  // added handler first. Both flip on the same flag, the way one server answers both routes.
  const json = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify(data) });
  await page.route('**/api/missions', (route) => route.fulfill(json(landed ? settled : pending)));
  await page.route('**/api/me', (route) => route.fulfill(json(landed ? paidMe : me)));

  await page.goto('/game/missions');
  const hud = page.locator('header');
  const inFlight = page.getByRole('list', { name: 'Crews in flight' }).getByRole('listitem');
  const returned = page.getByRole('list', { name: 'Crews returned' }).getByRole('listitem');

  // One crew out, one already home, which is also the proof these routes, not the catch-all,
  // are the ones answering.
  await expect(inFlight).toHaveText([/Deep Expedition/]);
  await expect(returned).toHaveText([/Scrap Run/]);
  await expect(hud.getByText(String(STARTING_RESOURCES.caps), { exact: true })).toBeVisible();

  // The server banks the expedition on the next read.
  landed = true;

  // The crew that just landed is at the top, even though the scrap run launched a day after it.
  await expect(returned).toHaveText([/Deep Expedition/, /Scrap Run/], { timeout: AFTER_POLL });
  await expect(inFlight).toHaveCount(0);

  await expect(hud.getByText(String(paidBase.resources.caps), { exact: true })).toBeVisible({
    timeout: AFTER_POLL,
  });
  await expect(hud.getByText(String(paidBase.resources.scrap), { exact: true })).toBeVisible();

  await page.screenshot({ path: 'screenshots/missions-settled.png', fullPage: false });
});

/**
 * MOU-166 §B9: a project that lands while the page is open puts its facts on the page.
 *
 * The same trap the missions settlement was filed under: a research project settles lazily on the
 * `GET /api/research` read, so nothing turns a finished clock into a discovered fact unless the
 * poll asks. Every static research fixture is born either running or already idle, so the settle
 * path, the one moment the whole feature turns on, is reachable from no other test.
 *
 * The wait is real: `RESEARCH_POLL_MS` is 15s, and the poll is the event under test.
 */
test('a project that lands while the page is open shows what it found', async ({ page }) => {
  const { pending, settled } = settlingResearch();
  const AFTER_POLL = 30_000;
  let landed = false;

  await installApi(page, lateGame);
  // Registered after `installApi`, so this takes precedence: Playwright tries the most recently
  // added handler first.
  await page.route('**/api/research', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(landed ? settled : pending),
    }),
  );

  await page.goto('/game/research');

  // Running, with §F4's cross-reference showing: also the proof this route, not the catch-all,
  // is the one answering.
  await expect(page.getByText('Investigating the Instructor of the Young')).toBeVisible();
  await expect(page.getByText('Raid Boss')).toHaveCount(0);

  // The server banks it on the next read.
  landed = true;

  /*
   * The landing has to be visible from the section the player is standing on, which is the desk.
   *
   * The facts themselves live behind the files now, so the flag on the rail is what carries the
   * news: without it a project could finish under somebody's nose and they would find the three
   * facts an hour later with nothing having said so. Asserted *before* opening the files, because
   * a flag that only appears once you are already looking at the thing it announces is not a flag.
   */
  await expect(page.getByText('+3 just in')).toBeVisible({ timeout: AFTER_POLL });
  // And the bench is free again, so something else can be put on it.
  await expect(page.getByTestId('research-section-the-desk')).toContainText('Free');

  await page.getByTestId('research-section-the-files').click();
  const raidBossFacts = page.getByRole('listitem').filter({ hasText: 'Raid Boss' }).first();
  await expect(raidBossFacts).toBeVisible();
  await expect(raidBossFacts).toContainText('Intimidation');
  await expect(raidBossFacts).toContainText('Demolition');
  await expect(raidBossFacts, 'both facts count against the §B9 cap').toContainText('2 / 3 leads');

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/research-settled.png', fullPage: false });
});

/*
 * MOU-250 §G6: the launch path crosses the client/server seam, so it is asserted on the wire.
 *
 * The server refuses a `difficulty: 'hard'` template unless the launch names an officer, and the
 * client shipped with no way to name one: all four hard templates: both battles and the day-long
 * expedition: posted `{ templateId }`, took a 409, and returned the board to normal with no crew
 * out and nothing on screen. Every gate stayed green because the mocked handler answered any method
 * on `/api/missions` with the *board*, so no test ever reached the gate. These two cross it.
 */

/**
 * The board with a crew slot free.
 *
 * The standard fixture is deliberately the *fat* case, every one of the four slots filled, which
 * disables every Deploy button on the page under §E3's capacity rule. A launch test run against it
 * fails on a disabled control long before it reaches the §G6 gate it exists to exercise.
 */
const boardWithARoom = () => {
  const board = missionsResponse();
  return { ...board, missions: board.missions.filter((mission) => mission.status === 'resolved') };
};

/** Serve the board with a free slot, leaving whoever registered earlier to answer the launch. */
const routeBoard = (page: Page) =>
  page.route('**/api/missions', (route) => {
    if (route.request().method() === 'POST') return route.fallback();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(boardWithARoom()),
    });
  });

test('a hard mission goes out with an officer leading it', async ({ page }) => {
  await installApi(page, lateGame);
  await routeBoard(page);
  await page.goto('/game/missions');

  /*
   * A job §G6 will not let out unled, found by walking the boards.
   *
   * `Battle` is the kind, not the difficulty, and the two came apart when the pool grew: a
   * `debt-collection` is a battle an assignee crew may run alone. What this test is about is the
   * *officer gate*, so it needs a job that actually has one, and the signal on screen is the
   * picker defaulting to somebody rather than to "nobody".
   */
  const dialog = page.getByRole('dialog');
  const found = await walkBoards(page, async () => {
    const jobs = page.locator('[data-testid^="offer-"]');
    for (let index = 0; index < (await jobs.count()); index += 1) {
      await jobs
        .nth(index)
        .getByRole('button', { name: /Send a crew/ })
        .click();
      await expect(dialog).toBeVisible();
      if (await dialog.getByTestId('send-leader').getByText('The Ghost of Sector Nine').count()) {
        return true;
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
    return false;
  });
  expect(found).toBe(true);
  await expect(dialog).toBeVisible();

  // §G3: the first officer leads until the player says otherwise, so a hard job is never offering
  // a button the server is certain to refuse. Read as a *name*: that is what the player sees.
  await expect(dialog.getByTestId('send-leader')).toContainText('The Ghost of Sector Nine');

  // Somebody who can fight, because a battle job will not take porters alone (§A5).
  await dialog.getByRole('spinbutton', { name: 'How many Razors' }).fill('3');

  const launch = page.waitForRequest(
    (request) => request.url().includes('/api/missions') && request.method() === 'POST',
  );
  await dialog.getByTestId('confirm-send').click();
  const sent = (await launch).postDataJSON() as {
    templateId: string;
    areaId: string;
    force: Record<string, number>;
    officerId: string;
  };
  expect(sent.force).toEqual({ razors: 3 });
  expect(sent.officerId).toBe('off-1');
  expect(sent.areaId).toBeTruthy();
  expect(sent.templateId).toBeTruthy();

  // Accepted, so the board says nothing: the alert below is specific to a refusal.
  await expect(page.getByRole('alert')).toHaveCount(0);

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/missions-officer.png', fullPage: false });
});

/**
 * The painted picker, measured on the real boxes.
 *
 * A native `select` clips its own text with no ellipsis and no overflow to measure, and a closed
 * one's `option` elements have no box at all: both existing guards are blind to it, and the first
 * draft of this picker shipped "Instructor of the Yo" cut mid-word. The painted list is ordinary
 * DOM, so the check is the one every other guard in this suite uses: does the text fit the box.
 */
test('the officer picker cuts nobody off', async ({ page }) => {
  await installApi(page, lateGame);
  await routeBoard(page);
  await page.goto('/game/missions');

  await page
    .locator('[data-testid^="offer-"]')
    .first()
    .getByRole('button', { name: /Send a crew/ })
    .click();
  await page.getByTestId('send-leader').click();
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .filter((option) => option.scrollWidth > option.clientWidth + 1)
      .map((option) => option.textContent ?? ''),
  );
  expect(cut, 'no officer name may be cut off by the picker').toEqual([]);
  await page.keyboard.press('Escape');
});

test('a refused launch tells the player why', async ({ page }) => {
  await installApi(page, lateGame);
  await routeBoard(page);
  // Registered last, so this is what answers the launch; the board still comes from `routeBoard`.
  await page.route('**/api/missions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'MISSION_NEEDS_OFFICER',
          message: 'That job is too hard to run without an officer leading it',
        },
      }),
    });
  });

  await page.goto('/game/missions');
  const job = page.locator('[data-testid^="offer-"]').first();
  await job.getByRole('button', { name: /Send a crew/ }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton', { name: 'How many Razors' }).fill('2');
  await dialog.getByTestId('confirm-send').click();

  /*
   * In the card the player pressed, and *in the viewport*. The first draft put one message at the
   * foot of the board: `toHaveText` passed on it while it sat below a grid of cards, off-screen,
   * and a DOM assertion cannot tell "explained" from "invisible".
   */
  const refusal = job.getByRole('alert');
  await expect(refusal).toHaveText('That job is too hard to run without an officer leading it');
  await expect(refusal).toBeInViewport();
  // ...and only on that card, so the board does not read as three simultaneous failures.
  await expect(page.getByRole('alert')).toHaveCount(1);

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/missions-refused.png', fullPage: false });
});
