import { expect, test, type Page } from '@playwright/test';
import { factionProfile, leaderboardPlayers, me } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  growPastTheFold,
  installApi,
  screenOverflows,
  settleFonts,
} from './harness';

/**
 * The standings' two controls, and the faction file they lead to (maintainer request, 2026-09-12).
 *
 * `social.spec.ts` already covers what the board *is*: two boards, a tie sharing its place, the
 * scope control. This is the reading of it: sorting a hundred rows two ways, finding one crew by
 * name, and walking through the faction column onto a table's own page.
 *
 * The sizes are the two the board reads the game at. Both are swept for clipping and for a screen
 * wider than the box that holds it, with the menus **open**, because a picker that draws off the
 * bottom of the sheet is exactly the bug a screenshot of a closed one cannot show.
 */

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

const PLAYERS = leaderboardPlayers.board === 'players' ? leaderboardPlayers.entries : [];

/**
 * The faction's file, which the harness does not answer.
 *
 * Its `/api/factions/` handler serves the faction *room* to anything under that prefix, and the
 * file is a different shape. Registered after `installApi`, which is what puts it in front:
 * Playwright matches route handlers newest first.
 */
async function installFactionFile(page: Page): Promise<void> {
  await page.route('**/api/factions/*/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(factionProfile),
    }),
  );
}

async function openStandings(page: Page, width = 1280, height = 720): Promise<void> {
  await page.setViewportSize({ width, height });
  await installApi(page, me);
  await installFactionFile(page);
  await page.goto('/game/leaderboard');
  await expect(page.getByTestId('standing-Nikos')).toBeVisible();
  await settleFonts(page);
}

/** The names down the table, top to bottom. */
async function rows(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="leaderboard"] li')].map((row) =>
      (row.getAttribute('data-testid') ?? '').replace('standing-', ''),
    ),
  );
}

async function sortBy(page: Page, label: RegExp): Promise<void> {
  await page.getByTestId('standings-sort').click();
  await page.getByRole('option', { name: label }).click();
}

test.describe('reading the players board', () => {
  test('sorts by level and by lifetime total, and keeps the ranking honest', async ({ page }) => {
    await openStandings(page);
    expect(await rows(page)).toEqual(PLAYERS.map((entry) => entry.username));
    await expect(page.getByTestId('standings-sort')).toContainText('Standing');

    await sortBy(page, /^Level/);
    await expect.poll(async () => (await rows(page))[0]).toBe('Vex_Combine');
    // Vex is second on the board and first in the table: the menu reorders, it does not re-rank.
    await expect(page.getByTestId('standing-Vex_Combine')).toContainText('2');

    // `totalInfamy`, not the wallet: Ash_Wren is last by what they are holding and first by what
    // they have ever been paid, because they spent 36,300 of it on the ladder.
    await sortBy(page, /^Total infamy/);
    await expect.poll(async () => (await rows(page))[0]).toBe('Ash_Wren');
    await settleFonts(page);
    await page.screenshot({ path: 'e2e-out/standings-sorted.png' });
  });

  test('finds one crew by name and opens their file', async ({ page }) => {
    await openStandings(page);
    await page.getByTestId('standings-search').fill('ni');

    // `Nikos` starts with it, `Sable_Ninth` has a word that does. The prefix is recommended first.
    const picks = page.getByTestId('standings-suggestions').getByRole('option');
    await expect(picks.first()).toContainText('Nikos');
    await expect(picks).toHaveCount(2);
    await settleFonts(page);
    await page.screenshot({ path: 'e2e-out/standings-search.png' });

    // Typing alone narrows the table under the field.
    await page.getByTestId('standings-search').fill('marrow');
    await expect.poll(async () => rows(page)).toEqual(['Marrow']);

    await page.getByTestId('standings-suggestion-Marrow').click();
    await expect(page).toHaveURL(/\/game\/crews\/tied-user$/);
    await expect(page.getByTestId('crew-profile')).toBeVisible();
  });

  test('says so when a search answers nothing', async ({ page }) => {
    await openStandings(page);
    await page.getByTestId('standings-search').fill('qqqq');
    await expect(page.getByTestId('standings-no-match')).toContainText('qqqq');
    await expect(page.getByTestId('standings-suggestions')).toHaveCount(0);
  });

  test("a row's faction is a door to that faction's file", async ({ page }) => {
    await openStandings(page);
    // A crew at no table keeps plain text where the link would be.
    await expect(page.getByTestId('standing-faction-Marrow')).toHaveCount(0);
    await expect(page.getByTestId('standing-Marrow')).toContainText('none');

    await page.getByTestId('standing-faction-Nikos').click();
    await expect(page).toHaveURL(/\/game\/factions\/faction-1$/);
    await expect(page.getByTestId('faction-profile')).toBeVisible();
  });

  for (const size of SIZES) {
    test(`lays the board and its menus out cleanly at ${size.width}x${size.height}`, async ({
      page,
    }) => {
      await openStandings(page, size.width, size.height);

      // Both menus open at once: the widest state the controls strip is ever in.
      await page.getByTestId('standings-search').fill('n');
      await expect(page.getByTestId('standings-suggestions')).toBeVisible();
      await page.getByTestId('standings-sort').click();
      await expect(page.getByRole('option', { name: /^Total infamy/ })).toBeVisible();
      await settleFonts(page);
      await page.screenshot({ path: `e2e-out/standings-menus-${size.width}x${size.height}.png` });

      expect(await screenOverflows(page), 'the standings are wider than the screen').toEqual([]);
      await expectNothingClippedVertically(page, '[data-testid="standings-controls"]');
      await expectNothingClippedVertically(page, '[data-testid="standings-suggestions"]');
    });
  }
});

/**
 * How the board is drawn (maintainer request, 2026-09-13: "custom hand drawn graphics, more beautiful,
 * better UX, more structured").
 *
 * Three properties a screenshot cannot be trusted to hold on its own: the podium is a podium
 * (winner in the middle, and gone on a screen too short to spend the pixels), the ruled paper runs
 * past the last entry instead of leaving a blank third of a sheet, and the reader has a way back
 * to their own row.
 */
test.describe('the drawn board', () => {
  test('strikes the top three on a podium, winner in the middle', async ({ page }) => {
    await openStandings(page, 1920, 1080);
    const podium = page.getByTestId('standings-podium');
    await expect(podium).toBeVisible();

    const cards = podium.getByRole('link');
    await expect(cards).toHaveCount(3);
    // Drawn in the maintainer's own order, so a screen reader and the keyboard get the ranking.
    await expect(cards.nth(0)).toHaveAttribute('data-place', '1');
    await expect(cards.nth(0)).toContainText('Sable_Ninth');

    // And laid out 2, 1, 3, which is what a podium looks like. Measured rather than eyeballed:
    // the order is CSS, so a card that stopped being moved would still screenshot as three cards.
    const lefts = await cards.evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().left)),
    );
    const [first, second, third] = lefts;
    expect(first ?? 0, 'first place sits to the right of second').toBeGreaterThan(second ?? 0);
    expect(first ?? 0, 'first place sits to the left of third').toBeLessThan(third ?? 0);

    await settleFonts(page);
    await page.screenshot({ path: 'e2e-out/standings-podium.png' });
    await expectNothingClippedVertically(page, '[data-testid="standings-podium"]');
    await expectNoImagesClipped(page, '[data-testid="standings-podium"]');
  });

  /**
   * The short screen keeps its ranking.
   *
   * A hundred pixels of podium at 720 is two and a half rows of the thing it is summarising, and
   * the sheet only has about 440px to give.
   */
  test('spends no height on the podium at 1280x720', async ({ page }) => {
    await openStandings(page, 1280, 720);
    await expect(page.getByTestId('standings-podium')).toBeHidden();
    // Every row of the fixture still standing on the sheet, with nothing scrolled away.
    for (const entry of PLAYERS) {
      await expect(page.getByTestId(`standing-${entry.username}`)).toBeInViewport({ ratio: 1 });
    }
  });

  /** The ruled paper carries on past the last entry rather than stopping in a blank half-sheet. */
  test('rules the empty space under the last row', async ({ page }) => {
    await openStandings(page, 1920, 1080);
    const fill = page.getByTestId('ledger-fill');
    const box = await fill.boundingBox();
    expect(box?.height ?? 0, 'the sheet below five rows is blank paper').toBeGreaterThan(40);
  });

  test('offers the reader a way back to their own row, and only when there is one', async ({
    page,
  }) => {
    await openStandings(page);
    await expect(page.getByTestId('standing-Nikos')).toHaveAttribute('data-you', 'true');
    await expect(page.getByTestId('standings-find-me')).toBeVisible();

    // Searched off the board, the button would point at a row that is not drawn.
    await page.getByTestId('standings-search').fill('marrow');
    await expect(page.getByTestId('standings-find-me')).toHaveCount(0);
  });
});

/**
 * The factions' board, which ranks a different thing and is drawn as one.
 *
 * It used to be the players' table wearing different headings. A faction is a badge with seats at
 * it, so the identity cell is a badge, a name and how full the table is, and the head is inked
 * verdigris rather than brass.
 */
test.describe('the factions board', () => {
  async function openFactions(page: Page, width = 1280, height = 720): Promise<void> {
    await openStandings(page, width, height);
    await page.getByTestId('board-factions').click();
    await expect(page.getByTestId('standing-The Ninth Circle')).toBeVisible();
    await settleFonts(page);
  }

  test('says how full each table is and what its average is worth', async ({ page }) => {
    await openFactions(page);
    const row = page.getByTestId('standing-The Ninth Circle');
    await expect(row).toContainText('2 of 5 seats');
    // `averageLevel` has been on the wire since the maintainer asked for it and the screen dropped it.
    await expect(row).toContainText('9');
    await expect(page.getByTestId('standing-Rust Assembly')).toContainText('4 of 5 seats');

    // Every row is a door to that faction's file, which was the one row on this screen that led
    // nowhere.
    await page.getByTestId('standing-link-The Ninth Circle').click();
    await expect(page).toHaveURL(/\/game\/factions\/faction-1$/);
    await expect(page.getByTestId('faction-profile')).toBeVisible();
  });

  for (const size of SIZES) {
    test(`lays the factions out cleanly at ${size.width}x${size.height}`, async ({ page }) => {
      await openFactions(page, size.width, size.height);
      await page.screenshot({
        path: `e2e-out/standings-factions-${size.width}x${size.height}.png`,
      });
      expect(await screenOverflows(page), 'the factions board is wider than the screen').toEqual(
        [],
      );
      await expectNoImagesClipped(page, '[data-testid="leaderboard"]');
    });
  }
});

/** The players' board at both sizes, closed, which is the state a player actually reads it in. */
for (const size of SIZES) {
  test(`the players board at ${size.width}x${size.height}`, async ({ page }) => {
    await openStandings(page, size.width, size.height);
    await page.screenshot({ path: `e2e-out/standings-players-${size.width}x${size.height}.png` });
    expect(await screenOverflows(page), 'the players board is wider than the screen').toEqual([]);
    await expectNoImagesClipped(page, '[data-testid="leaderboard"]');
  });
}

test.describe("a faction's file", () => {
  async function openFile(page: Page, width = 1280, height = 720): Promise<void> {
    await page.setViewportSize({ width, height });
    await installApi(page, me);
    await installFactionFile(page);
    await page.goto('/game/factions/faction-1');
    await expect(page.getByTestId('faction-profile')).toBeVisible();
    await settleFonts(page);
  }

  test('is the badge, what the table has won, and everybody at it', async ({ page }) => {
    await openFile(page);
    await expect(page.getByRole('heading', { name: factionProfile.faction.name })).toBeVisible();
    await expect(
      page.getByTestId('faction-profile-badge').getByRole('img', { name: /badge/ }),
    ).toBeVisible();
    await expect(page.getByTestId('faction-profile-founded')).toContainText('12 August 2026');
    await expect(page.getByTestId('faction-profile-earned')).toContainText('1,820');
    await expect(page.getByTestId('faction-profile-average')).toContainText('9');
    await expect(page.getByTestId('faction-profile-rank')).toContainText('#1');

    for (const member of factionProfile.members) {
      const row = page.getByTestId(`faction-member-${member.username}`);
      await expect(row).toContainText(String(member.level));
      await expect(row).toContainText(Math.round(member.infamy).toLocaleString());
    }
    // A stranger is offered the board they came from, never the room.
    await expect(page.getByTestId('faction-profile-board')).toBeVisible();
    await expect(page.getByTestId('faction-profile-room')).toHaveCount(0);
    await page.screenshot({ path: 'e2e-out/faction-file.png' });
  });

  test('opens a member onto their crew file, and offers the mail addressed to them', async ({
    page,
  }) => {
    await openFile(page);
    await expect(page.getByTestId('faction-member-message-Sable_Ninth')).toHaveAttribute(
      'href',
      '/game/messages?to=Sable_Ninth',
    );

    /*
     * The chief is the row whose display name is not their login name, and the door has to carry
     * the login name: `POST /messages` resolves nothing else, so a door built on the name printed
     * on the row refused with `no_such_player` for everybody who had set one.
     *
     * Read off the fixture rather than typed, because a test id spelled by hand here would be the
     * login name, which is the one thing this page does not print.
     */
    const chief = factionProfile.members.find((member) => member.rank === 'chief');
    if (!chief) throw new Error('the faction file fixture needs a chief');
    expect(chief.handle, 'the chief needs two different names').not.toBe(chief.username);
    await expect(page.getByTestId(`faction-member-message-${chief.username}`)).toHaveAttribute(
      'href',
      `/game/messages?to=${chief.handle}`,
    );

    await page.getByTestId(`faction-member-link-${chief.username}`).click();
    await expect(page).toHaveURL(/\/game\/crews\/vex-user$/);
    await expect(page.getByTestId('crew-profile')).toBeVisible();
  });

  for (const size of SIZES) {
    test(`lays the file out cleanly at ${size.width}x${size.height}`, async ({ page }) => {
      await openFile(page, size.width, size.height);
      await page.screenshot({ path: `e2e-out/faction-file-${size.width}x${size.height}.png` });
      expect(await screenOverflows(page), 'the file is wider than the screen').toEqual([]);
      await growPastTheFold(page, size.width);
      await expectNothingClippedVertically(page, '[data-testid="page-sheet"]');
      await expectNoImagesClipped(page, '[data-testid="page-sheet"]');
      // The grown viewport, so the roster below the fold is in a picture somebody can look at.
      await page.screenshot({ path: `e2e-out/faction-file-whole-${size.width}.png` });
    });
  }
});
