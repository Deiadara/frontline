/**
 * Assignees: the fungible pool under each officer (GDD §G), owned by W4/MOU-163.
 *
 * Re-exported through a single barrel line in `../index.ts` (INTERFACES §3). The pool size and the
 * per-officer cap are *not* defined here: §G8 and §G3a make them consequences of levelling, so
 * they come from W6's `playerLevelGrants` and this module only reads them.
 */
export * from './bonus.js';
export * from './placement.js';
export * from './delegation.js';
export * from './reskilling.js';
