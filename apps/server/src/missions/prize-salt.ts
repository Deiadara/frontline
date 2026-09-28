import { createHmac } from 'node:crypto';
import { DEV_JWT_SECRET } from '../config.js';

/**
 * The server-only half of the page-prize seed (`pagePrizeFor`, §F1b).
 *
 * The rest of that seed is the area, the board key, the template and the grade: all on the card or
 * derived from the clock, and the function itself ships in the client bundle. Without a secret in
 * the mix a player could compute which card pays a page before choosing one.
 *
 * Derived from `JWT_SECRET` rather than read from a variable of its own. It is already secret,
 * already required to be real in production (`assertDeployable`), and one more variable is one
 * more thing a deploy can leave at a committed default. Keyed through HMAC with a fixed label, so
 * the salt is not the signing key and knowing one prize does not help against a token.
 *
 * Rotating `JWT_SECRET` re-rolls which cards on the current board pay. That is harmless: a
 * launched run froze its prize onto the row, and a card nobody has taken promised nothing.
 */
export function pagePrizeSaltFrom(jwtSecret: string): string {
  return createHmac('sha256', jwtSecret).update('frontline:page-prize').digest('hex');
}

/*
 * Held here and set once at boot, because `launchMission` is called from the missions route and
 * from the automation runner and neither holds the config. The default is the development
 * secret's salt, so a test that launches without building an app still draws deterministically.
 */
let salt = pagePrizeSaltFrom(DEV_JWT_SECRET);

/** Called by `buildApp` with the configured secret. Never logged. */
export function configurePagePrizeSalt(jwtSecret: string): void {
  salt = pagePrizeSaltFrom(jwtSecret);
}

export function pagePrizeSalt(): string {
  return salt;
}
