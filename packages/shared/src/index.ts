/**
 * @frontline/shared — the single source of truth for the Frontline domain model.
 * Every type is co-located with its Zod schema (`type X = z.infer<typeof XSchema>`).
 */
export * from './primitives.js';
export * from './skills.js';
export * from './resources.js';
export * from './building.js';
export * from './overseer.js';
export * from './commander.js';
export * from './base.js';
export * from './city.js';
export * from './user.js';
export * from './art/prompts.js';
export * from './art/manifest.js';
export * from './battle/types.js';
export * from './battle/engine.js';
export * from './api.js';
export * from './mvp.js';
