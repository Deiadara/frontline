import { z } from 'zod';
import { IdSchema } from './primitives.js';
import { DEFAULT_SKILLS, SkillsSchema, type Skills } from './skills.js';

/** Staff/commander roles a base can employ (implemented in a later milestone). */
export const COMMANDER_ROLES = ['head_doctor', 'battle_analyst', 'accountant', 'head_spy'] as const;
export const CommanderRoleSchema = z.enum(COMMANDER_ROLES);
export type CommanderRole = z.infer<typeof CommanderRoleSchema>;

export const CommanderSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  role: CommanderRoleSchema,
  skills: SkillsSchema,
});
export type Commander = z.infer<typeof CommanderSchema>;

/** Example factory: unspecified skills default to a neutral 10. */
export function createCommander(
  id: string,
  name: string,
  role: CommanderRole,
  skills: Partial<Skills> = {},
): Commander {
  return { id, name, role, skills: { ...DEFAULT_SKILLS, ...skills } };
}
