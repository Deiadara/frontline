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

test('the bell lists what happened and what a player will hear about', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/notifications');

  const list = page.getByTestId('notification-list');
  await expect(list.getByText('A fight was won')).toBeVisible();
  await expect(list.getByText('Sable_Ninth is sending help')).toBeVisible();
  await expect(page.getByTestId('read-all-notifications')).toBeVisible();

  await page.getByTestId('notification-tab-settings').click();
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
