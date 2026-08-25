import {
  createCommander,
  negotiate,
  negotiateWage,
  negotiationLine,
  notorietyUpgradeCost,
  openNegotiation,
  type BarRecruit,
  type Base,
  type Commander,
  type MeResponse,
  type OfficerRole,
} from '@frontline/shared';
import { expect, type Page } from '@playwright/test';
import {
  assigneesFat,
  assigneesStart,
  authResponse,
  bar,
  actionsResponse,
  baseDetail,
  battle,
  battles,
  districtDetail,
  unitsResponse,
  city,
  createOverseerResponse,
  crewStanding,
  trainingResponse,
  market,
  blackMarket,
  settings,
  adminSnapshot,
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

  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

    if (pathname.endsWith('/api/me')) return json(session);
    if (pathname.endsWith('/api/city')) return json(city);
    // The base screen reads `GET /base/:id`, not `/me`. Serving one fixed base regardless of the
    // session made `installApi(page, lateGame)` a half-fixture: a late-game HUD over a starting
    // base, so the detail follows whichever session was installed.
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
      pathname.endsWith('/api/city/fortify') ||
      // §A4: working a location up. Without a line here it fell through to the district read
      // below and answered a POST with a district, which is a 200 that changes nothing.
      pathname.endsWith('/api/city/upgrade')
    ) {
      return json({ district: districtDetail, base: meResponse.base ?? baseDetail.base });
    }
    if (pathname.includes('/api/city/')) return json(districtDetail);
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
          openNegotiation(recruit.askingWage, recruit.ambition, recruit.moralCompass),
        offer: body.offerWage,
        asking: recruit.askingWage,
        ambition: recruit.ambition,
        moralCompass: recruit.moralCompass,
      });
      return json({
        negotiation: turn.negotiation,
        line: negotiationLine(recruit.moralCompass, turn.negotiation.mood, turn.negotiation.rounds),
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
     * The wage rule is the real one: `negotiateWage` is the same shared function the server hires
     * through, so an offer this fixture accepts is one the server would accept too.
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
      const outcome = negotiateWage(body.offerWage, recruit.askingWage);
      if (!outcome.accepted) {
        return json({
          accepted: false,
          wage: outcome.wage,
          officer: null,
          firstPayment: 0,
          resources: null,
        });
      }
      return json({
        accepted: true,
        wage: outcome.wage,
        officer: hiredOfficer(recruit, body.role),
        firstPayment: Math.round(outcome.wage / 2),
        resources: meResponse.base?.resources ?? null,
      });
    }
    if (pathname.endsWith('/api/bar')) return json(bar);
    if (pathname.endsWith('/api/research')) return json(research);
    // Keyed off the installed session for the same reason `/api/base/` is: a fixed §G payload
    // would put a twelve-pip late-game roster under a level-1 header, and the screenshot would be
    // of a screen the server can never produce.
    if (pathname.endsWith('/api/assignees')) {
      return json((meResponse.base?.level ?? 1) > 1 ? assigneesFat : assigneesStart);
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
 * `alignment`, `alignmentUpdatedAt` and `xpIntoLevel` and carried three fields the schema does not
 * have, so the response failed to parse, the mutation errored instead of succeeding, and the
 * window silently stayed open on a completed hire. The factory cannot drift from the schema.
 */
function hiredOfficer(recruit: BarRecruit, role: OfficerRole): Commander {
  return createCommander(recruit.id, recruit.name, role, recruit.attributes, recruit.traits, {
    ambition: recruit.ambition,
    moralCompass: recruit.moralCompass,
  });
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
