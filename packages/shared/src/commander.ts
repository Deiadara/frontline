import { z } from 'zod';
import { AttributesSchema, DEFAULT_ATTRIBUTES, type Attributes } from './attributes.js';
import { IdSchema } from './primitives.js';
import { OfficerRoleSchema, type OfficerRole } from './roles.js';
import { TraitsSchema, type TraitId } from './traits.js';

/** A character hired into one of the officer positions in GDD §C1. */
export const CommanderSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  role: OfficerRoleSchema,
  attributes: AttributesSchema,
  traits: TraitsSchema,
});
export type Commander = z.infer<typeof CommanderSchema>;

/** Example factory: unlisted attributes default to the recruitment mean. */
export function createCommander(
  id: string,
  name: string,
  role: OfficerRole,
  attributes: Partial<Attributes> = {},
  traits: readonly TraitId[] = [],
): Commander {
  return {
    id,
    name,
    role,
    attributes: { ...DEFAULT_ATTRIBUTES, ...attributes },
    traits: [...traits],
  };
}
