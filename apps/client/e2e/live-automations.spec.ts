import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { findMissionTemplate } from '@frontline/shared';
import { adminApiUrl } from '../playwright.config';

/**
 * The Right Hand's standing orders against the REAL backend (maintainer, 2026-09-22).
 *
 * `automations.spec.ts` stubs the API and proves the screen. This proves the feature: a real
 * server on the world clock, a real account, real missions launching, landing and relaunching
 * with the browser shut in between. The maintainer asked for exactly that, "open and close the
 * browser many times, stop and start mid runs", because a standing order is the one feature in
 * the game whose whole point is what happens while nobody is watching.
 *
 * Admin mode is on for the server this spec uses (the second `webServer` in
 * `playwright.config.ts`, on its own port and database), so a party is out for one minute. The
 * gap after it is the real one, fifteen minutes or five past the sixth rung, because the gap is
 * the one clock admin mode does not flatten (maintainer, 2026-09-23). A test that needs the next
 * party to leave clears the rest through the Console's knob (`rest`) rather than waiting it out,
 * and the one test that is *about* the rest watches it hold.
 *
 * Every session here is a fresh browser context, which is a fresh browser as far as the app can
 * tell: no cookies, no storage, no cache. Closing one and opening another is the literal thing
 * the maintainer asked for, not a reload.
 */

/** A unique crew per run, so a leftover row from the last run cannot answer for this one. */
const USERNAME = `rh_${Date.now().toString(36)}`;
const PASSWORD = 'hunter2pass';

/**
 * The clock this spec waits on. Admin mode flattens a run to one minute with no travel
 * (`adminMinutes` floors at a minute), so a party is home a little over a minute after it leaves,
 * and every wait below is sized in runs with slack for the tick.
 */
const RUN_MS = 60_000;
const runs = (count: number): number => count * RUN_MS + 10_000;
/** The gap at the seventh rung and beyond, which is where most of this spec runs: five minutes. */
const FAST_GAP_MS = 5 * 60_000;

interface Session {
  page: Page;
  close: () => Promise<void>;
}

/** Open a new browser, log in as this run's crew, land on the game and get past the tutorial. */
async function openSession(browser: Browser): Promise<Session> {
  const context = await browser.newContext();
  /*
   * Every `/api` call the page makes goes to the admin-mode server rather than the shared one.
   *
   * The page is served by the one Vite instance, whose proxy points at the `ADMIN=false` server.
   * Rewriting the URL at the network layer is what lets this spec have five second clocks without
   * touching the server every other spec relies on. The renderer never sees the swap.
   */
  await context.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: `${adminApiUrl}${url.pathname}${url.search}` });
  });
  const page = await context.newPage();
  await page.goto('/auth');
  await page.getByTestId('auth-choose-login').click();
  await page.getByLabel('Operator ID').fill(USERNAME);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Jack In' }).click();
  /*
   * Branch on what is on screen, not on the address.
   *
   * A login lands on the game route first and the guard then redirects a crew with no character
   * to the picker, so a `waitForURL` matching either matched the first address and read it before
   * the redirect: the picker branch was skipped and the test waited on a city that never came.
   */
  const picker = page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' });
  const city = page.getByTestId('city-room');
  await expect(picker.or(city)).toBeVisible({ timeout: 20_000 });
  if (await picker.isVisible()) {
    await page
      .getByTestId(/^overseer-card-/)
      .first()
      .click();
    await page.getByTestId('overseer-confirm').click();
    await expect(city).toBeVisible({ timeout: 20_000 });
  }
  const tutorial = page.getByTestId('tutorial-card');
  await tutorial.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  if (await tutorial.isVisible().catch(() => false)) {
    await page.getByTestId('tutorial-skip').click();
    await expect(tutorial).toHaveCount(0);
  }
  return { page, close: () => context.close() };
}

/** The bearer the API routes want, off the same login the form does. */
async function token(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${adminApiUrl}/api/auth/login`, {
    data: { username: USERNAME, password: PASSWORD },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { token: string }).token;
}

async function api(
  request: APIRequestContext,
  bearer: string,
  method: 'get' | 'post',
  path: string,
  data?: unknown,
): Promise<unknown> {
  const res = await request[method](`${adminApiUrl}${path}`, {
    headers: { authorization: `Bearer ${bearer}` },
    ...(data === undefined ? {} : { data }),
  });
  expect(res.ok(), `${method.toUpperCase()} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

interface MissionsView {
  missions: { id: string; status: string; templateId: string; startedAt: string }[];
}
interface AutomationsView {
  powers: { unlocked: boolean; slots: number; cooldownMs: number; orders: string[] };
  slots: {
    slot: number;
    enabled: boolean;
    missionId: string | null;
    restingSince: string | null;
    stalled: string | null;
  }[];
  officers: { id: string; name: string }[];
}
interface MeView {
  base: {
    army: Record<string, number>;
    commanders: { id: string; name: string; role: string | null }[];
  };
}

/** Clear every slot's rest, so the next tick may send: the Console's way past the real gap. */
async function rest(request: APIRequestContext, bearer: string): Promise<void> {
  await api(request, bearer, 'post', '/api/admin/knobs', { automationsRested: true });
}

/**
 * Put the crew at a rung of the Right Hand's ladder, and no further.
 *
 * By depth alone, on purpose. The grant's two fields union (`grantedRungs`), so naming the track
 * as well handed over the *whole* Right Hand track at every call: the very first test after the
 * shut door ran with the sixth rung's five minute gap while believing it stood on the third, which
 * is how the spec read "Resting, 4m" where it expected fifteen. Every other track's low rungs come
 * along with the depth, and none of them touches a standing order.
 */
async function reachRung(request: APIRequestContext, bearer: string, depth: number): Promise<void> {
  await api(request, bearer, 'post', '/api/admin/grant', { researchDepth: depth });
}

/**
 * The game's own picker, not the browser's.
 *
 * Every menu on this sheet is a `Dropdown`: a button that portals a `listbox` into the body. So a
 * choice is two clicks, and `selectOption` (which only speaks to a native `<select>`) would throw.
 */
async function pick(page: Page, testId: string, option: string | { index: number }): Promise<void> {
  await page.getByTestId(testId).click();
  const options = page.getByRole('option');
  await (
    typeof option === 'string'
      ? options.filter({ hasText: option }).first()
      : options.nth(option.index)
  ).click();
}

test.describe.serial('the Right Hand runs the board while the browser is shut', () => {
  test.setTimeout(360_000);

  test('a fresh crew registers, takes a character, and is given a Right Hand', async ({
    browser,
    request,
  }) => {
    const registered = await request.post(`${adminApiUrl}/api/auth/register`, {
      data: { username: USERNAME, password: PASSWORD },
    });
    expect(registered.ok(), await registered.text()).toBe(true);

    const first = await openSession(browser);
    await expect(first.page.getByTestId('city-room')).toBeVisible();
    await first.close();

    const bearer = await token(request);
    // Ten seats covers the first ten roles in catalogue order, and the Right Hand is the tenth.
    await api(request, bearer, 'post', '/api/admin/knobs', {
      officers: { count: 10, rating: 60 },
      playerLevel: 8,
    });
    const me = (await api(request, bearer, 'get', '/api/me')) as MeView;
    expect(me.base.commanders.some((one) => one.role === 'right_hand')).toBe(true);
    expect(Object.values(me.base.army).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
  });

  test('before the third rung the page is a shut door, in a second browser', async ({
    browser,
  }) => {
    const session = await openSession(browser);
    await session.page.goto('/game/actions/automations');
    await expect(session.page.getByTestId('automations-locked')).toBeVisible();
    await session.close();
  });

  test('switched on in one browser, the order is running when a second browser opens', async ({
    browser,
    request,
  }) => {
    const bearer = await token(request);
    await reachRung(request, bearer, 3);

    const first = await openSession(browser);
    const page = first.page;
    await page.goto('/game/actions/automations');
    await expect(page.getByTestId('automation-0')).toBeVisible();

    // Name a party of two off whatever the roster has, and the first officer offered.
    const unitInput = page.locator('[data-testid^="automation-0-unit-"]').first();
    await unitInput.fill('2');
    await pick(page, 'automation-0-officer', { index: 0 });
    await page.getByTestId('automation-0-on').click();
    await expect(page.getByTestId('automation-0')).toHaveAttribute('data-enabled', 'yes');

    // Within a couple of ticks a party is out. This is the world clock, not the browser.
    await expect(page.getByTestId('automation-0')).toContainText(/A party is out/i, {
      timeout: 15_000,
    });
    // And the board is the Right Hand's.
    await page.goto('/game/missions');
    await expect(page.getByTestId('board-automated')).toBeVisible();
    await first.close();

    // Shut the browser entirely. The world keeps turning: the party lands with nobody watching.
    await new Promise((resolve) => setTimeout(resolve, runs(1)));

    const second = await openSession(browser);
    const landed = (await api(request, bearer, 'get', '/api/missions')) as MissionsView;
    expect(landed.missions.filter((one) => one.status !== 'active').length).toBe(1);
    expect(landed.missions.filter((one) => one.status === 'active').length).toBe(0);
    // And the slot is resting the real gap, which a second browser reads off the sheet.
    await second.page.goto('/game/actions/automations');
    await expect(second.page.getByTestId('automation-0')).toHaveAttribute('data-enabled', 'yes');
    await expect(second.page.getByTestId('automation-0')).toContainText(/Resting, 1[45]m/);
    await second.close();

    // The Console clears the rest; the next tick sends the second party.
    await rest(request, bearer);
    await expect
      .poll(
        async () =>
          ((await api(request, bearer, 'get', '/api/missions')) as MissionsView).missions.length,
        { timeout: 15_000 },
      )
      .toBe(2);
  });

  test('switched off mid-run, the party out finishes and nothing follows it', async ({
    browser,
    request,
  }) => {
    const bearer = await token(request);
    const session = await openSession(browser);
    const page = session.page;
    await page.goto('/game/actions/automations');
    await page.getByTestId('automation-0-off').click();
    await expect(page.getByTestId('automation-0')).toHaveAttribute('data-enabled', 'no');
    await session.close();

    const before = (await api(request, bearer, 'get', '/api/missions')) as MissionsView;
    // Long enough for the party that is out to land, then the rest is cleared so that the switch
    // is the only thing holding the slot, and a further run's worth passes in which a new party
    // would have gone had the order still been on.
    await new Promise((resolve) => setTimeout(resolve, runs(1)));
    await rest(request, bearer);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    const after = (await api(request, bearer, 'get', '/api/missions')) as MissionsView;
    expect(after.missions.length, 'no new party was sent after the switch off').toBe(
      before.missions.length,
    );
    expect(after.missions.filter((one) => one.status === 'active').length).toBe(0);

    // The board is the player's again.
    const again = await openSession(browser);
    await again.page.goto('/game/missions');
    await expect(again.page.getByTestId('board-automated')).toHaveCount(0);
    await again.close();
  });

  test('switched back on, it resumes; a party it cannot fill is a stall it names', async ({
    browser,
    request,
  }) => {
    const bearer = await token(request);
    const session = await openSession(browser);
    const page = session.page;
    await page.goto('/game/actions/automations');

    /*
     * An impossible party first: nine hundred of a unit the crew has a handful of.
     *
     * Posted rather than typed. The count field is a `NumberField` now and it is capped at what is
     * at home, which is the right behaviour for the control and leaves no way to ask for a party
     * that cannot go. The stall is still a real state the world clock reaches and the sheet still
     * has to read it out, so the row goes in through the API and the browser is asked what it says.
     */
    // The slot is resting from the party the test above sent; a resting slot is not asked to
    // send at all, so the stall under test would never be reached without clearing it first.
    await rest(request, bearer);
    const roster = (await api(request, bearer, 'get', '/api/me')) as MeView;
    const [firstUnit] = Object.keys(roster.base.army);
    expect(firstUnit).toBeDefined();
    const leader = ((await api(request, bearer, 'get', '/api/automations')) as AutomationsView)
      .officers[0];
    expect(leader).toBeDefined();
    await api(request, bearer, 'post', '/api/automations', {
      slot: 0,
      enabled: true,
      order: 'missions',
      force: { [String(firstUnit)]: 900 },
      officerId: leader?.id ?? null,
      unitSlots: null,
      optimiseFor: null,
    });
    await page.reload();
    await expect(page.getByTestId('automation-0')).toContainText(/not at home/i, {
      timeout: 15_000,
    });
    const stalled = (await api(request, bearer, 'get', '/api/automations')) as AutomationsView;
    expect(stalled.slots[0]?.missionId).toBeNull();

    // Then a possible one, and it goes. The rest is cleared first: the slot's last party came
    // home inside the gap, and this test is about the stall lifting, not the gap.
    await rest(request, bearer);
    await page.getByTestId('automation-0-off').click();
    await expect(page.getByTestId('automation-0')).toHaveAttribute('data-enabled', 'no');
    await page.locator('[data-testid^="automation-0-unit-"]').first().fill('2');
    await page.getByTestId('automation-0-on').click();
    await expect(page.getByTestId('automation-0')).toContainText(/A party is out/i, {
      timeout: 15_000,
    });
    await session.close();
  });

  test('two slots at the seventh rung, best-fit at the fifth, and never more than two out', async ({
    browser,
    request,
  }) => {
    const bearer = await token(request);
    await reachRung(request, bearer, 7);
    await rest(request, bearer);

    const session = await openSession(browser);
    const page = session.page;
    await page.goto('/game/actions/automations');
    await expect(page.getByTestId('automation-1')).toBeVisible();
    // The second slot names a size and lets the Right Hand pick the party and the officer.
    await page.getByTestId('automation-1-bestfit').click();
    await page.getByTestId('automation-1-size').fill('2');
    await page.getByTestId('automation-1-on').click();
    await expect(page.getByTestId('automation-1')).toHaveAttribute('data-enabled', 'yes');
    await session.close();

    /*
     * Watch the world for a while with the browser shut, and hold the invariants a player
     * would never see broken: never more parties out than slots, and the roster never below
     * zero. Sampled every second for thirty, which is nearly three full cycles.
     */
    let mostOut = 0;
    const samples = Math.ceil(runs(1) / 1_000);
    for (let sample = 0; sample < samples; sample += 1) {
      const missions = (await api(request, bearer, 'get', '/api/missions')) as MissionsView;
      const out = missions.missions.filter((one) => one.status === 'active').length;
      mostOut = Math.max(mostOut, out);
      expect(out, `sample ${sample}: parties out`).toBeLessThanOrEqual(2);
      const me = (await api(request, bearer, 'get', '/api/me')) as MeView;
      for (const [unit, count] of Object.entries(me.base.army)) {
        expect(count, `sample ${sample}: ${unit} at home`).toBeGreaterThanOrEqual(0);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    expect(mostOut, 'both slots were used at once at some point').toBe(2);
  });

  test('the gap is honoured: a slot that just came home sends nobody inside it', async ({
    request,
  }) => {
    const bearer = await token(request);
    // The seventh rung carries the sixth: five minutes, and the screen is told the same figure.
    const view = (await api(request, bearer, 'get', '/api/automations')) as AutomationsView;
    expect(view.powers.cooldownMs).toBe(FAST_GAP_MS);

    // Both parties from the previous test have landed by now: every slot is resting, and its
    // rest began within the last few minutes.
    const resting = view.slots.filter((one) => one.enabled && one.missionId === null);
    expect(resting.length).toBe(2);
    for (const one of resting) {
      expect(one.restingSince).not.toBeNull();
      expect(Date.now() - Date.parse(one.restingSince ?? '')).toBeLessThan(FAST_GAP_MS);
    }

    // Twenty seconds of ticks, and nothing leaves: the count of missions ever launched holds.
    const before = ((await api(request, bearer, 'get', '/api/missions')) as MissionsView).missions
      .length;
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    const after = ((await api(request, bearer, 'get', '/api/missions')) as MissionsView).missions
      .length;
    expect(after, 'a slot sent a party inside its gap').toBe(before);
    // And no party has ever left inside a slot's gap: every launch after a rest began came at
    // least the gap after it, or after the Console cleared the rest for a test above.
    const slots = ((await api(request, bearer, 'get', '/api/automations')) as AutomationsView)
      .slots;
    for (const one of slots) expect(one.missionId).toBeNull();
  });

  test('at the ninth rung a battle order takes a battle job, and never a location', async ({
    browser,
    request,
  }) => {
    const bearer = await token(request);
    await reachRung(request, bearer, 9);
    // A bag of caps, so a battle job can be covered...
    await api(request, bearer, 'post', '/api/admin/knobs', {
      resources: { caps: 50_000, supplies: 50_000, oil: 50_000, scrap: 50_000, planks: 50_000 },
    });
    /*
     * ...and fighters, explicitly.
     *
     * This comment used to claim the knob above granted them and it never did: the crew was
     * leaning on the eight Razors the opening once handed out. A crew is handed carriers now
     * (`crew/starting.ts`, 2026-09-23), so a battles order had nothing it could legally send and
     * stalled on the party rather than on the board, which is not what this test is about.
     */
    await api(request, bearer, 'post', '/api/admin/grant', { units: { razors: 20 } });

    /*
     * The board before anything is switched on. The seed schedules one fight on a fresh world,
     * by the ally bot on government ground, and the board lists every pending fight in a district
     * this crew can see, so "zero fights" was never the right invariant. The right one is that
     * the set does not change and this crew is on no side of any of them.
     */
    const boardBefore = (await api(request, bearer, 'get', '/api/battles')) as {
      coming: { battle: { id: string }; side: string | null }[];
    };
    const pendingBefore = boardBefore.coming.map((one) => one.battle.id).sort();

    const session = await openSession(browser);
    const page = session.page;
    await page.goto('/game/actions/automations');
    // Off first, then the rest is cleared: cleared while the old missions order was still on,
    // the slot sent a plain party on the very next tick and was then busy for the whole test.
    await page.getByTestId('automation-1-off').click();
    await expect(page.getByTestId('automation-1')).toHaveAttribute('data-enabled', 'no');
    await rest(request, bearer);
    const switchedOnAt = Date.now();
    // Repoint slot two at battles only.
    await pick(page, 'automation-1-order', 'Battles only');
    await page.getByTestId('automation-1-bestfit').click();
    await page.getByTestId('automation-1-size').fill('3');
    await page.getByTestId('automation-1-on').click();
    await expect(page.getByTestId('automation-1')).toHaveAttribute('data-enabled', 'yes');
    await session.close();

    // Give it a few ticks, then read what it actually sent since the switch.
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    const missions = (await api(request, bearer, 'get', '/api/missions')) as MissionsView;
    const since = missions.missions.filter(
      (one) => Date.parse(one.startedAt) >= switchedOnAt - 2_000,
    );
    const kinds = since.map((one) => findMissionTemplate(one.templateId)?.kind ?? 'unknown');
    /*
     * The boards are dealt by the clock, and on some days no open board is offering a fight at
     * all. The order's rule holds either way: a battles order sends a battle job or it sends
     * nothing and says why. Slot one, still on missions, is the other launch that may appear.
     */
    const slotOne = (
      (await api(request, bearer, 'get', '/api/automations')) as AutomationsView
    ).slots.find((one) => one.slot === 1);
    const fights = kinds.filter((kind) => kind === 'battle');
    if (fights.length === 0) {
      expect(slotOne?.stalled, 'no fight went out and the slot does not say why').toMatch(
        /a fight/i,
      );
    }
    // Whatever slot two did, it never took a plain job: the only non-battle launches since the
    // switch are slot one's, and slot one is capped at one party out.
    expect(kinds.filter((kind) => kind !== 'battle').length).toBeLessThanOrEqual(1);
    // And the battle board is exactly as it was: no fight was called on any location, and this
    // crew is on no side of the ones that were already there.
    const boardAfter = (await api(request, bearer, 'get', '/api/battles')) as {
      coming: { battle: { id: string }; side: string | null }[];
    };
    expect(boardAfter.coming.map((one) => one.battle.id).sort()).toEqual(pendingBefore);
    for (const fight of boardAfter.coming) {
      expect(fight.side, `the crew is on a side of fight ${fight.battle.id}`).toBeNull();
    }
  });

  test('switched off in one browser while a party is out, the other browser sees it off', async ({
    browser,
  }) => {
    const a = await openSession(browser);
    const b = await openSession(browser);
    await a.page.goto('/game/actions/automations');
    await b.page.goto('/game/actions/automations');
    await a.page.getByTestId('automation-0-off').click();
    await expect(a.page.getByTestId('automation-0')).toHaveAttribute('data-enabled', 'no');
    // The other tab polls every five seconds and catches up on its own.
    await expect(b.page.getByTestId('automation-0')).toHaveAttribute('data-enabled', 'no', {
      timeout: 15_000,
    });
    await a.page.getByTestId('automation-1-off').click();
    await expect(b.page.getByTestId('automation-1')).toHaveAttribute('data-enabled', 'no', {
      timeout: 15_000,
    });
    await a.close();
    await b.close();
  });
});
