import type { MeResponse } from '@frontline/shared';
import type { Page } from '@playwright/test';
import { authResponse, baseDetail, battle, city, createOverseerResponse, TOKEN } from './fixtures';

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
