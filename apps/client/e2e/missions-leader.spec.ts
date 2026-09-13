import {
  BATTLE_ODDS_LABELS,
  composeProfile,
  leaderFit,
  missionOdds,
  type MissionOffer,
  type MissionsResponse,
} from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { lateGame, missionsResponse } from './fixtures';
import { installApi, settleFonts } from './harness';

/**
 * Who leads a run, in a browser (maintainer, 2026-09-10).
 *
 * The unit tests drive the picker through jsdom, which has no layout and no painted dial. What
 * this file is for is the seam: the figure the dial strikes has to be the one `missionOdds`
 * prices the launch with, the leader has to reach the wire, and a run the crew's research forbids
 * has to be refused by the server's own words rather than by the client quietly not sending it.
 */

test.use({ viewport: { width: 1280, height: 800 } });

/**
 * The board with a crew slot free.
 *
 * The standard fixture fills every slot, which disables every Send button under §E3's capacity
 * rule: a launch test run against it fails on a dead control long before it reaches anything
 * this file is about.
 */
function boardWithARoom(overrides: Partial<MissionsResponse> = {}): MissionsResponse {
  const board = missionsResponse();
  return {
    ...board,
    missions: board.missions.filter((mission) => mission.status === 'resolved'),
    ...overrides,
  };
}

const routeBoard = (page: Page, board: MissionsResponse) =>
  page.route('**/api/missions', (route) => {
    if (route.request().method() === 'POST') return route.fallback();
    return route.fulfill({ json: board });
  });

/** The first job on the opening board, and the offer behind it. */
function firstOffer(board: MissionsResponse): MissionOffer {
  const offer = board.areas[0]?.offers[0];
  if (!offer) throw new Error('fixture error: the first board offers nothing');
  return offer;
}

/** The first job that is a fight, wherever it is on the boards. */
function firstBattle(board: MissionsResponse): { areaIndex: number; offer: MissionOffer } {
  for (const [areaIndex, area] of board.areas.entries()) {
    const offer = area.offers.find((one) => one.kind === 'battle');
    if (offer) return { areaIndex, offer };
  }
  throw new Error('fixture error: no battle job on any board');
}

const openSend = async (page: Page, offer: MissionOffer) => {
  await page.getByTestId(`send-${offer.templateId}`).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
};

test('the dial reads what the launch is priced with, and moves with the leader', async ({
  page,
}) => {
  const board = boardWithARoom();
  await installApi(page, lateGame);
  await routeBoard(page, board);
  await page.goto('/game/missions');
  await expect(page.getByTestId('board-area')).toBeVisible();

  const offer = firstOffer(board);
  const dialog = await openSend(page, offer);
  const figure = dialog.getByTestId('gauge-figure');
  const gauge = dialog.getByTestId('mission-gauge');

  /*
   * Nobody in charge yet, and this crew has researched the first rung, so the dial is already
   * showing the price of going without. Asserted through the shared function rather than against
   * a typed-in percentage: what is under test here is that the *screen* and the *launch* read the
   * same one, and a literal would pass on a screen that had quietly stopped calling it.
   */
  const profile = composeProfile(offer.leanings);
  const unled = missionOdds({
    authored: offer.authoredChance,
    leader: null,
    profile,
    unled: board.unledRule,
  });
  await expect(figure).toHaveText(`${Math.round(unled.chance * 100)}%`);
  await expect(dialog.getByTestId('unled-note')).toContainText('points off the odds');

  // The best of the ones who can go, and the dial follows the choice.
  await dialog.getByTestId('best-leader').click();
  const best = board.leaders
    .filter((one) => one.held === null)
    .reduce((top, one) =>
      leaderFit(one.attributes, profile).fit > leaderFit(top.attributes, profile).fit ? one : top,
    );
  await expect(dialog.getByTestId('send-leader')).toContainText(best.name);
  const led = missionOdds({
    authored: offer.authoredChance,
    leader: best.attributes,
    profile,
    unled: board.unledRule,
  });
  const points = Math.round(led.chance * 100);
  await expect(figure).toHaveText(`${points}%`);
  // The needle points at the figure it struck, not at the digits behind it: whole points is the
  // precision the dial prints and therefore the precision it sweeps to.
  const twoPlaces = (value: number) => Math.round(value * 100) / 100;
  await expect(gauge).toHaveAttribute('data-angle', String(twoPlaces(-90 + (points / 100) * 180)));
  await expect(dialog.getByTestId('unled-note')).toHaveCount(0);

  // The one who is out is on the list, dimmed, and cannot be taken.
  const away = board.leaders.find((one) => one.held === 'run');
  if (!away) throw new Error('fixture error: nobody is out on a run');
  await dialog.getByTestId('send-leader').click();
  const option = page.getByRole('option', { name: new RegExp(away.name) });
  await expect(option).toHaveAttribute('aria-disabled', 'true');
  await expect(option).toContainText('out leading a run');
  // Forced, because the browser will not click a control that says it is disabled: what is under
  // test is that a press that *does* land changes nothing.
  await option.click({ force: true });
  await expect(dialog.getByTestId('send-leader')).toContainText(best.name);
  // Shut with the trigger rather than with Escape: Escape belongs to the window on top, and the
  // window on top is the send dialog itself.
  await dialog.getByTestId('send-leader').click();
  await expect(page.getByRole('listbox')).toHaveCount(0);

  /*
   * And the server refuses them too, which is the half a dimmed row cannot prove.
   *
   * Fired past the picker on purpose: the dimming is a courtesy, the rule is the server's, and a
   * client that had quietly stopped sending `leaderId` at all would still have drawn that row
   * grey. The message is the one the launch route answers with.
   */
  const refused = await page.evaluate(
    async (body) => {
      const response = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: (await response.json()) as { error: { message: string } },
      };
    },
    {
      templateId: offer.templateId,
      areaId: board.areas[0]?.id ?? '',
      force: { razors: 3 },
      leaderId: away.id,
    },
  );
  expect(refused.status).toBe(409);
  expect(refused.body.error.message).toMatch(/is out leading a run/);

  // And the leader is what goes on the wire.
  await dialog.getByRole('spinbutton', { name: 'How many Razors' }).fill('3');
  const launch = page.waitForRequest(
    (request) => request.url().includes('/api/missions') && request.method() === 'POST',
  );
  await dialog.getByTestId('confirm-send').click();
  expect((await launch).postDataJSON()).toMatchObject({ leaderId: best.id, force: { razors: 3 } });
  await expect(page.getByRole('alert')).toHaveCount(0);

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/missions-leader.png', fullPage: false });
});

/**
 * The hold with no clock on it (maintainer, 2026-09-10).
 *
 * A run and a scouting party both end at a mark the server can name, so the picker counts down to
 * it. A declared fight does not: what frees that officer is the fight resolving. The row has to
 * say which of the two it is looking at rather than printing a countdown to a time it does not
 * have, and the launch has to refuse the same person in the same words.
 */
test('a leader who is at a fight is dimmed with no countdown, and refused on the wire', async ({
  page,
}) => {
  const board = boardWithARoom();
  await installApi(page, lateGame);
  await routeBoard(page, board);
  await page.goto('/game/missions');
  await expect(page.getByTestId('board-area')).toBeVisible();

  const fighting = board.leaders.find((one) => one.held === 'fight');
  if (!fighting) throw new Error('fixture error: nobody is at a fight');
  expect(fighting.heldUntil, 'a fight has no mark until it settles').toBeNull();

  const offer = firstOffer(board);
  const dialog = await openSend(page, offer);
  await dialog.getByTestId('send-leader').click();
  const option = page.getByRole('option', { name: new RegExp(fighting.name) });
  await expect(option).toHaveAttribute('aria-disabled', 'true');
  await expect(option).toContainText('at a fight');
  await expect(option).not.toContainText('back in');
  await dialog.getByTestId('send-leader').click();

  // And the rule behind the dimming, which is the server's.
  const refused = await page.evaluate(
    async (body) => {
      const response = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: (await response.json()) as { error: { message: string } },
      };
    },
    {
      templateId: offer.templateId,
      areaId: board.areas[0]?.id ?? '',
      force: { razors: 3 },
      leaderId: fighting.id,
    },
  );
  expect(refused.status).toBe(409);
  expect(refused.body.error.message).toBe(`${fighting.name} is at a fight`);
});

test('a crew that has not researched unled runs cannot send one', async ({ page }) => {
  const board = boardWithARoom({ unledRule: 'forbidden' });
  await installApi(page, lateGame);
  await routeBoard(page, board);
  await page.goto('/game/missions');
  await expect(page.getByTestId('board-area')).toBeVisible();

  const dialog = await openSend(page, firstOffer(board));
  await dialog.getByRole('spinbutton', { name: 'How many Razors' }).fill('3');

  // Refused on the screen, with the reason on it and the button dead.
  await expect(dialog.getByTestId('unled-note')).toHaveText(
    'Nobody leads this. Research unled runs, or send somebody.',
  );
  await expect(dialog.getByTestId('confirm-send')).toBeDisabled();

  // Somebody in charge and the same crew goes.
  await dialog.getByTestId('best-leader').click();
  await expect(dialog.getByTestId('unled-note')).toHaveCount(0);
  await expect(dialog.getByTestId('confirm-send')).toBeEnabled();
});

test('a battle shows a band and no number at all', async ({ page }) => {
  // Enough bodies at home to move the band. What a siege fields at this crew's level is several
  // times what the standard fixture keeps in the district, so a force capped by the roster could
  // only ever read `Low chance` and the second half of this test would assert nothing.
  const board = boardWithARoom({ army: { razors: 120, scavengers: 20 } });
  await installApi(page, lateGame);
  await routeBoard(page, board);
  await page.goto('/game/missions');
  await expect(page.getByTestId('board-area')).toBeVisible();

  const { areaIndex, offer } = firstBattle(board);
  for (let step = 0; step < areaIndex; step += 1) await page.getByTestId('board-right').click();
  await expect(page.getByTestId(`offer-${offer.templateId}`)).toBeVisible();

  // The card says the tier and nothing else about what is on that ground.
  if (offer.battleTier === null) throw new Error('fixture error: a battle with no tier');
  await expect(page.getByTestId(`job-chips-${offer.templateId}`)).toHaveText(
    { skirmish: 'A skirmish', fight: 'A fight', siege: 'A siege' }[offer.battleTier],
  );

  const dialog = await openSend(page, offer);
  const figure = dialog.getByTestId('gauge-figure');
  const bands = Object.values(BATTLE_ODDS_LABELS);
  expect(bands).toContain(await figure.textContent());
  await expect(dialog.getByTestId('mission-gauge')).not.toContainText('%');

  // Sending more moves the band up. Read as an index into the four, so this does not pin which
  // band a given number of Razors lands in: that is `battleOdds`' business, not this file's.
  const bandAt = async () => bands.indexOf((await figure.textContent()) ?? '');
  const before = await bandAt();
  await dialog.getByRole('spinbutton', { name: 'How many Razors' }).fill('120');
  await expect.poll(bandAt).toBeGreaterThan(before);
  await expect(dialog.getByTestId('mission-gauge')).not.toContainText('%');

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/missions-battle-band.png', fullPage: false });
});

/**
 * A leader who has just been sent out is out of the next job's picker.
 *
 * Two halves, and the browser is the only place both are on at once. The launch has to make the
 * board re-read itself, or the next dialog offers a name the server is now certain to refuse; and
 * the *fixture* has to put whoever led the run out on the leader list, or the refusal it is
 * modelling is one no test can reach. This runs against the harness's own board for exactly that
 * reason: the specs above serve boards of their own, which cannot carry a write.
 */
test('somebody sent out is off the picker for the next job in the same sitting', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/missions');
  await expect(page.getByTestId('board-area')).toBeVisible();

  const cards = page.locator('[data-testid^="offer-"]');
  const dialog = page.getByRole('dialog');
  const ghost = () => page.getByRole('option', { name: /The Ghost of Sector Nine/ });

  await cards
    .first()
    .getByRole('button', { name: /Send a crew/ })
    .click();
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('send-leader').click();
  await expect(ghost()).toHaveAttribute('aria-disabled', 'false');
  await expect(ghost()).toContainText('fits this job');
  await ghost().click();
  await dialog.getByRole('spinbutton', { name: 'How many Razors' }).fill('2');
  await dialog.getByTestId('confirm-send').click();
  await expect(dialog).toBeHidden();

  // The next job on the same board, opened while the player is still on this screen.
  await cards
    .nth(1)
    .getByRole('button', { name: /Send a crew/ })
    .click();
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('send-leader').click();
  /*
   * Three seconds, deliberately under the board's own 15s poll.
   *
   * The poll would get there eventually whatever the launch did, so an assertion on the default
   * 15s timeout is a race the poll wins: dropping the launch's `invalidateQueries` entirely left
   * this test green. What has to hold is that the *launch* re-reads the board, and a refetch it
   * asks for lands in tens of milliseconds.
   */
  await expect(ghost()).toHaveAttribute('aria-disabled', 'true', { timeout: 3_000 });
  await expect(ghost()).toContainText('out leading a run');
});
