/**
 * The two names the rest of the game still calls research by.
 *
 * The Lab's tree used to be fifteen programmes on five invented themes and lived here. It is
 * nineteen tracks, one per officer role, and lives in `tracks.ts`. Two catalogues outside this
 * feature reach into it by these names: `battle/traps.ts` and `battle/boosts.ts` gate on a finished
 * research id, and `crew/standing.ts` folds the effects. They are aliases rather than a rewrite
 * because those files belong to other work; the module path is kept for the same reason.
 */
export { findResearchItem as findTech, researchEffects as techEffects } from './tracks.js';
