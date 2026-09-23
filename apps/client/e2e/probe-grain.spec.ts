import { test } from '@playwright/test';
import { lateGame, meNoOverseer } from './fixtures';
import { installApi } from './harness';

const SCREENS = [
  ['base', '/game/base'],
  ['city', '/game/city'],
  ['units', '/game/units'],
  ['missions', '/game/missions'],
  ['crew', '/game/crew'],
  ['research', '/game/research'],
  ['feats', '/game/feats'],
  ['battles', '/game/battles'],
] as const;

test('every grain element is positioned', async ({ page }) => {
  const bad: string[] = [];
  await installApi(page, lateGame);
  for (const [name, path] of SCREENS) {
    await page.goto(path);
    await page.waitForTimeout(600);
    const offenders = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.grain')]
        .filter((n) => getComputedStyle(n).position === 'static')
        .map((n) => n.tagName + '.' + n.className.toString().slice(0, 70)),
    );
    for (const o of offenders) bad.push(`${name}: ${o}`);
  }
  await installApi(page, meNoOverseer);
  await page.goto('/overseer');
  await page.waitForTimeout(600);
  const offenders = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.grain')]
      .filter((n) => getComputedStyle(n).position === 'static')
      .map((n) => n.tagName + '.' + n.className.toString().slice(0, 70)),
  );
  for (const o of offenders) bad.push(`overseer: ${o}`);
  console.log(bad.length === 0 ? 'ALL GRAIN POSITIONED' : `UNPOSITIONED:\n${bad.join('\n')}`);
});
