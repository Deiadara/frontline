/**
 * @frontline/shared — the single source of truth for the Frontline domain model.
 * Every type is co-located with its Zod schema (`type X = z.infer<typeof XSchema>`).
 */
export * from './primitives.js';
export * from './attributes.js';
export * from './traits.js';
export * from './roles.js';
export * from './resources.js';
export * from './economy/meters.js';
export * from './economy/reputation.js';
export * from './economy/payroll.js';
export * from './economy/state.js';
export * from './progression/index.js';
export * from './building.js';
export * from './overseer.js';
export * from './commander.js';
export * from './base.js';
export * from './city.js';
export * from './user.js';
export * from './art/prompts.js';
export * from './art/manifest.js';
export * from './art/hero.js';
export * from './battle/types.js';
export * from './battle/engine.js';
export * from './api.js';
export * from './mvp.js';
