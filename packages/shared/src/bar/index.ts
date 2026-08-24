/**
 * Recruitment — the Bar (GDD §H), owned by W5/MOU-164.
 *
 * Re-exported through a single barrel line in `../index.ts` (INTERFACES §3). Generating the daily
 * roster itself is *not* here: it needs `generateCharacter`, which reads the hidden role
 * requirement table, so it lives server-side in `apps/server/src/bar/` (§B8a, INTERFACES R4).
 */
export * from './disposition.js';
export * from './join.js';
export * from './level.js';
export * from './negotiation.js';
export * from './wage.js';
