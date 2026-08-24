/**
 * Research and hidden-info discovery (GDD §B9, §F2-§F5), owned by W7/MOU-166.
 *
 * Re-exported through a single barrel line in `../index.ts` (INTERFACES §3). Minting a fact is
 * *not* here: it is the one operation that has to read the hidden role requirement table, so it
 * lives server-side in `apps/server/src/research/discover.ts` (§B8a, INTERFACES R4). Everything in
 * this package only ever reads facts that have already been discovered.
 */
export * from './effects.js';
export * from './facts.js';
export * from './projects.js';
export * from './state.js';
export * from './tech.js';
