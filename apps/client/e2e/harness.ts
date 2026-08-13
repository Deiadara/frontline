import type { MeResponse } from '@frontline/shared';
import { expect, type Page } from '@playwright/test';
import {
  assigneesFat,
  assigneesStart,
  authResponse,
  bar,
  baseDetail,
  battle,
  city,
  createOverseerResponse,
  launchResponse,
  missionsResponse,
  research,
  TOKEN,
} from './fixtures';

/** The display webfont every geometry assertion has to be measured against. */
const DISPLAY_FONT = 'Orbitron';

/**
 * Wait until layout is measured against the font the player actually sees.
 *
 * `src/fonts.css` declares Orbitron with `font-display: swap`, so text is laid out in the ~12%
 * narrower fallback until it lands. A geometry assertion that races the swap measures a screen
 * nobody renders — and, worse, passes *because* of the narrower metrics. Awaiting `fonts.ready`
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
 * container whose *bottom* edge runs through the middle of a card — the defect that shipped green
 * on the character-select grid, where 57px of hidden overflow sliced two cards through the digits
 * of an attribute row. Text scrolled entirely out of view is fine (that is what scrolling is for);
 * text the edge bisects is not, however little scrolling would recover it.
 *
 * Every clipping ancestor is intersected, so a card already hidden by an inner scroller is not
 * then re-judged against an outer one. Leaves only: a straddling wrapper is merely the parent of
 * whatever really straddles, and reporting both buries the offender.
 *
 * `root` narrows the sweep to one subtree, for a screen whose *page* is a document scroller — the
 * fold of a scrolling region cuts its last row by design, so sweeping the whole body there reports
 * ordinary scrolling as a defect. Clipping ancestors are still walked to the top of the document,
 * so narrowing the sweep never weakens what it measures about the elements it does look at.
 */
export async function expectNothingClippedVertically(page: Page, root = 'body'): Promise<void> {
  await settleFonts(page);
  const offenders = await page.evaluate<string[], string>((selector) => {
    const SLACK = 1;
    const bad = new Set<string>();

    /** The band of `el` that survives every clipping ancestor, in viewport coordinates. */
    const visibleBand = (el: HTMLElement) => {
      const at = el.getBoundingClientRect();
      let [top, bottom] = [at.top, at.bottom];
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowY === 'visible') continue;
        const box = node.getBoundingClientRect();
        // Overflow is clipped at the padding box, so the border sits outside the cut.
        top = Math.max(top, box.top + parseFloat(style.borderTopWidth));
        bottom = Math.min(bottom, box.bottom - parseFloat(style.borderBottomWidth));
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
 * and an `<svg>` fails both tests — so every procedural sprite and every resource glyph in the game
 * was invisible to it. `StructureSprite` is the sharp case. Its span is `min-h-0 w-full flex-1`, so
 * the sprite's height is only ever whatever the name plate leaves over; squeezed to zero, or grown
 * past the plot it stands on, it stayed green on every gate we had.
 *
 * Three defects, one sweep:
 *  - **collapsed** — a rendered image with no area, i.e. art the player is simply not shown;
 *  - **spilling** — an image drawn outside the box it was placed in, which lands it on a neighbour;
 *  - **sliced** — an image an `overflow` ancestor cuts partway through, on either axis.
 *
 * An image clipped away *entirely* is left alone, exactly as the text guard leaves fully-scrolled
 * text alone: that is what a scroller does. For the same reason the walk up the clipping ancestors
 * stops at `root` rather than running to the top of the document: a caller narrows the sweep to a
 * region precisely because the page *outside* it scrolls, and every scrolling page cuts whatever
 * lands on its fold. Measured, not assumed — sweeping past the scope reported the village's own
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
      // "does that box have area" — which is the very defect below, so the two must stay apart.
      if (!el.checkVisibility()) continue;
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

  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

    if (pathname.endsWith('/api/me')) return json(meResponse);
    if (pathname.endsWith('/api/city')) return json(city);
    // The base screen reads `GET /base/:id`, not `/me`. Serving one fixed base regardless of the
    // session made `installApi(page, lateGame)` a half-fixture — a late-game HUD over a starting
    // base — so the detail follows whichever session was installed.
    if (pathname.includes('/api/base/')) return json({ base: meResponse.base ?? baseDetail.base });
    if (pathname.endsWith('/api/battle')) return json(battle);
    /*
     * Method-aware, deliberately. Fulfilling `/api/missions` for *any* method served the board
     * payload to a launch too — a shape `LaunchMissionResponseSchema` cannot even parse — so no
     * e2e ever reached the §G6 officer gate and a launch path that refused half the board shipped
     * green. The fixture is the contract here; a method-blind handler is a hole in it.
     */
    if (pathname.endsWith('/api/missions')) {
      if (route.request().method() !== 'POST') return json(missionsResponse());
      return json(launchResponse());
    }
    if (pathname.endsWith('/api/bar')) return json(bar);
    if (pathname.endsWith('/api/research')) return json(research);
    // Keyed off the installed session for the same reason `/api/base/` is: a fixed §G payload
    // would put a twelve-pip late-game roster under a level-1 header, and the screenshot would be
    // of a screen the server can never produce.
    if (pathname.endsWith('/api/assignees')) {
      return json((meResponse.base?.level ?? 1) > 1 ? assigneesFat : assigneesStart);
    }
    if (pathname.endsWith('/api/overseer')) return json(createOverseerResponse, 201);
    if (pathname.endsWith('/api/auth/login')) return json(authResponse);
    if (pathname.endsWith('/api/auth/register')) return json(authResponse, 201);
    return json({ error: { code: 'NOT_FOUND', message: 'unmapped route' } }, 404);
  });
}
