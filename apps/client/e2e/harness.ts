import type { MeResponse } from '@frontline/shared';
import { expect, type Page } from '@playwright/test';
import { authResponse, baseDetail, battle, city, createOverseerResponse, TOKEN } from './fixtures';

/** The display webfont every geometry assertion has to be measured against. */
const DISPLAY_FONT = 'Orbitron';

/**
 * Wait until layout is measured against the font the player actually sees.
 *
 * `index.html` loads Orbitron with `display=swap`, so text is laid out in the ~12% narrower
 * fallback until it lands. A geometry assertion that races the swap measures a screen nobody
 * renders — and, worse, passes *because* of the narrower metrics. Awaiting `fonts.ready` alone
 * is not enough either: if the font request fails, that resolves immediately and every guard
 * goes vacuously green, so the load is asserted rather than assumed.
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
    if (pathname.includes('/api/base/')) return json(baseDetail);
    if (pathname.endsWith('/api/battle')) return json(battle);
    if (pathname.endsWith('/api/overseer')) return json(createOverseerResponse, 201);
    if (pathname.endsWith('/api/auth/login')) return json(authResponse);
    if (pathname.endsWith('/api/auth/register')) return json(authResponse, 201);
    return json({ error: { code: 'NOT_FOUND', message: 'unmapped route' } }, 404);
  });
}
