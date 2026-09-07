import { expect, test, type Page } from '@playwright/test';
import { installApi, screenOverflows, settleFonts } from './harness';
import { factionScreen, lateGame, me } from './fixtures';
import type { FactionResponse } from '@frontline/shared';

/**
 * The faction, the mailbox and the bell (board request).
 *
 * Three screens the standing bar leads to, and the properties that make them worth having rather
 * than three lists: an ally's fight can be reinforced from the faction screen, a message marks
 * itself read when it is opened, and a notification goes where it points.
 */

/**
 * §L: the screen is a room with the five of you at the table.
 *
 * What the assertions are for is that the picture is *made of the payload* rather than of
 * decoration: the crest carries the faction's own name and motto, each name plate hangs on one of
 * the row of seats with the seat's card and that person's name, the empty places are marked,
 * and the four readings are the payload's own numbers.
 */
test('the faction screen is a room with the table standing in it', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/faction');

  // The room is the screen, not a picture on one: the room's own plate, drawn whole, full bleed.
  await expect(page.getByTestId('faction-room')).toBeVisible();

  // The crest is pinned to the wall: the badge at seal size, the name as the page's heading, the
  // motto, and your own rank at this table.
  const crest = page.getByTestId('faction-identity');
  await expect(crest.getByRole('heading', { name: 'The Ninth Circle' })).toBeVisible();
  await expect(crest.getByText('Five streets, one arrangement', { exact: false })).toBeVisible();
  await expect(crest.getByRole('img', { name: "The Ninth Circle's badge" })).toBeVisible();
  await expect(crest.getByText('Leader', { exact: false })).toBeVisible();

  // Both members have a plate in the row with the seat's card on it (drawn, no asset, no
  // request), their name and their rank. The leader holds the ace of spades in the middle; the
  // chief beside them the king of diamonds.
  const seat = page.getByTestId('faction-seat-Sable_Ninth');
  await expect(seat).toContainText('Sable_Ninth');
  await expect(seat).toContainText('Chief');
  await expect(seat.getByRole('img', { name: 'King of diamonds' })).toBeVisible();
  const leader = page.getByTestId('faction-seat-Nikos');
  await expect(leader).toBeVisible();
  await expect(leader.getByRole('img', { name: 'Ace of spades' })).toBeVisible();
  // ...and the three places nobody is in are marked rather than left out of the picture.
  await expect(page.locator('[data-testid^="faction-empty-seat"]')).toHaveCount(3);

  // The four readings, top right, over the hall.
  await expect(page.locator('[data-testid^="dial-"]')).toHaveCount(4);
  await expect(page.getByTestId('dial-seats')).toContainText('2/5');
  // Bodies is the population the table's units take up (32 + 60 in the fixture), not a head count.
  await expect(page.getByTestId('dial-bodies')).toContainText('92');
  await expect(page.getByTestId('dial-fights')).toContainText('1');
  await expect(page.getByTestId('faction-vacancies')).toContainText('3 seats open');

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction.png', fullPage: false });

  // The Members door is the same people as rows, with what each of them brings: the seat's card,
  // what it is for, what it reads off them, and the mark they hold it at.
  await page.getByTestId('faction-door-members').click();
  const members = page.getByTestId('faction-members');
  await expect(members.getByText('Sable_Ninth')).toBeVisible();
  await expect(members.getByText('38', { exact: false }).first()).toBeVisible();
  const sableCard = page.getByTestId('faction-card-Sable_Ninth');
  await expect(sableCard).toContainText('Defences');
  await expect(sableCard).toContainText('Toughness, Organization and Resolve');
  await expect(members.getByRole('img', { name: 'King of diamonds' })).toBeVisible();
  await expect(members.getByTitle('Defences: D+')).toBeVisible();
  await expect(page.getByTestId('faction-card-Nikos')).toContainText('Attacks');

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction-roster.png', fullPage: false });
});

test('an ally’s fight counts down over the room, and opens the form that sends help', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/faction');

  // The chip carries what the decision needs: what it is against, whose it is, and the mark.
  const chip = page.getByTestId('fight-chip-ally-battle-1');
  await expect(chip).toContainText('The Tideline Market');
  await expect(chip).toContainText('Sable_Ninth');
  // The whole name, not `The Tidel…`: the chip is 184px wide at 1024 and the name is the thing on
  // it worth reading.
  await expect(chip.getByText('The Tideline Market', { exact: true })).toBeVisible();

  /*
   * And the clock on it *moves*.
   *
   * A countdown rendered once from `serverNow` draws a plausible number and then sits there, which
   * is the bug `useServerClock` exists for and the one thing a screenshot cannot catch. Read twice
   * with a second between: the mark is fifteen and a half hours after the fixture's clock, so the
   * seconds are the digits that have to change.
   */
  const first = await chip.innerText();
  await expect.poll(() => chip.innerText(), { timeout: 5_000 }).not.toBe(first);

  // Pressing it opens the send-help form on that fight, with its controls already unfolded.
  await chip.click();
  const fights = page.getByTestId('faction-fights-window');
  await expect(fights).toBeVisible();
  await expect(fights.getByText('24', { exact: false })).toBeVisible();
  // The card carries the mark's own wall clock, which the chip has no room for.
  await expect(fights.getByText('03:30')).toBeVisible();
  await expect(page.getByTestId('reinforce-unit-ally-battle-1')).toBeVisible();
  await expect(page.getByTestId('reinforce-ally-battle-1')).toBeVisible();

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction-send-help.png', fullPage: false });
});

test('a plate in the room opens that person’s file, with what your rank lets you do', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/faction');

  await page.getByTestId('faction-seat-Sable_Ninth').click();
  const file = page.getByTestId('member-window-Sable_Ninth');
  await expect(file).toBeVisible();
  await expect(file.getByText('The Ninth Street Irregulars', { exact: false })).toBeVisible();
  // Their card: what the seat is for, what it reads, and what their mark pays the table.
  const card = page.getByTestId('member-card');
  await expect(card).toContainText('King of diamonds');
  await expect(card).toContainText('Toughness, Organization and Resolve');
  await expect(card).toContainText('At their D+');
  await expect(card).toContainText('Holding your ground');
  // What they field is on their own file, so "who could help me" has an answer per person.
  await expect(file.getByText('Ironsides', { exact: false })).toBeVisible();
  // The fixture's player leads, so the three things a leader may do about a chief are here.
  await expect(page.getByTestId('rank-Sable_Ninth')).toHaveText('Demote');
  await expect(page.getByTestId('hand-over-Sable_Ninth')).toBeVisible();
  await expect(page.getByTestId('kick-Sable_Ninth')).toBeVisible();

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction-member.png', fullPage: false });

  // The same file opens from the row on the Members door, so both ways in reach one screen.
  await page.keyboard.press('Escape');
  await page.getByTestId('faction-door-members').click();
  await page.getByTestId('faction-member-Sable_Ninth').getByRole('button').click();
  await expect(page.getByTestId('member-window-Sable_Ninth')).toBeVisible();
});

test('the faction screen offers what an ally can field', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/faction');

  await page.getByTestId('faction-door-armies').click();
  const armies = page.getByTestId('faction-armies');
  await expect(armies.getByText('Sable_Ninth')).toBeVisible();
  await expect(armies.getByText('Ironsides', { exact: false })).toBeVisible();
  // ...and your own crew, marked as yours: "what we field" is the whole table.
  await expect(armies.getByText('Nikos')).toBeVisible();
  await expect(armies.getByText('you', { exact: true })).toBeVisible();
});

/**
 * §L4: the log and the description are behind doors, and there is no conversation.
 *
 * The room used to carry a chat at its foot, read out of the mailbox. The mailbox is where the
 * faction's messages live, and a second reading of the same rows was a second thing to keep in
 * step; it is gone, and nothing from the mailbox is drawn on this screen.
 */
test('the log is behind its door, the description is in the book, and nothing is a chat', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/faction');

  // Not a line of the faction's messages anywhere on the room.
  await expect(page.getByTestId('faction-tally')).toBeVisible();
  await expect(page.getByText('wide open on the north side', { exact: false })).toHaveCount(0);
  await expect(page.getByLabel('Say something to the table')).toHaveCount(0);

  await page.getByTestId('faction-door-log').click();
  const ledger = page.getByTestId('faction-log');
  await expect(ledger).toContainText('Sable_Ninth called a fight at The Tideline Market');
  await expect(ledger).toContainText('Sable_Ninth came to the table');
  await expect(ledger).toContainText('The Ninth Circle was put together');

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction-ledger.png', fullPage: false });

  // The fixture's player leads, so the description is editable in the book.
  await page.keyboard.press('Escape');
  await page.getByTestId('faction-door-book').click();
  await expect(page.getByTestId('edit-blurb')).toHaveValue(/Five streets/);
});

/**
 * The states the fixture does not carry, patched onto its own payload.
 *
 * A founder alone, a table with every seat taken, and a plain member's view of one. All three are
 * states a player really is in and none of them is reachable from `factionScreen`, so each is a
 * screen nobody had looked at: the empty half of the room, the full one, and the one where every
 * control that changes something is supposed to be gone.
 */
async function withFaction(
  page: Page,
  patch: (data: FactionResponse) => FactionResponse,
): Promise<void> {
  await page.route('**/api/factions', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(patch(structuredClone(factionScreen))),
    });
  });
}

test('a founder alone has four empty places and nothing coming', async ({ page }) => {
  await installApi(page, lateGame);
  await withFaction(page, (data) => ({
    ...data,
    members: data.members.filter((member) => member.rank === 'leader'),
    battles: [],
    armies: [],
  }));
  await page.goto('/game/faction');

  await expect(page.locator('[data-testid^="faction-seat-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="faction-empty-seat"]')).toHaveCount(4);
  await expect(page.getByTestId('faction-vacancies')).toContainText('4 seats open');
  // Nothing is called, so nothing hangs over the room.
  await expect(page.getByTestId('faction-fights')).toHaveCount(0);

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction-alone.png' });
});

test('a fourth fight goes behind one control rather than off the room', async ({ page }) => {
  await installApi(page, lateGame);
  await withFaction(page, (data) => {
    const called = data.battles[0];
    if (called === undefined) throw new Error('the fixture has no ally battle');
    const more = ['The Slag Bowl', 'Toolhouse Pawn', 'Dockside Pumphouse'].map(
      (targetName, at) => ({
        ...called,
        battleId: `ally-battle-${at + 2}`,
        targetName,
        scheduledFor: `2026-08-1${5 + at}T04:00:00.000Z`,
      }),
    );
    return { ...data, battles: [called, ...more] };
  });
  await page.goto('/game/faction');

  // Three over the room, soonest first, and the rest behind one control.
  await expect(page.locator('[data-testid^="fight-chip-"]')).toHaveCount(3);
  const more = page.getByTestId('faction-more-fights');
  await expect(more).toHaveText('+1 more');

  await more.click();
  const fights = page.getByTestId('faction-battles');
  await expect(fights.getByText('The Tideline Market')).toBeVisible();
  await expect(fights.getByText('Dockside Pumphouse')).toBeVisible();
  // The list is the whole list, with the send controls folded away until one is asked for.
  await expect(page.getByTestId('open-reinforce-ally-battle-4')).toBeVisible();

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction-fights.png', fullPage: false });
});

test('a full table seats five, with nowhere left to put anybody', async ({ page }) => {
  await installApi(page, lateGame);
  await withFaction(page, (data) => {
    const ally = data.members[1];
    if (ally === undefined) throw new Error('the fixture has no second member');
    const filler = ['Marrow', 'Vex_Combine', 'Kestrel'].map((username, at) => ({
      ...ally,
      userId: `filler-${at}`,
      baseId: `filler-base-${at}`,
      username,
      districtName: `${username}'s yard`,
      rank: 'member' as const,
      armySize: 12 + at,
      level: 4 + at,
    }));
    return { ...data, members: [...data.members, ...filler] };
  });
  await page.goto('/game/faction');

  await expect(page.locator('[data-testid^="faction-seat-"]')).toHaveCount(5);
  await expect(page.locator('[data-testid^="faction-empty-seat"]')).toHaveCount(0);
  await expect(page.getByTestId('faction-vacancies')).toHaveCount(0);
  await expect(page.getByTestId('dial-seats')).toContainText('5/5');

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction-full.png' });
});

test('a plain member is shown no way in and no way to rewrite the description', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await withFaction(page, (data) => ({
    ...data,
    rank: 'member',
    members: data.members.map((member) =>
      member.username === 'Nikos' ? { ...member, rank: 'member' as const } : member,
    ),
  }));
  await page.goto('/game/faction');

  // The seats say who can fill them rather than offering a control that would be refused.
  await expect(page.getByTestId('faction-vacancies')).toContainText('A chief or the leader');
  await expect(page.getByTestId('faction-vacancies')).not.toHaveRole('button');
  // Slot 2 is the leader's, in the middle of the row; the spare chairs are at the ends.
  await expect(page.getByTestId('faction-empty-seat-0')).not.toHaveRole('button');
  await expect(page.getByTestId('faction-empty-seat-0')).toContainText('A chief fills it');

  // The book reads the description back and offers nothing to change it with.
  await page.getByTestId('faction-door-book').click();
  await expect(page.getByTestId('faction-book')).toContainText('Five streets');
  await expect(page.getByTestId('edit-blurb')).toHaveCount(0);

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction-member-view.png' });
});

/**
 * The room must never cover the people at the table.
 *
 * Three glass panels float over a painting whose size is decided by the window, and the five name
 * plates hang at fractions of that painting. Every one of those relationships changes with the
 * viewport, and the failure is silent: a plate half under the doors, or behind the readings, is a
 * person the screen has quietly stopped showing. Measured at all four supported sizes rather than
 * looked at once at the size it was authored on.
 */
const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The seats, and the three panels each of them has to stay clear of. */
async function roomGeometry(page: Page): Promise<{
  seats: { name: string; box: Box }[];
  panels: { name: string; box: Box }[];
  viewport: { width: number; height: number };
}> {
  return page.evaluate(() => {
    const box = (el: Element) => {
      const { left, right, top, bottom } = el.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const seats = [
      ...document.querySelectorAll('[data-testid^="faction-seat-"]'),
      ...document.querySelectorAll('[data-testid^="faction-empty-seat"]'),
    ].map((el) => ({ name: el.getAttribute('data-testid') ?? '?', box: box(el) }));
    const panelOf = (testId: string, name: string) => {
      const panel = document.querySelector(`[data-testid="${testId}"]`);
      return panel === null ? [] : [{ name, box: box(panel) }];
    };
    return {
      seats,
      panels: [
        ...panelOf('faction-identity', 'the crest'),
        ...panelOf('faction-readings', 'the readings'),
        ...panelOf('faction-fights', 'the fight chips'),
        ...panelOf('faction-doors', 'the doors'),
      ],
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;

  test(`the room seats five in the clear at ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await installApi(page, lateGame);
    await page.goto('/game/faction');
    await expect(page.getByTestId('faction-room')).toBeVisible();
    await expect(page.getByTestId('faction-tally')).toBeVisible();
    await settleFonts(page);

    const { seats, panels, viewport } = await roomGeometry(page);
    expect(seats, 'five places, whoever is in them').toHaveLength(5);

    for (const seat of seats) {
      expect(seat.box.left, `${seat.name} is off the left edge`).toBeGreaterThanOrEqual(0);
      expect(seat.box.right, `${seat.name} is off the right edge`).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(seat.box.top, `${seat.name} is off the top`).toBeGreaterThanOrEqual(0);
      expect(seat.box.bottom, `${seat.name} is off the bottom`).toBeLessThanOrEqual(
        viewport.height,
      );

      for (const panel of panels) {
        const overlaps =
          seat.box.left < panel.box.right &&
          seat.box.right > panel.box.left &&
          seat.box.top < panel.box.bottom &&
          seat.box.bottom > panel.box.top;
        expect(overlaps, `${seat.name} is under ${panel.name}`).toBe(false);
      }
    }

    /*
     * No chip may cut the name it is about.
     *
     * `toBeVisible` and `toContainText` both pass on a name the panel has clipped to `The
     * Tidel…`: the text node is whole, the box around it is not. The overflow of the truncating
     * span is the only thing that says so, and 1024 is where it happens, because the chips row is
     * centred on the frame and has to clear the column on both sides.
     */
    const cut = await page.evaluate(() =>
      [
        ...document.querySelectorAll('[data-testid^="fight-chip-"] .truncate'),
        ...document.querySelectorAll('[data-testid^="faction-seat-"] .truncate'),
      ]
        .map((el) => ({ text: el.textContent ?? '', over: el.scrollWidth - el.clientWidth }))
        .filter((entry) => entry.over > 0),
    );
    expect(cut, 'a chip or a name plate is cutting its own text').toEqual([]);

    // ...and the screen itself does not overflow the window it is clipped by.
    expect(await screenOverflows(page)).toEqual([]);

    await page.screenshot({ path: `screenshots/faction-${tag}.png` });
  });
}

test('a player with no faction is offered both doors, and the invitation they hold', async ({
  page,
}) => {
  await installApi(page, me);
  await page.goto('/game/faction');

  const none = page.getByTestId('faction-none');
  await expect(none).toBeVisible();
  // The board's copy, and the shape of the screen: one question, two answers.
  await expect(
    page.getByRole('heading', { name: 'Join a faction or create your own' }),
  ).toBeVisible();
  await expect(none.getByText('The Ninth Circle')).toBeVisible();
  await expect(page.getByTestId('accept-invite-1')).toBeVisible();
  await expect(page.getByTestId('start-faction')).toBeVisible();

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction-none.png', fullPage: false });
});

test('founding one takes a name, a drawn badge and a description', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game/faction');

  await page.getByTestId('start-faction').click();
  const sheet = page.getByTestId('create-sheet');
  await expect(sheet).toBeVisible();

  // The three fields the board asked for, in order.
  await expect(page.getByTestId('faction-name')).toBeVisible();
  await expect(page.getByTestId('faction-blurb')).toBeVisible();

  // The badge is built rather than typed: shapes, colours, patterns and emblems, all drawn.
  await expect(page.getByTestId('badge-shape-roundel')).toBeVisible();
  await expect(page.getByTestId('badge-ground-oxblood')).toBeVisible();
  await expect(page.getByTestId('badge-prop-wolf')).toBeVisible();
  await expect(page.getByTestId('badge-roll')).toBeVisible();

  // Choosing a pattern opens the row that colours it, which does not exist while it is plain.
  await expect(page.getByTestId('badge-field-color-brass')).toHaveCount(0);
  await page.getByTestId('badge-field-bend').click();
  await expect(page.getByTestId('badge-field-color-brass')).toBeVisible();

  // ...and the button says Create.
  const create = page.getByTestId('found-faction');
  await expect(create).toHaveText('Create');
  await expect(create).toBeDisabled();
  await page.getByTestId('faction-name').fill('The Rust Assembly');
  await expect(create).toBeEnabled();

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction-create.png', fullPage: false });
});

test('an invitation in the mailbox joins only after a confirmation', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/messages');

  await page.getByTestId('message-msg-3').click();
  const card = page.getByTestId('invite-card');
  await expect(card).toBeVisible();
  await expect(card.getByText('The Ninth Circle', { exact: true })).toBeVisible();

  // The button does not join. It asks.
  await page.getByTestId('invite-accept').click();
  const confirm = page.getByTestId('confirm-join');
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText('Yes, join them')).toBeVisible();

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/invite-confirm.png', fullPage: false });
});

test('leaving as the leader says what it will cost before it does it', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/faction');

  await page.getByTestId('faction-door-book').click();
  // The three ranks, each with what it carries.
  await expect(page.getByTestId('rank-book').getByText('Chief')).toBeVisible();

  await page.getByTestId('leave-faction').click();
  const confirm = page.getByTestId('confirm-leave');
  await expect(confirm).toBeVisible();
  // The fixture's player leads a faction of two, so leaving disbands it, and it says so.
  await expect(confirm.getByText('This ends the faction')).toBeVisible();
  await expect(confirm.getByText('disbanded', { exact: false })).toBeVisible();
});

test('the mailbox reads, replies and keeps a sent copy', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/messages');

  // Unread first, and unread is a weight and a mark rather than colour alone.
  const list = page.getByTestId('message-list');
  await expect(list.getByText('The Tideline Market, oh-three-thirty')).toBeVisible();

  await page.getByTestId('message-msg-1').click();
  const open = page.getByTestId('message-open');
  await expect(open).toBeVisible();
  await expect(open.getByText('Sable_Ninth', { exact: false })).toBeVisible();
  await expect(open.getByText('wide open on the north side', { exact: false })).toBeVisible();

  // Reply quotes the original, which is what makes a mailbox a conversation.
  await page.getByTestId('reply').click();
  await expect(page.getByTestId('compose-form')).toBeVisible();
  await expect(page.getByTestId('compose-subject')).toHaveValue(/^Re: /);
  await expect(page.getByTestId('compose-body')).toHaveValue(/Sable_Ninth wrote:/);
  await page.keyboard.press('Escape');

  // The sent folder counts who has opened it, and dates it: `sentAt` is on the payload and the row
  // used to draw a read count and nothing else, so one folder was dated and the other was not.
  await page.getByTestId('folder-sent').click();
  const sent = page.getByTestId('sent-list');
  await expect(sent.getByText('1/2 read')).toBeVisible();

  /*
   * And a sent message opens.
   *
   * `SentMessage` has carried `body` since the folder existed and the page drew none of it: a
   * player could see that they had written something and had no way to read it back. It opens into
   * the same sheet the inbox uses, with the recipient where the sender goes and no Reply or Throw
   * it away, because neither means anything for a message you wrote.
   */
  await sent.getByTestId('sent-thread-3').click();
  const own = page.getByTestId('message-open');
  await expect(own).toBeVisible();
  await expect(own.getByText('Eight Ironsides to the waterfront.')).toBeVisible();
  await expect(own.getByText('To The Ninth Circle', { exact: false })).toBeVisible();
  await expect(own.getByTestId('reply'), 'you cannot reply to yourself').toHaveCount(0);
  await page.keyboard.press('Escape');

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/messages.png', fullPage: false });
});

test('the bell is the list, with the filters behind one drawn button', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/notifications');

  // No tabs: what happened *is* the screen, with nothing to click to reach it.
  const list = page.getByTestId('notification-list');
  await expect(list.getByText('A fight was won')).toBeVisible();
  await expect(list.getByText('Sable_Ninth is sending help')).toBeVisible();
  await expect(page.getByTestId('read-all-notifications')).toBeVisible();
  await expect(page.getByTestId('notification-tab-list')).toHaveCount(0);
  await expect(page.getByTestId('notification-tab-settings')).toHaveCount(0);

  await page.getByTestId('notification-preferences').click();
  const settings = page.getByTestId('notification-settings');
  await expect(settings).toBeVisible();

  // The two kinds a player may not silence are drawn as switched on and disabled, rather than
  // being quietly missing from the list: a filter that hides its own exceptions teaches nothing.
  const report = page.getByTestId('notify-battle_report');
  await expect(report).toBeChecked();
  await expect(report).toBeDisabled();
  // ...and one that is genuinely off, from the fixture's stored settings.
  await expect(page.getByTestId('notify-training_done')).not.toBeChecked();

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/notifications.png', fullPage: false });
});

test('the standing bar carries both counts, left of the fighting', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');

  await expect(page.getByTestId('hud-messages')).toBeVisible();
  await expect(page.getByTestId('hud-notifications')).toBeVisible();
  // Both doors sit before Battles in the DOM, which is the order the board asked for.
  const order = await page.evaluate(() => {
    const ids = ['hud-messages', 'hud-notifications', 'hud-battles'];
    return ids.map(
      (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().left ?? 0,
    );
  });
  expect(order[0]).toBeLessThan(order[1] ?? 0);
  expect(order[1]).toBeLessThan(order[2] ?? 0);
});

/**
 * §J9: the standings.
 *
 * The three properties that make it a ranking rather than a list: the two boards show different
 * things, a tie shares a place, and the scope control is a real request rather than a client-side
 * filter over a page of rows.
 */
test('the standings rank players, and a tie shares its place', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/leaderboard');

  const board = page.getByTestId('leaderboard');
  await expect(board).toBeVisible();
  await expect(board.getByText('Sable_Ninth')).toBeVisible();

  // Two on 4,000 are both third, and the board says so rather than ordering them 3 and 4.
  const ranks = await page.evaluate(() =>
    ['Nikos', 'Marrow'].map(
      (name) =>
        document
          .querySelector(`[data-testid="standing-${name}"]`)
          ?.firstElementChild?.textContent?.trim() ?? '',
    ),
  );
  expect(ranks).toEqual(['3', '3']);

  // Your own place, said whether or not you can see yourself in the list.
  await expect(page.getByTestId('your-rank')).toContainText('#3');

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/leaderboard.png', fullPage: false });
});

test('the standings have a faction board and a scope control', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/leaderboard');

  await page.getByTestId('board-factions').click();
  // Waited for by a row only the faction board has: the previous board stays on screen while the
  // next one loads (`placeholderData`), so asserting on shared text passes before the switch.
  await expect(page.getByTestId('standing-The Ninth Circle')).toBeVisible();
  // Ranked by what was earned at the table: the four-seat faction is second on 240.
  await expect(page.getByTestId('standing-Rust Assembly')).toContainText('240');
  await expect(page.getByTestId('leaderboard').getByText('Earned')).toBeVisible();

  // The scope toggle applies to whichever board is open.
  const local = page.getByTestId('local-only');
  await expect(local).not.toBeChecked();
  await local.check();
  await expect(local).toBeChecked();
});

test('the standings door sits next to Actions in the standing bar', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');
  await expect(page.getByTestId('hud-standings')).toBeVisible();

  const order = await page.evaluate(() => {
    const ids = ['hud-battles', 'hud-actions', 'hud-standings'];
    return ids.map(
      (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().left ?? 0,
    );
  });
  expect(order[0]).toBeLessThan(order[1] ?? 0);
  expect(order[1]).toBeLessThan(order[2] ?? 0);
});

/**
 * §K5: a receipt opens onto the thing it is a receipt for.
 *
 * The mission sheet is the one worth pinning, because it carries a fact that appears on no other
 * screen: what the job paid, against what the crew could actually carry home. A player who
 * under-crews every run has no other way to find out.
 */
test('opening a mission receipt shows the report, and what was left behind', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/notifications');

  await page.getByTestId('notification-note-0').click();
  const detail = page.getByTestId('notification-detail');
  await expect(detail).toBeVisible();

  const report = page.getByTestId('mission-report');
  await expect(report).toBeVisible();
  await expect(report.getByText('Deep Expedition')).toBeVisible();
  await expect(report.getByText('Clean')).toBeVisible();
  // Who went, off the frozen force on the row.
  await expect(page.getByTestId('report-force').getByText('Scavengers')).toBeVisible();

  // The haul, as carried out of earned: the fixture's crew brought back 335 scrap of 503.
  const scrap = page.getByTestId('haul-scrap');
  await expect(scrap).toContainText('335');
  await expect(scrap).toContainText('of 503');
  await expect(report.getByText('send more carriers', { exact: false })).toBeVisible();

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/mission-report.png', fullPage: false });
});

test('the mission picker offers half and max as one press', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/missions');

  // Open a job's launch panel: whichever offer the board is showing that a crew can be sent on.
  const send = page.locator('[data-testid^="send-"]:not([disabled])').first();
  await send.click();

  const max = page.locator('[data-testid^="max-"]').first();
  await expect(max).toBeVisible();
  await expect(page.locator('[data-testid^="half-"]').first()).toBeVisible();

  // The field is still a typed number with steppers; Max just fills it.
  const field = page.locator('input[type="number"]').first();
  await expect(field).toHaveValue('0');
  await max.click();
  await expect(field).not.toHaveValue('0');
});
