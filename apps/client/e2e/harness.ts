import {
  BUILD_BOOST_MS,
  buildBoostOilCost,
  createCommander,
  negotiate,
  reservationWage,
  negotiationLine,
  negotiationVoice,
  notorietyUpgradeCost,
  openNegotiation,
  type BarRecruit,
  type Base,
  type Commander,
  type MeResponse,
  type OfficerRole,
  dismissalFee,
  type CrewOfficer,
  type CrewResponse,
  type ScoutingRunView,
} from '@frontline/shared';
import { expect, type Page } from '@playwright/test';
import {
  crewFat,
  factionScreen,
  factionNone,
  leaderboardFactions,
  leaderboardPlayers,
  messagesScreen,
  notificationsScreen,
  crewStart,
  authResponse,
  bar,
  actionsResponse,
  baseDetail,
  battle,
  battles,
  districtDetail,
  districtDetailFor,
  unitsResponse,
  city,
  createOverseerResponse,
  crewStanding,
  trainingResponse,
  market,
  blackMarket,
  settings,
  adminSnapshot,
  garage,
  scrapyard,
  workshop,
  launchResponse,
  missionsResponse,
  research,
  TOKEN,
} from './fixtures';

/** The display webfont every geometry assertion has to be measured against. */
const DISPLAY_FONT = 'Roboto Condensed';

/**
 * Wait until layout is measured against the font the player actually sees.
 *
 * `src/fonts.css` declares Roboto Condensed with `font-display: swap`, so text is laid out in the
 * wider fallback until it lands. A geometry assertion that races the swap measures a screen
 * nobody renders, and, worse, passes *because* of the narrower metrics. Awaiting `fonts.ready`
 * alone is not enough either: if the font request fails, that resolves immediately and every
 * guard goes vacuously green, so the load is asserted rather than assumed.
 */
export async function settleFonts(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(
    (family) =>
      [...document.fonts].some(
        (face) => face.family.replace(/["']/g, '') === family && face.status === 'loaded',
      ),
    DISPLAY_FONT,
  );
  expect(loaded, `${DISPLAY_FONT} must be loaded before any geometry is measured`).toBe(true);
}

/**
 * No text may be left half-drawn by a clipping edge.
 *
 * The layout guards only ever compared `scrollWidth` to `clientWidth`, which says nothing about a
 * container whose *bottom* edge runs through the middle of a card: the defect that shipped green
 * on the character-select grid, where 57px of hidden overflow sliced two cards through the digits
 * of an attribute row. Text scrolled entirely out of view is fine (that is what scrolling is for);
 * text the edge bisects is not, however little scrolling would recover it.
 *
 * Every clipping ancestor is intersected, so a card already hidden by an inner scroller is not
 * then re-judged against an outer one. Leaves only: a straddling wrapper is merely the parent of
 * whatever really straddles, and reporting both buries the offender.
 *
 * `root` narrows the sweep to one subtree, for a screen whose *page* is a document scroller: the
 * fold of a scrolling region cuts its last row by design, so sweeping the whole body there reports
 * ordinary scrolling as a defect. Clipping ancestors are still walked to the top of the document,
 * so narrowing the sweep never weakens what it measures about the elements it does look at.
 */
/**
 * Grow the window until the whole page fits in it, then settle.
 *
 * The vertical clip sweep asks "is any text cut by an edge", and the *fold* is an edge: a page
 * taller than the window has its last row cut by definition, and that is correct behaviour rather
 * than a layout bug. Every caller therefore has to clear the fold before sweeping, and the way that
 * was done was a hand-picked viewport height per test.
 *
 * Which makes the whole suite a knife edge. Adding a panel anywhere pushes some unrelated screen
 * past its hard-coded number and reddens a test that has nothing to do with the change: adding the
 * district paintings did exactly that to two specs at once. Measuring the page instead means the
 * height is always right by construction, and the check goes back to being about layout.
 *
 * Capped, because a runaway page (an infinite scroller, a layout loop) should fail the test rather
 * than allocate a 200,000px window.
 */
/**
 * Nothing on the screen is wider or taller than the screen.
 *
 * This replaces a `document.documentElement.scrollWidth > clientWidth` check that **could not
 * fail**. Every screen root in this app is `h-screen w-screen overflow-hidden` over a
 * `html,body,#root{height:100%}` base, so the document is pinned to the viewport by construction:
 * a 4000px block dropped inside a screen moves `documentElement.scrollWidth` by exactly zero. It
 * was measured that way, not reasoned about. Four call sites were asserting it, and on the base,
 * queue and missions screens it was the *only* overflow assertion they had.
 *
 * The screen root is where the signal actually is: it is the box that does the clipping, so content
 * that does not fit shows up as its `scrollWidth` exceeding its `clientWidth`. Measured only on that
 * box, deliberately: a blanket sweep of everything with `overflow: hidden` also flags every
 * `truncate` and every `object-cover` backdrop, which are clipping *on purpose*, and a gate that
 * cries wolf gets switched off.
 *
 * `screenOverflows` is exported so a positive control can call it directly. See
 * `visual.spec.ts`'s "the overflow gate can fail" test: without one, the version this replaces
 * looked healthy for months.
 */
export interface ScreenOverflow {
  readonly selector: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export async function screenOverflows(page: Page, slack = 1): Promise<ScreenOverflow[]> {
  return page.evaluate((allowed) => {
    const root = document.querySelector('#root');
    // Every screen renders exactly one full-height root. Taking children rather than a class
    // selector so a Tailwind rename cannot quietly empty this list.
    const screens = root === null ? [] : [...root.children];
    return screens
      .map((el) => ({
        selector: `${el.tagName.toLowerCase()}.${el.className.toString().split(/\s+/).slice(0, 3).join('.')}`,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }))
      .filter(
        (m) =>
          m.clientWidth > 0 &&
          (m.scrollWidth > m.clientWidth + allowed || m.scrollHeight > m.clientHeight + allowed),
      );
  }, slack);
}

export async function expectNothingOverflowsTheScreen(page: Page): Promise<void> {
  await settleFonts(page);
  const over = await screenOverflows(page);
  expect(
    over.map(
      (m) =>
        `${m.selector} needs ${m.scrollWidth}x${m.scrollHeight}, has ${m.clientWidth}x${m.clientHeight}`,
    ),
    'content is larger than the screen that clips it',
  ).toEqual([]);
}

export async function growPastTheFold(page: Page, width?: number): Promise<void> {
  const MAX = 12_000;
  const size = page.viewportSize();
  /*
   * The overflow this app actually has is **inside** the page, not on it.
   *
   * `PageShell` puts the world in a `h-full overflow-y-auto` div between the two fixed bars, so
   * `document.scrollHeight` is the window height whatever the content is doing: the document never
   * scrolls, that div does. Measuring the document therefore reports "already fits" and grows the
   * window by nothing, which is what the first version of this did: it changed no test's result and
   * looked like it had.
   *
   * So the measurement is how much every scroller is *over* its own box, and the window grows by
   * the worst of them. Two loops rather than one, because growing the window reflows the content
   * and a scroller can still be short by a little afterwards.
   */
  const overflowBy = async (): Promise<number> =>
    page.evaluate(() => {
      let worst = 0;
      const boxes: Element[] = [document.documentElement, ...document.querySelectorAll('*')];
      for (const el of boxes) {
        const style = getComputedStyle(el);
        if (el !== document.documentElement && !/auto|scroll/.test(style.overflowY)) continue;
        worst = Math.max(worst, el.scrollHeight - el.clientHeight);
      }
      return Math.ceil(worst);
    });

  // Measured only once the screen has actually arrived. The scroller this is looking for is
  // rendered by the page, not by the shell, so calling this straight after `goto` measures a
  // loading state: it finds no overflow, grows nothing, and returns as though it had worked. That
  // is the failure mode to design against, because the caller cannot see it: the sweep afterwards
  // fails on the fold and reads as a layout bug in whatever was last changed.
  //
  // Waiting for the scroller rather than for `networkidle`, deliberately. The client holds an SSE
  // connection open for live updates, so the network is never idle and that wait only ever expires:
  // it turned a fifteen-test run into two and a half minutes of nothing happening.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('*')].some((el) =>
      /auto|scroll/.test(getComputedStyle(el).overflowY),
    ),
  );
  await settleFonts(page);

  let height = size?.height ?? 720;
  for (let pass = 0; pass < 3; pass += 1) {
    const over = await overflowBy();
    if (over <= 0) break;
    height += over;
    expect(
      height,
      'the page is too tall to sweep: is something growing without bound?',
    ).toBeLessThan(MAX);
    await page.setViewportSize({ width: width ?? size?.width ?? 1280, height });
    await settleFonts(page);
  }
}

export async function expectNothingClippedVertically(page: Page, root = 'body'): Promise<void> {
  await settleFonts(page);
  const offenders = await page.evaluate<string[], string>((selector) => {
    const SLACK = 1;
    const bad = new Set<string>();

    /**
     * Does this element establish a containing block for `position: fixed` descendants?
     *
     * The list is the spec's: a transform, a perspective, a filter or backdrop-filter, a
     * `will-change` naming one of those, or paint containment. Any of them re-parents a fixed
     * descendant onto this box, so it clips again, and the walk below has to notice.
     */
    const containsFixed = (style: CSSStyleDeclaration): boolean =>
      style.transform !== 'none' ||
      style.perspective !== 'none' ||
      style.filter !== 'none' ||
      style.backdropFilter !== 'none' ||
      /transform|filter|perspective/.test(style.willChange) ||
      /paint|layout|strict|content/.test(style.contain);

    /** The band of `el` that survives every clipping ancestor, in viewport coordinates. */
    const visibleBand = (el: HTMLElement) => {
      const at = el.getBoundingClientRect();
      let [top, bottom] = [at.top, at.bottom];

      // A `position: fixed` box is laid out against the viewport, not against its DOM parents, so
      // the overflow of the ancestors above it does not cut it. Walking past that, as this did
      // until MOU-4xx: reports every modal rendered inside a scrolling page as clipped, which is
      // both wrong and exactly the kind of false red that gets a gate switched off. The escape
      // ends at an ancestor that establishes a containing block for fixed descendants, because
      // that one really does clip it again.
      let escaped = getComputedStyle(el).position === 'fixed';

      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (escaped && containsFixed(style)) escaped = false;
        if (!escaped && style.overflowY !== 'visible') {
          const box = node.getBoundingClientRect();
          // Overflow is clipped at the padding box, so the border sits outside the cut.
          top = Math.max(top, box.top + parseFloat(style.borderTopWidth));
          bottom = Math.min(bottom, box.bottom - parseFloat(style.borderBottomWidth));
        }
        if (style.position === 'fixed') escaped = true;
      }
      return { height: at.height, visible: bottom - top };
    };

    const scope = document.querySelector(selector);
    if (!scope) throw new Error(`no element matched ${selector}`);

    for (const el of scope.querySelectorAll<HTMLElement>('*')) {
      if (el.childElementCount > 0 || !el.textContent?.trim()) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      const { height, visible } = visibleBand(el);
      if (height === 0) continue;
      if (visible > SLACK && visible < height - SLACK) {
        bad.add(
          `"${el.textContent.trim().slice(0, 24)}" (${visible.toFixed(0)}/${height.toFixed(0)}px shown)`,
        );
      }
    }
    return [...bad].slice(0, 6);
  }, root);
  expect(offenders, `text sliced by a clipping edge: ${offenders.join(' | ')}`).toEqual([]);
}

/**
 * No image may be drawn at nothing, spilling out of its box, or half-cut by a clipping edge.
 *
 * The board's bar is "no cut text **or images**", and only the text half was gated:
 * {@link expectNothingClippedVertically} skips every element that has children or holds no text,
 * and an `<svg>` fails both tests, so every procedural sprite and every resource glyph in the game
 * was invisible to it. `StructureSprite` is the sharp case. Its span is `min-h-0 w-full flex-1`, so
 * the sprite's height is only ever whatever the name plate leaves over; squeezed to zero, or grown
 * past the plot it stands on, it stayed green on every gate we had.
 *
 * Three defects, one sweep:
 *  - **collapsed**: a rendered image with no area, i.e. art the player is simply not shown;
 *  - **spilling**: an image drawn outside the box it was placed in, which lands it on a neighbour;
 *  - **sliced**: an image an `overflow` ancestor cuts partway through, on either axis.
 *
 * An image clipped away *entirely* is left alone, exactly as the text guard leaves fully-scrolled
 * text alone: that is what a scroller does. For the same reason the walk up the clipping ancestors
 * stops at `root` rather than running to the top of the document: a caller narrows the sweep to a
 * region precisely because the page *outside* it scrolls, and every scrolling page cuts whatever
 * lands on its fold. Measured, not assumed: sweeping past the scope reported the village's own
 * backdrop as sliced at 1280x720, where 14px of the scene simply sits below the fold.
 */
export async function expectNoImagesClipped(page: Page, root = 'body'): Promise<void> {
  await settleFonts(page);
  const offenders = await page.evaluate<string[], string>((selector) => {
    const SLACK = 1;
    const bad = new Set<string>();

    /** The nearest thing a human can be pointed at, since sprites are all `aria-hidden`. */
    const name = (el: Element): string => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const label =
          node.getAttribute('alt') ??
          node.getAttribute('aria-label') ??
          node.getAttribute('data-testid');
        if (label?.trim()) return `${el.tagName.toLowerCase()} in "${label.trim()}"`;
      }
      return el.tagName.toLowerCase();
    };

    /** The rect of `el` that survives every clipping ancestor up to `scope`, in viewport coords. */
    const visibleBand = (el: Element, scope: Element) => {
      const at = el.getBoundingClientRect();
      let [left, right, top, bottom] = [at.left, at.right, at.top, at.bottom];
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        // Overflow is clipped at the padding box, so the border sits outside the cut.
        if (style.overflowX !== 'visible') {
          left = Math.max(left, box.left + parseFloat(style.borderLeftWidth));
          right = Math.min(right, box.right - parseFloat(style.borderRightWidth));
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, box.top + parseFloat(style.borderTopWidth));
          bottom = Math.min(bottom, box.bottom - parseFloat(style.borderBottomWidth));
        }
        if (node === scope) break;
      }
      return { width: right - left, height: bottom - top };
    };

    /** Cut partway through: some of the axis survives the clip, but not all of it. */
    const sliced = (shown: number, full: number) => shown > SLACK && shown < full - SLACK;

    const scope = document.querySelector(selector);
    if (!scope) throw new Error(`no element matched ${selector}`);

    for (const el of scope.querySelectorAll('svg, img, canvas')) {
      // `checkVisibility` answers "does this generate a box at all" without conflating it with
      // "does that box have area", which is the very defect below, so the two must stay apart.
      if (!el.checkVisibility()) continue;
      // Scenery is *meant* to run past its frame: the shell's backdrop is over-scaled on purpose
      // so a blur has pixels to sample past its own edges. `visual.spec.ts` honours the same
      // attribute, and this gate not honouring it made the backdrop a permanent false positive on
      // every screen that shows one. The opt-out is per element and never its subtree.
      if (el.hasAttribute('data-scenery')) continue;
      const at = el.getBoundingClientRect();

      if (at.width <= SLACK || at.height <= SLACK) {
        bad.add(`${name(el)} collapsed to ${at.width.toFixed(0)}x${at.height.toFixed(0)}px`);
        continue;
      }

      const parent = el.parentElement?.getBoundingClientRect();
      if (
        parent &&
        (at.left < parent.left - SLACK ||
          at.right > parent.right + SLACK ||
          at.top < parent.top - SLACK ||
          at.bottom > parent.bottom + SLACK)
      ) {
        bad.add(`${name(el)} spills outside its container`);
        continue;
      }

      const shown = visibleBand(el, scope);
      if (sliced(shown.width, at.width) || sliced(shown.height, at.height)) {
        bad.add(
          `${name(el)} sliced by a clipping edge ` +
            `(${shown.width.toFixed(0)}x${shown.height.toFixed(0)} of ` +
            `${at.width.toFixed(0)}x${at.height.toFixed(0)}px shown)`,
        );
      }
    }
    return [...bad].slice(0, 6);
  }, root);
  expect(offenders, `images not drawn whole: ${offenders.join(' | ')}`).toEqual([]);
}

/**
 * Make a screen self-contained: seed the persisted token and intercept every
 * `/api/**` call with fixtures that satisfy the shared Zod schemas.
 */
export async function installApi(page: Page, meResponse: MeResponse): Promise<void> {
  await page.addInitScript((token) => {
    localStorage.setItem('frontline.token', JSON.stringify({ state: { token }, version: 0 }));
  }, TOKEN);

  /*
   * The session, and it moves.
   *
   * Everything else in this harness answers from a frozen fixture, which is right: a screenshot of
   * a fixed state is what these runs are for. §D7's ladder is the exception, because the whole
   * mechanic is a *change* to the crew, and a `/me` that kept answering with the pre-purchase rank
   * would let the client write the new one into its cache, refetch, quietly revert, and still pass
   * whichever assertion happened to run first.
   */
  let session = meResponse;
  /*
   * The roster this page sees, copied per install.
   *
   * `crewFat` and `crewStart` are module-level fixtures shared by every spec in the run, and the
   * two write handlers below (release, reassign) change what the next read answers with. Mutating
   * the shared object made one spec's release visible to the next spec's read: the let-go test
   * passed alone and failed in the suite, because by then the officer it wanted had already been
   * let go by an earlier run of itself. A copy per `installApi` is what makes each spec's writes
   * its own.
   */
  /*
   * The scouting run this crew has out, if any.
   *
   * Per install and mutable for the same reason the roster is: sending a scout is a *write*, and
   * the client invalidates the district and reads it again straight afterwards. A fixture that
   * answered the write with a run and the next read without one would flip the panel back to
   * "send somebody" a frame later, and a test could not tell that from the button doing nothing.
   */
  let scoutingRun: ScoutingRunView | null = null;

  const roster: CrewResponse = structuredClone(
    (meResponse.base?.level ?? 1) > 1 ? crewFat : crewStart,
  );

  await page.route('**/api/**', async (route) => {
    const { pathname, searchParams } = new URL(route.request().url());
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

    /*
     * The live channel, left hanging on purpose.
     *
     * `useLiveEvents` holds one request open to `/api/events` for the whole session, and a healthy
     * one *is* a request that never answers: the server only writes to it when something happens
     * in the game, and in a fixture nothing does. Leaving the route unfulfilled is therefore the
     * most faithful stub available, not a shortcut, and Playwright has no way to fulfil a response
     * that stays open.
     *
     * The alternative is what the catch-all at the bottom of this router would have done: 404 it.
     * That is a fixture asserting the server is broken. Measured rather than assumed: with the
     * route 404ing, `live-offline` renders on the standings screen, so the HUD would carry its
     * "Reconnecting" marker into every screenshot this suite writes for the board to look at, and
     * the hook would back off and retry for the length of every test. No *assertion* in
     * `visual.spec.ts` catches that, because this suite has no pixel baselines: it checks layout
     * invariants and files the images for review. `screens.spec.ts` carries the guard that does.
     */
    if (pathname.endsWith('/api/events')) return new Promise<void>(() => {});

    if (pathname.endsWith('/api/me')) return json(session);
    if (pathname.endsWith('/api/city')) return json(city);
    // §B7: raising a captured gate answers with the whole city, like every other city write.
    if (pathname.endsWith('/api/city/gate')) return json(city);
    // The base screen reads `GET /base/:id`, not `/me`. Serving one fixed base regardless of the
    // session made `installApi(page, lateGame)` a half-fixture: a late-game HUD over a starting
    // base, so the detail follows whichever session was installed.
    /*
     * `POST /base/boost` answers with a receipt, not just the base.
     *
     * It has to be matched *before* the `/api/base/` catch-all below, which was swallowing it and
     * answering `{ base }` where `BuildBoostResponseSchema` wants `{ base, paid }`. That makes
     * `apiFetch`'s `schema.parse` throw, so the mutation always errored: any test that pressed the
     * button and did not assert the outcome passed against a boost that never happened, and none of
     * them asserted the outcome.
     */
    if (pathname.endsWith('/api/base/boost')) {
      const burning = session.base ?? baseDetail.base;
      return json({
        base: {
          ...burning,
          // The burn is *running* now. Answering with the base unchanged made a successful boost
          // and a rejected one look identical on screen, so nothing could assert the difference:
          // the countdown appearing is the only positive signal this write has.
          economy: {
            ...burning.economy,
            buildBoostUntil: new Date(Date.now() + BUILD_BOOST_MS).toISOString(),
          },
        },
        paid: { oil: buildBoostOilCost(burning.buildings) },
      });
    }
    if (pathname.includes('/api/base/')) return json({ base: session.base ?? baseDetail.base });
    if (pathname.endsWith('/api/battle')) return json(battle);
    // §A4: the board. Every write answers with the whole board plus the crew, so one handler
    // covers the read and all five writes; a write that answered with a different shape would be
    // a hole in the fixture, which is the contract these runs are measured against.
    if (pathname.includes('/api/battles')) {
      if (route.request().method() === 'GET') return json(battles);
      const own = session.base ?? baseDetail.base;
      /*
       * §D7: the ladder actually moves.
       *
       * Answering this write with the unchanged crew would let a client that never re-read the
       * response pass: the chip would keep saying what it said before and the run would be green.
       * The arithmetic is the shared function the server itself calls, so a fixture cannot drift
       * from the rule it is standing in for.
       */
      if (pathname.endsWith('/api/battles/notoriety')) {
        const cost = notorietyUpgradeCost(own.economy.notoriety) ?? 0;
        const climbed: Base = {
          ...own,
          economy: {
            ...own.economy,
            infamy: Math.max(0, own.economy.infamy - cost),
            notoriety: own.economy.notoriety + 1,
          },
        };
        session = { ...session, base: climbed };
        return json({ battles, base: climbed });
      }
      return json({ battles, base: own });
    }
    // §A4: the city writes all answer with the district they touched, so one handler covers them.
    // `/api/city/attack` and `/api/city/raid` used to need their own line here, because they
    // answered with a battle report; they are gone with the instant fight they resolved.
    if (
      pathname.endsWith('/api/city/scout') ||
      pathname.endsWith('/api/city/garrison') ||
      pathname.endsWith('/api/battles/fortify') ||
      pathname.endsWith('/api/city/fortify') ||
      // §A4: working a location up. Without a line here it fell through to the district read
      // below and answered a POST with a district, which is a 200 that changes nothing.
      pathname.endsWith('/api/city/upgrade')
    ) {
      /*
       * §A4: sending a scout does not open the ground, it starts a walk.
       *
       * The fixture answers the send with the same district still dark and a run under way, which
       * is what the server does. Answering with open ground would let a test press the button and
       * watch the fog lift, which is the old instant scout, and the whole point of the rework is
       * that it does not do that any more.
       */
      if (pathname.endsWith('/api/city/scout')) {
        const body = route.request().postDataJSON() as { districtId: string };
        const detail = districtDetailFor(body.districtId);
        scoutingRun = {
          districtId: body.districtId,
          districtName: detail.district.name,
          officerId: 'off-3',
          officerName: 'Vela',
          departedAt: new Date().toISOString(),
          returnsAt: new Date(Date.now() + 214 * 60_000).toISOString(),
        };
        return json({
          district: { ...detail, scoutPlan: null, scoutingRun },
          base: meResponse.base ?? baseDetail.base,
        });
      }
      return json({ district: districtDetail, base: meResponse.base ?? baseDetail.base });
    }
    if (pathname.includes('/api/city/')) {
      const detail = districtDetailFor(pathname.split('/').filter(Boolean).pop() ?? '');
      // A run under way outlives the write that started it, so the panel stays on the countdown.
      return json(scoutingRun === null ? detail : { ...detail, scoutingRun, scoutPlan: null });
    }
    /*
     * §A4: the road. `recall` answers with the list minus the column it was given, so a run can
     * assert the row actually left rather than that the button was clickable.
     */
    if (pathname.endsWith('/api/actions')) return json(actionsResponse);
    if (pathname.endsWith('/api/actions/recall')) {
      const body = route.request().postDataJSON() as { movementId: string };
      return json({
        ...actionsResponse,
        movements: actionsResponse.movements.filter((one) => one.id !== body.movementId),
      });
    }

    if (pathname.endsWith('/api/units')) return json(unitsResponse);
    /*
     * §A5, and method-aware for the same reason `/api/missions` is: the two writes answer with a
     * `TrainUnitsResponse`, which is a different shape from the roster, and a handler that served
     * the roster to a POST would let a client that sent the wrong body pass every run.
     *
     * `cancel` answers with the bench minus the order it was given, so a run can assert that the
     * row actually left rather than that the button was clickable.
     */
    if (pathname.endsWith('/api/units/train') || pathname.endsWith('/api/units/cancel')) {
      const own = session.base ?? baseDetail.base;
      if (!pathname.endsWith('/api/units/cancel')) {
        return json({ base: own, queue: unitsResponse.queue });
      }
      const body = route.request().postDataJSON() as { orderId: string };
      return json({
        base: own,
        queue: unitsResponse.queue.filter((order) => order.id !== body.orderId),
      });
    }
    /*
     * Method-aware, deliberately. Fulfilling `/api/missions` for *any* method served the board
     * payload to a launch too, a shape `LaunchMissionResponseSchema` cannot even parse, so no
     * e2e ever reached the §G6 officer gate and a launch path that refused half the board shipped
     * green. The fixture is the contract here; a method-blind handler is a hole in it.
     */
    if (pathname.endsWith('/api/missions')) {
      if (route.request().method() !== 'POST') return json(missionsResponse());
      return json(launchResponse());
    }
    /*
     * §H7: the conversation, run through the *real* model rather than answered with a canned
     * reply.
     *
     * `negotiate` and `negotiationLine` are pure and live in `@frontline/shared`, which is exactly
     * where the server gets them from, so this fixture produces the same answer the server would
     * for the same offer. A hard-coded reply here would let a client that sent the wrong body, or
     * mis-read the response, pass every run: the failure mode this harness has already been bitten
     * by once on `/api/missions`.
     */
    if (pathname.endsWith('/api/bar/negotiate')) {
      const body = route.request().postDataJSON() as { recruitId: string; offerWage: number };
      const recruit = bar.recruits.find((entry) => entry.id === body.recruitId);
      if (!recruit || recruit.askingWage === null) {
        return json(
          { error: { code: 'NOT_FOUND', message: 'They are not at the Bar today' } },
          404,
        );
      }
      const turn = negotiate({
        negotiation:
          bar.negotiations[body.recruitId] ??
          openNegotiation(recruit.askingWage, recruit.attributes),
        offer: body.offerWage,
        asking: recruit.askingWage,
        attributes: recruit.attributes,
      });
      return json({
        negotiation: turn.negotiation,
        line: negotiationLine(
          negotiationVoice(recruit.id),
          turn.negotiation.mood,
          turn.negotiation.rounds,
        ),
        accepted: turn.accepted,
        walkedAway: turn.walkedAway,
      });
    }
    /*
     * Signing somebody, which had **no handler at all** until the hire path was fixed.
     *
     * That absence is why the "agrees but never joins the crew" bug shipped: `/api/bar/hire` fell
     * through to the 404 catch-all, so a test could drive the whole negotiation, press the button,
     * and see nothing happen: exactly as a player did. A route the app calls and the fixture does
     * not answer is a hole in the contract, not a missing convenience.
     *
     * The fee rule is the real one: `reservationWage` is the same shared function `/bar/hire`
     * gates on, so an offer this fixture accepts is one the server would accept too.
     */
    if (pathname.endsWith('/api/bar/hire')) {
      const body = route.request().postDataJSON() as {
        recruitId: string;
        role: OfficerRole;
        offerWage: number;
      };
      const recruit = bar.recruits.find((entry) => entry.id === body.recruitId);
      if (!recruit || recruit.askingWage === null) {
        return json({ error: { code: 'NOT_FOUND', message: 'They have left' } }, 404);
      }
      const floor = reservationWage(recruit.askingWage);
      if (body.offerWage < floor) {
        return json({ accepted: false, wage: floor, officer: null, payroll: null });
      }
      const committed = bar.payroll.committed + body.offerWage;
      return json({
        accepted: true,
        wage: body.offerWage,
        officer: hiredOfficer(recruit, body.role),
        payroll: {
          ...bar.payroll,
          committed,
          available: Math.max(0, bar.payroll.capacity - committed),
        },
      });
    }
    if (pathname.endsWith('/api/bar')) return json(bar);
    if (pathname.endsWith('/api/research')) return json(research);
    // Keyed off the installed session for the same reason `/api/base/` is: a fixed §G payload
    // would put a twelve-pip late-game roster under a level-1 header, and the screenshot would be
    // of a screen the server can never produce.
    /*
     * The faction, the mailbox and the bell.
     *
     * Each write answers with the whole refreshed screen, exactly as the server does, so one
     * handler covers the read and every write against it. That is the same rule the market's
     * handler follows and it is what keeps the fixture *being* the contract: a write that answered
     * with a different shape here would pass a test the real server fails.
     */
    if (pathname.endsWith('/api/factions')) {
      // Keyed off the installed session's level, exactly as `/api/crew` is: a starting crew has
      // not joined anything yet and should see the invitation they are holding, while a late-game
      // one is at a table. A fixed payload would put a two-person roster under a level-1 header.
      return json((meResponse.base?.level ?? 1) > 1 ? factionScreen : factionNone);
    }
    if (pathname.includes('/api/factions/')) return json({ faction: factionScreen });
    /* The standings. Which board is answered comes off the query string, the way the route does
       it, so the tab control is exercised rather than stubbed past. */
    if (pathname.endsWith('/api/leaderboard')) {
      const board = searchParams.get('board');
      return json(board === 'factions' ? leaderboardFactions : leaderboardPlayers);
    }
    if (pathname.endsWith('/api/messages')) return json(messagesScreen);
    if (pathname.includes('/api/messages/')) return json({ messages: messagesScreen });
    if (pathname.endsWith('/api/notifications')) return json(notificationsScreen);
    if (pathname.includes('/api/notifications/'))
      return json({ notifications: notificationsScreen });

    /*
     * §C2: moving somebody between a chair and the bench.
     *
     * Answered here for the reason the note on `/api/bar/hire` gives: the crew screen calls this
     * from two places now (the officer's own window, and the picker on an empty chair), and an
     * unanswered route is a control a test can press while nothing happens.
     */
    if (pathname.endsWith('/api/crew/reassign')) {
      const body = route.request().postDataJSON() as { officerId: string; role: string | null };
      roster.officers = roster.officers.map((entry) =>
        entry.officerId === body.officerId
          ? { ...entry, role: body.role as CrewOfficer['role'] }
          : entry,
      );
      return json({ crew: roster });
    }
    // The per-install copy, so a release or a reassignment is *observable*: the roster really
    // changes on the next read, which is what lets a test assert the outcome rather than the call.
    if (pathname.endsWith('/api/crew')) return json(roster);
    /*
     * §H7: letting somebody go, from the crew page as well as from the Bar.
     *
     * Answered here for the reason the note on `/api/bar/hire` gives. The button moved onto the
     * officer's own window, which is a screen the Bar's fixture never touched, so without this the
     * whole flow would fall through to the 404 catch-all and a test could press the button and
     * watch nothing happen, exactly as a player would.
     */
    if (pathname.endsWith('/api/bar/release')) {
      const body = route.request().postDataJSON() as { officerId: string };
      const officer = roster.officers.find((entry) => entry.officerId === body.officerId);
      if (!officer) {
        return json({ error: { code: 'NOT_FOUND', message: 'Not on the books' } }, 404);
      }
      const fee = dismissalFee(officer.weeklyWage);
      // The roster the next read answers with, minus the person who just left.
      roster.officers = roster.officers.filter((entry) => entry.officerId !== body.officerId);
      return json({
        officerId: body.officerId,
        fee,
        resources: { ...(meResponse.base?.resources ?? {}) },
        payroll: bar.payroll,
      });
    }
    // Before the bare `/api/overseer` handler below, which does not match a sub-path, and would
    // answer a profile read with a 201 character-creation payload if it were reordered.
    if (pathname.endsWith('/api/overseer/me')) return json(crewStanding);
    if (pathname.endsWith('/api/training')) return json(trainingResponse);
    // Every market write answers with the whole board, so one handler covers the read and all five
    // writes: the fixture *is* the contract, and a write that answered with a different shape
    // would be a hole in it.
    if (pathname.includes('/api/market'))
      return json(route.request().method() === 'GET' ? market : { market });
    // The back room. Read and write answer with the same shape wrapped differently, exactly as the
    // front of the market does: the fixture *is* the contract, so a write that answered with
    // something else would be a hole in it.
    if (pathname.includes('/api/black-market')) {
      return json(route.request().method() === 'GET' ? blackMarket : { blackMarket });
    }
    // Settings answers the same record from all three of its endpoints, so one handler covers the
    // read, the profile patch and the passphrase change.
    if (pathname.includes('/api/settings')) return json(settings);
    // The bench. A build without admin mode answers 404 here and the screen redirects; serving the
    // snapshot is what puts the Bench door in the nav for these runs.
    if (pathname.endsWith('/api/admin')) return json(adminSnapshot);
    if (pathname.endsWith('/api/admin/knobs')) return json({ admin: adminSnapshot });
    // §B11: the yard has its own page. Checked before `/api/workshop` only for tidiness: the two
    // prefixes do not overlap.
    /*
     * §B9: the Scrapyard's own page.
     *
     * Answered for the reason the note on `/api/bar/hire` gives. The page and its route landed
     * without a fixture, so under this harness it fell through to the 404 catch-all below: a whole
     * screen a test could walk to and find empty, exactly as a player would.
     */
    if (pathname.includes('/api/scrapyard')) {
      // A build answers with the yard *and* the crew, because it spends from the stockpile:
      // `BuildAddonResponseSchema` is `{ scrapyard, base }`. Answering `{ scrapyard }` alone made
      // every add-on build throw in `schema.parse` rather than land.
      return json(
        route.request().method() === 'GET'
          ? scrapyard
          : { scrapyard, base: session.base ?? baseDetail.base },
      );
    }
    if (pathname.includes('/api/garage')) {
      return json(route.request().method() === 'GET' ? garage : { garage });
    }
    if (pathname.includes('/api/workshop')) {
      return json(route.request().method() === 'GET' ? workshop : { workshop });
    }
    if (pathname.endsWith('/api/overseer')) return json(createOverseerResponse, 201);
    if (pathname.endsWith('/api/auth/login')) return json(authResponse);
    if (pathname.endsWith('/api/auth/register')) return json(authResponse, 201);
    return json({ error: { code: 'NOT_FOUND', message: 'unmapped route' } }, 404);
  });
}

/**
 * The officer a signed recruit becomes.
 *
 * Built through the shared `createCommander` rather than by hand: a hand-written literal missed
 * fields the schema requires and carried three it does not have, so the response failed to parse,
 * the mutation errored instead of succeeding, and the window silently stayed open on a completed
 * hire. The factory cannot drift from the schema.
 */
function hiredOfficer(recruit: BarRecruit, role: OfficerRole): Commander {
  return createCommander(
    recruit.id,
    recruit.name,
    role,
    recruit.attributes,
    recruit.perks,
    recruit.askingWage ?? 0,
  );
}

/**
 * A document sheet must stay dark enough to read.
 *
 * The game is a dark interface with light type on it, and the textures that make it feel painted
 * are *blends*: `painted` and `washed` are soft-light layers. One of them over a panel is the
 * intended effect. Several stacked down one scrolling column compound, and the page comes out as a
 * pale grey static field with the type barely legible through it. That is what happened to the
 * Overseer's file the first time it was built, and every gate in this suite passed it: the DOM was
 * correct, nothing overflowed, nothing was clipped, no text was cut. The defect was purely in what
 * the pixels came out as, so this is the one check that has to look at pixels.
 *
 * Measured as the share of the sheet that is *pale* rather than as a mean, because a mean is
 * dragged around by how much artwork happens to be on the page. Calibrated across every document
 * screen in the game (2%-7% pale) against the broken build (83%), so the bound below sits about
 * four times above the worst healthy page and three times under the failure.
 */
const MAX_PALE_SHARE = 0.25;

/**
 * A control drawn over the artwork is still lit, rather than dimmed by something painted on top.
 *
 * The failure this exists for is a shared component's z-index escaping into the page. `PlateRoom`
 * draws a vignette over its picture at `z-10` so the tags on the painting can rise above it at
 * `z-20`; the moment its own box stopped being a stacking context, that `z-10` was measured against
 * the page instead, and the Bar's payroll readout and standing note, drawn *after* the room and
 * with no z-index of their own, went under a black gradient. Both still worked. Both were unreadable.
 *
 * Measured on the brightest tenth of the control rather than its mean, because a plate on artwork
 * is mostly dark by design and it is the *type* that has to survive: dimmed, the readout's brightest
 * pixels fell from 151 to 75 and its label from 182 to 78.
 */
export async function expectControlNotDimmed(
  page: Page,
  testId: string,
  floor = 110,
): Promise<void> {
  const shot = await page.getByTestId(testId).screenshot();
  const brightest = await page.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const lum: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      lum.push(0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0));
    }
    lum.sort((a, b) => a - b);
    return lum[Math.floor(lum.length * 0.99)] ?? 0;
  }, shot.toString('base64'));

  expect(
    brightest,
    `${testId} is dimmed: its brightest pixels reach ${brightest.toFixed(0)}, not ${floor}`,
  ).toBeGreaterThan(floor);
}

export async function expectSheetNotWashedOut(
  page: Page,
  selector = 'main section',
): Promise<void> {
  const shot = await page.locator(selector).first().screenshot();
  const pale = await page.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l =
        (0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0)) / 255;
      if (l > 0.35) count++;
    }
    return count / (data.length / 4);
  }, shot.toString('base64'));

  expect(
    pale,
    `${(pale * 100).toFixed(0)}% of the sheet is pale: a blend layer is washing the page out`,
  ).toBeLessThan(MAX_PALE_SHARE);
}

/**
 * Walk the mission board across every area, running `look` on each.
 *
 * The board's arrows stop at the ends of the list rather than rolling round (see `StepArrow`), so
 * the specs that used to press `board-right` a fixed dozen times and rely on the wrap to sweep
 * every board would now click a disabled button and time out on the last one. This steps right
 * while there is anywhere right to go, which visits each area exactly once whatever the day's
 * scouting left open.
 *
 * `look` returning true stops the walk and is reported back, so a caller can say "find me the
 * board with X on it" and know whether it found one.
 */
export async function walkBoards(page: Page, look: () => Promise<boolean>): Promise<boolean> {
  // Rewound first, so two walks in one test both see every board. Wrapping used to make the
  // starting point irrelevant; stopping at the ends means a walk that began on the last area
  // would look at exactly one.
  await stepBoardsTo(page, 'board-left');
  return stepBoardsTo(page, 'board-right', look);
}

/** One direction, one area at a time, stopping when the arrow goes dead or `look` says stop. */
async function stepBoardsTo(
  page: Page,
  arrow: 'board-left' | 'board-right',
  look?: () => Promise<boolean>,
): Promise<boolean> {
  // Bounded, so a stepper bug that never disables cannot hang the suite instead of failing it.
  for (let step = 0; step < 24; step += 1) {
    if (look && (await look())) return true;
    const onward = page.getByTestId(arrow);
    if (await onward.isDisabled()) return false;
    const showing = await page.getByTestId('board-area').textContent();
    await onward.click();
    await expect(page.getByTestId('board-area')).not.toHaveText(showing ?? '');
  }
  throw new Error('the mission board never ran out of areas to step to');
}
