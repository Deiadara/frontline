import { z } from 'zod';

/** The fixed Football-Manager-style attribute set. Every rated entity uses all eight. */
export const SKILL_NAMES = [
  'leadership',
  'tactics',
  'hacking',
  'logistics',
  'intimidation',
  'engineering',
  'medicine',
  'negotiation',
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

/** A single skill rating: integer 1..20 (FM scale). */
export const SkillValueSchema = z.number().int().min(1).max(20);

export type Skills = Record<SkillName, number>;

/** Validates a full skill sheet: all eight skills present, each 1..20. */
export const SkillsSchema: z.ZodType<Skills> = z.object({
  leadership: SkillValueSchema,
  tactics: SkillValueSchema,
  hacking: SkillValueSchema,
  logistics: SkillValueSchema,
  intimidation: SkillValueSchema,
  engineering: SkillValueSchema,
  medicine: SkillValueSchema,
  negotiation: SkillValueSchema,
});

/** Clamp an arbitrary number onto the valid 1..20 skill scale. */
export function clampSkill(value: number): number {
  return Math.min(20, Math.max(1, Math.round(value)));
}

/** Neutral 10-across-the-board sheet, useful as a factory default. */
export const DEFAULT_SKILLS: Skills = {
  leadership: 10,
  tactics: 10,
  hacking: 10,
  logistics: 10,
  intimidation: 10,
  engineering: 10,
  medicine: 10,
  negotiation: 10,
};
