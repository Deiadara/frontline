import { expect, test } from '@playwright/test';
import { installApi, settleFonts } from './harness';
import { lateGame, me } from './fixtures';

/**
 * The faction, the mailbox and the bell (board request).
 *
 * Three screens the standing bar leads to, and the properties that make them worth having rather
 * than three lists: an ally's fight can be reinforced from the faction screen, a message marks
 * itself read when it is opened, and a notification goes where it points.
 */

test('the faction screen shows the table, and what each person at it brings', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/faction');

  await expect(page.getByRole('heading', { name: 'The Ninth Circle' })).toBeVisible();
  // The rail is the screen: four doors onto four different questions.
  await expect(page.locator('[data-testid^="faction-section-"]')).toHaveCount(4);

  // Both members, the fixture included, drawn from real district data.
  const members = page.getByTestId('faction-members');
  await expect(members.getByText('Sable_Ninth')).toBeVisible();
  await expect(members.getByText('The Ninth Street Irregulars')).toBeVisible();
  await expect(members.getByText('38', { exact: false }).first()).toBeVisible();

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/faction.png', fullPage: false });
});

test('an ally’s fight can be reinforced from the faction screen', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/faction');

  await page.getByTestId('faction-section-fights').click();
  const battles = page.getByTestId('faction-battles');
  await expect(battles).toBeVisible();
  await expect(battles.getByText('The Tideline Market')).toBeVisible();
  // Whose fight it is, and what is already standing on their side: the two facts the decision needs.
  await expect(battles.getByText('Sable_Ninth', { exact: false })).toBeVisible();
  await expect(battles.getByText('24', { exact: false })).toBeVisible();

  // The control that actually sends bodies, which is the reason this screen exists.
  await expect(page.getByTestId('reinforce-ally-battle-1')).toBeVisible();
  await expect(page.getByTestId('reinforce-unit-ally-battle-1')).toBeVisible();
});

test('the faction screen offers what an ally can field', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/faction');

  await page.getByTestId('faction-section-armies').click();
  const armies = page.getByTestId('faction-armies');
  await expect(armies.getByText('Sable_Ninth')).toBeVisible();
  await expect(armies.getByText('Ironsides', { exact: false })).toBeVisible();
});

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

  await page.getByTestId('faction-section-book').click();
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

  // The sent folder counts who has opened it.
  await page.getByTestId('folder-sent').click();
  await expect(page.getByTestId('sent-list').getByText('1/2 read')).toBeVisible();

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
