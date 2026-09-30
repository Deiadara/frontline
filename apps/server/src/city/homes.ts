import { cityHomeOffers } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * The districts somebody lives on, which is what decides whether a plot is free.
 *
 * Bots count (maintainer, 2026-09-28: "there should be no bots seated on players' locations").
 * They used to be left out so the seeded rivals on three of Ashfall's four plots did not fill the
 * city, and the price was a player seated on a bot's plot: two crews in one home district, one of
 * them unraidable and the other's army conscripted into every raid there. While the bots are
 * seeded, a dev world has four free plots rather than eight. They go before launch (`seed/index.ts`).
 */
export function takenHomes(repos: Repositories): string[] {
  return repos.bases.listSummaries().map((home) => home.districtId);
}

/**
 * Whether any open city still has a plot a new crew could move onto (bug pass, 2026-09-29).
 *
 * Read at sign-up. An account made while every plot is lived in picked a character, held four
 * overseers out of the pool for ten minutes and then met "Full" on every city, with no way on.
 * Off the same offers `GET /overseer/choices` draws, so sign-up and the city screen cannot disagree
 * about whether there is room.
 */
export function worldHasRoom(repos: Repositories): boolean {
  return cityHomeOffers(takenHomes(repos)).some((offer) => offer.available);
}
