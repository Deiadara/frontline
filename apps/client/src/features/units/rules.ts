import { findUnit, UNIT_RULES, unitRules } from '@frontline/shared';

/**
 * How a unit rule reads: something it can do, or something it cannot.
 *
 * `tone` is new on the shared rule spec, so it is read through this rather than off the object at
 * each call site: a build of `@frontline/shared` without the field must still draw Shield Line and
 * Field Medic the way it always has, and a rule that says nothing about its tone is positive.
 *
 * **The rule the card is handed usually has no tone on it.** `UnitOptionSchema.rules` is
 * `{ id, label, description }`, so zod strips the field on the way in and the Colossus's red rule
 * arrived brass: the chip was correct and the data behind it was not, which no class-list review
 * catches. The catalogue is the fallback, and it is the better source anyway. A tone is a fact
 * about the *rule*, the same on every card in every crew, so it belongs to the static table both
 * sides already ship rather than to a field repeated in every roster payload. A tone that does
 * arrive on the wire still wins, so adding it to the schema changes nothing here.
 */
export type RuleTone = 'positive' | 'negative';

/** The catalogue, widened: `UNIT_RULES` is `as const`, so indexing it by a wire string needs one. */
const CATALOGUE: Readonly<Record<string, { label: string; tone?: string }>> = UNIT_RULES;

export function ruleTone(rule: { id: string; tone?: string }): RuleTone {
  const tone = rule.tone ?? CATALOGUE[rule.id]?.tone;
  return tone === 'negative' ? 'negative' : 'positive';
}

/** The mark chip, by tone. Brass is the chrome for a mechanism; oxblood is the one for a refusal. */
export const RULE_CHIP: Record<RuleTone, string> = {
  positive: 'border-brass-300/70 bg-brass-300/20 text-brass-100',
  negative: 'border-oxblood-500/70 bg-oxblood-500/20 text-oxblood-300',
};

/** The same two, as ink for a rule's name in a list. */
export const RULE_INK: Record<RuleTone, string> = {
  positive: 'text-brass-100',
  negative: 'text-oxblood-300',
};

/** The frame a rule's own window wears. `InfoWindow`'s tones, not a second palette. */
export const RULE_WINDOW_TONE: Record<RuleTone, 'brass' | 'oxblood'> = {
  positive: 'brass',
  negative: 'oxblood',
};

/**
 * The rule that keeps a unit off every vehicle (`units/catalog.ts`, `UNIT_RULES.no_ride`).
 *
 * Annotated `string` rather than left to infer its literal: `UnitRuleId` is a union of the rules
 * the installed `@frontline/shared` happens to carry, and comparing it against a literal the build
 * has not heard of is an error rather than a `false`.
 */
export const NO_RIDE_RULE: string = 'no_ride';

/**
 * Whether this unit walks whatever the column is riding.
 *
 * Asked of the catalogue rather than of a `UnitOption`, so the deploy dialog and the mission
 * board's picker can ask it about a row they only have an id for. False for every unit on a shared
 * package that does not carry the rule yet, which is the same answer those screens gave before.
 */
export function walksAlways(unitId: string): boolean {
  const spec = findUnit(unitId);
  return spec !== undefined && unitRules(spec).some((rule) => rule.id === NO_RIDE_RULE);
}
